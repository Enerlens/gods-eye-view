// src/data/isochroneFraming.test.mjs
// The framing arithmetic, proved by PROJECTING THE ANSWER BACK.
//
// Every one of these functions is a step toward one claim — that after the
// flight the catchment is inside the part of the canvas no panel is sitting on,
// and that no pixel of it is under the card. Asserting the intermediate numbers
// would only prove the arithmetic agrees with itself, so the headline tests
// re-implement the nadir projection from the plan's own altitude and heading
// and measure where the shape lands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CARD_GAP_PX,
  CHROME_BAND_MAX_RATIO,
  CHROME_EDGE_TOLERANCE,
  FRAME_FILL,
  FRAME_MAX_ALTITUDE_M,
  FRAME_MIN_ALTITUDE_M,
  boundsSpanM,
  catchmentBounds,
  chromeFreeRect,
  estimateCardBoxPx,
  framePlan,
  screenFootprintM,
  screenOffsetToLonLat,
  solveCatchmentFrame,
} from './isochroneFraming.js';

const M_PER_DEG_LAT = 110_540;
const lonMetres = (lat) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** A square ring of `halfDeg` around a point, as the layer draws them. */
function squareRing(lon, lat, halfDeg) {
  return {
    seconds: 900,
    ring: [
      [lon - halfDeg, lat - halfDeg],
      [lon + halfDeg, lat - halfDeg],
      [lon + halfDeg, lat + halfDeg],
      [lon - halfDeg, lat + halfDeg],
    ],
  };
}

/**
 * The nadir projection, re-implemented from the plan.
 *
 * Deliberately NOT sharing code with the module under test: a projection that
 * agrees with the framing because it is the same three lines proves nothing.
 */
function projector({ camera, headingRad, metresPerPixel }, canvasWidth, canvasHeight) {
  const cos = Math.cos(headingRad);
  const sin = Math.sin(headingRad);
  return (lon, lat) => {
    const eastM = (lon - camera.lon) * lonMetres(camera.lat);
    const northM = (lat - camera.lat) * M_PER_DEG_LAT;
    const rightM = eastM * cos - northM * sin;
    const upM = eastM * sin + northM * cos;
    return {
      x: canvasWidth / 2 + rightM / metresPerPixel,
      y: canvasHeight / 2 - upM / metresPerPixel,
    };
  };
}

test('the bounds cover every vertex of every ring, and the centre too', () => {
  const rings = [
    squareRing(4.83, 45.76, 0.004),
    { seconds: 900, parts: [{ ring: squareRing(4.83, 45.76, 0.01).ring }] },
  ];
  const bounds = catchmentBounds(rings, { lon: 4.9, lat: 45.7 });
  assert.ok(bounds.east >= 4.9, 'a centre outside the rings still has to fit');
  assert.ok(bounds.south <= 45.7);
  assert.equal(Math.round(bounds.west * 1e5), Math.round((4.83 - 0.01) * 1e5));
  assert.equal(Math.round(bounds.north * 1e5), Math.round((45.76 + 0.01) * 1e5));
});

test('rings the service never sent are not bounds', () => {
  assert.equal(catchmentBounds([], null), null);
  assert.equal(catchmentBounds([{ ring: [] }], null), null);
  assert.equal(catchmentBounds(null, null), null);
  // A single vertex is a point, not a box; it must not frame anything.
  assert.equal(catchmentBounds([{ ring: [[4.8, 45.7]] }], null), null);
});

test('a degree of longitude is shorter in Lille than in Perpignan', () => {
  const north = boundsSpanM({ west: 3, east: 3.02, south: 50.6, north: 50.62 });
  const south = boundsSpanM({ west: 3, east: 3.02, south: 42.7, north: 42.72 });
  assert.ok(north.widthM < south.widthM * 0.9,
    `${Math.round(north.widthM)} m at Lille vs ${Math.round(south.widthM)} m at Perpignan`);
  // Latitude is not a function of latitude, and both boxes are 0.02° tall.
  assert.equal(Math.round(north.heightM), Math.round(south.heightM));
});

test('turning the map widens the box that has to fit on screen', () => {
  const flat = screenFootprintM(2000, 1000, 0);
  assert.deepEqual(flat, { widthM: 2000, heightM: 1000 });
  const quarter = screenFootprintM(2000, 1000, Math.PI / 2);
  assert.ok(Math.abs(quarter.widthM - 1000) < 1e-6, 'east-west becomes up-down');
  assert.ok(Math.abs(quarter.heightM - 2000) < 1e-6);
  const diagonal = screenFootprintM(2000, 1000, Math.PI / 4);
  assert.ok(diagonal.widthM > 2000, 'a box turned 45° needs more of both axes');
  assert.ok(diagonal.heightM > 1000);
});

test('screen offsets become the ground direction the heading points them at', () => {
  const origin = { lon: 2.35, lat: 48.86 };
  const down = screenOffsetToLonLat({ ...origin, rightM: 0, downM: 1000, headingRad: 0 });
  assert.ok(down.lat < origin.lat, 'down the screen is south at heading 0');
  assert.ok(Math.abs(down.lon - origin.lon) < 1e-9);
  const right = screenOffsetToLonLat({ ...origin, rightM: 1000, downM: 0, headingRad: 0 });
  assert.ok(right.lon > origin.lon, 'right of the screen is east at heading 0');
  const turned = screenOffsetToLonLat({
    ...origin, rightM: 1000, downM: 0, headingRad: Math.PI / 2,
  });
  assert.ok(turned.lat < origin.lat, 'facing east, the right of the screen is south');
  assert.ok(Math.abs(turned.lon - origin.lon) < 1e-6);
});

test('an edge-anchored panel becomes an inset; a full-bleed one is ignored', () => {
  // The real geometry, at the app's shipped gutters: the panel stack opens at
  // `--left-stack-x: 52px` and the command dock stands off the bottom. Chrome
  // in a gutter touches nothing, and requiring it to touch measured NONE of it.
  const free = chromeFreeRect({
    width: 1600,
    height: 1000,
    obstacles: [
      { x: 52, y: 260, w: 360, h: 500 },      // the panel stack, in its gutter
      { x: 1340, y: 240, w: 220, h: 200 },    // the right rail, in its own
      { x: 0, y: 0, w: 1600, h: 40 },         // the title bar, full width
      { x: 520, y: 920, w: 560, h: 62 },      // the command dock
      { x: 700, y: 400, w: 200, h: 120 },     // a floating chip, touching nothing
    ],
    margin: 10,
  });
  assert.ok(free.x >= 412, `left inset past the panel stack, got ${free.x}`);
  assert.ok(free.x + free.w <= 1340, 'right inset past the rail');
  assert.ok(free.y >= 40, 'top inset past the title bar');
  assert.ok(free.y + free.h <= 920, 'bottom inset past the dock');
  // The floating chip is not an edge band and cost nothing: the frame still
  // spans the middle of the canvas it sits in.
  assert.ok(free.x < 700 && free.x + free.w > 900);
});

test('chrome parked in the middle of an edge is not a band', () => {
  // A quarter of the way in is not a gutter: insetting past it would throw away
  // canvas the element is not standing on.
  const free = chromeFreeRect({
    width: 1600,
    height: 1000,
    obstacles: [{ x: 400, y: 300, w: 200, h: 200 }],
    margin: 10,
  });
  assert.deepEqual(free, { x: 10, y: 10, w: 1580, h: 980 });
});

test('a corner block is charged to whichever inset removes less canvas', () => {
  assert.ok(CHROME_EDGE_TOLERANCE > 0 && CHROME_EDGE_TOLERANCE < 0.25);
  // 300 x 60 in the top-left: a top inset costs 60 * 1600, a left inset
  // 300 * 1000. The top one is cheaper and must be the one taken.
  const free = chromeFreeRect({
    width: 1600,
    height: 1000,
    obstacles: [{ x: 0, y: 0, w: 300, h: 60 }],
    margin: 10,
  });
  assert.equal(free.x, 10, 'the left edge is untouched');
  assert.ok(free.y >= 60, `the top was inset instead, got ${free.y}`);
});

test('chrome too wide to inset past is left alone rather than obeyed', () => {
  const wide = Math.ceil(1600 * CHROME_BAND_MAX_RATIO) + 20;
  const free = chromeFreeRect({
    width: 1600,
    height: 1000,
    obstacles: [{ x: 0, y: 0, w: wide, h: 1000 }],
    margin: 10,
  });
  assert.equal(free.x, 10, 'insetting past it would leave a sliver, so it is skipped');
  assert.equal(free.w, 1580);
});

test('chrome that meets in the middle gives the whole canvas back', () => {
  const free = chromeFreeRect({
    width: 800,
    height: 600,
    obstacles: [
      { x: 0, y: 0, w: 350, h: 600 },
      { x: 460, y: 0, w: 340, h: 600 },
    ],
    margin: 10,
  });
  assert.deepEqual(free, { x: 10, y: 10, w: 780, h: 580 },
    'a two-pixel box is worse than a panel over one edge of the catchment');
});

test('the card box grows with its longest line, not its line count alone', () => {
  const short = estimateCardBoxPx('Dax', ['5 min 0,1 km²']);
  const long = estimateCardBoxPx('Dax', ['5 min 0,1 km²', 'x'.repeat(60)]);
  assert.ok(long.w > short.w * 2, `${short.w} → ${long.w}`);
  assert.ok(long.h > short.h, 'and one more line is one more line of height');
  // Seven details is six on the card: the overlay entry slices there.
  const capped = estimateCardBoxPx('Dax', Array.from({ length: 9 }, () => 'ligne'));
  assert.equal(capped.h, estimateCardBoxPx('Dax', Array.from({ length: 6 }, () => 'ligne')).h);
});

test('the framed catchment lands inside the box, clear of the card band', () => {
  const canvasWidth = 1600;
  const canvasHeight = 1000;
  const centre = { lon: 4.8357, lat: 45.7578 };
  // A fifteen-minute drive at its measured widest: 16.5 x 14.1 km.
  const halfLon = 8_250 / lonMetres(centre.lat);
  const halfLat = 7_050 / M_PER_DEG_LAT;
  const rings = [squareRing(centre.lon, centre.lat, 0)];
  rings[0].ring = [
    [centre.lon - halfLon, centre.lat - halfLat],
    [centre.lon + halfLon, centre.lat - halfLat],
    [centre.lon + halfLon, centre.lat + halfLat],
    [centre.lon - halfLon, centre.lat + halfLat],
  ];
  const free = chromeFreeRect({
    width: canvasWidth,
    height: canvasHeight,
    obstacles: [
      { x: 0, y: 250, w: 380, h: 500 },
      { x: 1380, y: 240, w: 220, h: 200 },
      { x: 520, y: 930, w: 560, h: 70 },
    ],
    margin: 14,
  });
  const card = { w: 420, h: 121 };
  const bounds = catchmentBounds(rings, centre);
  const span = boundsSpanM(bounds);
  const headingRad = 0.4;
  const plan = framePlan({
    footprint: screenFootprintM(span.widthM, span.heightM, headingRad),
    free,
    canvasWidth,
    canvasHeight,
    card,
    fovxRad: Math.PI / 3,
  });
  assert.equal(plan.side, 'below');
  const cameraPoint = screenOffsetToLonLat({
    lon: span.lon, lat: span.lat, rightM: plan.cameraRightM, downM: plan.cameraDownM, headingRad,
  });
  const project = projector(
    { camera: cameraPoint, headingRad, metresPerPixel: plan.metresPerPixel },
    canvasWidth,
    canvasHeight,
  );

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const lon of [bounds.west, bounds.east]) {
    for (const lat of [bounds.south, bounds.north]) {
      const point = project(lon, lat);
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  }
  assert.ok(minX >= plan.box.x - 0.5 && maxX <= plan.box.x + plan.box.w + 0.5,
    `catchment spans x ${Math.round(minX)}..${Math.round(maxX)} in a box of `
    + `${Math.round(plan.box.x)}..${Math.round(plan.box.x + plan.box.w)}`);
  assert.ok(minY >= plan.box.y - 0.5 && maxY <= plan.box.y + plan.box.h + 0.5,
    `catchment spans y ${Math.round(minY)}..${Math.round(maxY)}`);
  // The whole point: the band the card lives in is below everything drawn.
  assert.ok(maxY <= free.y + free.h - card.h - CARD_GAP_PX + 0.5,
    `the catchment reaches y=${Math.round(maxY)} and the card band starts at `
    + `${Math.round(free.y + free.h - card.h - CARD_GAP_PX)}`);
  // And it fills the box it was given, rather than being framed timidly.
  const filled = Math.max((maxX - minX) / plan.box.w, (maxY - minY) / plan.box.h);
  assert.ok(filled > FRAME_FILL - 0.02 && filled <= FRAME_FILL + 0.02,
    `filled ${(filled * 100).toFixed(1)} % of the box`);
});

test('the card anchor sits on the edge the band was reserved under', () => {
  const plan = framePlan({
    footprint: { widthM: 2000, heightM: 1400 },
    free: { x: 40, y: 40, w: 1200, h: 800 },
    canvasWidth: 1600,
    canvasHeight: 1000,
    card: { w: 400, h: 120 },
    fovxRad: Math.PI / 3,
  });
  assert.equal(plan.anchorRightM, 0, 'the anchor is centred on the shape');
  assert.equal(plan.anchorDownM, 700, 'and on its lower edge — half the height, down');
});

test('a frame too short for a band keeps the card on the marker', () => {
  const tiny = framePlan({
    footprint: { widthM: 2000, heightM: 1400 },
    free: { x: 40, y: 40, w: 300, h: 260 },
    canvasWidth: 400,
    canvasHeight: 300,
    card: { w: 400, h: 120 },
    fovxRad: Math.PI / 3,
  });
  assert.equal(tiny.side, 'none', 'no band fits, and covering some wash beats not framing');
  assert.deepEqual(tiny.box, { x: 40, y: 40, w: 300, h: 260 }, 'the whole frame is used');
});

test('the altitude is clamped, and the scale is re-derived from the clamp', () => {
  const shared = {
    free: { x: 0, y: 0, w: 1200, h: 800 },
    canvasWidth: 1600,
    canvasHeight: 1000,
    card: { w: 400, h: 120 },
    fovxRad: Math.PI / 3,
  };
  const speck = framePlan({ ...shared, footprint: { widthM: 0.01, heightM: 0.01 } });
  assert.equal(speck.altitudeM, FRAME_MIN_ALTITUDE_M, 'a degenerate ring never flies into the ground');
  const continent = framePlan({ ...shared, footprint: { widthM: 9e6, heightM: 9e6 } });
  assert.equal(continent.altitudeM, FRAME_MAX_ALTITUDE_M);
  // The offsets are pixel distances times the scale, so the scale has to follow
  // the clamped altitude or the camera aims at a point it was never solved for.
  for (const plan of [speck, continent]) {
    const expected = (2 * plan.altitudeM * Math.tan(Math.PI / 6)) / shared.canvasWidth;
    assert.ok(Math.abs(plan.metresPerPixel - expected) < 1e-9);
  }
});

test('inputs that cannot describe a flight produce no plan at all', () => {
  const shared = {
    free: { x: 0, y: 0, w: 1200, h: 800 },
    canvasWidth: 1600,
    canvasHeight: 1000,
    card: { w: 400, h: 120 },
    fovxRad: Math.PI / 3,
  };
  assert.equal(framePlan({ ...shared, footprint: { widthM: 0, heightM: 0 } }), null);
  assert.equal(framePlan({ ...shared, footprint: null }), null);
  assert.equal(framePlan({ ...shared, free: { x: 0, y: 0, w: 0, h: 0 } }), null);
  assert.equal(framePlan({ ...shared, footprint: { widthM: 10, heightM: 10 }, canvasWidth: 0 }), null);
});

test('the solver reads the live canvas, heading and frustum off the viewer', () => {
  const viewer = {
    camera: { heading: 0, frustum: { fov: Math.PI / 3, aspectRatio: 1.6 } },
    scene: { canvas: { clientWidth: 1600, clientHeight: 1000 } },
  };
  const centre = { lon: 4.8357, lat: 45.7578 };
  const frame = solveCatchmentFrame({
    viewer,
    rings: [squareRing(centre.lon, centre.lat, 0.01)],
    centre,
    card: { w: 400, h: 120 },
  });
  assert.ok(frame.camera.altitudeM > FRAME_MIN_ALTITUDE_M);
  assert.equal(frame.side, 'below');
  assert.ok(frame.anchor.lat < centre.lat, 'the anchor hangs off the southern edge at heading 0');
  assert.ok(Math.abs(frame.anchor.lon - centre.lon) < 1e-9);
  // No document in this runtime: the chrome inventory comes back empty and the
  // frame is the whole canvas, which must not be a failure.
  assert.ok(frame.box.w > 1000);
});

test('the solver declines rather than guesses when a piece is missing', () => {
  const viewer = {
    camera: { heading: 0, frustum: { fov: Math.PI / 3, aspectRatio: 1.6 } },
    scene: { canvas: { clientWidth: 1600, clientHeight: 1000 } },
  };
  assert.equal(solveCatchmentFrame({ viewer, rings: [], centre: null, card: { w: 1, h: 1 } }), null);
  assert.equal(solveCatchmentFrame({
    viewer: { camera: viewer.camera }, rings: [squareRing(4.8, 45.7, 0.01)], centre: null, card: { w: 1, h: 1 },
  }), null);
});
