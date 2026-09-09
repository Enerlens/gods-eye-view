/**
 * The render profile: `full` or `lite`, decided before the Viewer exists.
 *
 * ── WHY A PROFILE AND NOT A SETTING ─────────────────────────────────────────
 *
 * Two of the four fixed render costs — `msaaSamples` and
 * `preserveDrawingBuffer` — are Viewer construction arguments. They cannot be
 * changed afterwards, so a decision taken after the globe is up is a decision
 * taken too late for half of what it governs. This module therefore runs from
 * static signals available on the first line of `main.js`, and every consumer
 * reads it rather than guessing again.
 *
 * ── WHAT IT MAY AND MAY NOT CHANGE ──────────────────────────────────────────
 *
 * `lite` never changes WHAT is on screen: not a layer, not a datum, not a
 * label's text. It changes how many samples a pixel gets, how many pixels a
 * frame has, and how hard the globe refines. A reader on a 2018 laptop and a
 * reader on a workstation see the same France; one of them sees it with softer
 * edges while the camera moves.
 *
 * ── THE TWO-PHASE DECISION, AND WHY THE SECOND PHASE IS PERSISTED ───────────
 *
 * The static signals (`hardwareConcurrency`, `deviceMemory`, the GPU's
 * unmasked renderer string, `prefers-reduced-motion`) are cheap and available
 * immediately, and they are also guesses: a renderer string is a marketing
 * name, and `deviceMemory` is capped at 8 by every browser that ships it.
 * The only honest measure is how long this machine actually takes to draw this
 * scene — the p90 of its first `FRAME_SAMPLE_COUNT` frames.
 *
 * That measure arrives seconds after the Viewer was constructed, which is too
 * late for MSAA and `preserveDrawingBuffer` on THIS visit — so it does not try
 * to rescue this visit at all. It writes the verdict to `localStorage` and the
 * NEXT visit opens with it, complete. A slow machine pays full price once and
 * never again.
 *
 * Applying it live was the first design and it was wrong twice over: turning
 * sharpening off and MSAA down four seconds into a page load reads as a
 * glitch, and those particular sixty frames — measured during the intro
 * flight, while tiles decode — are the least representative sixty of the
 * session. Measured on this repo's own bench, counting them naively put an
 * Apple M5 at a p90 of 33.9 ms.
 *
 * ── WHY `?perf=` DOES NOT PERSIST ───────────────────────────────────────────
 *
 * `?perf=lite` is a debugging and A/B instrument, and links get shared. A
 * parameter someone pastes into a chat must not silently rewrite the render
 * profile of everyone who clicks it — so the URL forces the CURRENT SESSION
 * only. The DISPLAY-rail switch is the operator's own choice, and that one
 * persists. Neither is ever written into a share link (`src/sharelink.js`
 * serializes an explicit field list; the profile is not in it, and must not
 * be added: a link records what someone is looking at, not the machine they
 * looked at it on).
 */

/** The two profiles. Anything else is a bug, not a third mode. */
export const PERF_PROFILES = Object.freeze(['full', 'lite']);

/**
 * Multisampling per profile.
 *
 * 4 is the app's look and it is the single most expensive fixed render cost
 * measured: `npm run perf:gpu-ab` puts 4 → 1 at −43 % of render work per frame
 * at 1366×768 and −59 % at twice that resolution, on a real GPU. 1 is "off" in
 * Cesium's vocabulary, not "no antialiasing at all" — the FXAA stage is a
 * separate pass and still runs, which is why thin geometry survives the trade.
 *
 * `src/data/vigicrues.js` and `src/data/gasFrance.js` both document their
 * stroke widths against `msaaSamples: 4`. Checked when this landed: the
 * narrowest polyline either of them draws is 2.2 px (Vigicrues UNKNOWN) and
 * the gas network is 5 px, so both are already clear of the 2 px floor a
 * single-sampled frame needs. Nothing to change there — but if either width
 * ever drops, this is the constraint it drops against.
 */
export const FULL_MSAA_SAMPLES = 4;
export const LITE_MSAA_SAMPLES = 1;

/**
 * The globe's error tolerance in `lite`, in pixels of on-screen error.
 *
 * 2 is Cesium's default and the value `full` keeps. 3 asks for roughly half as
 * many tiles at every level — the tile count for a given view goes as the
 * square of the tolerance — and on a 1366×768 panel the difference at rest is
 * a texel of blur on distant terrain.
 *
 * The motion multiplier in `src/globeDetailGovernor.js` stacks ON TOP of this,
 * so a `lite` machine flies at 6 and settles at 3 where a `full` one flies at 4
 * and settles at 2.
 */
export const LITE_GLOBE_SSE = 3;

/**
 * Resident tile cache in `lite`. Cesium's default is 100; 60 is the plan's
 * number. This is a MEMORY lever, not a frame-time one: a smaller cache evicts
 * sooner, so a camera that comes back to a view it just left re-fetches. On the
 * machine § 0 describes — 8 GB shared with everything else — that trade is the
 * right way round.
 */
export const LITE_TILE_CACHE_SIZE = 60;

/** Where the operator's own choice survives a reload. */
export const PERF_PROFILE_STORAGE_KEY = 'gev:perf-profile';

/** Where the measured verdict survives a reload, separately from the choice. */
export const PERF_MEASURED_STORAGE_KEY = 'gev:perf-measured';

/**
 * How many frames the honest measure watches. 60 is the plan's number and it is
 * about one second of a healthy scene — long enough that a single hitch cannot
 * carry the p90, short enough that the verdict lands while the reader is still
 * looking at the intro flight.
 */
export const FRAME_SAMPLE_COUNT = 60;

/**
 * How many frames are thrown away before the sample starts.
 *
 * The only window in an ordinary session where this app draws CONTINUOUSLY is
 * the four-second intro flight — after it the render governor parks the scene
 * and there are no frame times to read. So the sample has to come from the
 * flight, and the flight's first second is the worst possible second: shader
 * compilation, the first tile decodes, the loading screen's own transition.
 * Skipping 60 frames puts the window past that and still leaves ~120 frames of
 * flight to sample from on a 60 Hz panel.
 */
export const FRAME_SKIP_COUNT = 60;

/**
 * p90 frame time above which this machine is treated as small. 28 ms is the
 * plan's threshold: comfortably past the 16.7 ms of a 60 Hz panel, comfortably
 * short of the 33 ms that the targets table calls the floor of acceptable.
 */
export const FRAME_P90_LITE_MS = 28;

/**
 * …and the threshold to come back out, which is NOT the same number.
 *
 * Without hysteresis a machine sitting near 28 ms oscillates: it measures slow,
 * next visit starts in `lite`, `lite` is cheaper so it measures fast, the visit
 * after that starts in `full` again, and the picture changes every time the
 * reader opens the page for a reason they can never see. 22 ms is far enough
 * below to require a real improvement, not a quieter minute.
 */
export const FRAME_P90_FULL_MS = 22;

/**
 * An interval longer than this is not a slow frame, it is the gap between two
 * frames.
 *
 * `src/renderGovernor.js` puts the scene in `requestRenderMode`, where nothing
 * paints until something asks. The interval between two `postRender` events is
 * therefore only a frame TIME while the scene is drawing continuously; across
 * a park it is however long nobody touched the app. Measured on the shipped
 * build, counting those gaps put an Apple M5 at a p90 of 33.9 ms and would have
 * classified a workstation as a small laptop. 250 ms is well past the worst
 * frame a machine this app is usable on can produce, and well short of any
 * genuine idle gap.
 */
export const FRAME_GAP_CEILING_MS = 250;

/**
 * GPUs that answer `lite` on sight. Intel's integrated parts are the reference
 * machine itself; Mali and Adreno are the phone and tablet equivalents; the
 * software renderers are a machine with no GPU at all, where every fill cost is
 * a CPU cost and the levers pay the most.
 */
const SMALL_GPU_RE = /Intel\(R\)\s+(HD|UHD|Iris)|\bMali\b|\bAdreno\b|SwiftShader|llvmpipe|Software/i;

let _profile = null;
let _source = 'unresolved';
let _signals = null;
let _frameSamples = null;
let _frameVerdict = null;
const _subscribers = new Set();

/** localStorage that never throws — Safari private mode and iframes both do. */
function readStored(key) {
  try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
}
function writeStored(key, value) {
  try { globalThis.localStorage?.setItem(key, value); } catch { /* best effort */ }
}

/**
 * The GPU's unmasked renderer string, from a throwaway 1×1 context.
 *
 * This costs one WebGL context for the length of one function call, and it is
 * released explicitly: a page that leaks probe contexts eventually gets the
 * oldest one killed by the browser, and on this app the oldest one is the
 * globe. `WEBGL_debug_renderer_info` is the only source that distinguishes
 * "Intel UHD 620" from "ANGLE (Apple, Metal)", which is the whole question.
 *
 * @returns {string} Renderer name, or '' when WebGL is unavailable.
 */
export function readRendererString(documentRef = globalThis.document) {
  try {
    const canvas = documentRef?.createElement?.('canvas');
    if (!canvas) return '';
    canvas.width = 1;
    canvas.height = 1;
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return '';
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(
      debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    );
    gl.getExtension('WEBGL_lose_context')?.loseContext?.();
    return name;
  } catch {
    return '';
  }
}

/**
 * Read every static signal at once, so the decision below is a pure function of
 * an object a test can hand it.
 * @returns {{cores: ?number, memoryGB: ?number, renderer: string,
 *   reducedMotion: boolean, stored: ?string, measured: ?string, forced: ?string}}
 */
export function readPerfSignals({
  nav = globalThis.navigator,
  search = globalThis.location?.search ?? '',
  documentRef = globalThis.document,
} = {}) {
  const params = new URLSearchParams(search);
  const asked = String(params.get('perf') || '').trim().toLowerCase();
  return {
    cores: Number.isFinite(nav?.hardwareConcurrency) ? nav.hardwareConcurrency : null,
    memoryGB: Number.isFinite(nav?.deviceMemory) ? nav.deviceMemory : null,
    renderer: readRendererString(documentRef),
    reducedMotion: !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,
    stored: readStored(PERF_PROFILE_STORAGE_KEY),
    measured: readStored(PERF_MEASURED_STORAGE_KEY),
    forced: PERF_PROFILES.includes(asked) ? asked : null,
  };
}

/**
 * The decision, as a pure function of the signals. Order matters and is the
 * order of authority: what the URL says for this session, then what the
 * operator chose, then what this machine was MEASURED at last time, then what
 * it looks like.
 *
 * `prefers-reduced-motion` is in the list because the four levers are exactly
 * the motion-cost levers, and someone who has asked their OS for less motion is
 * asking for a calmer picture, not a sharper one. It is the weakest signal, so
 * it is last.
 *
 * @param {object} signals - From `readPerfSignals()`.
 * @returns {{profile: 'full'|'lite', source: string}}
 */
export function decidePerfProfile(signals) {
  if (signals?.forced) return { profile: signals.forced, source: 'url' };
  if (PERF_PROFILES.includes(signals?.stored)) return { profile: signals.stored, source: 'stored' };
  if (PERF_PROFILES.includes(signals?.measured)) return { profile: signals.measured, source: 'measured' };
  if (Number.isFinite(signals?.cores) && signals.cores <= 4) return { profile: 'lite', source: 'cores' };
  if (Number.isFinite(signals?.memoryGB) && signals.memoryGB <= 4) return { profile: 'lite', source: 'memory' };
  if (signals?.renderer && SMALL_GPU_RE.test(signals.renderer)) return { profile: 'lite', source: 'gpu' };
  if (signals?.reducedMotion) return { profile: 'lite', source: 'reduced-motion' };
  return { profile: 'full', source: 'default' };
}

/**
 * Resolve the profile once, before the Viewer is constructed. Idempotent: a
 * second call returns the first answer, because two different answers in one
 * page load is the bug this whole module exists to prevent.
 * @returns {'full'|'lite'}
 */
export function initPerfProfile(options = {}) {
  if (_profile) return _profile;
  _signals = readPerfSignals(options);
  const decided = decidePerfProfile(_signals);
  _profile = decided.profile;
  _source = decided.source;
  return _profile;
}

/** @returns {'full'|'lite'} The resolved profile, resolving it if needed. */
export function getPerfProfile() {
  return _profile || initPerfProfile();
}

/** @returns {boolean} True when the light profile is in force. */
export function isLiteProfile() {
  return getPerfProfile() === 'lite';
}

/**
 * Change the profile at runtime. Only the levers that CAN change at runtime
 * follow — `msaaSamples` and `preserveDrawingBuffer` are fixed for this page —
 * so a switch mid-session is honest but partial, and the persisted choice is
 * what makes the next load complete.
 * @param {'full'|'lite'} profile
 * @param {{persist?: boolean, source?: string}} [options]
 * @returns {boolean} True when the profile changed.
 */
export function setPerfProfile(profile, { persist = true, source = 'operator' } = {}) {
  if (!PERF_PROFILES.includes(profile)) return false;
  initPerfProfile();
  if (persist) writeStored(PERF_PROFILE_STORAGE_KEY, profile);
  if (_profile === profile) return false;
  _profile = profile;
  _source = source;
  for (const fn of _subscribers) {
    try { fn(profile); } catch (error) { console.warn('[perfProfile] subscriber failed', error); }
  }
  return true;
}

/**
 * Subscribe to profile changes. Returns an unsubscribe function.
 * @param {(profile: 'full'|'lite') => void} fn
 * @returns {() => void}
 */
export function onPerfProfileChange(fn) {
  if (typeof fn !== 'function') return () => {};
  _subscribers.add(fn);
  return () => _subscribers.delete(fn);
}

/**
 * p90 of a frame-time sample, by the same index convention as every other
 * probe in this repo (`perf-boot-probe.mjs`, `qa-perf.mjs`): sort, floor.
 * @param {number[]} samples
 * @returns {number}
 */
export function frameP90(samples) {
  if (!samples?.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
}

/**
 * The verdict this machine's own frames return, with hysteresis.
 *
 * Between the two thresholds the answer is "whatever it already was" — a
 * machine that is genuinely borderline keeps the profile it booted with rather
 * than flipping on every visit.
 *
 * @param {number[]} samples - Frame intervals in ms, gaps already removed.
 * @param {'full'|'lite'} [current] - What the session is running now.
 * @returns {{p90: number, profile: 'full'|'lite'}}
 */
export function verdictFromFrames(samples, current = 'full') {
  const p90 = frameP90(samples);
  if (p90 > FRAME_P90_LITE_MS) return { p90, profile: 'lite' };
  if (p90 < FRAME_P90_FULL_MS) return { p90, profile: 'full' };
  return { p90, profile: PERF_PROFILES.includes(current) ? current : 'full' };
}

/**
 * Watch the first `FRAME_SAMPLE_COUNT` real frames and record what they say.
 *
 * Three things this deliberately does NOT do:
 *
 *   - It does not count the first `FRAME_SKIP_COUNT` frames. They carry shader
 *     compilation, the first tile decodes and the whole cost of getting a
 *     picture on screen, and nobody will see them twice.
 *   - It does not count an idle gap as a frame. See `FRAME_GAP_CEILING_MS`:
 *     under `requestRenderMode` the interval between two `postRender` events is
 *     a frame time only while the scene is drawing continuously.
 *   - It does not change the running session. A verdict that landed four
 *     seconds into a visit would turn sharpening off and drop MSAA WHILE THE
 *     READER IS WATCHING, which reads as a glitch, and it would do so on the
 *     strength of sixty frames measured during a page load — the least
 *     representative sixty frames of the whole session. The verdict is written
 *     down instead, and the NEXT visit opens with it, where it can also carry
 *     the two context options this one could never have changed.
 *
 * @param {object} viewer - Cesium viewer.
 * @param {{count?: number, skip?: number, gapCeilingMs?: number}} [options]
 * @returns {() => void} Stop watching.
 */
export function observeFrameProfile(viewer, {
  count = FRAME_SAMPLE_COUNT,
  skip = FRAME_SKIP_COUNT,
  gapCeilingMs = FRAME_GAP_CEILING_MS,
} = {}) {
  const postRender = viewer?.scene?.postRender;
  if (!postRender?.addEventListener) return () => {};
  const samples = [];
  let skipped = 0;
  let last = null;
  let removed = false;
  const stop = postRender.addEventListener(() => {
    const now = (globalThis.performance ?? Date).now();
    const delta = last === null ? null : now - last;
    last = now;
    if (delta === null || delta > gapCeilingMs) return;
    if (skipped < skip) { skipped++; return; }
    samples.push(delta);
    if (samples.length < count || removed) return;
    removed = true;
    stop();
    _frameSamples = samples;
    _frameVerdict = verdictFromFrames(samples, getPerfProfile());
    writeStored(PERF_MEASURED_STORAGE_KEY, _frameVerdict.profile);
  });
  return () => { if (!removed) { removed = true; stop(); } };
}

/**
 * @returns {{profile: string, source: string, signals: ?object,
 *   frameP90: ?number, frameVerdict: ?string, frameSamples: number}}
 */
export function getPerfProfileDiagnostics() {
  return {
    profile: getPerfProfile(),
    source: _source,
    signals: _signals ? { ..._signals } : null,
    frameP90: _frameVerdict ? Number(_frameVerdict.p90.toFixed(2)) : null,
    frameVerdict: _frameVerdict?.profile ?? null,
    frameSamples: _frameSamples?.length ?? 0,
  };
}

/** Test seam: forget everything resolved so far. Not used by the app. */
export function resetPerfProfileForTests() {
  _profile = null;
  _source = 'unresolved';
  _signals = null;
  _frameSamples = null;
  _frameVerdict = null;
  _subscribers.clear();
}
