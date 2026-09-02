// What one viewport of the 219 432-tree register is allowed to claim.
//
// The property under test is a single one and it is the reason this module
// exists apart from the refuge feed: **`hauteurenm = 0` is the absence of a
// survey, not a seedling.** It is on 19 407 of the 219 432 trees, and every
// channel this module offers a renderer — the band, the dot size, the mean
// height, the card line — has a way of quietly turning that zero back into a
// measurement. Each test closes one of them.
//
// The second property is that a viewport is drawn WHOLE or refused whole. A
// partial tree map is indistinguishable from a street with no trees on it, so
// over budget the module returns nothing and prints the true count instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FRAICHEUR_TREE_BANDS,
  FRAICHEUR_TREE_BAND_IDS,
  FRAICHEUR_TREE_BOX_STEP_DEG,
  FRAICHEUR_TREE_BUDGET,
  FRAICHEUR_TREE_DATASET,
  FRAICHEUR_TREE_FIELDS,
  FRAICHEUR_TREE_HEIGHT_CEILING_M,
  FRAICHEUR_TREE_MAX_ALTITUDE_M,
  FRAICHEUR_TREE_MAX_BOX_DEG,
  FRAICHEUR_TREE_REQUEST_MAX_BOX_DEG,
  FRAICHEUR_TREE_STAGE_LABELS,
  fraicheurTreeBand,
  fraicheurTreeDomain,
  fraicheurTreeLabel,
  fraicheurTreeSize,
  fraicheurTreeStage,
  fraicheurTreeWhere,
  projectFraicheurTrees,
  summarizeFraicheurTrees,
  treeCardLines,
} from './fraicheurTrees.js';

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const norm = (value) => String(value).replace(/[\s ]+/g, ' ');

const TREES = read('fraicheur-arbres-sample.json');
const BOX = { south: 48.816, west: 2.346, north: 48.836, east: 2.366 };
const VIEW = projectFraicheurTrees({ features: TREES, totalInBox: 18, box: BOX });
const treeOf = (idbase) => VIEW.trees.find((tree) => tree.idbase === idbase);

test('the fixture is the captured box, and it names no geo field', () => {
  assert.equal(TREES.features.length, 18);
  assert.equal(VIEW.trees.length, 18);
  assert.equal(VIEW.unplaced, 0);
  assert.equal(VIEW.truncated, false);
  assert.equal(VIEW.dataset, FRAICHEUR_TREE_DATASET);
  // `exports/geojson` emits the geometry whether or not the field is selected,
  // and naming it ships the coordinates twice.
  assert.equal(FRAICHEUR_TREE_FIELDS.includes('geo_point_2d'), false);
  assert.equal(FRAICHEUR_TREE_FIELDS.length, 9);
  // `adresse` is left out for a measured reason, not a taste one: on the
  // 5 287-tree central box it is 57 602 B of wire, 24.9 % of the response.
  assert.equal(FRAICHEUR_TREE_FIELDS.includes('adresse'), false);
  for (const feature of TREES.features) {
    assert.equal(feature.geometry.type, 'Point');
    assert.equal(feature.properties.geo_point_2d, undefined);
  }
});

test('a published zero height becomes null and is never scaled', () => {
  // 19 407 of the 219 432 trees carry hauteurenm = 0 and 16 250 carry
  // circonferenceencm = 0. A layer that scaled a dot by height would draw
  // 19 407 seedlings where the register meant silence.
  const bothZero = treeOf(2048228);
  assert.ok(bothZero, 'the fixture must carry a tree with 0 height and 0 girth');
  assert.equal(bothZero.height, null);
  assert.equal(bothZero.girth, null);
  assert.notEqual(bothZero.height, 0);

  // 127 trees publish a girth without a height: the two zeros are separate
  // facts and must not be inferred from one another.
  const heightless = treeOf(124119);
  assert.ok(heightless);
  assert.equal(heightless.height, null);
  assert.equal(heightless.girth, 12);

  // A null height takes the minimum size, whatever the min is set to.
  assert.equal(fraicheurTreeSize(null, 3, 11), 3);
  assert.equal(fraicheurTreeSize(0, 3, 11), 3);
  assert.equal(fraicheurTreeSize(-4, 3, 11), 3);
  assert.equal(fraicheurTreeSize(undefined, 2, 8), 2);
  // Monotone in between, and flat at the ceiling: the tallest published tree is
  // 65 m and exactly two are over 40 m, so a scale topping out at the maximum
  // would spend its whole range on two dots. 25 m is the 99th percentile of the
  // 200 025 measured heights.
  assert.equal(FRAICHEUR_TREE_HEIGHT_CEILING_M, 25);
  assert.ok(fraicheurTreeSize(5) < fraicheurTreeSize(15));
  assert.ok(fraicheurTreeSize(15) < fraicheurTreeSize(25));
  assert.equal(fraicheurTreeSize(25), fraicheurTreeSize(65));
  assert.equal(fraicheurTreeSize(25, 3, 11), 11);
});

test('remarquable is three-state and the null is not a no', () => {
  // NON 205 726, null 13 523, OUI 183. The 183 are the only trees the city
  // itself singles out.
  const flagged = treeOf(155788);
  assert.equal(flagged.remarquable, true);
  assert.equal(treeOf(142523).remarquable, false);
  const unanswered = treeOf(124119);
  assert.equal(unanswered.remarquable, null);
  assert.notEqual(unanswered.remarquable, false);
  const text = norm(treeCardLines(unanswered).details.join(' | '));
  assert.match(text, /Caractère remarquable non renseigné/);
  assert.equal(/Arbre remarquable/.test(text), false);
});

test('the three bands separate a measurement from the absence of one', () => {
  assert.deepEqual([...FRAICHEUR_TREE_BAND_IDS], ['remarquable', 'mesure', 'sans-mesure']);
  assert.equal(fraicheurTreeBand({ remarquable: true, height: null }), 'remarquable');
  assert.equal(fraicheurTreeBand({ remarquable: false, height: 12 }), 'mesure');
  assert.equal(fraicheurTreeBand({ remarquable: false, height: null }), 'sans-mesure');
  assert.equal(fraicheurTreeBand({ remarquable: null, height: null }), 'sans-mesure');
  // The unmeasured band must not be a member of the measured ramp: an
  // unsurveyed tree that took the "measured" colour would be a claim nobody
  // made, on 19 407 trees.
  const measured = FRAICHEUR_TREE_BANDS.find((band) => band.id === 'mesure').color.toLowerCase();
  const unmeasured = FRAICHEUR_TREE_BANDS.find((band) => band.id === 'sans-mesure').color.toLowerCase();
  assert.notEqual(measured, unmeasured);
  const banded = VIEW.summary.bands.reduce((sum, band) => sum + band.count, 0);
  assert.equal(banded, VIEW.trees.length, 'nothing falls through unbanded');
  assert.deepEqual(VIEW.summary.bands.map((band) => [band.id, band.count]),
    [['remarquable', 1], ['mesure', 15], ['sans-mesure', 2]]);
});

test('the corrupt development stage is named as corrupt, not mapped to a state', () => {
  // "Jeune (arbre)Adulte" is two states concatenated upstream and it is on
  // 41 526 trees, 18.9 % of the register. Mapping it to either would invent a
  // fact on nearly a fifth of the data.
  const label = fraicheurTreeStage('Jeune (arbre)Adulte');
  assert.equal(label, FRAICHEUR_TREE_STAGE_LABELS['Jeune (arbre)Adulte']);
  assert.match(label, /illisible/);
  assert.notEqual(label, 'Jeune');
  assert.notEqual(label, 'Adulte');
  assert.equal(fraicheurTreeStage('Jeune (arbre)'), 'Jeune');
  assert.equal(fraicheurTreeStage('Adulte'), 'Adulte');
  assert.equal(fraicheurTreeStage('Mature'), 'Mature');
  assert.equal(fraicheurTreeStage(null), null);
  // An unmapped value is printed as published rather than guessed at.
  assert.equal(fraicheurTreeStage('Sénescent'), 'Sénescent');
  assert.equal(VIEW.summary.corruptStage, 3);
});

test('the directorate acronyms are translated and an unknown one is printed', () => {
  // Half of Paris's trees are in the street: domanialite = "Alignement" on
  // 110 157 of 219 432, 50.20 %. "DFPE" on a card is a worse answer than none.
  assert.equal(fraicheurTreeDomain('Alignement'), 'Arbre d’alignement (voirie)');
  assert.equal(fraicheurTreeDomain('CIMETIERE'), 'Cimetière');
  assert.equal(fraicheurTreeDomain('DASCO'), 'École (DASCO)');
  assert.equal(fraicheurTreeDomain('DFPE'), 'Crèche (DFPE)');
  assert.equal(fraicheurTreeDomain('DJS'), 'Équipement sportif (DJS)');
  assert.equal(fraicheurTreeDomain('PERIPHERIQUE'), 'Abords du périphérique');
  assert.equal(fraicheurTreeDomain(null), null);
  assert.equal(fraicheurTreeDomain('SOMETHING_NEW'), 'SOMETHING_NEW');
  for (const tree of VIEW.trees) {
    const domain = fraicheurTreeDomain(tree.domain);
    if (!domain) continue;
    assert.equal(/^(DASCO|DFPE|DJS|DAC|DASES|CIMETIERE)$/.test(domain), false,
      `${tree.domain} must not reach a card as an internal acronym`);
  }
});

test('over budget the box is refused whole and the true count is reported', () => {
  const refused = projectFraicheurTrees({
    features: TREES, totalInBox: FRAICHEUR_TREE_BUDGET + 1, box: BOX,
  });
  assert.equal(refused.truncated, true);
  assert.equal(refused.trees.length, 0, 'nothing is drawn short');
  assert.equal(refused.returned, 0);
  assert.equal(refused.totalInBox, FRAICHEUR_TREE_BUDGET + 1);
  assert.equal(refused.budget, FRAICHEUR_TREE_BUDGET);
  assert.equal(refused.summary.trees, 0);
  // Exactly at the budget is not over it.
  const atBudget = projectFraicheurTrees({ features: TREES, totalInBox: FRAICHEUR_TREE_BUDGET, box: BOX });
  assert.equal(atBudget.truncated, false);
  assert.equal(atBudget.trees.length, 18);
});

test('the budget clears the densest box the proxy can be asked for', () => {
  // Measured 2026-09-02 by downloading all 219 432 published coordinates
  // (`exports/json?select=geo_point_2d`, 15 737 120 B) and scoring EVERY
  // grid-aligned window, not by sampling:
  //   • the client asks for at most 0.016°, snapped outward onto a 0.002° grid
  //     → at most a 10 × 10-cell window, whose worst case is 10 571 trees at
  //     48.816,2.346 → 48.836,2.366 (the 13e). The portal's own count probe on
  //     that exact box answers 10 571.
  //   • the proxy tolerates 0.022° → an 11 × 11 window, worst case 12 269.
  // A budget under 12 269 turns the refusal path from a guard into the normal
  // experience of the arrondissement with the most trees in it.
  assert.equal(FRAICHEUR_TREE_MAX_BOX_DEG, 0.016);
  assert.equal(FRAICHEUR_TREE_BOX_STEP_DEG, 0.002);
  assert.ok(Math.abs(FRAICHEUR_TREE_REQUEST_MAX_BOX_DEG - 0.022) < 1e-9);
  assert.ok(FRAICHEUR_TREE_BUDGET > 10_571, 'the densest 0.020° window must fit');
  assert.ok(FRAICHEUR_TREE_BUDGET > 12_269, 'the densest 0.022° window must fit');
  assert.equal(FRAICHEUR_TREE_MAX_ALTITUDE_M, 1500);
});

test('the bbox clause is latitude-first, which is the portal order', () => {
  assert.equal(fraicheurTreeWhere(BOX), 'in_bbox(geo_point_2d,48.816,2.346,48.836,2.366)');
  assert.equal(fraicheurTreeWhere(null), null);
  assert.equal(fraicheurTreeWhere({ south: 1, west: 2, north: 3 }), null);
  assert.equal(fraicheurTreeWhere({ south: NaN, west: 2, north: 3, east: 4 }), null);
});

test('a probe that disagrees with the export is reported, never smoothed over', () => {
  // The count probe and the export describe the SAME box. A mismatch means one
  // of them is describing a different one, and a tree map with scattered holes
  // looks exactly like a street with no trees on it.
  assert.equal(VIEW.countMismatch, false);
  const mismatched = projectFraicheurTrees({ features: TREES, totalInBox: 25, box: BOX });
  assert.equal(mismatched.countMismatch, true);
  assert.equal(mismatched.returned, 18);
  assert.equal(mismatched.totalInBox, 25);
  // With no probe at all the returned count stands in for it rather than a zero.
  const unprobed = projectFraicheurTrees({ features: TREES, box: BOX });
  assert.equal(unprobed.totalInBox, 18);
  assert.equal(unprobed.countMismatch, false);
  // An empty answer is an empty answer, not a crash.
  const nothing = projectFraicheurTrees({});
  assert.equal(nothing.trees.length, 0);
  assert.equal(nothing.summary.trees, 0);
});

test('the mean height is taken over the trees that published one', () => {
  // Averaging 19 407 zeros into it would report a shorter city than the one
  // that exists.
  const summary = VIEW.summary;
  assert.equal(summary.trees, 18);
  assert.equal(summary.measuredHeights, 16);
  assert.equal(summary.noHeight, 2);
  assert.equal(summary.noGirth, 1);
  assert.equal(summary.noSpecies, 1);
  assert.equal(summary.remarquable, 1);
  assert.equal(summary.remarquableUnknown, 2);
  assert.equal(summary.alignement, 5);
  const measured = VIEW.trees.filter((tree) => tree.height !== null);
  const expected = measured.reduce((sum, tree) => sum + tree.height, 0) / measured.length;
  assert.equal(summary.meanHeightM, Number(expected.toFixed(1)));
  assert.ok(summary.meanHeightM > (VIEW.trees.reduce((s, t) => s + (t.height || 0), 0) / 18),
    'the mean must be above the one a zero-filled average would give');
  assert.equal(summary.tallest.height, 20);
  assert.equal(summary.topSpecies[0].name, 'Erable');
  assert.equal(summary.topSpecies[0].count, 5);
  assert.ok(summary.topSpecies.length <= 5);
  // An empty viewport has no mean, not a mean of zero.
  assert.equal(summarizeFraicheurTrees([]).meanHeightM, null);
  assert.equal(summarizeFraicheurTrees(null).trees, 0);
});

test('a tree card states each absence rather than printing a zero', () => {
  const bare = treeCardLines(treeOf(2048228));
  const text = norm(bare.details.join(' | '));
  assert.match(text, /Hauteur non mesurée \(le registre publie 0\)/);
  assert.match(text, /Circonférence non mesurée \(le registre publie 0\)/);
  assert.equal(/0 m de haut/.test(text), false);
  assert.match(text, /idbase 2048228/);

  // A tree with no published species is named as one, not left blank.
  const anonymous = treeOf(230590);
  assert.equal(anonymous.name, null);
  assert.equal(treeCardLines(anonymous).title, 'Arbre (essence non publiée)');

  // The register contradicts itself on a handful of rows: a two-metre girth on
  // a low trunk. Naming it beats drawing it as if it were consistent.
  const inconsistent = treeCardLines({ height: 8, girth: 220, name: 'Ailante' });
  assert.match(norm(inconsistent.details.join(' | ')), /ne s’accordent pas/);
  const consistent = treeCardLines({ height: 20, girth: 225, name: 'Marronnier' });
  assert.equal(/ne s’accordent pas/.test(norm(consistent.details.join(' | '))), false);
});

test('the tree status line names the number and the ceiling it is refusing', () => {
  assert.match(fraicheurTreeLabel({ status: 'too-high' }), /Descends sous/);
  assert.match(norm(fraicheurTreeLabel({ status: 'too-high' })), /1 500 m/);
  const dense = norm(fraicheurTreeLabel({ status: 'too-dense', totalInBox: 10571 }));
  assert.match(dense, /10 571 arbres/);
  assert.match(dense, /12 500/);
  assert.match(dense, /Zoome/);
  // A refusal with no probe still refuses rather than inventing a count.
  assert.match(fraicheurTreeLabel({ status: 'too-dense' }), /Vue trop large/);
  assert.equal(fraicheurTreeLabel({ status: 'loading' }), 'comptage des arbres…');
  assert.match(fraicheurTreeLabel({ status: 'empty' }), /Aucun arbre référencé/);
  assert.match(norm(fraicheurTreeLabel({ status: 'ready', drawn: 5287 })), /5 287 arbres tracés/);
  assert.equal(fraicheurTreeLabel({}), null);
  assert.equal(fraicheurTreeLabel(), null);
});
