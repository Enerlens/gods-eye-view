// What the DRAWN layer is allowed to claim, once `bruitFeed.js` has already
// proved that the units are right.
//
// ONE property runs through this whole file, and it is the defect this layer
// was built to avoid: **the layer never picks a zone silently.** A WMS
// GetFeatureInfo answers with every polygon within a buffer of the queried
// pixel, and measured over the 224 aerodromes in the register, 74 of the 215
// probes that answer at all — 34% — come back with more than one. Taking
// `features[0]` would be a coin toss on a third of France. Every test below
// closes one door that silence could come through: the ranking itself, the
// clause that decided it, the card that has to name that clause, the runner-up
// that has to stay on the card, the bands the point is NOT in, and the legend.
//
// The SECOND property is that a blank answer is never ambiguous. An empty
// FeatureCollection and a service that did not reply are the same zero features
// downstream, and only `available` tells them apart — so "aucun plan ici" and
// "le service n'a pas répondu" are two different sentences, and the tests pin
// both.
//
// The THIRD is that nothing on screen carries a bare number: every threshold
// goes through `bandText`, which suppresses the unit rather than guessing it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';

import { BRUIT_AREA_SCALE_DENOMINATOR, projectBruit, projectBruitArea } from './bruitFeed.js';
import { ZONE_FILL_MAX_ALPHA } from './urbanismeGpu.js';
import bruitFranceLayer, {
  ADDRESS_SCAN_CEILING_M,
  BRUIT_OVERVIEW_CEILING_M,
  BRUIT_FILL_ALPHA,
  BRUIT_ARRETE_UNDER_MARKER_KM,
  BRUIT_FR_ENDPOINT,
  BRUIT_FR_LAYER_ID,
  BRUIT_LABEL_MIN_WIDTH_DEG,
  BRUIT_OUTLINE_WIDTH_PX,
  BRUIT_UNKNOWN_ZONE_COLOR,
  BRUIT_WINNER_RULES,
  PEB_ZONE_COLORS,
  PGS_ZONE_COLORS,
  bruitAerodromeDescription,
  bruitAerodromeTitle,
  bruitAreaEmphasis,
  bruitAreaRadiusKm,
  bruitAreaSummary,
  BRUIT_CARD_MAX_LINES,
  bruitBandDescription,
  bruitBandLabel,
  bruitCardDetails,
  bruitGroundCard,
  bruitDayText,
  bruitDrawOrder,
  bruitEmphasis,
  bruitGuidanceLabel,
  bruitLegend,
  bruitMarkerGlyph,
  bruitMarkerTitle,
  bruitNearestSentence,
  bruitScanDescription,
  bruitScanParams,
  bruitStatus,
  bruitZoneColorCss,
  bruitZoneRank,
  chooseBruitAnswer,
  drawBruitParts,
  summarizeBruit,
  _bruitRowControlsForTest,
  _drawBruitForTest,
  _setBruitStateForTest,
} from './bruitFrance.js';

// Cesium reads the aliased line-width range off a live WebGL context, and there
// is none under `node --test`, so `ContextLimits._maximumAliasedLineWidth` sits
// at 0 and EVERY `RenderState.fromCache` throws "renderState.lineWidth is out
// of range" — including the default width of 1. Priming it is a property of the
// harness, not of the layer.
const { default: ContextLimits } = await import('@cesium/engine/Source/Renderer/ContextLimits.js');
ContextLimits._maximumAliasedLineWidth = 16;

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const norm = (value) => String(value).replace(/[\s ]+/g, ' ');
const now = () => Cesium.JulianDate.now();

const EMPTY_PGS = read('bruit-peb-empty-sample.json');

/** Assemble a proxy payload exactly the way the `/api/bruit-fr` route does. */
function payloadFor(pebFixture, point, { pgs = EMPTY_PGS, nearest = null, register = null } = {}) {
  return {
    ...projectBruit({ peb: pebFixture, pgs, point, nearest }),
    register: register ?? {
      count: 224, total: 224, short: false, truncated: false, psophique: 70, lden: 154,
    },
  };
}

/** Saint-Cyr: zones A and B of ONE plan, both containing the point. */
const LFPZ_POINT = { lat: 48.81025, lon: 2.07712 };
const LFPZ = payloadFor(read('bruit-peb-lfpz-sample.json'), LFPZ_POINT);
/** Le Bourget: two AIRPORTS, LFPB zone A and LFPG zone D. */
const LEBOURGET_POINT = { lat: 48.96848, lon: 2.43817 };
const LEBOURGET = payloadFor(read('bruit-peb-lebourget-sample.json'), LEBOURGET_POINT);
/** Cannes: zone B under the point, zone C beside it, thresholds inverted. */
const LFMD_POINT = { lat: 43.53184, lon: 6.95601 };
const LFMD = payloadFor(read('bruit-peb-lfmd-sample.json'), LFMD_POINT);
/** Gap: a 1985 register row on a 2017 document. */
const LFNA_POINT = { lat: 44.4550, lon: 6.0378 };
const LFNA = payloadFor(read('bruit-peb-lfna-sample.json'), LFNA_POINT);
/** Toussus-le-Noble: an arrêté, and no polygon at any scale. */
const TOUSSUS_POINT = { lat: 48.7498, lon: 2.1112 };
const TOUSSUS = payloadFor(read('bruit-peb-empty-sample.json'), TOUSSUS_POINT, {
  nearest: {
    oaci: 'LFPG', name: 'P. CH. DE-GAULLE', lat: 49.009747, lon: 2.547819,
    arreteDate: '2007-04-03', index: 'lden', distanceKm: 39.4,
    documentUrl: 'http://piece-jointe-carto.developpement-durable.gouv.fr/NAT003/PEB/PEB_LFPG_03_04_2007.pdf',
  },
});
/** Roissy's plan de gêne sonore, on the sibling schema. */
const PGS_POINT = { lat: 49.00920, lon: 2.54790 };
const PGS = {
  ...projectBruit({
    peb: EMPTY_PGS, pgs: read('bruit-pgs-lfpg-sample.json'), point: PGS_POINT,
  }),
  register: { count: 224, total: 224, short: false },
};

const answers = (payload) => ({
  peb: chooseBruitAnswer(payload.peb, 'peb'),
  pgs: chooseBruitAnswer(payload.pgs, 'pgs'),
});

test('the layer object is the one the registry, the taxonomy and the proxy agree on', () => {
  assert.equal(bruitFranceLayer.id, BRUIT_FR_LAYER_ID);
  assert.equal(BRUIT_FR_LAYER_ID, 'bruit-fr');
  assert.match(bruitFranceLayer.id, /^[a-z0-9-]+$/);
  assert.equal(BRUIT_FR_ENDPOINT, '/api/bruit-fr');
  assert.equal(typeof bruitFranceLayer.name, 'string');
  assert.equal(bruitFranceLayer.icon, '🔊');
  assert.ok(bruitFranceLayer.source.includes('DGAC'));
  for (const method of ['init', 'enable', 'disable', 'update', 'destroy', 'getStats', 'getRowControls']) {
    assert.equal(typeof bruitFranceLayer[method], 'function', `${method} must survive the wrap`);
  }
  assert.equal(bruitFranceLayer.updateInterval, 900_000);
});

test('the most exposed zone wins, and the card names the clause that decided it', () => {
  // Saint-Cyr publishes zone A and zone B over the same ground with no hole
  // between them. A/B is not a tie to break: the PEB's restrictions are
  // cumulative-strictest, so it is zone A that forbids housing there, and
  // answering "zone B" because it came back first understates the rule.
  const peb = chooseBruitAnswer(LFPZ.peb, 'peb');
  assert.equal(peb.eligible, 2);
  assert.equal(peb.winner.zone, 'A');
  assert.equal(peb.rule, 'zone');
  assert.equal(peb.ruleLabel, BRUIT_WINNER_RULES.zone);
  assert.equal(peb.overlapping, true, 'one airport, two zones over one point');
  assert.equal(peb.inside.length, 1);
  assert.equal(peb.inside[0].zone, 'B');
  // The order the service happened to return them in is B, A, B, A.
  assert.deepEqual(read('bruit-peb-lfpz-sample.json').features.map((f) => f.properties.zone),
    ['B', 'A', 'B', 'A']);
});

test('the runner-up stays on the card, so a reader can see what was not chosen', () => {
  const { peb, pgs } = answers(LFPZ);
  const card = norm(bruitScanDescription(LFPZ, peb, pgs));
  assert.ok(card.includes('2 zones sous le repère'), card);
  assert.ok(card.includes(BRUIT_WINNER_RULES.zone), card);
  assert.ok(card.includes('aussi sous le repère : zone B — indice psophique 89 – 96'), card);
  // And the register contradicting itself is stated, not smoothed over.
  assert.ok(card.includes('deux zones qui se recouvrent'), card);
});

test('two airports at one point are two facts, and the strictest of them is the headline', () => {
  const { peb, pgs } = answers(LEBOURGET);
  assert.equal(peb.eligible, 2);
  assert.equal(peb.winner.oaci, 'LFPB');
  assert.equal(peb.winner.zone, 'A');
  assert.equal(peb.rule, 'zone');
  assert.equal(peb.overlapping, false, 'two airports is not one plan overlapping itself');
  const card = norm(bruitScanDescription(LEBOURGET, peb, pgs));
  assert.ok(card.includes('deux plans se superposent ici : LFPB, LFPG'), card);
  assert.ok(card.includes('aussi sous le repère : zone D — 50 – 56 Lden dB(A)'), card);
  assert.equal(norm(bruitMarkerTitle(LEBOURGET, peb, pgs)), 'Zone A · LFPB — PARIS LE BOURGET');
});

test('a band the point is NOT in can never become the answer', () => {
  // Cannes returns zone B under the probe and zone C beside it. "The service
  // returned zone C" is not "you are in zone C", and a rule that ranked by
  // severity alone over everything returned would still be right here — so the
  // test that matters is the one where the NEARBY band is the LOUDER one.
  const peb = chooseBruitAnswer(LFMD.peb, 'peb');
  assert.equal(peb.eligible, 1);
  assert.equal(peb.winner.zone, 'B');
  assert.equal(peb.rule, 'only');
  assert.equal(peb.nearby.length, 1);
  assert.equal(peb.nearby[0].zone, 'C');
  // Flip the flags: a louder zone the point is not in must still lose.
  const flipped = LFMD.peb.map((band) => ({ ...band, atPoint: band.zone === 'C' }));
  const other = chooseBruitAnswer(flipped, 'peb');
  assert.equal(other.winner.zone, 'C');
  assert.equal(other.eligible, 1);
  assert.equal(other.nearby.length, 1, 'zone B is now the one beside the point');
});

test('a zone letter the grammar does not know ranks LAST, and is never the answer', () => {
  // The coercion trap: `PEB_ZONE_ORDER.indexOf(null)` is -1, and -1 sorts ahead
  // of zone A. An unlabelled polygon would become the answer at every airport
  // that published one.
  assert.equal(bruitZoneRank('peb', 'A'), 0);
  assert.equal(bruitZoneRank('peb', 'D'), 3);
  assert.equal(bruitZoneRank('peb', null), 4);
  assert.equal(bruitZoneRank('peb', ''), 4);
  assert.equal(bruitZoneRank('peb', undefined), 4);
  assert.equal(bruitZoneRank('peb', 0), 4, 'a number is not a zone letter');
  assert.equal(bruitZoneRank('peb', 'Z'), 4);
  assert.equal(bruitZoneRank('pgs', '1'), 0);
  assert.equal(bruitZoneRank('pgs', 3), 3, 'the PGS letters are published as STRINGS');
  const mixed = chooseBruitAnswer([
    { id: 'x', zone: null, atPoint: true, oaci: 'LFXX', effectiveDate: '2020-01-01' },
    { id: 'y', zone: 'D', atPoint: true, oaci: 'LFXX', effectiveDate: '2020-01-01' },
  ], 'peb');
  assert.equal(mixed.winner.zone, 'D');
  assert.equal(bruitZoneColorCss('peb', null), BRUIT_UNKNOWN_ZONE_COLOR);
  assert.equal(bruitZoneColorCss('peb', 'A'), PEB_ZONE_COLORS.A);
  assert.equal(bruitZoneColorCss('pgs', '1'), PGS_ZONE_COLORS[1]);
});

test('the tie-breaks below the zone letter are deterministic, in the order the card claims', () => {
  const base = { atPoint: true, zone: 'B', kind: 'peb' };
  // Same letter → the newest effective arrêté. Never observed in the register;
  // written down because the day it happens the alternative is arbitrary.
  const byDate = chooseBruitAnswer([
    { ...base, id: 'a', oaci: 'LFAA', effectiveDate: '1999-01-01' },
    { ...base, id: 'b', oaci: 'LFBB', effectiveDate: '2019-01-01' },
  ], 'peb');
  assert.equal(byDate.winner.id, 'b');
  assert.equal(byDate.rule, 'arrete');
  assert.equal(byDate.ruleLabel, BRUIT_WINNER_RULES.arrete);
  // Same letter, same date → the OACI code. Nothing about physics, everything
  // about the same ground answering the same way twice.
  const byOaci = chooseBruitAnswer([
    { ...base, id: 'b', oaci: 'LFBB', effectiveDate: '2019-01-01' },
    { ...base, id: 'a', oaci: 'LFAA', effectiveDate: '2019-01-01' },
  ], 'peb');
  assert.equal(byOaci.winner.oaci, 'LFAA');
  assert.equal(byOaci.rule, 'oaci');
  // A band with no date at all does not win on an empty string sorting low.
  const undated = chooseBruitAnswer([
    { ...base, id: 'a', oaci: 'LFAA', effectiveDate: null },
    { ...base, id: 'b', oaci: 'LFBB', effectiveDate: '1974-01-01' },
  ], 'peb');
  assert.equal(undated.winner.id, 'b');
  // Identical on every clause → the feature id, so the answer cannot depend on
  // the order GeoServer shuffled the response into.
  const identical = [
    { ...base, id: 'peb:2', oaci: 'LFAA', effectiveDate: '2019-01-01' },
    { ...base, id: 'peb:1', oaci: 'LFAA', effectiveDate: '2019-01-01' },
  ];
  assert.equal(chooseBruitAnswer(identical, 'peb').winner.id, 'peb:1');
  assert.equal(chooseBruitAnswer([...identical].reverse(), 'peb').winner.id, 'peb:1');
  assert.equal(chooseBruitAnswer(identical, 'peb').rule, 'id');
});

test('nothing to choose from is a null winner, not the first thing in the array', () => {
  for (const bands of [null, undefined, [], 'nope']) {
    const answer = chooseBruitAnswer(bands, 'peb');
    assert.equal(answer.winner, null);
    assert.equal(answer.rule, null);
    assert.equal(answer.eligible, 0);
    assert.equal(answer.overlapping, false);
  }
  // Bands exist but the point is in none of them: still no answer, and the
  // bands are kept as context.
  const beside = chooseBruitAnswer(LFMD.peb.map((band) => ({ ...band, atPoint: false })), 'peb');
  assert.equal(beside.winner, null);
  assert.equal(beside.nearby.length, 2);
});

test('an empty answer names the nearest aerodrome that HAS a plan, from its published point', () => {
  const { peb, pgs } = answers(TOUSSUS);
  assert.equal(peb.winner, null);
  assert.equal(norm(bruitMarkerTitle(TOUSSUS, peb, pgs)), 'Aucun plan de bruit aérien sur ce point');
  const card = norm(bruitScanDescription(TOUSSUS, peb, pgs));
  assert.ok(card.includes('aucun plan d’exposition au bruit ne couvre ce point'), card);
  assert.ok(card.includes('LFPG — P. CH. DE-GAULLE, à 39,4 km'), card);
  assert.ok(card.includes('arrêté du 03/04/2007'), card);
  // Out of reach is silence, not a nearest aerodrome in another region.
  assert.equal(bruitNearestSentence(null), null);
  assert.equal(bruitNearestSentence({ oaci: 'LFPG', distanceKm: null }), null);
});

test('standing ON an aerodrome that answers nothing is the most informative empty answer', () => {
  // Measured, 9 of the 224 aerodromes answer an empty FeatureCollection at
  // their own published reference point, and Toussus-le-Noble answers nothing
  // at any scale tried. "à 0 km" would spend the sentence saying nothing; the
  // arrêté exists and the polygon does not, and that is the fact.
  const here = norm(bruitNearestSentence({
    oaci: 'LFPN', name: 'TOUSSUS', arreteDate: '1985-07-03', distanceKm: 0,
  }));
  assert.ok(here.includes('le repère est sur l’aérodrome LFPN — TOUSSUS'), here);
  assert.ok(here.includes('arrêté du 03/07/1985'), here);
  assert.ok(here.includes('le service ne renvoie aucun polygone ici'), here);
  assert.ok(!here.includes('0 km'), here);
  assert.equal(BRUIT_ARRETE_UNDER_MARKER_KM, 0.5);
  // Just past the threshold it is a distance again.
  assert.ok(norm(bruitNearestSentence({
    oaci: 'LFPN', name: 'TOUSSUS', arreteDate: '1985-07-03', distanceKm: 0.6,
  })).includes('à 0,6 km'));
});

test('"the service did not answer" and "there is nothing here" are different sentences', () => {
  // Both are zero features downstream. Only `available` tells them apart, and
  // getting this wrong turns an outage into a clean bill of health.
  const down = { ...TOUSSUS, available: { peb: false, pgs: false } };
  const { peb, pgs } = answers(down);
  assert.equal(norm(bruitMarkerTitle(down, peb, pgs)), 'Plans de bruit — service sans réponse');
  const card = norm(bruitScanDescription(down, peb, pgs));
  assert.ok(card.includes('le service PEB n’a pas répondu — ce n’est pas « aucune zone ici »'), card);
  assert.ok(!card.includes('aucun plan d’exposition au bruit ne couvre ce point'), card);
  // And the healthy empty answer says the opposite.
  assert.equal(TOUSSUS.available.peb, true);
  assert.ok(norm(bruitScanDescription(TOUSSUS, ...Object.values(answers(TOUSSUS))))
    .includes('aucun plan'));
});

test('every threshold on screen carries its unit, or says it could not be settled', () => {
  // Saint-Cyr is on a 1985 arrêté: 96 is an indice psophique and NOT 96 dB.
  const { peb, pgs } = answers(LFPZ);
  const card = norm(bruitScanDescription(LFPZ, peb, pgs));
  assert.ok(card.includes('indice psophique 96'), card);
  assert.ok(!/96 dB/.test(card), card);
  assert.ok(card.includes('ce n’est pas un niveau en dB'), card);
  // Gap is the opposite case: a 1985 register row on a 2017 document is Lden.
  const gap = answers(LFNA);
  const gapCard = norm(bruitScanDescription(LFNA, gap.peb, gap.pgs));
  assert.ok(gapCard.includes('70 Lden dB(A)'), gapCard);
  assert.ok(gapCard.includes('arrêté du 11/04/2017'), gapCard);
  assert.ok(gapCard.includes('date reprise du document'), gapCard);
  // A band whose index could not be settled prints no unit at all.
  const unsettled = bruitBandLabel({
    kind: 'peb', zone: 'C', low: 84, high: 96, index: 'unknown',
  });
  assert.equal(norm(unsettled), 'zone C — seuils 84 – 96 — indice non déterminé');
  assert.ok(!/dB/.test(unsettled));
});

test('the band card repeats the register\'s own contradictions rather than tidying them', () => {
  const answer = chooseBruitAnswer(LFMD.peb, 'peb');
  const zoneB = norm(bruitBandDescription(answer.winner, answer));
  assert.ok(zoneB.includes('65 – 70 Lden dB(A)'), zoneB);
  assert.ok(zoneB.includes('seuils publiés à l’envers'), zoneB);
  assert.ok(zoneB.includes('LFMD — CANNES-MANDELIEU'), zoneB);
  assert.ok(zoneB.includes('producteur SSBA-SE'), zoneB);
  assert.ok(zoneB.includes('PEB_LFMD_08_02_2005.pdf'), zoneB);
  assert.ok(zoneB.includes(`retenue : ${BRUIT_WINNER_RULES.only}`), zoneB);
  // A band beside the point says so on its own card, and carries no "retenue".
  const zoneC = norm(bruitBandDescription(answer.nearby[0], answer));
  assert.ok(zoneC.includes('zone voisine — le repère n’est pas dedans'), zoneC);
  assert.ok(!zoneC.includes('retenue :'), zoneC);
  // The merged pieces of one band are stated rather than hidden.
  const merged = chooseBruitAnswer(LFPZ.peb, 'peb');
  assert.ok(norm(bruitBandDescription(merged.winner, merged)).includes('publiée en 2 polygones, fusionnés'));
});

test('a date is a French day or it is nothing, never an Invalid Date', () => {
  assert.equal(bruitDayText('2007-04-03'), '03/04/2007');
  assert.equal(bruitDayText('2007-04-03Z'), null, 'the raw register value is not a day');
  assert.equal(bruitDayText(null), null);
  assert.equal(bruitDayText(''), null);
  assert.equal(bruitDayText('hier'), null);
});

test('the wash, the holes and a stroke on every ring — the louder zone begins at a hole', () => {
  const answer = chooseBruitAnswer(LEBOURGET.peb, 'peb');
  const zoneD = answer.inside[0];
  assert.equal(zoneD.zone, 'D');
  const source = new Cesium.CustomDataSource('bruit-test');
  const drawn = drawBruitParts(source, 'bruit:peb:567', zoneD.parts, {
    css: PEB_ZONE_COLORS.D,
    fillAlpha: BRUIT_FILL_ALPHA.inside,
    width: BRUIT_OUTLINE_WIDTH_PX.inside,
    dashed: false,
    classificationType: Cesium.ClassificationType.TERRAIN,
    name: 'zone D',
    description: 'zone D',
    properties: { kind: 'peb-zone' },
  });
  assert.equal(drawn, 1);
  const fill = source.entities.values.find((entity) => entity.polygon);
  const hierarchy = fill.polygon.hierarchy.getValue(now());
  assert.equal(hierarchy.holes.length, 1, 'the hole is where zone C begins');
  assert.ok(hierarchy.positions.length > hierarchy.holes[0].positions.length);
  assert.equal(fill.polygon.outline.getValue(now()), false, 'the stroke is its own entity');
  assert.equal(fill.polygon.classificationType.getValue(now()), Cesium.ClassificationType.TERRAIN);
  // An enclave has a boundary too, and it is the boundary that says the rule
  // changes here.
  const strokes = source.entities.values.filter((entity) => entity.polyline);
  assert.equal(strokes.length, 2);
  for (const stroke of strokes) {
    assert.equal(stroke.polyline.clampToGround.getValue(now()), true);
    const positions = stroke.polyline.positions.getValue(now());
    assert.ok(Cesium.Cartesian3.equals(positions[0], positions.at(-1)), 'the ring is closed');
  }
});

test('a wash never exceeds the ceiling the neighbouring layer measured', () => {
  // The alphas are BORROWED from `urbanismeGpu.js`'s measured ladder, not
  // re-measured here. Importing its ceiling rather than copying the number is
  // what stops the two from drifting apart.
  for (const alpha of Object.values(BRUIT_FILL_ALPHA)) {
    assert.ok(alpha > 0 && alpha <= ZONE_FILL_MAX_ALPHA, `${alpha} must sit under ${ZONE_FILL_MAX_ALPHA}`);
  }
  assert.ok(BRUIT_FILL_ALPHA.winner > BRUIT_FILL_ALPHA.inside);
  assert.ok(BRUIT_FILL_ALPHA.inside > BRUIT_FILL_ALPHA.nearby);
  const source = new Cesium.CustomDataSource('bruit-test');
  drawBruitParts(source, 'x', [[[[2, 48], [2.01, 48], [2.01, 48.01]]]], {
    css: '#ff2d55',
    fillAlpha: 0.99,
    width: 3,
    dashed: false,
    classificationType: Cesium.ClassificationType.TERRAIN,
    name: 'x',
    description: 'x',
    properties: {},
  });
  const material = source.entities.values.find((entity) => entity.polygon).polygon.material;
  assert.ok(material.color.getValue(now()).alpha <= ZONE_FILL_MAX_ALPHA + 1e-9,
    'the ceiling is enforced at the draw, not only at the table');
});

test('a band beside the point is dashed and thinner — two channels saying "not the answer"', () => {
  const { dataSource } = _drawBruitForTest(LFMD, LFMD_POINT);
  const strokes = dataSource.entities.values.filter((entity) => entity.polyline);
  const dashed = strokes.filter((entity) => entity.polyline.material instanceof Cesium.PolylineDashMaterialProperty);
  const solid = strokes.filter((entity) => entity.polyline.material instanceof Cesium.ColorMaterialProperty);
  assert.ok(dashed.length > 0, 'zone C is beside the probe and is dashed');
  assert.ok(solid.length > 0, 'zone B is under it and is solid');
  for (const entity of dashed) {
    assert.equal(entity.polyline.width.getValue(now()), BRUIT_OUTLINE_WIDTH_PX.nearby);
    assert.equal(entity.properties.getValue(now()).emphasis, 'nearby');
  }
  for (const entity of solid) {
    assert.equal(entity.polyline.width.getValue(now()), BRUIT_OUTLINE_WIDTH_PX.inside);
  }
  assert.equal(bruitEmphasis({ atPoint: true, id: 'a' }, { id: 'a' }), 'winner');
  assert.equal(bruitEmphasis({ atPoint: true, id: 'b' }, { id: 'a' }), 'inside');
  assert.equal(bruitEmphasis({ atPoint: false, id: 'a' }, { id: 'a' }), 'nearby');
  // A band with no flag at all is context, not an answer: `undefined` must not
  // read as "probably inside".
  assert.equal(bruitEmphasis({ id: 'a' }, null), 'nearby');
});

test('the loudest zone is painted LAST, because two classification washes blend', () => {
  // Saint-Cyr's zone B has no hole where zone A sits, so the two washes overlap
  // on real ground. Draw order is the only lever a ground primitive gives.
  const order = bruitDrawOrder(LFPZ.peb, 'peb').map((band) => band.zone);
  assert.deepEqual(order, ['B', 'A']);
  // Context under answers, then quietest to loudest.
  const mixed = bruitDrawOrder([
    { zone: 'A', atPoint: true }, { zone: 'C', atPoint: false }, { zone: 'D', atPoint: true },
  ], 'peb').map((band) => `${band.zone}${band.atPoint ? '*' : ''}`);
  assert.deepEqual(mixed, ['C', 'D*', 'A*']);
});

test('a marker is planted even when there is nothing to draw, because the empty answer IS one', () => {
  const { dataSource, drawn } = _drawBruitForTest(TOUSSUS, TOUSSUS_POINT);
  assert.equal(drawn, 1, 'no zones, one marker');
  const marker = dataSource.entities.getById('bruit:scan-point');
  assert.ok(marker, 'the sentence needs something to hang on');
  assert.equal(marker.properties.getValue(now()).kind, 'bruit-scan-point');
  assert.ok(marker.billboard.image.getValue(now()).startsWith('data:image/svg+xml;base64,'));
  assert.ok(norm(marker.description.getValue(now())).includes('à 39,4 km'));
  // The marker takes the unknown-zone colour rather than a zone's, because
  // there is no zone.
  const colour = marker.billboard.color.getValue(now());
  assert.ok(Cesium.Color.fromCssColorString(BRUIT_UNKNOWN_ZONE_COLOR).equals(colour));
});

test('the marker takes the WINNER\'s colour, and its card is the winner\'s card', () => {
  const { dataSource } = _drawBruitForTest(LFPZ, LFPZ_POINT);
  const marker = dataSource.entities.getById('bruit:scan-point');
  assert.ok(Cesium.Color.fromCssColorString(PEB_ZONE_COLORS.A)
    .equals(marker.billboard.color.getValue(now())));
  assert.equal(norm(marker.name), 'Zone A · LFPZ — SAINT CYR L\'ECOLE');
  // Every band drew a fill, a stroke per ring and a label, and each label
  // opens the SAME card as its own outline.
  const labels = dataSource.entities.values.filter((entity) => entity.label);
  assert.deepEqual(labels.map((entity) => entity.label.text.getValue(now())).sort(), ['A', 'B']);
  for (const label of labels) {
    const ring = dataSource.entities.values.find((entity) => entity.polyline
      && entity.name === label.name);
    assert.ok(ring, 'the label and the outline are the same band');
    assert.equal(norm(ring.description.getValue(now())), norm(label.description.getValue(now())));
  }
});

test('a band too narrow to hold four characters is drawn and left unlabelled', () => {
  // Measured over all 293 bands the register returned, the narrowest anchor is
  // 0.000451°, so this gate has never fired on real data. It is a guard against
  // a register that is not a promise, and it must not silently drop the SHAPE.
  const narrow = {
    ...LFPZ,
    peb: LFPZ.peb.map((band) => ({
      ...band, anchor: { ...band.anchor, widthDeg: BRUIT_LABEL_MIN_WIDTH_DEG / 10 },
    })),
  };
  const { dataSource } = _drawBruitForTest(narrow, LFPZ_POINT);
  assert.equal(dataSource.entities.values.filter((entity) => entity.label).length, 0);
  assert.ok(dataSource.entities.values.filter((entity) => entity.polygon).length > 0,
    'the wash is still drawn');
  // A band with no anchor at all is not a crash.
  const anchorless = { ...LFPZ, peb: LFPZ.peb.map((band) => ({ ...band, anchor: null })) };
  assert.equal(_drawBruitForTest(anchorless, LFPZ_POINT).dataSource.entities.values
    .filter((entity) => entity.label).length, 0);
});

test('the PGS is drawn in its own colours and named as its own document', () => {
  const { peb, pgs } = answers(PGS);
  assert.equal(peb.winner, null, 'Roissy answers no PEB at this exact point');
  assert.equal(pgs.winner.zone, '3');
  assert.equal(norm(bruitBandLabel(pgs.winner)), 'PGS zone 3 — 55 – 65 Lden dB(A)');
  const card = norm(bruitScanDescription(PGS, peb, pgs));
  assert.ok(card.includes('plan de gêne sonore : PGS zone 3'), card);
  assert.ok(card.includes('aide à l’insonorisation'), card);
  // No colour in common with the PEB ramp: the two plans are not two grades of
  // one thing.
  const shared = Object.values(PGS_ZONE_COLORS).filter((c) => Object.values(PEB_ZONE_COLORS).includes(c));
  assert.deepEqual(shared, []);
  const { dataSource } = _drawBruitForTest(PGS, PGS_POINT);
  const marker = dataSource.entities.getById('bruit:scan-point');
  assert.ok(Cesium.Color.fromCssColorString(PGS_ZONE_COLORS[3])
    .equals(marker.billboard.color.getValue(now())));
});

test('what is NOT in this layer is stated on every card, not left to be inferred', () => {
  for (const [payload, point] of [[LFPZ, LFPZ_POINT], [TOUSSUS, TOUSSUS_POINT], [LFMD, LFMD_POINT]]) {
    const { dataSource } = _drawBruitForTest(payload, point);
    const card = norm(dataSource.entities.getById('bruit:scan-point').description.getValue(now()));
    // Aircraft only. The EU strategic noise map — road, rail, industry — is not
    // on the Géoplateforme at all, and quiet ground beside a motorway must not
    // be inferred from its absence here.
    assert.ok(card.includes('avions seulement'), card);
    assert.ok(card.includes('carte de bruit stratégique n’est pas publiée ici'), card);
    // And the outline is a generalisation, not a survey.
    assert.ok(card.includes('contours généralisés au 1:39 757'), card);
    assert.ok(card.includes('ce n’est pas un relevé'), card);
  }
});

test('an incomplete arrêté register is reported, because "the nearest" would be wrong', () => {
  const short = { ...TOUSSUS, register: { count: 12, total: 12, short: true, truncated: false } };
  const { peb, pgs } = answers(short);
  const card = norm(bruitScanDescription(short, peb, pgs));
  assert.ok(card.includes('registre des arrêtés incomplet'), card);
  const healthy = norm(bruitScanDescription(TOUSSUS, peb, pgs));
  assert.ok(!healthy.includes('registre des arrêtés incomplet'), healthy);
});

test('the row legend counts what is on screen, and separates under from beside', () => {
  const legend = bruitLegend(LFMD);
  assert.equal(legend.length, 2);
  assert.deepEqual(legend.map((row) => row.label), ['PEB zone B', 'PEB zone C']);
  assert.deepEqual(legend.map((row) => row.count), [1, 1]);
  assert.equal(legend[0].color, PEB_ZONE_COLORS.B);
  assert.ok(legend[0].blurb.includes('gêne forte'));
  assert.ok(norm(legend[1].blurb).includes('renvoyée par le service à côté du repère'), legend[1].blurb);
  // A zone the register did not publish at this point is not in the legend.
  assert.equal(legend.some((row) => row.label === 'PEB zone A'), false);
  // A zone letter the grammar does not know still gets a row rather than
  // vanishing from a count the reader is comparing against the map.
  const odd = bruitLegend({ peb: [{ zone: 'Z', atPoint: true }], pgs: [] });
  assert.equal(odd.length, 1);
  assert.equal(odd[0].color, BRUIT_UNKNOWN_ZONE_COLOR);
  assert.ok(odd[0].blurb.includes('jamais retenue'));
  assert.deepEqual(bruitLegend(null), []);
});

test('the row controls are empty while the layer is dormant, and full once it has scanned', () => {
  _setBruitStateForTest(LFPZ);
  // The shell has never been enabled here, so `dormant` is false and the last
  // drawn payload is what the row describes.
  const controls = _bruitRowControlsForTest();
  assert.deepEqual(controls.chips, [], 'a chip in this manager is a BUTTON');
  assert.deepEqual(controls.legend.map((row) => row.label), ['PEB zone A', 'PEB zone B']);
  _setBruitStateForTest(null);
  assert.deepEqual(_bruitRowControlsForTest().legend, []);
});

test('the zoom prompt is GUIDANCE, and never an error', () => {
  // `zoom-in` and `empty` are guidance statuses in the manager: they paint a
  // green ON chip. Putting the prompt in `stats.error` instead would report a
  // working layer as broken every time the camera is above its ceiling, which
  // is most of the time on a globe.
  assert.equal(bruitStatus({ dormant: true }), 'zoom-in');
  assert.equal(bruitStatus({ dormant: false, lastUpdate: 1, zonesHere: 2 }), 'ok');
  assert.equal(bruitStatus({ dormant: false, lastUpdate: 1, zonesHere: 0 }), 'empty');
  assert.equal(bruitStatus({ dormant: false, lastUpdate: null }), 'idle');
  assert.equal(bruitStatus({ dormant: false, lastUpdate: 1, available: { peb: false } }), 'unavailable');
  assert.equal(bruitStatus(null), 'idle');
  // The ceiling the prompt names is the OVERVIEW one: below it the layer is
  // never dormant, it has switched question. Naming 12 km here would tell a
  // reader at 40 km to descend while their answer is already on screen.
  const dormant = norm(bruitGuidanceLabel({ dormant: true }));
  assert.ok(dormant.includes('250 km'), dormant);
  assert.equal(ADDRESS_SCAN_CEILING_M, 12_000);
  assert.equal(BRUIT_OVERVIEW_CEILING_M, 250_000);
  assert.ok(norm(bruitGuidanceLabel({ lastUpdate: 1, zonesHere: 0, nearestKm: 39.4 }))
    .includes('le plus proche est à 39,4 km'));
  assert.equal(bruitGuidanceLabel({ lastUpdate: 1, zonesHere: 1 }), null);
});

test('getStats separates "one zone underfoot" from "four zones on screen"', () => {
  const stats = summarizeBruit(LFMD);
  assert.equal(stats.zonesHere, 1, 'the point is in one zone');
  assert.equal(stats.zonesDrawn, 2, 'two are on screen');
  assert.equal(stats.nearbyCount, 1);
  assert.equal(stats.winnerZone, 'B');
  assert.equal(stats.winnerRule, 'only');
  assert.equal(stats.winnerOaci, 'LFMD');
  assert.equal(norm(stats.winnerBand), '65 – 70 Lden dB(A)');
  assert.equal(stats.index, 'lden');
  assert.equal(stats.airportsHere, 1);
  assert.equal(stats.scaleDenominator, 39_757);
  const bourget = summarizeBruit(LEBOURGET);
  assert.equal(bourget.zonesHere, 2);
  assert.equal(bourget.airportsHere, 2);
  assert.equal(bourget.winnerRule, 'zone');
  assert.equal(bourget.overlapping, false);
  assert.equal(summarizeBruit(LFPZ).overlapping, true);
  // An empty scan is zeros and nulls, never a fabricated band.
  const empty = summarizeBruit(TOUSSUS);
  assert.equal(empty.zonesHere, 0);
  assert.equal(empty.winnerZone, null);
  assert.equal(empty.winnerBand, null);
  assert.equal(empty.nearestKm, 39.4);
  assert.equal(empty.nearestOaci, 'LFPG');
});

test('the marker glyph is tint-safe line art with no hue of its own', () => {
  const uri = bruitMarkerGlyph();
  assert.ok(uri.startsWith('data:image/svg+xml;base64,'));
  const svg = Buffer.from(uri.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8');
  // White over a dark halo: Cesium multiplies `billboard.color` into the
  // texture, so white takes the zone colour exactly and black survives the
  // multiply and keeps the glyph readable over a pale orthophoto. A hue baked
  // into the artwork would fight the tint.
  assert.ok(svg.includes('stroke="#ffffff"'));
  assert.ok(svg.includes('rgba(0,0,0,0.62)'));
  assert.equal(/#(?!ffffff)[0-9a-f]{6}/i.test(svg), false, 'no colour of its own');
  assert.equal(bruitMarkerGlyph(), uri, 'cached, not rebuilt per frame');
  assert.notEqual(bruitMarkerGlyph(44), uri);
});

// ── THE OVERVIEW, ON SCREEN ─────────────────────────────────────────────────
// The defect this half of the layer exists to fix: a PEB's bands are nested
// rings, a point probe returns the one the pixel is in, and the ceiling above
// which the layer cleared itself was 12 km — under a fifth of the width of the
// widest plan in France. The zone could not be on screen whole at any altitude
// the layer would answer at. Everything below pins that the wider answer does
// not smuggle the point-mode vocabulary along with it: no winner, no
// runner-up, no dashes and no sentence about a marker that is not there.

const AREA = {
  ...projectBruitArea({
    peb: [read('bruit-peb-area-cdg-sample.json'), read('bruit-peb-area-lebourget-sample.json')],
    pgs: [read('bruit-pgs-area-cdg-sample.json')],
    probed: [
      { oaci: 'LFPG', name: 'PARIS CHARLES DE GAULLE', lat: 49.0097, lon: 2.5479 },
      { oaci: 'LFPB', name: 'PARIS LE BOURGET', lat: 48.9694, lon: 2.4414 },
    ],
    centre: { lat: 48.99, lon: 2.5 },
    radiusKm: 50,
    candidates: 9,
  }),
  dropped: 0,
  register: { count: 224, total: 224, short: false, truncated: false },
};

test('the mode is chosen by altitude, and the ladder it asks on is coarse on purpose', () => {
  // Below the point ceiling: no `km`, so the proxy answers about the coordinate
  // and everything the rest of this file tests is unchanged.
  assert.deepEqual(bruitScanParams({ altitudeM: 300 }), {});
  assert.deepEqual(bruitScanParams({ altitudeM: ADDRESS_SCAN_CEILING_M }), {});
  assert.deepEqual(bruitScanParams({}), {}, 'no altitude is not an overview');
  // Above it: the radius rides in the query, which is what makes the shared
  // shell rescan as the camera crosses the boundary — it compares the QUERY,
  // not just the centre.
  assert.deepEqual(bruitScanParams({ altitudeM: 12_001 }), { km: '25' });
  assert.deepEqual(bruitScanParams({ altitudeM: 100_000 }), { km: '75' });
  assert.deepEqual(bruitScanParams({ altitudeM: BRUIT_OVERVIEW_CEILING_M }), { km: '175' });
  // A 25 km ladder, because the radius is part of the proxy's cache key: a
  // continuously varying one mints a fresh entry on every turn of the wheel.
  assert.equal(bruitAreaRadiusKm(40_000), 50);
  assert.equal(bruitAreaRadiusKm(41_000), 50);
  assert.equal(bruitAreaRadiusKm(0), 25, 'the floor is one rung, never zero');
  const ladder = [10, 50, 100, 150, 200, 250].map((km) => bruitAreaRadiusKm(km * 1000));
  assert.deepEqual([...new Set(ladder.map((km) => km % 25))], [0]);
});

test('an overview draws every band of every aerodrome, and not one of them dashed', () => {
  const { dataSource } = _drawBruitForTest(AREA, null);
  const values = dataSource.entities.values;
  const lines = values.filter((entity) => entity.polyline);
  assert.ok(lines.length > 0);
  // THE DASH IS THE POINT-MODE CHANNEL for "the service found this near your
  // pixel, you are not standing in it". There is no pixel, so a dashed ring
  // would be an answer to a question nobody asked.
  for (const line of lines) {
    assert.ok(line.polyline.material instanceof Cesium.ColorMaterialProperty, 'never dashed');
    assert.equal(line.polyline.width.getValue(now()), BRUIT_OUTLINE_WIDTH_PX.inside);
  }
  // Four bands each at two aerodromes, plus Roissy's three PGS zones.
  const fills = values.filter((entity) => entity.polygon);
  assert.ok(fills.length >= 11, `${fills.length} washes drawn`);
  // One marker per aerodrome, named by the register and carrying the whole
  // plan on its card — the overview's equivalent of the scan point.
  const markers = values.filter((entity) => entity.billboard);
  assert.deepEqual(markers.map((entity) => entity.name).sort(), [
    'LFPB — PARIS LE BOURGET', 'LFPG — PARIS CHARLES DE GAULLE',
  ]);
  assert.equal(values.some((entity) => entity.id === 'bruit:scan-point'), false,
    'no scan point: there is no point');
  // The most exposed band of each aerodrome carries the strongest wash — the
  // one distinction the document itself makes, and not a verdict about ground.
  const cdg = AREA.aerodromes.find((entry) => entry.oaci === 'LFPG');
  assert.equal(bruitAreaEmphasis(cdg.top, cdg), 'winner');
  assert.equal(bruitAreaEmphasis(cdg.bands[3], cdg), 'inside');
  assert.deepEqual([...new Set(AREA.peb.map((band) => bruitEmphasis(band, null)))], ['nearby'],
    'point-mode emphasis would call every overview band context — hence the second function');
});

test('nothing in an overview card mentions a marker, and the scale it names is its own', () => {
  const cdg = AREA.aerodromes.find((entry) => entry.oaci === 'LFPG');
  const band = norm(bruitBandDescription(cdg.bands[1], null, { area: true }));
  assert.equal(/le repère/.test(band), false, band);
  assert.equal(/retenue/.test(band), false);
  // The point-mode call on the very same band still says it, because there the
  // sentence is true.
  assert.ok(/le repère n’est pas dedans/.test(norm(bruitBandDescription(cdg.bands[1]))));
  const card = norm(bruitAerodromeDescription(cdg, AREA));
  assert.ok(card.includes('4 zones publiées'), card);
  assert.ok(card.includes('zone A'), card);
  assert.ok(card.split(' · ').length <= 6, 'the shell paints six lines and no more');
  assert.ok(card.includes('Lden'), card);
  // A HUNDRED TIMES COARSER THAN A POINT SCAN, and the card prints the number
  // the payload carries rather than the module constant — the two modes must
  // never be able to claim each other's precision.
  assert.ok(card.includes('1:3 975 696'), card);
  assert.equal(card.includes('1:39 757'), false, 'never the point probe’s denominator');
  assert.ok(card.includes('avions seulement'), 'the road-and-rail caveat is on every card');
  // And the sentence that sends a reader who needs a verdict back down.
  assert.ok(card.includes('descendez sous 12 km'), card);
  assert.equal(bruitAerodromeTitle({ oaci: null, name: null }), 'Aérodrome sans code');
});

test('an overview that is capped, silent or empty says which, on the row and on a card', () => {
  const capped = { ...AREA, dropped: 3 };
  assert.ok(norm(bruitAreaSummary(capped)).includes('3 aérodromes de plus dans le cadre'));
  // `lastUpdate` comes from the shell, which merges its own state over
  // `summarizeBruit`'s; without it the row is still `idle` and says nothing.
  assert.ok(norm(bruitGuidanceLabel({ ...summarizeBruit(capped), lastUpdate: 1 }))
    .includes('3 de plus dans le cadre'));
  // Silent is not empty: four aerodromes asked and none answering leaves holes
  // that look exactly like ground with no plan on it.
  const degraded = { ...AREA, missing: 4, available: { peb: false, pgs: false } };
  assert.equal(bruitStatus({ ...summarizeBruit(degraded), lastUpdate: 1 }), 'unavailable');
  assert.ok(norm(bruitGuidanceLabel({ ...summarizeBruit(degraded), lastUpdate: 1 }))
    .includes('4 aérodromes — la vue est incomplète'));
  // Empty, with nothing to click: the nearest-aerodrome sentence still needs
  // somewhere to live, so the centre of the view carries it.
  const empty = {
    ...projectBruitArea({
      peb: [], pgs: [], probed: [], centre: { lat: 47, lon: 3 }, radiusKm: 100,
      nearest: {
        oaci: 'LFLN', name: 'SAINT-YAN', lat: 46.41, lon: 4.01,
        arreteDate: '1998-06-15', index: 'psophique', distanceKm: 84.2,
      },
    }),
    dropped: 0,
  };
  const { dataSource, drawn } = _drawBruitForTest(empty, null);
  assert.equal(drawn, 1);
  const [marker] = dataSource.entities.values;
  assert.equal(marker.id, 'bruit:area-centre');
  assert.ok(norm(marker.description.getValue(now())).includes('à 84,2 km'));
  assert.equal(bruitStatus({ ...summarizeBruit(empty), lastUpdate: 1 }), 'empty');
  assert.ok(norm(bruitGuidanceLabel({ ...summarizeBruit(empty), lastUpdate: 1 }))
    .includes('le plus proche est à 84,2 km'));
});

test('the overview legend explains colours, and never dashes that are not drawn', () => {
  const legend = bruitLegend(AREA);
  const labels = legend.map((row) => row.label);
  assert.deepEqual(labels, [
    'PEB zone A', 'PEB zone B', 'PEB zone C', 'PEB zone D',
    'PGS zone 1', 'PGS zone 2', 'PGS zone 3',
  ]);
  // `atPoint` is false on every overview band. The point-mode blurb would read
  // that as "returned beside the marker" and explain dashes nobody can see.
  for (const row of legend) {
    assert.equal(/en tirets/.test(row.blurb), false, row.blurb);
    assert.ok(row.blurb.length > 0);
  }
  assert.equal(legend[0].count, 2, 'two aerodromes publish a zone A here');
  // The point-mode legend still explains its dashes, on the same function.
  assert.ok(bruitLegend(LFMD).some((row) => /en tirets/.test(row.blurb)));
});

test('getStats in an overview counts aerodromes, not bands under a marker', () => {
  const stats = summarizeBruit(AREA);
  assert.equal(stats.area, true);
  assert.equal(stats.aerodromes, 2);
  assert.equal(stats.zonesDrawn, 11, 'eight PEB bands and three PGS zones');
  // `zonesHere` is the count of bands the marker is inside, and there is no
  // marker — so it is zero, and `bruitStatus` must not read it here or every
  // dezoomed view would report itself as empty with a dozen plans on screen.
  assert.equal(stats.zonesHere, 0);
  assert.equal(bruitStatus({ ...stats, lastUpdate: 1 }), 'ok');
  assert.equal(stats.scaleDenominator, BRUIT_AREA_SCALE_DENOMINATOR);
  assert.equal(stats.radiusKm, 50);
});

test('the INSIDE of a band answers a click, and an enclave answers that it does not', () => {
  // THE DEFECT: the wash is a ground-classification polygon, a polygon entity
  // carries no `position`, and the shell builds its click index from positions
  // — so every pixel inside a band was inert while its outline was clickable.
  // Measured in the running app at 60 km over Roissy, a pick on the aerodrome
  // marker's own pixel returns `bruit:peb:566:fill:0` and the marker is only
  // SECOND in the drill list.
  const inside = bruitGroundCard({ ...LFPZ_POINT, payload: LFPZ });
  assert.ok(inside, 'a point inside a drawn band answers');
  // The strictest band containing the click leads, on the same ranking the
  // marker uses — at Saint-Cyr the point is in both A and B.
  assert.ok(inside.title.startsWith('Zone A'), inside.title);
  assert.ok(inside.details.some((line) => /aussi sur ce point/.test(line)));
  assert.ok(inside.details.some((line) => /avions seulement/.test(line)));

  // A click on ground no band covers declines, which the shell reads as "not
  // mine" and turns into a dismissal — never a card saying nothing.
  assert.equal(bruitGroundCard({ lon: 0, lat: 0, payload: LFPZ }), null);
  assert.equal(bruitGroundCard({ lon: 2, lat: 48, payload: null }), null);
  assert.equal(bruitGroundCard({ lon: Number.NaN, lat: 48, payload: LFPZ }), null);

  // THE ANSWER IS RE-DERIVED, NOT LOOKED UP. `atPoint` describes the coordinate
  // the SCAN was aimed at; a click lands somewhere else. At Cannes the scan
  // point is in zone B and zone C was returned beside it — a click inside that
  // zone C must answer zone C, not "the scan's winner".
  const cannesC = LFMD.peb.find((band) => band.zone === 'C' && band.atPoint === false);
  assert.ok(cannesC, 'the fixture has a band the scan point is NOT in');
  const anchor = cannesC.anchor;
  const onC = bruitGroundCard({ lon: anchor.lon, lat: anchor.lat, payload: LFMD });
  assert.ok(onC.title.startsWith('Zone C'), onC.title);
});

test('an overview ground card says it was read off a generalised outline', () => {
  const cdg = AREA.aerodromes.find((entry) => entry.oaci === 'LFPG');
  const anchor = cdg.bands.find((band) => band.zone === 'C').anchor;
  const card = bruitGroundCard({ lon: anchor.lon, lat: anchor.lat, payload: AREA });
  assert.ok(card.title.includes('LFPG'), card.title);
  // A hundred metres of boundary is well under one vertex at 1:3,975,696, so
  // near an edge this answer is a guess — and it says so rather than letting a
  // coloured pixel pass for a legal limit.
  assert.ok(card.details.some((line) => /descendez sous 12 km/.test(line)), JSON.stringify(card.details));
  assert.ok(card.details.some((line) => line.includes('1:3 975 696'.replace(/ /g, ' '))
    || /1:3\s?975\s?696/.test(line)));
  // The point-mode card says no such thing: its outline is a hundred times
  // finer and the sentence would be noise.
  const point = bruitGroundCard({ ...LFPZ_POINT, payload: LFPZ });
  assert.equal(point.details.some((line) => /descendez sous 12 km/.test(line)), false);
});

test('a card is six lines, so the caveat is placed rather than pushed', () => {
  // `createAddressScanOverlayEntry` slices details to six. A card built by
  // pushing every true sentence does not say more — it drops its tail, and the
  // tail of a description like this one is its caveats. Measured on the
  // aerodrome card at Roissy before this was fixed, the two lines that fell off
  // the bottom were "avions seulement" and the generalisation scale.
  assert.equal(BRUIT_CARD_MAX_LINES, 6);
  const overflowing = bruitCardDetails(
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], { area: true, scaleDenominator: 3_975_696 },
  );
  assert.equal(overflowing.length, BRUIT_CARD_MAX_LINES);
  assert.deepEqual(overflowing.slice(0, 5), ['a', 'b', 'c', 'd', 'e']);
  assert.ok(norm(overflowing[5]).includes('avions seulement'));
  assert.ok(norm(overflowing[5]).includes('1:3 975 696'));
  // Nulls cost nothing, and a short card is still capped by its own content.
  assert.deepEqual(bruitCardDetails([null, 'a', undefined, ''], { scaleDenominator: 39_757 }).length, 2);

  // Both cards this layer added stay inside the budget on real data, and both
  // keep the caveat.
  const cdg = AREA.aerodromes.find((entry) => entry.oaci === 'LFPG');
  // Split the way the SHELL splits it — `cardFromEntity` cuts a description on
  // ' · ' — so the count here is the count of lines that reach the screen. This
  // is why the band list inside line one is joined with a semicolon: joined on
  // ' · ' it would arrive as four lines and take the whole budget.
  const aerodrome = bruitAerodromeDescription(cdg, AREA).split(' · ');
  assert.ok(aerodrome.length <= BRUIT_CARD_MAX_LINES,
    `the aerodrome card is ${aerodrome.length} lines: ${JSON.stringify(aerodrome)}`);
  assert.ok(aerodrome[0].includes('4 zones publiées'), aerodrome[0]);
  assert.ok(aerodrome[0].includes('zone D'), 'all four bands are on ONE line');
  assert.ok(norm(aerodrome[aerodrome.length - 1]).includes('avions seulement'));
  const anchor = cdg.bands.find((band) => band.zone === 'C').anchor;
  const ground = bruitGroundCard({ lon: anchor.lon, lat: anchor.lat, payload: AREA });
  assert.ok(ground.details.length <= BRUIT_CARD_MAX_LINES, `${ground.details.length} lines`);
  assert.ok(norm(ground.details[ground.details.length - 1]).includes('avions seulement'));
});
