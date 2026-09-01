// The French charge-point layer's presentation contract.
//
// The property this layer has to keep straight is that it draws INSTALLED
// CAPACITY, not availability: the consolidated IRVE file publishes where the
// charge points are, never whether any of them is free, and an EV map that
// blurs those two is worse than no map. The rest is the usual honesty — a
// power the publisher got wrong is not painted as a power, a count that was
// published twice is reported as both figures, and a viewport too wide to
// answer is refused rather than cropped.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import irveFranceLayer, {
  buildIrveDepartementLabel,
  buildIrveLoadingLabel,
  buildIrveSelectionLabel,
  cameraIrveBox,
  createIrveSelectedOverlayEntry,
  createIrveDepartementOverlayEntry,
  irveBandColor,
  irveBandLabel,
  irveDepartementAlpha,
  irveDepartementBinLabels,
  irveDepartementColor,
  irveSitePointSize,
  selectIrveLabelCohort,
  _clearIrveSelectionForTest,
  _irveDepartementOverlayForTest,
  _irveRowControlsForTest,
  _selectIrveSiteForTest,
  _setIrveStateForTest,
  IRVE_FR_LABEL_COHORT_LIMIT,
  IRVE_FR_OVERLAY_SOURCE_ID,
  IRVE_FR_OVERLAY_SOURCE_OPTIONS,
  IRVE_BEAM_MAX_PX,
  IRVE_BEAM_MIN_PX,
  IRVE_BEAM_SPARSE_COUNT,
  IRVE_BEAM_DENSE_COUNT,
  irveBeamHeightM,
  irveBeamTargetPx,
} from './irveFrance.js';
import { IRVE_BAND_KEYS, IRVE_MAX_BOX_DEG } from './irveFeed.js';

function viewerWithView(degrees) {
  return {
    camera: {
      computeViewRectangle: () => (degrees ? Cesium.Rectangle.fromDegrees(
        degrees.west, degrees.south, degrees.east, degrees.north,
      ) : undefined),
    },
    entities: { remove() {} },
  };
}

/**
 * Normalize every Unicode space to a plain one before matching.
 *
 * `toLocaleString('fr-FR')` groups thousands with U+202F (narrow no-break
 * space), not U+0020, so a regex typed with an ordinary space silently fails
 * against copy that is on screen and correct.
 */
function flat(text) {
  return String(text).replace(/[\u00a0\u202f\u2009]/g, ' ');
}

function siteRecord(overrides = {}) {
  const site = {
    id: '48.89155,2.24202',
    lat: 48.89155,
    lon: 2.24202,
    name: 'QPARK - LA DÉFENSE - CENTRE GRANDE ARCHE',
    commune: 'Courbevoie',
    operators: ['IZIVIA'],
    networks: ['QPARK'],
    duplicateOperators: [],
    pdcPublished: 224,
    pdcDistinct: 224,
    bands: { lente: 219, normale: 5, accelere: 0, rapide: 0, hpc: 0, inconnue: 0 },
    topBand: 'normale',
    peakKW: 22,
    implantation: 'Parking public',
    access: 'Accès libre',
    pmr: 'Accessibilité inconnue',
    connectors: ['type2'],
    free: false,
    coordVerified: true,
    updatedFrom: '2025-11-15',
    updatedTo: '2026-07-30',
    ...overrides,
  };
  return {
    id: site.id,
    site,
    position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat, 12),
    point: { color: null, pixelSize: 0, show: true },
    baseColor: irveBandColor(site.topBand),
    baseSize: irveSitePointSize(site.pdcDistinct),
  };
}

test('the layer identity is registered under the id the registry knows', () => {
  assert.equal(irveFranceLayer.id, 'irve-fr');
  assert.equal(irveFranceLayer.name, 'Bornes IRVE (FR)');
  assert.equal(typeof irveFranceLayer.getRowControls, 'function');
  assert.equal(typeof irveFranceLayer.getDetectableObjects, 'function');
});

test('the poll cadence matches a register that is rebuilt once a day', () => {
  // The camera drives this layer; the clock only stops a stale viewport from
  // living for ever. Anything faster re-asks a question that cannot have
  // changed and bills the anonymous ODRÉ quota for the answer.
  assert.ok(irveFranceLayer.updateInterval >= 15 * 60_000, String(irveFranceLayer.updateInterval));
});

// ── The card says capacity, never availability ──────────────────────────────

test('the card refuses to imply availability', () => {
  const label = buildIrveSelectionLabel(siteRecord());
  assert.match(label, /ne publie pas la disponibilité/);
  assert.doesNotMatch(label, /disponible/i);
  // `Accès libre` is the schema's access CONDITION — no membership needed —
  // and has to survive. A bare "libre" would be the availability claim this
  // dataset cannot support, so only that one is forbidden.
  assert.match(label, /Accès libre/);
  assert.doesNotMatch(label, /(?<!Accès )libres?\b/i);
});

test('the card counts charge points and names the site', () => {
  const label = buildIrveSelectionLabel(siteRecord());
  assert.match(label.split('\n')[0], /QPARK/);
  assert.match(label, /224 points de charge/);
  assert.match(label, /Courbevoie/);
  assert.match(label, /IZIVIA/);
});

test('one charge point is not "1 points de charge"', () => {
  const label = buildIrveSelectionLabel(siteRecord({
    pdcPublished: 1, pdcDistinct: 1, bands: { lente: 1 }, topBand: 'lente', peakKW: 7,
  }));
  assert.match(label, /1 point de charge\b/);
});

test('a double-published site shows both figures, never just the smaller', () => {
  const label = buildIrveSelectionLabel(siteRecord({
    pdcPublished: 14,
    pdcDistinct: 7,
    duplicateOperators: ['TotalEnergies Marketing France'],
    operators: ['TotalEnergies Charging Services'],
    bands: { lente: 7 },
    topBand: 'lente',
    peakKW: 7,
  }));
  assert.match(label, /7 points de charge/);
  assert.match(label, /14 publiés/);
  assert.match(label, /7 en double/);
  assert.match(label, /publié aussi par TotalEnergies Marketing France/);
});

test('an out-of-envelope power is flagged on the card, not converted', () => {
  const label = buildIrveSelectionLabel(siteRecord({
    bands: { lente: 0, normale: 0, accelere: 0, rapide: 0, hpc: 0, inconnue: 4 },
    topBand: 'inconnue',
    peakKW: null,
  }));
  assert.match(label, /hors gabarit/);
  assert.doesNotMatch(label, /7,?36 kW/);
  assert.doesNotMatch(label, /7360/);
});

test('an unstated tariff is neither free nor paid', () => {
  const unstated = buildIrveSelectionLabel(siteRecord({ free: null }));
  assert.doesNotMatch(unstated, /Gratuit|Payant/);
  assert.match(buildIrveSelectionLabel(siteRecord({ free: true })), /Gratuit/);
  assert.match(buildIrveSelectionLabel(siteRecord({ free: false })), /Payant/);
});

test('an unverified position says so instead of being silently trusted', () => {
  assert.match(
    buildIrveSelectionLabel(siteRecord({ coordVerified: false })),
    /Position non vérifiée/,
  );
  assert.doesNotMatch(buildIrveSelectionLabel(siteRecord()), /Position non vérifiée/);
});

test('the card dates the DECLARATION, and shows a span when there is one', () => {
  // A tenth of this file has not been touched since 2023, and the poll time
  // would hide that completely.
  assert.match(
    buildIrveSelectionLabel(siteRecord({ updatedFrom: '2023-07-06', updatedTo: '2025-06-30' })),
    /déclaré 2023-07-06 → 2025-06-30/,
  );
  assert.match(
    buildIrveSelectionLabel(siteRecord({ updatedFrom: '2026-07-30', updatedTo: '2026-07-30' })),
    /déclaré 2026-07-30$/m,
  );
});

test('an unknown PMR status is left off rather than printed as a fact', () => {
  assert.doesNotMatch(buildIrveSelectionLabel(siteRecord()), /♿/);
  assert.match(buildIrveSelectionLabel(siteRecord({ pmr: 'Réservé PMR' })), /♿ Réservé PMR/);
});

test('a site with nothing but a coordinate still produces a card', () => {
  const label = buildIrveSelectionLabel({ id: 'x', site: { id: 'x', lat: 1, lon: 2 } });
  assert.match(label, /^Station de recharge/);
  assert.match(label, /0 points de charge/);
});

// ── Presentation: the ramp, the size, and the overlay entry ─────────────────

test('every band has a colour and a label, including the out-of-envelope one', () => {
  for (const band of IRVE_BAND_KEYS) {
    assert.match(irveBandColor(band), /^#[0-9a-f]{6}$/i, band);
    assert.ok(irveBandLabel(band).length > 3, band);
  }
  const colors = new Set(IRVE_BAND_KEYS.map(irveBandColor));
  assert.equal(colors.size, IRVE_BAND_KEYS.length, 'bands must be distinguishable');
});

test('an unknown band falls back to the neutral tint, not to a rung on the ramp', () => {
  assert.equal(irveBandColor('quantique'), irveBandColor('inconnue'));
  assert.equal(irveBandColor(undefined), irveBandColor('inconnue'));
});

test('site size grows with charge points and stays inside the cap', () => {
  const one = irveSitePointSize(1);
  const ten = irveSitePointSize(10);
  const huge = irveSitePointSize(606);
  assert.ok(one < ten && ten < huge, `${one} ${ten} ${huge}`);
  assert.ok(huge <= 14, String(huge));
  assert.equal(irveSitePointSize(0), irveSitePointSize(null));
});

test('the selected overlay entry is protected and carries the card copy', () => {
  const entry = createIrveSelectedOverlayEntry(siteRecord());
  assert.equal(entry.id, '48.89155,2.24202');
  assert.equal(entry.protected, true);
  assert.equal(entry.selected, true);
  assert.match(entry.title, /QPARK/);
  assert.ok(entry.details.length > 3);
});

test('an entry without a position is refused rather than placed at the origin', () => {
  assert.equal(createIrveSelectedOverlayEntry({ id: 'a' }), null);
  assert.equal(createIrveSelectedOverlayEntry(null), null);
});

// ── Selection round-trip through the production path ────────────────────────

test('selecting a site publishes one protected overlay entry and restyles the dot', () => {
  const calls = [];
  const host = {
    setEntries: (id, entries, options) => calls.push(['set', id, entries, options]),
    setVisible: (id, visible) => calls.push(['visible', id, visible]),
    clearSource: (id) => calls.push(['clear', id]),
  };
  const record = siteRecord();
  _setIrveStateForTest({ viewer: viewerWithView(), records: [record], overlayHost: host });
  _selectIrveSiteForTest(record.id);

  const set = calls.find(([kind]) => kind === 'set');
  assert.ok(set, 'an overlay entry must be published');
  assert.equal(set[1], IRVE_FR_OVERLAY_SOURCE_ID);
  assert.equal(set[2].length, 1);
  assert.deepEqual(set[3], IRVE_FR_OVERLAY_SOURCE_OPTIONS);
  assert.equal(record.point.pixelSize, 17);

  _clearIrveSelectionForTest();
  assert.ok(calls.some(([kind, id]) => kind === 'clear' && id === IRVE_FR_OVERLAY_SOURCE_ID));
  assert.equal(record.point.pixelSize, record.baseSize);
});

test('selecting an id the layer does not hold is a no-op, not a throw', () => {
  const host = { setEntries() {}, setVisible() {}, clearSource() {} };
  _setIrveStateForTest({ viewer: viewerWithView(), records: [siteRecord()], overlayHost: host });
  assert.doesNotThrow(() => _selectIrveSiteForTest('nowhere'));
  _clearIrveSelectionForTest();
});

// ── The viewport contract ───────────────────────────────────────────────────

test('a viewport inside the ceiling resolves to a box', () => {
  const box = cameraIrveBox(viewerWithView({ south: 48.84, west: 2.32, north: 48.88, east: 2.38 }));
  assert.ok(box);
  assert.ok(Math.abs(box.south - 48.84) < 1e-6);
  assert.ok(Math.abs(box.east - 2.38) < 1e-6);
});

test('a viewport wider than the proxy ceiling is refused, not cropped', () => {
  const tooWide = cameraIrveBox(viewerWithView({
    south: 46, west: 2, north: 46 + IRVE_MAX_BOX_DEG + 0.1, east: 2.1,
  }));
  assert.equal(tooWide, null);
});

test('a camera with no view rectangle yields no box', () => {
  assert.equal(cameraIrveBox(viewerWithView(null)), null);
  assert.equal(cameraIrveBox(null), null);
});

// ── The panel line ──────────────────────────────────────────────────────────

test('the panel line reports charge points, and names what was merged out', () => {
  const label = buildIrveLoadingLabel({
    regime: 'sites',
    status: 'ready',
    loading: false,
    count: 188,
    summary: { pdcDistinct: 3502, pdcPublished: 4015, pdcWithheld: 2, truncated: false },
  });
  assert.match(flat(label), /3 502|3 502/);
  assert.match(label, /double-published merged/);
  assert.match(label, /misplaced withheld/);
});

test('a clean viewport does not advertise merges or withholdings it did not make', () => {
  const label = buildIrveLoadingLabel({
    regime: 'sites',
    status: 'ready',
    loading: false,
    count: 12,
    summary: { pdcDistinct: 40, pdcPublished: 40, pdcWithheld: 0, truncated: false },
  });
  assert.doesNotMatch(label, /merged|withheld|capped/);
});

test('an empty or loading viewport says which of the two it is', () => {
  assert.match(buildIrveLoadingLabel({ regime: 'sites', status: 'empty', loading: false }), /no charge point published/);
  assert.match(buildIrveLoadingLabel({ regime: 'sites', status: 'idle', loading: true, count: 0 }), /reading IRVE register/);
  assert.match(buildIrveLoadingLabel({ regime: 'sites', status: 'ready', loading: true, count: 5 }), /refreshing/);
});

// ── The legend ──────────────────────────────────────────────────────────────

test('the legend counts charge points, not dots, and drops empty bands', () => {
  _setIrveStateForTest({
    viewer: viewerWithView(),
    records: [
      siteRecord({ id: 'a', bands: { lente: 10, normale: 2, accelere: 0, rapide: 0, hpc: 0, inconnue: 0 } }),
      siteRecord({ id: 'b', bands: { lente: 5, normale: 0, accelere: 0, rapide: 0, hpc: 3, inconnue: 1 } }),
    ],
  });
  const { legend, chips } = _irveRowControlsForTest();
  assert.deepEqual(chips, []);
  const byLabel = Object.fromEntries(legend.map((row) => [row.label, row.count]));
  assert.equal(byLabel['Lente (≤ 7,4 kW)'], 15);
  assert.equal(byLabel['Normale (≤ 22 kW)'], 2);
  assert.equal(byLabel['Haute puissance (> 150 kW)'], 3);
  assert.equal(byLabel['Puissance non exploitable'], 1);
  assert.ok(!('Rapide (≤ 150 kW)' in byLabel), 'an empty band must be omitted, not listed as zero');
  _clearIrveSelectionForTest();
});

test('the legend reads low power to high, so the ramp is legible in order', () => {
  _setIrveStateForTest({
    viewer: viewerWithView(),
    records: [siteRecord({ bands: { lente: 1, normale: 1, accelere: 1, rapide: 1, hpc: 1, inconnue: 1 } })],
  });
  const order = _irveRowControlsForTest().legend.map((row) => row.label);
  assert.deepEqual(order, IRVE_BAND_KEYS.map(irveBandLabel));
  _clearIrveSelectionForTest();
});

test('every legend row carries the sentence that explains its band', () => {
  _setIrveStateForTest({
    viewer: viewerWithView(),
    records: [siteRecord({ bands: { lente: 1, normale: 0, accelere: 0, rapide: 0, hpc: 0, inconnue: 2 } })],
  });
  for (const row of _irveRowControlsForTest().legend) {
    assert.ok(row.blurb && row.blurb.length > 20, row.label);
  }
  _clearIrveSelectionForTest();
});

// ── The national regime: one dot per département, not 40 000 per France ─────

/** A rollup shaped exactly as `/api/irve-fr/departements` returns one. */
function nationalRollup(overrides = {}) {
  const departements = [
    { code: '75', name: 'Paris', pdc: 10539, sites: 664, areaKm2: 104, per1000Km2: 101336.5, bin: 5, bands: { lente: 8000, normale: 2000, accelere: 400, rapide: 100, hpc: 39, inconnue: 0 } },
    { code: '59', name: 'Nord', pdc: 7987, sites: 1454, areaKm2: 5739, per1000Km2: 1391.7, bin: 5, bands: { lente: 4000, normale: 3000, accelere: 800, rapide: 150, hpc: 37, inconnue: 0 } },
    { code: '69', name: 'Rhône', pdc: 5442, sites: 751, areaKm2: 3253, per1000Km2: 1672.9, bin: 4, bands: { lente: 3000, normale: 2000, accelere: 400, rapide: 40, hpc: 2, inconnue: 0 } },
    { code: '48', name: 'Lozère', pdc: 227, sites: 69, areaKm2: 5167, per1000Km2: 43.9, bin: 0, bands: { lente: 100, normale: 100, accelere: 20, rapide: 5, hpc: 2, inconnue: 0 } },
    { code: '2A', name: 'Corse-du-Sud', pdc: 0, sites: 0, areaKm2: 3995, per1000Km2: 0, bin: -1, bands: { lente: 0, normale: 0, accelere: 0, rapide: 0, hpc: 0, inconnue: 0 } },
  ];
  return {
    departements,
    thresholds: [667, 1319, 1905, 2428, 3984],
    binCount: 6,
    painted: 4,
    pdcAssigned: 24195,
    pdcSwept: 231079,
    pdcTotal: 231079,
    pdcWithheld: 5359,
    pdcInvalid: 24,
    pdcUnassigned: 816,
    pdcSnapped: 778,
    truncated: false,
    stalledStripes: 0,
    ...overrides,
  };
}

const DEP_META = [
  ['75', { code: '75', name: 'Paris', anchor: [2.34, 48.86] }],
  ['59', { code: '59', name: 'Nord', anchor: [3.16, 50.45] }],
  ['69', { code: '69', name: 'Rhône', anchor: [4.62, 45.87] }],
  ['48', { code: '48', name: 'Lozère', anchor: [3.50, 44.52] }],
  ['2A', { code: '2A', name: 'Corse-du-Sud', anchor: [8.93, 41.87] }],
];

test('the choropleth ramp is monotone and shares no colour with the power bands', () => {
  const ramp = [0, 1, 2, 3, 4, 5].map(irveDepartementColor);
  assert.equal(new Set(ramp).size, 6);
  for (const color of ramp) assert.match(color, /^#[0-9a-f]{6}$/i);
  // A quantity scale must never be readable as one of the power categories.
  const bands = new Set(IRVE_BAND_KEYS.map(irveBandColor));
  for (const color of ramp) assert.ok(!bands.has(color), color);
  // Alpha climbs with the bin, so density reads as weight as well as hue.
  const alphas = [0, 1, 2, 3, 4, 5].map(irveDepartementAlpha);
  assert.deepEqual(alphas, [...alphas].sort((a, b) => a - b));
});

test('a département with no charge point gets no colour at all', () => {
  // Absence is not the bottom of a scale — the same rule Mix élec applies to
  // Corse, so an empty département is unpainted rather than dark violet.
  assert.equal(irveDepartementColor(-1), null);
  assert.equal(irveDepartementColor(null), null);
  assert.equal(irveDepartementAlpha(-1), 0);
});

test('the legend prints the quantile boundaries it actually chose', () => {
  // A quantile scale is only honest if the reader can see where it cut.
  const labels = irveDepartementBinLabels([667, 1319, 1905, 2428, 3984]);
  assert.equal(labels.length, 6);
  assert.match(labels[0], /^1–667$/);
  assert.match(labels[1], /668/);
  assert.match(labels.at(-1), /\+$/);
});

test('the national row reports the country total and points at the other regime', () => {
  const label = buildIrveLoadingLabel({
    regime: 'national', loading: false, status: 'ready', national: nationalRollup(),
  });
  assert.match(label, /charge points/);
  assert.match(label, /4 départements/);
  assert.match(label, /outre-mer not mapped/);
  assert.match(label, /zoom in for sites/);
});

test('the national row admits a sweep that did not finish', () => {
  const partial = buildIrveLoadingLabel({
    regime: 'national', loading: false, status: 'ready',
    national: nationalRollup({ truncated: true }),
  });
  assert.match(partial, /partial sweep/);
  assert.doesNotMatch(
    buildIrveLoadingLabel({ regime: 'national', loading: false, status: 'ready', national: nationalRollup() }),
    /partial sweep/,
  );
});

test('the national row says it is loading before it says anything else', () => {
  assert.match(
    buildIrveLoadingLabel({ regime: 'national', loading: true, national: null }),
    /reading the national register/,
  );
});

test('the national legend is the quantile ramp, and never the power bands', () => {
  // The two scales must never be on screen together: one means an amount, the
  // other means a kind, and the same eye reads both.
  _setIrveStateForTest({
    viewer: viewerWithView(), regime: 'national', national: nationalRollup(), records: [],
  });
  const { legend } = _irveRowControlsForTest();
  assert.ok(legend.length >= 3, JSON.stringify(legend.map((row) => row.label)));
  for (const row of legend) {
    assert.match(row.label, /bornes$/);
    assert.ok(!IRVE_BAND_KEYS.map(irveBandLabel).includes(row.label), row.label);
    assert.ok(row.blurb.length > 20);
  }
  // Counts are DÉPARTEMENTS per bin here, not charge points.
  assert.equal(legend.reduce((sum, row) => sum + row.count, 0), 4);
  _clearIrveSelectionForTest();
});

test('the site legend comes back the moment the regime does', () => {
  _setIrveStateForTest({
    viewer: viewerWithView(), regime: 'sites', national: nationalRollup(),
    records: [siteRecord({ bands: { lente: 10, normale: 2, accelere: 0, rapide: 0, hpc: 0, inconnue: 0 } })],
  });
  const { legend } = _irveRowControlsForTest();
  assert.deepEqual(legend.map((row) => row.label), ['Lente (≤ 7,4 kW)', 'Normale (≤ 22 kW)']);
  _clearIrveSelectionForTest();
});

test('the département card gives the count, the split, and the rate behind it', () => {
  // The fill encodes an absolute count, which flatters a large département.
  // Printing the rate beside it is what lets a reader check that bias.
  const card = buildIrveDepartementLabel(nationalRollup().departements[0]);
  assert.match(card.split('\n')[0], /^Paris \(75\)$/);
  assert.match(flat(card), /10 539 points de charge/);
  assert.match(card, /664 sites/);
  assert.match(flat(card), /pour 1 000 km²/);
  assert.match(card, /ne publie pas la disponibilité/);
});

test('the département card handles a single charge point and an empty rollup', () => {
  assert.match(
    buildIrveDepartementLabel({ code: '48', name: 'Lozère', pdc: 1, sites: 1, bands: {}, areaKm2: 5167 }),
    /1 point de charge\b/,
  );
  assert.equal(buildIrveDepartementLabel(null), '');
});

test('ambient labels name the biggest départements, and only a bounded few', () => {
  _setIrveStateForTest({
    viewer: viewerWithView(), regime: 'national', national: nationalRollup(), depMeta: DEP_META, records: [],
  });
  const cohort = _irveDepartementOverlayForTest();
  assert.ok(cohort.length <= IRVE_FR_LABEL_COHORT_LIMIT);
  // Ranked by charge points, and the empty département is never labelled.
  assert.deepEqual(cohort.map((entry) => entry.id), [
    'irve-fr:dep:75', 'irve-fr:dep:59', 'irve-fr:dep:69', 'irve-fr:dep:48',
  ]);
  assert.match(flat(cohort[0].title), /Paris · 10 539/);
  _clearIrveSelectionForTest();
});

test('the label cohort is capped and stable under ties', () => {
  const entries = Array.from({ length: 40 }, (_, i) => createIrveDepartementOverlayEntry(
    { code: String(i).padStart(2, '0'), name: `D${i}`, pdc: 100, bin: 2 },
    null,
  ));
  const cohort = selectIrveLabelCohort(entries);
  assert.equal(cohort.length, IRVE_FR_LABEL_COHORT_LIMIT);
  assert.deepEqual(cohort.map((entry) => entry.id), [...cohort].map((entry) => entry.id));
  assert.deepEqual(selectIrveLabelCohort(entries, 0), []);
  assert.deepEqual(selectIrveLabelCohort(null), []);
});

// ── The beams ───────────────────────────────────────────────────────────────

test('the beam budget only ever gets shorter as a view gets busier', () => {
  // The shape of the curve is not the point; the monotonicity is. A layer that
  // could make a dense view taller than a sparse one would turn central Paris
  // into a wall on exactly the pan that needs it least.
  let previous = Infinity;
  for (let n = 0; n <= 5000; n += 25) {
    const px = irveBeamTargetPx(n);
    assert.ok(px <= previous + 1e-9, `${n} markers went back up: ${px} after ${previous}`);
    assert.ok(px >= IRVE_BEAM_MIN_PX && px <= IRVE_BEAM_MAX_PX, `${n} → ${px}px is outside the band`);
    previous = px;
  }
  assert.equal(irveBeamTargetPx(0), IRVE_BEAM_MAX_PX);
  assert.equal(irveBeamTargetPx(IRVE_BEAM_SPARSE_COUNT), IRVE_BEAM_MAX_PX);
  assert.equal(irveBeamTargetPx(IRVE_BEAM_DENSE_COUNT), IRVE_BEAM_MIN_PX);
  assert.equal(irveBeamTargetPx(1e9), IRVE_BEAM_MIN_PX);
  // Garbage is a sparse view, not a NaN-tall beam.
  for (const bad of [NaN, null, undefined, 'lots']) {
    assert.equal(irveBeamTargetPx(bad), IRVE_BEAM_MAX_PX, String(bad));
  }
});

test('the mesh regime does not sit on the floor of the budget', () => {
  // The first calibration put the saturation point at 1 600 markers, below the
  // 2 200 the mesh regime is capped at — so every mesh view drew the minimum,
  // which measured ~406 m over Paris and read as nothing at all. The budget has
  // to leave the mesh cap somewhere in the middle of the band.
  const meshCap = 2200;
  assert.ok(IRVE_BEAM_DENSE_COUNT > meshCap, 'the mesh cap must not saturate the budget');
  const atCap = irveBeamTargetPx(meshCap);
  assert.ok(atCap > IRVE_BEAM_MIN_PX, `a full mesh view draws the floor (${atCap}px)`);
  assert.ok(atCap < IRVE_BEAM_MAX_PX, `a full mesh view draws the ceiling (${atCap}px)`);
});

test('a beam is clamped in metres, whatever the pixel budget asks for', () => {
  // The layer spans a 45 km national view down to a street, so an unclamped
  // pixel target is a needle at one end and a skyscraper at the other.
  const factor = (2 * Math.tan(Math.PI / 6)) / 800;
  const near = irveBeamHeightM(500, IRVE_BEAM_MAX_PX, factor);
  const far = irveBeamHeightM(4_000_000, IRVE_BEAM_MAX_PX, factor);
  assert.ok(near >= 60, `${near} m is below the floor`);
  assert.ok(far <= 40_000, `${far} m is above the ceiling`);
  // Inside the band it tracks distance, so a beam holds its on-screen length.
  const a = irveBeamHeightM(10_000, 40, factor);
  const b = irveBeamHeightM(20_000, 40, factor);
  assert.ok(b > a, 'a beam twice as far away must be twice as tall');
  assert.ok(Math.abs(b / a - 2) < 0.01, `${b / a}`);
  // Nonsense in, floor out — never NaN, which would blank the geometry.
  assert.equal(irveBeamHeightM(NaN, 40, factor), irveBeamHeightM(0, 40, factor));
  assert.ok(Number.isFinite(irveBeamHeightM(1000, 40, NaN)));
});
