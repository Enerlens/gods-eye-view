// The render profile's contract. Two things make this worth pinning beyond
// "it returns a string":
//
//   1. ORDER OF AUTHORITY. `?perf=` beats a stored choice beats a stored
//      measurement beats hardware sniffing. Any reshuffle silently takes the
//      profile out of the operator's hands, and the symptom — "the app decided
//      I was small" — is invisible in a screenshot.
//   2. THE MEASURED VERDICT MUST NOT OVERRULE A PERSON. The frame probe runs
//      seconds after boot, long after anyone has clicked anything, so an
//      unguarded verdict would undo a deliberate `full` on exactly the machine
//      where somebody bothered to ask for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAME_GAP_CEILING_MS,
  FRAME_P90_FULL_MS,
  FRAME_P90_LITE_MS,
  PERF_MEASURED_STORAGE_KEY,
  PERF_PROFILE_STORAGE_KEY,
  decidePerfProfile,
  frameP90,
  getPerfProfile,
  getPerfProfileDiagnostics,
  initPerfProfile,
  isLiteProfile,
  LITE_BUDGET_SHARE,
  observeFrameProfile,
  onPerfProfileChange,
  profileCellPx,
  profileCountBudget,
  readPerfSignals,
  resetPerfProfileForTests,
  setPerfProfile,
  verdictFromFrames,
} from './perfProfile.js';

/** Signals with everything absent, so each test names only what it is about. */
function signals(overrides = {}) {
  return {
    cores: 8, memoryGB: 8, renderer: 'ANGLE (Apple, Metal)',
    reducedMotion: false, stored: null, measured: null, forced: null,
    ...overrides,
  };
}

/** A localStorage stub that records writes and can be told to throw. */
function installStorage({ throws = false, initial = {} } = {}) {
  const store = new Map(Object.entries(initial));
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem(k) { if (throws) throw new Error('denied'); return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { if (throws) throw new Error('denied'); store.set(k, String(v)); },
  };
  return { store, restore() { globalThis.localStorage = previous; } };
}

/** A postRender event stub that lets a test drive frames by hand. */
function makeViewer() {
  const listeners = [];
  return {
    scene: {
      postRender: {
        addEventListener(fn) {
          listeners.push(fn);
          return () => {
            const i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
          };
        },
      },
    },
    listeners,
    tick() { for (const fn of [...listeners]) fn(); },
  };
}

test('order of authority: url beats stored beats measured beats hardware', () => {
  assert.deepEqual(
    decidePerfProfile(signals({ forced: 'full', stored: 'lite', measured: 'lite', cores: 2 })),
    { profile: 'full', source: 'url' },
  );
  assert.deepEqual(
    decidePerfProfile(signals({ stored: 'full', measured: 'lite', cores: 2 })),
    { profile: 'full', source: 'stored' },
  );
  assert.deepEqual(
    decidePerfProfile(signals({ measured: 'lite', cores: 16 })),
    { profile: 'lite', source: 'measured' },
  );
});

test('each hardware signal alone is enough for lite, and a healthy machine is full', () => {
  assert.equal(decidePerfProfile(signals({ cores: 4 })).source, 'cores');
  assert.equal(decidePerfProfile(signals({ cores: 8, memoryGB: 4 })).source, 'memory');
  assert.equal(decidePerfProfile(signals({ renderer: 'Intel(R) UHD Graphics 620' })).source, 'gpu');
  assert.equal(decidePerfProfile(signals({ renderer: 'Google SwiftShader' })).source, 'gpu');
  assert.equal(decidePerfProfile(signals({ renderer: 'Mali-G72' })).source, 'gpu');
  assert.equal(decidePerfProfile(signals({ reducedMotion: true })).source, 'reduced-motion');
  assert.deepEqual(decidePerfProfile(signals()), { profile: 'full', source: 'default' });
});

test('an Apple or NVIDIA renderer is not mistaken for an integrated Intel part', () => {
  // `Iris` matches, `Apple M5` must not, and neither must a discrete card whose
  // name merely contains the word "Intel" as a vendor prefix would.
  assert.equal(decidePerfProfile(signals({ renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M5)' })).profile, 'full');
  assert.equal(decidePerfProfile(signals({ renderer: 'NVIDIA GeForce RTX 4070' })).profile, 'full');
  assert.equal(decidePerfProfile(signals({ renderer: 'Intel(R) Iris(R) Xe Graphics' })).profile, 'lite');
});

test('missing signals never force lite — an unknown machine is a full machine', () => {
  // `deviceMemory` and `hardwareConcurrency` are absent in Safari and Firefox.
  // Treating absence as smallness would put every Firefox reader in lite.
  assert.equal(decidePerfProfile(signals({ cores: null, memoryGB: null, renderer: '' })).profile, 'full');
});

test('readPerfSignals only honours a profile name it recognises', () => {
  const storage = installStorage();
  try {
    assert.equal(readPerfSignals({ nav: {}, search: '?perf=lite', documentRef: null }).forced, 'lite');
    assert.equal(readPerfSignals({ nav: {}, search: '?perf=LITE', documentRef: null }).forced, 'lite');
    assert.equal(readPerfSignals({ nav: {}, search: '?perf=potato', documentRef: null }).forced, null);
    assert.equal(readPerfSignals({ nav: {}, search: '', documentRef: null }).forced, null);
  } finally { storage.restore(); }
});

test('a localStorage that throws does not take the app down with it', () => {
  const storage = installStorage({ throws: true });
  resetPerfProfileForTests();
  try {
    assert.doesNotThrow(() => readPerfSignals({ nav: {}, search: '', documentRef: null }));
    assert.equal(initPerfProfile({ nav: {}, search: '', documentRef: null }), 'full');
    assert.doesNotThrow(() => setPerfProfile('lite'));
    assert.equal(getPerfProfile(), 'lite');
  } finally { storage.restore(); resetPerfProfileForTests(); }
});

test('initPerfProfile answers once — a second call cannot contradict the first', () => {
  const storage = installStorage();
  resetPerfProfileForTests();
  try {
    assert.equal(initPerfProfile({ nav: { hardwareConcurrency: 2 }, search: '', documentRef: null }), 'lite');
    // Same page, different signals: MSAA was already chosen from the first
    // answer, so a second answer would describe a Viewer that does not exist.
    assert.equal(initPerfProfile({ nav: { hardwareConcurrency: 32 }, search: '', documentRef: null }), 'lite');
    assert.equal(isLiteProfile(), true);
  } finally { storage.restore(); resetPerfProfileForTests(); }
});

test('setPerfProfile persists the operator choice and notifies subscribers once', () => {
  const storage = installStorage();
  resetPerfProfileForTests();
  try {
    initPerfProfile({ nav: { hardwareConcurrency: 16 }, search: '', documentRef: null });
    const seen = [];
    const off = onPerfProfileChange((p) => seen.push(p));
    assert.equal(setPerfProfile('lite'), true);
    assert.equal(setPerfProfile('lite'), false, 'no-op change must not notify');
    assert.deepEqual(seen, ['lite']);
    assert.equal(storage.store.get(PERF_PROFILE_STORAGE_KEY), 'lite');
    off();
    setPerfProfile('full');
    assert.deepEqual(seen, ['lite'], 'unsubscribed listener stays silent');
  } finally { storage.restore(); resetPerfProfileForTests(); }
});

test('setPerfProfile refuses a name that is not a profile', () => {
  const storage = installStorage();
  resetPerfProfileForTests();
  try {
    initPerfProfile({ nav: {}, search: '', documentRef: null });
    assert.equal(setPerfProfile('turbo'), false);
    assert.equal(getPerfProfile(), 'full');
  } finally { storage.restore(); resetPerfProfileForTests(); }
});

test('frameP90 uses the repo-wide percentile convention', () => {
  const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
  assert.equal(frameP90(ten), 100);
  assert.equal(frameP90([]), 0);
});

test('the verdict has hysteresis, so a borderline machine stops flipping', () => {
  const all = (ms) => new Array(10).fill(ms);
  assert.equal(verdictFromFrames(all(FRAME_P90_LITE_MS + 1), 'full').profile, 'lite');
  assert.equal(verdictFromFrames(all(FRAME_P90_FULL_MS - 1), 'lite').profile, 'full');
  // Between the two thresholds nothing changes, in either direction — this is
  // the whole point: `lite` is cheaper, so a machine judged on one threshold
  // alone measures fast in lite, slow in full, and alternates forever.
  const between = all((FRAME_P90_LITE_MS + FRAME_P90_FULL_MS) / 2);
  assert.equal(verdictFromFrames(between, 'lite').profile, 'lite');
  assert.equal(verdictFromFrames(between, 'full').profile, 'full');
  assert.equal(verdictFromFrames(between, 'nonsense').profile, 'full');
});

/**
 * Drive the frame probe with a scripted list of inter-frame intervals.
 * `intervals[i]` is the gap BEFORE tick i+1; the first tick sets the origin.
 */
function runFrameProbe(viewer, intervals, options) {
  const previous = globalThis.performance;
  let clock = 0;
  const queue = [0, ...intervals];
  const ticks = queue.length;
  globalThis.performance = { now: () => (clock += queue.shift() ?? 16) };
  try {
    observeFrameProfile(viewer, options);
    for (let i = 0; i < ticks; i++) viewer.tick();
  } finally {
    globalThis.performance = previous;
  }
}

test('the frame probe drops the first frame, stops at the count, and records the verdict', () => {
  const storage = installStorage();
  resetPerfProfileForTests();
  try {
    initPerfProfile({ nav: { hardwareConcurrency: 16 }, search: '', documentRef: null });
    const viewer = makeViewer();
    runFrameProbe(viewer, new Array(9).fill(40), { count: 5, skip: 3 });
    assert.equal(viewer.listeners.length, 0, 'the probe unsubscribes itself');
    const diag = getPerfProfileDiagnostics();
    assert.equal(diag.frameSamples, 5);
    assert.equal(diag.frameVerdict, 'lite');
    assert.equal(storage.store.get(PERF_MEASURED_STORAGE_KEY), 'lite');
    // The verdict is written down, NOT applied: a page that turns sharpening
    // off four seconds in looks broken, and these are boot frames.
    assert.equal(diag.profile, 'full', 'this session is left exactly as it was');
    // And a measurement is not a choice: it must not land on the key a future
    // load reads as the operator's decision.
    assert.equal(storage.store.has(PERF_PROFILE_STORAGE_KEY), false);
  } finally { storage.restore(); resetPerfProfileForTests(); }
});

test('an idle gap is not a slow frame', () => {
  // Under requestRenderMode the scene parks; the next postRender can be
  // seconds later. Counting that as a frame time is how an Apple M5 measured a
  // p90 of 33.9 ms on the shipped build.
  const storage = installStorage();
  resetPerfProfileForTests();
  try {
    initPerfProfile({ nav: { hardwareConcurrency: 16 }, search: '', documentRef: null });
    const viewer = makeViewer();
    // Four healthy frames, one four-second park, then more healthy frames.
    runFrameProbe(viewer, [8, 8, 8, 8, FRAME_GAP_CEILING_MS + 4000, 8, 8, 8], { count: 5, skip: 0 });
    const diag = getPerfProfileDiagnostics();
    assert.equal(diag.frameSamples, 5);
    assert.equal(diag.frameVerdict, 'full', 'the park must not be counted');
    assert.ok(diag.frameP90 <= 8);
  } finally { storage.restore(); resetPerfProfileForTests(); }
});

test('a measured verdict never overrules an explicit choice', () => {
  const storage = installStorage();
  resetPerfProfileForTests();
  try {
    // `?perf=full` on a machine whose frames say otherwise: the operator asked.
    initPerfProfile({ nav: { hardwareConcurrency: 2 }, search: '?perf=full', documentRef: null });
    assert.equal(getPerfProfile(), 'full');
    const viewer = makeViewer();
    runFrameProbe(viewer, new Array(6).fill(40), { count: 5, skip: 0 });
    assert.equal(getPerfProfile(), 'full', 'the URL still wins after the frames land');
    assert.equal(storage.store.get(PERF_MEASURED_STORAGE_KEY), 'lite', 'but the machine is remembered');
  } finally { storage.restore(); resetPerfProfileForTests(); }
});

test('the frame probe is inert without a viewer, and its stop function is safe', () => {
  resetPerfProfileForTests();
  assert.doesNotThrow(() => observeFrameProfile(null)());
  assert.doesNotThrow(() => observeFrameProfile({ scene: {} })());
  const viewer = makeViewer();
  const stop = observeFrameProfile(viewer, { count: 5, skip: 0 });
  stop();
  assert.equal(viewer.listeners.length, 0);
  assert.doesNotThrow(stop, 'stopping twice is not an error');
  resetPerfProfileForTests();
});

test('the boot frames are skipped, not measured', () => {
  // The first second of the intro flight is shader compilation and first-tile
  // decode. Sampling it would classify every machine as small, which is the
  // failure this skip exists for — so a burst of slow frames followed by
  // healthy ones must read as healthy.
  const storage = installStorage();
  resetPerfProfileForTests();
  try {
    initPerfProfile({ nav: { hardwareConcurrency: 16 }, search: '', documentRef: null });
    const viewer = makeViewer();
    runFrameProbe(viewer, [200, 180, 160, 8, 8, 8, 8, 8], { count: 5, skip: 3 });
    const diag = getPerfProfileDiagnostics();
    assert.equal(diag.frameSamples, 5);
    assert.equal(diag.frameVerdict, 'full');
  } finally { storage.restore(); resetPerfProfileForTests(); }
});

test('one thinning rule for every layer: 60 % of the count, 1/√0.6 of the pitch', () => {
  // § 3.5. The rule is shared rather than per-layer because a reader on a slow
  // machine must not have to discover that this map thins and that one does
  // not — two densities on one machine is a bug that reads as data.
  assert.equal(LITE_BUDGET_SHARE, 0.6);
  assert.equal(profileCountBudget(1100, false), 1100, 'full spends its whole budget');
  assert.equal(profileCountBudget(1100, true), 660);
  assert.equal(profileCountBudget(2200, true), 1320);
  assert.equal(profileCountBudget(600, true), 360);

  // Coverage first, density second: every ladder in this repo bottoms out at
  // 1 100, and 60 % of that is still above `geoMeshThinning`'s 600-cell grid —
  // so `lite` spends its cut on the SECOND dot in a crowded cell and never on
  // the first dot in an empty one. A sparse département stays present.
  assert.ok(profileCountBudget(1100, true) > 30 * 20);

  // A grid loses cells with the SQUARE of its pitch, so the two arithmetics are
  // not the same number: widening by 1/0.6 would drop two thirds of the marks.
  assert.equal(profileCellPx(26, false), 26);
  assert.equal(profileCellPx(26, true), Math.round(26 / Math.sqrt(0.6)));
  assert.ok(profileCellPx(26, true) < Math.round(26 / 0.6), 'not the naive widening');

  // "Draw nothing" and "no ceiling" are not quantities 60 % of which means
  // anything, and neither is a number that is not one.
  assert.equal(profileCountBudget(0, true), 0);
  assert.equal(profileCountBudget(Infinity, true), Infinity);
  assert.ok(Number.isNaN(profileCountBudget(undefined, true)));
  assert.equal(profileCellPx(0, true), 0);

  // A budget of one mark cannot round down to none.
  assert.equal(profileCountBudget(1, true), 1);
});
