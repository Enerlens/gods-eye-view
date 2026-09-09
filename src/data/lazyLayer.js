/**
 * lazyLayer.js — a data layer that costs nothing until someone switches it on.
 *
 * WHY THIS EXISTS. `main.js` used to import all 60 data layers statically, so
 * every one of them landed in the entry chunk: measured on 2026-09-09 with
 * rollup's own module graph, those 60 roots pulled 4 798 kB of the entry's
 * 7 278 kB pre-minification — 66% of the JavaScript a visitor parses before the
 * globe appears, for layers that are all OFF at boot. A reader who opens the
 * app and looks at Paris pays for the CCTV camera model, the AIS vessel
 * decoder, the satellite propagator and 57 others, and switches on none.
 *
 * WHAT THIS IS. A stub that satisfies the `DataLayerManager` layer contract
 * with nothing behind it, plus a `load()` that fetches the real module on
 * first use. The manager is untouched: it registers, draws and seals these
 * exactly as before, because the stub answers every question the manager asks
 * of a layer that is OFF, and hands the rest to the module the moment one
 * exists.
 *
 * THE SEAM IS `init()`. The manager calls it once, before `enable()`, and only
 * for a layer being turned on — see `_doToggle()`. So `init()` is where the
 * dynamic import is awaited. Everything the manager can legitimately call
 * BEFORE that point is enumerated in `LAZY_LAYER_CAPABILITIES` below and
 * answered here without a fetch; everything else does not exist on the stub at
 * all, which is the same answer a `typeof layer.x === 'function'` guard got
 * from a layer that was off.
 */

/**
 * The optional layer methods a caller can reach BEFORE the module is loaded.
 *
 * This list is not decorative: `DataLayerManager` decides what a layer
 * SUPPORTS by probing for these (`typeof entry.module.setParams === 'function'`
 * in `_reserveLayerParamsIntent`, and four more like it). A stub that exposed
 * `setParams` for a layer that has none would make the manager accept a
 * parameter intent it should have refused, so presence has to mirror the real
 * module exactly — which is what `layerManifest.test.mjs` proves, per layer,
 * by loading every module and comparing.
 *
 * Everything NOT in this list — `getRowControls`, `trackById`, `selectCamera`,
 * the seventy-odd methods layers publish for the UI and the voice actions —
 * appears on the stub only after `adopt()`. Those callers all reach a layer
 * through `dataManager.layers.get(id)?.module` and all guard on the method
 * being a function, and none of them has anything to say to a layer that is
 * off, so "absent until loaded" is the honest answer rather than a regression.
 */
export const LAZY_LAYER_CAPABILITIES = Object.freeze([
  'destroy',
  'getStats',
  'setParams',
  'getParams',
  'resolveTrackingRestoreTarget',
  'cancelPendingRestore',
  'cancelPendingTrackingRestore',
  'setLifecyclePresentation',
  'attachDataManager',
]);

/** The four lifecycle methods the manager calls unconditionally on every layer. */
export const LAZY_LAYER_REQUIRED_METHODS = Object.freeze(['init', 'enable', 'disable', 'update']);

/** Stats shape the manager's own `_moduleStats()` fallback returns. */
const EMPTY_STATS = Object.freeze({ count: 0, lastUpdate: null });

/**
 * Build the stub for one manifest descriptor.
 *
 * @param {object} descriptor One `LAYER_MANIFEST` entry: `{id, name, icon,
 *   source, showInTogglePanel?, capabilities, defaultParams?, load}`.
 * @returns {object} A layer module the `DataLayerManager` can register.
 */
export function createLazyLayer(descriptor) {
  if (!descriptor || typeof descriptor.id !== 'string' || !descriptor.id) {
    throw new Error('Lazy layer descriptor must carry a stable id');
  }
  if (typeof descriptor.load !== 'function') {
    throw new Error(`Lazy layer ${descriptor.id} has no loader`);
  }
  const capabilities = new Set(descriptor.capabilities || []);
  for (const capability of capabilities) {
    if (!LAZY_LAYER_CAPABILITIES.includes(capability)) {
      throw new Error(`Unknown lazy-layer capability on ${descriptor.id}: ${capability}`);
    }
  }

  /** The real module, once loaded. Null is the whole point of this file. */
  let loadedModule = null;
  /** In-flight load, so a burst of calls costs one import. */
  let loadPromise = null;
  /** State handed to the stub before the module existed, replayed on adopt. */
  let pendingDataManager = null;
  let pendingLifecyclePresentation = null;
  const pendingParamCalls = [];

  const layer = {};
  const define = (key, value) => Object.defineProperty(layer, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });

  define('id', descriptor.id);
  define('name', descriptor.name);
  define('icon', descriptor.icon);
  define('source', descriptor.source);
  // Only carried when the module publishes `false`: `getAll()` reads
  // `showInTogglePanel !== false`, so absent and `true` are the same answer and
  // shipping the field for 59 layers that want the default would be noise.
  if (descriptor.showInTogglePanel === false) define('showInTogglePanel', false);

  /**
   * Republish the loaded module's surface on the stub and drain what was
   * buffered for it.
   */
  const adopt = (module) => {
    if (!module || typeof module !== 'object') {
      throw new Error(`Lazy layer ${descriptor.id} loaded nothing`);
    }
    if (module.id !== descriptor.id) {
      throw new Error(`Lazy layer ${descriptor.id} loaded ${String(module.id)}`);
    }
    loadedModule = module;
    for (const key of Object.keys(module)) {
      if (key === 'id') continue;
      if (typeof module[key] === 'function') {
        // Forwarded, never copied. A layer module is an object literal whose
        // methods read their siblings through `this` in places, so the receiver
        // has to stay the module — copying the function onto the stub would
        // silently move that state onto the wrong object.
        define(key, (...args) => loadedModule[key](...args));
      } else {
        // Live accessors rather than a snapshot: `refreshInterval` and friends
        // are read by `_armUpdateLoop()` after enable, and a few layers mutate
        // their own published fields as they run.
        Object.defineProperty(layer, key, {
          get: () => loadedModule[key],
          set: (next) => { loadedModule[key] = next; },
          enumerable: true,
          configurable: true,
        });
      }
    }
    // Replayed in the order the eager build applied them: the manager reference
    // is attached at registration, lifecycle presentation happens during a
    // transition, and parameters land last — `_doToggle()` applies
    // `beforeEnableParams` after `init()` for exactly that reason.
    if (pendingDataManager !== null && typeof loadedModule.attachDataManager === 'function') {
      loadedModule.attachDataManager(pendingDataManager);
    }
    pendingDataManager = null;
    if (pendingLifecyclePresentation !== null
      && typeof loadedModule.setLifecyclePresentation === 'function') {
      loadedModule.setLifecyclePresentation(pendingLifecyclePresentation);
    }
    pendingLifecyclePresentation = null;
    if (typeof loadedModule.setParams === 'function') {
      for (const call of pendingParamCalls) loadedModule.setParams(call.params, call.options);
    }
    pendingParamCalls.length = 0;
  };

  const materialize = () => {
    if (loadedModule) return Promise.resolve(loadedModule);
    if (!loadPromise) {
      loadPromise = Promise.resolve()
        .then(() => descriptor.load())
        .then((module) => { adopt(module); return loadedModule; })
        .catch((error) => {
          // A chunk that 404s after a redeploy is the realistic failure here.
          // Dropping the promise lets the next toggle try again instead of
          // pinning the layer to one dead fetch for the life of the tab.
          loadPromise = null;
          throw error;
        });
    }
    return loadPromise;
  };

  for (const method of LAZY_LAYER_REQUIRED_METHODS) {
    define(method, async (...args) => {
      const module = await materialize();
      return module[method](...args);
    });
  }

  if (capabilities.has('destroy')) {
    define('destroy', (...args) => {
      // Nothing was ever built, so there is nothing to tear down — and fetching
      // the chunk to run its destructor would be the one download this whole
      // file exists to avoid. `destroyAll()` on a fresh page hits this 60 times.
      if (!loadedModule) return true;
      return loadedModule.destroy(...args);
    });
  }

  if (capabilities.has('getStats')) {
    define('getStats', (...args) => (
      loadedModule ? loadedModule.getStats(...args) : { ...EMPTY_STATS }
    ));
  }

  if (capabilities.has('setParams')) {
    define('setParams', (params, options) => {
      if (loadedModule) return loadedModule.setParams(params, options);
      // Buffered as CALLS, not merged into one: replaying them in order is the
      // only way to reproduce a module whose own merge rules we do not know.
      // The optimistic `true` is the one approximation here — a module that
      // would have REFUSED these parameters says so late, once it loads.
      pendingParamCalls.push({ params, options });
      return true;
    });
  }

  if (capabilities.has('getParams')) {
    define('getParams', () => {
      if (loadedModule) return loadedModule.getParams();
      // What the module itself answers before anything has touched it, carried
      // in the manifest and re-derived from the module on every `npm test`,
      // plus whatever the stub has been handed since.
      let params = { ...(descriptor.defaultParams || {}) };
      for (const call of pendingParamCalls) params = { ...params, ...(call.params || {}) };
      return params;
    });
  }

  if (capabilities.has('resolveTrackingRestoreTarget')) {
    define('resolveTrackingRestoreTarget', async (...args) => {
      // Only reachable through `resolveLayerTrackingTarget()`, which refuses
      // unless the layer is already enabled — so in practice the module is
      // loaded before this runs. The await is here for the case where it is not.
      const module = await materialize();
      return module.resolveTrackingRestoreTarget(...args);
    });
  }

  for (const method of ['cancelPendingRestore', 'cancelPendingTrackingRestore']) {
    if (!capabilities.has(method)) continue;
    define(method, (...args) => {
      // A module that does not exist has no pending restore to cancel. Loading
      // one to tell it so would be worse than useless.
      if (!loadedModule) return undefined;
      return loadedModule[method](...args);
    });
  }

  if (capabilities.has('setLifecyclePresentation')) {
    define('setLifecyclePresentation', (state) => {
      if (loadedModule) return loadedModule.setLifecyclePresentation(state);
      // Only the last one matters: this is a presentation state, not a queue.
      pendingLifecyclePresentation = state;
      return undefined;
    });
  }

  if (capabilities.has('attachDataManager')) {
    define('attachDataManager', (manager) => {
      if (loadedModule) return loadedModule.attachDataManager(manager);
      pendingDataManager = manager;
      return undefined;
    });
  }

  // Two seams the QA harnesses and this file's own tests need, and nothing
  // else does: whether the chunk has been paid for, and a way to pay for it
  // without switching the layer on.
  Object.defineProperty(layer, '__lazy', {
    value: Object.freeze({
      isLoaded: () => loadedModule !== null,
      load: materialize,
    }),
    enumerable: false,
    configurable: true,
  });

  return layer;
}
