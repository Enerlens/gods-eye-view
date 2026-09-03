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
  irveDensityColor,
  irveDepartementPrism,
  irveNationalPrismRows,
  irveSitePointSize,
  selectIrveLabelCohort,
  _clearIrveSelectionForTest,
  _irveDepartementOverlayForTest,
  _irveRowControlsForTest,
  _applyIrveClassificationForTest,
  _repaintIrveDepartementsForTest,
  _selectIrveDepartementForTest,
  _selectIrveSiteForTest,
  _setIrveStateForTest,
  IRVE_DENSITY_BREAKS,
  IRVE_PRISM_DOMAIN_MAX,
  IRVE_PRISM_SCALE,
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
import {
  PRISM_BODY_ALPHA,
  PRISM_MAX_HEIGHT_M,
  PRISM_MIN_HEIGHT_M,
  PRISM_NO_RATIO_COLOR,
  PRISM_TOP_ALPHA,
  prismApparentPx,
} from './choroplethPrism.js';

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

// ── The national regime: a prism per département, not a flat count fill ─────
//
// Two variables on two channels: HEIGHT is the number of charge points, COLOUR
// is the density per 1 000 km². Both scales are FROZEN literals published in
// the module header, and the tests below exist to keep them literal — a domain
// re-derived from the payload would make the same département a different
// height between two loads, which is the C1 fault the prism removes.

/**
 * A rollup shaped exactly as `/api/irve-fr/departements` returns one.
 *
 * The figures are real, re-measured 2026-09-03 by sweeping the live register
 * (227 007 charge points): Paris and Lozère are the two ends of the count
 * domain and of the density domain at once, Gironde is the "tall and pale"
 * case the bivariate pairing exists for, and Corse-du-Sud is here as a MEASURED
 * ZERO — the register lists nothing there, which is a finding and not a gap.
 */
function nationalRollup(overrides = {}) {
  const departements = [
    { code: '75', name: 'Paris', pdc: 10245, sites: 664, areaKm2: 104, per1000Km2: 98509.6, bands: { lente: 8000, normale: 2000, accelere: 200, rapide: 6, hpc: 39, inconnue: 0 } },
    { code: '33', name: 'Gironde', pdc: 7455, sites: 1102, areaKm2: 10077, per1000Km2: 739.8, bands: { lente: 4000, normale: 3000, accelere: 400, rapide: 45, hpc: 10, inconnue: 0 } },
    { code: '69', name: 'Rhône', pdc: 5437, sites: 751, areaKm2: 3253, per1000Km2: 1671.4, bands: { lente: 3000, normale: 2000, accelere: 395, rapide: 40, hpc: 2, inconnue: 0 } },
    { code: '48', name: 'Lozère', pdc: 226, sites: 69, areaKm2: 5167, per1000Km2: 43.7, bands: { lente: 100, normale: 99, accelere: 20, rapide: 5, hpc: 2, inconnue: 0 } },
    { code: '2A', name: 'Corse-du-Sud', pdc: 0, sites: 0, areaKm2: 3995, per1000Km2: 0, bands: { lente: 0, normale: 0, accelere: 0, rapide: 0, hpc: 0, inconnue: 0 } },
  ];
  return {
    departements,
    painted: 4,
    pdcAssigned: 23363,
    pdcSwept: 227007,
    pdcTotal: 227007,
    pdcWithheld: 5495,
    pdcInvalid: 26,
    pdcUnassigned: 820,
    pdcSnapped: 754,
    truncated: false,
    stalledStripes: 0,
    ...overrides,
  };
}

const DEP_META = [
  ['75', { code: '75', name: 'Paris', anchor: [2.34, 48.86] }],
  ['33', { code: '33', name: 'Gironde', anchor: [-0.58, 44.84] }],
  ['69', { code: '69', name: 'Rhône', anchor: [4.62, 45.87] }],
  ['48', { code: '48', name: 'Lozère', anchor: [3.50, 44.52] }],
  ['2A', { code: '2A', name: 'Corse-du-Sud', anchor: [8.93, 41.87] }],
];

/** A stand-in for the Cesium entity the GeoJSON source builds per polygon. */
function depEntity(code) {
  return {
    show: false,
    properties: { code: { getValue: () => code } },
    polygon: { classificationType: Cesium.ClassificationType.BOTH },
  };
}

/** Seed the layer with one entity per code, plus the rollup, then paint. */
function paintWith(rollup, codes) {
  const entities = codes.map((code) => [code, [depEntity(code)]]);
  _setIrveStateForTest({
    regime: 'national', national: rollup, depEntities: entities, depMeta: DEP_META, records: [],
  });
  _repaintIrveDepartementsForTest();
  return new Map(entities.map(([code, parts]) => [code, parts[0]]));
}

test('the density ramp is monotone and shares no colour with the power bands', () => {
  // The ramp now means a RATE, which is the one thing a fill is allowed to
  // say. It must still be unreadable as one of the power categories: the two
  // scales never draw at once, but a reader who zooms out must not carry a
  // category's meaning into a quantity's.
  const ramp = [50, 150, 300, 700, 1500, 50000].map(irveDensityColor);
  assert.equal(new Set(ramp).size, 6);
  for (const color of ramp) assert.match(color, /^#[0-9a-f]{6}$/i);
  const bands = new Set(IRVE_BAND_KEYS.map(irveBandColor));
  for (const color of ramp) assert.ok(!bands.has(color), color);
  // Lightness ASCENDS with the density, so the dense end is the salient one
  // against the sky a prism is seen against.
  const lightness = ramp.map((hex) => parseInt(hex.slice(1, 3), 16)
    + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16));
  assert.deepEqual(lightness, [...lightness].sort((a, b) => a - b));
});

test('the class breaks are a frozen geometric ladder, not quantiles of a payload', () => {
  // C1. Measured over the 96 départements on 2026-09-03, this ladder fills
  // every class — 11 · 27 · 28 · 19 · 7 · 4 — where six EQUAL intervals over
  // the same 43.7 → 98 509.6 range give 94 · 1 · 0 · 0 · 0 · 1. The literal is
  // the point: a boundary derived from the rows in hand moves when a sweep
  // loses a stripe, and a département that changes colour without changing is
  // the defect this removes.
  assert.deepEqual([...IRVE_DENSITY_BREAKS], [100, 250, 500, 1000, 2500]);
  assert.deepEqual([...IRVE_PRISM_SCALE.ratioBreaks], [...IRVE_DENSITY_BREAKS]);
  // Six classes, which is CARTOGRAPHIE B3's ceiling and not one more.
  assert.equal(IRVE_PRISM_SCALE.ratioColors.length, 6);
  // Boundaries are inclusive at the top of a class, so a value ON a break can
  // never fall between two colours.
  assert.equal(irveDensityColor(100), irveDensityColor(43.7));
  assert.notEqual(irveDensityColor(100.1), irveDensityColor(100));
  // The four inner-Paris départements, and only they, reach the top class.
  assert.equal(irveDensityColor(98509.6), IRVE_PRISM_SCALE.ratioColors[5]);
  assert.equal(irveDensityColor(2500), IRVE_PRISM_SCALE.ratioColors[4]);
});

test('a density that was never computed is refused, not painted as the lowest class', () => {
  // `Number(null)` is 0, so a plain coercion would paint "we have no figure"
  // as "this is the emptiest part of France".
  for (const missing of [null, undefined, '', NaN, 'x', [], true]) {
    assert.equal(irveDensityColor(missing), null, String(missing));
  }
  assert.equal(irveDensityColor(0), IRVE_PRISM_SCALE.ratioColors[0]);
});

test('the height domain is a frozen literal, never the maximum of the payload', () => {
  // The same département must be the same height in every session and every
  // share link, so the top of the scale cannot follow the data.
  assert.equal(IRVE_PRISM_DOMAIN_MAX, 12_000);
  assert.equal(IRVE_PRISM_SCALE.domainMax, IRVE_PRISM_DOMAIN_MAX);
  const paris = irveDepartementPrism(nationalRollup().departements[0]);
  const shrunk = nationalRollup();
  shrunk.departements = shrunk.departements.slice(1);
  const gironde = irveDepartementPrism(shrunk.departements[0]);
  // Dropping the tallest département does not make the next one taller.
  assert.equal(gironde.heightM, irveDepartementPrism(nationalRollup().departements[1]).heightM);
  assert.ok(paris.heightM > gironde.heightM);
  // 10 245 of a frozen 12 000 → 102.5 km, which is 98.6 px at the ~1 500 km
  // the 9.5° national entry span is reached at.
  assert.equal(Math.round(paris.heightM), 102_450);
  assert.ok(Math.abs(prismApparentPx({ heightM: paris.heightM, cameraDistanceM: 1_500_000 }) - 98.6) < 0.5);
});

test('the height scale is LINEAR, and the floor bites on three départements only', () => {
  // `choroplethPrism.js` names this layer as a `sqrt` candidate because the
  // domain runs 1 : 45. Measured, the 4 km floor bites at 400 charge points
  // and only Cantal (373), Creuse (347) and Lozère (226) are under it — three
  // of 96, which is the A1 floor doing its job, not a lie by flooring. A sqrt
  // ruler would draw Paris at 2.4× the median where it is 5.5×.
  assert.equal(IRVE_PRISM_SCALE.mode, 'linear');
  const height = (pdc) => irveDepartementPrism({ code: 'x', pdc, per1000Km2: 100 }).heightM;
  assert.equal(height(400), PRISM_MIN_HEIGHT_M);
  for (const floored of [373, 347, 226]) assert.equal(height(floored), PRISM_MIN_HEIGHT_M);
  assert.ok(height(401) > PRISM_MIN_HEIGHT_M);
  // Linear means the ratio on screen is the ratio in the register.
  assert.ok(Math.abs((height(10245) / height(1846)) - (10245 / 1846)) < 1e-6);
  assert.equal(height(IRVE_PRISM_DOMAIN_MAX), PRISM_MAX_HEIGHT_M);
});

test('a count above the frozen domain is clipped, and the legend says so', () => {
  // A5. The mark stops measuring at the top of the domain; what it must never
  // do is pretend otherwise, or quietly move the domain to fit.
  const rollup = nationalRollup();
  rollup.departements[0] = { ...rollup.departements[0], pdc: 15_000 };
  const built = irveDepartementPrism(rollup.departements[0]);
  assert.equal(built.clipped, true);
  assert.equal(built.heightM, PRISM_MAX_HEIGHT_M);
  _setIrveStateForTest({ regime: 'national', national: rollup, records: [] });
  const { legend } = _irveRowControlsForTest();
  const clipped = legend.find((row) => /au-dessus du domaine gelé/.test(row.label));
  assert.ok(clipped, JSON.stringify(legend.map((row) => row.label)));
  assert.equal(clipped.count, 1);
  _clearIrveSelectionForTest();
});

test('a measured zero and an unmeasured département are two different facts', () => {
  // A1, and the reason this layer draws four marks rather than two. The zero
  // has a height of exactly zero — not null, not the floor — and the missing
  // one has no height at all.
  const zero = irveDepartementPrism({ code: '2A', pdc: 0, per1000Km2: 0 });
  assert.equal(zero.heightM, 0);
  assert.equal(zero.measuredZero, true);
  assert.equal(zero.hasValue, true);
  assert.equal(zero.extruded, false);
  const missing = irveDepartementPrism({ code: '2B', pdc: null, per1000Km2: 12 });
  assert.equal(missing.heightM, null);
  assert.equal(missing.measuredZero, false);
  assert.equal(missing.hasValue, false);
  // A negative count is a bad parse, not "a little": it is refused, not floored.
  assert.equal(irveDepartementPrism({ code: 'x', pdc: -5, per1000Km2: 12 }).heightM, null);
});

test('the paint pass gives each of the four states its own mark', () => {
  const rollup = nationalRollup();
  // A département whose density cannot be computed: the height is measured,
  // the colour is not, and the two refusals are independent.
  rollup.departements.push({
    code: '2B', name: 'Haute-Corse', pdc: 900, sites: 40, areaKm2: 0, per1000Km2: null, bands: {},
  });
  // '01' is in the shapes and NOT in the rollup — a payload that came short.
  const entities = paintWith(rollup, ['75', '2A', '2B', '01']);

  const paris = entities.get('75').polygon;
  assert.equal(paris.height, 0, 'the base is the ellipsoid, so tops are comparable');
  assert.ok(paris.extrudedHeight > 100_000);
  assert.equal(paris.perPositionHeight, false);
  // An extruded polygon classifies nothing — Cesium reads the property and
  // ignores it — so leaving one set would be a property that lies.
  assert.equal(paris.classificationType, undefined);
  assert.equal(paris.outline, true, 'off terrain the silhouette is legal at last');
  assert.ok(Math.abs(paris.outlineColor.alpha - PRISM_TOP_ALPHA) < 1e-6);
  assert.ok(paris.material instanceof Cesium.ColorMaterialProperty);
  assert.ok(Math.abs(paris.material.color.getValue().alpha - PRISM_BODY_ALPHA) < 1e-6);
  assert.equal(entities.get('75').show, true);

  const corse = entities.get('2A').polygon;
  assert.equal(corse.extrudedHeight, undefined, 'a measured zero has no volume');
  assert.equal(corse.height, undefined, 'and stays clamped, so it lands on the surface');
  assert.equal(corse.classificationType, Cesium.ClassificationType.BOTH);
  assert.equal(corse.outline, false, 'Cesium refuses an outline on terrain');
  assert.ok(corse.material instanceof Cesium.ColorMaterialProperty);
  assert.equal(entities.get('2A').show, true, 'drawn, because zero is a measurement');

  const noRatio = entities.get('2B').polygon;
  assert.ok(noRatio.extrudedHeight > 0, 'the height is still measured');
  assert.ok(noRatio.material instanceof Cesium.StripeMaterialProperty, 'the colour is refused');

  const unmeasured = entities.get('01').polygon;
  assert.equal(unmeasured.extrudedHeight, undefined);
  assert.ok(unmeasured.material instanceof Cesium.GridMaterialProperty,
    'a motif, not a tint: on a photorealistic globe there is no neutral colour');
  _clearIrveSelectionForTest();
});

test('a prism that becomes a footprint gets its classification back', () => {
  // The map-stack listener only writes to the flat shapes, so a shape that
  // stops being a prism has to be re-armed by the paint pass or it comes up on
  // nothing the next time Google's tiles hide the globe.
  const entities = paintWith(nationalRollup(), ['75']);
  assert.equal(entities.get('75').polygon.classificationType, undefined);
  const emptied = nationalRollup();
  emptied.departements = [{ ...emptied.departements[0], pdc: 0, per1000Km2: 0 }];
  _setIrveStateForTest({
    regime: 'national',
    national: emptied,
    depEntities: [['75', [entities.get('75')]]],
    records: [],
  });
  _repaintIrveDepartementsForTest();
  assert.equal(entities.get('75').polygon.extrudedHeight, undefined);
  assert.equal(entities.get('75').polygon.classificationType, Cesium.ClassificationType.BOTH);
  _clearIrveSelectionForTest();
});

test('a map-stack change re-arms the footprints and leaves the prisms alone', () => {
  // The switch exists because a session that starts over Google's tiles hides
  // the Cesium globe: a fill asserted onto terrain would have no terrain to
  // land on. It still has to run — for the flat shapes. Writing it onto a
  // prism would leave a property that Cesium reads and then ignores, which is
  // a lie told to the next reader rather than to the renderer.
  const rollup = nationalRollup();
  const entities = paintWith(rollup, ['75', '2A']);
  _applyIrveClassificationForTest(Cesium.ClassificationType.CESIUM_3D_TILE);
  assert.equal(entities.get('75').polygon.classificationType, undefined, 'the prism');
  assert.equal(
    entities.get('2A').polygon.classificationType,
    Cesium.ClassificationType.CESIUM_3D_TILE,
    'the measured zero, which is still clamped',
  );
  _applyIrveClassificationForTest(Cesium.ClassificationType.BOTH);
  _clearIrveSelectionForTest();
});

test('selecting a prism lights its body AND its top edge', () => {
  // The top edge is the instrument the height is read with. A selection that
  // filled the body without lighting the edge would take the reading away at
  // the exact moment the reader asked for the figures.
  const entities = paintWith(nationalRollup(), ['75']);
  const before = entities.get('75').polygon.material.color.getValue().clone();
  _selectIrveDepartementForTest('75');
  const after = entities.get('75').polygon.material.color.getValue();
  assert.ok(!Cesium.Color.equals(before, after), 'the body changed colour');
  assert.ok(Math.abs(after.blue - 1) < 1e-6 && Math.abs(after.red) < 1e-6, 'cyan');
  assert.ok(Math.abs(after.alpha - PRISM_BODY_ALPHA) < 1e-6);
  assert.ok(Math.abs(entities.get('75').polygon.outlineColor.alpha - PRISM_TOP_ALPHA) < 1e-6);
  _clearIrveSelectionForTest();
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

test('the national legend publishes BOTH scales, and never the power bands', () => {
  // D1. A height with no numbered marks says only "taller than that one", so
  // the ruler is part of the legend and not a nicety. And the two IRVE scales
  // must never be on screen together: one means an amount, the other a kind.
  _setIrveStateForTest({
    viewer: viewerWithView(), regime: 'national', national: nationalRollup(), records: [],
  });
  const { legend } = _irveRowControlsForTest();
  const labels = legend.map((row) => row.label);
  assert.ok(labels[0].startsWith('Hauteur'), labels.join(' | '));
  assert.ok(labels.some((label) => /^Couleur/.test(label)), labels.join(' | '));
  // Three numbered height ticks, drawn as BARS whose height is the datum and
  // whose colour is constant — a coloured tick would be a second, false
  // encoding on a row where the colour means nothing.
  const ticks = legend.filter((row) => row.glyph && /points de charge$/.test(row.label));
  assert.equal(ticks.length, 3);
  assert.equal(new Set(ticks.map((row) => row.color)).size, 1);
  assert.match(flat(ticks[0].label), /^10 000 points de charge$/);
  for (const row of legend) {
    assert.ok(!IRVE_BAND_KEYS.map(irveBandLabel).includes(row.label), row.label);
    assert.doesNotMatch(row.label, /kW/);
  }
  // The colour rows count DÉPARTEMENTS, and only the classes that are occupied
  // are shown — a legend entry nobody can ever find on the map is noise.
  const classes = legend.filter((row) => IRVE_PRISM_SCALE.ratioColors.includes(row.color));
  assert.equal(classes.reduce((sum, row) => sum + row.count, 0), 5);
  // The measured zero is counted, and named as a measurement.
  const zero = legend.find((row) => /mesuré à zéro/.test(row.label));
  assert.equal(zero.count, 1);
  _clearIrveSelectionForTest();
});

test('the legend states the areal bias the volume inherits, in French', () => {
  // The prism does not remove a choropleth's area bias — it moves it from the
  // fill to the volume. What it adds is a second channel to catch it with, and
  // saying so on the map is the difference between an arbitration and a trick.
  _setIrveStateForTest({
    viewer: viewerWithView(), regime: 'national', national: nationalRollup(), records: [],
  });
  const { legend } = _irveRowControlsForTest();
  const height = legend[0];
  assert.match(flat(height.blurb), /Échelle linéaire/);
  assert.match(flat(height.blurb), /12 000 points de charge/);
  assert.match(height.blurb, /aire n’est pas neutralisée|aire n'est pas neutralisée/);
  const color = legend.find((row) => /^Couleur/.test(row.label));
  // The colour's title carries its UNIT, because the class labels below it
  // are bare numbers, and a number with no unit is not a legend.
  assert.match(flat(color.label), /densité en points de charge pour 1 000 km²/);
  _clearIrveSelectionForTest();
});

test('the rows handed to the prism helpers are the rollup, unedited', () => {
  _setIrveStateForTest({ regime: 'national', national: nationalRollup(), records: [] });
  const rows = irveNationalPrismRows();
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], { code: '75', value: 10245, ratio: 98509.6 });
  // One builder for the legend tally and for the paint pass, so the two can
  // never disagree about which départements exist.
  assert.deepEqual(irveNationalPrismRows(null), []);
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

test('the département card names which channel each figure is', () => {
  // The volume invites exactly one misreading — "is this pile big because the
  // territory is big?" — and the card is where it is settled: the count is the
  // height, the density is the colour, and both are printed as numbers.
  const card = buildIrveDepartementLabel(nationalRollup().departements[0]);
  assert.match(card.split('\n')[0], /^Paris \(75\)$/);
  assert.match(flat(card), /10 245 points de charge — la hauteur du prisme/);
  assert.match(card, /664 sites/);
  assert.match(flat(card), /98 509,6 pour 1 000 km² — la couleur/);
  assert.match(card, /ne publie pas la disponibilité/);
});

test('a département with no computable density says so on the card', () => {
  assert.match(
    buildIrveDepartementLabel({ code: '2B', name: 'Haute-Corse', pdc: 900, sites: 40, bands: {}, areaKm2: 0, per1000Km2: null }),
    /densité non calculable/,
  );
});

test('the département card handles a single charge point and an empty rollup', () => {
  assert.match(
    buildIrveDepartementLabel({ code: '48', name: 'Lozère', pdc: 1, sites: 1, bands: {}, areaKm2: 5167, per1000Km2: 0.2 }),
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
  // Ranked by charge points, and the measured zero is never labelled.
  assert.deepEqual(cohort.map((entry) => entry.id), [
    'irve-fr:dep:75', 'irve-fr:dep:33', 'irve-fr:dep:69', 'irve-fr:dep:48',
  ]);
  assert.match(flat(cohort[0].title), /Paris · 10 245/);
  // The label's accent is the prism's own colour — the density class — so the
  // name and the shape it belongs to are never two different keys.
  assert.equal(cohort[0].accent, irveDensityColor(98509.6));
  assert.equal(
    createIrveDepartementOverlayEntry({ code: '2B', name: 'Haute-Corse', pdc: 900, per1000Km2: null }, null).accent,
    PRISM_NO_RATIO_COLOR,
  );
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
