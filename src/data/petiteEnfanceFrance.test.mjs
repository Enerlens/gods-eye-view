// The rendering decisions: what a colour claims, what a dot's size claims, and
// what the cards have to say that neither channel can.
//
// The recurring property under test is that this layer paints THREE nested
// scales with one ramp. A colour must therefore mean the same thing at every
// zoom, a nested pair of dots must stay tellable apart, and a card must name
// which of the three areas under the cursor it is reporting.
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
  peAreaInBox,
  peBandAlpha,
  peBandColor,
  peBandLabel,
  peBandRangeLabels,
  pePointSize,
  peViewSpanDeg,
  selectPeLabelCohort,
  _clearPeSelectionForTest,
  _peRowControlsForTest,
  _setPeStateForTest,
} from './petiteEnfanceFrance.js';
import { PE_BANDS } from './petiteEnfanceFeed.js';
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

// --- Size -------------------------------------------------------------------

test('more places is a bigger dot, sub-linearly', () => {
  assert.ok(pePointSize(20000) > pePointSize(2000));
  assert.ok(pePointSize(2000) > pePointSize(200));
  assert.ok(pePointSize(20000) / pePointSize(200) < 3);
});

test('a commune dot is always smaller than the EPCI dot it sits inside', () => {
  // At city zoom the two are nested, and if they could tie, a reader could not
  // tell which of the two numbers they were reading.
  for (const places of [0, 100, 1000, 20000, 1e6]) {
    assert.ok(pePointSize(places, 'com') < pePointSize(places, 'epci'), `at ${places}`);
  }
});

test('the size is bounded and never vanishes', () => {
  assert.equal(pePointSize(40000), pePointSize(1e9));
  assert.equal(pePointSize(null), pePointSize(0));
  assert.equal(pePointSize(-5), pePointSize(0));
  assert.ok(pePointSize(0) > 0);
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
  // And the EPCI card says its point is a centre, not a place.
  assert.match(buildPeSelectionLabel(record()), /centre de l’intercommunalité/);
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

test('an area inside the box is drawn, one outside is not, and edges count', () => {
  const box = {
    south: 46, north: 47, west: 4, east: 5,
  };
  assert.equal(peAreaInBox({ lat: 46.5, lon: 4.5 }, box), true);
  assert.equal(peAreaInBox({ lat: 46, lon: 4 }, box), true);
  assert.equal(peAreaInBox({ lat: 45.9, lon: 4.5 }, box), false);
  assert.equal(peAreaInBox({ lat: 46.5, lon: 4.5 }, null), false);
});

test('a camera past the limb reports an infinite span, so the layer stays national', () => {
  assert.equal(peViewSpanDeg({}), Infinity);
  assert.equal(peViewSpanDeg({ camera: { computeViewRectangle: () => null } }), Infinity);
  assert.equal(cameraPeBox({}), null);
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
  assert.equal(/non tracées/.test(label), false);
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
