// The HUD's ALT readout datum. Field report (2026-08-22, cockpit parked at
// SFO): the bottom-right OSD read "ALT: -15M" — and JFK, earlier, "ALT: -18M".
// Cesium reports the camera's height against the WGS84 ELLIPSOID, and San
// Francisco's geoid sits ~32 m BELOW it, so a camera 17 m over the SFO deck
// reads 32 m too low. The number a viewer reads as "ALT" is MSL.
//
// The arithmetic itself is pinned in src/data/geoid.test.mjs
// (ellipsoidalToMslDisplayM, including the no-geoid fallback). This file pins
// the PRODUCTION wiring two ways: source probes that hud.js routes both of its
// on-screen altitude strings through that correction, and a live IntelHUD
// driven across the real cold → resolved geoid transition.
//
// WHERE N COMES FROM (changed 2026-09-02). It used to be the bundled
// `egm96-universal` grid, imported lazily on the first telemetry tick. That
// grid is 2.77 MB — 1.77 MB over the wire, of a 5.06 MB first visit — and the
// HUD is visible by default, so every visitor downloaded all of it to correct
// one readout. N now comes from `/api/geoid`, one coarse cell at a time,
// computed server-side by the same package: bit-for-bit the same number for
// ~50 bytes. The grid still ships for `src/data/ignBilTerrain.js`, which does
// thousands of synchronous lookups per terrain tile and loads it only when IGN
// terrain is switched on.
//
// The four intents below did not change with the mechanism, and each probe
// still names one: the correction comes from ./data/geoid.js and is not
// re-derived here; it is never awaited on a readout tick; it is asked for on
// demand rather than at construction; and a lookup that fails leaves the
// readout uncorrected rather than unhandled. Only HOW moved.
//
// hud.js imports `mgrs`, a CommonJS package whose named exports Node's ESM
// loader cannot see, so the live half installs a module hook that swaps that
// one specifier for a stub. The import also has to happen BEFORE any DOM
// globals exist: Cesium's widget bundle probes for a real `document` at module
// scope and a partial stub sends it down the browser path. Hence hook →
// import → install DOM, in that order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { meanSeaLevel } from 'egm96-universal';
import { _resetRemoteGeoidForTest, geoidCell } from './data/geoid.js';

/**
 * Stand in for the `/api/geoid` endpoint with the very package it runs, so the
 * live halves below pin the real arithmetic end to end rather than a number
 * this file made up. Returns a handle whose `settled` resolves once every
 * request the HUD issued has been answered.
 */
function installGeoidEndpoint() {
  const previousFetch = globalThis.fetch;
  const pending = [];
  globalThis.fetch = (input) => {
    const params = new URL(String(input), 'http://internal').searchParams;
    const lat = Number(params.get('lat'));
    const lon = Number(params.get('lon'));
    const promise = Promise.resolve({
      ok: true,
      json: async () => ({ n: meanSeaLevel(lat, lon) }),
    });
    pending.push(promise);
    return promise;
  };
  return {
    /** Every issued request answered, and its continuations drained. */
    async settled() {
      // `fetchGeoidHeight` chains response -> json -> cache -> finally, and the
      // HUD adds its own .then on top, so counting microtask turns by hand is
      // a way to get this subtly wrong. setImmediate fires only once the whole
      // microtask queue is empty; looping covers a request issued while
      // draining.
      for (let i = 0; i < 5; i++) {
        await Promise.all(pending.slice());
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
    restore() {
      if (previousFetch === undefined) delete globalThis.fetch;
      else globalThis.fetch = previousFetch;
      _resetRemoteGeoidForTest();
    },
  };
}

const MGRS_STUB_URL = 'gev-test-stub:mgrs';
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'mgrs') return { url: MGRS_STUB_URL, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === MGRS_STUB_URL) {
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export function forward() { return "10SEG55776339"; }\nexport default { forward };\n',
      };
    }
    return next(url, context);
  },
});

const { IntelHUD } = await import('./hud.js');

const source = readFileSync(new URL('./hud.js', import.meta.url), 'utf8');
// Boolean probes, not assert.match on the whole file — a failure here should
// name the missing wiring, not print all of hud.js.
const has = (pattern) => pattern.test(source);

/** SFO runway 28R touchdown area — the field report's coordinates. */
const SFO = { latDeg: 37.616, lonDeg: -122.368 };
/** The ellipsoidal camera height the screenshot reported. */
const SFO_ELLIPSOIDAL_M = -15;

/**
 * Minimal DOM + viewer the HUD's telemetry tick actually touches. `intel-hud`
 * is deliberately absent so `_buildDOM` bails and the readouts stay the plain
 * text sinks this test reads.
 */
function installHudEnvironment() {
  const elements = new Map(
    ['hud-alt', 'hud-summary', 'hud-mgrs', 'hud-latlon', 'hud-bottom-line', 'hud-gsd', 'hud-coll', 'hud-ona', 'hud-mode']
      .map((id) => [id, { textContent: '' }]),
  );
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id) => elements.get(id) ?? null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
  const viewer = {
    camera: {
      pitch: -Math.PI / 2,
      positionCartographic: {
        latitude: (SFO.latDeg * Math.PI) / 180,
        longitude: (SFO.lonDeg * Math.PI) / 180,
        height: SFO_ELLIPSOIDAL_M,
      },
      computeViewRectangle: () => undefined,
      moveEnd: { addEventListener() {}, removeEventListener() {} },
    },
  };
  return {
    elements,
    viewer,
    restore() {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
    },
  };
}

test('hud.js corrects the camera height to MSL through the geoid module', () => {
  assert.equal(
    has(/import \{[^}]*\bellipsoidalToMslDisplayM\b[^}]*\} from '\.\/data\/geoid\.js';/s),
    true,
    'hud.js must take the datum correction from ./data/geoid.js, not re-derive one',
  );
  assert.equal(
    has(/fetchGeoidHeight\(latDeg, lonDeg\)\s*\n\s*\.then\(/),
    true,
    'N must be fetched opportunistically, never awaited on a readout tick',
  );
  assert.equal(
    has(/const \{ key \} = geoidCell\(latDeg, lonDeg\);/),
    true,
    'the lookup must quantize to the shared cell, so one answer serves a whole cell',
  );
  assert.equal(
    has(/ensureGeoidReady|geoidHeight\(/),
    false,
    'the readout must not pull the 2.77 MB grid — that path belongs to ignBilTerrain',
  );
  assert.equal(
    has(/\.catch\(\(\) => \{ \/\* readout falls back to the uncorrected height \*\/ \}\)/),
    true,
    'a failed geoid load must leave the readout uncorrected, not unhandled',
  );
});

test('the corner ALT readout prints the MSL height, never the ellipsoidal one', () => {
  assert.equal(
    has(/const geoidN = this\._geoidUndulationM\(latDeg, lonDeg\);/),
    true,
    'the telemetry tick must look N up once and reuse it',
  );
  assert.equal(
    has(/const altMslM = ellipsoidalToMslDisplayM\(altM, geoidN\);/),
    true,
    'the ALT readout must convert the camera height before printing it',
  );
  assert.equal(
    has(/`ALT: \$\{Math\.round\(altMslM\)\}m/),
    true,
    'the #hud-alt line must print altMslM',
  );
  assert.equal(
    has(/`ALT: \$\{Math\.round\(altM\)\}m/),
    false,
    'the #hud-alt line must not regress to the raw ellipsoidal camera height',
  );
});

test('the summary ALT tag agrees with the corner readout', () => {
  // Both are on screen together; a viewer reading "ALT -15M" in one corner and
  // "ALT: 17m" in the other has found a bug, not a distinction.
  assert.equal(
    has(/const altDisplayM = Number\.isFinite\(m\.altMslM\) \? m\.altMslM : m\.altM;/),
    true,
    'the summary altitude tag must prefer the MSL datum and fall back to the raw height',
  );
  assert.equal(
    has(/const altTag = m\.altM >= 1000/),
    false,
    'the summary altitude tag must not regress to the raw ellipsoidal height',
  );
});

test('the sensor model keeps the ellipsoidal height it was tuned against', () => {
  // GSD/NIIRS and the STREET/CITY/METRO view band are camera-geometry math,
  // not readouts. Re-datuming them would silently move their thresholds, so
  // altM stays and altMslM is purely additive.
  assert.equal(
    has(/const gsd = Math\.max\(0\.01, altM \* 0\.000375\);/),
    true,
    'GSD must keep reading the raw camera height',
  );
  assert.equal(
    has(/const band = this\._viewBand\(m\.altM\);/),
    true,
    'the view band must keep reading the raw camera height',
  );
});

// ── The cold → resolved transition, driven live ─────────────────────────────
//
// The grid is a lazy ~2.7 MB chunk, so the first telemetry ticks of a session
// paint UNCORRECTED. The corner readout picks the correction up on the very
// next tick once it lands; the summary line has no such cadence — it repaints
// on camera settle or its own 15 s retry. That left a window at SFO where the
// corner read `ALT: 17m` beside a summary still reading `ALT -15M`, for up to
// fifteen seconds. Both must move in the SAME tick.

test('a cold tick paints both readouts uncorrected, and resolving flips both in one tick', async () => {
  const endpoint = installGeoidEndpoint();
  const env = installHudEnvironment();
  let hud;
  try {
    hud = new IntelHUD(env.viewer);
    const alt = () => env.elements.get('hud-alt').textContent;
    const summary = () => env.elements.get('hud-summary').textContent;

    // Tick 1 — cold. This is also the tick that asks for the cell.
    hud._updateCameraData();
    assert.match(alt(), /^ALT: -15m/, `cold corner readout, got ${alt()}`);
    assert.match(summary(), /\| ALT -15M \|/, `cold summary tag, got ${summary()}`);

    // Answer the request tick 1 issued and drain the HUD's continuation. No
    // timers, no 15 s retry — the readout is repainted by the NEXT tick.
    await endpoint.settled();

    // Tick 2 — resolved. ONE tick has to move both.
    hud._updateCameraData();
    assert.match(alt(), /^ALT: 17m/, `corrected corner readout, got ${alt()}`);
    assert.match(
      summary(),
      /\| ALT 17M \|/,
      `the summary must repaint in the same tick the corner does, got ${summary()}`,
    );

    // Tick 3 — steady state. The repaint is a transition, not a per-tick cost.
    const summaryRevisionAfterFlip = hud._summaryRevision;
    hud._updateCameraData();
    assert.match(alt(), /^ALT: 17m/);
    assert.match(summary(), /\| ALT 17M \|/);
    assert.equal(
      hud._summaryRevision,
      summaryRevisionAfterFlip,
      'a settled geoid must not re-dirty the summary on every telemetry tick',
    );
  } finally {
    hud?.destroy();
    env.restore();
    endpoint.restore();
  }
});

test('the corrected readouts are the MSL datum, not a coincidence of the SFO sign', async () => {
  const endpoint = installGeoidEndpoint();
  const env = installHudEnvironment();
  // London: N is +46 m, so the correction moves the readout DOWN. A sign flip
  // that happens to look right at SFO fails here.
  env.viewer.camera.positionCartographic.latitude = (51.5072 * Math.PI) / 180;
  env.viewer.camera.positionCartographic.longitude = (-0.1275 * Math.PI) / 180;
  env.viewer.camera.positionCartographic.height = 100;
  let hud;
  try {
    hud = new IntelHUD(env.viewer);
    hud._updateCameraData(); // cold: requests the cell, paints uncorrected
    assert.match(env.elements.get('hud-alt').textContent, /^ALT: 100m/);
    await endpoint.settled();
    hud._updateCameraData();
    assert.match(
      env.elements.get('hud-alt').textContent,
      /^ALT: 54m/,
      `100 m ellipsoidal over London is 54 m MSL, got ${env.elements.get('hud-alt').textContent}`,
    );
    assert.match(env.elements.get('hud-summary').textContent, /\| ALT 54M \|/);
  } finally {
    hud?.destroy();
    env.restore();
    endpoint.restore();
  }
});

test('crossing into a new cell holds the previous N instead of blanking it', async () => {
  // The subtlest line in the rewrite, and a silent failure if it regresses:
  // while the new cell is in flight the readout keeps the OLD undulation.
  // Neighbouring cells differ by centimetres, so holding is accurate; clearing
  // would drop the correction entirely and jump the printed altitude by tens
  // of metres for a tick — the exact artefact this datum exists to remove.
  const endpoint = installGeoidEndpoint();
  const env = installHudEnvironment();
  let hud;
  try {
    hud = new IntelHUD(env.viewer);
    hud._updateCameraData();
    await endpoint.settled();
    hud._updateCameraData();
    const corrected = env.elements.get('hud-alt').textContent;
    assert.match(corrected, /^ALT: 17m/, `expected the SFO cell to be resolved, got ${corrected}`);

    // Move ~2 km north: a different cell, nothing cached for it yet.
    env.viewer.camera.positionCartographic.latitude = ((SFO.latDeg + 0.02) * Math.PI) / 180;
    hud._updateCameraData();
    assert.match(
      env.elements.get('hud-alt').textContent,
      /^ALT: 1[67]m/,
      `the readout must stay corrected across a cell change, got ${env.elements.get('hud-alt').textContent}`,
    );
  } finally {
    hud?.destroy();
    env.restore();
    endpoint.restore();
  }
});

test('an answer for a cell the camera already left never writes the readout', async () => {
  // Two cells in flight at once: the slow first answer must not overwrite the
  // value for the cell actually on screen.
  const { _resetRemoteGeoidForTest: reset } = await import('./data/geoid.js');
  reset();
  const env = installHudEnvironment();
  let hud;
  const previousFetch = globalThis.fetch;
  const gates = new Map();
  globalThis.fetch = (input) => {
    const params = new URL(String(input), 'http://internal').searchParams;
    const key = `${params.get('lat')}:${params.get('lon')}`;
    return new Promise((resolve) => {
      gates.set(key, () => resolve({ ok: true, json: async () => ({ n: meanSeaLevel(Number(params.get('lat')), Number(params.get('lon'))) }) }));
    });
  };
  try {
    hud = new IntelHUD(env.viewer);
    hud._updateCameraData();                     // asks for cell A
    const cellA = geoidCell(SFO.latDeg, SFO.lonDeg).key;
    env.viewer.camera.positionCartographic.latitude = ((SFO.latDeg + 0.5) * Math.PI) / 180;
    hud._updateCameraData();                     // now on cell B, asks for it
    const keys = [...gates.keys()];
    assert.equal(keys.length, 2, `expected two in-flight cells, got ${keys.join(', ')}`);

    // Answer B first, then the stale A.
    const cellB = keys.find((k) => k !== cellA);
    gates.get(cellB)();
    await new Promise((r) => setImmediate(r));
    const afterB = hud._geoidN;
    gates.get(cellA)();
    await new Promise((r) => setImmediate(r));
    assert.equal(hud._geoidN, afterB, 'a late answer for an abandoned cell must be discarded');
  } finally {
    hud?.destroy();
    env.restore();
    if (previousFetch === undefined) delete globalThis.fetch; else globalThis.fetch = previousFetch;
    reset();
  }
});

test('the cell the endpoint is asked about is the cell the readout memoizes', () => {
  // The HUD holds one N per cell and the endpoint answers per cell; if those
  // two grids ever drifted apart the readout would either re-request on every
  // tick or hold a value from the wrong place. Both come from geoidCell().
  const a = geoidCell(37.6161, -122.3679);
  const b = geoidCell(37.6158, -122.3681);
  assert.equal(a.key, b.key, 'two points 30 m apart must share one cell');
  assert.equal(a.lat, 37.62);
  assert.equal(a.lon, -122.37);
  // The snap must not move the answer: N over the cell centre and over the
  // field report's exact coordinates round to the same printed metre.
  const exact = meanSeaLevel(37.616, -122.368);
  const snapped = meanSeaLevel(a.lat, a.lon);
  assert.ok(
    Math.abs(exact - snapped) < 0.05,
    `snapping to the cell moved N by ${Math.abs(exact - snapped).toFixed(4)} m`,
  );
  assert.equal(Math.round(-15 - exact), Math.round(-15 - snapped));
});
