// The contract for the arrival event eleven viewport layers share.
//
// The bug it exists for is invisible to every other test in this repo, because
// it is a bug about an event that does NOT fire: `camera.changed` goes quiet
// before an eased flight lands, so the last load a flight triggers describes a
// camera still in the air, and nothing re-reads the view it settles on. Arrive
// somewhere by voice and the layer keeps explaining the city you left.
//
// The cases below are the four a naive `moveEnd.addEventListener(reload)`
// gets wrong: the pan that must stay free, the arrival that must not, the
// double-enable, and the teardown.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  viewportRestKey,
  markViewportRead,
  watchCameraSettle,
  releaseCameraSettle,
  getCameraSettleDiagnostics,
  _resetCameraSettleForTest,
} from './cameraSettle.js';

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/**
 * A camera stub exposing only what this module touches: a view rectangle in
 * radians and a `moveEnd` event that can be raised by hand.
 */
function makeViewer(box = { south: 48.8, west: 2.2, north: 48.9, east: 2.4 }) {
  const listeners = new Set();
  const viewer = {
    rectangle: box,
    camera: {
      computeViewRectangle: () => (viewer.rectangle ? {
        south: toRadians(viewer.rectangle.south),
        west: toRadians(viewer.rectangle.west),
        north: toRadians(viewer.rectangle.north),
        east: toRadians(viewer.rectangle.east),
      } : undefined),
      moveEnd: {
        addEventListener(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      },
    },
    /** Move the camera as a flight would, WITHOUT raising `camera.changed`. */
    flyTo(next) { viewer.rectangle = next; },
    settle() { for (const fn of [...listeners]) fn(); },
    listenerCount: () => listeners.size,
  };
  return viewer;
}

const PARIS = { south: 48.8, west: 2.2, north: 48.9, east: 2.4 };
const ROUEN = { south: 49.4, west: 1.0, north: 49.5, east: 1.2 };

test('the view a flight lands on is re-read, even with no `camera.changed`', () => {
  _resetCameraSettleForTest();
  const viewer = makeViewer(PARIS);
  let reloads = 0;

  watchCameraSettle(viewer, 'irve-fr', () => { reloads += 1; });
  // The mid-flight load: issued while the camera was still over Paris, which
  // is the only load an eased flight ever triggers.
  markViewportRead(viewer, 'irve-fr');
  viewer.flyTo(ROUEN);

  viewer.settle();
  assert.equal(reloads, 1, 'arrival over Rouen re-reads');
  releaseCameraSettle(viewer, 'irve-fr');
});

test('a rest on the view already read costs nothing', () => {
  _resetCameraSettleForTest();
  const viewer = makeViewer(PARIS);
  let reloads = 0;

  watchCameraSettle(viewer, 'irve-fr', () => { reloads += 1; });
  markViewportRead(viewer, 'irve-fr');

  viewer.settle();
  viewer.settle();
  assert.equal(reloads, 0, 'the layer already answered for this view');

  // A pan of less than the key's own precision — 0.001° is ~111 m, the width
  // at which every viewport layer compares its request box — is the same
  // question, and asking it again is what makes a map reload forever.
  viewer.flyTo({ ...PARIS, west: PARIS.west + 0.0002, east: PARIS.east + 0.0002 });
  viewer.settle();
  assert.equal(reloads, 0, 'a sub-precision nudge is the same view');

  viewer.flyTo({ ...PARIS, west: PARIS.west + 0.02, east: PARIS.east + 0.02 });
  viewer.settle();
  assert.equal(reloads, 1, 'a real pan is a new view');
  releaseCameraSettle(viewer, 'irve-fr');
});

test('a load that never marked its view leaves the next arrival free to ask', () => {
  _resetCameraSettleForTest();
  const viewer = makeViewer(PARIS);
  let reloads = 0;

  // No `markViewportRead` at all — the layer was enabled and has read nothing.
  watchCameraSettle(viewer, 'schools-fr', () => { reloads += 1; });
  viewer.settle();
  assert.equal(reloads, 1, 'never having read is not the same as having read this');
  releaseCameraSettle(viewer, 'schools-fr');
});

test('watching twice does not reload twice per arrival', () => {
  _resetCameraSettleForTest();
  const viewer = makeViewer(PARIS);
  let reloads = 0;
  const reload = () => { reloads += 1; };

  // A layer re-enabled without a matching disable — `lazyLayer` replays
  // buffered calls, and a stacked listener would double every request.
  watchCameraSettle(viewer, 'anfr-fr', reload);
  watchCameraSettle(viewer, 'anfr-fr', reload);
  assert.equal(viewer.listenerCount(), 1);
  assert.deepEqual(getCameraSettleDiagnostics().owners, ['anfr-fr']);

  viewer.flyTo(ROUEN);
  viewer.settle();
  assert.equal(reloads, 1);
  releaseCameraSettle(viewer, 'anfr-fr');
});

test('release detaches, and a disabled layer is never asked to reload', () => {
  _resetCameraSettleForTest();
  const viewer = makeViewer(PARIS);
  let reloads = 0;

  watchCameraSettle(viewer, 'traffic', () => { reloads += 1; });
  releaseCameraSettle(viewer, 'traffic');
  assert.equal(viewer.listenerCount(), 0);
  assert.deepEqual(getCameraSettleDiagnostics().owners, []);

  viewer.flyTo(ROUEN);
  viewer.settle();
  assert.equal(reloads, 0);

  // Releasing what was never watched, and releasing twice, are both no-ops:
  // teardown paths run on viewers this owner may never have claimed.
  releaseCameraSettle(viewer, 'traffic');
  releaseCameraSettle(viewer, 'never-watched');
});

test('a reload that throws does not silence the layers queued behind it', () => {
  _resetCameraSettleForTest();
  const viewer = makeViewer(PARIS);
  let reachedSecondLayer = false;

  watchCameraSettle(viewer, 'first', () => { throw new Error('boom'); });
  watchCameraSettle(viewer, 'second', () => { reachedSecondLayer = true; });

  viewer.flyTo(ROUEN);
  viewer.settle();
  assert.equal(reachedSecondLayer, true, 'one layer falling over is not eleven');
  releaseCameraSettle(viewer, 'first');
  releaseCameraSettle(viewer, 'second');
});

test('a camera seeing no rectangle has a key, and it is stable', () => {
  _resetCameraSettleForTest();
  const viewer = makeViewer(PARIS);
  let reloads = 0;

  watchCameraSettle(viewer, 'marine-buoys', () => { reloads += 1; });
  // Deep space, or a limb view Cesium cannot bound: `computeViewRectangle`
  // returns undefined, and two such poses must not read as different views.
  viewer.rectangle = null;
  assert.equal(viewportRestKey(viewer), '');
  markViewportRead(viewer, 'marine-buoys');
  viewer.settle();
  assert.equal(reloads, 0);

  viewer.rectangle = ROUEN;
  viewer.settle();
  assert.equal(reloads, 1, 'coming back to a bounded view is a new view');
  releaseCameraSettle(viewer, 'marine-buoys');
});

test('marking an owner nobody watches is a no-op, not a leak', () => {
  _resetCameraSettleForTest();
  const viewer = makeViewer(PARIS);
  // A layer whose `loadViewport` runs while disabled — the poll fires once
  // more after `disable()` on several of these layers.
  markViewportRead(viewer, 'sup-fr');
  assert.deepEqual(getCameraSettleDiagnostics().owners, []);
});

// ── The coverage guard ───────────────────────────────────────────────────────
//
// The bug this module fixes was found in ONE layer and was present in every
// other viewport-driven layer, and nothing in the code said so: each wired
// `camera.changed` by hand and each was silently missing the other half. A
// comment in `gevActions.js` even asserted the opposite — "these layers scan on a debounced `moveEnd`" — and
// was simply wrong for every one of them. A guard is the only thing that keeps
// the NEXT layer from re-opening it.
//
// The rule is derived rather than listed: claiming `camera.percentageChanged`
// is what MAKES a layer viewport-driven, so every claimant owes an arrival.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_ROOT = fileURLToPath(new URL('.', import.meta.url));

/**
 * Layers that answer arrival with their own listener instead of this module.
 *
 * NOT a suppression: the assertion below re-earns each entry on every run by
 * checking the module really does subscribe to `camera.moveEnd`, so the day
 * one stops, the guard bites again with no edit here.
 */
const OWN_ARRIVAL_WATCH = new Map([
  ['transitFrance.js', 'carries `_verdictBox` + `onCameraSettled`, which track the VERDICT rather '
    + 'than the read so an aborted load re-asks, and pair with its own retry backoff'],
]);

test('every viewport-driven layer answers the camera coming to rest', () => {
  const missing = [];
  const claimants = [];
  for (const name of readdirSync(DATA_ROOT).sort()) {
    if (!name.endsWith('.js')) continue;
    const source = readFileSync(path.join(DATA_ROOT, name), 'utf8');
    // Importing the claim, not merely naming it — `cameraSensitivity.js`
    // itself would otherwise answer to its own rule.
    if (!/import \{[^}]*claimCameraSensitivity[^}]*\} from '\.\/cameraSensitivity\.js'/s.test(source)) continue;
    claimants.push(name);
    if (OWN_ARRIVAL_WATCH.has(name)) {
      assert.match(source, /camera\.moveEnd\.addEventListener/,
        `${name} is exempt because it ${OWN_ARRIVAL_WATCH.get(name)} — and it no longer does`);
      continue;
    }
    for (const call of ['watchCameraSettle(', 'releaseCameraSettle(', 'markViewportRead(']) {
      if (!source.includes(call)) missing.push(`${name} never calls ${call})`);
    }
  }
  assert.deepEqual(missing, [], missing.join('\n'));
  // Pinned so that ADDING a claimant is a decision, not an accident: a new
  // viewport layer lands here first and has to say it thought about arrival.
  assert.equal(claimants.length, 12, `viewport-driven layers: ${claimants.join(', ')}`);
});
