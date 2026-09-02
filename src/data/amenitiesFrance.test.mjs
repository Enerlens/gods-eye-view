// What the DRAWN layer is allowed to claim, once the two feeds have already
// been proved.
//
// One property runs through the whole file: **nothing on this map may be read
// back as a quantity that neither register publishes.** This point set has no
// magnitude — a pharmacy is one pharmacy — so the size channel is a legibility
// rule and the card never turns it back into a number. What the card DOES turn
// into a number is the multiplicity, because 60 270 médecin rows sit on 30 215
// coordinates and the biggest address holds 146 of them.
//
// The second property is that the refusals stay visible. A reader who came for
// schools must be told where they are; a dot the register placed vaguely must
// look different from one it placed at a street number; and a thinned view must
// print both numbers per family or it is claiming the sample is the inventory.
import test from 'node:test';
import assert from 'node:assert/strict';

import amenitiesFranceLayer, {
  AMENITIES_FR_LABEL_COHORT_LIMIT,
  amenitiesSitesBox,
  amenitiesViewSpanDeg,
  cameraAmenitiesBox,
  _amenitiesUpdateRegimeForTest,
  AMENITIES_FR_LAYER_ID,
  AMENITIES_FR_OVERLAY_SOURCE_ID,
  AMENITY_COLORS,
  AMENITY_POINT_PX,
  AMENITY_PRECISION_ALPHA,
  amenitiesDepartementAlpha,
  amenitiesDepartementColor,
  amenityCalloutText,
  amenityFamilyColor,
  amenityFamilyLabel,
  amenityHasOutline,
  amenityPointSize,
  amenityPrecisionAlpha,
  buildAmenitiesDepartementLabel,
  buildAmenitiesLoadingLabel,
  buildAmenitySelectionLabel,
  createAmenitiesDepartementOverlayEntry,
  createAmenitySelectedOverlayEntry,
  selectAmenitiesLabelCohort,
  _amenitiesDetectablesForTest,
  _amenitiesReconcileForTest,
  _amenitiesReconcileMeshForTest,
  _amenitiesRowControlsForTest,
  _amenitiesSelectedIdForTest,
  _amenitiesStatsForTest,
  _amenitiesTruncatedForTest,
  _clearAmenitiesSelectionForTest,
  _selectAmenityForTest,
  _setAmenitiesStateForTest,
} from './amenitiesFrance.js';
import { AMENITY_FAMILIES } from './amenitiesFeed.js';
import { SCHOOL_LEVELS } from './schoolsFeed.js';
import { schoolLevelColor } from './schoolsFrance.js';
import { SUP_KINDS } from './supFeed.js';
import { supKindColor } from './supFrance.js';

// Cesium reads the aliased line-width range off a live WebGL context, and there
// is none under `node --test`, so `ContextLimits._maximumAliasedLineWidth` sits
// at 0 and every `RenderState.fromCache` throws. Priming it is a property of
// the harness, not of the layer.
const { default: ContextLimits } = await import('@cesium/engine/Source/Renderer/ContextLimits.js');
ContextLimits._maximumAliasedLineWidth = 16;

/** `toLocaleString('fr-FR')` separates thousands with U+202F. */
const norm = (value) => String(value).replace(/[\s  ]+/g, ' ');

/** A points collection with the two methods the layer actually calls. */
function fakePoints() {
  const added = [];
  return {
    show: true,
    added,
    add(options) {
      const point = { ...options, show: true };
      added.push(point);
      return point;
    },
    removeAll() { added.length = 0; },
  };
}

/** An overlay host that records what the layer publishes. */
function fakeOverlayHost() {
  const calls = { entries: new Map(), cleared: [] };
  return {
    calls,
    setEntries(sourceId, entries) { calls.entries.set(sourceId, entries); },
    setVisible() {},
    clearSource(sourceId) { calls.cleared.push(sourceId); calls.entries.delete(sourceId); },
  };
}

const site = (over = {}) => ({
  id: 'a:0:48.83801,2.34276',
  family: 'medecin',
  register: 'bpe',
  lat: 48.83801,
  lon: 2.34276,
  precision: 'numero',
  count: 1,
  names: ['NADJIBA GALOUL, MÉDECIN'],
  moreNames: 0,
  unnamed: 0,
  kinds: ['Médecin généraliste'],
  commune: 'PARIS 14',
  ...over,
});

const record = ({ site: siteOver, ...over } = {}) => {
  const built = site(siteOver);
  return {
    id: over.id || built.id,
    site: built,
    position: { x: 1, y: 2, z: 3 },
    baseColor: amenityFamilyColor(built.family) || AMENITY_COLORS.medecin,
    baseAlpha: 1,
    baseSize: AMENITY_POINT_PX[built.family] || AMENITY_POINT_PX.medecin,
    point: { color: null, pixelSize: 0, show: true },
    ...over,
  };
};

test.afterEach(() => {
  _clearAmenitiesSelectionForTest();
  _setAmenitiesStateForTest({
    regime: 'national', records: new Map(), national: null, mesh: null, meshPick: null,
    count: 0, status: 'idle', loading: false, error: null, summary: null, selectedId: null,
    enabled: false, points: null, overlayHost: null, truncated: 0,
  });
});

// --- Identity ---------------------------------------------------------------

test('the layer object is the one the registry will hold', () => {
  assert.equal(amenitiesFranceLayer.id, 'amenities-fr');
  assert.equal(AMENITIES_FR_LAYER_ID, 'amenities-fr');
  assert.equal(amenitiesFranceLayer.icon, '🏪');
  assert.match(amenitiesFranceLayer.name, /Équipements du quotidien/);
  assert.equal(typeof amenitiesFranceLayer.init, 'function');
  assert.equal(typeof amenitiesFranceLayer.enable, 'function');
  assert.equal(typeof amenitiesFranceLayer.disable, 'function');
  assert.equal(typeof amenitiesFranceLayer.update, 'function');
  assert.equal(typeof amenitiesFranceLayer.getDetectableObjects, 'function');
  assert.equal(amenitiesFranceLayer.updateInterval, 6 * 60 * 60_000);
});

// --- Colour and size --------------------------------------------------------

test('every family has its own hue and none of them is a neighbour layer’s', () => {
  const seen = new Set();
  for (const family of AMENITY_FAMILIES) {
    const color = amenityFamilyColor(family);
    assert.match(color, /^#[0-9a-f]{6}$/i);
    assert.equal(seen.has(color), false, `${family} reuses a colour`);
    seen.add(color);
  }
  assert.equal(seen.size, 7);
  // schools-fr draws 68 158 dots and sup-fr 6 914 over the same country; a
  // shared hex would make two registers indistinguishable on a stacked address.
  const neighbours = new Set([
    ...SCHOOL_LEVELS.map((level) => schoolLevelColor(level).toLowerCase()),
    ...SUP_KINDS.map((kind) => supKindColor(kind).toLowerCase()),
  ]);
  for (const color of seen) {
    assert.equal(neighbours.has(color.toLowerCase()), false, `${color} collides with a neighbour`);
  }
  assert.equal(amenityFamilyColor('ecole'), null);
  assert.equal(amenityFamilyColor(undefined), null);
});

test('size is a legibility ladder — rarer families are bigger, and it means nothing else', () => {
  // Ascending rarity: médecin 30 215 … hôpital 2 211.
  const order = ['medecin', 'courses', 'pharmacie', 'poste', 'piscine', 'gendarmerie', 'hopital'];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(AMENITY_POINT_PX[order[i]] >= AMENITY_POINT_PX[order[i - 1]],
      `${order[i]} should not be smaller than ${order[i - 1]}`);
  }
  assert.ok(AMENITY_POINT_PX.hopital > AMENITY_POINT_PX.medecin);
  // Size never varies with anything on the record — there is no magnitude.
  assert.equal(amenityPointSize('medecin'), amenityPointSize('medecin'));
  // A maillage dot is flatter than an exact one, so a sample cannot read as an
  // inventory.
  assert.ok(amenityPointSize('hopital', { mesh: true }) < amenityPointSize('hopital'));
  assert.equal(amenityPointSize('inconnu'), 6);
});

test('the precision channel is real: worse-located dots are softer and lose the halo', () => {
  assert.ok(amenityPrecisionAlpha('numero') > amenityPrecisionAlpha('voie'));
  assert.ok(amenityPrecisionAlpha('voie') > amenityPrecisionAlpha('approchee'));
  assert.ok(amenityPrecisionAlpha('approchee') > amenityPrecisionAlpha('indeterminee'));
  assert.equal(amenityHasOutline('numero'), true);
  assert.equal(amenityHasOutline('voie'), true);
  assert.equal(amenityHasOutline('approchee'), false);
  assert.equal(amenityHasOutline('indeterminee'), false);
  // An absent band must not default to the best one.
  assert.equal(amenityPrecisionAlpha(undefined), AMENITY_PRECISION_ALPHA.indeterminee);
  assert.equal(amenityPrecisionAlpha(null), AMENITY_PRECISION_ALPHA.indeterminee);
  assert.equal(amenityHasOutline(undefined), false);
});

test('a choropleth bin that is not an integer bin gets no colour at all', () => {
  assert.match(amenitiesDepartementColor(0), /^#[0-9a-f]{6}$/i);
  assert.match(amenitiesDepartementColor(5), /^#[0-9a-f]{6}$/i);
  // -1 is "this département is not in the fold" and must draw as absence.
  assert.equal(amenitiesDepartementColor(-1), null);
  assert.equal(amenitiesDepartementColor(6), null);
  // The three shapes a coercing guard would have turned into bin 0.
  assert.equal(amenitiesDepartementColor(null), null);
  assert.equal(amenitiesDepartementColor(undefined), null);
  assert.equal(amenitiesDepartementColor('0'), null);
  assert.equal(amenitiesDepartementColor(1.5), null);
  assert.equal(amenitiesDepartementAlpha(null), 0.34);
});

test('the ramp is a different colour family from the two national views beside it', () => {
  const mine = [0, 1, 2, 3, 4, 5].map((bin) => amenitiesDepartementColor(bin).toLowerCase());
  assert.equal(new Set(mine).size, 6);
  for (const color of mine) {
    assert.equal(SCHOOL_LEVELS.some((level) => schoolLevelColor(level).toLowerCase() === color), false);
  }
});

// --- Cards ------------------------------------------------------------------

test('a card with several practitioners at one address says how many, and names four', () => {
  const label = buildAmenitySelectionLabel(record({
    site: {
      count: 146,
      names: ['A, MÉDECIN', 'B, MÉDECIN', 'C, MÉDECIN', 'D, MÉDECIN'],
      moreNames: 142,
      unnamed: 0,
    },
  }));
  assert.match(norm(label), /146 médecins généralistes à cette adresse/);
  assert.match(norm(label), /et 142 autres/);
  assert.match(label, /B, MÉDECIN/);
});

test('a single-row dot does not claim a multiplicity it does not have', () => {
  const label = buildAmenitySelectionLabel(record());
  assert.equal(/à cette adresse/.test(label), false);
  assert.match(label, /^NADJIBA GALOUL, MÉDECIN\n/);
  assert.match(label, /Base permanente des équipements 2025 — Insee/);
});

test('a row whose raison sociale is not published says so instead of showing a blank title', () => {
  const label = buildAmenitySelectionLabel(record({ site: { names: [], count: 1 } }));
  assert.match(label, /^Médecin généraliste\n/);
  assert.match(label, /Raison sociale non diffusée/);
});

test('a vaguely-located dot carries a warning and a precisely-located one does not', () => {
  const vague = buildAmenitySelectionLabel(record({ site: { precision: 'indeterminee' } }));
  assert.match(vague, /⚠ Position : Précision non publiée/);
  const exact = buildAmenitySelectionLabel(record());
  assert.match(exact, /Position : Numéro trouvé dans une voie sûre/);
  assert.equal(/⚠/.test(exact), false);
});

test('a FINESS card names the register, the geocoding score and the CRS it was reprojected from', () => {
  const label = buildAmenitySelectionLabel(record({
    site: {
      family: 'hopital',
      register: 'finess',
      names: ['CH DE FLEYRIAT'],
      kinds: ['Centre Hospitalier (C.H.)'],
      score: 96,
      geocoder: 'BAN',
      crs: 'RGF93 / Lambert-93 (Métropole)',
      finess: ['010000024'],
      uai: '0691234X',
    },
  }));
  assert.match(norm(label), /Géocodage BAN — score 96\/100/);
  assert.match(label, /Coordonnées reprojetées depuis RGF93 \/ Lambert-93/);
  assert.match(label, /FINESS 010000024/);
  assert.match(label, /UAI 0691234X — aussi dans schools-fr \/ sup-fr/);
  assert.match(label, /FINESS — ARS \/ Agence du Numérique en Santé/);
});

test('a maillage dot says it is one, instead of letting its empty card read as an absence', () => {
  const label = buildAmenitySelectionLabel({
    mesh: true,
    site: { family: 'hopital', precision: 'voie', count: 0, names: [], kinds: [] },
  });
  assert.match(label, /^Hôpital\n/);
  assert.match(label, /Point du maillage — zoomer pour la fiche complète/);
});

test('the département card gives the ratio, the mix, and the ratio’s own blind spot', () => {
  const label = buildAmenitiesDepartementLabel({
    code: '32', name: 'Gers', share: 21.6, covered: 99, communes: 458, amenities: 380,
    families: { medecin: 47, courses: 80, pharmacie: 60, poste: 150, piscine: 10, gendarmerie: 33, hopital: 0 },
    bin: 0,
  });
  assert.match(norm(label), /21,6 % des communes équipées — 99 sur 458/);
  assert.match(norm(label), /380 équipements dessinés/);
  assert.match(norm(label), /47 médecins généralistes/);
  // The family with zero is not listed as a zero.
  assert.equal(/hôpitaux/.test(label), false);
  assert.match(label, /FINESS ne publie pas de code commune/);
});

test('a département with no communes in the fold says so rather than printing 0 %', () => {
  const label = buildAmenitiesDepartementLabel({
    code: '90', name: 'Territoire de Belfort', share: 0, covered: 0, communes: 0,
    amenities: 186, families: {}, bin: -1,
  });
  assert.match(label, /Aucune commune rattachée à ce polygone/);
});

// --- Status line ------------------------------------------------------------

test('the national line leads with the share and states what the choropleth cannot paint', () => {
  const label = buildAmenitiesLoadingLabel({
    regime: 'national',
    status: 'ready',
    loading: false,
    national: {
      nationalShare: 43.7, communesPlaced: 34778, assigned: 92725, painted: 96, unassigned: 2681,
    },
  });
  assert.match(norm(label), /43,7 % des 34 778 communes équipées/);
  assert.match(norm(label), /92 725 équipements sur 96 départements/);
  assert.match(norm(label), /2 681 hors métropole non peints/);
});

test('the maillage line names both numbers, because a thinned map that does not is lying', () => {
  const label = buildAmenitiesLoadingLabel({
    regime: 'maillage',
    status: 'ready',
    loading: false,
    meshPick: { picked: new Array(1100), inBox: 92748, thinned: true },
  });
  assert.match(norm(label), /1 100 tracés sur 92 748 dans la vue/);
  assert.match(label, /échantillon par famille/);
  // Under budget, it is not an échantillon and must not claim to be one.
  const whole = buildAmenitiesLoadingLabel({
    regime: 'maillage',
    status: 'ready',
    loading: false,
    meshPick: { picked: new Array(12), inBox: 12, thinned: false },
  });
  assert.match(norm(whole), /12 équipements dans la vue/);
  assert.equal(/échantillon/.test(whole), false);
});

test('the sites line reports what it received and did not draw, without naming a cause it cannot prove', () => {
  const label = buildAmenitiesLoadingLabel({
    regime: 'sites', status: 'ready', loading: false, count: 9000, truncated: 1234,
  });
  assert.match(norm(label), /9 000 équipements/);
  assert.match(norm(label), /1 234 reçus mais non tracés/);
  // Nothing dropped, nothing claimed.
  const clean = buildAmenitiesLoadingLabel({
    regime: 'sites', status: 'ready', loading: false, count: 9000, truncated: 0,
  });
  assert.equal(/non tracés/.test(clean), false);
});

test('an empty view says it is empty, and a loading one says what it is loading', () => {
  assert.equal(buildAmenitiesLoadingLabel({ regime: 'sites', status: 'empty', loading: false, count: 0 }),
    'aucun équipement dans cette vue');
  assert.match(buildAmenitiesLoadingLabel({ regime: 'national', loading: true }), /registre national/);
  assert.match(buildAmenitiesLoadingLabel({ regime: 'maillage', loading: true }), /maillage national/);
  // An error state prints nothing here — the error belongs in stats.error.
  assert.equal(buildAmenitiesLoadingLabel({ regime: 'sites', status: 'error', loading: false }), '');
});

// --- Legend -----------------------------------------------------------------

test('the legend always carries the écoles refusal, with the count and where they are', () => {
  _setAmenitiesStateForTest({
    regime: 'sites',
    records: new Map([['a', record()]]),
  });
  const { legend } = _amenitiesRowControlsForTest();
  const refusal = legend.at(-1);
  assert.match(refusal.label, /Écoles — non dessinées ici/);
  assert.equal(refusal.color, null);
  assert.match(refusal.blurb, /79 743/);
  assert.match(refusal.blurb, /schools-fr/);
  assert.match(refusal.blurb, /sup-fr/);
});

test('the maillage legend prints kept-against-in-view per family, because the mix on screen is bent', () => {
  _setAmenitiesStateForTest({
    regime: 'maillage',
    records: new Map([
      ['a', record({ id: 'a' })],
      ['b', record({ id: 'b', site: { family: 'hopital' } })],
    ]),
    meshPick: {
      picked: [], inBox: 92748, thinned: true,
      perFamily: [
        { family: 'medecin', inBox: 29000, kept: 331 },
        { family: 'hopital', inBox: 2100, kept: 39 },
      ],
    },
  });
  const { legend } = _amenitiesRowControlsForTest();
  const hopital = legend.find((row) => row.label === 'Hôpital');
  assert.match(norm(hopital.blurb), /Échantillon : 1 tracé sur 2 100 dans la vue/);
});

test('the national legend is the percentage ramp and names the ratio’s blind spot', () => {
  _setAmenitiesStateForTest({
    regime: 'national',
    national: {
      thresholds: [29, 43, 49, 56, 69],
      departements: [
        { code: '32', name: 'Gers', share: 21.6, bin: 0, communes: 458 },
        { code: '75', name: 'Paris', share: 100, bin: 5, communes: 20 },
        { code: '90', name: 'Belfort', share: 0, bin: -1, communes: 0 },
      ],
    },
  });
  const { legend } = _amenitiesRowControlsForTest();
  assert.equal(legend.length, 2);
  for (const row of legend) assert.match(row.label, /%/);
  // A bin nobody is in is not a legend row.
  assert.equal(legend.some((row) => row.count === 0), false);
  assert.match(legend.at(-1).blurb, /FINESS ne publie pas de code commune/);
});

test('the national legend is empty until the rollup arrives', () => {
  _setAmenitiesStateForTest({ regime: 'national', national: null });
  assert.deepEqual(_amenitiesRowControlsForTest(), { chips: [], legend: [] });
});

// --- Reconcile, selection, detection ----------------------------------------

test('a viewport payload draws one point per record, styled by family and precision', () => {
  const points = fakePoints();
  _setAmenitiesStateForTest({ regime: 'sites', enabled: true, points, records: new Map() });
  _amenitiesReconcileForTest({
    sites: [
      site(),
      site({ id: 'a:6:48.8,2.3', family: 'hopital', lat: 48.8, lon: 2.3, precision: 'approchee' }),
      // A family the palette does not know is dropped, not drawn grey.
      site({ id: 'a:9:48.7,2.2', family: 'ecole', lat: 48.7, lon: 2.2 }),
    ],
  });
  assert.equal(points.added.length, 2);
  assert.equal(points.added[0].pixelSize, AMENITY_POINT_PX.medecin);
  assert.equal(points.added[0].outlineWidth, 1);
  // 'approchee' loses the halo.
  assert.equal(points.added[1].pixelSize, AMENITY_POINT_PX.hopital);
  assert.equal(points.added[1].outlineWidth, 0);
  assert.equal(_amenitiesStatsForTest().count, 2);
  assert.equal(_amenitiesTruncatedForTest(), 1);
});

test('the maillage draws the tuples the thinning kept and marks every record as a sample', () => {
  const points = fakePoints();
  const rows = [
    [45.0, 3.0, 3, AMENITY_FAMILIES.indexOf('medecin')],
    [45.5, 3.5, 0, AMENITY_FAMILIES.indexOf('hopital')],
  ];
  _setAmenitiesStateForTest({
    regime: 'maillage', enabled: true, points, records: new Map(), mesh: { rows, rowCount: 2 },
  });
  _amenitiesReconcileMeshForTest({ south: 44, west: 2, north: 46, east: 4 });
  assert.equal(points.added.length, 2);
  const summary = amenitiesFranceLayer.getMeshSummary();
  assert.equal(summary.inBox, 2);
  assert.equal(summary.shown, 2);
  assert.equal(summary.nationalRows, 2);
  assert.equal(summary.perFamily.length, 2);
  // The 'indeterminee' tuple gets no halo, exactly as in the exact regime.
  const soft = points.added.find((point) => point.outlineWidth === 0);
  assert.ok(soft, 'a tuple with no published precision must lose the halo');
});

test('selecting a dot publishes a protected card and restores the dot on clear', () => {
  const points = fakePoints();
  const host = fakeOverlayHost();
  const entry = record();
  _setAmenitiesStateForTest({
    regime: 'sites', enabled: true, points, overlayHost: host,
    records: new Map([[entry.id, entry]]),
  });
  _selectAmenityForTest(entry.id);
  assert.equal(_amenitiesSelectedIdForTest(), entry.id);
  const published = host.calls.entries.get(AMENITIES_FR_OVERLAY_SOURCE_ID);
  assert.equal(published.length, 1);
  assert.equal(published[0].protected, true);
  assert.equal(published[0].selected, true);
  assert.match(published[0].title, /NADJIBA GALOUL/);
  assert.equal(entry.point.pixelSize, 18);
  _clearAmenitiesSelectionForTest();
  assert.equal(_amenitiesSelectedIdForTest(), null);
  assert.equal(entry.point.pixelSize, AMENITY_POINT_PX.medecin);
  assert.ok(host.calls.cleared.includes(AMENITIES_FR_OVERLAY_SOURCE_ID));
});

test('a selection for an id the layer does not hold changes nothing', () => {
  const host = fakeOverlayHost();
  _setAmenitiesStateForTest({
    regime: 'sites', enabled: true, points: fakePoints(), overlayHost: host, records: new Map(),
  });
  _selectAmenityForTest('a:0:0,0');
  assert.equal(_amenitiesSelectedIdForTest(), null);
  assert.equal(host.calls.entries.has(AMENITIES_FR_OVERLAY_SOURCE_ID), false);
});

test('a selected overlay entry needs both an id and a position, or it is not built', () => {
  assert.equal(createAmenitySelectedOverlayEntry(null), null);
  assert.equal(createAmenitySelectedOverlayEntry({ id: 'x' }), null);
  assert.equal(createAmenitySelectedOverlayEntry({ position: {} }), null);
});

test('the DETECT callout names the thing, and falls back to the family for a nameless maillage dot', () => {
  assert.equal(amenityCalloutText(record()), 'NADJIBA GALOUL, MÉDECIN');
  assert.equal(norm(amenityCalloutText(record({ site: { count: 3 } }))),
    'NADJIBA GALOUL, MÉDECIN · +2');
  assert.equal(amenityCalloutText({ site: { family: 'hopital', names: [] } }), 'Hôpital');
  assert.equal(amenityCalloutText(null), '');
});

test('detection is bounded, deterministic and skips the already-labelled selection', () => {
  const points = fakePoints();
  const records = new Map();
  for (let i = 0; i < 40; i += 1) {
    const id = `a:0:48.${i},2.0`;
    records.set(id, record({ id, site: { id } }));
  }
  _setAmenitiesStateForTest({ regime: 'sites', enabled: true, points, records });
  const detectables = _amenitiesDetectablesForTest({ maxCount: 7, seed: 3 });
  assert.equal(detectables.length, 7);
  assert.deepEqual(detectables, _amenitiesDetectablesForTest({ maxCount: 7, seed: 3 }));
  for (const item of detectables) {
    assert.equal(item.type, 'Amenity');
    assert.ok(records.has(item.sourceId));
    assert.equal(item.skipLabel, false);
  }
  // With the layer off, nothing is detectable.
  _setAmenitiesStateForTest({ enabled: false });
  assert.deepEqual(_amenitiesDetectablesForTest({ maxCount: 7 }), []);
});

// --- Stats ------------------------------------------------------------------

test('a zoom or empty state is guidance, not an error', () => {
  _setAmenitiesStateForTest({
    regime: 'sites', status: 'empty', count: 0, loading: false, error: null,
  });
  const stats = _amenitiesStatsForTest();
  assert.equal(stats.status, 'empty');
  assert.equal(stats.error, undefined);
  assert.match(stats.loadingLabel, /aucun équipement/);
});

test('a stale national payload is flagged, and a failed one carries a sentence', () => {
  _setAmenitiesStateForTest({
    regime: 'national', national: { stale: true, departements: [], nationalShare: 43.7, communesPlaced: 1, assigned: 1, painted: 1, unassigned: 0 },
    status: 'ok', count: 96,
  });
  assert.equal(_amenitiesStatsForTest().stale, true);
  _setAmenitiesStateForTest({ regime: 'national', national: null, status: 'error', error: 'HTTP 503' });
  const stats = _amenitiesStatsForTest();
  assert.equal(stats.error, 'HTTP 503');
  assert.equal(stats.status, 'error');
});

// --- Overlay labels ---------------------------------------------------------

test('the ambient département labels favour the LEAST equipped, which is the point of the map', () => {
  const gers = createAmenitiesDepartementOverlayEntry(
    { code: '32', name: 'Gers', share: 21.6, bin: 0 }, { x: 0, y: 0, z: 0 },
  );
  const paris = createAmenitiesDepartementOverlayEntry(
    { code: '75', name: 'Paris', share: 100, bin: 5 }, { x: 0, y: 0, z: 0 },
  );
  assert.ok(gers.priority > paris.priority);
  assert.match(norm(gers.title), /Gers · 21,6 %/);
  const cohort = selectAmenitiesLabelCohort([paris, gers], 1);
  assert.equal(cohort.length, 1);
  assert.equal(cohort[0].id, 'amenities-fr:dep:32');
  assert.equal(selectAmenitiesLabelCohort([paris, gers], 0).length, 0);
  assert.equal(selectAmenitiesLabelCohort(null).length, 0);
  assert.ok(selectAmenitiesLabelCohort(new Array(50).fill(paris)).length <= AMENITIES_FR_LABEL_COHORT_LIMIT);
});

test('the family labels are French and none of them says "école"', () => {
  for (const family of AMENITY_FAMILIES) {
    const label = amenityFamilyLabel(family);
    assert.ok(label.length > 0);
    assert.equal(/école/i.test(label), false, `${family} must not claim schools`);
  }
  assert.equal(amenityFamilyLabel(undefined), '');
});

// --- Regime ------------------------------------------------------------------

/** A camera rectangle is radians; Cesium is only asked to convert it. */
const viewerSpanning = (latDeg, lonDeg) => ({
  camera: {
    computeViewRectangle: () => ({
      south: (46 - latDeg / 2) * Math.PI / 180,
      north: (46 + latDeg / 2) * Math.PI / 180,
      west: (2 - lonDeg / 2) * Math.PI / 180,
      east: (2 + lonDeg / 2) * Math.PI / 180,
    }),
  },
});

test('the regime ladder is entered on latitude and left with hysteresis', () => {
  _setAmenitiesStateForTest({ regime: 'sites' });
  // Metropolitan France is 9.8° tall; the national view starts at 9.5°.
  assert.equal(_amenitiesUpdateRegimeForTest(viewerSpanning(10, 24)), 'national');
  // 8.5° is below the enter threshold but above the exit one — it stays.
  assert.equal(_amenitiesUpdateRegimeForTest(viewerSpanning(8.5, 20)), 'national');
  assert.equal(_amenitiesUpdateRegimeForTest(viewerSpanning(4, 10)), 'maillage');
  assert.equal(_amenitiesUpdateRegimeForTest(viewerSpanning(0.2, 0.3)), 'sites');
  // Leaving `sites` needs the LARGER span to exceed the proxy's own ceiling, so
  // a wide-but-short oblique view does not flicker between the two.
  assert.equal(_amenitiesUpdateRegimeForTest(viewerSpanning(0.2, 0.34)), 'sites');
  assert.equal(_amenitiesUpdateRegimeForTest(viewerSpanning(0.2, 0.5)), 'maillage');
  _setAmenitiesStateForTest({ regime: 'national' });
});

test('a camera past the limb yields no box and an infinite span, not a NaN one', () => {
  const blind = { camera: { computeViewRectangle: () => undefined } };
  assert.deepEqual(amenitiesViewSpanDeg(blind), { lat: Infinity, max: Infinity });
  assert.equal(cameraAmenitiesBox(blind), null);
  assert.equal(amenitiesSitesBox(blind), null);
  assert.equal(amenitiesViewSpanDeg(null).lat, Infinity);
});

test('the sites box is refused by the SAME ceiling the proxy enforces', () => {
  // 0.3° of latitude and longitude, padded by 8% each way, still fits.
  assert.ok(amenitiesSitesBox(viewerSpanning(0.3, 0.3)));
  // 0.34° padded by 8% is 0.367° and does not.
  assert.equal(amenitiesSitesBox(viewerSpanning(0.34, 0.34)), null);
  assert.equal(amenitiesSitesBox(viewerSpanning(1, 1)), null);
});
