// The rendering decisions: what a colour claims, which ground a number covers,
// and what the cards have to say that neither channel can.
//
// The recurring property under test is that this layer paints THREE nested
// scales with one ramp. A colour must therefore mean the same thing at every
// zoom, the three scales must never paint the same ground twice, and a card
// must name which of the areas under the cursor it is reporting.
import test from 'node:test';
import assert from 'node:assert/strict';

import petiteEnfanceFranceLayer, {
  PE_FR_LABEL_COHORT_LIMIT,
  PE_FR_LAYER_ID,
  buildPeDepartementLabel,
  buildPeLoadingLabel,
  buildPeSelectionLabel,
  cameraPeBox,
  createPeDepartementOverlayEntry,
  peBandAlpha,
  peBandColor,
  peBandLabel,
  peBandRangeLabels,
  peTerritoryAlpha,
  peViewSpanDeg,
  buildPeTerritoryRecords,
  indexPeAreas,
  selectPeLabelCohort,
  COMMUNE_SPAN_DEG,
  NATIONAL_ENTER_SPAN_DEG,
  NATIONAL_EXIT_SPAN_DEG,
  peContourBox,
  _clearPeSelectionForTest,
  _peRowControlsForTest,
  _setPeStateForTest,
} from './petiteEnfanceFrance.js';
import { PE_BANDS, PE_BOX_STEP_DEG } from './petiteEnfanceFeed.js';
import { schoolLevelColor } from './schoolsFrance.js';
import { SCHOOL_LEVELS } from './schoolsFeed.js';

const norm = (value) => String(value).replace(/[\s  ]+/g, ' ');

const area = (over = {}) => ({
  id: 'epci:200070555',
  scale: 'epci',
  code: '200070555',
  name: 'CC DE LA VEYLE',
  rate: 89.7,
  band: 'haut',
  ratio: 1.473,
  modes: {
    psu: 6.2, horsPsu: 3.1, prescol: 4.4, am: 74.2, gad: 1.8,
  },
  subtotals: { collectif: 9.3, individuel: 76 },
  dominant: 'am',
  places: {
    psu: 60, horsPsu: 30, prescol: 42, am: 715, gad: 17,
  },
  totalPlaces: 864,
  deptName: 'AIN',
  region: 'AUVERGNE RHONE ALPES',
  lat: 46.2,
  lon: 4.98,
  ...over,
});

const record = (over = {}) => ({
  id: 'epci:200070555', area: area(over.area), national: 60.9, year: 2023, ...over,
});

test.afterEach(() => { _clearPeSelectionForTest(); });

// --- Colour -----------------------------------------------------------------

test('every band has its own colour and the ramp diverges at the midpoint', () => {
  const seen = new Set();
  for (const band of PE_BANDS) {
    const color = peBandColor(band);
    assert.match(color, /^#[0-9a-f]{6}$/i);
    assert.equal(seen.has(color), false, `${band} reuses a colour`);
    seen.add(color);
  }
  assert.equal(seen.size, 6);
  // Below France is warm, above is cool, and the break falls between index 2
  // and 3 where the ratio crosses 1 — that is the whole point of the ramp.
  const warm = ['tres-bas', 'bas', 'sous-moyenne'].map(peBandColor);
  const cool = ['sur-moyenne', 'haut', 'tres-haut'].map(peBandColor);
  const red = (hex) => parseInt(hex.slice(1, 3), 16);
  const blue = (hex) => parseInt(hex.slice(5, 7), 16);
  for (const hex of warm) assert.ok(red(hex) > blue(hex), `${hex} should read warm`);
  for (const hex of cool) assert.ok(blue(hex) > red(hex), `${hex} should read cool`);
});

test('an area with no published rate gets no fill at all', () => {
  // Both ends of a diverging ramp are strong claims, so absence must not fall
  // back to either one.
  assert.equal(peBandColor(null), null);
  assert.equal(peBandColor('inconnu'), null);
  assert.equal(peBandAlpha(null), 0);
  assert.match(peBandLabel(null), /non publié/);
});

test('the ramp is heavier at BOTH ends, not just the top', () => {
  assert.ok(peBandAlpha('tres-bas') > peBandAlpha('sous-moyenne'));
  assert.ok(peBandAlpha('tres-haut') > peBandAlpha('sur-moyenne'));
  assert.equal(peBandAlpha('tres-bas'), peBandAlpha('tres-haut'));
});

test('the ramp shares no colour with the schools ladder', () => {
  // Both layers are French, both are about education, and an operator can have
  // both on. There is also no green anywhere here, so this map cannot be read
  // as Vigilance.
  const schools = new Set(SCHOOL_LEVELS.map(schoolLevelColor));
  for (const band of PE_BANDS) {
    assert.equal(schools.has(peBandColor(band)), false, `${band} collides with schools-fr`);
  }
});

test('legend ranges are derived from the national rate, not typed in', () => {
  // So the legend and the colours cannot disagree, and so the numbers move
  // with the national figure between editions instead of going stale.
  const labels = peBandRangeLabels(60.9);
  assert.equal(labels.length, 6);
  assert.equal(labels[0], '< 37');
  assert.match(labels.at(-1), /^> 85$/);
  // A different edition shifts every boundary.
  assert.notEqual(peBandRangeLabels(59.5)[0], labels[0]);
  // With no reference at all it falls back to percentages rather than lying.
  assert.match(peBandRangeLabels(null)[0], /%/);
});

// --- The fill weight --------------------------------------------------------

test('a territory fill is lighter than the choropleth but keeps its ramp', () => {
  // The département fill is read from 500 km up with nothing under it; an EPCI
  // fill sits over streets. Same ordering, less lid.
  for (const band of PE_BANDS) {
    assert.ok(peTerritoryAlpha(band) < peBandAlpha(band), band);
    assert.ok(peTerritoryAlpha(band) > 0.2, band);
  }
  // The extremes still carry more weight than the middle, both ways round.
  assert.ok(peTerritoryAlpha('tres-bas') > peTerritoryAlpha('sous-moyenne'));
  assert.ok(peTerritoryAlpha('tres-haut') > peTerritoryAlpha('sur-moyenne'));
  // A band that does not exist has no fill at all rather than a default one.
  assert.equal(peTerritoryAlpha(null), 0);
  assert.equal(peTerritoryAlpha('invented'), 0);
});

// --- The territories --------------------------------------------------------

const ring = (lon, lat) => [lon, lat, lon + 0.1, lat, lon + 0.1, lat + 0.1, lon, lat + 0.1];

/** Two communes of one EPCI, one of which the CNAF also publishes on its own. */
const PACK = {
  departement: '01',
  communes: [
    { c: '01001', n: 'Aulnay', e: '200070555', p: [ring(4.9, 46.1)] },
    { c: '01002', n: 'Ville', e: '200070555', p: [ring(5.0, 46.1)], s: 1 },
  ],
};

const AREAS = [
  area(),
  area({
    id: 'com:01002', scale: 'com', code: '01002', name: 'Ville', band: 'bas',
  }),
];

test('above the commune span the whole EPCI is one wash', () => {
  const built = buildPeTerritoryRecords({ packs: [PACK], areas: AREAS, withCommunes: false });
  assert.equal(built.records.length, 1);
  assert.equal(built.epci, 1);
  assert.equal(built.communes, 0);
  // Both member communes, under ONE colour and one record — an EPCI has no
  // contour of its own, so its territory IS its members.
  assert.equal(built.records[0].parts.length, 2);
  assert.equal(built.records[0].color, peBandColor('haut'));
});

test('below it the published commune is CUT OUT of its own EPCI', () => {
  const built = buildPeTerritoryRecords({ packs: [PACK], areas: AREAS, withCommunes: true });
  assert.equal(built.records.length, 2);
  assert.equal(built.epci, 1);
  assert.equal(built.communes, 1);
  const byId = new Map(built.records.map((r) => [r.id, r]));
  // The EPCI keeps only the commune the CNAF does NOT break out. The two fills
  // never overlap, so two translucent colours can never blend into a third.
  assert.equal(byId.get('epci:200070555').parts.length, 1);
  assert.equal(byId.get('com:01002').parts.length, 1);
  assert.equal(byId.get('com:01002').color, peBandColor('bas'));
  // The simplification travels with the shape it happened to.
  assert.equal(byId.get('com:01002').simplified, true);
  assert.equal(byId.get('epci:200070555').simplified, false);
});

test('an arrondissement replaces its parent commune, never doubles it', () => {
  // The CNAF publishes Paris by arrondissement; geo.api.gouv.fr publishes it
  // as ONE polygon. Drawing both would paint the same ground twice.
  const paris = {
    departement: '75',
    communes: [
      { c: '75056', n: 'Paris', e: '200054781', p: [ring(2.3, 48.85)], x: 1 },
      { c: '75101', n: 'Paris 1er', e: '200054781', p: [ring(2.33, 48.86)], a: '75056' },
      { c: '75102', n: 'Paris 2e', e: '200054781', p: [ring(2.34, 48.87)], a: '75056' },
    ],
  };
  const areas = [
    area({ id: 'epci:200054781', code: '200054781', name: 'MGP' }),
    area({
      id: 'com:75101', scale: 'com', code: '75101', name: 'Paris 1er', band: 'bas',
    }),
  ];
  const built = buildPeTerritoryRecords({ packs: [paris], areas, withCommunes: true });
  const byId = new Map(built.records.map((r) => [r.id, r]));
  assert.equal(byId.has('com:75101'), true);
  // The parent is gone entirely — not drawn under its own arrondissements.
  assert.equal(byId.get('epci:200054781').parts.length, 1);
  // …and the arrondissement the CNAF did not publish is the one that is left,
  // as EPCI ground rather than as a hole. That is why the pack carries the
  // parent's `codeEpci` on it.
  assert.deepEqual(byId.get('epci:200054781').parts[0], ring(2.34, 48.87));

  // Above the commune span nothing is subdivided: the parent draws, the
  // arrondissements do not, and the ground is covered exactly once.
  const wide = buildPeTerritoryRecords({ packs: [paris], areas, withCommunes: false });
  assert.equal(wide.records.length, 1);
  assert.deepEqual(wide.records[0].parts, [ring(2.3, 48.85)]);
});

test('ground with no published rate is left empty and counted, not coloured', () => {
  const built = buildPeTerritoryRecords({
    packs: [{
      departement: '01',
      communes: [
        { c: '01001', n: 'Aulnay', e: '200070555', p: [ring(4.9, 46.1)] },
        // An EPCI the CNAF row set does not carry at all.
        { c: '01003', n: 'Ailleurs', e: '999999999', p: [ring(5.2, 46.1)] },
        // …and one whose rate was never published: both ends of a diverging
        // ramp are strong claims, so absence is drawn as absence.
        { c: '01004', n: 'Sansrate', e: '200070556', p: [ring(5.3, 46.1)] },
      ],
    }],
    areas: [area(), area({ id: 'epci:200070556', code: '200070556', band: null })],
  });
  assert.equal(built.records.length, 1);
  assert.equal(built.unmatched, 1);
  assert.equal(built.unrated, 1);
});

test('a territory anchors its card on the shape drawn, not on a centroid', () => {
  const built = buildPeTerritoryRecords({ packs: [PACK], areas: AREAS, withCommunes: false });
  const [lon, lat] = built.records[0].anchor;
  // Inside the rings it was built from — and NOT the area's own `lat`/`lon`,
  // which is the administrative centre the layer stopped drawing.
  assert.ok(lon > 4.9 && lon < 5.2, `lon ${lon}`);
  assert.ok(lat > 46 && lat < 46.3, `lat ${lat}`);
  assert.notEqual(lon, area().lon);
});

test('the same département arriving twice is drawn once', () => {
  const built = buildPeTerritoryRecords({ packs: [PACK, PACK], areas: AREAS, withCommunes: true });
  assert.equal(built.records.length, 2);
  assert.equal(built.records[0].parts.length, 1);
});

test('the run-away guard drops territories rather than the frame rate', () => {
  const built = buildPeTerritoryRecords({
    packs: [PACK], areas: AREAS, withCommunes: true, limit: 1,
  });
  assert.equal(built.records.length, 1);
  assert.equal(built.unmatched, 1);
});

test('an empty or malformed input paints nothing and throws nothing', () => {
  for (const input of [undefined, {}, { packs: null, areas: null }, { packs: [null], areas: [] }]) {
    assert.deepEqual(buildPeTerritoryRecords(input).records, []);
  }
  assert.equal(indexPeAreas(null).size, 0);
  assert.equal(indexPeAreas([{ noId: true }]).size, 0);
});

test('the regimes hand over with hysteresis, and the commune grain is inside', () => {
  // A camera resting on the boundary must not swap the whole map back and
  // forth on sub-pixel drift.
  assert.ok(NATIONAL_EXIT_SPAN_DEG < NATIONAL_ENTER_SPAN_DEG);
  // The commune grain turns on strictly INSIDE the local regime: it is a
  // detail of a view that is already drawing territories.
  assert.ok(COMMUNE_SPAN_DEG < NATIONAL_EXIT_SPAN_DEG);
});

// --- The selection card -----------------------------------------------------

test('the card names the SCALE first, because three of them are nested', () => {
  const lines = buildPeSelectionLabel(record()).split('\n');
  assert.equal(lines[0], 'CC DE LA VEYLE');
  assert.match(lines[1], /Intercommunalité/);
  assert.match(lines[1], /millésime 2023/);
});

test('the card states the rate AND how it compares with France', () => {
  const copy = buildPeSelectionLabel(record());
  assert.match(norm(copy), /89,7 places pour 100 enfants/);
  assert.match(norm(copy), /47 % au-dessus de la moyenne nationale \(60,9\)/);
  const low = buildPeSelectionLabel(record({ area: area({ rate: 30.5, band: 'bas' }) }));
  assert.match(norm(low), /en dessous de la moyenne/);
});

test('an area with no published rate says so instead of printing a number', () => {
  const copy = buildPeSelectionLabel(record({ area: area({ rate: null, band: null }) }));
  assert.match(copy, /Taux non publié/);
  assert.equal(/places pour 100 enfants/.test(copy), false);
});

test('the card lists the five leaf modes, largest first, never the subtotals', () => {
  // The CNAF also publishes `eaje` and `ind`, which are sums of these. Listing
  // both would make the same children appear twice to a reader adding up.
  const copy = buildPeSelectionLabel(record());
  const lines = copy.split('\n').filter((line) => /\d,\d/.test(line) && line.includes(' : '));
  assert.equal(lines.length, 5);
  assert.match(lines[0], /Assistante maternelle : 74,2/);
  assert.match(lines[0], /715 places/);
  // The subtotal 76,0 for accueil individuel must not appear as its own line.
  assert.equal(/^Accueil individuel/m.test(copy), false);
});

test('a mode the area does not offer is omitted, not printed as zero', () => {
  const copy = buildPeSelectionLabel(record({
    area: area({ modes: { psu: 0, horsPsu: 0, prescol: 2.4, am: 153.9, gad: 0 } }),
  }));
  assert.equal(/Crèche \(EAJE financé PSU\)/.test(copy), false);
  assert.match(copy, /Préscolarisation/);
});

test('the commune scale carries its own coverage warning', () => {
  // It exists only above 10 000 inhabitants — 1 061 of ~34 875 communes — and
  // a reader looking at one dot must not read it as a complete map.
  const copy = buildPeSelectionLabel(record({ area: area({ scale: 'com', code: '13201' }) }));
  assert.match(copy, /⚠/);
  assert.match(copy, /plus de 10 000 habitants/);
  // And the EPCI card says how its territory was drawn, because no EPCI
  // contour is published anywhere.
  assert.match(buildPeSelectionLabel(record()), /communes membres/);
  // A decimated outline says so on the card that hangs off it.
  assert.match(buildPeSelectionLabel(record({ simplified: true })), /Contour communal simplifié/);
  assert.equal(/Contour communal simplifié/.test(buildPeSelectionLabel(record())), false);
});

test('the card never throws on a missing or empty record', () => {
  assert.doesNotThrow(() => buildPeSelectionLabel(undefined));
  assert.doesNotThrow(() => buildPeSelectionLabel({}));
  assert.doesNotThrow(() => buildPeSelectionLabel({ area: {} }));
});

// --- The département card ---------------------------------------------------

test('the département card reads like the area card', () => {
  const copy = buildPeDepartementLabel({
    code: '85',
    name: 'VENDEE',
    rate: 85.7,
    band: 'tres-haut',
    modes: {
      psu: 8.6, horsPsu: 5, prescol: 6.3, am: 64.9, gad: 0.9,
    },
    places: {
      psu: 1504, horsPsu: 880, prescol: 1106, am: 11355, gad: 153,
    },
    totalPlaces: 14998,
    dominant: 'am',
    region: 'PAYS DE LA LOIRE',
  }, 60.9);
  assert.equal(copy.split('\n')[0], 'VENDEE');
  assert.match(norm(copy), /85,7 places pour 100 enfants/);
  assert.match(norm(copy), /14 998 places/);
  assert.match(norm(copy), /Mode dominant : assistante maternelle/);
  assert.match(copy, /PAYS DE LA LOIRE/);
});

// --- The ambient label cohort ----------------------------------------------

test('the cohort keeps the most EXTREME départements, both directions', () => {
  // A diverging ramp whose labels all sat at one end would report half the
  // finding.
  const entries = [
    createPeDepartementOverlayEntry({ code: '1', name: 'moyen', rate: 61, ratio: 1.0, band: 'sur-moyenne' }, { anchor: [1, 1] }),
    createPeDepartementOverlayEntry({ code: '2', name: 'très bas', rate: 13, ratio: 0.22, band: 'tres-bas' }, { anchor: [1, 1] }),
    createPeDepartementOverlayEntry({ code: '3', name: 'très haut', rate: 86, ratio: 1.41, band: 'tres-haut' }, { anchor: [1, 1] }),
  ];
  const cohort = selectPeLabelCohort(entries, 2);
  const names = cohort.map((entry) => entry.title.split(' · ')[0]);
  assert.ok(names.includes('très bas'), 'the low extreme must survive');
  assert.ok(names.includes('très haut'), 'the high extreme must survive');
  assert.equal(names.includes('moyen'), false);
  assert.equal(selectPeLabelCohort(entries, 999).length, entries.length);
  assert.deepEqual(selectPeLabelCohort(null), []);
});

test('a département label carries its rate and its own band colour', () => {
  const entry = createPeDepartementOverlayEntry(
    { code: '85', name: 'VENDEE', rate: 85.7, ratio: 1.407, band: 'tres-haut' },
    { anchor: [-1.4, 46.7] },
  );
  assert.equal(norm(entry.title), 'VENDEE · 85,7');
  assert.equal(entry.accent, peBandColor('tres-haut'));
  assert.equal(entry.id, 'petite-enfance-fr:dep:85');
});

// --- The view box -----------------------------------------------------------

test('a camera past the limb reports an infinite span, so the layer stays national', () => {
  assert.equal(peViewSpanDeg({}), Infinity);
  assert.equal(peViewSpanDeg({ camera: { computeViewRectangle: () => null } }), Infinity);
  assert.equal(cameraPeBox({}), null);
  assert.equal(peContourBox({}), null);
});

test('the box asked about is snapped outward, so a pan re-asks rarely', () => {
  const viewer = {
    camera: {
      computeViewRectangle: () => ({
        south: 45.7231 * (Math.PI / 180),
        north: 45.8117 * (Math.PI / 180),
        west: 4.8012 * (Math.PI / 180),
        east: 4.9334 * (Math.PI / 180),
      }),
    },
  };
  const box = peContourBox(viewer);
  // Every edge moved OUTWARD to the grid: a snapped box that cut inside the
  // view would leave a strip of screen with no outlines in it at all.
  assert.ok(box.south <= 45.7231 && box.north >= 45.8117);
  assert.ok(box.west <= 4.8012 && box.east >= 4.9334);
  for (const edge of [box.south, box.north, box.west, box.east]) {
    assert.ok(Math.abs(edge / PE_BOX_STEP_DEG - Math.round(edge / PE_BOX_STEP_DEG)) < 1e-6, `${edge}`);
  }
});

// --- The row legend ---------------------------------------------------------

test('the legend counts what is on screen and drops empty bands', () => {
  _setPeStateForTest({
    regime: 'local',
    pack: { national: 60.9 },
    records: [
      record({ id: 'a', area: area({ band: 'haut' }) }),
      record({ id: 'b', area: area({ band: 'haut' }) }),
      record({ id: 'c', area: area({ band: 'tres-bas' }) }),
    ],
  });
  const { legend } = _peRowControlsForTest();
  assert.equal(legend.length, 2);
  assert.deepEqual(legend.map((row) => row.count), [1, 2]);
  // Ramp order, low to high — never sorted by count.
  assert.equal(legend[0].color, peBandColor('tres-bas'));
  assert.ok(legend.every((row) => row.label.endsWith('places / 100 enfants')));
});

test('the lowest band names the fact that no metropolitan département is in it', () => {
  _setPeStateForTest({
    regime: 'local', pack: { national: 60.9 }, records: [record({ id: 'a', area: area({ band: 'tres-bas' }) })],
  });
  assert.match(_peRowControlsForTest().legend[0].blurb, /outre-mer/);
});

// --- The status line --------------------------------------------------------

test('the national line states the territories the choropleth cannot paint', () => {
  const label = buildPeLoadingLabel({
    regime: 'national',
    status: 'ready',
    loading: false,
    national: {
      painted: 96, national: 60.9, unpainted: new Array(6),
    },
  });
  assert.match(norm(label), /96 départements/);
  assert.match(norm(label), /60,9 places \/ 100 enfants/);
  assert.match(norm(label), /6 territoires ultramarins non cartographiés, tous sous la moyenne/);
});

test('the local line separates the two scales it is drawing', () => {
  const label = buildPeLoadingLabel({
    regime: 'local', status: 'ready', loading: false, count: 40, inView: 40, communes: 12,
  });
  assert.match(norm(label), /28 intercommunalités/);
  assert.match(norm(label), /12 communes/);
  assert.equal(/sans taux publié/.test(label), false);
  assert.equal(/hors plafond/.test(label), false);
});

test('the local line names both silences: unrated ground and the dropped cap', () => {
  const label = buildPeLoadingLabel({
    regime: 'local',
    status: 'ready',
    loading: false,
    count: 40,
    inView: 40,
    communes: 12,
    unpainted: 7,
    dropped: 15,
  });
  assert.match(norm(label), /7 communes sans taux publié/);
  assert.match(norm(label), /15 contours hors plafond/);
});

test('an empty view says so rather than going quiet', () => {
  assert.match(
    buildPeLoadingLabel({
      regime: 'local', status: 'empty', loading: false, count: 0, inView: 0,
    }),
    /aucune zone/,
  );
});

test('an errored layer prints no count line at all', () => {
  for (const regime of ['local', 'national']) {
    assert.equal(buildPeLoadingLabel({ regime, status: 'error', loading: false }), '');
  }
});

// --- The layer contract -----------------------------------------------------

test('the layer id matches the one every registry was wired with', () => {
  assert.equal(PE_FR_LAYER_ID, 'petite-enfance-fr');
  assert.equal(petiteEnfanceFranceLayer.id, 'petite-enfance-fr');
});

test('the layer exposes the lifecycle the data manager calls', () => {
  for (const method of ['init', 'enable', 'disable', 'update', 'destroy', 'getStats', 'getRowControls']) {
    assert.equal(typeof petiteEnfanceFranceLayer[method], 'function', `${method} missing`);
  }
  assert.equal(typeof petiteEnfanceFranceLayer.name, 'string');
  // Published once a year, in January: anything faster re-asks a question
  // whose answer cannot have changed.
  assert.ok(petiteEnfanceFranceLayer.updateInterval >= 60 * 60_000);
});

test('the label cohort ceiling is the one the overlay was sized for', () => {
  assert.equal(PE_FR_LABEL_COHORT_LIMIT, 14);
});
