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
  ISOCHRONE_MAX_ALTITUDE_M,
  ISOCHRONE_MIN_SHIFT_KM,
  ISOCHRONE_MODES,
  ISOCHRONE_RING_STYLES,
  _isochroneBaseForTest,
  _isochroneModeForTest,
  _setIsochroneModeForTest,
  drawRing,
  envelopeSentences,
  expansionSentence,
  minutesLabel,
  modeVerb,
  resolveCentre,
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

// ── The three modes, and what each of them promises ─────────────────────────

test('cycling is a mode now, and it declares itself an envelope', () => {
  const bike = ISOCHRONE_MODES.find((mode) => mode.id === 'bike');
  assert.ok(bike);
  assert.equal(bike.available, true, 'IGN still refuses the profile; OSM answers it');
  assert.equal(bike.envelope, true, 'the flag is what makes the outline dashed and the area a majorant');
  assert.match(bike.feed, /OSM|OpenStreetMap/, 'the chip has to name the other network');
  assert.match(bike.blurb, /36 directions/, 'and say how coarse the measurement is');
  assert.equal(resolveMode('bike'), 'bike');
  assert.equal(resolveMode('BIKE'), 'bike');
  // The two IGN modes are polygons and must never claim otherwise.
  for (const id of ['foot', 'car']) {
    assert.equal(ISOCHRONE_MODES.find((mode) => mode.id === id).envelope, false);
  }
});

test('an unknown mode is refused, never downgraded to walking', () => {
  _setIsochroneModeForTest('car');
  assert.equal(_isochroneModeForTest(), 'car');
  // A hand-edited link asking for nonsense must leave the DRIVING rings alone
  // rather than silently relabel them as walking.
  assert.equal(isochroneRingsLayer.setParams({ profile: 'nonsense' }), false);
  assert.equal(_isochroneModeForTest(), 'car');
  assert.equal(isochroneRingsLayer.setParams({ profile: 'velo' }), false);
  assert.equal(_isochroneModeForTest(), 'car');
  // The same mode twice is not a change and must not spend a request.
  assert.equal(isochroneRingsLayer.setParams({ profile: 'car' }), false);
  // And a call with nothing this layer owns is not this layer's business.
  assert.equal(isochroneRingsLayer.setParams({}), false);
  _setIsochroneModeForTest(ISOCHRONE_DEFAULT_MODE);
});

test('the mode reaches a share link, because a drive is not a walk', () => {
  _setIsochroneModeForTest('foot');
  assert.deepEqual(isochroneRingsLayer.getParams(), { profile: 'foot', centre: 'camera' });
  _setIsochroneModeForTest('car');
  assert.deepEqual(isochroneRingsLayer.getParams(), { profile: 'car', centre: 'camera' });
  _setIsochroneModeForTest('bike');
  assert.equal(isochroneRingsLayer.getParams().profile, 'bike');
  _setIsochroneModeForTest(ISOCHRONE_DEFAULT_MODE);
});

// ── The ceiling, which is the mode's and not the layer's ────────────────────

test('the ceiling follows the mode, because a drive is not a walk on the ground', () => {
  // Measured 2026-09-02 at fifteen minutes: a walk is 1.9 km across, a ride up
  // to 7.2, a drive up to 16.5. One ceiling for the three either wastes
  // requests at the walking end or hides the answer at the driving end.
  assert.ok(ISOCHRONE_MAX_ALTITUDE_M.car > ISOCHRONE_MAX_ALTITUDE_M.bike);
  assert.ok(ISOCHRONE_MAX_ALTITUDE_M.bike > ISOCHRONE_MAX_ALTITUDE_M.foot);
  // Cesium shows about 0.65 × altitude of ground on the short screen axis at
  // nadir, so the driving ceiling has to clear a 16.5 km ring with room to
  // spare or the layer clears its own answer off the screen.
  assert.ok(ISOCHRONE_MAX_ALTITUDE_M.car * 0.65 > 16_500);
  assert.ok(ISOCHRONE_MAX_ALTITUDE_M.bike * 0.65 > 7_200);
  // And the movement threshold scales with it, or a lazy pan at 45 km spends a
  // request per nudge.
  assert.ok(ISOCHRONE_MIN_SHIFT_KM.car > ISOCHRONE_MIN_SHIFT_KM.foot);
  for (const mode of ISOCHRONE_MODES) {
    assert.ok(Number.isFinite(ISOCHRONE_MAX_ALTITUDE_M[mode.id]), `${mode.id} needs a ceiling`);
    assert.ok(Number.isFinite(ISOCHRONE_MIN_SHIFT_KM[mode.id]), `${mode.id} needs a threshold`);
  }
});

test('the reported ceiling and the dormant sentence follow the mode too', () => {
  _setIsochroneModeForTest('car');
  const driving = isochroneRingsLayer.getStats();
  assert.equal(driving.maxAltitudeM, ISOCHRONE_MAX_ALTITUDE_M.car);
  _setIsochroneModeForTest('foot');
  assert.equal(isochroneRingsLayer.getStats().maxAltitudeM, ISOCHRONE_MAX_ALTITUDE_M.foot);
  _setIsochroneModeForTest(ISOCHRONE_DEFAULT_MODE);
});

// ── The centre the reader chose ─────────────────────────────────────────────

test('a centre is a coordinate or the camera, and nothing else', () => {
  assert.deepEqual(resolveCentre('4.8357,45.764'), { lon: 4.8357, lat: 45.764 });
  assert.equal(resolveCentre('camera'), 'camera');
  assert.equal(resolveCentre('auto'), 'camera');
  // Rounded to five decimals, so two clicks on the same doorway share one
  // proxy cache entry.
  assert.deepEqual(resolveCentre('4.83571234,45.76409876'), { lon: 4.83571, lat: 45.7641 });
  // Refused, not snapped.
  assert.equal(resolveCentre('4.8357'), null);
  assert.equal(resolveCentre('4.8357,45.764,10'), null);
  assert.equal(resolveCentre('nowhere'), null);
  assert.equal(resolveCentre('4.8357,91'), null);
  assert.equal(resolveCentre('181,45'), null);
  assert.equal(resolveCentre(''), null);
  assert.equal(resolveCentre(null), null);
});

test('pinning a centre is refused when it is malformed, and reported when it holds', () => {
  const base = _isochroneBaseForTest();
  base.setScanPin(null);
  assert.equal(isochroneRingsLayer.setParams({ centre: 'somewhere' }), false);
  assert.equal(base.getScanPin(), null, 'a bad centre must not release the pin either');

  assert.equal(isochroneRingsLayer.setParams({ centre: '4.8357,45.764' }), true);
  assert.deepEqual(base.getScanPin(), { lon: 4.8357, lat: 45.764 });
  assert.equal(isochroneRingsLayer.getParams().centre, '4.8357,45.764');
  assert.equal(isochroneRingsLayer.getStats().pinned, true);
  // The same point twice is not a change and must not spend a request.
  assert.equal(isochroneRingsLayer.setParams({ centre: '4.8357,45.764' }), false);

  assert.equal(isochroneRingsLayer.setParams({ centre: 'camera' }), true);
  assert.equal(base.getScanPin(), null);
  assert.equal(isochroneRingsLayer.getStats().pinned, false);
});

test('the release chip exists only while there is something to release', () => {
  const base = _isochroneBaseForTest();
  base.setScanPin(null);
  assert.equal(
    isochroneRingsLayer.getRowControls().chips.find((chip) => chip.id === 'centre-camera'),
    undefined,
    'a chip offering to release nothing teaches the reader the wrong thing',
  );
  isochroneRingsLayer.setParams({ centre: '4.8357,45.764' });
  const release = isochroneRingsLayer.getRowControls().chips.find((chip) => chip.id === 'centre-camera');
  assert.ok(release);
  assert.deepEqual(release.params, { centre: 'camera' });
  assert.equal(release.disabled, false);
  assert.match(release.title, /45,764/, 'the chip says which point is held');
  base.setScanPin(null);
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

test('every mode chip can be pressed, and exactly one is active', () => {
  _setIsochroneModeForTest('foot');
  _isochroneBaseForTest().setScanPin(null);
  const { chips } = isochroneRingsLayer.getRowControls();
  assert.equal(chips.length, 3);
  const bike = chips.find((chip) => chip.id === 'bike');
  assert.equal(bike.disabled, false);
  assert.deepEqual(bike.params, { profile: 'bike' });
  assert.match(bike.title, /OSM|OSRM/, 'the chip names the other network before it is pressed');
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
  assert.equal(modeVerb('bike'), 'à vélo');
});

test('an envelope says what it is, and a polygon says nothing extra', () => {
  assert.deepEqual(envelopeSentences({ envelope: false, areaKm2: 2 }), []);
  assert.deepEqual(envelopeSentences(null), []);
  const said = envelopeSentences({
    envelope: true,
    bearings: 36,
    reachKm: { min: 0.76, median: 2.15, max: 3.15 },
    clippedBearings: 2,
  }).join(' · ');
  assert.match(said, /36 directions/);
  assert.match(said, /majorée/, 'never "surface réellement atteignable"');
  assert.match(said, /0,76.+3,15/, 'the spread, so an uneven network is visible');
  assert.match(said, /plancher/, 'a clipped spoke is a floor, and says so');
  assert.match(said, /OpenStreetMap/, 'the network is named beside the number');
  // No clipped spokes is the ordinary case and must not print the caveat.
  const clean = envelopeSentences({
    envelope: true, bearings: 36, reachKm: { min: 1, median: 2, max: 3 }, clippedBearings: 0,
  }).join(' · ');
  assert.doesNotMatch(clean, /plancher/);
});

test('a style is found for every published step, and an unknown one lands on the outer ring', () => {
  for (const step of ISOCHRONE_STEPS) assert.equal(ringStyle(step).seconds, step);
  // A caller who asks the proxy for 1200 s gets drawn, in the outermost style,
  // rather than silently dropped.
  assert.equal(ringStyle(1200), ISOCHRONE_RING_STYLES.at(-1));
});

// ── What the row says ───────────────────────────────────────────────────────

test('the row names the upstream that actually answered', () => {
  _setIsochroneModeForTest('foot');
  const walking = isochroneRingsLayer.getStats();
  assert.equal(walking.mode, 'foot');
  assert.equal(walking.envelope, false);
  assert.match(walking.feedSource, /Licence Ouverte/);
  _setIsochroneModeForTest('bike');
  const cycling = isochroneRingsLayer.getStats();
  assert.equal(cycling.envelope, true, 'a reader must not have to open a ring to learn this');
  assert.match(cycling.feedSource, /ODbL/, 'a different network is a different licence');
  _setIsochroneModeForTest(ISOCHRONE_DEFAULT_MODE);
});
