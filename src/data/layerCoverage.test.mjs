// Where a layer has data, and what a control is allowed to say about it.
//
// One property runs through this file: **a control must never claim a territory
// its layer does not hold, and must never go quiet over one it does.** Both
// failures are silent in production — the first draws an empty map and blames
// nobody, the second hides a working layer — so every row of the table is
// checked against the layer's own measured extent rather than against itself.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LAYER_COVERAGE,
  coverageNoticeFor,
  coverageSignature,
  coverageStateFor,
  layerCoverageFor,
  layerCoverageState,
  layerDarkAreaAt,
  validateLayerCoverage,
} from './layerCoverage.js';
import { REGISTERED_LAYER_IDS } from './layerState.js';
import { ROAD_STATUS_DARK_AREAS } from './roadStatusCoverage.js';

/** A view over the middle of Paris. */
const PARIS = Object.freeze({ south: 48.84, west: 2.30, north: 48.88, east: 2.38 });
/** Somewhere with none of these layers in it. */
const TOKYO = Object.freeze({ south: 35.6, west: 139.6, north: 35.8, east: 139.8 });
/** Marseille — France, on the national road network, outside every Paris box. */
const MARSEILLE = Object.freeze({ south: 43.25, west: 5.32, north: 43.34, east: 5.42 });

test('the shipped table validates', () => {
  assert.equal(validateLayerCoverage(), true);
});

test('every id in the table is a layer the app actually registers', () => {
  const registered = new Set(REGISTERED_LAYER_IDS);
  for (const entry of LAYER_COVERAGE) {
    assert.ok(registered.has(entry.id), `unknown coverage row ${entry.id}`);
  }
});

test('a malformed row fails the table rather than dimming the wrong control', () => {
  assert.throws(() => validateLayerCoverage([{ id: 'x', chip: 'X', where: 'x', boxes: [] }]));
  assert.throws(() => validateLayerCoverage([{ id: 'x', chip: '', where: 'x', boxes: [PARIS] }]));
  // Inverted box: the kind of typo that would silently answer "out" everywhere.
  assert.throws(() => validateLayerCoverage([{
    id: 'x', chip: 'X', where: 'x', boxes: [{ south: 49, west: 2, north: 48, east: 3 }],
  }]));
  assert.throws(() => validateLayerCoverage([
    { id: 'x', chip: 'X', where: 'x', boxes: [PARIS] },
    { id: 'x', chip: 'Y', where: 'y', boxes: [PARIS] },
  ]));
  // A card that opens on nothing costs a click and gives back an empty box.
  assert.throws(() => validateLayerCoverage([{
    id: 'x', chip: 'X', where: 'x', boxes: [PARIS], brief: { title: 'x', lines: [] },
  }]));
});

test('the Paris layers are in over Paris and out everywhere else', () => {
  for (const id of ['comptages-fr', 'fraicheur-fr', 'velo-pulse-fr']) {
    assert.equal(layerCoverageState(id, PARIS), 'in', `${id} over Paris`);
    assert.equal(layerCoverageState(id, TOKYO), 'out', `${id} over Tokyo`);
    assert.equal(layerCoverageState(id, MARSEILLE), 'out', `${id} over Marseille`);
  }
});

test('velo-pulse holds Lyon as well as Paris — a second city is not a rounding error', () => {
  // Measured off the shipped pack: 450 Vélo'v stations, 45,6933 → 45,8875 N.
  const lyon = { south: 45.74, west: 4.81, north: 45.79, east: 4.87 };
  assert.equal(layerCoverageState('velo-pulse-fr', lyon), 'in');
  // And the layer that does NOT have Lyon must not claim it.
  assert.equal(layerCoverageState('comptages-fr', lyon), 'out');
});

test('IDFM reaches the whole region, not just the city', () => {
  // Provins (48,56 N / 3,30 E) is Île-de-France and 80 km from Paris. A box
  // drawn on the capital would report two thirds of the network as absent.
  const provins = { south: 48.53, west: 3.26, north: 48.59, east: 3.34 };
  assert.equal(layerCoverageState('idfm-network', provins), 'in');
  assert.equal(layerCoverageState('comptages-fr', provins), 'out');
});

test('a retired layer keeps no territory of its own', () => {
  // `idfm-frequency` stopped being a layer on 2026-09-10: its module folded
  // into `idfmNetwork.js`, which kept the id and the row. A coverage row left
  // behind would be a claim about something that cannot draw — and the
  // registered-ids test above would fail on it, which is how this was caught.
  assert.equal(layerCoverageFor('idfm-frequency'), null);
});

test('road status is dark over Paris and lit over Marseille — the exact reciprocal', () => {
  // This is the pairing the traffic row now shows at a glance: over Paris the
  // DIR feed publishes nothing and the loop counts are the only measurement;
  // everywhere else it is the other way round.
  assert.equal(layerCoverageState('road-status-fr', PARIS), 'dark');
  assert.equal(layerCoverageState('comptages-fr', PARIS), 'in');
  assert.equal(layerCoverageState('road-status-fr', MARSEILLE), 'in');
  assert.equal(layerCoverageState('comptages-fr', MARSEILLE), 'out');
});

test('dark outranks in — a hole is the more specific truth', () => {
  // The national box contains Paris, so a naive intersection would answer `in`
  // over the one region whose operator publishes nothing at all.
  const area = layerDarkAreaAt('road-status-fr', PARIS);
  assert.ok(area, 'Paris falls in a documented dark area');
  assert.equal(area.operator, 'DIRIF');
  assert.equal(area.id, ROAD_STATUS_DARK_AREAS[0].id);
  assert.equal(layerDarkAreaAt('road-status-fr', MARSEILLE), null);
});

test('a view that crossed the antimeridian still finds Europe', () => {
  // `cameraViewBox` unwraps east past 180 rather than rejecting the view, so a
  // camera near the seam reports west 170 / east 190. Every box in this table
  // is between -5 and +10, and without the fold Paris would silently stop
  // existing for anyone who panned the wrong way round the planet.
  const seam = { south: 40, west: 170, north: 55, east: 190 };
  assert.equal(layerCoverageState('comptages-fr', seam), 'out');
  const wrapped = { south: 40, west: 355, north: 55, east: 368 };
  assert.equal(layerCoverageState('comptages-fr', wrapped), 'in');
});

test('no view box is unknown, never absent — a control must not dim at boot', () => {
  // Before the first camera settle there is no rectangle. Reading that as "out"
  // would open the app with every territorial control greyed out.
  assert.equal(layerCoverageState('comptages-fr', null), null);
  assert.equal(coverageStateFor(layerCoverageFor('comptages-fr'), null), null);
  assert.equal(layerCoverageState('flights', PARIS), null, 'a layer with no row claims nothing');
});

test('the signature changes when a territory changes and not when it does not', () => {
  // This is what stops a pan across Paris from repainting the whole panel.
  const a = coverageSignature(PARIS);
  const b = coverageSignature({ south: 48.85, west: 2.31, north: 48.87, east: 2.36 });
  assert.equal(a, b, 'two views inside every same territory are one state');
  assert.notEqual(a, coverageSignature(TOKYO));
  assert.notEqual(a, coverageSignature(MARSEILLE));
  assert.notEqual(coverageSignature(null), a);
});

test('the flight is only offered where it can be taken', () => {
  // A tooltip that says "cliquer pour y aller" on a badge nobody can click
  // teaches a reader that this map's instructions are decorative.
  const chip = coverageNoticeFor('comptages-fr', 'out', null, { clickable: true });
  const badge = coverageNoticeFor('comptages-fr', 'out', null);
  assert.match(chip, /Cliquer pour y aller/);
  assert.doesNotMatch(badge, /Cliquer/);
  assert.match(badge, /Paris intra-muros/);
  // A layer inside coverage has nothing extra to say.
  assert.equal(coverageNoticeFor('comptages-fr', 'in'), '');
});

test('a dark notice names the operator rather than shrugging', () => {
  // "No data here" invites the reader to blame the map. "DIRIF publishes
  // nothing" is a fact, and it is checkable.
  const notice = coverageNoticeFor('road-status-fr', 'dark', layerDarkAreaAt('road-status-fr', PARIS));
  assert.match(notice, /DIRIF/);
  assert.match(notice, /Île-de-France/);
  // And it says the layer is still working elsewhere in the view, because it is.
  assert.match(notice, /reste du réseau/);
});

test('road status offers no flight — a national layer is not somewhere to leave', () => {
  // Teleporting a reader out of Paris because DIRIF publishes nothing would
  // answer a question they did not ask.
  assert.equal(layerCoverageFor('road-status-fr').goto, null);
  assert.doesNotMatch(
    coverageNoticeFor('road-status-fr', 'dark', layerDarkAreaAt('road-status-fr', PARIS)),
    /Cliquer pour y aller/,
  );
});

test('only a layer whose subject is genuinely surprising carries a briefing', () => {
  // A card is an interruption. `comptages-fr` earns one because "a measured
  // count of vehicles, on this street, for Paris only" is three claims a chip
  // label cannot make; `fraicheur-fr` does not, because a reader who pressed
  // "Îlots de fraîcheur" already knows what they asked for.
  const briefed = LAYER_COVERAGE.filter((entry) => entry.brief).map((entry) => entry.id);
  assert.deepEqual(briefed, ['comptages-fr']);
  const brief = layerCoverageFor('comptages-fr').brief;
  assert.equal(brief.lines.length, 3, 'three lines; a fourth is a card nobody reads');
  // The card must make the distinction the whole layer rests on, and must not
  // imply a live feed it does not have.
  assert.ok(brief.lines.some((line) => /pas de la congestion/i.test(line)));
  assert.ok(brief.lines.some((line) => /archivée/i.test(line)));
  assert.ok(!brief.lines.some((line) => /\blive\b/i.test(line)));
});

test('the restated boxes equal the layers own measured extents', async () => {
  // The boxes are RESTATED here rather than imported, because importing
  // `comptagesParis.js` would pull Cesium — and both Paris layers — into the
  // entry bundle for every visitor on Earth, which is the exact cost `optIn`
  // was added to stop paying. The price of that decision is drift, and this is
  // where drift becomes a test failure instead of a silent lie.
  const { COMPTAGES_PARIS_BOX } = await import('./comptagesParis.js');
  const { FRAICHEUR_PARIS_BOX } = await import('./fraicheurParis.js');
  assert.deepEqual(
    { ...layerCoverageFor('comptages-fr').boxes[0] },
    { ...COMPTAGES_PARIS_BOX },
    'comptages-fr coverage drifted from the box the layer loads behind',
  );
  assert.deepEqual(
    { ...layerCoverageFor('fraicheur-fr').boxes[0] },
    { ...FRAICHEUR_PARIS_BOX },
    'fraicheur-fr coverage drifted from the box the layer loads behind',
  );
});
