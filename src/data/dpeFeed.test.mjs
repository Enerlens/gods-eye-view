// src/data/dpeFeed.test.mjs
// Pins the UPSTREAM ADEME DPE shape against a real captured page, fetched
// through the very URL `buildDpeUrl` produces. The field list is the fragile
// part: this dataset answers HTTP 400 for an unknown column rather than
// ignoring it, so a renamed field takes the layer down instead of degrading it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DPE_DEFAULT_RADIUS_M,
  DPE_FIELDS,
  DPE_LABELS,
  DPE_MAX_RADIUS_M,
  buildDpeUrl,
  clampDpeRadius,
  parseGeopoint,
  projectDpe,
} from './dpeFeed.js';

const SAMPLE = JSON.parse(readFileSync(
  new URL('./fixtures/ademe-dpe-existant-sample.json', import.meta.url),
  'utf8',
));

test('the captured page still carries every field the projection reads', () => {
  assert.equal(SAMPLE.total, 2805);
  assert.equal(SAMPLE.results.length, 6);
  const row = SAMPLE.results[0];
  for (const key of ['numero_dpe', 'etiquette_dpe', 'etiquette_ges', 'adresse_ban',
    'identifiant_ban', '_geopoint', '_geo_distance']) {
    assert.ok(Object.hasOwn(row, key), `${key} must still be published`);
  }
  // data-fair omits null columns entirely rather than sending null, so an
  // absent key is data, not a schema change: `annee_construction` is in the
  // schema and simply unset for this building.
  assert.equal(Object.hasOwn(row, 'annee_construction'), false);
});

test('the URL sends geo_distance as lon,lat,radius and asks for no sort', () => {
  const url = new URL(buildDpeUrl({ lon: 2.3760, lat: 48.8300, radiusM: 300, limit: 6 }));
  assert.equal(url.searchParams.get('geo_distance'), '2.376,48.83,300');
  // `sort=_geo_distance` is HTTP 400 — the distance is computed per query, not
  // stored — while geo_distance already returns rows nearest-first.
  assert.equal(url.searchParams.has('sort'), false);
  assert.equal(url.searchParams.get('select'), DPE_FIELDS.join(','));
  const distances = SAMPLE.results.map((row) => row._geo_distance);
  assert.deepEqual([...distances].sort((a, b) => a - b), distances);
});

test('the geopoint is latitude-first, against the argument order of the query', () => {
  // `geo_distance` takes lon,lat — `_geopoint` returns "lat,lon". Reading it
  // the same way round would place every Paris diagnostic off the Somali coast.
  assert.deepEqual(parseGeopoint('48.83005900891943,2.3752209432033315'), {
    lat: 48.83005900891943, lon: 2.3752209432033315,
  });
  assert.equal(parseGeopoint('nonsense'), null);
  assert.equal(parseGeopoint(null), null);
});

test('the projection separates how many exist from how many are served', () => {
  const projected = projectDpe(SAMPLE, { radiusM: 300 });
  // 2,805 diagnostics within 300 m; six of them returned. Collapsing that gap
  // would let a reader take six rows for the whole neighbourhood.
  assert.equal(projected.total, 2805);
  assert.equal(projected.entries.length, 6);
  assert.equal(projected.truncated, true);
});

test('labels are counted as a distribution, never averaged into a grade', () => {
  const projected = projectDpe(SAMPLE, { radiusM: 300 });
  assert.deepEqual(projected.distribution, { A: 0, B: 0, C: 2, D: 1, E: 1, F: 0, G: 2 });
  assert.deepEqual(Object.keys(projected.distribution), [...DPE_LABELS]);
});

test('an out-of-domain label is dropped rather than coerced', () => {
  const projected = projectDpe({ total: 1, results: [{ etiquette_dpe: 'Z', numero_dpe: 'x' }] }, {});
  assert.equal(projected.entries[0].etiquetteDpe, null);
  assert.equal(Object.values(projected.distribution).reduce((a, b) => a + b, 0), 0);
});

test('an entry keeps its position, its distance and its cost', () => {
  const { entries } = projectDpe(SAMPLE, { radiusM: 300 });
  const first = entries[0];
  assert.equal(first.address, '93 Rue du Chevaleret 75013 Paris');
  assert.equal(first.distanceM, 57);
  assert.ok(Number.isFinite(first.lon) && Number.isFinite(first.lat));
  assert.equal(typeof first.annualCostEur, 'number');
  // Absent is null, never zero: a diagnostic with no recorded build year must
  // not read as having been built in year 0.
  assert.equal(first.builtYear, null);
});

test('an empty or missing payload projects to an empty answer, never a throw', () => {
  const projected = projectDpe(null, { radiusM: 200 });
  assert.deepEqual(projected.entries, []);
  assert.equal(projected.total, null);
  assert.equal(projected.truncated, false);
  assert.equal(projected.medianCoutAnnuel, null);
});

test('the radius is clamped rather than trusted', () => {
  assert.equal(clampDpeRadius(99_999), DPE_MAX_RADIUS_M);
  assert.equal(clampDpeRadius(1), 50);
  assert.equal(clampDpeRadius('x'), 200);
  assert.throws(() => buildDpeUrl({ lon: NaN, lat: 48 }), /must be finite/);
});

test('an absent parameter takes the default, not the minimum', () => {
  // FOUND LIVE. `URLSearchParams.get()` returns `null` when a parameter is
  // absent, `Number(null)` is `0`, and `Number.isFinite(0)` is true — so the
  // clamp read "the caller said nothing" as "the caller said zero" and returned
  // its MINIMUM. `GET /api/dpe` with no radius scanned 50 m instead of 200 m and
  // reported `total: 0` for an address with 2,805 diagnostics around it.
  const absent = new URL('http://x/?other=1').searchParams.get('radius');
  assert.equal(absent, null);
  assert.equal(clampDpeRadius(absent), DPE_DEFAULT_RADIUS_M);
  assert.equal(clampDpeRadius(''), DPE_DEFAULT_RADIUS_M);
  assert.equal(clampDpeRadius(undefined), DPE_DEFAULT_RADIUS_M);
  // An EXPLICIT zero is still a request, and is still clamped to the floor.
  assert.equal(clampDpeRadius('0'), 50);
});

/* ── the pivot: the register names the BUILDING, not only the address ──── */

/**
 * A second captured page, from a Marseille point, fetched through the very URL
 * `buildDpeUrl` produces on 2026-09-07.
 *
 * A second fixture rather than a replacement: the Paris one above is a block
 * where NO row carries `id_rnb` — which is 26.3 % of that box and a case the
 * projection has to keep handling — while five of these six do, and the sixth
 * does not. Both halves of the register in two verbatim pages.
 */
const RNB_SAMPLE = JSON.parse(readFileSync(
  new URL('./fixtures/ademe-dpe-rnb-sample.json', import.meta.url),
  'utf8',
));

test('asking for id_rnb is accepted by the dataset, and it is in the pinned selection', () => {
  // This dataset answers HTTP 400 for a column it does not publish, so a field
  // in `DPE_FIELDS` that is absent upstream takes the whole layer down. The
  // captured page is the proof that these two are real columns.
  assert.ok(DPE_FIELDS.includes('id_rnb'));
  assert.ok(DPE_FIELDS.includes('provenance_id_rnb'));
  const row = RNB_SAMPLE.results[0];
  assert.equal(row.id_rnb, '83SJ572HH22P');
  assert.equal(row.provenance_id_rnb, 'Reprise RNB');
});

test('the identifier and its provenance reach the entry the join runs on', () => {
  const { entries } = projectDpe(RNB_SAMPLE, { radiusM: 300 });
  assert.equal(entries[0].rnb, '83SJ572HH22P');
  assert.equal(entries[0].rnbSource, 'Reprise RNB');
});

test('a row the register could not attach to a building says so with null', () => {
  // data-fair omits a null column entirely. `''` or `'null'` here would mint an
  // identifier that names nothing and quietly hand the row to no building.
  const { entries } = projectDpe(RNB_SAMPLE, { radiusM: 300 });
  const orphan = entries.find((entry) => !entry.rnb);
  assert.equal(orphan.rnb, null);
  assert.equal(orphan.rnbSource, null, 'no key, no provenance to report');
});

test('the coverage of the pivot is reported, not assumed', () => {
  // It is the ceiling on what the identity join can reach in this scan, and it
  // moves with the edition — 34.5 % over Ustaritz against 73.7 % over Paris 13e.
  const projected = projectDpe(RNB_SAMPLE, { radiusM: 300 });
  assert.equal(projected.rnbCoverage, 5 / 6);
  assert.equal(projectDpe(SAMPLE, { radiusM: 300 }).rnbCoverage, 0,
    'a block where no row names a building is a real answer, not a broken one');
  assert.equal(projectDpe(null, {}).rnbCoverage, 0);
});
