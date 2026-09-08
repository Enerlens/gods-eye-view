// src/data/baremeNational.test.mjs
// Le barème national : la lettre, la fourchette, et les quatre refus.
//
// Les échelles mesurées bougent à chaque campagne, donc presque rien ici ne
// s'appuie dessus : le scoring est testé sur des échelles synthétiques, et les
// vraies ne sont soumises qu'à des invariants de FORME — c'est le collage
// manuel d'un bloc mesuré que ces derniers existent pour attraper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAREME_FR,
  BAREME_GEOMETRIES,
  BAREME_INDICATORS,
  BAREME_LADDER_Q,
  BAREME_LETTER_FLOORS,
  BAREME_REASONS,
  BAREME_SAMPLE,
  ladderBracket,
  letterFor,
  percentileMarginPt,
  resolveIndicator,
  scoreIndicator,
} from './baremeNational.js';

const RING = BAREME_GEOMETRIES.RING_FOOT_600;
/** Une échelle linéaire 0→100, pour lire un centile à l'œil. */
const LINEAR = BAREME_LADDER_Q.map((q) => Math.round(q * 100));
/** Un barème synthétique, indépendant de la campagne en cours. */
const FAKE = {
  acces: { geometry: RING, ladder: LINEAR },
  pauvrete: { geometry: RING, ladder: LINEAR },
  social: { geometry: RING, ladder: LINEAR },
};
/** Assez grand pour que la marge d'échantillonnage ne noie pas les assertions. */
const BIG = 100_000;

test('letterFor coupe en quintiles et borne aux deux bouts', () => {
  assert.equal(letterFor(100), 'A');
  assert.equal(letterFor(80), 'A');
  assert.equal(letterFor(79.9), 'B');
  assert.equal(letterFor(60), 'B');
  assert.equal(letterFor(40), 'C');
  assert.equal(letterFor(20), 'D');
  assert.equal(letterFor(0), 'E');
  assert.equal(letterFor(-5), 'E');
  assert.equal(letterFor(140), 'A');
  assert.equal(letterFor(null), null);
  assert.equal(letterFor(Number.NaN), null);
});

test('les cinq lettres couvrent 0..100 sans trou ni chevauchement', () => {
  const floors = BAREME_LETTER_FLOORS.map((band) => band.floor);
  assert.deepEqual(floors, [...floors].sort((a, b) => b - a));
  assert.equal(new Set(BAREME_LETTER_FLOORS.map((b) => b.letter)).size, 5);
  assert.equal(floors.at(-1), 0);
});

test('ladderBracket interpole entre deux points et rend un point', () => {
  const bracket = ladderBracket(45, LINEAR);
  assert.equal(bracket.beyond, null);
  assert.equal(bracket.low, bracket.high);
  assert.ok(Math.abs(bracket.low - 0.45) < 1e-9);
});

test('ladderBracket rend un PALIER quand la valeur égale plusieurs points', () => {
  // Le cas du logement social : 0 % sur tout le bas de la distribution. La
  // réponse honnête est un intervalle, jamais un centile.
  const ladder = [0, 0, 0, 0, 2, 7, 14, 25, 40, 62, 78];
  const bracket = ladderBracket(0, ladder);
  assert.equal(bracket.low, 0);
  assert.equal(bracket.high, 0.4);
  assert.ok(bracket.high - bracket.low > 0.3, 'le palier doit rester large');
});

test('ladderBracket nomme le côté par lequel la valeur sort', () => {
  assert.deepEqual(ladderBracket(-10, LINEAR), { low: 0, high: 0.05, beyond: 'below' });
  assert.deepEqual(ladderBracket(1e6, LINEAR), { low: 0.95, high: 1, beyond: 'above' });
});

test('ladderBracket refuse une échelle de la mauvaise longueur ou une valeur absente', () => {
  assert.equal(ladderBracket(10, [1, 2, 3]), null);
  assert.equal(ladderBracket(Number.NaN, LINEAR), null);
  assert.equal(ladderBracket(10, null), null);
});

test('la marge d’échantillonnage est maximale au milieu et connue', () => {
  const middle = percentileMarginPt(0.5, 300);
  const tail = percentileMarginPt(0.05, 300);
  assert.ok(middle > tail);
  assert.ok(Math.abs(middle - 5.77) < 0.05, `attendu ~5,77 pt, reçu ${middle}`);
  assert.equal(percentileMarginPt(0.5, 0), 0);
});

test('une géométrie qui ne correspond pas ne donne pas de lettre', () => {
  const score = scoreIndicator('acces', 1.2, {
    geometry: BAREME_GEOMETRIES.CARREAU_200, bareme: FAKE, sampleSize: BIG,
  });
  assert.equal(score.reason, BAREME_REASONS.GEOMETRY);
  assert.equal(score.letter, null);
  assert.equal(score.percentile, null);
});

test('un appelant qui ne dit pas sur quoi il a mesuré ne reçoit pas de rang', () => {
  const score = scoreIndicator('acces', 1.2, { bareme: FAKE, sampleSize: BIG });
  assert.equal(score.reason, BAREME_REASONS.GEOMETRY);
});

test('sans échelle, sans valeur ou sans indicateur : un refus nommé, jamais une exception', () => {
  assert.equal(
    scoreIndicator('acces', 1.2, { geometry: RING, bareme: {}, sampleSize: BIG }).reason,
    BAREME_REASONS.NO_REFERENCE,
  );
  assert.equal(
    scoreIndicator('inconnu', 1.2, { geometry: RING, bareme: FAKE, sampleSize: BIG }).reason,
    BAREME_REASONS.NO_REFERENCE,
  );
  assert.equal(
    scoreIndicator('acces', null, { geometry: RING, bareme: FAKE, sampleSize: BIG }).reason,
    BAREME_REASONS.NOT_A_NUMBER,
  );
});

test('un indicateur montant garde son centile comme note', () => {
  const score = scoreIndicator('acces', 85, { geometry: RING, bareme: FAKE, sampleSize: BIG });
  assert.equal(score.percentile, 85);
  assert.equal(score.note, 85);
  assert.equal(score.letter, 'A');
  assert.equal(score.ferme, true);
});

test('un indicateur descendant retourne la NOTE, jamais le centile', () => {
  // 85 % de ménages pauvres : le centile reste 85 — 85 % des Français font
  // moins — et la note devient 15, donc E.
  const score = scoreIndicator('pauvrete', 85, { geometry: RING, bareme: FAKE, sampleSize: BIG });
  assert.equal(score.percentile, 85);
  assert.equal(score.note, 15);
  assert.equal(score.letter, 'E');
});

test('sans sens défendable : un rang, pas de lettre', () => {
  const score = scoreIndicator('social', 70, { geometry: RING, bareme: FAKE, sampleSize: BIG });
  assert.equal(score.percentile, 70);
  assert.equal(score.note, null);
  assert.equal(score.letter, null);
  assert.equal(score.letterLow, null);
  assert.equal(score.reason, BAREME_REASONS.NO_DIRECTION);
  assert.equal(resolveIndicator('social').direction, null);
});

test('une valeur assise sur une borne de lettre ne reçoit pas de lettre nue', () => {
  // 80 est exactement la frontière A/B ; sur 300 tirages la marge est de
  // ±5,7 pt, donc la fourchette enjambe la borne et la carte doit dire « A ou B ».
  const score = scoreIndicator('acces', 80, { geometry: RING, bareme: FAKE, sampleSize: 300 });
  assert.equal(score.letter, null);
  assert.equal(score.ferme, false);
  assert.deepEqual([score.letterHigh, score.letterLow], ['A', 'B']);
});

test('une valeur hors de l’échelle reste notable et dit par où elle sort', () => {
  const score = scoreIndicator('acces', 5_000, { geometry: RING, bareme: FAKE, sampleSize: BIG });
  assert.equal(score.beyond, 'above');
  assert.equal(score.letter, 'A');
  assert.equal(score.reason, null, 'sortir de l’échelle n’est pas un refus');
});

test('la table des choix est cohérente', () => {
  const ids = BAREME_INDICATORS.map((indicator) => indicator.id);
  assert.equal(new Set(ids).size, ids.length, 'identifiants dupliqués');
  const geometries = new Set(Object.values(BAREME_GEOMETRIES));
  for (const indicator of BAREME_INDICATORS) {
    assert.ok(geometries.has(indicator.geometry), `${indicator.id}: géométrie inconnue`);
    assert.ok([null, 'up', 'down'].includes(indicator.direction), `${indicator.id}: sens invalide`);
    assert.ok(indicator.round > 0, `${indicator.id}: pas d’arrondi`);
    // Le sens est un jugement ; un jugement sans justification écrite est
    // exactement ce que ce module reproche à Cityscan.
    assert.ok(indicator.directionNote?.length > 20, `${indicator.id}: sens non justifié`);
    assert.ok(indicator.label && indicator.unit, `${indicator.id}: sans étiquette`);
  }
});

test('le bloc mesuré a la forme que le module attend', () => {
  for (const [id, scale] of Object.entries(BAREME_FR)) {
    const indicator = resolveIndicator(id);
    assert.ok(indicator, `${id}: échelle sans indicateur déclaré`);
    assert.equal(scale.geometry, indicator.geometry, `${id}: géométrie collée de travers`);
    assert.equal(scale.ladder.length, BAREME_LADDER_Q.length, `${id}: échelle de mauvaise longueur`);
    // Une échelle décroissante est un collage raté, pas une distribution.
    for (let i = 1; i < scale.ladder.length; i += 1) {
      assert.ok(scale.ladder[i] >= scale.ladder[i - 1], `${id}: échelle non croissante en ${i}`);
    }
    assert.ok(scale.measured > 0, `${id}: échelle sans observations`);
  }
});

test('l’échantillon déclare sa taille, et le module s’en sert', () => {
  assert.ok(Number.isFinite(BAREME_SAMPLE.rings));
  assert.ok(BAREME_SAMPLE.rings >= 0);
});
