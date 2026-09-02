// The reading of the CNAF's childcare-coverage files.
//
// Every test runs against real captured rows: six départements picked because
// each is awkward in a different way (the national maximum, the national
// minimum, an overseas territory no polygon can hold, the Corsican spelling,
// a dense metropolis, a rural département), the two national reference rows,
// four EPCI including the `XX` placeholder that carries the file's most
// damaging value, and three communes including a Marseille arrondissement.
// A synthetic fixture would have none of those and would pass regardless.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PE_BANDS,
  PE_BAND_RATIOS,
  PE_MODES,
  PE_SCALES,
  PE_YEAR_FLOOR,
  dominantMode,
  isPlaceholderArea,
  newestYear,
  peBand,
  peScaleSpec,
  peYearWhere,
  placePeAreas,
  projectPeAreas,
  projectPeTerritoires,
  peArrondissementParent,
  peContourUrls,
  peTerritoiresInBox,
  ringBox,
  readNational,
  PE_ARRONDISSEMENT_PARENTS,
} from './petiteEnfanceFeed.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const DEP = load('cnaf-petite-enfance-dep-sample.json');
const EPCI = load('cnaf-petite-enfance-epci-sample.json');
const COM = load('cnaf-petite-enfance-com-sample.json');
const NAT = load('cnaf-petite-enfance-nat-sample.json');
const COM_75 = load('geoapi-communes-75-epci-sample.json');
const ARR_75 = load('geoapi-arrondissements-75-sample.json');

const NATIONAL_2023 = 60.9;

const projectDep = (over = {}) => projectPeAreas({
  scale: 'dep', taux: DEP.txcouv, places: DEP.nbpla, national: NATIONAL_2023, year: 2023, ...over,
});

test('the fixtures are the real files, not hand-made stand-ins', () => {
  assert.equal(DEP.txcouv.length, 6);
  assert.equal(NAT.length, 2);
  // Pin the awkwardness itself, so a regenerated fixture cannot quietly drop it.
  assert.ok(DEP.txcouv.some((r) => r.numdep === '2A'), 'no Corsican spelling');
  assert.ok(DEP.txcouv.some((r) => r.numdep === '973'), 'no overseas row');
  assert.ok(DEP.txcouv.some((r) => r.numdep === '85' && r.txcouv_dep === 85.7), 'no national maximum');
  assert.ok(EPCI.txcouv.some((r) => r.numepci === 'XX'), 'no XX placeholder');
  assert.ok(COM.txcouv.some((r) => r.numcom === '13201'), 'no municipal arrondissement');
  // The `annee` type really does differ between the two files.
  assert.equal(typeof DEP.txcouv[0].annee, 'number');
  assert.equal(typeof NAT[0].annee, 'string');
});

// --- The national reference -------------------------------------------------

test('the national row is read whole, because its `annee` is a date', () => {
  // Six files publish `annee` as an int and this one as a date; a
  // `where=annee=2023` clause answers HTTP 400 against it, so the two rows are
  // fetched whole and filtered here.
  const nat = readNational(NAT, 2023);
  assert.equal(nat.year, 2023);
  assert.equal(nat.rate, NATIONAL_2023);
  // The perimeter is carried verbatim, not paraphrased: the national rate this
  // layer compares every area against excludes a département the départemental
  // file also omits.
  assert.match(nat.perimeter, /HORS MAYOTTE/);
  assert.equal(readNational(NAT, 2022).rate, 59.5);
  assert.equal(readNational(NAT, 1999), null);
  assert.equal(readNational(null, 2023), null);
});

test('the published components sum to the published total, to within rounding', () => {
  // Every rate is published to 0,1 so the five leaves cannot be trusted to add
  // up exactly — but they must not drift either, and the global figure is
  // never recomputed from them.
  const nat = readNational(NAT, 2023);
  const sum = PE_MODES.reduce((total, mode) => total + nat.modes[mode], 0);
  assert.ok(Math.abs(sum - nat.rate) <= 0.15, `${sum} vs ${nat.rate}`);
});

test('the newest year is discovered and never walks backwards', () => {
  assert.equal(newestYear([{ annee: 2024 }, { annee: 2023 }]), 2024);
  // An answer older than the floor is malformed, not a new fact.
  assert.equal(newestYear([{ annee: 2019 }]), PE_YEAR_FLOOR);
  // The same helper has to read both column types.
  assert.equal(newestYear([{ annee: '2025-01-01T00:00:00+00:00' }]), 2025);
  assert.equal(newestYear(null), PE_YEAR_FLOOR);
  assert.equal(newestYear([{ annee: 'toutes' }]), PE_YEAR_FLOOR);
  assert.equal(peYearWhere(2023), 'annee=2023');
});

// --- The placeholder rows ---------------------------------------------------

test('an all-X row is a placeholder, however many X it has', () => {
  // The EPCI rate file spells it `XX` and the département PLACES file spells
  // it `XXX`. Pinning either literal catches one and lets the other through.
  assert.equal(isPlaceholderArea('XX', 'XX'), true);
  assert.equal(isPlaceholderArea('XXX', 'XXX'), true);
  assert.equal(isPlaceholderArea('xx', 'quelque chose'), true);
  assert.equal(isPlaceholderArea('', ''), true);
  assert.equal(isPlaceholderArea(null, null), true);
  // A real code that merely contains an X is not a placeholder.
  assert.equal(isPlaceholderArea('2A', 'CORSE DU SUD'), false);
  assert.equal(isPlaceholderArea('200070555', 'CC DE LA VEYLE'), false);
});

test('the XX row is dropped, and dropping it is what fixes the scale', () => {
  // Left in, it is the file's maximum (195,8) and it is drawn nowhere, so it
  // would anchor the ramp from off-map. This is the single most damaging row
  // in the layer.
  const out = projectPeAreas({
    scale: 'epci', taux: EPCI.txcouv, places: EPCI.nbpla, national: NATIONAL_2023, year: 2023,
  });
  assert.equal(out.dropped, 1);
  assert.equal(out.areas.length, EPCI.txcouv.length - 1);
  assert.equal(out.areas.some((a) => a.code === 'XX'), false);
  const max = Math.max(...out.areas.map((a) => a.rate));
  assert.ok(max < 195.8, `the placeholder is still the maximum: ${max}`);
});

// --- Bands ------------------------------------------------------------------

test('a band is a ratio to the national rate, not a quantile', () => {
  // This layer paints three nested scales; a quantile band would mean "the top
  // sixth of what is on screen", so an area would change colour on zoom
  // without anything about it changing.
  assert.equal(peBand(60.9, 60.9), 'sur-moyenne');
  assert.equal(peBand(60.8, 60.9), 'sous-moyenne');
  assert.equal(peBand(13.4, 60.9), 'tres-bas');
  assert.equal(peBand(85.7, 60.9), 'tres-haut');
  // The break falls exactly where the ratio crosses 1, both sides.
  assert.equal(peBand(1.0 * 60.9, 60.9), 'sur-moyenne');
  assert.equal(peBand(0.999 * 60.9, 60.9), 'sous-moyenne');
  // Thresholds are ratios, so the same rate bands differently under a
  // different edition's national figure — which is the point.
  assert.equal(peBand(60.9, 59.5), 'sur-moyenne');
});

test('an unrated or unreferenced area gets no band, never the bottom one', () => {
  // Both ends of a diverging ramp are strong claims. Defaulting to either
  // would be the worst possible failure mode.
  assert.equal(peBand(null, 60.9), null);
  assert.equal(peBand(50, null), null);
  assert.equal(peBand(50, 0), null);
  assert.equal(peBand('abc', 60.9), null);
  assert.equal(PE_BAND_RATIOS.length, PE_BANDS.length - 1);
  for (let i = 1; i < PE_BAND_RATIOS.length; i += 1) {
    assert.ok(PE_BAND_RATIOS[i] > PE_BAND_RATIOS[i - 1]);
  }
});

// --- The projection ---------------------------------------------------------

test('every scale is read by the same parameterised reader', () => {
  for (const scale of PE_SCALES) {
    const spec = peScaleSpec(scale);
    assert.ok(spec.taux.startsWith('txcouv_pe_'));
    assert.ok(spec.places.startsWith('nbpla_pe_'));
    assert.ok(spec.code && spec.name && spec.suffix);
  }
  assert.equal(peScaleSpec('nope'), null);
});

test('rates and places are joined on the area code', () => {
  const out = projectDep();
  assert.equal(out.areas.length, 6);
  const vendee = out.areas.find((a) => a.code === '85');
  assert.equal(vendee.rate, 85.7);
  assert.equal(vendee.band, 'tres-haut');
  assert.equal(vendee.ratio, 1.407);
  assert.ok(vendee.totalPlaces > 0);
  // Every leaf carries both its rate and its places, from two different files.
  for (const mode of PE_MODES) {
    assert.equal(typeof vendee.modes[mode], 'number');
    assert.equal(typeof vendee.places[mode], 'number');
  }
});

test('losing the places file costs sizes, never rates', () => {
  const out = projectDep({ places: null });
  assert.equal(out.areas.length, 6);
  for (const area of out.areas) {
    assert.ok(Number.isFinite(area.rate), 'the rate is the layer');
    assert.equal(area.places, null);
    assert.equal(area.totalPlaces, null);
    assert.ok(area.band);
  }
});

test('the dominant mode is the file’s second finding, and it is computed', () => {
  const out = projectDep();
  // The Vendée's 85,7 is not crèches: it is 64,9 of assistante maternelle.
  assert.equal(out.areas.find((a) => a.code === '85').dominant, 'am');
  // Paris is the other way round, which is the whole urban/rural split.
  assert.equal(out.areas.find((a) => a.code === '75').dominant, 'psu');
  // Ties resolve toward collective care — the reading a parent looking for a
  // crèche place means.
  assert.equal(dominantMode({ psu: 10, am: 10 }), 'psu');
  assert.equal(dominantMode({ psu: 0, am: 0 }), null);
  assert.equal(dominantMode(null), null);
});

test('areas arrive sorted by rate, so a truncated draw keeps the extremes', () => {
  const out = projectDep();
  for (let i = 1; i < out.areas.length; i += 1) {
    assert.ok((out.areas[i - 1].rate ?? -1) >= (out.areas[i].rate ?? -1));
  }
  assert.equal(out.areas[0].code, '85');
  assert.equal(out.areas.at(-1).code, '973');
});

test('the band tally counts every banded area exactly once', () => {
  const out = projectDep();
  const banded = out.areas.filter((a) => a.band).length;
  assert.equal(PE_BANDS.reduce((t, b) => t + out.bands[b], 0), banded);
});

test('an empty or malformed input is an empty projection, not a throw', () => {
  for (const taux of [[], null, undefined, 'nope', [null, 42]]) {
    const out = projectPeAreas({ scale: 'dep', taux, national: 60.9 });
    assert.deepEqual(out.areas, []);
  }
  assert.deepEqual(projectPeAreas({ scale: 'nope', taux: DEP.txcouv }).areas, []);
  assert.deepEqual(projectPeAreas().areas, []);
});

// --- Placement --------------------------------------------------------------

test('an area with no centroid keeps its card and is counted, not dropped', () => {
  const out = projectDep();
  const centroids = new Map([['85', { lat: 46.7, lon: -1.4, population: 685442 }]]);
  const { placed, unplaced } = placePeAreas(out.areas, centroids);
  assert.equal(placed.length, 1);
  assert.equal(unplaced, out.areas.length - 1);
  assert.equal(placed[0].id, 'dep:85');
  assert.equal(placed[0].population, 685442);
  assert.equal(placed[0].rate, 85.7);
});

test('placement never invents a coordinate', () => {
  const out = projectDep();
  const bad = new Map([
    ['85', { lat: null, lon: -1.4 }],
    ['75', { lat: 'x', lon: 2.3 }],
  ]);
  const { placed, unplaced } = placePeAreas(out.areas, bad);
  assert.equal(placed.length, 0);
  assert.equal(unplaced, out.areas.length);
  assert.deepEqual(placePeAreas(null, bad).placed, []);
});

test('a commune id cannot collide with an EPCI id', () => {
  // Both are INSEE codes from different namespaces and both end up in one
  // point collection, so the scale is part of the identity.
  const com = placePeAreas([{ scale: 'com', code: '13201' }], new Map([['13201', { lat: 43.3, lon: 5.38 }]]));
  const epci = placePeAreas([{ scale: 'epci', code: '13201' }], new Map([['13201', { lat: 43.3, lon: 5.38 }]]));
  assert.equal(com.placed[0].id, 'com:13201');
  assert.equal(epci.placed[0].id, 'epci:13201');
  assert.notEqual(com.placed[0].id, epci.placed[0].id);
});

test('a coverage rate above 100 is a fact, and is not clamped', () => {
  // It counts PLACES per 100 resident children, so a commuter town or a tiny
  // denominator legitimately passes 100. Four EPCI do.
  const out = projectPeAreas({
    scale: 'com', taux: COM.txcouv, places: COM.nbpla, national: NATIONAL_2023, year: 2023,
  });
  const garches = out.areas.find((a) => a.code === '92033');
  assert.ok(garches.rate > 100, `${garches.rate}`);
  assert.equal(garches.band, 'tres-haut');
  // And the arrondissement scale really is read — the CNAF breaks Paris, Lyon
  // and Marseille down below the commune, and geo.api.gouv.fr omits those by
  // default, so losing them loses the three biggest cities in France.
  // Marseille's 1st arrondissement lands at 34,4 — 56% of the national rate,
  // the lowest band on the ramp. No metropolitan DÉPARTEMENT reaches that
  // band, which is exactly why the finer scales are worth drawing.
  const marseille = out.areas.find((a) => a.code === '13201');
  assert.equal(marseille.rate, 34.4);
  assert.equal(marseille.band, 'tres-bas');
});

test('an area whose rate the CNAF does not publish is unbanded, not worst-in-France', () => {
  // `Number(null)` is 0. A plain coercion would paint a silent area as the
  // worst place in the country to find a childcare place.
  const out = projectPeAreas({
    scale: 'dep',
    taux: [{ numdep: '99', nomdep: 'SANS TAUX', txcouv_dep: null }],
    national: NATIONAL_2023,
  });
  assert.equal(out.areas.length, 1);
  assert.equal(out.areas[0].rate, null);
  assert.equal(out.areas[0].band, null);
  assert.equal(out.areas[0].ratio, null);
  assert.equal(PE_BANDS.reduce((t, b) => t + out.bands[b], 0), 0);
});

// --- The territories --------------------------------------------------------

test('one département needs one call, and Paris needs two', () => {
  const plain = peContourUrls('01');
  assert.match(plain.communes, /departements\/01\/communes\?/);
  assert.match(plain.communes, /geometry=contour/);
  // `codeEpci` is what makes the EPCI scale drawable without a second request:
  // geo.api.gouv.fr publishes no EPCI contour at all.
  assert.match(plain.communes, /fields=code,nom,population,codeEpci/);
  assert.equal(plain.arrondissements, null);

  for (const dep of ['75', '69', '13']) {
    const split = peContourUrls(dep);
    assert.match(split.arrondissements, /type=arrondissement-municipal/);
    assert.match(split.arrondissements, new RegExp(`codeDepartement=${dep}`));
    assert.equal(peArrondissementParent(dep), PE_ARRONDISSEMENT_PARENTS[dep]);
  }
  assert.equal(peArrondissementParent('01'), null);
  // A code the API would refuse never leaves this process.
  for (const bad of ['', '9', '999', '../etc', '75056', null]) {
    assert.throws(() => peContourUrls(bad), /invalid département code/);
  }
});

test('an arrondissement inherits the EPCI its parent carries', () => {
  // geo.api.gouv.fr sends `codeEpci` with a commune and NOT with an
  // arrondissement — verified on the fixtures themselves, which is why this
  // has to be lent rather than read.
  assert.equal(ARR_75.features.every((f) => f.properties.codeEpci === undefined), true);

  const pack = projectPeTerritoires({
    communes: COM_75, arrondissements: ARR_75, departement: '75',
  });
  const byCode = new Map(pack.communes.map((row) => [row.c, row]));
  assert.equal(pack.arrondissements, 2);
  assert.equal(byCode.get('75056').e, '200054781');
  assert.equal(byCode.get('75101').e, '200054781');
  // Both grains travel, each marked, and neither can be drawn without knowing
  // the other exists: `x` says "subdivided here", `a` names the parent.
  assert.equal(byCode.get('75056').x, 1);
  assert.equal(byCode.get('75101').a, '75056');
  assert.equal(byCode.get('75056').a, undefined);
});

test('a département with no arrondissements is one plain pass', () => {
  const pack = projectPeTerritoires({ communes: COM_75, departement: '01' });
  assert.equal(pack.arrondissements, 0);
  assert.equal(pack.departement, '01');
  // Nothing is marked as subdivided when nothing subdivides it.
  assert.equal(pack.communes.every((row) => !row.a && !row.x), true);
  // The simplification is reported rather than hidden: the fixture's ring is
  // already under the ceiling, so nothing was decimated here.
  assert.equal(pack.simplified, 0);
  assert.ok(pack.vertices > 0);
});

test('a failed arrondissement call costs the finer grain, never the map', () => {
  // The parent commune is already in hand, so Paris keeps its EPCI ground.
  const pack = projectPeTerritoires({
    communes: COM_75, arrondissements: null, departement: '75',
  });
  assert.equal(pack.arrondissements, 0);
  assert.equal(pack.communes.length, 1);
  assert.equal(pack.communes[0].x, undefined);
  assert.deepEqual(projectPeTerritoires().communes, []);
});

test('a box answer carries the communes a view can see and nothing else', () => {
  const pack = projectPeTerritoires({
    communes: COM_75, arrondissements: ARR_75, departement: '75',
  });
  // The bounding boxes ride ALONGSIDE the rows, never on them: they exist to
  // cut the answer and the browser never reads one.
  assert.equal(pack.bboxes.length, pack.communes.length);
  assert.equal(pack.communes.every((row) => row.b === undefined), true);

  const inside = peTerritoiresInBox({
    packs: [pack],
    box: {
      south: 48.8, west: 2.3, north: 48.88, east: 2.36,
    },
  });
  assert.equal(inside.communes.length > 0, true);
  assert.deepEqual(inside.departements, ['75']);
  assert.equal(inside.dropped, 0);
  assert.ok(inside.vertices > 0);

  // A box over the Atlantic answers nothing rather than everything.
  const away = peTerritoiresInBox({
    packs: [pack],
    box: {
      south: 46, west: -6, north: 47, east: -5,
    },
  });
  assert.deepEqual(away.communes, []);
  assert.deepEqual(away.departements, []);
  assert.deepEqual(peTerritoiresInBox().communes, []);
  assert.deepEqual(peTerritoiresInBox({ packs: [pack], box: null }).communes, []);
});

test('a capped box keeps the middle of the view and says what it dropped', () => {
  const pack = projectPeTerritoires({
    communes: COM_75, arrondissements: ARR_75, departement: '75',
  });
  const box = {
    south: 48.8, west: 2.25, north: 48.9, east: 2.42,
  };
  const full = peTerritoiresInBox({ packs: [pack], box });
  const capped = peTerritoiresInBox({ packs: [pack], box, limit: 1 });
  assert.equal(capped.communes.length, 1);
  assert.equal(capped.dropped, full.communes.length - 1);
  // What survives is the shape nearest the CENTRE of the view — a truncated
  // answer is complete where the operator is looking and thin at the margins.
  const centre = ringBox(capped.communes[0].p[0]);
  assert.ok(Math.abs((centre[0] + centre[2]) / 2 - (box.west + box.east) / 2) < 0.05);
});

test('a ring box is the ring, not a guess at it', () => {
  assert.deepEqual(ringBox([1, 2, 3, 4, 0, 9]), [0, 2, 3, 9]);
  assert.equal(ringBox([1]), null);
  assert.equal(ringBox(null), null);
});
