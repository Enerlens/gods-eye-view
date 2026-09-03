// The contract for the ONE number twelve layers share.
//
// `camera.percentageChanged` is global to the Cesium camera, and the failure it
// used to produce was invisible in every unit test and obvious on screen:
// enable public transit once and every other viewport-driven layer re-fetches
// on the slightest nudge, for the rest of the session, whether transit is still
// on or not. The four cases below are exactly the ones a per-layer save/restore
// gets wrong.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VIEWPORT_CAMERA_SENSITIVITY,
  claimCameraSensitivity,
  releaseCameraSensitivity,
  getCameraSensitivityDiagnostics,
  _resetCameraSensitivityForTest,
} from './cameraSensitivity.js';

/** A viewer stub exposing only the one property this module touches. */
const makeViewer = (percentageChanged = 0.5) => ({ camera: { percentageChanged } });

test('one owner lowers the camera and hands the found value back', () => {
  _resetCameraSensitivityForTest();
  const viewer = makeViewer(0.5);

  claimCameraSensitivity(viewer, 'transit-fr');
  assert.equal(viewer.camera.percentageChanged, VIEWPORT_CAMERA_SENSITIVITY);
  assert.deepEqual(getCameraSensitivityDiagnostics().owners, ['transit-fr']);

  releaseCameraSensitivity(viewer, 'transit-fr');
  assert.equal(
    viewer.camera.percentageChanged,
    0.5,
    'the last release must restore what was there before the first claim',
  );
  assert.deepEqual(getCameraSensitivityDiagnostics().owners, []);
});

test('two owners: the first release holds the line, the last one restores', () => {
  // The case a per-layer save/restore cannot get right — layer B saves the
  // value layer A already lowered, then writes that stale value back as if it
  // were the baseline.
  _resetCameraSensitivityForTest();
  const viewer = makeViewer(0.5);

  claimCameraSensitivity(viewer, 'transit-fr');
  claimCameraSensitivity(viewer, 'irve-fr');
  assert.equal(viewer.camera.percentageChanged, VIEWPORT_CAMERA_SENSITIVITY);

  releaseCameraSensitivity(viewer, 'transit-fr');
  assert.equal(
    viewer.camera.percentageChanged,
    VIEWPORT_CAMERA_SENSITIVITY,
    'a layer that is still on must keep its sensitivity',
  );

  releaseCameraSensitivity(viewer, 'irve-fr');
  assert.equal(viewer.camera.percentageChanged, 0.5);
});

test('released out of order, the baseline still comes back', () => {
  _resetCameraSensitivityForTest();
  const viewer = makeViewer(0.5);

  claimCameraSensitivity(viewer, 'a');
  claimCameraSensitivity(viewer, 'b');
  claimCameraSensitivity(viewer, 'c');
  releaseCameraSensitivity(viewer, 'b');
  releaseCameraSensitivity(viewer, 'a');
  assert.equal(viewer.camera.percentageChanged, VIEWPORT_CAMERA_SENSITIVITY);
  releaseCameraSensitivity(viewer, 'c');
  assert.equal(viewer.camera.percentageChanged, 0.5);
});

test('the strictest live claim wins, and stops winning when it goes', () => {
  _resetCameraSensitivityForTest();
  const viewer = makeViewer(0.5);

  claimCameraSensitivity(viewer, 'coarse', 0.2);
  assert.equal(viewer.camera.percentageChanged, 0.2);
  claimCameraSensitivity(viewer, 'fine', 0.01);
  assert.equal(viewer.camera.percentageChanged, 0.01);

  releaseCameraSensitivity(viewer, 'fine');
  assert.equal(viewer.camera.percentageChanged, 0.2, 'the surviving claim owns the camera again');
  releaseCameraSensitivity(viewer, 'coarse');
  assert.equal(viewer.camera.percentageChanged, 0.5);
});

test('a claim never makes the camera LESS sensitive than it found it', () => {
  // Same one-way guarantee the old `Math.min(current, 0.05)` gave.
  _resetCameraSensitivityForTest();
  const viewer = makeViewer(0.02);

  claimCameraSensitivity(viewer, 'transit-fr');
  assert.equal(viewer.camera.percentageChanged, 0.02);
  releaseCameraSensitivity(viewer, 'transit-fr');
  assert.equal(viewer.camera.percentageChanged, 0.02);
});

test('double-claim and double-release cannot corrupt the number', () => {
  _resetCameraSensitivityForTest();
  const viewer = makeViewer(0.5);

  claimCameraSensitivity(viewer, 'transit-fr');
  claimCameraSensitivity(viewer, 'transit-fr');
  claimCameraSensitivity(viewer, 'transit-fr');
  assert.deepEqual(getCameraSensitivityDiagnostics().owners, ['transit-fr'], 'one owner, not three');

  releaseCameraSensitivity(viewer, 'transit-fr');
  assert.equal(viewer.camera.percentageChanged, 0.5);
  releaseCameraSensitivity(viewer, 'transit-fr');
  releaseCameraSensitivity(viewer, 'never-claimed');
  assert.equal(viewer.camera.percentageChanged, 0.5, 'a redundant release is a no-op, not a rewrite');
});

test('re-claiming with a new value replaces that owner\'s request', () => {
  _resetCameraSensitivityForTest();
  const viewer = makeViewer(0.5);

  claimCameraSensitivity(viewer, 'traffic', 0.01);
  assert.equal(viewer.camera.percentageChanged, 0.01);
  claimCameraSensitivity(viewer, 'traffic', 0.2);
  assert.equal(
    viewer.camera.percentageChanged,
    0.2,
    'the old request must not survive as a phantom claim',
  );
  releaseCameraSensitivity(viewer, 'traffic');
  assert.equal(viewer.camera.percentageChanged, 0.5);
});

test('a missing viewer, camera, owner or value is declined, not crashed on', () => {
  _resetCameraSensitivityForTest();
  assert.doesNotThrow(() => claimCameraSensitivity(null, 'x'));
  assert.doesNotThrow(() => claimCameraSensitivity({}, 'x'));
  assert.doesNotThrow(() => claimCameraSensitivity(makeViewer(), ''));
  assert.doesNotThrow(() => claimCameraSensitivity(makeViewer(), 'x', 0));
  assert.doesNotThrow(() => claimCameraSensitivity(makeViewer(), 'x', Number.NaN));
  assert.doesNotThrow(() => releaseCameraSensitivity(null, 'x'));
  assert.deepEqual(getCameraSensitivityDiagnostics().owners, [], 'nothing may be recorded');
});

test('a viewer swap drops the dead camera\'s claims instead of leaking them', () => {
  _resetCameraSensitivityForTest();
  const first = makeViewer(0.5);
  claimCameraSensitivity(first, 'transit-fr');

  const second = makeViewer(0.4);
  claimCameraSensitivity(second, 'irve-fr');
  assert.deepEqual(
    getCameraSensitivityDiagnostics().owners,
    ['irve-fr'],
    'claims against the previous camera are dead the moment it is replaced',
  );
  assert.equal(second.camera.percentageChanged, VIEWPORT_CAMERA_SENSITIVITY);

  releaseCameraSensitivity(second, 'irve-fr');
  assert.equal(second.camera.percentageChanged, 0.4, 'the NEW camera\'s baseline is what comes back');
});
