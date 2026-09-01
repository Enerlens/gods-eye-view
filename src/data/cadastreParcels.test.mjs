// The cadastre layer's presentation contract.
//
// The claim this layer makes on screen is narrow and easy to overstate, so the
// tests are about what the card and the row are ALLOWED to say. A crisp cyan
// polygon over photoreal imagery reads as a surveyed property line unless every
// surface it comes with says otherwise: the card ends on the legal standing of
// the document, the tolerance carries the assumption it was derived from, and a
// box Api Carto could not answer completely draws nothing at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import cadastreParcelsLayer, {
  CADASTRE_LAYER_ID,
  CADASTRE_SELECTED_OVERLAY_SOURCE_ID,
  CADASTRE_SELECTED_OVERLAY_SOURCE_OPTIONS,
  buildRecords,
  cadastreClassificationTypeForScene,
  cadastreClassificationTypeForStack,
  cadastreViewportBox,
  createCadastreSelectedOverlayEntry,
  parcelBand,
  resolveCadastrePickId,
  _cadastreRowControlsForTest,
  _cadastreSelectedIdForTest,
  _cadastreStatsForTest,
  _clearCadastreSelectionForTest,
  _selectCadastreParcelForTest,
  _setCadastreStateForTest,
} from './cadastreParcels.js';
import {
  CADASTRE_MAX_BOX_DEG,
  CADASTRE_SCALE_BANDS,
  CADASTRE_UNKNOWN_BAND,
  projectCadastreParcels,
} from './cadastreFeed.js';

const FIXTURE = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/cadastre-parcelle-sample.json', import.meta.url)),
  'utf8',
));

const PAYLOAD = projectCadastreParcels({
  parcelle: FIXTURE.parcelle,
  feuille: FIXTURE.feuille,
  box: {
    south: -22, west: -62, north: 52, east: 56,
  },
});

const RECORDS = buildRecords(PAYLOAD);

/** Normalize every Unicode space to a plain one before matching copy. */
function flat(text) {
  return String(text).replace(/[\u00a0\u202f\u2009]/g, ' ');
}

function recordFor(idu) {
  const found = RECORDS.find((record) => record.parcel.u === idu);
  assert.ok(found, `no record built for ${idu}`);
  return found;
}

function viewerWithView(degrees) {
  return {
    scene: { globe: { ellipsoid: Cesium.Ellipsoid.WGS84 } },
    camera: {
      computeViewRectangle: () => (degrees ? Cesium.Rectangle.fromDegrees(
        degrees.west, degrees.south, degrees.east, degrees.north,
      ) : undefined),
    },
  };
}

/** Collects overlay traffic so the card can be asserted without WebGL. */
function recordingOverlayHost() {
  const calls = { setEntries: [], cleared: [], visible: [] };
  return {
    calls,
    setEntries: (id, entries, options) => calls.setEntries.push({ id, entries, options }),
    clearSource: (id) => calls.cleared.push(id),
    setVisible: (id, value) => calls.visible.push({ id, value }),
  };
}

function seed(overlayHost, extra = {}) {
  _setCadastreStateForTest({
    viewer: null,
    records: new Map(RECORDS.map((record) => [record.id, record])),
    payload: PAYLOAD,
    overlayHost,
    ...extra,
  });
}

test.afterEach(() => {
  _setCadastreStateForTest({ payload: null, records: new Map(), enabled: false });
});

// ── Records ─────────────────────────────────────────────────────────────────

test('every fixture parcel becomes exactly one record with a distinct render id', () => {
  assert.equal(RECORDS.length, PAYLOAD.parcels.length);
  assert.equal(new Set(RECORDS.map((record) => record.id)).size, RECORDS.length);
  // A split parcel is ONE record carrying two polygons — not two records that
  // would both claim the same identifier and count twice in the row.
  const marseille = recordFor('132038120D0037');
  assert.equal(marseille.polygons.length, 2);
});

test('a record without an identifier still gets a unique, pickable render id', () => {
  const records = buildRecords({
    parcels: [
      { g: [[[[2, 48], [2.001, 48], [2.001, 48.001], [2, 48]]]], m: '75056', p: [2, 48] },
      { g: [[[[3, 48], [3.001, 48], [3.001, 48.001], [3, 48]]]], m: '75056', p: [3, 48] },
    ],
    sheets: {},
  });
  assert.equal(records.length, 2);
  assert.notEqual(records[0].id, records[1].id);
});

test('a parcel is coloured by its sheet\'s scale band, unknown when none joined', () => {
  const lyon2 = recordFor('69382000AL0005'); // 1:500
  const lyon5 = recordFor('69385000AL0005'); // 1:1000
  const landes = recordFor('401340000D0049'); // 1:5000
  assert.equal(lyon2.bandId, 'fine');
  assert.equal(lyon5.bandId, 'urban');
  assert.equal(landes.bandId, 'extensive');
  assert.notEqual(lyon2.color, lyon5.color);

  // The two Lyon parcels are the whole reason the sheet join is five parts
  // wide, and they have to come out DIFFERENT colours on screen.
  assert.notEqual(parcelBand(lyon2.parcel, PAYLOAD.sheets).id, parcelBand(lyon5.parcel, PAYLOAD.sheets).id);
  assert.equal(parcelBand({ k: null }, PAYLOAD.sheets).id, CADASTRE_UNKNOWN_BAND.id);
  assert.equal(parcelBand({ k: 'nope/000/000/AA/1' }, PAYLOAD.sheets).id, CADASTRE_UNKNOWN_BAND.id);
});

// ── The card ────────────────────────────────────────────────────────────────

test('the card ends on the legal standing of the document, always', () => {
  for (const record of RECORDS) {
    const entry = createCadastreSelectedOverlayEntry(record, PAYLOAD.communes, PAYLOAD.sheets);
    assert.ok(entry, `no card for ${record.parcel.u}`);
    assert.equal(
      entry.details[entry.details.length - 1],
      'Document fiscal — la limite de propriété se fixe par bornage',
      `${record.parcel.u} card did not end on the bornage line`,
    );
  }
});

test('the card carries the identifier, both surfaces, the sheet and its tolerance', () => {
  const entry = createCadastreSelectedOverlayEntry(
    recordFor('75103000AP0045'), PAYLOAD.communes, PAYLOAD.sheets,
  );
  assert.equal(entry.title, 'Parcelle AP 0045');
  const details = entry.details.map(flat);
  assert.equal(details[0], 'Paris 3ᵉ · INSEE 75056');
  // The IDU on its own line: 14 digits inside a sentence is not readable, and
  // this is the key that joins the parcel to DVF's record of its last sale.
  assert.equal(details[1], 'IDU 75103000AP0045');
  assert.ok(details.some((line) => /^Contenance déclarée/.test(line)));
  assert.ok(details.some((line) => /^Tracé /.test(line)));
  assert.ok(details.some((line) => /^Feuille AP 01 au 1:500 · édition 2026-06-01$/.test(line)));
  assert.ok(details.some((line) => /±0,25 m \(0,5 mm à l'échelle\)/.test(line)));
});

test('the tolerance never appears without the assumption that produced it', () => {
  for (const record of RECORDS) {
    const entry = createCadastreSelectedOverlayEntry(record, PAYLOAD.communes, PAYLOAD.sheets);
    const tolerance = entry.details.map(flat).find((line) => line.includes('Trait de plan'));
    if (!tolerance) continue;
    assert.match(tolerance, /mm à l'échelle/, `${record.parcel.u} printed a bare tolerance`);
  }
});

test('an unpublished contenance is stated as unpublished on the card', () => {
  const entry = createCadastreSelectedOverlayEntry(
    recordFor('97611000AY1015'), PAYLOAD.communes, PAYLOAD.sheets,
  );
  const details = entry.details.map(flat);
  assert.ok(details.includes('Contenance non publiée'));
  assert.ok(!details.some((line) => /Contenance déclarée 0 m²$/.test(line)));
});

test('the section préfixe is shown only when the commune actually uses one', () => {
  const withPrefix = createCadastreSelectedOverlayEntry(
    recordFor('31555815AB0207'), PAYLOAD.communes, PAYLOAD.sheets,
  ).details.map(flat);
  assert.ok(withPrefix.includes('Préfixe de section 815'));

  // `000` is the absence of a subdivision. A line spent saying so is a line
  // taken from something the reader could use.
  const without = createCadastreSelectedOverlayEntry(
    recordFor('401340000D0049'), PAYLOAD.communes, PAYLOAD.sheets,
  ).details.map(flat);
  assert.ok(!without.some((line) => line.startsWith('Préfixe')));
});

test('a card is refused rather than anchored at the centre of the Earth', () => {
  assert.equal(createCadastreSelectedOverlayEntry(null), null);
  assert.equal(createCadastreSelectedOverlayEntry({ id: 'x', position: null }), null);
});

test('the card is a protected single-entry source', () => {
  const entry = createCadastreSelectedOverlayEntry(RECORDS[0], PAYLOAD.communes, PAYLOAD.sheets);
  assert.equal(entry.protected, true);
  assert.equal(entry.selected, true);
  assert.equal(entry.priority, Number.MAX_SAFE_INTEGER);
  assert.equal(CADASTRE_SELECTED_OVERLAY_SOURCE_OPTIONS.cohortLimit, 1);
});

// ── Selection ───────────────────────────────────────────────────────────────

test('selecting a parcel publishes exactly one card on the protected source', () => {
  const overlayHost = recordingOverlayHost();
  seed(overlayHost);
  const target = recordFor('69385000AL0005');
  _selectCadastreParcelForTest(target.id);

  assert.equal(_cadastreSelectedIdForTest(), target.id);
  assert.equal(overlayHost.calls.setEntries.length, 1);
  const [call] = overlayHost.calls.setEntries;
  assert.equal(call.id, CADASTRE_SELECTED_OVERLAY_SOURCE_ID);
  assert.equal(call.entries.length, 1);
  assert.equal(call.options, CADASTRE_SELECTED_OVERLAY_SOURCE_OPTIONS);
  assert.match(flat(call.entries[0].details.join(' | ')), /Feuille AL 01 au 1:1000/);
});

test('selecting a second parcel replaces the first card rather than stacking', () => {
  const overlayHost = recordingOverlayHost();
  seed(overlayHost);
  _selectCadastreParcelForTest(recordFor('69382000AL0005').id);
  _selectCadastreParcelForTest(recordFor('69385000AL0005').id);
  assert.equal(overlayHost.calls.setEntries.length, 2);
  assert.equal(_cadastreSelectedIdForTest(), recordFor('69385000AL0005').id);
  // Cleared once on the second select's own teardown, before the new card.
  assert.ok(overlayHost.calls.cleared.includes(CADASTRE_SELECTED_OVERLAY_SOURCE_ID));
});

test('clearing the selection clears the source and the id together', () => {
  const overlayHost = recordingOverlayHost();
  seed(overlayHost);
  _selectCadastreParcelForTest(RECORDS[0].id);
  overlayHost.calls.cleared.length = 0;
  _clearCadastreSelectionForTest();
  assert.equal(_cadastreSelectedIdForTest(), null);
  assert.deepEqual(overlayHost.calls.cleared, [CADASTRE_SELECTED_OVERLAY_SOURCE_ID]);
});

test('selecting an unknown id is a no-op, not a blank card', () => {
  const overlayHost = recordingOverlayHost();
  seed(overlayHost);
  _selectCadastreParcelForTest('cadastre:not-a-parcel');
  assert.equal(_cadastreSelectedIdForTest(), null);
  assert.equal(overlayHost.calls.setEntries.length, 0);
});

test('a pick resolves through both the flat and the nested Cesium id shapes', () => {
  const has = (id) => id === 'cadastre:75103000AP0045';
  assert.equal(resolveCadastrePickId({ id: 'cadastre:75103000AP0045' }, has), 'cadastre:75103000AP0045');
  assert.equal(resolveCadastrePickId({ id: { id: 'cadastre:75103000AP0045' } }, has), 'cadastre:75103000AP0045');
  assert.equal(resolveCadastrePickId({ id: 'someone-elses-primitive' }, has), null);
  assert.equal(resolveCadastrePickId(null, has), null);
});

// ── The viewport gate ───────────────────────────────────────────────────────

test('the viewport gate names each refusal separately', () => {
  const half = CADASTRE_MAX_BOX_DEG / 2;
  const paris = {
    south: 48.85, west: 2.35, north: 48.85 + half, east: 2.35 + half,
  };
  assert.deepEqual(cadastreViewportBox(viewerWithView(paris)).reason, null);

  assert.equal(cadastreViewportBox(viewerWithView(null)).reason, 'no-view');
  assert.equal(cadastreViewportBox(null).reason, 'no-view');
  assert.equal(cadastreViewportBox(viewerWithView({
    south: 48.8, west: 2.2, north: 48.9, east: 2.5,
  })).reason, 'too-wide');
});

test('coverage is checked BEFORE width, so mid-ocean is never told to zoom in', () => {
  // A wide view of the Atlantic fails both gates. Reporting `too-wide` would
  // send the operator zooming toward an answer that does not exist at any
  // altitude; `off-coverage` is the one that is actually true.
  const atlantic = {
    south: 39, west: -31, north: 41, east: -29,
  };
  assert.equal(cadastreViewportBox(viewerWithView(atlantic)).reason, 'off-coverage');
});

// ── Ground classification ───────────────────────────────────────────────────

test('each map stack gets the surface its geometry is actually drawn on', () => {
  assert.equal(cadastreClassificationTypeForStack('photoreal'), Cesium.ClassificationType.CESIUM_3D_TILE);
  for (const id of ['bing-aerial', 'bing-labels', 'osm', 'ign-ortho', 'ign-plan']) {
    assert.equal(cadastreClassificationTypeForStack(id), Cesium.ClassificationType.TERRAIN);
  }
  // An unknown stack reaches BOTH rather than being asserted onto a surface
  // that may not be there.
  assert.equal(cadastreClassificationTypeForStack('a-stack-added-later'), Cesium.ClassificationType.BOTH);
  assert.equal(cadastreClassificationTypeForStack(null), Cesium.ClassificationType.BOTH);
});

test('boot derives the surface from the scene, since the settle fires no event', () => {
  assert.equal(
    cadastreClassificationTypeForScene({ globe: { show: false } }),
    Cesium.ClassificationType.CESIUM_3D_TILE,
  );
  assert.equal(
    cadastreClassificationTypeForScene({ globe: { show: true } }),
    Cesium.ClassificationType.TERRAIN,
  );
  assert.equal(cadastreClassificationTypeForScene(null), Cesium.ClassificationType.BOTH);
});

// ── The row ─────────────────────────────────────────────────────────────────

test('the legend lists every band including the one nothing landed in', () => {
  seed(recordingOverlayHost());
  const { legend } = _cadastreRowControlsForTest();
  assert.equal(legend.length, CADASTRE_SCALE_BANDS.length + 1);
  const byLabel = new Map(legend.map((row) => [row.label, row]));
  assert.equal(byLabel.get('Plan fin').count, 4);
  assert.equal(byLabel.get('Plan urbain').count, 4);
  // Zero is a fact about the view, not a row to hide: a legend that shrinks as
  // you pan makes the colours unlearnable.
  assert.equal(byLabel.get('Plan rural').count, 0);
  assert.equal(byLabel.get('Plan étendu').count, 1);
  for (const row of legend) assert.ok(row.blurb, `${row.label} has no blurb`);
});

test('the legend renders before any payload has arrived', () => {
  _setCadastreStateForTest({ payload: null, records: new Map() });
  const { legend } = _cadastreRowControlsForTest();
  assert.equal(legend.length, CADASTRE_SCALE_BANDS.length + 1);
  for (const row of legend) assert.equal(row.count, 0);
});

test('the row reports the cadastred fraction, both totals and the disagreements', () => {
  seed(recordingOverlayHost());
  const stats = _cadastreStatsForTest();
  assert.equal(stats.count, PAYLOAD.parcels.length);
  assert.equal(stats.communes, 7);
  assert.equal(stats.areaChecked, 7);
  assert.equal(stats.areaDisagreeing, 2);
  assert.equal(stats.areaTolerancePercent, 5);
  assert.equal(stats.noContenance, 1);
  assert.equal(stats.multipart, 1);
  assert.equal(stats.withHoles, 1);
  assert.equal(stats.arrondissementIdu, 5);
  assert.equal(stats.status, 'ok');
  assert.match(stats.feedSource, /Licence Ouverte 2\.0/);
  assert.match(stats.feedSource, /DGFiP/);
});

test('a refused box reads as guidance, not as a broken feed', () => {
  // `layerFeedState` paints anything with an error and no records as
  // UNAVAILABLE. A refusal to draw is normal operation, so it has to present as
  // one of the guidance states with its reason in the label.
  for (const [status, pattern] of [
    ['too-wide', /Zoome sous 0\.02°/],
    ['too-dense', /15 977 parcelles ici/],
  ]) {
    _setCadastreStateForTest({
      payload: { truncated: true, totalInBox: 15977, parcels: [] },
      records: new Map(),
      status,
    });
    const stats = _cadastreStatsForTest();
    assert.equal(stats.status, 'zoom-in', `${status} should read as guidance`);
    assert.match(flat(stats.loadingLabel), pattern);
    assert.equal(stats.error, undefined);
  }
});

test('a too-dense refusal reports the true count and draws nothing', () => {
  _setCadastreStateForTest({
    payload: { truncated: true, totalInBox: 15977, returned: 5000, parcels: [] },
    records: new Map(),
    status: 'too-dense',
  });
  const stats = _cadastreStatsForTest();
  assert.equal(stats.truncated, true);
  assert.equal(stats.totalInBox, 15977);
  assert.equal(stats.count, 0);
});

test('an empty box says which two things produce it', () => {
  _setCadastreStateForTest({
    payload: projectCadastreParcels({
      parcelle: { type: 'FeatureCollection', features: [], totalFeatures: 0 },
      box: { south: 46.19, west: 6.13, north: 46.21, east: 6.15 },
    }),
    records: new Map(),
    status: 'empty',
  });
  const stats = _cadastreStatsForTest();
  assert.equal(stats.count, 0);
  assert.equal(stats.status, 'empty');
  assert.match(stats.loadingLabel, /domaine public, ou hors de France/);
});

test('off-coverage is reported as a normal state with its own explanation', () => {
  _setCadastreStateForTest({ payload: null, records: new Map(), status: 'off-coverage' });
  const stats = _cadastreStatsForTest();
  assert.equal(stats.status, 'ok');
  assert.match(stats.loadingLabel, /Hors couverture PCI vecteur/);
});

// ── The layer module contract ───────────────────────────────────────────────

test('the layer registers under the id the share registry and voice tool use', () => {
  assert.equal(cadastreParcelsLayer.id, CADASTRE_LAYER_ID);
  assert.equal(CADASTRE_LAYER_ID, 'cadastre-fr');
  assert.equal(typeof cadastreParcelsLayer.name, 'string');
  assert.ok(cadastreParcelsLayer.updateInterval > 0);
});

test('update() never refuses the lifecycle just because it had nothing to fetch', async () => {
  // `DataLayerManager` reads a literal `false` from update() as a rejection: it
  // fails the enable, throws LifecycleRejectedError and leaves the layer
  // switched OFF. This layer refuses any view wider than 0.02°, so returning
  // the load's own boolean meant that switching it on from anywhere but street
  // level turned itself straight back off — which is what the operator saw as
  // "échec de chargement".
  //
  // Every gate is exercised, because each one is a different `false` from
  // `load()`: too wide, off coverage, and a camera with no rectangle at all.
  const wide = { south: 48.8, west: 2.2, north: 48.9, east: 2.5 };
  const atlantic = { south: 39, west: -31, north: 41, east: -29 };
  for (const view of [wide, atlantic, null]) {
    _setCadastreStateForTest({
      viewer: viewerWithView(view),
      records: new Map(),
      payload: null,
      overlayHost: recordingOverlayHost(),
      enabled: true,
      // No fetch is reachable from any of these: a `false` here would come from
      // the gate, which is exactly the case under test.
      fetchImpl: () => { throw new Error('update() must not reach the network at a closed gate'); },
    });
    const result = await cadastreParcelsLayer.update();
    assert.notEqual(result, false, `update() refused the lifecycle for ${JSON.stringify(view)}`);
  }
});

test('a DISABLED layer is the one thing update() does refuse', async () => {
  // The distinction the manager actually needs: "there was nothing to load" is
  // not "this layer will not come on".
  _setCadastreStateForTest({ payload: null, records: new Map(), enabled: false });
  assert.equal(await cadastreParcelsLayer.update(), false);
});

test('parcels are not detectable contacts', () => {
  // A detection reticle over every plot in Lyon would drown every layer that
  // does have something moving to report.
  seed(recordingOverlayHost());
  assert.deepEqual(cadastreParcelsLayer.getDetectableObjects(), []);
});
