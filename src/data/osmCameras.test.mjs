// OSM mapped cameras — the pure tag→source mapping and viewport-box geometry
// behind the opt-in camera source. Three properties worth pinning: it must
// never invent a feed (OSM maps camera POSITIONS, never imagery), never
// overstate pose confidence (a `direction` tag often describes the mount, not
// the optics), and never ask upstream for more than one bounded viewport.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPublicOsmCamera,
  osmCameraBboxQuery,
  osmCameraBoxKey,
  osmCameraFromElement,
  osmCameraLabel,
  osmCameraPose,
  parseOsmDirection,
  parseOsmHeightM,
  snapOsmCameraBox,
  validOsmCameraBox,
  OSM_CAMERA_BOX_STEP_DEG,
  OSM_CAMERA_LICENSE,
  OSM_CAMERA_MAX_BOX_DEG,
  OSM_CAMERA_SOURCE_KIND,
} from './osmCameras.js';

/** A Paris-sized viewport box. */
const PARIS_BOX = { south: 48.8480, west: 2.3400, north: 48.8620, east: 2.3600 };

/** A minimal, valid Overpass node for the pack. */
function cameraNode(tags = {}, overrides = {}) {
  return {
    type: 'node',
    id: 1234,
    lat: 48.8584,
    lon: 2.2945,
    tags: { man_made: 'surveillance', surveillance: 'public', ...tags },
    ...overrides,
  };
}

test('parseOsmDirection accepts the three legal tag forms', () => {
  assert.equal(parseOsmDirection('135'), 135);
  assert.equal(parseOsmDirection('22.5'), 22.5);
  // Out-of-range and negative bearings normalize instead of being discarded.
  assert.equal(parseOsmDirection('370'), 10);
  assert.equal(parseOsmDirection('-90'), 270);
  // 16-point abbreviations — the form directionText.js does NOT cover.
  assert.equal(parseOsmDirection('N'), 0);
  assert.equal(parseOsmDirection('nne'), 22.5);
  assert.equal(parseOsmDirection('WSW'), 247.5);
  // Spelled-out cardinals fall through to the shared parser.
  assert.equal(parseOsmDirection('north'), 0);
  assert.equal(parseOsmDirection('southwest'), 225);
});

test('parseOsmDirection rejects way-relative and empty values', () => {
  // forward/backward are meaningless for a standalone camera node.
  assert.ok(Number.isNaN(parseOsmDirection('forward')));
  assert.ok(Number.isNaN(parseOsmDirection('backward')));
  assert.ok(Number.isNaN(parseOsmDirection('')));
  assert.ok(Number.isNaN(parseOsmDirection(undefined)));
  assert.ok(Number.isNaN(parseOsmDirection('up')));
});

test('parseOsmHeightM handles metric and imperial forms, rejects the rest', () => {
  assert.equal(parseOsmHeightM('4'), 4);
  assert.equal(parseOsmHeightM('4.5 m'), 4.5);
  assert.equal(parseOsmHeightM('6metres'), 6);
  assert.ok(Math.abs(parseOsmHeightM("12'") - 3.6576) < 1e-6);
  assert.ok(Math.abs(parseOsmHeightM(`12'6"`) - 3.81) < 1e-6);
  assert.ok(Number.isNaN(parseOsmHeightM('about 4')));
  assert.ok(Number.isNaN(parseOsmHeightM('4-6')));
  assert.ok(Number.isNaN(parseOsmHeightM('0')));
  assert.ok(Number.isNaN(parseOsmHeightM('900')), 'absurd height is dropped, not placed');
});

test('isPublicOsmCamera keeps public/outdoor/traffic cameras only', () => {
  for (const surveillance of ['public', 'outdoor', 'traffic']) {
    assert.ok(isPublicOsmCamera(cameraNode({ surveillance })), surveillance);
  }
  // Privacy-conservative exclusions: an untagged or indoor camera is never
  // presented as a public camera.
  assert.equal(isPublicOsmCamera(cameraNode({ surveillance: 'indoor' })), false);
  assert.equal(isPublicOsmCamera({ type: 'node', id: 1, tags: { man_made: 'surveillance' } }), false);
  assert.equal(isPublicOsmCamera(cameraNode({ indoor: 'yes' })), false);
  // Not a camera-with-a-view.
  assert.equal(isPublicOsmCamera(cameraNode({ 'surveillance:type': 'ALPR' })), false);
  assert.equal(isPublicOsmCamera(cameraNode({ 'surveillance:type': 'guard' })), false);
  assert.ok(isPublicOsmCamera(cameraNode({ 'surveillance:type': 'camera' })));
  // Not surveillance at all.
  assert.equal(isPublicOsmCamera(cameraNode({ man_made: 'mast' })), false);
  assert.equal(isPublicOsmCamera({ type: 'node', id: 1 }), false);
  assert.equal(isPublicOsmCamera(null), false);
});

test('pose confidence follows the tag that actually describes the optics', () => {
  const high = osmCameraPose({ 'camera:direction': '90', direction: '270' }, { fallbackHeadingDeg: 45 });
  assert.equal(high.headingDeg, 90, 'camera:direction wins over the generic tag');
  assert.equal(high.headingConfidence, 'high');

  const medium = osmCameraPose({ direction: 'SE' }, { fallbackHeadingDeg: 45 });
  assert.equal(medium.headingDeg, 135);
  assert.equal(medium.headingConfidence, 'medium', 'generic direction is not survey-grade');

  const low = osmCameraPose({}, { fallbackHeadingDeg: 202.5 });
  assert.equal(low.headingDeg, 202.5, 'falls back to the deterministic id-hash heading');
  assert.equal(low.headingConfidence, 'low');

  // An unparseable camera:direction must DEMOTE to the fallback, never promote.
  const unparseable = osmCameraPose({ 'camera:direction': 'forward' }, { fallbackHeadingDeg: 45 });
  assert.equal(unparseable.headingDeg, 45);
  assert.equal(unparseable.headingConfidence, 'low');

  // Live-sampled multi-direction tag: draw the first facing, but never claim
  // high confidence for a camera the mapper recorded as pointing two ways.
  const multi = osmCameraPose({ 'camera:direction': '270;170' }, { fallbackHeadingDeg: 45 });
  assert.equal(multi.headingDeg, 270);
  assert.equal(multi.headingConfidence, 'medium');
});

test('pose optics and mount height come from tags, with typed priors', () => {
  const dome = osmCameraPose({ 'camera:type': 'dome' });
  assert.equal(dome.fovDeg, 90);
  const panning = osmCameraPose({ 'camera:type': 'panning' });
  assert.ok(panning.rangeM >= 220, 'range never drops under the client range floor');
  const untyped = osmCameraPose({});
  assert.deepEqual(
    { fovDeg: untyped.fovDeg, rangeM: untyped.rangeM },
    { fovDeg: osmCameraPose({ 'camera:type': 'fixed' }).fovDeg, rangeM: osmCameraPose({ 'camera:type': 'fixed' }).rangeM },
    'an untyped camera uses the fixed-camera prior',
  );

  assert.equal(osmCameraPose({ height: '11 m' }).mountHeightM, 11, 'a tagged height wins');
  assert.equal(osmCameraPose({ 'camera:mount': 'mast' }).mountHeightM, 10);
  assert.equal(osmCameraPose({ 'camera:mount': 'wall' }).mountHeightM, 4);
  assert.equal(osmCameraPose({ 'camera:mount': 'unmapped-value' }).mountHeightM, 6);
  // A bad height falls back to the mount prior instead of placing the camera on it.
  assert.equal(osmCameraPose({ height: 'about 4', 'camera:mount': 'mast' }).mountHeightM, 10);

  // Higher mounts look further down.
  assert.ok(osmCameraPose({ height: '20 m' }).pitchDeg < osmCameraPose({ height: '10 m' }).pitchDeg);
  assert.ok(osmCameraPose({ height: '10 m' }).pitchDeg < osmCameraPose({ height: '4 m' }).pitchDeg);
});

test('mapped tilt and aperture beat the priors when OSM actually carries them', () => {
  // camera:angle is the mapped tilt from the horizon plane (OSM wiki) — it must
  // win over the mount-height guess, whichever sign the mapper used.
  assert.equal(osmCameraPose({ 'camera:angle': '30', height: '4 m' }).pitchDeg, -30);
  assert.equal(osmCameraPose({ 'camera:angle': '-30' }).pitchDeg, -30);
  // Clamped to the range the client will actually render.
  assert.equal(osmCameraPose({ 'camera:angle': '89' }).pitchDeg, -55);
  assert.equal(osmCameraPose({ 'camera:angle': '0' }).pitchDeg, -2);
  // Junk falls back to the mount-height prior instead of flattening the camera.
  assert.equal(osmCameraPose({ 'camera:angle': 'steep', height: '4 m' }).pitchDeg, -20);

  // camera:fov is rare but real; an out-of-range value falls back to the type prior.
  assert.equal(osmCameraPose({ 'camera:fov': '110', 'camera:type': 'fixed' }).fovDeg, 110);
  assert.equal(osmCameraPose({ 'camera:fov': '400', 'camera:type': 'fixed' }).fovDeg, 48);
});

test('osmCameraLabel degrades without ever faking an address', () => {
  assert.equal(osmCameraLabel({ name: 'Caméra Pont Neuf' }, 'n1'), 'Caméra Pont Neuf');
  assert.equal(osmCameraLabel({ operator: 'Ville de Paris' }, 'n1'), 'Ville de Paris camera');
  assert.equal(osmCameraLabel({ ref: 'CAM-42' }, 'n1'), 'Surveillance camera CAM-42');
  assert.equal(osmCameraLabel({}, 'n1234'), 'Surveillance camera n1234');
});

test('a mapped camera carries NO feed and states its provenance', () => {
  const camera = osmCameraFromElement(
    cameraNode({ 'camera:direction': '210', 'camera:type': 'dome', operator: 'Ville de Paris' }),
    { fallbackHeading: () => 0, city: 'Paris', cityId: 'paris' },
  );

  assert.equal(camera.id, 'osm-n1234');
  assert.equal(camera.url, '', 'OSM maps positions, never imagery — no feed may be invented');
  assert.equal(camera.snapshotUrl, '');
  assert.equal(camera.feedType, 'image');
  assert.equal(camera.sourceKind, OSM_CAMERA_SOURCE_KIND);
  assert.equal(camera.license, OSM_CAMERA_LICENSE);
  assert.match(camera.provider, /Ville de Paris/);
  assert.equal(camera.city, 'Paris');
  assert.equal(camera.cityId, 'paris');
  assert.equal(camera.headingDeg, 210);
  assert.equal(camera.headingConfidence, 'high');
  // No invented locality datum: the layer's Re:Earth ground prior owns this.
  assert.equal(camera.groundElevationM, 0);
  // Never curated: these poses stay RAW PRIOR in the CAL badge.
  assert.equal(camera.poseSource, undefined);
  // Every field the /api/cctv/sources payload publishes must be present.
  for (const key of [
    'id', 'name', 'city', 'cityId', 'provider', 'lat', 'lon', 'headingDeg',
    'headingConfidence', 'pitchDeg', 'fovDeg', 'rangeM', 'mountHeightM',
    'groundElevationM', 'feedType', 'url', 'snapshotUrl', 'sourceKind', 'license',
  ]) {
    assert.ok(key in camera, `missing source field: ${key}`);
  }
});

test('element mapping rejects anything it cannot place honestly', () => {
  assert.equal(osmCameraFromElement(cameraNode({}, { lat: undefined, lon: undefined })), null);
  assert.equal(osmCameraFromElement(cameraNode({ indoor: 'yes' })), null);
  assert.equal(osmCameraFromElement(cameraNode({}, { id: 'not-a-number' })), null);
  assert.equal(osmCameraFromElement({ type: 'node', id: 1 }), null);
  // A way/relation is accepted only through its computed centre.
  const way = osmCameraFromElement(
    cameraNode({}, { type: 'way', id: 77, lat: undefined, lon: undefined, center: { lat: 48.85, lon: 2.29 } }),
  );
  assert.equal(way.id, 'osm-w77');
  assert.equal(way.lat, 48.85);
});

test('the Overpass probe stays bounded, capped and time-limited', () => {
  const ql = osmCameraBboxQuery(PARIS_BOX);
  assert.match(ql, /^\[out:json\]\[timeout:\d+\];/);
  assert.match(ql, /\(48\.848000,2\.340000,48\.862000,2\.360000\);/, 'one bounded bbox');
  assert.match(ql, /out body \d+;$/, 'nodes need coordinates (body, not tags) and a hard cap');
  assert.ok(!/\barea\b|\bpoly\s*:|around:/.test(ql), 'never an area, polygon, or radius scan');
  assert.match(ql, /"surveillance:type"!~/, 'ALPR/guard posts are filtered upstream');
  // Caps are clamped at the builder, not trusted from config.
  assert.match(osmCameraBboxQuery(PARIS_BOX, { elementCap: 99999 }), /out body 1000;$/);
  assert.match(osmCameraBboxQuery(PARIS_BOX, { timeoutSec: 900 }), /\[timeout:30\]/);
});

test('the request box is snapped OUTWARD so neighbouring views share one answer', () => {
  const snapped = snapOsmCameraBox(PARIS_BOX);
  // Outward on every edge: the cached answer always covers what was asked for.
  assert.ok(snapped.south <= PARIS_BOX.south, 'south grew');
  assert.ok(snapped.west <= PARIS_BOX.west, 'west grew');
  assert.ok(snapped.north >= PARIS_BOX.north, 'north grew');
  assert.ok(snapped.east >= PARIS_BOX.east, 'east grew');
  // On the grid.
  for (const value of Object.values(snapped)) {
    assert.ok(Math.abs(value / OSM_CAMERA_BOX_STEP_DEG - Math.round(value / OSM_CAMERA_BOX_STEP_DEG)) < 1e-6);
  }
  // The point of the snap: a pan that stays inside the same grid cell lands on
  // the SAME key, so it is answered from cache with no upstream request.
  const panned = { south: 48.8490, west: 2.3450, north: 48.8610, east: 2.3550 };
  assert.equal(osmCameraBoxKey(snapOsmCameraBox(panned)), osmCameraBoxKey(snapped));
  // A real move to the next cell does not.
  const moved = { south: 48.88, west: 2.40, north: 48.90, east: 2.42 };
  assert.notEqual(osmCameraBoxKey(snapOsmCameraBox(moved)), osmCameraBoxKey(snapped));
  // A value already exactly on a grid line must not jump a whole cell.
  const exact = snapOsmCameraBox({ south: 48.84, west: 2.34, north: 48.86, east: 2.36 });
  assert.deepEqual(exact, { south: 48.84, west: 2.34, north: 48.86, east: 2.36 });
});

test('box validation refuses everything that is not one bounded viewport', () => {
  assert.deepEqual(validOsmCameraBox(PARIS_BOX), PARIS_BOX);
  // String params (they arrive from a query string) are accepted.
  assert.deepEqual(
    validOsmCameraBox({ south: '48.848', west: '2.34', north: '48.862', east: '2.36' }),
    { south: 48.848, west: 2.34, north: 48.862, east: 2.36 },
  );
  assert.equal(validOsmCameraBox(null), null);
  assert.equal(validOsmCameraBox({ south: 1, west: 2, north: 'x', east: 4 }), null, 'non-finite');
  assert.equal(validOsmCameraBox({ south: 48.9, west: 2.3, north: 48.8, east: 2.4 }), null, 'inverted');
  assert.equal(validOsmCameraBox({ south: 48.8, west: 2.4, north: 48.9, east: 2.3 }), null, 'dateline/inverted');
  assert.equal(
    validOsmCameraBox({ south: 0, west: 0, north: OSM_CAMERA_MAX_BOX_DEG + 0.1, east: 1 }),
    null,
    'a continental view is refused rather than truncated arbitrarily',
  );
  assert.equal(validOsmCameraBox({ south: -91, west: 0, north: 0, east: 1 }), null, 'off-globe');
});
