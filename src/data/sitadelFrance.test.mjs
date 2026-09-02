// What the DRAWN layer is allowed to claim, once the join in `sitadelFeed.js`
// has already been proved.
//
// One property runs through this whole file and it is the one the brief was
// written around: **the rate at which the join succeeded travels with every
// object it produced.** A permit drawn in Paris (91.3% of the commune placed)
// and a permit drawn in Toulouse (7.6%) look identical on the globe, so if the
// card does not carry the commune's rate and the year's rate, the layer is
// showing an operator a confident dot with no way to weigh it. Each test below
// closes one of the doors that could come through: the record index, the
// selection card, the row legend, `getStats()`, and the DETECT callout.
//
// The second property is that a permit which could not be placed is COUNTED
// and never drawn. There is no colour for it in the legend, because the panel's
// swatch is the colour the object is painted and that object is nowhere; and
// there is no fallback coordinate anywhere in this file.
//
// The third is that the layer holds exactly ONE commune and always says which.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import sitadelFranceLayer, {
  SITADEL_COMMUNE_URL,
  SITADEL_FILL_ALPHA,
  SITADEL_FOCUS_GRID_DEG,
  SITADEL_FR_LAYER_ID,
  SITADEL_FR_OVERLAY_SOURCE_ID,
  SITADEL_MAX_ALTITUDE_M,
  SITADEL_POINT_MAX_PX,
  SITADEL_POINT_MIN_PX,
  buildSitadelLoadingLabel,
  buildSitadelSelectionLabel,
  createSitadelSelectedOverlayEntry,
  resolveSitadelPickId,
  sitadelDetectLabel,
  sitadelDetectType,
  sitadelFocusKey,
  sitadelJoinLines,
  sitadelParcelOwners,
  sitadelPermitAnchor,
  sitadelPermitColor,
  sitadelPermitRecords,
  sitadelPermitSize,
  sitadelRingPositions,
  sitadelViewport,
  _clearSitadelSelectionForTest,
  _selectSitadelForTest,
  _setSitadelStateForTest,
  _sitadelDetectablesForTest,
  _sitadelGateStateForTest,
  _sitadelLoadForTest,
  _sitadelRecordForTest,
  _sitadelRecordIdsForTest,
  _sitadelRowControlsForTest,
  _sitadelSelectedIdForTest,
  _sitadelStatsForTest,
} from './sitadelFrance.js';
import {
  SITADEL_BANDS,
  communeCadastreCodes,
  indexCadastreParcels,
  projectSitadelCommune,
} from './sitadelFeed.js';

// Cesium reads the aliased line-width range off a live WebGL context, and there
// is none under `node --test`, so `ContextLimits._maximumAliasedLineWidth` sits
// at 0 and EVERY `RenderState.fromCache` throws "renderState.lineWidth is out
// of range" — including the default lineWidth of 1. Priming it is what lets the
// real `selectPermit()` run here; it is a property of the harness, not of the
// layer. `GroundPolylineGeometry` bakes its width into extruded geometry rather
// than into a GL line, which is why the parcel edges pass 1.5 px and the
// selection 5 px in production without trouble.
const { default: ContextLimits } = await import('@cesium/engine/Source/Renderer/ContextLimits.js');
ContextLimits._maximumAliasedLineWidth = 16;

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
// `toLocaleString('fr-FR')` separates thousands with U+202F.
const norm = (value) => String(value).replace(/[\s  ]+/g, ' ');

const H44 = read('sitadel-logements-44109-sample.json');
const D44 = read('sitadel-demolir-44109-sample.json');
const C44 = read('sitadel-cadastre-44109-sample.json');
const H31 = read('sitadel-logements-31555-sample.json');
const C31 = read('sitadel-cadastre-31555-sample.json');
const COMMUNE44 = read('sitadel-commune-44109-sample.json')[0];

function nantesPack() {
  const { index, parcels } = indexCadastreParcels([C44]);
  return projectSitadelCommune({
    housing: H44,
    demolition: D44,
    index,
    commune: COMMUNE44,
    outline: { parts: [[COMMUNE44.contour.coordinates[0]]], simplified: true, sourceParts: 1, servedParts: 1 },
    millesime: '2026-08',
    cadastreEdition: '2026-06-01',
    cadastreCommunes: ['44109'],
    cadastreParcels: parcels,
  });
}

function toulousePack() {
  const { index, parcels } = indexCadastreParcels([C31]);
  return projectSitadelCommune({
    housing: H31,
    index,
    commune: { code: '31555', nom: 'Toulouse', departement: { code: '31', nom: 'Haute-Garonne' } },
    millesime: '2026-08',
    cadastreEdition: '2026-06-01',
    cadastreCommunes: communeCadastreCodes('31555'),
    cadastreParcels: parcels,
  });
}

const PACK = nantesPack();
const TOULOUSE = toulousePack();

/** A scene that records what the selection and the batches put on it. */
function fakeViewer({ altitude = 900, lat = 47.2184, lon = -1.5536 } = {}) {
  const added = [];
  const primitives = [];
  return {
    added,
    primitives,
    camera: {
      positionCartographic: { height: altitude },
      computeViewRectangle: () => ({
        south: (lat - 0.02) * Math.PI / 180,
        north: (lat + 0.02) * Math.PI / 180,
        west: (lon - 0.03) * Math.PI / 180,
        east: (lon + 0.03) * Math.PI / 180,
      }),
      pickEllipsoid: () => ({ x: 1, y: 1, z: 1 }),
    },
    scene: {
      canvas: { clientWidth: 1280, clientHeight: 720 },
      globe: {
        show: true,
        ellipsoid: {
          cartesianToCartographic: () => ({
            latitude: lat * Math.PI / 180,
            longitude: lon * Math.PI / 180,
            height: 0,
          }),
        },
      },
      requestRender: () => {},
      primitives: {
        add: (p) => { primitives.push(p); return p; },
        remove: (p) => {
          const i = primitives.indexOf(p);
          if (i >= 0) primitives.splice(i, 1);
          return i >= 0;
        },
      },
      groundPrimitives: {
        add: (p) => { added.push(p); return p; },
        remove: (p) => {
          const i = added.indexOf(p);
          if (i >= 0) added.splice(i, 1);
          return i >= 0;
        },
        contains: (p) => added.includes(p),
      },
    },
  };
}

/** A recording overlay host, so the card path runs with no real overlay. */
function recordingHost() {
  const calls = { set: [], cleared: [], visible: [] };
  return {
    calls,
    setEntries: (sourceId, entries) => calls.set.push({ sourceId, entries }),
    clearSource: (sourceId) => calls.cleared.push(sourceId),
    setVisible: (sourceId, visible) => calls.visible.push({ sourceId, visible }),
  };
}

test('the layer object satisfies the manager contract and names its own subject', () => {
  assert.equal(sitadelFranceLayer.id, SITADEL_FR_LAYER_ID);
  assert.equal(SITADEL_FR_LAYER_ID, 'sitadel-fr');
  assert.ok(/^[a-z0-9-]+$/.test(sitadelFranceLayer.id));
  for (const hook of ['init', 'enable', 'disable', 'update']) {
    assert.equal(typeof sitadelFranceLayer[hook], 'function', hook);
  }
  for (const hook of ['getStats', 'getRowControls', 'getDetectableObjects', 'destroy']) {
    assert.equal(typeof sitadelFranceLayer[hook], 'function', hook);
  }
  assert.equal(sitadelFranceLayer.icon, '🏗');
  // The neighbours on the BATI & TERRITOIRE shelf.
  assert.ok(!['€', '▤', '▦', '🎓', '🏛'].includes(sitadelFranceLayer.icon));
  assert.ok(sitadelFranceLayer.name.includes('Sitadel'));
  assert.ok(sitadelFranceLayer.source.includes('SDES'));
  assert.ok(sitadelFranceLayer.source.includes('Etalab'), 'the join partner is part of the provenance');
  assert.ok(sitadelFranceLayer.updateInterval > 0);
});

test('one record per PLACED permit, keyed on the file and the ordinal, never on NUM_DAU', () => {
  const records = sitadelPermitRecords(PACK);
  assert.equal(records.length, PACK.summary.placed);
  assert.equal(records.length, 9);
  assert.equal(new Set(records.map((r) => r.id)).size, 9, 'no two records share an id');
  // NUM_DAU is NOT a primary key — 3 561 distinct values across Paris' 3 595
  // housing rows — so the id has to carry the file and the row's own ordinal.
  for (const record of records) {
    assert.ok(record.id.startsWith(`${SITADEL_FR_LAYER_ID}:44109:`), record.id);
    assert.ok(/:(lgt|dem):\d+$/.test(record.id), record.id);
    assert.ok(Number.isFinite(record.at.lat) && Number.isFinite(record.at.lon));
    assert.ok(record.at.lat > 47.1 && record.at.lat < 47.3, 'inside Nantes');
  }
  // The demolition file gets its own namespace inside the same commune.
  assert.equal(records.filter((r) => r.permit.f === 'dem').length, 2);
});

test('a permit sits on the biggest parcel it names, never between them', () => {
  const multi = PACK.permits.find((permit) => permit.px.length > 1);
  assert.ok(multi, 'the fixture must carry a multi-parcel permit');
  const anchor = sitadelPermitAnchor(multi, PACK.parcels);
  const chosen = multi.px
    .map((slot) => PACK.parcels[slot])
    .sort((a, b) => b.a - a.a)[0];
  assert.deepEqual(anchor, { lon: chosen.p[0], lat: chosen.p[1] });
  // It is one of the published anchors, not a mean of them — a midpoint
  // between two plots can land in the street.
  const published = new Set(multi.px.map((slot) => PACK.parcels[slot].p.join(',')));
  assert.ok(published.has(`${anchor.lon},${anchor.lat}`));
  assert.equal(sitadelPermitAnchor({ px: [] }, PACK.parcels), null);
  assert.equal(sitadelPermitAnchor(null, PACK.parcels), null);
  assert.equal(sitadelPermitAnchor({ px: [999] }, PACK.parcels), null, 'a dangling slot places nothing');
});

test('the newest authorisation colours a shared parcel, and the others are counted', () => {
  const owners = sitadelParcelOwners(PACK);
  assert.equal(owners.size, PACK.parcels.length);
  for (const [slot, owner] of owners) {
    assert.ok(owner.permit.px.includes(slot));
    // The owner is the newest permit naming the parcel: no other permit on it
    // may carry a later authorisation date.
    for (const permit of PACK.permits) {
      if (!permit.px.includes(slot) || permit === owner.permit) continue;
      assert.ok(String(permit.da) <= String(owner.permit.da),
        `${permit.i} (${permit.da}) is newer than the owner ${owner.permit.i} (${owner.permit.da})`);
      assert.ok(owner.permits > 1, 'a shared parcel must count its other permits');
    }
  }
  assert.equal(sitadelParcelOwners(null).size, 0);
  assert.equal(sitadelParcelOwners({ permits: [] }).size, 0);
});

test('every parcel fill resolves to a record, so clicking a plot selects its permit', () => {
  // The ground batch tags each parcel instance with the render id of the permit
  // that owns it. That id is rebuilt from the OWNER'S OWN INDEX into
  // `payload.permits`, while the record list skips any permit it could not
  // anchor — so the two would drift apart if the records were keyed on their
  // position in the record array instead of in the pack. A drift here is a
  // parcel that is drawn and cannot be clicked.
  _setSitadelStateForTest({ payload: PACK });
  const ids = new Set(_sitadelRecordIdsForTest());
  const owners = sitadelParcelOwners(PACK);
  assert.ok(owners.size > 0);
  for (const [slot, owner] of owners) {
    const id = `${SITADEL_FR_LAYER_ID}:${PACK.insee}:${owner.permit.f || 'lgt'}:${owner.index}`;
    assert.ok(ids.has(id), `parcel ${PACK.parcels[slot].k} points at a record that does not exist: ${id}`);
    assert.equal(_sitadelRecordForTest(id).permit, owner.permit);
  }
  // …and every record owns at least one parcel, so no dot floats free of the
  // fill under it.
  for (const id of ids) {
    const record = _sitadelRecordForTest(id);
    assert.ok(record.permit.px.some((slot) => owners.has(slot)), id);
  }
  _clearSitadelSelectionForTest();
});

test('a demolition draws at the floor, because its file counts no dwelling', () => {
  const demolition = PACK.permits.find((permit) => permit.f === 'dem');
  assert.equal(demolition.lgt, null, 'the permis de demolir file has 33 columns and no dwelling count');
  assert.equal(sitadelPermitSize(demolition), SITADEL_POINT_MIN_PX);
  assert.equal(sitadelPermitColor(demolition), SITADEL_BANDS.find((b) => b.id === 'demolition').color);

  const big = PACK.permits.find((permit) => permit.lgt === 27);
  assert.ok(sitadelPermitSize(big) > SITADEL_POINT_MIN_PX);
  assert.ok(sitadelPermitSize(big) < SITADEL_POINT_MAX_PX);
  // A housing permit creating zero dwellings is also at the floor, and it is a
  // different fact from a demolition — the card is what tells them apart.
  const zero = PACK.permits.find((permit) => permit.f === 'lgt' && permit.lgt === 0);
  assert.ok(zero);
  assert.equal(sitadelPermitSize(zero), SITADEL_POINT_MIN_PX);
  assert.notEqual(sitadelPermitColor(zero), sitadelPermitColor(demolition));
});

test('the card publishes the commune rate AND the year rate — the join never travels alone', () => {
  _setSitadelStateForTest({ payload: PACK });
  const record = _sitadelRecordForTest(_sitadelRecordIdsForTest()[0]);
  const card = norm(buildSitadelSelectionLabel(record, PACK));
  assert.ok(card.includes('Nantes : 9 des 14 autorisations posées (64,3 %)'), card);
  assert.ok(card.includes('jointure cadastrale, aucune coordonnée publiée'), card);
  const year = record.permit.y;
  const tally = PACK.years.find((entry) => entry.year === year);
  assert.ok(card.includes(`Autorisations de ${year} ici : ${tally.placed} des ${tally.permits} posées`), card);
  assert.ok(card.includes('une parcelle est divisée quand on y construit'), card);
  assert.ok(card.includes('Sitadel millésime 2026-08 · cadastre Etalab 2026-06-01'), card);
  assert.ok(card.includes('Licence Ouverte'), card);
  // The feed's own last line survives being wrapped.
  assert.ok(card.includes('Position calculée par jointure cadastrale'), card);
  _clearSitadelSelectionForTest();
});

test('the join lines are refused rather than faked when there is no pack', () => {
  assert.deepEqual(sitadelJoinLines(null), []);
  assert.deepEqual(sitadelJoinLines({}), []);
  // A commune where NOTHING was placed still gets a line, and it says 0.
  const empty = { commune: 'Nulle-Part', summary: { placed: 0, permits: 12 }, millesime: '2026-08' };
  const lines = sitadelJoinLines(empty).map(norm);
  assert.ok(lines[0].startsWith('Nulle-Part : 0 des 12 autorisations posées (0 %)'), lines[0]);
  // A permit whose year is not in the tally gets no year line rather than a
  // divide by zero.
  assert.equal(sitadelJoinLines(empty, { y: '2013' }).length, 2);
  assert.equal(buildSitadelSelectionLabel(null), '');
  assert.equal(buildSitadelSelectionLabel({}), '');
});

test('a Toulouse card carries the 66,7% that tells an operator not to trust the dot', () => {
  // The fixture is the real ambiguity: one of three permits could not be
  // placed because 34 Toulouse parcels answer to `31555AB0069`.
  assert.equal(TOULOUSE.summary.ambiguous, 1);
  assert.equal(TOULOUSE.summary.placed, 2);
  _setSitadelStateForTest({ payload: TOULOUSE });
  const card = norm(buildSitadelSelectionLabel(_sitadelRecordForTest(_sitadelRecordIdsForTest()[0]), TOULOUSE));
  assert.ok(card.includes('Toulouse : 2 des 3 autorisations posées (66,7 %)'), card);
  _clearSitadelSelectionForTest();
});

test('selecting a permit lights its parcels and paints exactly one card', () => {
  const host = recordingHost();
  const viewer = fakeViewer();
  _setSitadelStateForTest({ payload: PACK, overlayHost: host, viewer });
  const id = _sitadelRecordIdsForTest().find((key) => _sitadelRecordForTest(key).permit.px.length > 1);
  assert.ok(id, 'select a multi-parcel permit, so the highlight covers more than one ring');

  _selectSitadelForTest(id);
  assert.equal(_sitadelSelectedIdForTest(), id);
  const painted = host.calls.set.filter((call) => call.sourceId === SITADEL_FR_OVERLAY_SOURCE_ID);
  assert.equal(painted.length, 1);
  assert.equal(painted[0].entries.length, 1, 'exactly one card, never a cohort');
  assert.equal(painted[0].entries[0].protected, true);
  // The highlight is a SECOND ground polyline over the batched parcels, so
  // clearing has to take it off the scene again — a leaked primitive keeps a
  // de-selected plot lit.
  assert.equal(viewer.added.length, 1);
  // The dot grows in place; a batched instance cannot be restyled.
  const record = _sitadelRecordForTest(id);
  assert.ok(record.point.pixelSize > record.basePixelSize);

  _clearSitadelSelectionForTest();
  assert.equal(_sitadelSelectedIdForTest(), null);
  assert.ok(host.calls.cleared.includes(SITADEL_FR_OVERLAY_SOURCE_ID));
  assert.equal(viewer.added.length, 0, 'the highlight primitive must be removed');
});

test('an unknown id selects nothing rather than selecting the first permit', () => {
  const host = recordingHost();
  const viewer = fakeViewer();
  _setSitadelStateForTest({ payload: PACK, overlayHost: host, viewer });
  _selectSitadelForTest(`${SITADEL_FR_LAYER_ID}:44109:lgt:9999`);
  assert.equal(_sitadelSelectedIdForTest(), null);
  assert.equal(viewer.added.length, 0);
  assert.equal(host.calls.set.length, 0);
  _clearSitadelSelectionForTest();
});

test('a pick belonging to cadastre-fr is not answered by this layer', () => {
  _setSitadelStateForTest({ payload: PACK });
  const mine = _sitadelRecordIdsForTest()[0];
  assert.equal(resolveSitadelPickId({ id: mine }), mine);
  assert.equal(resolveSitadelPickId({ id: { id: mine } }), mine, 'a batched instance nests its id');
  assert.equal(resolveSitadelPickId({ id: 'cadastre-fr:44109000IN0620' }), null);
  assert.equal(resolveSitadelPickId(null), null);
  assert.equal(resolveSitadelPickId({}), null);
  _clearSitadelSelectionForTest();
});

test('the overlay entry hangs on the parcel it was computed for', () => {
  _setSitadelStateForTest({ payload: PACK });
  const record = _sitadelRecordForTest(_sitadelRecordIdsForTest()[0]);
  const entry = createSitadelSelectedOverlayEntry(record, PACK);
  assert.equal(entry.id, record.id);
  assert.equal(entry.variant, 'selected');
  assert.equal(entry.collisionGroup, 'ambient-card');
  assert.ok(entry.position);
  assert.ok(entry.details.length > 4);
  assert.equal(entry.accent, record.color, 'the card is accented in the permit’s own band');
  assert.equal(createSitadelSelectedOverlayEntry(null), null);
  assert.equal(createSitadelSelectedOverlayEntry({ id: 'x' }), null, 'no anchor, no card');
  _clearSitadelSelectionForTest();
});

test('the legend shows only bands that are on screen, and never an unplaced row', () => {
  _setSitadelStateForTest({ payload: PACK });
  const { chips, legend } = _sitadelRowControlsForTest();
  assert.deepEqual(chips, [], 'this layer owns no serialized option group');
  assert.ok(legend.length > 0);
  const drawn = PACK.summary.bands.filter((band) => band.count > 0);
  assert.equal(legend.length, drawn.length);
  assert.equal(legend.reduce((sum, row) => sum + row.count, 0), PACK.summary.placed);
  for (const row of legend) {
    assert.ok(row.count > 0, `${row.label} must not be listed at zero`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(row.color), row.color);
    assert.ok(row.blurb && row.blurb.length > 20, row.label);
  }
  // The panel's swatch IS the colour the object is painted, so a permit that is
  // nowhere may not have one.
  for (const forbidden of ['ambigu', 'introuvable', 'non posé', 'sans référence']) {
    assert.ok(!legend.some((row) => row.label.toLowerCase().includes(forbidden)),
      `"${forbidden}" must not be a legend swatch`);
  }
  _clearSitadelSelectionForTest();
  assert.deepEqual(_sitadelRowControlsForTest(), { chips: [], legend: [] });
});

test('getStats() reports what was NOT placed, and its status is guidance not a fault', () => {
  _setSitadelStateForTest({ payload: PACK });
  const stats = _sitadelStatsForTest();
  assert.equal(stats.status, 'ok');
  assert.equal(stats.count, 9);
  assert.equal(stats.insee, '44109');
  assert.equal(stats.commune, 'Nantes');
  assert.equal(stats.permits, 14);
  assert.equal(stats.placed, 9);
  assert.equal(stats.ambiguous, 0);
  assert.equal(stats.missing, 3);
  assert.equal(stats.noref, 2);
  assert.equal(stats.placementRate, 64.3);
  assert.equal(stats.millesime, '2026-08');
  assert.equal(stats.cadastreEdition, '2026-06-01');
  assert.equal(stats.mojibakeRepaired, 1);
  assert.ok(stats.loadingLabel.includes('Nantes'));
  assert.ok(!('error' in stats));

  // A camera above the gate is GUIDANCE: the panel keeps a green ON chip and
  // shows the prompt, instead of reading "too high" as a broken feed.
  _setSitadelStateForTest({ payload: PACK, status: 'too-high' });
  assert.equal(_sitadelStatsForTest().status, 'zoom-in');
  _setSitadelStateForTest({ payload: null, status: 'no-commune' });
  assert.equal(_sitadelStatsForTest().status, 'empty');
  assert.equal(_sitadelStatsForTest().placed, null, 'no pack, no number — never a zero');
  // A real failure is a real failure.
  _setSitadelStateForTest({ payload: null, status: 'unavailable', error: 'boom' });
  assert.equal(_sitadelStatsForTest().status, 'unavailable');
  assert.equal(_sitadelStatsForTest().error, 'boom');
  _clearSitadelSelectionForTest();
});

test('the row line names the commune first, and the counts it could not place', () => {
  _setSitadelStateForTest({ payload: PACK });
  const line = norm(buildSitadelLoadingLabel());
  assert.ok(line.startsWith('Nantes · 9 permis posés sur 14 parcelles'), line);
  assert.ok(line.includes('5 non posés (36 %)'), line);
  assert.ok(line.includes('millésime 2026-08'), line);
  // The outline is decimated, and the row says so rather than letting a
  // simplified boundary pass as the commune's own.
  assert.ok(line.includes('contour communal simplifié'), line);

  const high = norm(buildSitadelLoadingLabel({ status: 'too-high', payload: null }));
  assert.ok(high.includes('une commune à la fois'), high);
  assert.ok(high.includes('12 000 m'), high);
  const none = buildSitadelLoadingLabel({ status: 'no-commune', payload: null });
  assert.ok(norm(none).includes('Aucune commune française'), none);
  assert.equal(buildSitadelLoadingLabel({ status: 'idle', payload: null }), null);
  assert.ok(buildSitadelLoadingLabel({ loading: true, commune: 'Nantes' }).includes('Nantes'));
  _clearSitadelSelectionForTest();
});

test('the row line says when the demolition file did not answer', () => {
  const degraded = { ...PACK, summary: { ...PACK.summary, demolitionAvailable: false } };
  _setSitadelStateForTest({ payload: degraded });
  assert.ok(norm(buildSitadelLoadingLabel()).includes('fichier des démolitions indisponible'));
  _clearSitadelSelectionForTest();
});

test('the gate refuses above 12 000 m and answers the reason, not a blank', () => {
  assert.equal(SITADEL_MAX_ALTITUDE_M, 12_000);
  const low = sitadelViewport(fakeViewer({ altitude: 900 }));
  assert.equal(low.reason, null);
  assert.ok(Math.abs(low.focus.lat - 47.2184) < 1e-6);
  assert.equal(sitadelViewport(fakeViewer({ altitude: SITADEL_MAX_ALTITUDE_M })).reason, null,
    'the gate is inclusive at its own value');
  assert.equal(sitadelViewport(fakeViewer({ altitude: 12_001 })).reason, 'too-high');
  assert.equal(sitadelViewport(null).reason, 'no-view');
  // A camera aimed at the sky picks no ellipsoid point.
  const skyward = fakeViewer();
  skyward.camera.pickEllipsoid = () => null;
  assert.equal(sitadelViewport(skyward).reason, 'no-view');
  // No rectangle at all.
  const blind = fakeViewer();
  blind.camera.computeViewRectangle = () => null;
  assert.equal(sitadelViewport(blind).reason, 'no-view');
});

test('the focus grid rounds symmetrically and refuses a non-point', () => {
  assert.equal(SITADEL_FOCUS_GRID_DEG, 0.01);
  assert.equal(sitadelFocusKey({ lat: 47.2184, lon: -1.5536 }), '4722,-155');
  // Two cameras a few metres apart inside one cell share a key, so panning a
  // street asks nothing at all.
  assert.equal(sitadelFocusKey({ lat: 47.2184, lon: -1.5536 }), sitadelFocusKey({ lat: 47.2196, lon: -1.5541 }));
  assert.notEqual(sitadelFocusKey({ lat: 47.2184, lon: -1.5536 }), sitadelFocusKey({ lat: 47.2384, lon: -1.5536 }));
  assert.equal(sitadelFocusKey(null), null);
  assert.equal(sitadelFocusKey({ lat: null, lon: 2 }), null);
  assert.equal(sitadelFocusKey({ lat: 'x', lon: 2 }), null);
});

test('the load path carries have=, and an unchanged commune redraws nothing', async () => {
  const viewer = fakeViewer({ altitude: 900 });
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    return { ok: true, json: async () => ({ ...PACK, fetchedAt: 1 }) };
  };
  _setSitadelStateForTest({ payload: null, viewer, fetchImpl, status: 'idle' });
  assert.equal(await _sitadelLoadForTest(), true);
  assert.equal(asked.length, 1);
  const first = new URL(asked[0], 'http://localhost');
  assert.equal(first.pathname, SITADEL_COMMUNE_URL);
  assert.equal(first.searchParams.get('lat'), '47.218400');
  assert.equal(first.searchParams.get('have'), null, 'nothing in hand, nothing to compare');
  assert.equal(_sitadelGateStateForTest().drawn, 9);

  // An unchanged cell asks nothing at all.
  assert.equal(await _sitadelLoadForTest(), false);
  assert.equal(asked.length, 1);

  // A new cell asks again, and carries the commune already in hand.
  viewer.camera.pickEllipsoid = () => ({ x: 2, y: 2, z: 2 });
  viewer.scene.globe.ellipsoid.cartesianToCartographic = () => ({
    latitude: 47.29 * Math.PI / 180, longitude: -1.51 * Math.PI / 180, height: 0,
  });
  let served = 0;
  const unchangedFetch = async (url) => {
    asked.push(url);
    served += 1;
    return { ok: true, json: async () => ({ insee: '44109', commune: 'Nantes', unchanged: true }) };
  };
  _setSitadelStateForTest({
    payload: PACK, viewer, fetchImpl: unchangedFetch, focusKey: '4722,-155',
  });
  assert.equal(await _sitadelLoadForTest(), false, 'unchanged means no redraw');
  assert.equal(served, 1);
  assert.equal(new URL(asked[1], 'http://localhost').searchParams.get('have'), '44109');
  assert.equal(_sitadelGateStateForTest().drawn, 9, 'the pack in hand is kept');
  _clearSitadelSelectionForTest();
});

test('a camera above the gate keeps the pack and asks nothing', async () => {
  let asked = 0;
  const viewer = fakeViewer({ altitude: 40_000 });
  _setSitadelStateForTest({
    payload: PACK, viewer, focusKey: '4722,-155',
    fetchImpl: async () => { asked += 1; throw new Error('must not fetch'); },
  });
  assert.equal(await _sitadelLoadForTest({ force: true }), false);
  assert.equal(asked, 0);
  const state = _sitadelGateStateForTest();
  assert.equal(state.status, 'too-high');
  assert.equal(state.drawn, 9, 'descending again must not cost a refetch of what is still true');
  assert.equal(state.focusKey, null, 'the cell is re-armed for the next descent');
  _clearSitadelSelectionForTest();
});

test('no French commune under the camera clears the map rather than keeping the last one', async () => {
  const viewer = fakeViewer({ altitude: 900, lat: 46.5, lon: 6.6 });
  _setSitadelStateForTest({
    payload: PACK, viewer,
    fetchImpl: async () => ({ ok: true, json: async () => ({ insee: null, reason: 'off-coverage' }) }),
  });
  assert.equal(await _sitadelLoadForTest(), true);
  const state = _sitadelGateStateForTest();
  assert.equal(state.status, 'no-commune');
  assert.equal(state.drawn, 0, 'Nantes’ permits must not be left drawn over Lausanne');
  assert.equal(state.commune, null);
  const stats = _sitadelStatsForTest();
  assert.equal(stats.status, 'empty');
  assert.ok(!('error' in stats), 'being over Switzerland is not a fault');
  _clearSitadelSelectionForTest();
});

test('a failed request keeps the commune in hand and says the refresh failed', async () => {
  const viewer = fakeViewer({ altitude: 900 });
  _setSitadelStateForTest({
    payload: PACK, viewer,
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  assert.equal(await _sitadelLoadForTest(), false);
  const stats = _sitadelStatsForTest();
  assert.equal(stats.status, 'ok', 'a month-old pack still describes the same commune');
  assert.equal(stats.count, 9);
  assert.ok(stats.error.includes('rafraîchissement'), stats.error);
  assert.equal(_sitadelGateStateForTest().focusKey, null, 'the unanswered cell must be re-armed');

  // With nothing in hand it is a real failure, and it says the layer's name.
  _setSitadelStateForTest({
    payload: null, viewer,
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  });
  assert.equal(await _sitadelLoadForTest(), false);
  assert.equal(_sitadelStatsForTest().status, 'unavailable');
  assert.ok(_sitadelStatsForTest().error.includes('Sitadel'));
  _clearSitadelSelectionForTest();
});

test('a malformed payload is refused rather than drawn as an empty commune', async () => {
  const viewer = fakeViewer({ altitude: 900 });
  _setSitadelStateForTest({
    payload: null, viewer,
    fetchImpl: async () => ({ ok: true, json: async () => ({ insee: '44109', commune: 'Nantes' }) }),
  });
  assert.equal(await _sitadelLoadForTest(), false);
  assert.equal(_sitadelGateStateForTest().status, 'unavailable');
  assert.equal(_sitadelGateStateForTest().drawn, 0);
  _clearSitadelSelectionForTest();
});

test('DETECT calls out what is being built first, and the biggest of it', () => {
  _setSitadelStateForTest({ payload: PACK });
  const all = _sitadelDetectablesForTest();
  assert.equal(all.length, 9);
  const bandOf = (candidate) => _sitadelRecordForTest(candidate.sourceId).permit.b;
  // Open sites first — what is happening now — then what is only authorised,
  // then demolitions, and last what is already finished (which
  // `bdtopo-buildings` already draws).
  const order = ['commence', 'autorise', 'demolition', 'termine', 'annule'];
  const ranks = all.map((candidate) => order.indexOf(bandOf(candidate)));
  const collapsed = ranks.map((rank) => (rank >= 3 ? 3 : rank));
  assert.deepEqual(collapsed, [...collapsed].sort((a, b) => a - b), ranks.join(','));
  // Inside a tier, the biggest creation is called out first.
  const authorised = all.filter((candidate) => bandOf(candidate) === 'autorise')
    .map((candidate) => _sitadelRecordForTest(candidate.sourceId).permit.lgt ?? 0);
  assert.deepEqual(authorised, [...authorised].sort((a, b) => b - a));
  for (const candidate of all) {
    assert.ok(candidate.position);
    assert.ok(candidate.id && candidate.id.length > 0);
    assert.ok(['Building permit', 'Building site', 'Demolition permit'].includes(candidate.type));
  }
  // The cap is honoured and the stride never runs off the end.
  assert.equal(_sitadelDetectablesForTest({ maxCount: 3 }).length, 3);
  assert.equal(_sitadelDetectablesForTest({ maxCount: 1, seed: 7 }).length, 1);
  _clearSitadelSelectionForTest();
  assert.deepEqual(_sitadelDetectablesForTest(), [], 'a disabled layer offers nothing');
});

test('the DETECT line prefers the published address over a computed title', () => {
  const withAddress = { an: '10-12', av: 'RUE DES AVENEAUX', dem: 'SCI LES COLIBRIS', t: 'PC', lgt: 27 };
  assert.equal(sitadelDetectLabel({ permit: withAddress }), '10-12 RUE DES AVENEAUX');
  const noAddress = { dem: 'PARIS HABITAT-OPH', t: 'PC', lgt: 28 };
  assert.equal(sitadelDetectLabel({ permit: noAddress }), 'PARIS HABITAT-OPH');
  const nothing = { t: 'PC', lgt: 4 };
  assert.equal(norm(sitadelDetectLabel({ permit: nothing })), 'Permis de construire — 4 logements');
  assert.equal(sitadelDetectLabel(null), 'Autorisation d’urbanisme');
  assert.equal(sitadelDetectType({ permit: { f: 'dem' } }), 'Demolition permit');
  assert.equal(sitadelDetectType({ permit: { b: 'commence' } }), 'Building site');
  assert.equal(sitadelDetectType({ permit: { b: 'termine' } }), 'Building permit');
});

test('a ring is closed once, and a degenerate ring draws nothing', () => {
  const parcel = PACK.parcels[0];
  const ring = parcel.g[0][0];
  const positions = sitadelRingPositions(ring);
  const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  assert.equal(positions.length, closed ? ring.length - 1 : ring.length);
  assert.equal(sitadelRingPositions([[0, 0], [1, 1]]), null, 'two points are not a polygon');
  assert.equal(sitadelRingPositions(null), null);
  assert.equal(sitadelRingPositions([[0, 0], [NaN, 1], [1, 1]]), null, 'a NaN vertex must not be drawn');
  assert.ok(SITADEL_FILL_ALPHA > 0 && SITADEL_FILL_ALPHA < 1);
});
