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
  MOVING_RESOLUTION_SCALE,
  MOVING_SSE_MULTIPLIER,
  STALL_GUARD_MS,
  getGlobeDetailDiagnostics,
  installGlobeDetailGovernor,
  setMovingResolutionScale,
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
  // The stall guard reads raw pose components, so the stub carries a real one.
  const camera = {
    moveStart: evt('start'),
    moveEnd: evt('end'),
    position: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: -1 },
  };
  return {
    scene: { globe: { maximumScreenSpaceError: sse } },
    camera,
    // The `lite` profile's second motion trade rides on the same events, so
    // the stub has to carry the property it moves.
    resolutionScale: 1,
    _fire: (bucket) => listeners[bucket].slice().forEach((fn) => fn()),
    _counts: () => ({ start: listeners.start.length, end: listeners.end.length }),
    _moveTo: (x) => { camera.position.x = x; },
    // Cesium raises `moveStart` from a camera comparison that INCLUDES the
    // frustum, so resizing the drawing buffer looks like a move. This replays
    // that: an event with no change to position or direction.
    _echo: () => listeners.start.slice().forEach((fn) => fn()),
  };
}

const tick = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

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

test('a move that never ends is not a session-long blur', async () => {
  // The field report: "it goes to a less sharp version" and stays there. Every
  // path that cancels a flight (share-link restore calls camera.cancelFlight())
  // fires moveStart without ever firing moveEnd.
  const viewer = makeViewer({ sse: 2 });
  try {
    installGlobeDetailGovernor(viewer, { stallGuardMs: 20 });
    viewer._fire('start');
    assert.equal(viewer.scene.globe.maximumScreenSpaceError, 4);
    assert.equal(getGlobeDetailDiagnostics().stallGuardArmed, true);

    // No moveEnd, ever. Two guard intervals: the first samples, the second
    // finds the pose unchanged.
    await tick(70);
    assert.equal(
      viewer.scene.globe.maximumScreenSpaceError,
      2,
      'a stalled move must hand the sharp globe back on its own',
    );
    const diagnostics = getGlobeDetailDiagnostics();
    assert.equal(diagnostics.relaxed, false);
    assert.equal(diagnostics.stallGuardArmed, false, 'the poll stops once it has fired');
    assert.equal(diagnostics.stallRecoveries, 1);

    // The moveEnd that never came, arriving anyway, must be harmless.
    viewer._fire('end');
    assert.equal(viewer.scene.globe.maximumScreenSpaceError, 2);
  } finally {
    uninstallGlobeDetailGovernor();
  }
});

test('a long move that is really moving keeps its saving', async () => {
  // The intro fly-to is four seconds and an orbit runs for minutes; neither may
  // be cut short by the guard. This is why the guard reads the pose instead of
  // counting milliseconds since moveStart.
  const viewer = makeViewer({ sse: 2 });
  try {
    installGlobeDetailGovernor(viewer, { stallGuardMs: 20 });
    viewer._fire('start');
    for (let step = 1; step <= 6; step += 1) {
      viewer._moveTo(step * 1000);
      // eslint-disable-next-line no-await-in-loop
      await tick(15);
      assert.equal(
        viewer.scene.globe.maximumScreenSpaceError,
        4,
        'a camera that is still moving must stay coarse',
      );
    }
    assert.equal(getGlobeDetailDiagnostics().stallRecoveries, 0);

    viewer._fire('end');
    assert.equal(viewer.scene.globe.maximumScreenSpaceError, 2);
  } finally {
    uninstallGlobeDetailGovernor();
  }
});

test('the guard is disarmed by moveEnd and by uninstall, never left polling', async () => {
  const viewer = makeViewer({ sse: 2 });
  installGlobeDetailGovernor(viewer, { stallGuardMs: 20 });
  viewer._fire('start');
  viewer._fire('end');
  assert.equal(getGlobeDetailDiagnostics().stallGuardArmed, false);

  viewer._fire('start');
  assert.equal(getGlobeDetailDiagnostics().stallGuardArmed, true);
  uninstallGlobeDetailGovernor();
  assert.equal(getGlobeDetailDiagnostics().stallGuardArmed, false);
  await tick(70);
  assert.equal(viewer.scene.globe.maximumScreenSpaceError, 2, 'a torn-down governor polls nothing');
});

test('the shipped guard interval is the one the module documents', () => {
  // Pinned because a wrong value here is invisible in every other test: too
  // short and it fights real motion, too long and the blur outlives the reader's
  // patience — which is the bug this whole guard exists for.
  assert.equal(STALL_GUARD_MS, 2000);
});

// ── The `lite` profile's second motion trade: pixels ────────────────────────
//
// Same events, same stall guard, same idempotent restore — and the same
// failure it exists to prevent, one level worse. A tolerance left relaxed is a
// soft globe; a resolution left at 0.8 is a soft EVERYTHING, chrome and labels
// included, for the rest of the session.

test('lite trades pixels only while the camera moves, and hands them all back', () => {
  const viewer = makeViewer({ sse: 2 });
  try {
    installGlobeDetailGovernor(viewer, { movingResolutionScale: MOVING_RESOLUTION_SCALE });
    assert.equal(viewer.resolutionScale, 1, 'installing must not change a still frame');

    viewer._fire('start');
    assert.equal(viewer.resolutionScale, MOVING_RESOLUTION_SCALE);

    viewer._fire('end');
    assert.equal(viewer.resolutionScale, 1, 'a settled frame is exactly as sharp as it was');
  } finally {
    uninstallGlobeDetailGovernor();
  }
});

test('full never touches resolutionScale at all', () => {
  const viewer = makeViewer({ sse: 2 });
  try {
    installGlobeDetailGovernor(viewer);
    viewer._fire('start');
    assert.equal(viewer.resolutionScale, 1);
    assert.equal(getGlobeDetailDiagnostics().movingResolutionScale, null);
    viewer._fire('end');
    assert.equal(viewer.resolutionScale, 1);
  } finally {
    uninstallGlobeDetailGovernor();
  }
});

test('a second moveStart inside one gesture does not ratchet the resolution down', () => {
  // A wheel event during a drag, or a fly-to that re-triggers, fires moveStart
  // again without an intervening moveEnd. Capturing the settled scale on that
  // second event would bank 0.8 as "settled" and leave the app at 0.64, then
  // 0.512 — the exact shape of the tolerance bug this file already pins.
  const viewer = makeViewer({ sse: 2 });
  try {
    installGlobeDetailGovernor(viewer, { movingResolutionScale: 0.8 });
    viewer._fire('start');
    viewer._fire('start');
    viewer._fire('start');
    assert.equal(viewer.resolutionScale, 0.8);
    viewer._fire('end');
    assert.equal(viewer.resolutionScale, 1);
  } finally {
    uninstallGlobeDetailGovernor();
  }
});

test('an out-of-range factor is declined rather than applied', () => {
  for (const bad of [0, 1, 1.5, -0.5, Number.NaN, null, 'small']) {
    const viewer = makeViewer({ sse: 2 });
    try {
      installGlobeDetailGovernor(viewer, { movingResolutionScale: bad });
      viewer._fire('start');
      assert.equal(viewer.resolutionScale, 1, `factor ${String(bad)} must be ignored`);
    } finally {
      uninstallGlobeDetailGovernor();
    }
  }
});

test('the stall guard hands back pixels as well as sharpness', async () => {
  const viewer = makeViewer({ sse: 2 });
  try {
    installGlobeDetailGovernor(viewer, { movingResolutionScale: 0.8, stallGuardMs: 20 });
    viewer._fire('start');
    assert.equal(viewer.resolutionScale, 0.8);
    // A cancelled flight: moveStart, no moveEnd, and a pose that stops moving.
    await tick(60);
    assert.equal(viewer.resolutionScale, 1, 'a move that never ends is not a session-long blur');
    assert.equal(viewer.scene.globe.maximumScreenSpaceError, 2);
    assert.ok(getGlobeDetailDiagnostics().stallRecoveries >= 1);
  } finally {
    uninstallGlobeDetailGovernor();
  }
});

test('uninstalling mid-move hands back the resolution too', () => {
  const viewer = makeViewer({ sse: 2 });
  installGlobeDetailGovernor(viewer, { movingResolutionScale: 0.8 });
  viewer._fire('start');
  assert.equal(viewer.resolutionScale, 0.8);
  uninstallGlobeDetailGovernor();
  assert.equal(viewer.resolutionScale, 1);
});

test('switching the profile off mid-move gives the pixels back immediately', () => {
  // The DISPLAY-rail switch must not look like it did nothing until the camera
  // happens to stop.
  const viewer = makeViewer({ sse: 2 });
  try {
    installGlobeDetailGovernor(viewer, { movingResolutionScale: 0.8 });
    viewer._fire('start');
    assert.equal(viewer.resolutionScale, 0.8);
    setMovingResolutionScale(null);
    assert.equal(viewer.resolutionScale, 1);
    // And the move that is still in progress must not re-apply it on its end.
    viewer._fire('end');
    assert.equal(viewer.resolutionScale, 1);
  } finally {
    uninstallGlobeDetailGovernor();
  }
});

test('switching the profile on mid-session applies from the next move', () => {
  const viewer = makeViewer({ sse: 2 });
  try {
    installGlobeDetailGovernor(viewer);
    setMovingResolutionScale(0.8);
    viewer._fire('start');
    assert.equal(viewer.resolutionScale, 0.8);
    viewer._fire('end');
    assert.equal(viewer.resolutionScale, 1);
  } finally {
    uninstallGlobeDetailGovernor();
  }
});

test('the operator can change the settled resolution and keep it across a move', () => {
  // `resolutionScale` is captured per move, not at install: a device-pixel-ratio
  // change or a future quality control owns the settled value, and the governor
  // hands back whatever it found rather than an install-time snapshot.
  const viewer = makeViewer({ sse: 2 });
  try {
    installGlobeDetailGovernor(viewer, { movingResolutionScale: 0.5 });
    viewer.resolutionScale = 2;
    viewer._fire('start');
    assert.equal(viewer.resolutionScale, 1);
    viewer._fire('end');
    assert.equal(viewer.resolutionScale, 2);
  } finally {
    uninstallGlobeDetailGovernor();
  }
});

// ── The echo ────────────────────────────────────────────────────────────────
//
// Reproduces the loop measured on the shipped build on 2026-09-09: `moveEnd`
// restores the resolution, the restore changes `frustum.aspectRatio` by a
// rounding error, Cesium reads that as a camera move and raises `moveStart`,
// and the governor drops the resolution again. 535 ms of "motion" and 16 ms of
// rest, forever, on a camera nobody was touching.

test('a move that changed no pose is the governor hearing itself, and is ignored', () => {
  const viewer = makeViewer({ sse: 2 });
  try {
    installGlobeDetailGovernor(viewer, { movingResolutionScale: 0.8 });
    viewer._fire('start');
    viewer._fire('end');
    assert.equal(viewer.resolutionScale, 1);
    assert.equal(viewer.scene.globe.maximumScreenSpaceError, 2);

    // The restore's own aspect-ratio change comes back as a moveStart.
    viewer._echo();
    assert.equal(viewer.resolutionScale, 1, 'the echo must not re-drop the resolution');
    assert.equal(viewer.scene.globe.maximumScreenSpaceError, 2, 'nor re-relax the globe');
    assert.equal(getGlobeDetailDiagnostics().echoesIgnored, 1);
    assert.equal(getGlobeDetailDiagnostics().stallGuardArmed, false, 'and must not arm a guard');

    // A REAL move — the pose changes — is still honoured.
    viewer._moveTo(1234);
    viewer._fire('start');
    assert.equal(viewer.resolutionScale, 0.8);
    assert.equal(viewer.scene.globe.maximumScreenSpaceError, 4);
    viewer._fire('end');
    assert.equal(viewer.resolutionScale, 1);
  } finally {
    uninstallGlobeDetailGovernor();
  }
});

test('the echo guard is armed only when a resolution trade is', () => {
  // In `full` nothing resizes the drawing buffer, so there is no echo to
  // recognise — and swallowing a frustum-only move there would be a silent
  // behaviour change to a governor that has shipped for weeks.
  const viewer = makeViewer({ sse: 2 });
  try {
    installGlobeDetailGovernor(viewer);
    viewer._fire('start');
    viewer._fire('end');
    viewer._echo();
    assert.equal(viewer.scene.globe.maximumScreenSpaceError, 4, 'full still relaxes on any move');
    assert.equal(getGlobeDetailDiagnostics().echoesIgnored, 0);
  } finally {
    uninstallGlobeDetailGovernor();
  }
});

test('turning the trade off releases the echo guard with it', () => {
  const viewer = makeViewer({ sse: 2 });
  try {
    installGlobeDetailGovernor(viewer, { movingResolutionScale: 0.8 });
    viewer._fire('start');
    viewer._fire('end');
    setMovingResolutionScale(null);
    viewer._echo();
    assert.equal(viewer.scene.globe.maximumScreenSpaceError, 4,
      'back in full, a frustum-only move relaxes again');
  } finally {
    uninstallGlobeDetailGovernor();
  }
});
