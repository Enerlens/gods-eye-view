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
  centreCardText,
  drawRing,
  envelopeSentences,
  expansionDigest,
  expansionSentence,
  flyToCatchmentFrame,
  minutesLabel,
  modeVerb,
  resolveCentre,
  resolveMode,
  ringLabelAnchor,
  ringStyle,
} from './isochroneRings.js';
import { ISOCHRONE_STEPS } from './isochroneFeed.js';
import { getOverlaySourceEntries } from '../overlays/worldOverlay.js';

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

// ── The card the click opens by itself ──────────────────────────────────────

const PIN = { lon: -1.0522, lat: 43.7069, pinned: true };

/** A square ring centred on the pin, of `halfDeg` a side. */
function pinRing(halfDeg) {
  return [
    [PIN.lon - halfDeg, PIN.lat - halfDeg],
    [PIN.lon + halfDeg, PIN.lat - halfDeg],
    [PIN.lon + halfDeg, PIN.lat + halfDeg],
    [PIN.lon - halfDeg, PIN.lat + halfDeg],
  ];
}

/** A payload shaped as `/api/isochrone` answers one. */
function catchmentPayload(overrides = {}) {
  return {
    profile: 'foot',
    address: {
      label: '8 Rue Gambetta 40100 Dax', city: 'Dax', postcode: '40100', distanceM: 11,
    },
    rings: [
      { seconds: 300, areaKm2: 0.14, ring: pinRing(0.002) },
      { seconds: 600, areaKm2: 0.5, ring: pinRing(0.004) },
      { seconds: 900, areaKm2: 1.23, ring: pinRing(0.006) },
    ],
    expansion: [
      { fromSeconds: 300, toSeconds: 600, share: 89.3, ratio: 3.57, freeSpaceRatio: 4 },
      { fromSeconds: 600, toSeconds: 900, share: 109.3, ratio: 4.37, freeSpaceRatio: 4 },
    ],
    missing: 0,
    envelope: false,
    ...overrides,
  };
}

test('the card is titled with the address, not with the layer`s own state', () => {
  const card = centreCardText({ payload: catchmentPayload(), mode: 'foot', point: PIN });
  assert.equal(card.title, '8 Rue Gambetta 40100 Dax');
  assert.doesNotMatch(card.title, /point fix/i, 'the old title named a state, not a place');
  assert.equal(card.details[0], 'Zone de chalandise à pied autour de ce point');
  assert.match(card.details[1], /^5 min 0,14 km², 10 min 0,5 km², 15 min 1,23 km²$/);
});

test('every line survives the trip through the entity description', () => {
  // The card's details reach a click as ONE string split on ` · `, so a line
  // that contains the separator comes back as three lines that were never
  // written. This is the round trip, taken exactly as `cardFromEntity` takes it.
  for (const payload of [
    catchmentPayload(),
    catchmentPayload({ envelope: true, missing: 1, profile: 'bike' }),
    catchmentPayload({ address: { city: 'Dax', label: 'Route de X', distanceM: 400 } }),
  ]) {
    const card = centreCardText({ payload, mode: payload.profile, point: PIN });
    assert.deepEqual(card.details.join(' · ').split(' · '), card.details,
      `a detail line carries the separator: ${JSON.stringify(card.details)}`);
  }
});

test('the card explains the shape in the reader`s mode, and stays short', () => {
  for (const mode of ['foot', 'car', 'bike']) {
    const card = centreCardText({
      payload: catchmentPayload({ profile: mode, envelope: mode === 'bike' }),
      mode,
      point: PIN,
    });
    assert.equal(card.details[0], `Zone de chalandise ${modeVerb(mode)} autour de ce point`);
    assert.ok(card.details.length <= 6, `${mode}: ${card.details.length} lines`);
    // The card is painted beside a catchment it is framed out of, so its width
    // is catchment the reader does not get. 62 characters is about 410 px.
    for (const line of card.details) {
      assert.ok(line.length <= 62, `too long for the frame (${line.length}): ${line}`);
    }
  }
});

test('a commune standing in for an address says so on the card', () => {
  const card = centreCardText({
    payload: catchmentPayload({
      address: { label: 'Route de la Parcelle 40990', city: 'Saint-Paul-lès-Dax', distanceM: 412 },
    }),
    mode: 'foot',
    point: PIN,
  });
  assert.equal(card.title, 'Saint-Paul-lès-Dax');
  assert.ok(card.details.some((line) => /première adresse à 412 m/.test(line)),
    'or the commune title reads as more precise than it is');
});

test('an envelope still declares itself on the card that opens by itself', () => {
  const card = centreCardText({
    payload: catchmentPayload({ profile: 'bike', envelope: true }),
    mode: 'bike',
    point: PIN,
  });
  assert.ok(card.details.some((line) => /enveloppe OSM/.test(line) && /majorée/.test(line)));
});

test('a dropped ring is named on the card, not silently drawn smaller', () => {
  const one = centreCardText({ payload: catchmentPayload({ missing: 1 }), mode: 'foot', point: PIN });
  assert.ok(one.details.some((line) => /1 anneau non renvoyé/.test(line)));
  const two = centreCardText({ payload: catchmentPayload({ missing: 2 }), mode: 'foot', point: PIN });
  assert.ok(two.details.some((line) => /2 anneaux non renvoyés/.test(line)));
});

test('the card says which of the two centres it is describing', () => {
  const pinned = centreCardText({ payload: catchmentPayload(), mode: 'foot', point: PIN });
  assert.ok(pinned.details.at(-1).includes('LIBÉRER'));
  const followed = centreCardText({
    payload: catchmentPayload(), mode: 'foot', point: { ...PIN, pinned: false },
  });
  assert.match(followed.details.at(-1), /caméra/);
});

test('a service that answered nothing is said, not drawn as an empty catchment', () => {
  const card = centreCardText({
    payload: { rings: [], expansion: [], address: null },
    mode: 'foot',
    point: PIN,
  });
  assert.equal(card.title, '43,7069 N · 1,0522 O');
  assert.equal(card.details[1], 'aucun anneau renvoyé par le service');
});

test('the expansion digest keeps the reading and drops the arithmetic', () => {
  assert.equal(
    expansionDigest([
      { fromSeconds: 300, toSeconds: 600, share: 89.3 },
      { fromSeconds: 600, toSeconds: 900, share: 109.3 },
    ]),
    '89 % puis 109 % de l’expansion libre — le réseau s’ouvre',
  );
  // The verdict is the LAST pair's: it describes the outermost band, which is
  // the only edge the reader can see.
  assert.match(expansionDigest([{ share: 120 }, { share: 71 }]), /freine$/);
  assert.equal(expansionDigest([]), null);
  assert.equal(expansionDigest([{ share: null }]), null);
  assert.equal(expansionDigest(undefined), null);
});

/**
 * A viewer with just enough of a canvas for the framing to solve on.
 *
 * No `ScreenSpaceEventHandler` is built — the shell only installs one when
 * `scene.canvas` is an element it can listen on, and this is a measurement
 * surface, not one.
 */
function framingViewer() {
  const flights = [];
  return {
    flights,
    viewer: {
      camera: {
        heading: 0,
        frustum: { fov: Math.PI / 3, aspectRatio: 1.6 },
        positionCartographic: new Cesium.Cartographic(
          Cesium.Math.toRadians(PIN.lon), Cesium.Math.toRadians(PIN.lat), 3_000,
        ),
        moveEnd: { addEventListener: () => () => {} },
        cancelFlight() {},
        flyTo(options) { flights.push(options); },
      },
      scene: {
        globe: { show: true },
        canvasMeasureOnly: { clientWidth: 1600, clientHeight: 1000 },
        requestRender() {},
      },
      dataSources: { add: (source) => source, remove: () => true },
    },
  };
}

/** The viewer the last `scanOnce` built, for tests that then move the camera. */
let _framingViewer = null;

/** Drive one real scan of the layer against a canned `/api/isochrone` answer. */
async function scanOnce(t, payload, { pin = PIN } = {}) {
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, json: async () => payload };
  };
  const { viewer, flights } = framingViewer();
  _framingViewer = viewer;
  // The canvas is attached only after `enable`, which is what would otherwise
  // try to build a Cesium input handler on an object that is not an element.
  const base = _isochroneBaseForTest();
  base.init(viewer);
  base.enable(viewer);
  viewer.scene.canvas = viewer.scene.canvasMeasureOnly;
  t.after(() => {
    base.disable();
    base.destroy(viewer);
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
  });
  isochroneRingsLayer.setParams({ centre: `${pin.lon},${pin.lat}` });
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  return { flights, urls, stats: isochroneRingsLayer.getStats() };
}

test('a click frames the catchment and puts its card up, off the wash', async (t) => {
  _setIsochroneModeForTest('foot');
  const { flights, stats } = await scanOnce(t, catchmentPayload());
  assert.equal(stats.ringsDrawn, 3);
  assert.equal(stats.selectedId, 'isochrone:centre', 'the card opened without a second click');
  assert.equal(stats.address, '8 Rue Gambetta 40100 Dax');

  assert.equal(flights.length, 1, 'one flight per catchment, not one per frame');
  const orientation = flights[0].orientation;
  assert.ok(Math.abs(orientation.pitch + Cesium.Math.PI_OVER_TWO) < 1e-9,
    'nadir, because the framing arithmetic is only true looking straight down');
  assert.equal(orientation.heading, 0);

  assert.equal(stats.framing.side, 'below');
  assert.ok(stats.framing.altitudeM > 0);
  assert.ok(stats.framing.anchor.lat < PIN.lat,
    'the card hangs off the southern edge of the shape, not off its centre');
  assert.ok(stats.framing.anchor.lat < stats.framing.bounds.south + 1e-9);
});

test('the centre marker carries exactly what the card says', async (t) => {
  _setIsochroneModeForTest('foot');
  const payload = catchmentPayload();
  await scanOnce(t, payload);
  const [entry] = getOverlaySourceEntries('isochrone-fr');
  const expected = centreCardText({ payload, mode: 'foot', point: PIN });
  assert.equal(entry.title, expected.title);
  assert.deepEqual(entry.details, expected.details);
  assert.equal(entry.placement, 'below');
});

test('releasing the centre drops the frame with it', async (t) => {
  _setIsochroneModeForTest('foot');
  await scanOnce(t, catchmentPayload());
  assert.ok(isochroneRingsLayer.getStats().framing);
  isochroneRingsLayer.setParams({ centre: 'camera' });
  assert.equal(isochroneRingsLayer.getStats().framing, null,
    'a stale anchor would hang the next card off a catchment that has gone');
});

test('a camera-following scan is never reframed under the reader', async (t) => {
  _setIsochroneModeForTest('foot');
  const { flights } = await scanOnce(t, catchmentPayload());
  assert.equal(flights.length, 1);

  isochroneRingsLayer.setParams({ centre: 'camera' });
  // A real move, so the release actually costs a scan rather than resolving to
  // "the answer in hand still describes this block".
  _framingViewer.camera.positionCartographic.latitude = Cesium.Math.toRadians(43.75);
  await isochroneRingsLayer.update();
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.equal(flights.length, 1, 'the reader is driving; the layer does not take the wheel');
  assert.equal(isochroneRingsLayer.getStats().selectedId, null,
    'and no card opens over a scan nobody asked for');
  assert.equal(isochroneRingsLayer.getStats().framing, null);
});

test('a flight is refused while something else owns the camera', () => {
  const tracked = { camera: { flyTo() { throw new Error('flew anyway'); } }, trackedEntity: {} };
  assert.equal(flyToCatchmentFrame(tracked, {
    camera: { lon: 1, lat: 43, altitudeM: 4_000 }, headingRad: 0,
  }), false);
  assert.equal(flyToCatchmentFrame({ camera: null }, {
    camera: { lon: 1, lat: 43, altitudeM: 4_000 }, headingRad: 0,
  }), false);
  // And a frame the solver refused to produce is not flown to either.
  const spy = { flights: [] };
  const viewer = {
    scene: { globe: null },
    camera: { cancelFlight() {}, flyTo(options) { spy.flights.push(options); } },
  };
  assert.equal(flyToCatchmentFrame(viewer, null), false);
  assert.equal(flyToCatchmentFrame(viewer, {
    camera: { lon: 1, lat: 43, altitudeM: 0 }, headingRad: 0,
  }), false);
  assert.equal(spy.flights.length, 0);
});
