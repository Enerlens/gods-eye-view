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

import { projectBruit } from './bruitFeed.js';
import { ZONE_FILL_MAX_ALPHA } from './urbanismeGpu.js';
import bruitFranceLayer, {
  ADDRESS_SCAN_CEILING_M,
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
  bruitBandDescription,
  bruitBandLabel,
  bruitDayText,
  bruitDrawOrder,
  bruitEmphasis,
  bruitGuidanceLabel,
  bruitLegend,
  bruitMarkerGlyph,
  bruitMarkerTitle,
  bruitNearestSentence,
  bruitScanDescription,
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
  const dormant = norm(bruitGuidanceLabel({ dormant: true }));
  assert.ok(dormant.includes('12 km'), dormant);
  assert.equal(ADDRESS_SCAN_CEILING_M, 12_000);
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
