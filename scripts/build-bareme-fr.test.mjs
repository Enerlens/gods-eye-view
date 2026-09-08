// scripts/build-bareme-fr.test.mjs
// Le tirage et les quantiles du barème national.
//
// Ce script écrit des constantes dans une source, et une constante fausse ne
// plante rien : elle donne une lettre plausible à tout le monde. Les quatre
// fonctions qui décident du chiffre sont donc testées ici, sur des cas où la
// bonne réponse est connue à la main.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32, roundTo, sampleQuantiles, systematicPps, weightedPick,
} from './build-bareme-fr.mjs';

test('le tirage est reproductible d’une exécution à l’autre', () => {
  const a = Array.from({ length: 5 }, mulberry32(42));
  const b = Array.from({ length: 5 }, mulberry32(42));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, Array.from({ length: 5 }, mulberry32(43)));
  for (const value of a) assert.ok(value >= 0 && value < 1);
});

test('le tirage systématique rend exactement le nombre demandé', () => {
  const units = Array.from({ length: 500 }, () => ({ weight: 10 }));
  for (const seed of [1, 7, 99]) {
    assert.equal(systematicPps(units, 25, mulberry32(seed)).length, 25);
  }
});

test('le tirage est proportionnel à la population, pas au nombre de carreaux', () => {
  // Un carreau de 9 000 habitants et neuf de 1 000 : la moitié des tirages doit
  // tomber sur le premier, parce qu'il porte la moitié des habitants.
  const units = [{ weight: 9_000 }, ...Array.from({ length: 9 }, () => ({ weight: 1_000 }))];
  const picks = systematicPps(units, 18, mulberry32(3));
  const onBig = picks.filter((index) => index === 0).length;
  assert.equal(onBig, 9, `attendu 9 tirages sur le gros carreau, reçu ${onBig}`);
});

test('un carreau plus peuplé que le pas est tiré plusieurs fois', () => {
  const units = [{ weight: 100 }, { weight: 1 }];
  const picks = systematicPps(units, 10, mulberry32(5));
  assert.ok(picks.filter((index) => index === 0).length >= 9);
});

test('le tirage refuse une population nulle plutôt que de rendre des indices', () => {
  assert.deepEqual(systematicPps([{ weight: 0 }, { weight: 0 }], 4, mulberry32(1)), []);
  assert.deepEqual(systematicPps([{ weight: 5 }], 0, mulberry32(1)), []);
});

test('weightedPick ignore les poids nuls et reste dans les bornes', () => {
  const units = [{ weight: 0 }, { weight: 0 }, { weight: 7 }];
  for (const seed of [1, 2, 3, 4, 5]) {
    assert.equal(weightedPick(units, mulberry32(seed)), 2);
  }
  assert.equal(weightedPick([], mulberry32(1)), -1);
  assert.equal(weightedPick([{ weight: 0 }], mulberry32(1)), -1);
});

test('les quantiles suivent la convention du plus proche rang', () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.deepEqual(sampleQuantiles(values, [0.05, 0.5, 0.95]), [5, 50, 95]);
  // Les valeurs non finies sortent de l'échantillon plutôt que de le décaler.
  assert.deepEqual(sampleQuantiles([1, null, 2, Number.NaN, 3], [0.5]), [2]);
  assert.deepEqual(sampleQuantiles([], [0.5]), [null]);
});

test('les quantiles ne dépendent pas de l’ordre d’arrivée', () => {
  const values = [9, 1, 7, 3, 5];
  assert.deepEqual(sampleQuantiles(values, [0.2, 0.6, 1]), [1, 5, 9]);
});

test('roundTo ne laisse pas traîner le résidu binaire', () => {
  assert.equal(roundTo(5.2999999, 0.1), 5.3);
  assert.equal(roundTo(22_437, 100), 22_400);
  assert.equal(roundTo(Number.NaN, 1), null);
});
