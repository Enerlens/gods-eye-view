// The globe-detail governor's contract: coarser imagery/terrain while the
// camera moves, EXACTLY the settled tolerance the moment it stops.
//
// Why this is worth pinning. The saving is real and large — measured on the
// shipped build, a four-second fly-to between French cities asked for a median
// 826 tile requests / 29 MB without the governor and 438 / 14.4 MB with it,
// ranges that do not overlap — but the whole trade rests on one invariant: a
// STILL frame is never coarser than it was. If a restore ever went missing, the
// app would quietly degrade into a blurrier globe and the numbers above would
// look even better, which is precisely the failure this file exists to catch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOVING_SSE_MULTIPLIER,
  getGlobeDetailDiagnostics,
  installGlobeDetailGovernor,
  uninstallGlobeDetailGovernor,
} from './globeDetailGovernor.js';

/** A viewer stub exposing only what the governor touches. */
function makeViewer({ sse = 2 } = {}) {
  const listeners = { start: [], end: [] };
  const evt = (bucket) => ({
    addEventListener(fn) {
      listeners[bucket].push(fn);
      return () => {
        const i = listeners[bucket].indexOf(fn);
        if (i >= 0) listeners[bucket].splice(i, 1);
      };
    },
  });
  return {
    scene: { globe: { maximumScreenSpaceError: sse } },
    camera: { moveStart: evt('start'), moveEnd: evt('end') },
    _fire: (bucket) => listeners[bucket].slice().forEach((fn) => fn()),
    _counts: () => ({ start: listeners.start.length, end: listeners.end.length }),
  };
}

test('a moving camera relaxes the tolerance, a settled one restores it exactly', () => {
  const viewer = makeViewer({ sse: 2 });
  try {
    installGlobeDetailGovernor(viewer);
    assert.equal(viewer.scene.globe.maximumScreenSpaceError, 2, 'installing must not change a still globe');

    viewer._fire('start');
    assert.equal(viewer.scene.globe.maximumScreenSpaceError, 2 * MOVING_SSE_MULTIPLIER);

    viewer._fire('end');
    assert.equal(
      viewer.scene.globe.maximumScreenSpaceError,
      2,
      'a settled globe must be exactly as sharp as it was before the move',
    );
  } finally {
    uninstallGlobeDetailGovernor();
  }
});

test('the settled value is captured, never assumed to be Cesium\'s default', () => {
  // A future quality control (or another module) may own this number. The
  // governor has to hand back what it found, not what it expected.
  const viewer = makeViewer({ sse: 5 });
  try {
    installGlobeDetailGovernor(viewer);
    viewer._fire('start');
    assert.equal(viewer.scene.globe.maximumScreenSpaceError, 5 * MOVING_SSE_MULTIPLIER);
    viewer._fire('end');
    assert.equal(viewer.scene.globe.maximumScreenSpaceError, 5);
  } finally {
    uninstallGlobeDetailGovernor();
  }
});

test('repeated moves never ratchet the tolerance upward', () => {
  // start→start→end must land on the settled value, not on 2× of 2× of it.
  const viewer = makeViewer({ sse: 2 });
  try {
    installGlobeDetailGovernor(viewer);
    viewer._fire('start');
    viewer._fire('start');
    viewer._fire('start');
    assert.equal(viewer.scene.globe.maximumScreenSpaceError, 2 * MOVING_SSE_MULTIPLIER);
    viewer._fire('end');
    assert.equal(viewer.scene.globe.maximumScreenSpaceError, 2);
  } finally {
    uninstallGlobeDetailGovernor();
  }
});

test('install is idempotent and uninstall leaves no listener behind', () => {
  const viewer = makeViewer();
  try {
    installGlobeDetailGovernor(viewer);
    installGlobeDetailGovernor(viewer);
    assert.deepEqual(viewer._counts(), { start: 1, end: 1 }, 'a second install must not double-subscribe');
    assert.equal(getGlobeDetailDiagnostics().installed, true);
  } finally {
    uninstallGlobeDetailGovernor();
  }
  assert.deepEqual(viewer._counts(), { start: 0, end: 0 });
  assert.equal(getGlobeDetailDiagnostics().installed, false);
  assert.equal(viewer.scene.globe.maximumScreenSpaceError, 2, 'uninstall restores the settled tolerance');
});

test('uninstalling mid-move still hands back a sharp globe', () => {
  const viewer = makeViewer({ sse: 2 });
  installGlobeDetailGovernor(viewer);
  viewer._fire('start');
  assert.equal(viewer.scene.globe.maximumScreenSpaceError, 4);
  uninstallGlobeDetailGovernor();
  assert.equal(
    viewer.scene.globe.maximumScreenSpaceError,
    2,
    'a teardown during a flight must not strand the coarse tolerance',
  );
});

test('a viewer without a globe or camera events is declined, not crashed on', () => {
  assert.doesNotThrow(() => installGlobeDetailGovernor(null));
  assert.doesNotThrow(() => installGlobeDetailGovernor({}));
  assert.doesNotThrow(() => installGlobeDetailGovernor({ scene: { globe: {} } }));
  assert.equal(getGlobeDetailDiagnostics().installed, false);
});
