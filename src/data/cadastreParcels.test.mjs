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
  cadastreRecordAt,
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
  pointInPolygons,
  pointInRing,
  cadastreLoadingLabel,
  CADASTRE_MAX_ALTITUDE_M,
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

/**
 * A camera stub. `altitude` and `focus` are separate inputs from the view
 * rectangle on purpose — that they can disagree IS the bug this gate was
 * rewritten for, and a stub that derived one from the other could not express
 * the oblique case at all.
 */
function viewerWithView(degrees, { altitude = 400, focus } = {}) {
  const centre = degrees
    ? { lat: (degrees.south + degrees.north) / 2, lon: (degrees.west + degrees.east) / 2 }
    : null;
  const at = focus === undefined ? centre : focus;
  return {
    scene: {
      globe: { ellipsoid: Cesium.Ellipsoid.WGS84 },
      canvas: { clientWidth: 1440, clientHeight: 900 },
    },
    camera: {
      positionCartographic: { height: altitude },
      computeViewRectangle: () => (degrees ? Cesium.Rectangle.fromDegrees(
        degrees.west, degrees.south, degrees.east, degrees.north,
      ) : undefined),
      pickEllipsoid: () => (at
        ? Cesium.Cartesian3.fromDegrees(at.lon, at.lat)
        : undefined),
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


/**
 * Cesium builds a `GroundPolylinePrimitive`'s render state against the LIVE
 * WebGL line-width limits, which are zero with no context — so the outline half
 * of every draw throws under `node --test` unless they are seeded. Nothing else
 * in the draw path needs a GPU: the layer only CONSTRUCTS its primitives, and
 * what tessellates and rasterises them is `scripts/qa-cadastre-highlight.mjs`.
 */
Cesium.ContextLimits._minimumAliasedLineWidth = 1;
Cesium.ContextLimits._maximumAliasedLineWidth = 4;

/**
 * A viewer that can be DRAWN into, not merely gated against.
 *
 * `viewerWithView` answers the viewport gate; this one also owns a primitive
 * collection that records every add and remove, which is the only way to see
 * the shape of the draw — how many primitives, carrying whose geometry, and
 * whether the last selection was taken back off the scene.
 */
function drawingViewer() {
  const viewer = viewerWithView(
    { south: 48.8700, west: 2.2926, north: 48.8716, east: 2.2964 },
    { altitude: 240 },
  );
  viewer.added = [];
  viewer.removed = [];
  viewer.scene.primitives = {
    add: (primitive) => { viewer.added.push(primitive); return primitive; },
    remove: (primitive) => { viewer.removed.push(primitive); return true; },
  };
  return viewer;
}

/**
 * Run one real load-and-draw against a payload, and hand back the viewer.
 *
 * `viewer.payload` stays writable so a test can answer the NEXT `update()` with
 * a different box — which is what a pan is, and the only way to reach the
 * redraw paths from here.
 */
async function drawn(payload = PAYLOAD) {
  const viewer = drawingViewer();
  viewer.payload = payload;
  viewer.overlay = recordingOverlayHost();
  _setCadastreStateForTest({
    viewer,
    records: new Map(),
    payload: null,
    overlayHost: viewer.overlay,
    fetchImpl: async () => ({ ok: true, json: async () => viewer.payload }),
  });
  await cadastreParcelsLayer.update();
  return viewer;
}

/** How many primitives the layer still has on the scene. */
function live(viewer) {
  return viewer.added.length - viewer.removed.length;
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

test('a click is resolved against the geometry, not against Cesium\'s pick', () => {
  // `scene.pick` on ground-classification geometry answers with whichever
  // shadow volume the ray enters first, and at the grazing angles this globe is
  // flown at that is not reliably the parcel under the pointer — clicking one
  // parcel lit up a shape somewhere else. The polygons are in memory, so the
  // question is answered against them.
  const map = new Map(RECORDS.map((r) => [r.id, r]));
  for (const record of RECORDS) {
    // The anchor is the area centroid of the largest ring, which for these
    // fixture parcels is inside the parcel.
    const [lon, lat] = record.parcel.p;
    if (!pointInPolygons(record.polygons, lon, lat)) continue;
    assert.equal(
      cadastreRecordAt(lon, lat, map),
      record.id,
      `${record.parcel.u} did not resolve to itself at its own centroid`,
    );
  }
});

test('clicking a courtyard selects nothing, because nothing is what is there', () => {
  // The Palais-Royal's parcel carries an interior ring. A point inside that
  // ring is inside the parcel's OUTER boundary and on none of its land, and
  // the hole test is the only thing that knows the difference.
  const palaisRoyal = recordFor('75101000AJ0002');
  const hole = palaisRoyal.polygons[0][1];
  assert.ok(hole, 'the fixture parcel should carry a hole');
  let lon = 0;
  let lat = 0;
  for (const [x, y] of hole) { lon += x; lat += y; }
  lon /= hole.length;
  lat /= hole.length;

  assert.equal(pointInRing(lon, lat, palaisRoyal.polygons[0][0]), true, 'inside the outer ring');
  assert.equal(pointInRing(lon, lat, hole), true, 'and inside the courtyard');
  assert.equal(pointInPolygons(palaisRoyal.polygons, lon, lat), false, 'so NOT on the parcel');
  assert.equal(cadastreRecordAt(lon, lat, new Map([[palaisRoyal.id, palaisRoyal]])), null);
});

test('a click on the street selects nothing rather than the nearest parcel', () => {
  // The gaps in this layer are the public domain. Answering a click there with
  // "the closest thing I have" would invent a parcel where France publishes
  // none — which is the layer's own headline, undone by its click handler.
  const map = new Map(RECORDS.map((r) => [r.id, r]));
  assert.equal(cadastreRecordAt(0, 0, map), null);
  assert.equal(cadastreRecordAt(2.35, 48.86, map), null, 'a Paris point on no fixture parcel');
});

test('both parts of a split parcel answer to the same record', () => {
  const marseille = recordFor('132038120D0037');
  const map = new Map([[marseille.id, marseille]]);
  let hits = 0;
  for (const polygon of marseille.polygons) {
    const ring = polygon[0];
    let lon = 0;
    let lat = 0;
    for (const [x, y] of ring) { lon += x; lat += y; }
    lon /= ring.length; lat /= ring.length;
    if (cadastreRecordAt(lon, lat, map) === marseille.id) hits += 1;
  }
  assert.ok(hits >= 1, 'at least one part should resolve; neither may resolve elsewhere');
});

test('the bbox prefilter never rejects a point the polygon would have accepted', () => {
  // The prefilter is an optimisation and must be conservative: a bounds check
  // that is even slightly tight silently makes edge parcels unclickable.
  for (const record of RECORDS) {
    for (const polygon of record.polygons) {
      for (const [lon, lat] of polygon[0]) {
        assert.ok(
          lat >= record.bounds.south && lat <= record.bounds.north
          && lon >= record.bounds.west && lon <= record.bounds.east,
          `${record.parcel.u} has a vertex outside its own bounds`,
        );
      }
    }
  }
});


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

test('the card the operator reads is the card the accessor returns', () => {
  // The address and the building lines resolve AFTER the first paint. An
  // accessor that rebuilds the entry from the parcel alone reports a card that
  // has never been on screen — which is exactly how this shipped: the overlay
  // showed the enriched card and every check against it saw the bare one.
  const record = recordFor('75103000AP0045');
  const overlayHost = recordingOverlayHost();
  _setCadastreStateForTest({
    records: new Map(RECORDS.map((r) => [r.id, r])),
    payload: PAYLOAD,
    overlayHost,
    detail: {
      '75103000AP0045': {
        address: { label: '5 Rue de Bretagne 75003 Paris', distanceM: 6 },
        buildings: {
          count: 2, footprintM2: 1840, coverage: 0.73, tallestM: 21, storeys: 6,
          dwellings: 34, usages: [{ name: 'Résidentiel', count: 2 }], oldest: null, anonymous: 0,
        },
        partial: false,
      },
    },
  });
  _selectCadastreParcelForTest(record.id);

  const shown = overlayHost.calls.setEntries.at(-1).entries[0].details.map(flat);
  const returned = cadastreParcelsLayer.getSelectedParcel();
  assert.deepEqual(returned.details.map(flat), shown, 'the accessor drifted from the overlay');
  assert.equal(returned.detailResolved, true);
  assert.equal(shown[0], '5 Rue de Bretagne 75003 Paris', 'the address leads the card');
  assert.ok(shown.some((l) => /2 bâtiments · 1 840 m² au sol · 73 % de la parcelle/.test(l)), shown.join(' | '));
  assert.ok(shown.some((l) => /R\+6 · 21 m de haut · 34 logements/.test(l)), shown.join(' | '));
  // And the honesty lines survive the enrichment rather than being pushed off.
  assert.ok(shown.some((l) => /centre d'emprise/.test(l)));
  assert.equal(shown.at(-1), 'Document fiscal — la limite de propriété se fixe par bornage');
});

test('an unresolved parcel still gets a complete, correct card', () => {
  // Everything the cadastre itself publishes is in hand before either lookup
  // returns, and holding the card back would trade a complete answer now for a
  // fuller one later.
  const overlayHost = recordingOverlayHost();
  seed(overlayHost);
  _selectCadastreParcelForTest(recordFor('75103000AP0045').id);
  const returned = cadastreParcelsLayer.getSelectedParcel();
  assert.equal(returned.detailResolved, false);
  assert.equal(returned.details[0], 'Paris 3ᵉ · INSEE 75056');
  assert.equal(returned.details.at(-1), 'Document fiscal — la limite de propriété se fixe par bornage');
  assert.ok(!returned.details.some((l) => /BD TOPO|point adresse/.test(l)));
});

// ── The draw ────────────────────────────────────────────────────────────────

test('the fills are batched one primitive per band COLOUR, never one per parcel', async () => {
  // Colour is the only axis this batch may be split on, and both directions are
  // a bug. One batch for every colour has each instance repaint its neighbours
  // inside its own bounding rectangle — Cesium classifies a batch in one
  // stencil pass and then keeps the first instance whose bounding RECTANGLE
  // holds the pixel — and one primitive per parcel costs the frame rate the
  // batching exists for.
  const viewer = await drawn();
  const colors = new Set(RECORDS.map((record) => record.color));
  const shape = cadastreParcelsLayer.getPrimitiveShapeForQa();
  assert.equal(shape.fills, colors.size, 'one fill primitive per band colour');
  assert.ok(shape.fills < shape.records, 'a primitive per parcel is the other regression');
  assert.equal(shape.records, RECORDS.length);
  assert.equal(shape.outlines, 1, 'every ring in the box still shares ONE polyline primitive');
  assert.equal(shape.selectedFill, false);
  assert.equal(shape.selectedOutline, false);
  assert.equal(viewer.added.length, colors.size + 1);
  assert.equal(viewer.removed.length, 0);
});

test('the highlight is the parcel\'s OWN geometry, drawn over the batch it belongs to', async () => {
  // The fix, stated as geometry: the selected parcel is not a recoloured
  // instance inside a batch whose bounding rectangles overlap its neighbours',
  // it is its own pair of primitives holding its own rings and nothing else.
  // The split parcel is the honest case — a highlight that carried one part
  // would look correct in a screenshot of the other.
  const viewer = await drawn();
  const target = recordFor('132038120D0037');
  const batch = viewer.added.length;
  _selectCadastreParcelForTest(target.id);

  const shape = cadastreParcelsLayer.getPrimitiveShapeForQa();
  assert.equal(shape.selectedFill, true);
  assert.equal(shape.selectedOutline, true);
  assert.equal(shape.fills, batch - 1, 'the batch is laid under the highlight, not rebuilt');
  assert.equal(viewer.added.length, batch + 2, 'a highlight is exactly two primitives');
  assert.equal(viewer.removed.length, 0);

  const [fill, outline] = viewer.added.slice(-2);
  const rings = target.polygons.reduce((total, polygon) => total + polygon.length, 0);
  assert.deepEqual(
    fill.geometryInstances.map((instance) => instance.id),
    target.polygons.map(() => target.id),
    'the highlight fills every part of the parcel and no neighbour',
  );
  assert.equal(outline.geometryInstances.length, rings, 'every ring, courtyards included');
  assert.ok(outline.geometryInstances.every((instance) => instance.id === target.id));

  // COLOUR, not just geometry. A highlight built from the band colour instead
  // of cyan is invisible against the wash it is laid over — which is the exact
  // symptom this whole change exists to fix, and the one a shape assertion
  // cannot see. Only the pixel harness caught it before this line, and the
  // pixel harness is not part of `npm test`.
  const cyan = Cesium.Color.fromCssColorString('#00ffff');
  assert.deepEqual(
    Array.from(fill.geometryInstances[0].attributes.color.value),
    Array.from(Cesium.ColorGeometryInstanceAttribute.fromColor(cyan.withAlpha(0.55)).value),
    'the highlight fill must be cyan over the band, not the band again',
  );
  assert.deepEqual(
    Array.from(outline.geometryInstances[0].attributes.color.value),
    Array.from(Cesium.ColorGeometryInstanceAttribute.fromColor(cyan).value),
  );

  // The SURFACE all of it drapes onto. A primitive that classifies the wrong
  // one draws nothing at all, and nothing on screen distinguishes that from a
  // layer that fetched nothing — so the highlight must classify whatever its
  // batch classifies, and both must be what the map stack asked for.
  const classification = cadastreParcelsLayer.getPrimitiveShapeForQa().classification;
  for (const primitive of viewer.added) {
    assert.equal(primitive.classificationType, classification);
  }

  // The seam the pixel harness measures against reads the SAME rings, verbatim,
  // so an IoU written against it compares pixels to the source geometry.
  assert.equal(cadastreParcelsLayer.getParcelPolygonsForQa('132038120D0037'), target.polygons);
  assert.equal(cadastreParcelsLayer.getParcelPolygonsForQa('00000000AA0000'), null);
});

test('deselecting takes the two highlight primitives back off the scene', async () => {
  const viewer = await drawn();
  _selectCadastreParcelForTest(recordFor('69385000AL0005').id);
  const [fill, outline] = viewer.added.slice(-2);

  _clearCadastreSelectionForTest();
  const shape = cadastreParcelsLayer.getPrimitiveShapeForQa();
  assert.equal(shape.selectedFill, false);
  assert.equal(shape.selectedOutline, false);
  assert.equal(shape.fills, viewer.added.length - 3, 'the band batches survive the deselect');
  assert.equal(shape.outlines, 1);
  assert.equal(viewer.removed.length, 2);
  assert.ok(viewer.removed.includes(fill) && viewer.removed.includes(outline));
});

test('neither clicking nor panning ever leaves a primitive behind', async () => {
  // The two ways this scene could grow without bound. A click costs two
  // primitives, so a leak there is a cyan trail across every parcel the
  // operator has ever touched; a pan rebuilds the whole box, so a leak there
  // stacks a fresh set of band batches on top of the last ones every 450 ms of
  // movement. Both end at the same number: the batch, plus one highlight.
  const viewer = await drawn();
  const colors = new Set(RECORDS.map((record) => record.color));
  const batch = colors.size + 1;
  for (const record of RECORDS.slice(0, 4)) _selectCadastreParcelForTest(record.id);

  assert.equal(live(viewer), batch + 2, 'the batch, plus exactly one highlight');
  assert.equal(viewer.added.length, batch + 8);
  assert.equal(viewer.removed.length, 6, 'three superseded highlights, two primitives each');

  // The pan. `update()` drops the box memo and redraws from the same payload,
  // which is what a moveEnd does — and the selection is matched back by IDU
  // afterwards, so the highlight is laid over the batch that is now on screen
  // rather than over the one just thrown away.
  const selected = _cadastreSelectedIdForTest();
  await cadastreParcelsLayer.update();

  assert.equal(live(viewer), batch + 2, 'the redraw replaced the batch, it did not stack on it');
  assert.equal(viewer.added.length, (batch + 8) + batch + 2);
  assert.equal(viewer.removed.length, 6 + batch + 2, 'the old batch AND the old highlight came off');
  assert.equal(_cadastreSelectedIdForTest(), selected, 'the parcel has not moved, so neither has the card');
  const shape = cadastreParcelsLayer.getPrimitiveShapeForQa();
  assert.equal(shape.fills, colors.size);
  assert.equal(shape.records, RECORDS.length);
  assert.equal(shape.selectedFill, true);
  assert.equal(shape.selectedOutline, true);
});

test('switching the layer off hides the batches and drops the highlight', async () => {
  // `show` and not `remove`, for the batches: the payload is still in hand and
  // rebuilding two thousand classification polygons to switch a row back on is
  // the cost this layer is arranged to avoid. The highlight is different — it
  // goes with the selection, because the card goes with it too.
  const viewer = await drawn();
  _selectCadastreParcelForTest(recordFor('69385000AL0005').id);
  const highlight = viewer.added.slice(-2);

  cadastreParcelsLayer.disable();

  const shape = cadastreParcelsLayer.getPrimitiveShapeForQa();
  assert.equal(shape.selectedFill, false);
  assert.equal(shape.selectedOutline, false);
  assert.equal(shape.records, RECORDS.length, 'the records outlive the switch');
  assert.equal(shape.fills, new Set(RECORDS.map((record) => record.color)).size);
  for (const primitive of highlight) assert.ok(viewer.removed.includes(primitive));
  const kept = viewer.added.filter((primitive) => !viewer.removed.includes(primitive));
  assert.equal(kept.length, shape.fills + 1);
  for (const primitive of kept) assert.equal(primitive.show, false, 'a primitive was left on screen');
  assert.equal(_cadastreSelectedIdForTest(), null);
});

test('switching it back ON shows the batches again rather than rebuilding them', async () => {
  // The other half of the row toggle, and the half a `show = false` can hide a
  // regression in: a layer that comes back invisible looks exactly like a layer
  // whose feed went quiet. `enable()` must restore the flag on every primitive
  // it left standing, and must NOT pay for a second tessellation to do it —
  // that is the whole reason `disable()` hides rather than removes.
  const noop = () => {};
  const previousDocument = globalThis.document;
  globalThis.document = { addEventListener: noop, removeEventListener: noop };
  const viewer = await drawn();
  viewer.scene.canvas = {
    clientWidth: 1440, clientHeight: 900, addEventListener: noop, removeEventListener: noop,
    setAttribute: noop, style: {}, ownerDocument: globalThis.document,
  };
  viewer.camera.moveEnd = { addEventListener: () => noop };
  try {
    // The first enable settles the classification surface, so the second one
    // exercises the `show` restore rather than `applyClassification`'s rebuild.
    cadastreParcelsLayer.enable(viewer);
    cadastreParcelsLayer.disable();
    const kept = viewer.added.filter((primitive) => !viewer.removed.includes(primitive));
    const built = viewer.added.length;
    for (const primitive of kept) assert.equal(primitive.show, false);

    cadastreParcelsLayer.enable(viewer);

    assert.equal(viewer.added.length, built, 'the row came back on a re-tessellation, not on show');
    for (const primitive of kept) {
      assert.equal(primitive.show, true, 'the layer is switched on and drawing nothing');
    }
  } finally {
    cadastreParcelsLayer.disable();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('a parcel whose rings cannot be built costs a primitive, not the draw', async () => {
  // `ringPositions` refuses fewer than three points, so a colour bucket can come
  // out empty — and an empty `GroundPrimitive` is a Cesium throw rather than a
  // blank draw. The parcel stays a record either way: it is still in the count
  // the row reports, and the card still answers for it.
  const viewer = await drawn({
    parcels: [{
      g: [[[[2.3, 48.86], [2.301, 48.86]]]], m: '75056', u: '751060000A0001', p: [2.3, 48.86],
    }],
    sheets: {},
  });
  const shape = cadastreParcelsLayer.getPrimitiveShapeForQa();
  assert.equal(shape.records, 1);
  assert.equal(shape.fills, 0, 'no instances, so no primitive to hold them');
  assert.equal(shape.outlines, 0);
  assert.equal(viewer.added.length, 0);

  _selectCadastreParcelForTest('cadastre:751060000A0001');
  assert.equal(_cadastreSelectedIdForTest(), 'cadastre:751060000A0001', 'still selectable');
  const selected = cadastreParcelsLayer.getPrimitiveShapeForQa();
  assert.equal(selected.selectedFill, false);
  assert.equal(selected.selectedOutline, false);
  assert.equal(viewer.added.length, 0);
});

test('a courtyard survives into the fill as a HOLE, and into the outline as a ring', async () => {
  // Interior rings are courtyards and light wells. Dropped from the fill they
  // are filled in and the card's area stops matching what is on screen; dropped
  // from the outline the courtyard loses the boundary it actually has. The
  // Palais-Royal fixture parcel is the one that carries one.
  const viewer = await drawn();
  const palaisRoyal = recordFor('75101000AJ0002');
  const [outer, courtyard] = palaisRoyal.polygons[0];
  assert.ok(courtyard, 'the fixture parcel should carry a hole');
  _selectCadastreParcelForTest(palaisRoyal.id);

  const [fill, outline] = viewer.added.slice(-2);
  // `_polygonHierarchy` is the only readable seam Cesium leaves on a built
  // `PolygonGeometry`. What it renders to is the pixel harness's question; what
  // is asserted here is that the ring the cadastre published is the ring handed
  // over, hole and all.
  const hierarchy = fill.geometryInstances[0].geometry._polygonHierarchy;
  assert.equal(hierarchy.positions.length, outer.length - 1, 'the closing vertex is dropped, once');
  assert.equal(hierarchy.holes.length, 1, 'the courtyard is a hole, not a filled-in yard');
  assert.equal(hierarchy.holes[0].positions.length, courtyard.length - 1);
  assert.equal(outline.geometryInstances.length, 2, 'the outer boundary AND the courtyard\'s');
});

test('a hole too small to be a ring is dropped without taking the parcel with it', async () => {
  // `ringPositions` refuses fewer than three points. A malformed interior ring
  // must cost the hole and nothing else — refusing the whole parcel would erase
  // land that is genuinely there, which is the more expensive wrong answer.
  const viewer = await drawn({
    parcels: [{
      g: [[
        [[2.30, 48.86], [2.302, 48.86], [2.302, 48.862], [2.30, 48.862], [2.30, 48.86]],
        [[2.3005, 48.8605], [2.3015, 48.8605]],
      ]],
      m: '75056',
      u: '751060000B0002',
      p: [2.301, 48.861],
    }],
    sheets: {},
  });
  assert.equal(cadastreParcelsLayer.getPrimitiveShapeForQa().fills, 1, 'the parcel still draws');

  _selectCadastreParcelForTest('cadastre:751060000B0002');
  const [fill, outline] = viewer.added.slice(-2);
  const hierarchy = fill.geometryInstances[0].geometry._polygonHierarchy;
  assert.equal(hierarchy.positions.length, 4, 'the outer ring built');
  assert.equal(hierarchy.holes.length, 0, 'and the unusable hole was dropped');
  assert.equal(outline.geometryInstances.length, 1, 'no ring to draw for a hole that is not one');
});

test('panning into a box with no parcels tears the draw down and adds nothing', async () => {
  // The gaps in this layer are the public domain, and a view of nothing but
  // street is a real answer. It has to leave an empty globe rather than the
  // previous box's cadastre under a row that says `empty`.
  const viewer = await drawn();
  _selectCadastreParcelForTest(recordFor('69385000AL0005').id);
  const beforeAdds = viewer.added.length;

  viewer.payload = { parcels: [], sheets: {} };
  await cadastreParcelsLayer.update();

  assert.equal(viewer.added.length, beforeAdds, 'an empty box builds nothing at all');
  assert.equal(live(viewer), 0, 'and leaves nothing behind either');
  assert.deepEqual(cadastreParcelsLayer.getPrimitiveShapeForQa(), {
    fills: 0, outlines: 0, records: 0, selectedFill: false, selectedOutline: false,
    classification: Cesium.ClassificationType.BOTH,
  });
  assert.equal(cadastreParcelsLayer.getSelectedParcel(), null);
  assert.equal(_cadastreStatsForTest().status, 'empty');
});

test('a parcel that pans OUT of the box is not restored, and its card goes with it', async () => {
  // The selection is matched back by IDU after every rebuild, because a pan
  // must not cost the operator the card they were reading. The other half of
  // that rule is this one: a parcel that is no longer in the box is no longer
  // an answer, and a highlight left on the last place it was seen would be
  // pointing at a neighbour.
  const viewer = await drawn();
  const target = recordFor('69385000AL0005');
  _selectCadastreParcelForTest(target.id);
  assert.equal(cadastreParcelsLayer.getPrimitiveShapeForQa().selectedFill, true);
  viewer.overlay.calls.cleared.length = 0;

  viewer.payload = {
    ...PAYLOAD,
    parcels: PAYLOAD.parcels.filter((parcel) => parcel.u !== '69385000AL0005'),
  };
  await cadastreParcelsLayer.update();

  const shape = cadastreParcelsLayer.getPrimitiveShapeForQa();
  assert.equal(shape.records, RECORDS.length - 1, 'the rest of the box redrew');
  assert.ok(shape.fills > 0);
  assert.equal(shape.selectedFill, false, 'no highlight over a parcel that is not there');
  assert.equal(shape.selectedOutline, false);
  assert.equal(_cadastreSelectedIdForTest(), null);
  assert.equal(cadastreParcelsLayer.getSelectedParcel(), null);
  assert.ok(
    viewer.overlay.calls.cleared.includes(CADASTRE_SELECTED_OVERLAY_SOURCE_ID),
    'the card was left on screen describing a parcel that is no longer drawn',
  );
});

test('destroy() takes every primitive off the scene, the highlight included', async () => {
  // The teardown a re-init runs through. `_fills` is a fresh array afterwards,
  // so anything still on the scene at this point is unreachable and permanent —
  // five ground primitives that no longer answer to any layer.
  const viewer = await drawn();
  _selectCadastreParcelForTest(recordFor('69385000AL0005').id);
  assert.ok(live(viewer) > 0);

  cadastreParcelsLayer.destroy(viewer);

  assert.equal(live(viewer), 0, 'a primitive outlived the layer that owned it');
  assert.deepEqual(cadastreParcelsLayer.getPrimitiveShapeForQa(), {
    fills: 0, outlines: 0, records: 0, selectedFill: false, selectedOutline: false,
    classification: Cesium.ClassificationType.BOTH,
  });
  assert.equal(_cadastreSelectedIdForTest(), null);
});

// ── The viewport gate ───────────────────────────────────────────────────────

test('the gate is the camera ALTITUDE, not the span of a tilted view rectangle', () => {
  // The bug this replaced: `computeViewRectangle` on a tilted camera reaches
  // the horizon. Measured in the app at 240 m over Paris — 0.0038° of longitude
  // looking straight down, 0.0397° at a 25° pitch. Gating on the span refused
  // the layer at street level on the oblique view this globe defaults to, and
  // told the operator to zoom in when they were already 240 m up.
  const oblique = {
    south: 48.8700, west: 2.2748, north: 48.8918, east: 2.3145,
  }; // the real 240 m / 25° rectangle: 0.0218 x 0.0397
  const result = cadastreViewportBox(viewerWithView(oblique, { altitude: 240 }));
  assert.equal(result.reason, null, 'a 240 m oblique view must load');
  assert.ok(result.box, 'a 240 m oblique view must produce a box');
  // And what it asks for is BOUNDED, however far the lens can see.
  assert.ok(result.box.north - result.box.south <= CADASTRE_MAX_BOX_DEG + 1e-9);
  assert.ok(result.box.east - result.box.west <= CADASTRE_MAX_BOX_DEG + 1e-9);
});

test('the request box holds what the camera looks AT, not where it is', () => {
  // On a tilted camera those are different places — 515 m apart at 240 m and a
  // 25° pitch. Asking around the camera would load the ground behind the
  // operator's shoulder and miss what is in front of them.
  //
  // Containment rather than an exact centre: the box is anchored on the focus
  // and THEN clipped to the view, so a focus point near the edge of the screen
  // legitimately shifts it. Requesting ground that is not on screen would be
  // the worse answer.
  const view = {
    south: 48.870, west: 2.274, north: 48.892, east: 2.315,
  };
  const focus = { lat: 48.8746, lon: 2.2945 };
  const camera = { lat: 48.8700, lon: 2.2945 };
  const { box } = cadastreViewportBox(viewerWithView(view, { altitude: 240, focus }));
  assert.ok(
    focus.lat >= box.south && focus.lat <= box.north
    && focus.lon >= box.west && focus.lon <= box.east,
    `focus ${JSON.stringify(focus)} outside ${JSON.stringify(box)}`,
  );
  // The far half of the screen — kilometres away, where a parcel is well under
  // a pixel — is not requested at all.
  assert.ok(box.north < view.north, 'the horizon end of the view should be trimmed');
  // And the box stays on the looked-at side of the camera.
  assert.ok(Math.abs(((box.south + box.north) / 2) - focus.lat)
    < Math.abs(((box.south + box.north) / 2) - camera.lat) + 1e-9);
});

test('a nadir view smaller than the ceiling is requested whole, not padded out', () => {
  // Nothing is asked for that is not on screen: the clip to the view is what
  // keeps the request honest at low altitude.
  const small = {
    south: 48.8700, west: 2.2926, north: 48.8716, east: 2.2964,
  }; // the real 240 m nadir rectangle
  const { box, reason } = cadastreViewportBox(viewerWithView(small, { altitude: 240 }));
  assert.equal(reason, null);
  assert.ok(Math.abs(box.south - small.south) < 1e-9);
  assert.ok(Math.abs(box.east - small.east) < 1e-9);
});

test('above the altitude ceiling nothing is requested', () => {
  const view = {
    south: 48.86, west: 2.28, north: 48.88, east: 2.31,
  };
  assert.equal(
    cadastreViewportBox(viewerWithView(view, { altitude: CADASTRE_MAX_ALTITUDE_M + 1 })).reason,
    'too-high',
  );
  assert.equal(
    cadastreViewportBox(viewerWithView(view, { altitude: CADASTRE_MAX_ALTITUDE_M })).reason,
    null,
  );
});

test('a camera aimed off France reports off-coverage, however high it is', () => {
  // Measured in the app: at 900 km with a 40° pitch over 46.6N the view
  // rectangle is 51.28-60.70 N — the camera is tilted far enough that it is
  // looking at the North Sea, and métropole ends at 51.2 N. `off-coverage` is
  // the true answer there and `too-high` would be a lie that sends the operator
  // descending toward nothing. Coverage is therefore tested before altitude.
  const northSea = {
    south: 51.28, west: -59.91, north: 60.70, east: 64.71,
  };
  assert.equal(
    cadastreViewportBox(viewerWithView(northSea, { altitude: 900000 })).reason,
    'off-coverage',
  );
  // The same altitude aimed DOWN sees France, and is told to descend.
  const overFrance = {
    south: 43.36, west: -5.03, north: 49.39, east: 9.83,
  };
  assert.equal(
    cadastreViewportBox(viewerWithView(overFrance, { altitude: 900000 })).reason,
    'too-high',
  );
  assert.match(flat(cadastreLoadingLabel({ status: 'too-high' })), /Descends sous 1 500 m/);
});

test('the gate names each refusal separately', () => {
  assert.equal(cadastreViewportBox(viewerWithView(null)).reason, 'no-view');
  assert.equal(cadastreViewportBox(null).reason, 'no-view');
  // A camera with a rectangle but no altitude cannot be gated, and guessing one
  // would answer the question this layer exists to be careful about.
  const view = {
    south: 48.86, west: 2.28, north: 48.88, east: 2.31,
  };
  assert.equal(cadastreViewportBox(viewerWithView(view, { altitude: NaN })).reason, 'no-view');
});

test('a camera looking at the sky falls back to the view, and only if it fits', () => {
  // `pickEllipsoid` returns nothing when the middle of the screen is not the
  // globe. A small view is still usable; a horizon-wide one is not, and is
  // refused rather than cropped to an arbitrary corner of itself.
  const small = {
    south: 48.8700, west: 2.2926, north: 48.8716, east: 2.2964,
  };
  assert.ok(cadastreViewportBox(viewerWithView(small, { altitude: 240, focus: null })).box);
  const wide = {
    south: 48.80, west: 2.20, north: 48.95, east: 2.45,
  };
  assert.equal(cadastreViewportBox(viewerWithView(wide, { altitude: 240, focus: null })).reason, 'no-view');
});

test('coverage is checked BEFORE altitude, so mid-ocean is never told to descend', () => {
  // A high view of the Atlantic fails both gates. Reporting `too-high` would
  // send the operator down toward an answer that does not exist at any
  // altitude; `off-coverage` is the one that is actually true.
  const atlantic = {
    south: 39, west: -31, north: 41, east: -29,
  };
  assert.equal(cadastreViewportBox(viewerWithView(atlantic, { altitude: 900000 })).reason, 'off-coverage');
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
    ['too-high', /Descends sous 1 500 m/],
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

test('update() never refuses the lifecycle just because a GATE said no', async () => {
  // `DataLayerManager` reads a literal `false` from update() as a rejection: it
  // fails the enable, throws LifecycleRejectedError and leaves the layer
  // switched off. This layer has the strictest gate in the app, so returning
  // the load's own boolean meant switching it on from anywhere but street level
  // turned itself straight back off — what the operator saw as "échec de
  // chargement".
  //
  // Every gate is exercised, because each is a different `false` out of
  // `load()` and none of them is a failure.
  const paris = { south: 48.86, west: 2.28, north: 48.88, east: 2.31 };
  const cases = [
    ['too high', paris, { altitude: CADASTRE_MAX_ALTITUDE_M + 1 }],
    ['off coverage', { south: 39, west: -31, north: 41, east: -29 }, { altitude: 400 }],
    ['no view at all', null, { altitude: 400 }],
    ['no altitude to gate on', paris, { altitude: NaN }],
  ];
  for (const [label, view, options] of cases) {
    _setCadastreStateForTest({
      viewer: viewerWithView(view, options),
      records: new Map(),
      payload: null,
      overlayHost: recordingOverlayHost(),
      enabled: true,
      // None of these may reach the network; a `false` from a fetch would be a
      // different claim than the one under test.
      fetchImpl: () => { throw new Error('a closed gate must not reach the network'); },
    });
    assert.notEqual(await cadastreParcelsLayer.update(), false, `update() refused the lifecycle: ${label}`);
  }
});

test('a genuine load failure IS reported as a failed refresh', async () => {
  // The other half of the rule, and the house form: only a recorded error is a
  // failed refresh. Bâti 3D and the mapped grid settled on the same shape, so a
  // dead feed surfaces here rather than leaving the row silently empty.
  _setCadastreStateForTest({
    viewer: viewerWithView({ south: 48.8700, west: 2.2926, north: 48.8716, east: 2.2964 }, { altitude: 240 }),
    records: new Map(),
    payload: null,
    overlayHost: recordingOverlayHost(),
    enabled: true,
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(await cadastreParcelsLayer.update(), false);
  assert.match(_cadastreStatsForTest().error || '', /503/);
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
