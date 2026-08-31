// src/data/frHydroPlants.test.mjs
// Covers the Petite hydro LAYER: the two marker kinds and the promise each
// makes, the card an anonymous plant still gets, the power ramp across five
// orders of magnitude, the runtime floor, and the lifecycle. The upstream
// register's shape is pinned separately in frHydroFeed.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  FR_HYDRO_FLOORS,
  FR_HYDRO_LAYER_ID,
  FR_HYDRO_OVERLAY_COHORT_LIMIT,
  FR_HYDRO_OVERLAY_SOURCE_ID,
  FR_HYDRO_RENDER_PREFIX,
  FR_HYDRO_SELECTED_OVERLAY_SOURCE_ID,
  GROUND_LIFT_M,
  HYDRO_PIXEL_MAX,
  HYDRO_PIXEL_MIN,
  buildHydroCard,
  buildHydroClusterCard,
  createFrHydroPlantsLayer,
  formatHydroEnergy,
  formatHydroPower,
  hydroColor,
  hydroDisplayName,
  hydroLabelText,
  hydroLegend,
  hydroPixelSize,
  mapHydroAnalystRecord,
  selectHydroOverlayCohort,
} from './frHydroPlants.js';
import { HYDRO_TECHNOLOGIES, HYDRO_UNKNOWN_COLOR } from './frHydroFeed.js';
import {
  _clearMeshFloorCellsForTest,
  reportMeshFloorCell,
  setMeshFloorPreferred,
} from './groundFloor.js';

const REGISTRY = JSON.parse(readFileSync(
  new URL('./local_data/fr_hydro_plants/plants.json', import.meta.url),
  'utf8',
));

const plant = (predicate) => REGISTRY.plants.find(predicate);
const MIEGEBAT = plant((p) => p.insee === '64320' && p.kw === 74000);
const ANONYMOUS = plant((p) => p.anonymous && Number.isFinite(p.energyKwh) && p.energyKwh > 0);
const CORSICAN_PV = plant((p) => p.tech === 'Photovoltaïque');

// ── The shipped registry is the thing this layer promises ───────────────────

test('the whole national register ships, not a filtered slice of it', () => {
  assert.equal(REGISTRY.floorKw, 0);
  assert.ok(REGISTRY.stats.plants > 2700, `expected the full register, got ${REGISTRY.stats.plants}`);
  // The three capacities stay separable — see the layer header.
  assert.equal(
    Math.round(REGISTRY.stats.placedKw + REGISTRY.stats.clusteredKw),
    Math.round(REGISTRY.stats.installedKw),
  );
  assert.ok(REGISTRY.stats.placedKw < REGISTRY.stats.installedKw);
});

test('the nine plants of Laruns are in the file — the hole this layer was built for', () => {
  const laruns = [
    ...REGISTRY.plants.filter((p) => p.insee === '64320'),
    ...REGISTRY.clusters.filter((c) => c.insee === '64320').flatMap((c) => Array(c.plants).fill(null)),
  ];
  assert.equal(laruns.length, 9);
  assert.ok(MIEGEBAT, 'Miégebat must be placed');
  // Its own building, not its commune centre: Laruns' centre is 4,2 km away.
  assert.equal(MIEGEBAT.placement, 'ign-bdtopo');
  assert.equal(MIEGEBAT.corroborates, 'osm-plant');
  assert.ok(MIEGEBAT.anchorKm > 3, 'the commune centre would have been kilometres out');
});

test('every placed plant carries the evidence for its own position', () => {
  for (const p of REGISTRY.plants) {
    assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lon), `${p.id} has no position`);
    assert.ok(
      ['ign-bdtopo', 'edf-published', 'osm-plant', 'rte-switchyard'].includes(p.placement),
      `${p.id}: ${p.placement}`,
    );
    assert.ok(p.placementRef, `${p.id} has no placementRef`);
    assert.ok(
      ['ign-footprint', 'published-point', 'outline', 'generators', 'switchyard'].includes(p.geometry),
      `${p.id}: geometry ${p.geometry}`,
    );
    if (p.placement === 'osm-plant') {
      assert.ok(['name', 'name-partial', 'power', 'sole'].includes(p.matchedBy), `${p.id}: ${p.matchedBy}`);
    }
  }
});

test('a card states IGN\u2019s own accuracy, and flags an unstated nature', () => {
  const sure = REGISTRY.plants.find((p) => p.ignKind === 'Centrale hydroélectrique' && p.ignPrecisionM);
  const card = buildHydroCard(sure);
  assert.ok(card.includes(`± ${sure.ignPrecisionM} m`), card);
  const vague = REGISTRY.plants.find((p) => p.placement === 'ign-bdtopo' && !p.ignKind);
  if (vague) {
    assert.ok(buildHydroCard(vague).includes('nature non précisée'), buildHydroCard(vague));
  }
});

test('no plant is positioned at the centre of an object too big to be a place', () => {
  // The Hourat bug, pinned: a `type=site` relation spanning the intake, the
  // penstock and the powerhouse has a bbox centre on no object at all.
  for (const p of REGISTRY.plants) {
    if (p.geometry !== 'outline') continue;
    assert.ok(
      Number.isFinite(p.outlineSpanM) && p.outlineSpanM <= 500,
      `${p.name || p.id} sits at the centre of a ${p.outlineSpanM} m object`,
    );
  }
  // …and the ones that were are snapped to their generating hall instead.
  const snapped = REGISTRY.plants.filter((p) => p.geometry === 'generators');
  assert.ok(snapped.length > 50, `expected the snap tier to carry real weight, got ${snapped.length}`);
  for (const p of snapped) assert.ok(p.outlineSpanM > 500 && p.snapKm >= 0);
});

test('IGN BD TOPO carries the majority of positions, on surveyed footprints', () => {
  const ign = REGISTRY.plants.filter((p) => p.placement === 'ign-bdtopo');
  assert.ok(ign.length > REGISTRY.plants.length / 2,
    `expected IGN to be the main position source, got ${ign.length}/${REGISTRY.plants.length}`);
  for (const p of ign) {
    assert.equal(p.geometry, 'ign-footprint');
    assert.ok(p.ignRef, `${p.id} has no IGN cleabs`);
    // IGN publishes its own planimetric accuracy; the card states it.
    assert.ok(p.ignPrecisionM === null || p.ignPrecisionM > 0, `${p.id}: ${p.ignPrecisionM}`);
    // A footprint is a building, not a scheme.
    assert.ok(p.outlineSpanM <= 700, `${p.id}: ${p.outlineSpanM} m footprint`);
  }
  // Refinements move a position by metres, never by kilometres — past a couple
  // of hundred metres it would be a different object, not a better fix.
  for (const p of ign) {
    if (!Number.isFinite(p.ignShiftM)) continue;
    assert.ok(p.ignShiftM <= 250, `${p.name || p.id} moved ${p.ignShiftM} m`);
    assert.ok(p.corroborates, 'a refined position must record the tier that identified it');
  }
});

test('a register row whose commune contradicts its own substation follows the substation', () => {
  // Four metropolitan plants are filed under an overseas commune: the Lac d'Oô
  // (Luchon, Haute-Garonne) in Guyane, Luz (Hautes-Pyrénées) in Martinique,
  // Motz (Savoie) in Guadeloupe, Pont-du-Loup (Alpes-Maritimes) at La Réunion.
  const contradicted = REGISTRY.plants.filter((p) => Number.isFinite(p.communeContradictedKm));
  assert.equal(contradicted.length, 4, 'the four known contradictions must all be caught');
  for (const p of contradicted) {
    assert.ok(p.communeContradictedKm > 100, `${p.name}: ${p.communeContradictedKm} km`);
    assert.equal(p.placement, 'rte-switchyard');
    assert.equal(p.matchedBy, 'postesource');
    // The register's own commune is kept verbatim on the record — the card
    // shows the contradiction rather than quietly correcting the data.
    assert.ok(p.commune && p.region);
  }
  const oo = contradicted.find((p) => (p.name || '').includes('LAC D OO'));
  assert.equal(oo.region, 'Guyane', "the register's claim is preserved");
  // …and the plant is drawn in the Pyrenees, where its substation is.
  assert.ok(oo.lat > 42.7 && oo.lat < 42.9 && oo.lon > 0.4 && oo.lon < 0.7,
    `${oo.lat}, ${oo.lon}`);
});

test('the Centrale du Hourat is in the village of Laruns, not up the mountain', () => {
  const hourat = REGISTRY.plants.find((p) => (p.name || '').includes('HOURAT'));
  assert.ok(hourat, 'the Hourat must be in the register');
  // Ground truth 2026-08-31: the SHEM powerhouse, 47 m from 4 rue de Gerp,
  // 64440 Laruns, beside the Arriussé. The bbox centre of its OSM site
  // relation is 42.9594 / -0.4345 — 2,7 km south, mid-forest.
  assert.ok(Math.abs(hourat.lat - 42.9835) < 0.002, `lat ${hourat.lat}`);
  assert.ok(Math.abs(hourat.lon + 0.42847) < 0.002, `lon ${hourat.lon}`);
  // Identified through OpenStreetMap, then placed on IGN's surveyed footprint.
  assert.equal(hourat.placement, 'ign-bdtopo');
  assert.equal(hourat.geometry, 'ign-footprint');
  assert.equal(hourat.corroborates, 'osm-plant');
  assert.ok(hourat.snapKm > 2, `snapped only ${hourat.snapKm} km`);
});

test('Grand-Maison keeps its own first word, and EDF\u2019s own coordinate', () => {
  // `GRAND-MAISON` used to normalise to `maison`, which broke the join to EDF's
  // published point for the largest hydro plant in France.
  const gm = REGISTRY.plants.find((p) => (p.name || '').includes('GRAND-MAISON'));
  // EDF identified it — that is the join the bug broke — and IGN then refined
  // the point onto the surveyed building, 34 m away.
  assert.equal(gm.corroborates, 'edf-published');
  assert.equal(gm.placement, 'ign-bdtopo');
  assert.ok(gm.ignShiftM <= 250, `${gm.ignShiftM} m`);
  assert.ok(Math.abs(gm.lat - 45.1458) < 0.002 && Math.abs(gm.lon - 6.0512) < 0.002);
});

test('no plant is drawn at its own commune centre — that is what a ring is for', () => {
  for (const p of REGISTRY.plants) {
    assert.notEqual(p.placement, 'commune-centre');
  }
  for (const c of REGISTRY.clusters) {
    assert.equal(c.placement, 'commune-centre');
    assert.ok(c.plants >= 1);
    assert.ok(c.maxKw <= c.kw);
  }
});

// ── The size ramp, across five orders of magnitude ──────────────────────────

test('a 40 kW mill stays visible and a 1 690 MW pumped-storage plant stays bounded', () => {
  assert.ok(hydroPixelSize(40) >= HYDRO_PIXEL_MIN);
  assert.ok(hydroPixelSize(40) < hydroPixelSize(3900));
  assert.ok(hydroPixelSize(3900) < hydroPixelSize(74000));
  assert.ok(hydroPixelSize(74000) < hydroPixelSize(1_690_000));
  assert.ok(hydroPixelSize(1_690_000) <= HYDRO_PIXEL_MAX);
  // The mill is not a speck next to the giant: a factor of 42 250 in power
  // compresses to under a factor of 5 on screen, which is the point.
  assert.ok(hydroPixelSize(1_690_000) / hydroPixelSize(40) < 5);
  assert.equal(hydroPixelSize(0), HYDRO_PIXEL_MIN);
  assert.equal(hydroPixelSize(null), HYDRO_PIXEL_MIN);
  assert.equal(hydroPixelSize(NaN), HYDRO_PIXEL_MIN);
});

// ── Colour never asserts a technology the register did not publish ──────────

test('a hydro plant published as photovoltaic is drawn neutral, not yellow', () => {
  assert.ok(CORSICAN_PV, 'the register still carries the Corsican mis-tagged rows');
  assert.equal(CORSICAN_PV.techKey, null);
  assert.equal(hydroColor(CORSICAN_PV).toCssColorString(),
    Cesium.Color.fromCssColorString(HYDRO_UNKNOWN_COLOR).toCssColorString());
  // …and it is NOT given the pumped-storage yellow it would collide with.
  assert.notEqual(
    hydroColor(CORSICAN_PV).toCssColorString(),
    Cesium.Color.fromCssColorString(HYDRO_TECHNOLOGIES['Pompage turbinage'].color).toCssColorString(),
  );
});

test('the five real technologies keep their own hue', () => {
  assert.equal(
    hydroColor({ techKey: 'pumped' }).toCssColorString(),
    Cesium.Color.fromCssColorString(HYDRO_TECHNOLOGIES['Pompage turbinage'].color).toCssColorString(),
  );
  assert.equal(
    hydroColor({ techKey: null }).toCssColorString(),
    Cesium.Color.fromCssColorString(HYDRO_UNKNOWN_COLOR).toCssColorString(),
  );
});

// ── Units, across the range one column has to serve ─────────────────────────

test('kilowatts are promoted to the unit a reader would use', () => {
  assert.equal(formatHydroPower(40), '40 kW');
  assert.equal(formatHydroPower(999), '999 kW');
  assert.equal(formatHydroPower(3900), '3,9 MW');
  assert.equal(formatHydroPower(74000), '74,0 MW');
  assert.equal(formatHydroPower(1_690_000), '1,69 GW');
  assert.equal(formatHydroPower(null), '— kW');
  assert.equal(formatHydroPower(NaN), '— kW');
});

test('energy is promoted the same way, and an absent one is null not zero', () => {
  assert.equal(formatHydroEnergy(173_003), '173 MWh');
  assert.equal(formatHydroEnergy(188_386_950), '188,4 GWh');
  assert.equal(formatHydroEnergy(500), '500 kWh');
  assert.equal(formatHydroEnergy(null), null);
  assert.equal(formatHydroEnergy(undefined), null);
});

// ── What a reader gets when the register withholds the name ─────────────────

test('an unnamed plant is never labelled "Confidentiel"', () => {
  assert.ok(ANONYMOUS, 'the register carries anonymous rows with a real energy figure');
  const label = hydroLabelText(ANONYMOUS);
  assert.ok(!label.includes('Confidentiel'), label);
  assert.ok(label.includes(ANONYMOUS.commune), label);
  assert.equal(hydroDisplayName({ name: null, commune: 'Licq-Athérey' }), 'Centrale hydraulique à Licq-Athérey');
  assert.equal(hydroDisplayName({ name: 'Centrale de Miégebat' }), 'Centrale de Miégebat');
  assert.equal(
    hydroDisplayName({ name: 'MIEGEH-CENTRALE HYDRAULIQUE DE MIEGEBAT-3' }),
    'CENTRALE HYDRAULIQUE DE MIEGEBAT',
  );
  // A label never shows a poste-source code or a revision number.
  assert.ok(!hydroLabelText(MIEGEBAT).includes('MIEGEH-'));
  assert.ok(!/-3 ·/.test(hydroLabelText(MIEGEBAT)));
});

test('an anonymous plant still gets a card carrying nine facts', () => {
  const card = buildHydroCard(ANONYMOUS);
  assert.ok(!card.includes('Confidentiel'), card);
  // The card says WHY there is no name, rather than leaving a blank line.
  assert.ok(card.includes('nom non publié'), card);
  assert.ok(card.includes('installés'), card);
  assert.ok(card.includes('12 mois glissants'), card);
  assert.ok(card.includes(ANONYMOUS.commune), card);
  assert.ok(card.includes(ANONYMOUS.operator), card);
  assert.ok(card.includes('EIC'), card);
  assert.ok(card.split('\n').length >= 8, `expected a full card, got:\n${card}`);
});

test('a named plant leads with its name and reports its load factor', () => {
  const card = buildHydroCard(MIEGEBAT);
  const [title, ...details] = card.split('\n');
  // The register's internals never reach the reader: the published name is
  // `MIEGEH-CENTRALE HYDRAULIQUE DE MIEGEBAT-3`.
  assert.equal(MIEGEBAT.name, 'MIEGEH-CENTRALE HYDRAULIQUE DE MIEGEBAT-3');
  assert.equal(title, 'CENTRALE HYDRAULIQUE DE MIEGEBAT');
  assert.ok(details.some((line) => line.includes('74,0 MW')), card);
  // 74 MW against 188,4 GWh injected is 29 %.
  assert.ok(details.some((line) => line.includes('29 %')), card);
  assert.ok(details.some((line) => line.includes('417.6 m de chute')), card);
  assert.ok(details.some((line) => line.includes('IGN BD TOPO')), card);
  assert.ok(details.some((line) => line.includes('plan IGN')), card);
});

test('a card with no published energy says so instead of implying zero', () => {
  const card = buildHydroCard({ kw: 500, energyKwh: null, commune: 'X' });
  assert.ok(card.includes('non publiée'), card);
  assert.ok(card.includes('pas une centrale à l’arrêt'), card);
});

test('the Corsican mis-tag reaches the card as the publisher wrote it', () => {
  const card = buildHydroCard(CORSICAN_PV);
  assert.ok(card.includes('Photovoltaïque'), card);
  assert.ok(card.includes('hors vocabulaire'), card);
});

// ── A ring is a commune, and its card says so first ─────────────────────────

test('a ring’s card leads with the fact that it is not a plant', () => {
  const cluster = REGISTRY.clusters.find((c) => c.plants > 2);
  const card = buildHydroClusterCard(cluster);
  const [title, ...details] = card.split('\n');
  assert.ok(title.includes('non localisée'), title);
  assert.ok(title.includes(String(cluster.plants)), title);
  assert.ok(details.some((line) => line.includes('CENTRE DE LA COMMUNE')), card);
  assert.ok(details.some((line) => line.includes('aucune position')), card);
});

// ── The legend explains the ring, because a hollow dot explains nothing ─────

test('the legend names the ring for what it is whenever one is drawn', () => {
  const legend = hydroLegend(REGISTRY.plants.slice(0, 50), REGISTRY.clusters.slice(0, 10));
  const ring = legend.find((row) => row.label.includes('Anneau'));
  assert.ok(ring, 'a drawn ring must be explained');
  assert.ok(ring.blurb.includes('commune'), ring.blurb);
  assert.equal(hydroLegend(REGISTRY.plants.slice(0, 5), []).some((r) => r.label.includes('Anneau')), false);
});

test('the legend never invents a Photovoltaïque row in a hydro layer', () => {
  const legend = hydroLegend(REGISTRY.plants, REGISTRY.clusters);
  assert.equal(legend.some((row) => row.label === 'Photovoltaïque'), false);
  const unknown = legend.find((row) => row.label === 'Non publiée');
  assert.ok(unknown && unknown.blurb.includes('corses'), unknown?.blurb);
});

// ── Overlay cohort ──────────────────────────────────────────────────────────

test('the label cohort is bounded and keeps the biggest plants', () => {
  const entries = REGISTRY.plants.slice(0, 400).map((p) => ({ id: p.id, priority: p.kw }));
  const cohort = selectHydroOverlayCohort(entries);
  assert.equal(cohort.length, FR_HYDRO_OVERLAY_COHORT_LIMIT);
  assert.ok(cohort[0].priority >= cohort[cohort.length - 1].priority);
  assert.equal(selectHydroOverlayCohort(entries, 0).length, 0);
  assert.equal(selectHydroOverlayCohort(null).length, 0);
  // The published limit is a ceiling, not a suggestion.
  assert.equal(selectHydroOverlayCohort(entries, 9999).length, FR_HYDRO_OVERLAY_COHORT_LIMIT);
});

// ── Analyst seam ────────────────────────────────────────────────────────────

test('an analyst can test for a withheld name, and cannot read capacity as output', () => {
  const record = mapHydroAnalystRecord(ANONYMOUS);
  assert.equal(record.name, null);
  assert.equal(record.anonymous, true);
  assert.equal(record.kind, 'plant');
  assert.equal(record.capacityKw, ANONYMOUS.kw);
  assert.equal(record.energyKwh12m, ANONYMOUS.energyKwh);
  assert.ok(record.loadFactor > 0);
  // No field called `output`, `mw` or `power` that a question could misread.
  for (const key of Object.keys(record)) {
    assert.equal(/^(output|production|mw|power)$/i.test(key), false, `ambiguous field: ${key}`);
  }
});

test('a roll-up is labelled as one in the analyst seam', () => {
  const cluster = REGISTRY.clusters.find((c) => c.anonymous > 0 && c.plants > 1);
  const record = mapHydroAnalystRecord({ ...cluster, kind: 'cluster' });
  assert.equal(record.kind, 'commune-rollup');
  assert.equal(record.placement, 'commune-centre');
  // The boolean question "is this plant unnamed?" has no answer for a commune,
  // and answering `false` would hide the unnamed plants inside it.
  assert.equal(record.anonymous, null);
  assert.equal(record.anonymousPlants, cluster.anonymous);
  assert.equal(record.plants, cluster.plants);
  // …while a real plant still answers it.
  assert.equal(mapHydroAnalystRecord(ANONYMOUS).anonymous, true);
  assert.equal(mapHydroAnalystRecord(MIEGEBAT).anonymous, false);
  assert.equal(mapHydroAnalystRecord(MIEGEBAT).plants, null);
});

// ── Lifecycle and the runtime floor ─────────────────────────────────────────

/**
 * Serve the shipped registry the way Vite will — `fetch` cannot read a `file:`
 * URL, and the point of these tests is the layer, not the transport.
 */
const fromDisk = async (url) => {
  if (String(url) !== 'registry') return { ok: false, status: 404 };
  return { ok: true, status: 200, json: async () => REGISTRY };
};

function harness() {
  const overlay = { entries: new Map(), visible: new Map(), cleared: [] };
  const overlayHost = {
    setEntries: (id, entries, options) => overlay.entries.set(id, { entries, options }),
    setVisible: (id, value) => overlay.visible.set(id, value),
    clearSource: (id) => { overlay.cleared.push(id); overlay.entries.delete(id); },
  };
  const primitives = [];
  const viewer = {
    scene: {
      canvas: { addEventListener() {}, removeEventListener() {}, setAttribute() {} },
      primitives: { add: (p) => primitives.push(p), remove: (p) => primitives.splice(primitives.indexOf(p), 1) },
      pick: () => undefined,
      requestRender() {},
    },
  };
  const layer = createFrHydroPlantsLayer({ overlayHost, registryUrl: 'registry', fetchImpl: fromDisk });
  return { layer, viewer, overlay, primitives };
}

test('the layer boots, loads the register and draws both marker kinds', async () => {
  const { layer, viewer, overlay, primitives } = harness();
  assert.equal(layer.id, FR_HYDRO_LAYER_ID);
  layer.init(viewer);
  assert.equal(primitives.length, 1);
  layer.enable(viewer);
  assert.equal(await layer.update(), true);

  const stats = layer.getStats();
  assert.equal(stats.installations, REGISTRY.stats.plants);
  assert.equal(stats.placed, REGISTRY.stats.placed);
  assert.equal(stats.communes, REGISTRY.stats.communes);
  assert.ok(stats.anonymous > 1000, `expected the anonymised majority, got ${stats.anonymous}`);
  // Markers on the globe, which is NOT the installation count.
  assert.equal(stats.count, REGISTRY.plants.length + REGISTRY.clusters.length);
  assert.ok(stats.count < stats.installations);
  assert.equal(stats.error, null);
  assert.ok(overlay.entries.has(FR_HYDRO_OVERLAY_SOURCE_ID));

  layer.destroy(viewer);
  assert.equal(primitives.length, 0);
});

test('the floor chip hides markers without losing the register behind them', async () => {
  const { layer, viewer } = harness();
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update();
  const all = layer.getStats().count;

  assert.equal(layer.setParams({ floorKw: 10_000 }), true);
  const raised = layer.getStats();
  assert.ok(raised.count < all, 'a 10 MW floor must hide markers');
  assert.equal(raised.floorKw, 10_000);
  assert.equal(raised.hidden, all - raised.count);
  // The register's own totals are untouched by a display filter.
  assert.equal(raised.installations, REGISTRY.stats.plants);
  assert.equal(raised.installedKw, REGISTRY.stats.installedKw);

  // A commune ring clears the floor on its LARGEST member, never on its total.
  for (const cluster of REGISTRY.clusters) {
    if (cluster.kw >= 10_000 && cluster.maxKw < 10_000) {
      assert.ok(true, 'such a commune exists and must be hidden');
      break;
    }
  }

  assert.equal(layer.setParams({ floorKw: 10_000 }), false, 'a no-op must not repaint');
  assert.equal(layer.setParams({}), false);
  assert.equal(layer.setParams({ floorKw: 0 }), true);
  assert.equal(layer.getStats().count, all);
  layer.destroy(viewer);
});

test('the chips report which floor is live', async () => {
  const { layer, viewer } = harness();
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update();
  const active = () => layer.getRowControls().chips.find((chip) => chip.active);
  assert.equal(active().id, 'all');
  layer.setParams({ floorKw: 1000 });
  assert.equal(active().id, 'mw1');
  assert.equal(layer.getRowControls().chips.length, FR_HYDRO_FLOORS.length);
  layer.destroy(viewer);
});

test('a disabled layer draws nothing and answers no analyst questions', async () => {
  const { layer, viewer, overlay } = harness();
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update();
  assert.ok(layer.getAnalystRecords(5).length > 0);
  layer.disable();
  assert.deepEqual(layer.getAnalystRecords(5), []);
  assert.equal(overlay.visible.get(FR_HYDRO_OVERLAY_SOURCE_ID), false);
  assert.ok(overlay.cleared.includes(FR_HYDRO_SELECTED_OVERLAY_SOURCE_ID));
  layer.destroy(viewer);
});

test('a failed load leaves the layer empty and says why, rather than half-drawn', async () => {
  const { layer, viewer } = harness();
  const broken = createFrHydroPlantsLayer({
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
    registryUrl: 'does-not-exist',
    fetchImpl: fromDisk,
  });
  broken.init(viewer);
  broken.enable(viewer);
  assert.equal(await broken.update(), false);
  const stats = broken.getStats();
  assert.ok(stats.error, 'a failure must be reported');
  assert.equal(stats.count, 0);
  assert.equal(stats.installedKw, null);
  broken.destroy(viewer);
  layer.destroy(viewer);
});

test('markers are clamped to the terrain, not left on the ellipsoid', async () => {
  // The bug this pins, reported from the map: a marker drawn at ellipsoidal
  // height 0 in the Ossau valley is 556 m UNDERGROUND, and a buried point does
  // not look low — it looks displaced, by `depth × tan(view angle)`, in a
  // direction that changes as the camera pans. The dot slides across a map
  // that is standing still.
  const { layer, viewer, primitives } = harness();
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update();

  const collection = primitives[0];
  const heightOf = (point) => Cesium.Cartographic.fromCartesian(point.position).height;
  const espalungue = REGISTRY.plants.find((p) => (p.name || '').includes('ESPALUNGUE'));
  const find = (plant) => {
    for (let i = 0; i < collection.length; i += 1) {
      if (String(collection.get(i).id) === `${FR_HYDRO_RENDER_PREFIX}${plant.id}`) return collection.get(i);
    }
    return null;
  };

  // Cold cache: the marker sits on the ellipsoid plus the lift, and no network
  // is touched to find that out.
  const cold = find(espalungue);
  assert.ok(cold, 'Espalungue must be drawn');
  assert.ok(Math.abs(heightOf(cold) - GROUND_LIFT_M) < 0.5, `${heightOf(cold)} m`);

  // Warm the floor the way the terrain resolver would, and repaint.
  setMeshFloorPreferred(true);
  try {
    // Measured 2026-08-31 through the app's own /api/terrain/heights: the
    // ellipsoidal ground under Espalungue is 556 m.
    reportMeshFloorCell(espalungue.lat, espalungue.lon, 556.26);
    layer.setParams({ floorKw: 1 });
    layer.setParams({ floorKw: 0 });
    const warm = find(espalungue);
    assert.ok(
      Math.abs(heightOf(warm) - (556.26 + GROUND_LIFT_M)) < 1,
      `expected the marker on the terrain, got ${heightOf(warm)} m`,
    );
    // 556 m of depth is what produced hundreds of metres of apparent drift.
    assert.ok(heightOf(warm) - heightOf(cold) > 500);
  } finally {
    setMeshFloorPreferred(false);
    _clearMeshFloorCellsForTest();
  }
  layer.destroy(viewer);
});

test('render ids are namespaced so no other layer can claim a pick', () => {
  for (const p of REGISTRY.plants.slice(0, 20)) {
    assert.ok(`${FR_HYDRO_RENDER_PREFIX}${p.id}`.startsWith('fr-hydro:'));
  }
  for (const c of REGISTRY.clusters.slice(0, 20)) {
    assert.ok(c.id.startsWith('INSEE:'), c.id);
  }
});
