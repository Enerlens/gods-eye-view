/**
 * lazyVoice.js — the voice agent costs nothing until someone reaches for it.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * Measured on rollup's own module graph (2026-09-09, after the layers moved
 * out in #123): the static closure of `src/main.js` was 2 708 kB before
 * minification, and **360 kB of it was reachable only through the voice
 * stack** — the realtime controller (129 kB), the annotation engine and its
 * two renderers (105 kB), the scene director and its recipes (65 kB), the
 * brain-voice session (40 kB), the cost meter (17 kB). None of it is needed to
 * open a map, and most visitors never press the mic.
 *
 * ── WHEN IT LOADS ───────────────────────────────────────────────────────────
 *
 * Two triggers, whichever comes first:
 *
 *   - **Browser idle**, bounded (`whenIdle`). The point of this file is not to
 *     make voice rare, it is to keep it out of the way of the globe: once the
 *     boot burst has drained, the module lands on its own and everything that
 *     reads `window.__gevVoiceCommands` — eight QA harnesses among them — finds
 *     what it expects without asking for it.
 *   - **Intent**, immediately: a pointer on the panel, keyboard focus on the
 *     mic, or the push-to-talk key. In practice idle wins by several seconds;
 *     this is the path for someone who clicks the mic during the fly-in.
 *
 * ── WHY THE PANEL IS NOT LAZY, ONLY ITS BRAIN ───────────────────────────────
 *
 * The mic panel is part of the cockpit. A control that materialises a second
 * after everything else reads as a page still loading, and it would move the
 * command dock under the cursor. So the shell is built at boot from
 * `voiceControlDom.js` — markup and nothing else — and the controller rebuilds
 * the same markup when it arrives (`createVoiceControl({ reset: true })`).
 * That rebuild is why the listeners installed here need no removal: they die
 * with the node they were attached to. The one on `window` does not, and is
 * removed by hand.
 *
 * @module voice/lazyVoice
 */
import { whenIdle } from '../whenIdle.js';
import { createVoiceControl } from './voiceControlDom.js';

/**
 * Upper bound on the idle wait. Long enough that a busy boot is never
 * interrupted, short enough that a harness which merely polls for
 * `window.__gevVoiceCommands` finds it without knowing this file exists.
 */
const VOICE_IDLE_TIMEOUT_MS = 4_000;

/**
 * Mount the voice panel now, and its 360 kB of machinery later.
 *
 * @param {object} options
 * @param {object} options.viewer Cesium viewer.
 * @param {object} options.styleManager
 * @param {object} options.dataManager Sealed layer manager.
 * @param {object|null} [options.tileset] Google photoreal tileset, for clamped
 *   annotation placement.
 * @param {(loaded: {controller: object, annotations: object, sceneDirector: object}) => void} [options.onReady]
 *   Called once, when the stack is up — this is where `main.js` republishes it
 *   on `window.__godsEyeView`.
 * @param {number} [options.idleTimeoutMs]
 * @returns {{ready: Promise<object>, load: () => Promise<object>, isLoaded: () => boolean}}
 */
export function installLazyVoice({
  viewer,
  styleManager,
  dataManager,
  tileset = null,
  onReady = null,
  idleTimeoutMs = VOICE_IDLE_TIMEOUT_MS,
} = {}) {
  const ui = createVoiceControl();
  let loaded = null;
  let loadPromise = null;
  let cancelIdle = null;
  // Resolved on the first SUCCESSFUL load, and never rejected: a failed fetch
  // is retried by the next trigger, and a promise rejected here would be an
  // unhandled rejection in every tab that simply never used the mic.
  let announceReady = null;
  const ready = new Promise((resolve) => { announceReady = resolve; });

  const load = () => {
    if (loadPromise) return loadPromise;
    cancelIdle?.();
    cancelIdle = null;
    window.removeEventListener('keydown', onPushToTalkKey, true);
    loadPromise = Promise.all([
      import('./gevRealtime.js'),
      import('../annotations/index.js'),
      import('../scenes/director.js'),
    ])
      .then(([realtime, annotationsModule, directorModule]) => {
        // Same order as the eager build: the director and the annotation
        // engine are constructor arguments of the voice runner, not siblings.
        const annotations = annotationsModule.initAnnotations({ viewer, tileset });
        const sceneDirector = new directorModule.SceneDirector(viewer, styleManager, dataManager);
        const controller = realtime.initGevVoiceCommands({
          viewer, styleManager, dataManager, sceneDirector, annotations,
        });
        loaded = { controller, annotations, sceneDirector };
        onReady?.(loaded);
        announceReady(loaded);
        return loaded;
      })
      .catch((error) => {
        // A chunk that 404s after a redeploy is the realistic failure. Dropping
        // the promise lets the next click try again rather than pinning the mic
        // to one dead fetch for the life of the tab.
        loadPromise = null;
        console.warn('[voice] deferred load failed:', error);
        throw error;
      });
    return loadPromise;
  };

  /**
   * The click that arrives before the controller does.
   *
   * The handler the controller installs is on the NEW button, so the intent
   * has to be replayed by hand. `start()` after an await has lost its
   * transient activation, which Chrome accepts for `getUserMedia` (it prompts)
   * — and this path is only reachable by clicking the mic within the first
   * seconds of boot, before idle has fired.
   */
  const onButtonClick = () => {
    void load().then(({ controller }) => controller.start({ pushToTalk: false })).catch(() => {});
  };

  /** Reaching for the panel is intent enough to pay for it, without starting. */
  const onWarm = () => { void load().catch(() => {}); };

  /**
   * Push-to-talk before the controller exists. Only warms the module: replaying
   * a hold across an await would race the keyup, and by the time anyone holds
   * Space deliberately the idle load has long since won.
   */
  function onPushToTalkKey(event) {
    if (event.code !== 'Space' && event.key !== ' ') return;
    onWarm();
  }

  ui.button?.addEventListener('click', onButtonClick);
  ui.button?.addEventListener('focus', onWarm);
  ui.root?.addEventListener('mouseenter', onWarm);
  window.addEventListener('keydown', onPushToTalkKey, true);
  cancelIdle = whenIdle(() => { void load().catch(() => {}); }, idleTimeoutMs);

  return {
    /**
     * Resolves when the stack is up — what a QA harness awaits instead of
     * polling for `window.__gevVoiceCommands`. Awaiting it does not itself
     * trigger the load; the bounded idle above guarantees one always does.
     */
    ready,
    load,
    isLoaded: () => loaded !== null,
  };
}
