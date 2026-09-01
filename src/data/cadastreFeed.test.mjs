// The PCI vecteur projection, against a real captured Api Carto answer.
//
// The property this file exists to hold down is that a cadastral line never
// claims more than it is: not a survey, not a legal boundary, and — the one
// that would silently poison every other claim — not a complete answer when
// Api Carto only sent 5 000 of the parcels in the box.
//
// Every fixture parcel is one trap, and the tests below name which:
//   75103000AP0045 — IDU prefixed by the ARRONDISSEMENT, not code_insee
//   75101000AJ0002 — the Palais-Royal, an interior ring (a courtyard)
//   132038120D0037 — two disjoint parts under one identifier, section "0D"
//   97611000AY1015 — contenance: null (Mamoudzou)
//   67365000220739 — contenance: 0, numeric section "22", a 0.11 m² spike
//   31555815AB0207 — 494 m² drawn against 153 m² declared
//   401340000D0049 — 26.7 ha on a 1:5000 sheet (Landes forest)
//   69382000AL0005 / 69385000AL0005 — one section number, two arrondissements,
//                                     two SCALES: 1:500 and 1:1000
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CADASTRE_AREA_TOLERANCE,
  CADASTRE_BOX_STEP_DEG,
  CADASTRE_MAX_ALTITUDE_M,
  CADASTRE_MAX_BOX_DEG,
  CADASTRE_PEN_MM,
  CADASTRE_REQUEST_MAX_BOX_DEG,
  CADASTRE_SCALE_BANDS,
  CADASTRE_UNKNOWN_BAND,
  CADASTRE_UPSTREAM_LIMIT,
  arrondissementOrdinal,
  boxAreaM2,
  cadastreAreaLines,
  cadastreBoxTooWide,
  cadastreCommuneLine,
  cadastreCoverageIntersects,
  cadastreLoadingLabel,
  cadastreParcelTitle,
  cadastreRequestBox,
  cadastreScaleBand,
  cadastreSheetLine,
  cadastreToleranceLine,
  clipRingToBox,
  finiteOrNull,
  formatScale,
  formatSignedPercent,
  formatSurfaceM2,
  graphicToleranceM,
  indexCadastreSheets,
  parcelAnchor,
  parcelAreaInBoxM2,
  parcelAreaM2,
  projectCadastreParcels,
  sheetKey,
  summarizeCadastreParcels,
} from './cadastreFeed.js';
import { snapBoxOutward, validBox } from './viewportBox.js';

const FIXTURE = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/cadastre-parcelle-sample.json', import.meta.url)),
  'utf8',
));

/** The whole of France plus the DROM, so the fixture's nine communes all fit. */
const WORLD_BOX = { south: -22, west: -62, north: 52, east: 56 };

function project(overrides = {}) {
  return projectCadastreParcels({
    parcelle: FIXTURE.parcelle,
    feuille: FIXTURE.feuille,
    box: WORLD_BOX,
    ...overrides,
  });
}

function parcelById(payload, idu) {
  const found = payload.parcels.find((parcel) => parcel.u === idu);
  assert.ok(found, `fixture parcel ${idu} missing from projection`);
  return found;
}

function sheetFor(payload, parcel) {
  return parcel.k ? payload.sheets[parcel.k] : null;
}

/** Normalize every Unicode space to a plain one before matching copy. */
function flat(text) {
  return String(text).replace(/[\u00a0\u202f\u2009]/g, ' ');
}

// ── Trap 1: a truncated answer is refused, not drawn ────────────────────────

test('a short upstream answer is refused whole and reports the true count', () => {
  const payload = project({
    parcelle: { ...FIXTURE.parcelle, totalFeatures: 15977 },
  });
  assert.equal(payload.truncated, true);
  assert.equal(payload.totalInBox, 15977);
  assert.equal(payload.returned, FIXTURE.parcelle.features.length);
  assert.equal(payload.upstreamLimit, CADASTRE_UPSTREAM_LIMIT);
  // The whole point: the nine parcels that DID arrive are withheld. Drawing
  // them would put a cadastre with scattered holes on screen, which is exactly
  // what a complete cadastre over the public domain looks like.
  assert.deepEqual(payload.parcels, []);
  assert.deepEqual(payload.sheets, {});
  assert.equal(payload.summary.parcels, 0);
});

test('an answer that matches totalFeatures is not treated as truncated', () => {
  const payload = project();
  assert.equal(payload.truncated, false);
  assert.equal(payload.totalInBox, FIXTURE.parcelle.features.length);
  assert.equal(payload.parcels.length, FIXTURE.parcelle.features.length);
});

test('a MISSING totalFeatures falls back to what arrived rather than refusing', () => {
  const { totalFeatures, ...withoutTotal } = FIXTURE.parcelle;
  assert.ok(totalFeatures);
  const payload = project({ parcelle: withoutTotal });
  assert.equal(payload.truncated, false);
  assert.equal(payload.parcels.length, FIXTURE.parcelle.features.length);
});

// ── Trap 2: the IDU is not code_insee + the rest ────────────────────────────

test('the published IDU is carried verbatim, arrondissement prefix and all', () => {
  const payload = project();
  const marais = parcelById(payload, '75103000AP0045');
  // 75103 is Paris 3e. The parcel's own code_insee is 75056, the commune.
  assert.equal(marais.m, '75056');
  assert.equal(marais.r, '103');
  assert.notEqual(marais.u.slice(0, 5), marais.m);
  // Five of the nine fixture parcels are in a commune with arrondissements.
  assert.equal(payload.summary.arrondissementIdu, 5);
});

test('arrondissement ordinals use each city\'s own base, not the last two digits', () => {
  // Paris 75104 -> 4e, Marseille 13203 -> 3e, and the one that made this table
  // exist: Lyon 69382 is the 2e, not the 82e.
  assert.equal(arrondissementOrdinal('104', '75056'), 4);
  assert.equal(arrondissementOrdinal('203', '13055'), 3);
  assert.equal(arrondissementOrdinal('382', '69123'), 2);
  assert.equal(arrondissementOrdinal('385', '69123'), 5);
  // No other commune in France carries a non-zero code_arr; an unknown one is
  // answered with null rather than an ordinal derived from a guessed base.
  assert.equal(arrondissementOrdinal('382', '31555'), null);
  assert.equal(arrondissementOrdinal('000', '75056'), null);
  assert.equal(arrondissementOrdinal('', '75056'), null);
});

test('the commune line names the arrondissement a reader would say', () => {
  const payload = project();
  const lyon2 = parcelById(payload, '69382000AL0005');
  const lyon5 = parcelById(payload, '69385000AL0005');
  assert.match(cadastreCommuneLine(lyon2, payload.communes), /^Lyon 2ᵉ · INSEE 69123$/);
  assert.match(cadastreCommuneLine(lyon5, payload.communes), /^Lyon 5ᵉ · INSEE 69123$/);
  assert.match(
    cadastreCommuneLine(parcelById(payload, '75101000AJ0002'), payload.communes),
    /^Paris 1ᵉʳ/,
  );
  // A commune without arrondissements gets no ordinal at all.
  assert.equal(
    cadastreCommuneLine(parcelById(payload, '401340000D0049'), payload.communes),
    'Labouheyre · INSEE 40134',
  );
});

// ── Trap 3: the sheet join is five parts wide ───────────────────────────────

test('one section number in two arrondissements resolves to two different scales', () => {
  const payload = project();
  const lyon2 = parcelById(payload, '69382000AL0005');
  const lyon5 = parcelById(payload, '69385000AL0005');
  // Same commune, same section, same feuille — the four-part key every obvious
  // implementation would use.
  assert.equal(lyon2.m, lyon5.m);
  assert.equal(lyon2.s, lyon5.s);
  assert.equal(lyon2.f, lyon5.f);
  // Different sheet, and it MATTERS: 1:500 against 1:1000 is ±0.25 m against
  // ±0.5 m on the same drawn boundary.
  assert.notEqual(lyon2.k, lyon5.k);
  assert.equal(sheetFor(payload, lyon2).e, 500);
  assert.equal(sheetFor(payload, lyon5).e, 1000);
  assert.equal(graphicToleranceM(sheetFor(payload, lyon2).e), 0.25);
  assert.equal(graphicToleranceM(sheetFor(payload, lyon5).e), 0.5);
});

test('sheetKey includes code_arr and defaults the two optional parts', () => {
  assert.equal(
    sheetKey({
      code_insee: '69123', code_arr: '382', com_abs: '000', section: 'AL', feuille: 1,
    }),
    '69123/382/000/AL/1',
  );
  // A commune that publishes neither is keyed on the same shape, not a shorter
  // one — two key shapes in one Map is how a join silently half-works.
  assert.equal(
    sheetKey({ code_insee: '40134', section: '0D', feuille: 1 }),
    '40134/000/000/0D/1',
  );
  assert.equal(sheetKey({ code_insee: '40134', section: '0D' }), null);
  assert.equal(sheetKey({ section: '0D', feuille: 1 }), null);
  assert.equal(sheetKey(null), null);
});

test('feuille 0 is a key, not a missing value', () => {
  // `feuille` is a number and `0` is falsy. A truthiness guard would drop every
  // sheet numbered zero on the floor.
  assert.equal(
    sheetKey({ code_insee: '40134', section: '0D', feuille: 0 }),
    '40134/000/000/0D/0',
  );
});

test('sheets are indexed by the five-part key, first record wins', () => {
  const sheets = indexCadastreSheets(FIXTURE.feuille);
  assert.equal(sheets.size, FIXTURE.feuille.features.length);
  assert.deepEqual(sheets.get('69123/385/000/AL/1'), { echelle: 1000, edition: '2026-06-01' });
});

// ── Trap 4: contenance is absent, zero, or simply different ─────────────────

test('an unpublished contenance stays null and is never coerced to zero', () => {
  const payload = project();
  const mayotte = parcelById(payload, '97611000AY1015');
  assert.equal(mayotte.c, null);
  assert.equal(payload.summary.noContenance, 1);
  assert.deepEqual(cadastreAreaLines(mayotte), [
    'Contenance non publiée',
    'Tracé 185 m²',
  ]);
});

test('Number(null) is 0, which is why finiteOrNull guards the blanks itself', () => {
  // The one-line version of this helper turns "not published" into "declares
  // zero square metres" — the exact substitution this layer exists to avoid.
  assert.equal(finiteOrNull(null), null);
  assert.equal(finiteOrNull(undefined), null);
  assert.equal(finiteOrNull(''), null);
  assert.equal(finiteOrNull(false), null);
  assert.equal(finiteOrNull('abc'), null);
  assert.equal(finiteOrNull(0), 0);
  assert.equal(finiteOrNull('500'), 500);
});

test('a published contenance of zero is shown as published, not as missing', () => {
  const payload = project();
  const ostwald = parcelById(payload, '67365000220739');
  assert.equal(ostwald.c, 0);
  const lines = cadastreAreaLines(ostwald);
  assert.match(lines[0], /Contenance déclarée 0 m² — valeur publiée telle quelle/);
  // And its 0.109 m² plan spike survives the round trip rather than rounding to
  // "0 m²", which would read as another missing measurement.
  assert.match(flat(lines[1]), /Tracé 0,11 m²/);
});

test('the drawn area and the declared contenance are both shown, never merged', () => {
  const payload = project();
  const toulouse = parcelById(payload, '31555815AB0207');
  assert.equal(toulouse.c, 153);
  assert.ok(toulouse.a > 490 && toulouse.a < 500, `drawn area was ${toulouse.a}`);
  const lines = cadastreAreaLines(toulouse);
  assert.equal(lines.length, 2);
  assert.match(flat(lines[0]), /Contenance déclarée 153 m²/);
  assert.match(flat(lines[1]), /Tracé 494 m² — \+223 % contre la contenance/);
});

test('agreement inside tolerance is stated as a plain parenthetical', () => {
  const payload = project();
  const landes = parcelById(payload, '401340000D0049');
  const lines = cadastreAreaLines(landes);
  assert.match(flat(lines[1]), /^Tracé 26,59 ha \(−0,32 %\)$/);
  assert.ok(Math.abs(landes.a / landes.c - 1) < CADASTRE_AREA_TOLERANCE);
});

test('the summary counts disagreements rather than averaging them away', () => {
  const summary = project().summary;
  // Seven parcels have a usable (non-null, non-zero) contenance; two of them
  // are outside the 5% band — Marseille's 18 m² sliver and Toulouse's 153 m².
  assert.equal(summary.areaChecked, 7);
  assert.equal(summary.areaDisagreeing, 2);
  assert.equal(summary.worstAreaParcel, '31555815AB0207');
  assert.ok(summary.worstAreaRatio > 2.2);
});

// ── Trap 5: holes and multi-part parcels ────────────────────────────────────

test('an interior ring is subtracted from the parcel it sits in', () => {
  const payload = project();
  const palaisRoyal = parcelById(payload, '75101000AJ0002');
  assert.equal(palaisRoyal.g.length, 1);
  assert.equal(palaisRoyal.g[0].length, 2, 'the fixture parcel should carry one hole');
  assert.equal(payload.summary.withHoles, 1);

  const geometry = { type: 'MultiPolygon', coordinates: palaisRoyal.g };
  const withHole = parcelAreaM2(geometry);
  const withoutHole = parcelAreaM2({ type: 'MultiPolygon', coordinates: [[palaisRoyal.g[0][0]]] });
  assert.ok(withoutHole > withHole, 'dropping the courtyard should inflate the parcel');
  // And the version WITH the hole is the one that matches the DGFiP's figure.
  assert.ok(Math.abs(withHole / palaisRoyal.c - 1) < 0.01);
  assert.ok(Math.abs(withoutHole / palaisRoyal.c - 1) > 0.05);
});

test('both parts of a split parcel are kept and counted once', () => {
  const payload = project();
  const marseille = parcelById(payload, '132038120D0037');
  assert.equal(marseille.g.length, 2);
  assert.equal(payload.summary.multipart, 1);
  // One identifier, one record, two polygons — not two parcels.
  assert.equal(payload.parcels.filter((p) => p.u === marseille.u).length, 1);
  const both = parcelAreaM2({ type: 'MultiPolygon', coordinates: marseille.g });
  const first = parcelAreaM2({ type: 'MultiPolygon', coordinates: [marseille.g[0]] });
  assert.ok(both > first);
});

test('the anchor is the centroid of the LARGEST part, not the first', () => {
  const payload = project();
  const marseille = parcelById(payload, '132038120D0037');
  const areas = marseille.g.map((polygon) => parcelAreaM2({ type: 'Polygon', coordinates: polygon }));
  const largest = areas.indexOf(Math.max(...areas));
  const anchorOfLargest = parcelAnchor({ type: 'Polygon', coordinates: marseille.g[largest] });
  assert.ok(Math.abs(marseille.p[0] - anchorOfLargest[0]) < 1e-6);
  assert.ok(Math.abs(marseille.p[1] - anchorOfLargest[1]) < 1e-6);
});

test('a degenerate ring produces a usable anchor instead of a NaN position', () => {
  // A spike closed on itself has zero signed area; the shoelace centroid would
  // divide by it and hand Cesium a NaN, which renders at the centre of Earth.
  const spike = { type: 'Polygon', coordinates: [[[2, 48], [2, 48], [2, 48], [2, 48]]] };
  const anchor = parcelAnchor(spike);
  assert.deepEqual(anchor, [2, 48]);
});

// ── Trap 6: opaque section and préfixe strings ──────────────────────────────

test('numeric and digit-prefixed sections survive as published', () => {
  const payload = project();
  assert.equal(parcelById(payload, '67365000220739').s, '22'); // Alsace-Moselle
  assert.equal(parcelById(payload, '132038120D0037').s, '0D'); // Marseille
  assert.equal(cadastreParcelTitle(parcelById(payload, '67365000220739')), 'Parcelle 22 0739');
  assert.equal(cadastreParcelTitle(parcelById(payload, '132038120D0037')), 'Parcelle 0D 0037');
});

test('the section préfixe is carried opaquely and defaults to 000', () => {
  const payload = project();
  assert.equal(parcelById(payload, '31555815AB0207').b, '815');
  assert.equal(parcelById(payload, '132038120D0037').b, '812');
  assert.equal(parcelById(payload, '401340000D0049').b, '000');
});

// ── The scale bands, and the tolerance they publish ─────────────────────────

test('every published échelle lands in a band, and nothing else does', () => {
  // The seven values Api Carto was observed to publish, 2026-09-01.
  const published = [250, 500, 1000, 2000, 2500, 4000, 5000];
  for (const echelle of published) {
    assert.notEqual(cadastreScaleBand(echelle).id, CADASTRE_UNKNOWN_BAND.id, `${echelle} unbanded`);
    assert.notEqual(cadastreScaleBand(String(echelle)).id, CADASTRE_UNKNOWN_BAND.id, `"${echelle}" unbanded`);
  }
  // An unseen scale is UNKNOWN rather than snapped to a neighbour: an invented
  // tolerance is the one output this module must never produce.
  for (const bad of [null, undefined, '', 0, -500, 'fine', NaN]) {
    assert.equal(cadastreScaleBand(bad).id, CADASTRE_UNKNOWN_BAND.id, `${bad} was banded`);
    assert.equal(graphicToleranceM(bad), null);
  }
});

test('an unbanded but VALID scale keeps its tolerance and loses only its colour', () => {
  // If IGN publishes a 1:750 sheet tomorrow, the legend cannot colour it — but
  // 0.5 mm at 1:750 is 0.375 m and that number is not in doubt. Suppressing a
  // real tolerance because a legend row is missing is the worse of the two
  // errors, so the band and the tolerance are answered independently.
  assert.equal(cadastreScaleBand(750).id, CADASTRE_UNKNOWN_BAND.id);
  assert.equal(graphicToleranceM(750), 0.375);
  assert.match(flat(cadastreToleranceLine({ e: 750 })), /±0,38 m/);
  // And the grey legend row says so rather than claiming nothing is calculable.
  assert.match(CADASTRE_UNKNOWN_BAND.blurb, /La tolérance reste calculée/);
});

test('no échelle is claimed by two bands', () => {
  const seen = new Set();
  for (const band of CADASTRE_SCALE_BANDS) {
    for (const echelle of band.echelles) {
      assert.ok(!seen.has(echelle), `${echelle} claimed twice`);
      seen.add(echelle);
    }
  }
});

test('the tolerance is the pen width at the plan\'s scale, and says so', () => {
  assert.equal(graphicToleranceM(250), (CADASTRE_PEN_MM / 1000) * 250);
  assert.equal(graphicToleranceM(500), 0.25);
  assert.equal(graphicToleranceM(5000), 2.5);
  const line = flat(cadastreToleranceLine({ e: 500 }));
  assert.match(line, /±0,25 m/);
  // The assumption is ON the line. A bare "±0,25 m" reads as a survey figure.
  assert.match(line, /0,5 mm à l'échelle/);
  assert.match(cadastreToleranceLine({ e: null }), /Tolérance non calculable/);
  assert.match(cadastreToleranceLine(null), /Tolérance non calculable/);
});

test('a parcel whose sheet did not join is UNKNOWN, not banded by default', () => {
  const payload = project({ feuille: { type: 'FeatureCollection', features: [], totalFeatures: 0 } });
  assert.equal(Object.keys(payload.sheets).length, 0);
  for (const parcel of payload.parcels) assert.equal(parcel.k, null);
  const unknown = payload.summary.bands.find((band) => band.id === CADASTRE_UNKNOWN_BAND.id);
  assert.equal(unknown.count, payload.parcels.length);
  const line = cadastreSheetLine(null, payload.parcels[0]);
  assert.match(line, /échelle non publiée/);
});

test('a sheet answer that was itself truncated degrades rather than refusing', () => {
  const payload = project({
    feuille: { ...FIXTURE.feuille, totalFeatures: FIXTURE.feuille.features.length + 3 },
  });
  assert.equal(payload.truncated, false, 'parcels still draw');
  assert.equal(payload.sheetsTruncated, true);
  assert.equal(payload.parcels.length, FIXTURE.parcelle.features.length);
});

// ── The coverage fraction: the layer's headline ─────────────────────────────

test('parcels are clipped to the box before the coverage fraction is taken', () => {
  // Api Carto returns everything INTERSECTING the box, so summing whole parcel
  // areas over a city block reports more ground than the block contains — the
  // first version of this number said 141% over La Défense.
  const box = {
    south: 0, west: 0, north: 0.001, east: 0.001,
  };
  const straddling = {
    type: 'Polygon',
    coordinates: [[[-0.001, -0.001], [0.0005, -0.001], [0.0005, 0.0005], [-0.001, 0.0005], [-0.001, -0.001]]],
  };
  const whole = parcelAreaM2(straddling);
  const inside = parcelAreaInBoxM2(straddling, box);
  assert.ok(inside < whole / 3, `clip kept ${inside} of ${whole}`);
  // The clipped quarter is a quarter of the box.
  assert.ok(Math.abs(inside / boxAreaM2(box) - 0.25) < 0.02);
});

test('a parcel entirely outside the box contributes nothing', () => {
  const box = {
    south: 0, west: 0, north: 0.001, east: 0.001,
  };
  const elsewhere = {
    type: 'Polygon',
    coordinates: [[[10, 10], [10.001, 10], [10.001, 10.001], [10, 10.001], [10, 10]]],
  };
  assert.equal(parcelAreaInBoxM2(elsewhere, box), 0);
  assert.deepEqual(clipRingToBox(elsewhere.coordinates[0], box), []);
});

test('the cadastred fraction is null when there is no box to divide by', () => {
  // Not 0. "We did not measure" and "nothing here is cadastred" are different
  // statements and the row prints them differently.
  assert.equal(summarizeCadastreParcels([], null).cadastredFraction, null);
});

// ── Box gates and coverage ──────────────────────────────────────────────────

test('the proxy ceiling survives an outward snap of a box at the client ceiling', () => {
  // The request box is anchored and clipped, so above a few hundred metres it
  // is EXACTLY the client ceiling on both axes — and `snapBoxOutward` then
  // moves all four edges out by up to a full step each. A proxy bound that only
  // allowed one step of growth 400'd the layer at 400 m and 800 m over Paris.
  const atCeiling = {
    south: 48.8701, west: 2.2801, north: 48.8901, east: 2.3001,
  };
  const snapped = snapBoxOutward(atCeiling, CADASTRE_BOX_STEP_DEG);
  const latSpan = snapped.north - snapped.south;
  const lonSpan = snapped.east - snapped.west;
  assert.ok(latSpan > CADASTRE_MAX_BOX_DEG, 'the snap should genuinely widen it');
  assert.ok(
    validBox(snapped, CADASTRE_REQUEST_MAX_BOX_DEG),
    `snapped to ${latSpan.toFixed(6)} x ${lonSpan.toFixed(6)}, over the ${CADASTRE_REQUEST_MAX_BOX_DEG} proxy bound`,
  );
});

test('the anchored box is bounded, and its snap never exceeds the proxy bound', () => {
  // Swept across the grid so no single lucky alignment carries the assertion.
  const view = {
    south: 48.80, west: 2.20, north: 48.95, east: 2.45,
  };
  for (let i = 0; i < 40; i += 1) {
    const focus = { lat: 48.85 + i * 0.0007, lon: 2.30 + i * 0.0011 };
    const box = cadastreRequestBox(view, focus);
    assert.ok(box, `no box at ${JSON.stringify(focus)}`);
    assert.ok(box.north - box.south <= CADASTRE_MAX_BOX_DEG + 1e-9);
    assert.ok(box.east - box.west <= CADASTRE_MAX_BOX_DEG + 1e-9);
    const snapped = snapBoxOutward(box, CADASTRE_BOX_STEP_DEG);
    assert.ok(
      validBox(snapped, CADASTRE_REQUEST_MAX_BOX_DEG),
      `snap of ${JSON.stringify(box)} rejected by the proxy bound`,
    );
  }
});

test('either span over the ceiling is too wide', () => {
  // Built from zero so the spans are exactly the ceiling. Offsetting by a real
  // latitude would not be: `48.85 + 0.02 - 48.85` is 0.020000000000004547 in
  // binary floating point, and the gate would refuse a box at its own limit.
  const ok = {
    south: 0, west: 0, north: CADASTRE_MAX_BOX_DEG, east: CADASTRE_MAX_BOX_DEG,
  };
  assert.equal(cadastreBoxTooWide(ok), false);
  assert.equal(cadastreBoxTooWide({ ...ok, north: ok.north * 1.001 }), true);
  assert.equal(cadastreBoxTooWide({ ...ok, east: ok.east * 1.001 }), true);
  assert.equal(cadastreBoxTooWide(null), true);
});

test('coverage covers métropole and all five DROM', () => {
  const inside = {
    Paris: [48.8566, 2.3522],
    Ajaccio: [41.9192, 8.7386],
    'Pointe-à-Pitre': [16.2412, -61.5330],
    'Fort-de-France': [14.6161, -61.0588],
    Cayenne: [4.9224, -52.3135],
    'Saint-Denis': [-20.8823, 55.4504],
    Mamoudzou: [-12.7806, 45.2278],
  };
  for (const [name, [lat, lon]] of Object.entries(inside)) {
    const box = {
      south: lat - 0.005, north: lat + 0.005, west: lon - 0.005, east: lon + 0.005,
    };
    assert.equal(cadastreCoverageIntersects(box), true, `${name} should be covered`);
  }
});

test('coverage is a coarse rectangle, not a border, and the empty answer is what says so', () => {
  // The métropole entry is one axis-aligned box, so Geneva and Basel are inside
  // it and Saint-Pierre-et-Miquelon is not. That is deliberate — its job is to
  // stop pointless requests over the Atlantic, not to trace a frontier — and it
  // is honest because the layer does not claim coverage from it: a request over
  // Geneva returns an empty FeatureCollection and the row reads `empty`, whose
  // label names both reasons a view can hold no parcel.
  const around = (lat, lon) => ({
    south: lat - 0.005, north: lat + 0.005, west: lon - 0.005, east: lon + 0.005,
  });
  assert.equal(cadastreCoverageIntersects(around(46.2, 6.14)), true, 'Geneva is inside the rectangle');
  assert.match(cadastreLoadingLabel({ status: 'empty' }), /domaine public, ou hors de France/);

  // Genuinely far outside it, where a request would be a guaranteed waste.
  for (const [name, [lat, lon]] of Object.entries({
    London: [51.5, -0.12],
    'Saint-Pierre': [46.78, -56.17],
    Atlantic: [40, -30],
    Casablanca: [33.57, -7.59],
  })) {
    assert.equal(cadastreCoverageIntersects(around(lat, lon)), false, `${name} should be off-coverage`);
  }
});

// ── Copy ────────────────────────────────────────────────────────────────────

test('the sheet line names the feuille, its scale and its edition date', () => {
  const payload = project();
  const landes = parcelById(payload, '401340000D0049');
  const line = flat(cadastreSheetLine(sheetFor(payload, landes), landes));
  // The `feuille` endpoint publishes `edition` as a DATE; `division` publishes
  // it as an integer version. This layer joins the one a reader can act on.
  assert.equal(line, 'Feuille 0D 01 au 1:5000 · édition 2026-06-01');
});

test('a scale denominator is one token, not a grouped number', () => {
  assert.equal(formatScale(5000), '1:5000');
  assert.equal(formatScale('500'), '1:500');
  assert.equal(formatScale(0), null);
  assert.equal(formatScale(null), null);
});

test('surfaces switch units at both ends of the range', () => {
  assert.equal(flat(formatSurfaceM2(0.109)), '0,11 m²');
  assert.equal(flat(formatSurfaceM2(153)), '153 m²');
  assert.equal(flat(formatSurfaceM2(9999)), '9 999 m²');
  assert.equal(flat(formatSurfaceM2(266800)), '26,68 ha');
  assert.equal(formatSurfaceM2(null), null);
  assert.equal(flat(formatSurfaceM2(0)), '0 m²');
});

test('percentage precision scales so a strong agreement never prints as −0,0 %', () => {
  assert.equal(flat(formatSignedPercent(-0.0032)), '−0,32 %');
  assert.equal(flat(formatSignedPercent(0.0002)), '+0,02 %');
  assert.equal(flat(formatSignedPercent(0.061)), '+6,1 %');
  assert.equal(flat(formatSignedPercent(2.2288)), '+223 %');
  assert.equal(formatSignedPercent(null), null);
});

test('each refusal explains itself in its own terms', () => {
  assert.match(
    flat(cadastreLoadingLabel({ status: 'too-high' })),
    new RegExp(`Descends sous ${CADASTRE_MAX_ALTITUDE_M.toLocaleString('en-US').replace(',', ' ')} m`),
  );
  assert.match(cadastreLoadingLabel({ status: 'off-coverage' }), /Hors couverture PCI vecteur/);
  const dense = flat(cadastreLoadingLabel({ status: 'too-dense', totalInBox: 15977 }));
  assert.match(dense, /15 977 parcelles ici/);
  assert.match(dense, /5 000/); // the ceiling that refused it, named
  // A refusal with no count still says what to do rather than going silent.
  assert.match(cadastreLoadingLabel({ status: 'too-dense' }), /trop dense/);
  assert.equal(cadastreLoadingLabel({ status: 'ready' }), null);
});

// ── The projection as a whole ───────────────────────────────────────────────

test('the projection carries provenance and interns the commune names', () => {
  const payload = project();
  assert.match(payload.source, /Api Carto/);
  assert.equal(payload.licence, 'Licence Ouverte 2.0');
  // Interned, not repeated per parcel: the two Lyon parcels share one entry.
  assert.equal(payload.communes['69123'], 'Lyon');
  assert.equal(Object.keys(payload.communes).length, 7);
  assert.equal(payload.summary.communes, 7);
});

test('a parcel with no usable geometry is dropped rather than drawn at [0,0]', () => {
  const payload = project({
    parcelle: {
      type: 'FeatureCollection',
      totalFeatures: 2,
      features: [
        FIXTURE.parcelle.features[0],
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [2, 48] },
          properties: { idu: '99999000ZZ0001', code_insee: '99999', section: 'ZZ', feuille: 1 },
        },
      ],
    },
  });
  assert.equal(payload.parcels.length, 1);
  assert.equal(payload.parcels[0].u, FIXTURE.parcelle.features[0].properties.idu);
});

test('the summary reports the sheet editions it actually saw', () => {
  const summary = project().summary;
  assert.deepEqual(summary.editions, ['2026-06-01']);
  assert.equal(summary.sheets, FIXTURE.feuille.features.length);
});
