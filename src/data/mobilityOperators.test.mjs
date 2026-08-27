// The operator colour channel.
//
// Colour on the shared-mobility layers means exactly one thing: WHO runs this.
// That only works if the mapping is stable (Lime is the same green in Lille as
// in Marseille), separable (Vélib' is not Voi is not Lime), and honest about
// the half of it that is derived from a title rather than pinned by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  curatedMobilityOperators,
  mobilityOperatorColor,
  mobilityOperatorShortLabel,
  normalizeOperatorText,
  resolveMobilityOperator,
  MOBILITY_OPERATOR_PALETTE,
  MOBILITY_OPERATOR_UNKNOWN_COLOR,
} from './mobilityOperators.js';

/**
 * Redmean distance — a cheap perceptual metric that, unlike raw RGB, does not
 * call two greens "far apart" because one channel differs.
 * Range is 0…765 for black↔white.
 */
function colorDistance(a, b) {
  const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const mean = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt((2 + mean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - mean) / 256) * db * db);
}

test('the palette is pairwise separable, including the unknown-operator tint', () => {
  // Two operators in one street that look the same are worse than no colour
  // channel at all — the map would be asserting a distinction it cannot make.
  const colors = [...MOBILITY_OPERATOR_PALETTE, MOBILITY_OPERATOR_UNKNOWN_COLOR];
  assert.equal(new Set(colors).size, colors.length, 'no duplicated hue');
  assert.ok(colors.every((color) => /^#[0-9a-f]{6}$/.test(color)), 'plain lowercase hex');

  let worst = Infinity;
  let worstPair = null;
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const distance = colorDistance(colors[i], colors[j]);
      if (distance < worst) {
        worst = distance;
        worstPair = [colors[i], colors[j]];
      }
    }
  }
  assert.ok(worst >= 78, `closest palette pair ${worstPair} scored ${worst.toFixed(1)}`);
});

test('every curated operator holds its own slot, and the majors sit further apart still', () => {
  const curated = curatedMobilityOperators();
  assert.equal(new Set(curated.map((entry) => entry.color)).size, curated.length,
    'two curated operators sharing a slot would be indistinguishable everywhere');
  assert.equal(new Set(curated.map((entry) => entry.id)).size, curated.length);

  let worst = Infinity;
  let worstPair = null;
  for (let i = 0; i < curated.length; i++) {
    for (let j = i + 1; j < curated.length; j++) {
      const distance = colorDistance(curated[i].color, curated[j].color);
      if (distance < worst) {
        worst = distance;
        worstPair = [curated[i].label, curated[j].label];
      }
    }
  }
  assert.ok(worst >= 85, `closest curated pair ${worstPair} scored ${worst.toFixed(1)}`);
});

test("Vélib', Voi and Lime are three different colours — the whole point", () => {
  const velib = resolveMobilityOperator("Vélib' Métropole");
  const voi = resolveMobilityOperator('Voi Paris');
  const lime = resolveMobilityOperator('Lime Paris');
  const dott = resolveMobilityOperator('Dott Paris');
  const colors = [velib, voi, lime, dott].map((operator) => operator.color);
  assert.equal(new Set(colors).size, 4);
  assert.deepEqual([velib.label, voi.label, lime.label, dott.label],
    ["Vélib'", 'Voi', 'Lime', 'Dott']);
  assert.ok([velib, voi, lime, dott].every((operator) => operator.curated));
});

test('one operator keeps one colour across every city it runs in', () => {
  // Measured from the shipped index: Lime publishes eight French systems, Voi
  // six, Pony eleven. If the hue tracked the city instead of the operator the
  // channel would say nothing.
  const lime = ['Lime Paris', 'Lime Lille', 'Lime Nice', 'Lime Marseille',
    'Lime Communauté d’Agglomération Sophia Antipolis (CASA)'];
  assert.equal(new Set(lime.map(mobilityOperatorColor)).size, 1);
  assert.equal(new Set(['Voi Marseille', 'Voi Paris', 'Voi Grenoble',
    'Voi V\'lones (Irigny, Saint-Genis-Laval, Charly , Vernaison)'].map(mobilityOperatorColor)).size, 1);
  assert.equal(new Set(['Pony Bordeaux', 'Pony Angers', 'Pony Pays Basque'].map(mobilityOperatorColor)).size, 1);
});

test('matching is on whole words, so a lookalike network is not swallowed by a major', () => {
  // Real catalog rows. A prefix test reads "Vélibleu Grand Châtellerault" as
  // Vélib' Paris and paints a Châtellerault network in Paris green.
  const velib = resolveMobilityOperator("Vélib Paris et communes limitrophes");
  const velibleu = resolveMobilityOperator('Vélibleu Grand Chatellerault');
  assert.equal(velib.id, 'velib');
  assert.equal(velibleu.curated, false);
  assert.notEqual(velibleu.color, velib.color);
  assert.equal(velibleu.label, 'Vélibleu');

  // Same trap the other way: "Vélo'v" must not be read as the generic "vélo"
  // lead word shared by a third of the municipal networks.
  assert.equal(resolveMobilityOperator("Vélo'v Lyon").id, 'velov');
  assert.equal(resolveMobilityOperator('Vélo Modalis Grand Angoulême').curated, false);
});

test("a title the registry does not know still gets a stable name and hue", () => {
  const naolib = resolveMobilityOperator('Naolib Nantes Métropole');
  assert.equal(naolib.label, 'Naolib');
  assert.equal(naolib.curated, false, 'and says so, rather than posing as livery');
  assert.equal(naolib.color, resolveMobilityOperator('Naolib micromob Nantes (avec stations)').color);
  assert.ok(MOBILITY_OPERATOR_PALETTE.includes(naolib.color));

  // A generic lead word is read one deeper, so four unrelated networks are not
  // all filed under "Vélo".
  assert.equal(resolveMobilityOperator('Vélo Modalis Grand Cognac Agglomération').label, 'Vélo Modalis');
  assert.equal(resolveMobilityOperator('Vélo Fluo Grand Est').label, 'Vélo Fluo');
  assert.notEqual(
    mobilityOperatorColor('Vélo Modalis Grand Cognac Agglomération'),
    mobilityOperatorColor('Vélo Fluo Grand Est'),
  );
  assert.equal(resolveMobilityOperator('Le Marcel Troyes Champagne Métropole').label, 'Le Marcel');
});

test('an unnamed system is drawn as unknown rather than assigned someone else\'s colour', () => {
  for (const empty of [null, undefined, '', '   ', '—']) {
    const operator = resolveMobilityOperator(empty);
    assert.equal(operator.id, 'unknown', `${JSON.stringify(empty)} resolved to ${operator.id}`);
    assert.equal(operator.color, MOBILITY_OPERATOR_UNKNOWN_COLOR);
  }
  assert.ok(!MOBILITY_OPERATOR_PALETTE.includes(MOBILITY_OPERATOR_UNKNOWN_COLOR),
    'unknown is not one of the operator hues, or it would impersonate one');
});

test('normalization folds accents, apostrophes and punctuation the way the titles need', () => {
  assert.equal(normalizeOperatorText("Vélo'v"), 'velov');
  assert.equal(normalizeOperatorText("V'lille Lille"), 'vlille lille');
  assert.equal(normalizeOperatorText('VélÔToulouse'), 'velotoulouse');
  assert.equal(normalizeOperatorText('Tarbes Lourdes Pyrénées (TLP)'), 'tarbes lourdes pyrenees tlp');
  // Typographic apostrophes appear in the live catalog next to plain ones.
  assert.equal(normalizeOperatorText('Velopop’ Avignon'), 'velopop avignon');
  assert.equal(normalizeOperatorText(null), '');
});

test('the detection overlay gets a clipped label, never an overflowing one', () => {
  assert.equal(mobilityOperatorShortLabel('Lime Paris', 10), 'Lime');
  const long = mobilityOperatorShortLabel('Transvilles Valenciennes', 10);
  assert.ok(long.length <= 10, long);
  assert.ok(long.endsWith('…'), long);
});

test('resolution is stable and cached — the same title never changes colour mid-session', () => {
  const first = resolveMobilityOperator('Vélam Amiens');
  const second = resolveMobilityOperator('Vélam Amiens');
  assert.equal(first, second, 'same frozen descriptor, so nothing downstream can mutate it');
  assert.throws(() => { first.color = '#000000'; }, TypeError);
});
