// src/data/isochroneRings.test.mjs
// What the catchment-area layer draws, and what it refuses to draw.
//
// The ring arithmetic — areas, expansion, equivalent radius — is proved against
// captured IGN answers in `isochroneFeed.test.mjs`. This file is about the
// layer: the cycling chip that cannot be pressed, the mode that cannot be
// smuggled in through a share link, and the one pickable thing a clamped
// outline has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import isochroneRingsLayer, {
  ISOCHRONE_DEFAULT_MODE,
  ISOCHRONE_MODES,
  ISOCHRONE_RING_STYLES,
  _isochroneModeForTest,
  _setIsochroneModeForTest,
  drawRing,
  expansionSentence,
  minutesLabel,
  modeVerb,
  resolveMode,
  ringLabelAnchor,
  ringStyle,
} from './isochroneRings.js';
import { ISOCHRONE_STEPS } from './isochroneFeed.js';

/** A square ring around Lyon, big enough to have a distinct northernmost point. */
function squareRing(halfDeg, { north = 45.77 } = {}) {
  const lon = 4.8357;
  const lat = 45.764;
  return [
    [lon - halfDeg, lat - halfDeg],
    [lon - halfDeg, north],
    [lon + halfDeg, lat + halfDeg],
    [lon + halfDeg, lat - halfDeg],
  ];
}

/** A minimal entity collection that records what a render added. */
function fakeDataSource() {
  const added = [];
  return {
    added,
    entities: {
      add(entity) { added.push(entity); return entity; },
    },
  };
}

const RING = (seconds, areaKm2, halfDeg) => ({
  seconds,
  areaKm2,
  ring: squareRing(halfDeg),
  profile: 'pedestrian',
  resourceVersion: '2026-08-25',
});

// ── The mode that does not exist ────────────────────────────────────────────

test('cycling is offered as a chip and refused as a mode', () => {
  const bike = ISOCHRONE_MODES.find((mode) => mode.id === 'bike');
  assert.ok(bike, 'the chip must exist — a missing ring nobody explains is worse');
  assert.equal(bike.available, false);
  assert.match(bike.blurb, /400/, 'the reason has to be the measured one, not a vague one');
  // And it must never become a drawn mode, however it is asked for.
  assert.equal(resolveMode('bike'), null);
  assert.equal(resolveMode('bicycle'), null);
  assert.equal(resolveMode('velo'), null);
});

test('an unsupported mode is refused, never downgraded to walking', () => {
  _setIsochroneModeForTest('car');
  assert.equal(_isochroneModeForTest(), 'car');
  // A hand-edited link asking for cycling must leave the DRIVING rings alone
  // rather than silently relabel them as walking.
  assert.equal(isochroneRingsLayer.setParams({ profile: 'bike' }), false);
  assert.equal(_isochroneModeForTest(), 'car');
  assert.equal(isochroneRingsLayer.setParams({ profile: 'nonsense' }), false);
  assert.equal(_isochroneModeForTest(), 'car');
  // The same mode twice is not a change and must not spend a request.
  assert.equal(isochroneRingsLayer.setParams({ profile: 'car' }), false);
  // And a call with no profile at all is not this layer's business.
  assert.equal(isochroneRingsLayer.setParams({}), false);
  _setIsochroneModeForTest(ISOCHRONE_DEFAULT_MODE);
});

test('the mode reaches a share link, because a drive is not a walk', () => {
  _setIsochroneModeForTest('foot');
  assert.deepEqual(isochroneRingsLayer.getParams(), { profile: 'foot' });
  _setIsochroneModeForTest('car');
  assert.deepEqual(isochroneRingsLayer.getParams(), { profile: 'car' });
  _setIsochroneModeForTest(ISOCHRONE_DEFAULT_MODE);
});

test('the layer asks the proxy for all three rings in one request', () => {
  // Three separate scans would be three cache keys, three rate-limit slots and
  // three chances for one to arrive late and draw out of order.
  assert.deepEqual([...ISOCHRONE_STEPS], [300, 600, 900]);
  assert.equal(ISOCHRONE_RING_STYLES.length, ISOCHRONE_STEPS.length);
  for (const [index, style] of ISOCHRONE_RING_STYLES.entries()) {
    assert.equal(style.seconds, ISOCHRONE_STEPS[index], 'a style per step, in step order');
  }
});

// ── The chips and the legend ────────────────────────────────────────────────

test('the cycling chip is disabled and carries no params to send', () => {
  _setIsochroneModeForTest('foot');
  const { chips } = isochroneRingsLayer.getRowControls();
  assert.equal(chips.length, 3);
  const bike = chips.find((chip) => chip.id === 'bike');
  assert.equal(bike.disabled, true);
  assert.equal(bike.active, false);
  assert.equal(bike.state, 'unavailable');
  assert.equal(bike.params, undefined, 'a chip that cannot act must not carry an action');
  assert.match(bike.title, /400/);
  // Exactly one of the two real modes is active.
  assert.equal(chips.filter((chip) => chip.active).length, 1);
  assert.equal(chips.find((chip) => chip.active).id, 'foot');
});

test('the legend carries areas, because "how many rings" means nothing', () => {
  const { legend } = isochroneRingsLayer.getRowControls();
  assert.equal(legend.length, 3);
  assert.deepEqual(legend.map((row) => row.label), ['5 min', '10 min', '15 min']);
  assert.deepEqual(
    legend.map((row) => row.color),
    ISOCHRONE_RING_STYLES.map((style) => style.color),
  );
  for (const row of legend) assert.match(row.blurb, /km²/);
});

test('the three ring colours are distinct, which is also what keeps Cesium honest', () => {
  // Two ground-classification polygons of the SAME colour batch together, and a
  // batch colours its instances by bounding RECTANGLE — which three concentric
  // rings share almost exactly. Distinct colours make the batch impossible.
  const colors = new Set(ISOCHRONE_RING_STYLES.map((style) => style.color));
  assert.equal(colors.size, ISOCHRONE_RING_STYLES.length);
});

// ── Drawing ─────────────────────────────────────────────────────────────────

test('a ring draws a fill, an outline and exactly one pickable label', () => {
  const dataSource = fakeDataSource();
  const cards = drawRing(dataSource, RING(600, 0.94, 0.004), {
    mode: 'foot', expansion: [], classificationType: Cesium.ClassificationType.TERRAIN,
  });
  assert.equal(cards, 1, 'one card-bearing entity per ring');
  const ids = dataSource.added.map((entity) => entity.id);
  assert.deepEqual(ids, ['isochrone:600:fill', 'isochrone:600:outline', 'isochrone:600:label']);
  const [fill, outline, label] = dataSource.added;
  assert.ok(fill.polygon && !fill.polygon.outline, 'the fill never draws its own outline');
  assert.equal(fill.polygon.classificationType, Cesium.ClassificationType.TERRAIN);
  assert.equal(outline.polyline.clampToGround, true);
  // A clamped polyline is ground-classification geometry and `scene.pick`
  // returns null on it, so the LABEL is the only reachable card. It must have
  // a position, a name and a description or the card path is dead.
  assert.ok(label.position, 'the label needs a real position to be picked');
  assert.match(label.name, /10 min à pied/);
  assert.match(label.description, /0.94 km²/);
  assert.match(label.description, /cercle équivalent/);
  assert.match(label.description, /BD TOPO 2026-08-25/);
});

test('a ring with too few vertices draws nothing rather than a degenerate polygon', () => {
  const dataSource = fakeDataSource();
  const drawn = drawRing(dataSource, { seconds: 300, areaKm2: 0.1, ring: [[4.8, 45.7], [4.81, 45.7]] }, {
    mode: 'foot', classificationType: Cesium.ClassificationType.TERRAIN,
  });
  assert.equal(drawn, 0);
  assert.equal(dataSource.added.length, 0);
});

test('a ring with unusable coordinates is filtered, not drawn as NaN', () => {
  const dataSource = fakeDataSource();
  const ring = { seconds: 300, areaKm2: 0.1, ring: [...squareRing(0.002), [NaN, 45.7], [4.8, null]] };
  drawRing(dataSource, ring, { mode: 'foot', classificationType: Cesium.ClassificationType.TERRAIN });
  const fill = dataSource.added.find((entity) => entity.id === 'isochrone:300:fill');
  assert.ok(fill, 'the four good corners still make a polygon');
});

test('the label anchor is the northernmost vertex, so three rings never stack', () => {
  const anchor = ringLabelAnchor(squareRing(0.004));
  // Compared with a tolerance rather than deep-equal: 4.8357 - 0.004 is
  // 4.8317000000000005 in binary floating point, and pinning that literal
  // would be pinning the arithmetic rather than the choice of vertex.
  assert.ok(Math.abs(anchor[0] - 4.8317) < 1e-9, `lon ${anchor[0]}`);
  assert.equal(anchor[1], 45.77, 'the northernmost latitude, exactly as given');
  assert.equal(ringLabelAnchor([]), null);
  assert.equal(ringLabelAnchor(null), null);
  // A malformed vertex is skipped rather than winning by comparing as NaN.
  assert.deepEqual(ringLabelAnchor([[1, 1], null, [2, 5], [3]]), [2, 5]);
});

// ── The sentences ───────────────────────────────────────────────────────────

test('the expansion sentence names what the percentage is a percentage of', () => {
  const frayed = expansionSentence({ fromSeconds: 300, toSeconds: 600, ratio: 3.36, freeSpaceRatio: 4, share: 83.9 });
  assert.match(frayed, /5 min → 10 min/);
  assert.match(frayed, /83.9 %/);
  assert.match(frayed, /expansion libre/);
  assert.match(frayed, /×3.36 au lieu de ×4/, 'the raw ratios, so the share can be checked');
  assert.match(frayed, /freine/);
  // Above 100 is a real state and gets its own sentence rather than a clamp.
  const open = expansionSentence({ fromSeconds: 600, toSeconds: 900, ratio: 2.3, freeSpaceRatio: 2.25, share: 102.1 });
  assert.match(open, /s’ouvre/);
  assert.equal(expansionSentence(null), null);
  assert.equal(expansionSentence({ share: NaN }), null);
});

test('minutes and verbs read the way a French brief says them', () => {
  assert.equal(minutesLabel(300), '5 min');
  assert.equal(minutesLabel(900), '15 min');
  assert.equal(minutesLabel(null), '—');
  assert.equal(modeVerb('foot'), 'à pied');
  assert.equal(modeVerb('car'), 'en voiture');
});

test('a style is found for every published step, and an unknown one lands on the outer ring', () => {
  for (const step of ISOCHRONE_STEPS) assert.equal(ringStyle(step).seconds, step);
  // A caller who asks the proxy for 1200 s gets drawn, in the outermost style,
  // rather than silently dropped.
  assert.equal(ringStyle(1200), ISOCHRONE_RING_STYLES.at(-1));
});

// ── What the row says ───────────────────────────────────────────────────────

test('the row reports the refusal without a reader opening a card', () => {
  const stats = isochroneRingsLayer.getStats();
  assert.equal(stats.bikeUnavailable, true);
  assert.equal(stats.mode, _isochroneModeForTest());
  assert.match(stats.feedSource, /Licence Ouverte/);
});
