// src/data/viewGate.test.mjs
// The zoom a gated layer needs, applied rather than announced.
//
// The geometry here is the whole point: a ceiling expressed in DEGREES, solved
// against a camera that thinks in metres and pitch. The proof at the bottom
// flies the solved camera in a small independent model of what a camera sees
// and asserts the resulting box is under the ceiling the layer loads behind —
// including the case the arithmetic is easiest to get wrong, a heading that is
// not cardinal and a rectangle that has to contain a rotated trapezoid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  M_PER_DEG_LAT,
  VIEW_GATE_MIN_HEIGHT_M,
  VIEW_GATE_MIN_PITCH_DEG,
  applyViewGate,
  cameraViewBox,
  normalizeLon,
  viewGateFieldOfView,
  viewGateEye,
  viewGateFocus,
  viewGateHeightM,
  viewGatePitchDeg,
  viewGatePlan,
  viewGateSpanPerHeight,
} from './viewGate.js';

const RAD = Math.PI / 180;

/** France + Corse, the shape BD TOPO publishes for. */
const FRANCE = Object.freeze([
  Object.freeze({ south: 41.2, west: -5.3, north: 51.2, east: 9.7 }),
  Object.freeze({ south: -21.5, west: 55.1, north: -20.8, east: 55.9 }), // La Réunion
]);

/**
 * What a camera at `plan` would see, written out here rather than imported, so
 * the module cannot mark its own homework. Flat ground, straight trigonometry:
 * the along-track strip between the bottom and top rays, widened across-track
 * at its far edge, rotated onto the heading and wrapped in an axis-aligned box
 * — which is exactly the shape `computeViewRectangle` returns.
 */
function visibleBox(plan, { fovxDeg, fovyDeg }) {
  const down = Math.abs(plan.pitchDeg);
  const near = plan.aglM / Math.tan((down + fovyDeg / 2) * RAD);
  const far = plan.aglM / Math.tan((down - fovyDeg / 2) * RAD);
  const halfNear = near * Math.tan((fovxDeg / 2) * RAD);
  const halfFar = far * Math.tan((fovxDeg / 2) * RAD);
  const heading = plan.headingDeg * RAD;
  const corners = [
    { along: near, across: -halfNear },
    { along: near, across: halfNear },
    { along: far, across: -halfFar },
    { along: far, across: halfFar },
    { along: 0, across: 0 },
  ];
  const cosLat = Math.cos(plan.lat * RAD);
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const corner of corners) {
    const northM = corner.along * Math.cos(heading) - corner.across * Math.sin(heading);
    const eastM = corner.along * Math.sin(heading) + corner.across * Math.cos(heading);
    const lat = plan.lat + northM / M_PER_DEG_LAT;
    const lon = plan.lon + eastM / (M_PER_DEG_LAT * cosLat);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lon);
    east = Math.max(east, lon);
  }
  return { south, west, north, east };
}

/**
 * A viewer whose camera really moves: `flyTo` adopts the destination and the
 * view rectangle is recomputed from it with the model above.
 */
function createViewer({
  box, heightM = 6_000_000, pitchDeg = -90, headingDeg = 0, groundM = 0, fovDeg = 60, aspect = 1.674,
} = {}) {
  const state = {
    box: box || { south: 41, west: -6, north: 52, east: 10 },
    flights: [],
    cancelNext: false,
  };
  const camera = {
    frustum: { fov: fovDeg * RAD, aspectRatio: aspect },
    get heading() { return headingDeg * RAD; },
    get pitch() { return pitchDeg * RAD; },
    positionCartographic: { height: heightM },
    computeViewRectangle: () => Cesium.Rectangle.fromDegrees(
      state.box.west, state.box.south, state.box.east, state.box.north,
    ),
    flyTo(options) {
      const carto = Cesium.Cartographic.fromCartesian(options.destination);
      const plan = {
        lat: Cesium.Math.toDegrees(carto.latitude),
        lon: Cesium.Math.toDegrees(carto.longitude),
        aglM: carto.height - groundM,
        pitchDeg: Cesium.Math.toDegrees(options.orientation.pitch),
        headingDeg: Cesium.Math.toDegrees(options.orientation.heading),
      };
      state.flights.push({ ...plan, heightM: carto.height, duration: options.duration });
      if (state.cancelNext) {
        state.cancelNext = false;
        options.cancel?.();
        return;
      }
      camera.positionCartographic = { height: carto.height };
      state.box = visibleBox(plan, viewGateFieldOfView(camera.frustum));
      options.complete?.();
    },
  };
  return {
    camera,
    scene: { globe: { ellipsoid: Cesium.Ellipsoid.WGS84, getHeight: () => groundM } },
    state,
  };
}

test('the focus is the centre of what is already framed', () => {
  const focus = viewGateFocus({ south: 45, west: 4, north: 46, east: 6 });
  assert.equal(focus.lat, 45.5);
  assert.equal(focus.lon, 5);
});

test('a centre outside coverage is pulled onto the coverage the camera can see', () => {
  // A camera framing the Bay of Biscay and western France: the centre is water
  // with no BD TOPO under it, so the flight belongs over the land in shot.
  const focus = viewGateFocus({ south: 43, west: -20, north: 49, east: -2 }, FRANCE);
  assert.ok(focus.lon > -5.3, `expected the focus inside coverage, got ${focus.lon}`);
  assert.ok(Math.abs(focus.lon - (-5.3 + -2) / 2) < 1e-9, 'the centre of the coverage in shot');
  assert.equal(focus.lat, (43 + 49) / 2);
});

test('a sliver of coverage at the edge of an aimed camera is not worth a flight', () => {
  // 400 km over Berlin, clipping the eastern edge of France: the operator is
  // looking at Berlin, and answering that with a flight to Strasbourg would be
  // worse than the guidance state it replaces.
  assert.equal(viewGateFocus({ south: 51.2, west: 9.6, north: 53.8, east: 17.2 }, FRANCE), null);
});

test('from orbit, a camera aimed at nothing in particular is taken to the coverage', () => {
  // The same sliver, but held by a globe-wide camera: turning on a French layer
  // from orbit means "take me to France".
  const focus = viewGateFocus({ south: -60, west: -180, north: 80, east: 180 }, FRANCE);
  assert.ok(focus, 'a global view has somewhere to go');
  assert.ok(focus.lat > 41.2 && focus.lat < 51.2, `expected France, got ${focus.lat}`);
  assert.ok(focus.lon > -5.3 && focus.lon < 9.7, `expected France, got ${focus.lon}`);
});

test('a camera with no coverage in shot at all has nowhere to be flown', () => {
  assert.equal(viewGateFocus({ south: -35, west: 145, north: -30, east: 152 }, FRANCE), null);
});

test('a centre already inside coverage is left where it is', () => {
  const focus = viewGateFocus({ south: 44, west: 2, north: 48, east: 7 }, FRANCE);
  assert.equal(focus.lat, 46);
  assert.equal(focus.lon, 4.5);
});

test('a wrapped view keeps a longitude the globe can be flown to', () => {
  const viewer = createViewer({ box: { south: -10, west: 170, north: 10, east: -170 } });
  const box = cameraViewBox(viewer);
  assert.equal(box.east, 190, 'the box is unwrapped rather than refused');
  // The centre of 170°E → 190°E is the antimeridian itself, which only exists
  // on a globe as -180.
  assert.equal(viewGateFocus(box).lon, -180);
  assert.equal(normalizeLon(200), -160);
  assert.equal(normalizeLon(-200), 160);
});

test('the pitch is steepened when it has to be and kept when it does not', () => {
  assert.equal(viewGatePitchDeg(-20), VIEW_GATE_MIN_PITCH_DEG, 'a shallow view is steepened');
  assert.equal(viewGatePitchDeg(-80), -80, 'a steep view is left alone');
  assert.equal(viewGatePitchDeg(12), VIEW_GATE_MIN_PITCH_DEG, 'the camera never looks up');
  assert.equal(viewGatePitchDeg(-120), -89, 'and never inverts under the nadir');
  assert.equal(viewGatePitchDeg(Number.NaN), VIEW_GATE_MIN_PITCH_DEG);
});

test("the frustum angle is read on the axis Cesium put it on", () => {
  const landscape = viewGateFieldOfView({ fov: 60 * RAD, aspectRatio: 16 / 9 });
  assert.equal(Math.round(landscape.fovxDeg), 60, 'wide canvas: fov is the horizontal angle');
  assert.ok(landscape.fovyDeg < 60 && landscape.fovyDeg > 30);
  const portrait = viewGateFieldOfView({ fov: 60 * RAD, aspectRatio: 0.5 });
  assert.equal(Math.round(portrait.fovyDeg), 60, 'tall canvas: fov is the vertical angle');
  assert.ok(portrait.fovxDeg < 60);
  const missing = viewGateFieldOfView(null);
  assert.equal(Math.round(missing.fovxDeg), 60, 'an unreadable frustum falls back to Cesium defaults');
});

test('a shallower pitch always sees more ground per metre of altitude', () => {
  const steep = viewGateSpanPerHeight(-80, 60, 38);
  const shallow = viewGateSpanPerHeight(-55, 60, 38);
  assert.ok(shallow > steep, `${shallow} should exceed ${steep}`);
  assert.ok(viewGateSpanPerHeight(-5, 60, 38) > shallow, 'and a horizon view most of all');
});

test('the solved height sizes off longitude, the tighter axis off the equator', () => {
  const common = { maxDeg: 0.08, pitchDeg: -55, fovxDeg: 60, fovyDeg: 38 };
  const paris = viewGateHeightM({ ...common, latDeg: 48.85 });
  const equator = viewGateHeightM({ ...common, latDeg: 0 });
  assert.ok(paris < equator, 'a degree of longitude buys fewer metres in Paris');
  assert.ok(paris > 1000 && paris < 3000, `expected a district-scale height, got ${paris}`);
  assert.equal(
    viewGateHeightM({ ...common, latDeg: 48.85, maxDeg: 0.000_1 }),
    VIEW_GATE_MIN_HEIGHT_M,
    'and it never solves closer than the floor',
  );
});

test('the eye stands back along its heading so the focus stays centred', () => {
  const focus = { lat: 45.76, lon: 4.82 };
  const north = viewGateEye(focus, { aglM: 1000, pitchDeg: -45, headingDeg: 0 });
  assert.ok(north.lat < focus.lat, 'looking north, the eye is south of the focus');
  assert.ok(Math.abs(north.lon - focus.lon) < 1e-9);
  const east = viewGateEye(focus, { aglM: 1000, pitchDeg: -45, headingDeg: 90 });
  assert.ok(east.lon < focus.lon, 'looking east, the eye is west of the focus');
  assert.ok(Math.abs(east.lat - focus.lat) < 1e-9);
  const steep = viewGateEye(focus, { aglM: 1000, pitchDeg: -89, headingDeg: 0 });
  assert.ok(Math.abs(steep.lat - focus.lat) < Math.abs(north.lat - focus.lat),
    'a steeper view stands almost on top of it');
});

test('the plan zooms in and never out', () => {
  const focus = { lat: 45.76, lon: 4.82 };
  const shared = { focus, maxDeg: 0.08, fovxDeg: 60, fovyDeg: 38, headingDeg: 0 };
  const fromOrbit = viewGatePlan({ ...shared, pitchDeg: -90, cameraHeightM: 6_000_000 });
  assert.ok(fromOrbit.aglM > VIEW_GATE_MIN_HEIGHT_M && fromOrbit.aglM < 4000,
    `a continental camera comes all the way down, got ${fromOrbit.aglM}`);
  assert.equal(fromOrbit.pitchDeg, -89, 'a nadir view keeps its own angle');
  const fromLow = viewGatePlan({ ...shared, pitchDeg: -20, cameraHeightM: 600 });
  assert.equal(fromLow.aglM, 600, 'a camera already lower keeps its altitude');
  assert.equal(fromLow.pitchDeg, VIEW_GATE_MIN_PITCH_DEG, 'and is fixed with pitch instead');
});

test('the plan seats the solved height on the terrain under the focus', () => {
  const focus = { lat: 45.9, lon: 6.87 }; // Chamonix
  const plan = viewGatePlan({
    focus, maxDeg: 0.08, fovxDeg: 60, fovyDeg: 38, headingDeg: 0, pitchDeg: -60, groundM: 1035,
  });
  assert.ok(plan.heightM > 1035 + VIEW_GATE_MIN_HEIGHT_M,
    'a camera solved over a valley floor is above the valley floor');
  assert.equal(Math.round(plan.heightM - plan.aglM), 1035);
});

test('the plan refuses what it cannot solve', () => {
  assert.equal(viewGatePlan({ focus: null, maxDeg: 0.08 }), null);
  assert.equal(viewGatePlan({ focus: { lat: 1, lon: 1 }, maxDeg: 0 }), null);
});

for (const headingDeg of [0, 37, 135, 300]) {
  test(`the solved camera really is inside the gate, heading ${headingDeg}°`, () => {
    const viewer = createViewer({
      box: { south: 41, west: -6, north: 52, east: 10 },
      heightM: 4_000_000,
      pitchDeg: -90,
      headingDeg,
    });
    const maxDeg = 0.08;
    const fits = () => {
      const box = cameraViewBox(viewer);
      return Boolean(box)
        && Math.max(box.north - box.south, box.east - box.west) <= maxDeg;
    };
    assert.equal(fits(), false, 'the continental view starts outside the gate');
    return applyViewGate(viewer, { fits, maxDeg, coverage: FRANCE, duration: 0 })
      .then((satisfied) => {
        assert.equal(satisfied, true, 'and ends inside it');
        assert.equal(viewer.state.flights.length, 1, 'in one flight');
        assert.ok(viewer.state.flights[0].aglM < 3000);
      });
  });
}

test('a camera already inside the gate is not moved at all', async () => {
  const viewer = createViewer({ box: { south: 45.75, west: 4.82, north: 45.77, east: 4.85 } });
  const satisfied = await applyViewGate(viewer, {
    fits: () => true, maxDeg: 0.08, duration: 0,
  });
  assert.equal(satisfied, true);
  assert.equal(viewer.state.flights.length, 0);
});

test('a gate that cannot be satisfied gives up instead of looping', async () => {
  const viewer = createViewer();
  const satisfied = await applyViewGate(viewer, {
    fits: () => false, maxDeg: 0.08, duration: 0,
  });
  assert.equal(satisfied, false);
  assert.equal(viewer.state.flights.length, 3, 'three tightening attempts, then the truth');
  assert.ok(viewer.state.flights[2].aglM < viewer.state.flights[0].aglM,
    'each retry aims lower than the last');
});

test('a flight someone else cancels is not fought over', async () => {
  const viewer = createViewer();
  viewer.state.cancelNext = true;
  const satisfied = await applyViewGate(viewer, {
    fits: () => false, maxDeg: 0.08, duration: 0,
  });
  assert.equal(satisfied, false);
  assert.equal(viewer.state.flights.length, 1, 'the gate stops at the first refusal');
});

test('an aborted enable stops the gate where it stands', async () => {
  const viewer = createViewer();
  const controller = new AbortController();
  controller.abort();
  const satisfied = await applyViewGate(viewer, {
    fits: () => false, maxDeg: 0.08, duration: 0, signal: controller.signal,
  });
  assert.equal(satisfied, false);
  assert.equal(viewer.state.flights.length, 0);
});

test('a viewer with no camera is a no-op, not a throw', async () => {
  assert.equal(await applyViewGate(null, { fits: () => false, maxDeg: 0.08 }), false);
  assert.equal(await applyViewGate({ camera: {} }, { maxDeg: 0.08 }), false);
});
