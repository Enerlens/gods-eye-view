// src/data/urbanismeGpu.test.mjs
//
// The reported symptom, in the operator's own words: "comment c'est possible
// qu'une maison puisse se retrouver en même temps dans deux zones de PLU ? il
// doit y avoir une erreur". There was, and it was ours. The register drew the
// Ustaritz `UB` zone with two enclaves punched out of it — the school (`UE`)
// and the industrial estate (`UYc`) — and this layer kept outer rings only,
// which is invisible while a zone is a hairline and a lie the moment it is a
// wash. These pin the wash, the holes, and the stroke on each of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  GPU_BOX_MAX_ALTITUDE_M, GPU_MAX_BOX_DEG, projectGpu, projectZones,
} from './gpuFeed.js';
import { pointInPolygons } from './ringGeometry.js';
import {
  ZONE_FAMILY_SENTENCES,
  ZONE_FILL_MAX_ALPHA,
  drawGpuParts,
  gpuAnswerAt,
  gpuClassificationTypeForScene,
  gpuGroundCard,
  gpuScanBox,
  gpuScanParams,
  servitudeLines,
  servitudeSentence,
  zoneApprovalDate,
  zoneDescription,
  zoneColorCss,
  zoneFamilySentence,
  zoneFillAlpha,
} from './urbanismeGpu.js';

const ENCLAVES = JSON.parse(readFileSync(
  new URL('./fixtures/gpu-zone-urba-enclaves-sample.json', import.meta.url), 'utf8',
));
const PARIS_ZONING = JSON.parse(readFileSync(
  new URL('./fixtures/gpu-zone-urba-sample.json', import.meta.url), 'utf8',
));
const SERVITUDES = JSON.parse(readFileSync(
  new URL('./fixtures/gpu-assiette-sup-s-sample.json', import.meta.url), 'utf8',
));

const now = () => Cesium.JulianDate.now();
const style = (over = {}) => ({
  css: '#ff9d3d',
  fillAlpha: 0.18,
  width: 3,
  dashed: false,
  classificationType: Cesium.ClassificationType.TERRAIN,
  name: 'UB — Zone UB',
  description: 'zone urbaine',
  properties: { kind: 'plu-zone' },
  ...over,
});

test('a zone is drawn as a wash with its enclaves cut out of it', () => {
  const source = new Cesium.CustomDataSource('gpu-test');
  const [zone] = projectZones(ENCLAVES);
  const drawn = drawGpuParts(source, 'gpu:zone:1', zone.parts, style());

  assert.equal(drawn, 1, 'one piece of ground');
  const fills = source.entities.values.filter((entity) => entity.polygon);
  assert.equal(fills.length, 1);
  const hierarchy = fills[0].polygon.hierarchy.getValue(now());
  assert.equal(hierarchy.holes.length, 2, 'the school and the industrial estate');
  assert.ok(hierarchy.positions.length > hierarchy.holes[0].positions.length);
});

test('the wash is ground classification, or it floats over the photograph', () => {
  const source = new Cesium.CustomDataSource('gpu-test');
  const [zone] = projectZones(ENCLAVES);
  drawGpuParts(source, 'gpu:zone:1', zone.parts, style());
  const fill = source.entities.values.find((entity) => entity.polygon);
  assert.equal(
    fill.polygon.classificationType.getValue(now()),
    Cesium.ClassificationType.TERRAIN,
  );
  assert.equal(fill.polygon.outline.getValue(now()), false, 'the stroke is its own entity');
});

test('every ring is stroked, the interior ones included', () => {
  const source = new Cesium.CustomDataSource('gpu-test');
  const [zone] = projectZones(ENCLAVES);
  drawGpuParts(source, 'gpu:zone:1', zone.parts, style());
  const strokes = source.entities.values.filter((entity) => entity.polyline);
  // An enclave has a boundary too, and it is the boundary a reader needs most:
  // it is the line that says the rule STOPS here.
  assert.equal(strokes.length, 3);
  for (const stroke of strokes) {
    assert.equal(stroke.polyline.clampToGround.getValue(now()), true);
    assert.equal(stroke.name, 'UB — Zone UB');
  }
});

test('a stroked ring is closed, so the last point meets the first', () => {
  const source = new Cesium.CustomDataSource('gpu-test');
  drawGpuParts(source, 'gpu:zone:1', [[[[2, 48], [2.001, 48], [2.001, 48.001]]]], style());
  const positions = source.entities.values
    .find((entity) => entity.polyline).polyline.positions.getValue(now());
  assert.equal(positions.length, 4);
  assert.ok(Cesium.Cartesian3.equals(positions[0], positions[3]));
});

test('a servitude takes no wash and is dashed, because it is not zoning', () => {
  const source = new Cesium.CustomDataSource('gpu-test');
  drawGpuParts(source, 'gpu:sup:1', [[[[2, 48], [2.01, 48], [2.01, 48.01]]]], style({
    css: '#ff4d3d', fillAlpha: 0, dashed: true, width: 5,
  }));
  assert.equal(source.entities.values.filter((entity) => entity.polygon).length, 0);
  const stroke = source.entities.values.find((entity) => entity.polyline);
  assert.ok(stroke.polyline.material instanceof Cesium.PolylineDashMaterialProperty);
});

test('a ring under a triangle is not a shape and is skipped, not crashed on', () => {
  const source = new Cesium.CustomDataSource('gpu-test');
  const drawn = drawGpuParts(source, 'gpu:zone:1', [
    [[[2, 48], [2.001, 48]]],
    [[[2, 48], [2.001, 48], [2.001, 48.001]], [[2.0005, 48.0002]]],
  ], style());
  assert.equal(drawn, 1, 'the two-point part is not drawn');
  const fill = source.entities.values.find((entity) => entity.polygon);
  assert.equal(fill.polygon.hierarchy.getValue(now()).holes.length, 0,
    'a one-point hole is not a hole');
});

// Measured 2026-09-01 over twelve APIcarto boxes — 4 216 zoning features and
// not one plain `AU`. Every à-urbaniser zone published `AUc` or `AUs`, so a
// table of `{U, AU, A, N}` drew the family this module exists for in the
// unknown-value grey, everywhere in France.
const OBSERVED_TYPEZONES = ['U', 'AUc', 'AUs', 'A', 'N', 'Ah', 'Nh'];

test('every typezone the register actually publishes is coloured and explained', () => {
  for (const kind of OBSERVED_TYPEZONES) {
    assert.notEqual(zoneColorCss(kind), '#c9d4e0', `${kind} must not fall to the unknown grey`);
    assert.ok(zoneFamilySentence(kind), `${kind} must be explained in words`);
  }
  assert.equal(zoneColorCss('U'), '#ff9d3d');
  assert.equal(zoneColorCss('A'), '#9ad14b');
  assert.equal(zoneColorCss('N'), '#3dd6c4');
  // A value this grammar does not know is drawn neutral and left unexplained
  // rather than assigned to whichever family it looks nearest.
  assert.equal(zoneColorCss('ZZ'), '#c9d4e0');
  assert.equal(zoneFamilySentence('ZZ'), null);
  assert.equal(zoneFamilySentence(null), null);
});

test('the tables are read case-insensitively, or `AUc` matches nothing', () => {
  // `'AUc'.toUpperCase()` is `AUC`. An upper-cased lookup against a table
  // written in the register's own spelling silently misses every mixed-case
  // value — which is 2.85% of French zoning and the whole AU family.
  assert.equal(zoneColorCss('AUC'), zoneColorCss('AUc'));
  assert.equal(zoneFillAlpha('auc'), zoneFillAlpha('AUc'));
  assert.equal(zoneFamilySentence('AH'), zoneFamilySentence('Ah'));
});

test('open and closed AU are the same family on a different clock', () => {
  // `AUc` is buildable under the PLU as it stands; `AUs` needs the document
  // modified or revised first. Same magenta family, cooled, and quieter.
  assert.notEqual(zoneColorCss('AUc'), zoneColorCss('AUs'));
  assert.ok(zoneFillAlpha('AUc') > zoneFillAlpha('AUs'));
  assert.ok(zoneFamilySentence('AUc').includes('OUVERTE'));
  assert.ok(zoneFamilySentence('AUs').includes('FERMÉE'));
});

test('the wash is weighted by what a family does to a view, and capped', () => {
  // `AUc` is the answer to "could the field opposite become forty flats?", and
  // it is rare and small. `A` and `N` are most of the country: at the urban
  // weight a natural zone washes a whole valley and the orthophoto under it
  // stops being readable, which costs more than the wash says.
  assert.ok(zoneFillAlpha('AUc') > zoneFillAlpha('U'));
  assert.ok(zoneFillAlpha('U') > zoneFillAlpha('N'));
  assert.equal(zoneFillAlpha('A'), zoneFillAlpha('N'));
  // The floor is measured, not felt: at 0.18 the wash moved an IGN orthophoto
  // by a mean of 3/255 in red and could not be seen at all.
  for (const kind of [...OBSERVED_TYPEZONES, 'AU', 'ZZ', null]) {
    const alpha = zoneFillAlpha(kind);
    assert.ok(alpha >= 0.22, `${kind} must be visible on an orthophoto`);
    assert.ok(alpha <= ZONE_FILL_MAX_ALPHA, `${kind} must annotate the ground, not replace it`);
  }
});

test('a hidden globe leaves only the tileset to receive the wash', () => {
  // Asking for TERRAIN with the globe off draws nothing at all, which reads as
  // a layer that switched itself off when the basemap changed.
  assert.equal(
    gpuClassificationTypeForScene({ globe: { show: false } }),
    Cesium.ClassificationType.CESIUM_3D_TILE,
  );
  assert.equal(
    gpuClassificationTypeForScene({ globe: { show: true } }),
    Cesium.ClassificationType.TERRAIN,
  );
  assert.equal(gpuClassificationTypeForScene(null), Cesium.ClassificationType.BOTH);
});

// ── Which question the layer asks ───────────────────────────────────────────

/** A viewer whose camera sits at `altitudeM` over a point, looking down. */
function viewerAt(lon, lat, altitudeM, spanDeg = 0.03) {
  return {
    camera: {
      positionCartographic: new Cesium.Cartographic(
        Cesium.Math.toRadians(lon), Cesium.Math.toRadians(lat), altitudeM,
      ),
      computeViewRectangle: () => Cesium.Rectangle.fromDegrees(
        lon - spanDeg / 2, lat - spanDeg / 2, lon + spanDeg / 2, lat + spanDeg / 2,
      ),
    },
    scene: { globe: { ellipsoid: Cesium.Ellipsoid.WGS84 } },
  };
}

const USTARITZ = { lon: -1.454242, lat: 43.395303 };

test('close in it asks for the block; higher up it asks about the point', () => {
  const low = { ...USTARITZ, altitudeM: 900 };
  const box = gpuScanBox(low, viewerAt(USTARITZ.lon, USTARITZ.lat, 900));
  assert.ok(box, 'below the box altitude the layer draws the neighbourhood');
  assert.ok((box.north - box.south) <= GPU_MAX_BOX_DEG + 1e-9);
  assert.ok((box.east - box.west) <= GPU_MAX_BOX_DEG + 1e-9);

  const high = { ...USTARITZ, altitudeM: GPU_BOX_MAX_ALTITUDE_M + 1 };
  assert.equal(gpuScanBox(high, viewerAt(USTARITZ.lon, USTARITZ.lat, high.altitudeM)), null,
    'above it, one point is still a correct answer and a far cheaper one');
});

test('the box is clipped to the view, so nothing off screen is asked for', () => {
  // A tight nadir view is smaller than the ceiling; the box must be the view,
  // not a fixed square around it.
  const tight = viewerAt(USTARITZ.lon, USTARITZ.lat, 300, 0.004);
  const box = gpuScanBox({ ...USTARITZ, altitudeM: 300 }, tight);
  assert.ok((box.east - box.west) < GPU_MAX_BOX_DEG / 2, 'clipped to the smaller view');
});

test('the regime shows up in the query, which is what makes a zoom rescan', () => {
  // The scan-shift guard only watches the CENTRE. Zoom straight down through
  // the box altitude and the centre has not moved at all, while the question
  // being asked has changed completely — so the params have to differ.
  const near = gpuScanParams({ ...USTARITZ, altitudeM: 900 },
    viewerAt(USTARITZ.lon, USTARITZ.lat, 900));
  const far = gpuScanParams({ ...USTARITZ, altitudeM: 9000 },
    viewerAt(USTARITZ.lon, USTARITZ.lat, 9000));
  assert.deepEqual(Object.keys(near).sort(), ['east', 'north', 'south', 'west']);
  assert.deepEqual(far, {}, 'no bbox at all IS the point regime, server-side');
  assert.notDeepEqual(near, far);
});

test('a camera with no view rectangle asks about the point rather than guessing', () => {
  assert.equal(gpuScanBox({ ...USTARITZ, altitudeM: 400 }, null), null);
  assert.equal(gpuScanBox({ lon: 1, lat: 1, altitudeM: NaN }, viewerAt(1, 1, 400)), null);
});

test('a neighbouring zone says it is a neighbour, on its own card', () => {
  // Under a box most of what is drawn is NOT the answer to "what applies
  // here", and a card that read the same either way would turn a map of the
  // block into fifty claims about one address.
  assert.ok(zoneDescription({ kind: 'U', code: 'UB', atPoint: true }).length > 0);
  assert.ok(!zoneDescription({ kind: 'U', code: 'UB', atPoint: true }).includes('voisine'));
  assert.ok(zoneDescription({ kind: 'A', code: 'A', atPoint: false }).includes('voisine'));
});

// ── Clicking the ground, not the marker ──────────────────────────────────────
//
// The reported symptom, in the operator's own words: "j'aimerais que lorsque
// l'on clique n'importe où sur la carte, cela vienne ouvrir une fenêtre
// informative … et que l'on n'ait pas l'obligation d'aller trouver le petit
// symbole pour aller cliquer dessus". The map was already drawing the answer
// for a whole block and putting the only words on one 26-pixel glyph, so the
// plot OPPOSITE — the plot this layer exists for — could be seen and not read.
//
// These pin the four regimes the answer has, and the two places where reading
// it off the drawn shapes would be a lie.

/** Avenue de France, Paris 13e — the address both Paris fixtures answer for. */
const PARIS = { lon: 2.3760, lat: 48.8300 };
const USTARITZ_BOX = {
  south: 43.388, west: -1.470, north: 43.402, east: -1.450,
};
/**
 * A point APIcarto itself answers `UB` for that falls OUTSIDE the drawn `UB`
 * ring. Not invented: sampling the fixture's published outer ring against the
 * decimated one on a 400×400 grid finds 571 such points, which is the 521→400
 * vertex decimation showing up as ground.
 */
const DECIMATION_GAP = { lon: -1.462153, lat: 43.39983 };
/** Inside the village-centre zone, 400 m from the gap and well clear of it. */
const IN_THE_ZONE = { lon: -1.45702, lat: 43.39632 };
/** The school enclave: `UE` in the document, a hole punched out of `UB`. */
const THE_SCHOOL = { lon: -1.45669, lat: 43.39522 };

const boxedPayload = (point) => projectGpu({
  zoning: ENCLAVES, servitudes: null, point, box: USTARITZ_BOX,
});

test('a click on the ground answers for the ground, with no marker involved', () => {
  const payload = boxedPayload(DECIMATION_GAP);
  const card = gpuGroundCard({ payload, ...IN_THE_ZONE, point: DECIMATION_GAP });
  assert.match(card.title, /^UB — /);
  assert.ok(card.details.includes('zone urbaine — déjà bâtie et équipée'),
    'the family is spelled out, not left as a letter');
});

test('the enclave is a hole in the answer too, not only in the wash', () => {
  // The whole reason the holes were cut: a card that answered `UB` over the
  // school would put a building in a zone it is not in, which is the bug this
  // module's own tests were written for — wearing the card's clothes.
  const payload = boxedPayload(DECIMATION_GAP);
  const card = gpuGroundCard({ payload, ...THE_SCHOOL, point: DECIMATION_GAP });
  assert.ok(!card.title.includes('UB'), `the school is not UB, got ${card.title}`);
});

test('at the marker the register answers, and a decimated ring cannot overrule it', () => {
  // The measured trap: APIcarto answers `UB` for this point, and the ring this
  // module draws — straightened from 521 vertices to 400 — excludes it. Read
  // off the drawn shape, clicking the marker's own ground would report no
  // zoning at the one point where the register has actually spoken.
  const payload = boxedPayload(DECIMATION_GAP);
  assert.ok(!pointInPolygons(payload.zones[0].parts, DECIMATION_GAP.lon, DECIMATION_GAP.lat),
    'the fixture still holds the decimation gap this test exists for');
  const answer = gpuAnswerAt(payload, DECIMATION_GAP.lon, DECIMATION_GAP.lat, DECIMATION_GAP);
  assert.equal(answer.fromRegister, true);
  assert.equal(answer.zones.length, 1, 'the register said UB, so the card says UB');
  assert.match(gpuGroundCard({ payload, ...DECIMATION_GAP, point: DECIMATION_GAP }).title, /^UB — /);
});

test('the register only answers its own patch of ground', () => {
  const payload = boxedPayload(DECIMATION_GAP);
  const near = gpuAnswerAt(payload, DECIMATION_GAP.lon, DECIMATION_GAP.lat + 0.0001, DECIMATION_GAP);
  const far = gpuAnswerAt(payload, IN_THE_ZONE.lon, IN_THE_ZONE.lat, DECIMATION_GAP);
  assert.equal(near.fromRegister, true, '11 m away is still the marker`s own ground');
  assert.equal(far.fromRegister, false, '400 m away the drawn map answers');
  assert.equal(far.zones.length, 1, 'and it answers correctly, inside the zone');
});

test('four ways to have no zoning, and only one of them is about the ground', () => {
  const point = DECIMATION_GAP;
  const boxed = boxedPayload(point);
  const outside = gpuGroundCard({ payload: boxed, lon: -1.44, lat: 43.39, point });
  assert.equal(outside.title, 'Hors du bloc interrogé');
  assert.ok(outside.details.some((line) => line.includes('bloc dessiné')));

  const pointRegime = projectGpu({ zoning: ENCLAVES, servitudes: null, point, box: null });
  const away = gpuGroundCard({ payload: pointRegime, lon: -1.44, lat: 43.39, point });
  assert.equal(away.title, 'Zonage non interrogé ici');
  assert.ok(away.details.some((line) => line.includes('repère')));

  const refused = projectGpu({
    zoning: ENCLAVES, servitudes: null, point, box: USTARITZ_BOX,
    zoningRefused: { found: 17182, limit: 5000 },
  });
  assert.equal(gpuGroundCard({ payload: refused, ...IN_THE_ZONE, point }).title, 'Zonage non dessiné');

  const covered = gpuGroundCard({ payload: boxed, ...THE_SCHOOL, point });
  assert.equal(covered.title, 'Aucun zonage à ce point');
  assert.ok(covered.details.some((line) => line.includes('bien été interrogé')),
    'the one case that IS about the ground says so, rather than blaming the layer');
});

test('an easement absence names what was checked, because "clear" is a claim', () => {
  const point = PARIS;
  const payload = projectGpu({ zoning: PARIS_ZONING, servitudes: SERVITUDES, point, box: null });
  assert.equal(payload.servitudes.length, 5);

  const atMarker = gpuGroundCard({ payload, ...point, point });
  assert.ok(atMarker.details.some((line) => line.startsWith('5 servitudes ici :')),
    'every easement the register returned reaches the point it was asked about');

  // Somewhere none of the five envelopes reaches. The register was never asked
  // about it, and saying "aucune servitude" there would be a survey this layer
  // has not done.
  const elsewhere = gpuAnswerAt(payload, 2.30, 48.90, point);
  assert.equal(elsewhere.servitudes.length, 0);
  const sentence = servitudeSentence(elsewhere);
  assert.ok(sentence.includes('5 servitudes du repère'), sentence);
  assert.ok(!sentence.includes('aucune servitude à ce point'),
    'that sentence is reserved for the point the register actually answered');
});

test('an approval date is a date, not eight digits', () => {
  // The same national schema, two spellings, measured: Ustaritz publishes
  // `20240323` and Paris `2026-06-16`.
  assert.equal(zoneApprovalDate('20240323'), '23/03/2024');
  assert.equal(zoneApprovalDate('2026-06-16'), '16/06/2026');
  assert.equal(zoneApprovalDate(''), null);
  assert.equal(zoneApprovalDate('en cours'), 'en cours', 'anything else is passed through');
});

test('the card fits the box the overlay paints, in both directions', () => {
  // Six lines because that is what `createAddressScanOverlayEntry` keeps, and
  // a bounded WIDTH because the overlay neither wraps nor truncates: a card is
  // exactly as wide as its longest detail, so one unbounded list of easement
  // labels is a card two thirds of the screen across.
  const widest = Math.max(...Object.values(ZONE_FAMILY_SENTENCES).map((line) => line.length));
  const seen = [];
  for (const [zoning, servitudes, point, box] of [
    [PARIS_ZONING, SERVITUDES, PARIS, null],
    [ENCLAVES, null, DECIMATION_GAP, USTARITZ_BOX],
  ]) {
    const payload = projectGpu({ zoning, servitudes, point, box });
    for (const at of [point, IN_THE_ZONE, THE_SCHOOL, { lon: 2.30, lat: 48.90 }]) {
      const card = gpuGroundCard({ payload, ...at, point });
      seen.push(card);
      assert.ok(card.details.length <= 6, `${card.title}: ${card.details.length} lines`);
      for (const line of [card.title, ...card.details]) {
        assert.ok(typeof line === 'string' && line.length > 0, `empty line on ${card.title}`);
        assert.ok(line.length <= widest, `${line.length} chars, over ${widest}: ${line}`);
      }
    }
  }
  // The Paris address answers five easements under three family names, which
  // is the case that used to compose a 108-character line.
  const listed = seen.find((card) => card.details.includes('5 servitudes ici :'));
  assert.ok(listed, 'a list too wide for one line is given a row per family');
  assert.equal(listed.details.filter((line) => line.startsWith('· ')).length, 3);
});

test('the easement list yields its rows to the zone, never the other way round', () => {
  // Six rows is the whole card, and the rule the operator came for — which
  // zone, approved when, under which document — is not the half that should
  // lose one. A card with no room to list counts instead.
  const point = PARIS;
  const payload = projectGpu({ zoning: PARIS_ZONING, servitudes: SERVITUDES, point, box: null });
  const answer = gpuAnswerAt(payload, point.lon, point.lat, point);
  assert.deepEqual(servitudeLines(answer, 4), [
    '5 servitudes ici :',
    '· Abords d\'un monument historique',
    '· Voie ferrée — zone de protection',
    '· Plan de prévention des risques (naturels ou technologiques)',
  ]);
  assert.deepEqual(servitudeLines(answer, 3), [
    '5 servitudes ici :',
    '· Abords d\'un monument historique',
    '· et 2 autres',
  ]);
  assert.deepEqual(servitudeLines(answer, 2), [servitudeSentence(answer)],
    'with one row to spare it is a sentence, not a list of one');
  for (const budget of [2, 3, 4, 5]) {
    assert.ok(servitudeLines(answer, budget).length <= budget, `overran ${budget}`);
  }
});

test('with nothing scanned there is nothing to answer, and no empty card', () => {
  assert.equal(gpuAnswerAt(null, 2, 48, null), null);
  assert.equal(gpuAnswerAt({ zones: [] }, NaN, 48, null), null);
  assert.equal(gpuGroundCard({ payload: null, lon: 2, lat: 48 }), null);
});
