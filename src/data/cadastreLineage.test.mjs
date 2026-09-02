// src/data/cadastreLineage.test.mjs
// Pins the chain that turns a dead cadastral reference back into a plot, on
// the real division it was written from: Ustaritz AN 221, split three months
// before the permit that names it was granted, into the lots that carry
// 18 and 42 Impasse de Haroztegia. Every step here fails PLAUSIBLY when it is
// wrong — an anchor test that collects the neighbour's ground, a building diff
// that counts a redrawn outline as new construction, and a house number that
// the counter and the BAL spell differently — so the fixture is real geometry
// rather than three squares that would agree with any implementation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ADS_LINEAGE_BASIS,
  LINEAGE_ARCHIVE_FLOOR,
  LINEAGE_MILLESIMES,
  balParcelsForNumber,
  buildingsOn,
  anchorParcels,
  assignDivision,
  cadastreArchiveUrl,
  childrenOf,
  childrenThatBuilt,
  indexByIdu,
  insidePoint,
  millesimeLadder,
  parseCadastreMillesimes,
  pickChild,
  sitadelParcelRefs,
} from './cadastreLineage.js';
import { parcelParts } from './sitadelFeed.js';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/cadastre-64547-lineage-sample.json', import.meta.url), 'utf8'));
const PARENT = FIXTURE.parent.feature;
const CURRENT = FIXTURE.current.features;
const BEFORE = FIXTURE.batimentsBefore.features;
const AFTER = FIXTURE.batimentsAfter.features;

/** The permit this module was written from, as DiDo actually returns it. */
const PERMIT_2021 = {
  COMM: '64547',
  NUM_DAU: '06454721B0009',
  ETAT_DAU: 6,
  AN_DEPOT: 2021,
  ADR_NUM_TER: null,
  ADR_LIBVOIE_TER: 'IMPASSE HAROZTEGIA',
  SEC_CADASTRE1: 'AN',
  NUM_CADASTRE1: '221',
  SUPERFICIE_TERRAIN: 1317,
  NB_LGT_TOT_CREES: 1,
  SURF_HAB_CREEE: 94,
  DATE_REELLE_AUTORISATION: '2021-07-20',
  DATE_REELLE_DOC: '2022-04-15',
  DATE_REELLE_DAACT: '2023-04-15',
};

test('a Sitadel reference becomes the 14-character IDU the cadastre publishes', () => {
  const refs = sitadelParcelRefs(PERMIT_2021, '64547');
  assert.deepEqual(refs.map((ref) => ref.idu), ['64547000AN0221']);
  assert.equal(refs[0].provisional, false);
  assert.equal(refs[0].label, 'AN221');
});

test('a "partie de parcelle" suffix keeps its digits and is flagged, never padded', () => {
  // 25 of Ustaritz's 543 rows write the number with a letter glued to it.
  // Padding "255P" to four characters yields "255P", which is not a cadastral
  // number and misses the index in silence — the row then looks like a permit
  // on a parcel that never existed rather than one filed mid-division.
  const [ref] = sitadelParcelRefs({ SEC_CADASTRE1: 'AP', NUM_CADASTRE1: '255P' }, '64547');
  assert.equal(ref.idu, '64547000AP0255');
  assert.equal(ref.provisional, true);
});

test('the three cadastral slots are read, and a half-filled pair is dropped', () => {
  const refs = sitadelParcelRefs({
    SEC_CADASTRE1: 'AL', NUM_CADASTRE1: '325',
    SEC_CADASTRE2: 'AL', NUM_CADASTRE2: '326',
    SEC_CADASTRE3: 'AL', NUM_CADASTRE3: null,
  }, '64547');
  assert.deepEqual(refs.map((ref) => ref.label), ['AL325', 'AL326']);
});

test('one row naming the same parcel twice names it once', () => {
  // Measured on Bordeaux (`adsFeed.js` says so for `refcad`); the same hand
  // writes both registers, and a duplicate here would double-count the area.
  const refs = sitadelParcelRefs({
    SEC_CADASTRE1: 'AN', NUM_CADASTRE1: '221',
    SEC_CADASTRE2: 'AN', NUM_CADASTRE2: '0221',
  }, '64547');
  assert.equal(refs.length, 1);
});

test('AN 221 is absent from today’s cadastre — which is the signal, not an error', () => {
  const index = indexByIdu({ features: CURRENT });
  assert.equal(index.has('64547000AN0221'), false);
  assert.equal(index.has('64547000AN0512'), true);
});

test('the anchor sits INSIDE the parcel, where a centroid need not', () => {
  for (const feature of CURRENT) {
    const parts = parcelParts(feature.geometry);
    const point = insidePoint(parts);
    assert.ok(point, `no anchor for ${feature.properties.id}`);
    assert.ok(Number.isFinite(point.lon) && Number.isFinite(point.lat));
  }
});

test('AN 221 divides into exactly its three lots, and they sum to its ground', () => {
  const { children, parentAreaM2, childAreaM2, agrees } = childrenOf(PARENT, anchorParcels({ features: CURRENT }));
  assert.deepEqual(
    children.map((child) => child.properties.id).sort(),
    ['64547000AN0511', '64547000AN0512', '64547000AN0513'],
  );
  // The neighbours in the fixture — AN 222, AN 224, AN 516, AN 514, AN 515 —
  // are metres away and must NOT be collected: an intersection test would take
  // them, because the archived outline and the current one share no vertices.
  assert.equal(children.length, 3);
  assert.ok(Math.abs(parentAreaM2 - 1372) < 40, `parent measured ${parentAreaM2}`);
  assert.ok(Math.abs(childAreaM2 - parentAreaM2) / parentAreaM2 < 0.02);
  assert.equal(agrees, true);
});

test('a parent whose children do not sum to it is refused rather than drawn', () => {
  // Only the 34 m² access strip offered as the whole division: 2.5% of the
  // parent's ground. Handing that back as "the plot" would draw a permit for a
  // house on a footpath.
  const strip = CURRENT.filter((feature) => feature.properties.id === '64547000AN0513');
  const { children, agrees } = childrenOf(PARENT, anchorParcels({ features: strip }));
  assert.equal(children.length, 1);
  assert.equal(agrees, false);
});

test('AN 512 is the only lot that gained a building, and it is the house', () => {
  const { children } = childrenOf(PARENT, anchorParcels({ features: CURRENT }));
  const built = childrenThatBuilt(children, BEFORE, AFTER);
  assert.deepEqual(built.map((child) => child.properties.id), ['64547000AN0512']);

  const parts = (id) => parcelParts(CURRENT.find((f) => f.properties.id === id).geometry);
  // AN 511 already carried its house and its annex in 2021 and gained nothing;
  // counting outlines rather than area is what makes that survive a redraw.
  assert.equal(buildingsOn(parts('64547000AN0511'), BEFORE), 2);
  assert.equal(buildingsOn(parts('64547000AN0511'), AFTER), 2);
  assert.equal(buildingsOn(parts('64547000AN0512'), BEFORE), 0);
  assert.equal(buildingsOn(parts('64547000AN0512'), AFTER), 1);
  // The access strip never carries anything, in either edition.
  assert.equal(buildingsOn(parts('64547000AN0513'), AFTER), 0);
});

test('the BAL names the lot the permit never numbered', () => {
  assert.deepEqual(balParcelsForNumber(FIXTURE.bal, 18), ['64547000AN0512']);
  assert.deepEqual(balParcelsForNumber(FIXTURE.bal, '42'), ['64547000AN0511']);
  assert.deepEqual(balParcelsForNumber(FIXTURE.bal, null), []);
});

test('the counter’s house number and the BAL disagree, and the BAL is the record', () => {
  // Two Ustaritz dossiers are filed at "67 IMPASSE D'HAROZTEGIA" and name
  // AN 515 — which the BAL numbers 63. The real 67 is AN 514, one lot on. A
  // chain that trusted the written number would move both permits next door.
  assert.deepEqual(balParcelsForNumber(FIXTURE.bal, 67), ['64547000AN0514']);
  assert.deepEqual(balParcelsForNumber(FIXTURE.bal, 63), ['64547000AN0515']);
});

test('the whole chain lands on 18 Impasse de Haroztegia without being told the number', () => {
  const refs = sitadelParcelRefs(PERMIT_2021, '64547');
  const today = indexByIdu({ features: CURRENT });
  assert.ok(refs.every((ref) => !today.has(ref.idu)), 'the reference must be dead');

  const { children, agrees } = childrenOf(PARENT, anchorParcels({ features: CURRENT }));
  assert.equal(agrees, true);
  const built = childrenThatBuilt(children, BEFORE, AFTER);
  const numbered = balParcelsForNumber(FIXTURE.bal, PERMIT_2021.ADR_NUM_TER);
  assert.deepEqual(numbered, [], 'the permit carries no house number at all');

  const { feature, basis } = pickChild({ children, built, numbered });
  assert.equal(feature.properties.id, '64547000AN0512');
  assert.equal(basis, 'built');
  // And that lot is the address the reader was looking for.
  assert.deepEqual(balParcelsForNumber(FIXTURE.bal, 18), [feature.properties.id]);
});

test('a permit that DOES carry its number is placed by the BAL, not by the bulldozer', () => {
  const { children } = childrenOf(PARENT, anchorParcels({ features: CURRENT }));
  const built = childrenThatBuilt(children, BEFORE, AFTER);
  const { feature, basis } = pickChild({
    children, built, numbered: balParcelsForNumber(FIXTURE.bal, 42),
  });
  assert.equal(feature.properties.id, '64547000AN0511');
  assert.equal(basis, 'numbered');
  assert.ok(ADS_LINEAGE_BASIS.numbered.rank > ADS_LINEAGE_BASIS.built.rank);
});

test('two lots that both built leave the permit on the PARENT, not on a guess', () => {
  // 45.6% of Ustaritz's ambiguous divisions since 2018 look like this, usually
  // because several permits name the same parent. Picking one would be a coin
  // toss printed as a fact.
  const { children } = childrenOf(PARENT, anchorParcels({ features: CURRENT }));
  const { feature, basis } = pickChild({ children, built: children.slice(0, 2) });
  assert.equal(feature, null);
  assert.equal(basis, 'parent');
  assert.equal(ADS_LINEAGE_BASIS.parent.rank, 0);
});

test('nothing built anywhere also leaves the permit on the parent', () => {
  // 24.8% of the same population: a granted permit on a lot still bare.
  const { children } = childrenOf(PARENT, anchorParcels({ features: CURRENT }));
  assert.equal(pickChild({ children, built: [] }).basis, 'parent');
});

test('a division that produced ONE parcel needs no evidence at all', () => {
  const only = CURRENT.filter((feature) => feature.properties.id === '64547000AN0512');
  assert.deepEqual(pickChild({ children: only }), { feature: only[0], basis: 'sole' });
});

test('the permis d’aménager that DREW the lots stays on the parent', () => {
  // Found in the browser, not here: `PA 064 547 20 B0003` split AN 221 and
  // `PC 064 547 21 B0009` built on the result. Resolved one at a time they both
  // landed on AN 512 — so the layer drew the permit that created three lots as
  // if it applied to one of them.
  const { children } = childrenOf(PARENT, anchorParcels({ features: CURRENT }));
  const built = childrenThatBuilt(children, BEFORE, AFTER);
  const verdicts = assignDivision([
    { id: 'sitadel:PA:06454720B0003', kind: 'PA', numbered: [] },
    { id: 'sitadel:DAU:06454721B0009', kind: 'PC', numbered: [] },
  ], { children, built });

  assert.equal(verdicts.get('sitadel:PA:06454720B0003').feature, null);
  assert.equal(verdicts.get('sitadel:PA:06454720B0003').basis, 'parent');
  // …and the aménageur standing beside it does not stop the constructeur from
  // being placed: it was never a claimant on a lot.
  assert.equal(verdicts.get('sitadel:DAU:06454721B0009').feature.properties.id, '64547000AN0512');
  assert.equal(verdicts.get('sitadel:DAU:06454721B0009').basis, 'built');
});

test('two dossiers wanting the same built lot both fall back to the parent', () => {
  const { children } = childrenOf(PARENT, anchorParcels({ features: CURRENT }));
  const built = childrenThatBuilt(children, BEFORE, AFTER);
  const verdicts = assignDivision([
    { id: 'a', kind: 'PC', numbered: [] },
    { id: 'b', kind: 'PC', numbered: [] },
  ], { children, built });
  assert.equal(verdicts.get('a').basis, 'parent');
  assert.equal(verdicts.get('b').basis, 'parent');
});

test('…unless their own BAL numbers separate them, which is per-address evidence', () => {
  const { children } = childrenOf(PARENT, anchorParcels({ features: CURRENT }));
  const built = childrenThatBuilt(children, BEFORE, AFTER);
  const verdicts = assignDivision([
    { id: 'a', kind: 'PC', numbered: balParcelsForNumber(FIXTURE.bal, 18) },
    { id: 'b', kind: 'PC', numbered: balParcelsForNumber(FIXTURE.bal, 42) },
  ], { children, built });
  assert.equal(verdicts.get('a').feature.properties.id, '64547000AN0512');
  assert.equal(verdicts.get('b').feature.properties.id, '64547000AN0511');
  assert.equal(verdicts.get('b').basis, 'numbered');
});

test('the ladder starts just before the authorisation and walks backwards', () => {
  // AN 221 lives at 2021-04-01 and is gone at 2021-07-01; the permit was
  // granted 2021-07-20. Starting at `latest` would never find the parent.
  const ladder = millesimeLadder(LINEAGE_MILLESIMES, '2021-07-20', 3);
  assert.deepEqual(ladder, ['2021-07-01', '2021-04-01', '2021-02-01']);
  assert.ok(ladder.includes(FIXTURE.parent.millesime) || ladder.includes('2021-04-01'));
});

test('the ladder is bounded, because each rung is a 676 KB download', () => {
  assert.equal(millesimeLadder(LINEAGE_MILLESIMES, '2025-01-01', 3).length, 3);
  // A permit older than the whole archive climbs the OTHER way: its parcel was
  // alive at filing and died later, so only the oldest editions can hold it.
  assert.deepEqual(
    millesimeLadder(LINEAGE_MILLESIMES, '2013-01-01', 3),
    ['2017-07-06', '2017-10-12', '2018-01-02'],
  );
  // A permit with no decision date gets the NEWEST editions: they hold the
  // most living parcels, so they are likeliest to answer.
  assert.equal(millesimeLadder(LINEAGE_MILLESIMES, null, 2)[0], LINEAGE_MILLESIMES.at(-1));
});

test('the archive floor is stated, because permits older than it cannot be placed', () => {
  assert.equal(LINEAGE_ARCHIVE_FLOOR, '2017-07-06');
  assert.equal(LINEAGE_MILLESIMES[0], LINEAGE_ARCHIVE_FLOOR);
  assert.deepEqual([...LINEAGE_MILLESIMES].sort(), [...LINEAGE_MILLESIMES]);
});

test('the live index is read over the pinned list, and an unreadable one is empty', () => {
  const html = '<a href="2021-04-01/">2021-04-01/</a><a href="2016-01-01/">2016-01-01/</a>';
  assert.deepEqual(parseCadastreMillesimes(html), ['2021-04-01']);
  assert.deepEqual(parseCadastreMillesimes('<html>no editions here</html>'), []);
});

test('a dated snapshot URL is the one Etalab actually serves', () => {
  assert.equal(
    cadastreArchiveUrl('64547', '2021-04-01'),
    'https://cadastre.data.gouv.fr/data/etalab-cadastre/2021-04-01/geojson/communes/64/64547/cadastre-64547-parcelles.json.gz',
  );
  assert.equal(
    cadastreArchiveUrl('64547', '2021-04-01', 'batiments'),
    'https://cadastre.data.gouv.fr/data/etalab-cadastre/2021-04-01/geojson/communes/64/64547/cadastre-64547-batiments.json.gz',
  );
});
