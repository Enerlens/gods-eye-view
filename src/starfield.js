import * as Cesium from 'cesium';

/**
 * The star field, moved off the boot path and onto the basemaps it belongs to.
 *
 * ── WHY IT IS NOT THE VIEWER'S DEFAULT ANY MORE ─────────────────────────────
 *
 * Cesium builds a `SkyBox` for every Viewer and fills it with the Tycho-2
 * catalogue: six 1024×1024 JPEGs, **848 kB**, fetched on every cold start
 * before anyone has looked at anything. Measured on the machine this project
 * is actually for (2 cores, 10 Mbit/s, cache empty), removing it moved the
 * boot from **5.3 s to 3.6 s** and the app's own payload from 3.51 MB to
 * 2.67 MB. The stars cost 1.7 seconds of waiting, which is not what they are
 * worth on a page whose first job is to show a map.
 *
 * ── WHY THEY COME BACK, AND EXACTLY WHERE ───────────────────────────────────
 *
 * They were never decoration in general — they are decoration for ONE reading
 * of the globe. On a drawn map (`Plan Google`, `Relief Google`, `OSM`,
 * `Plan IGN`) the Earth is a diagram, and a diagram does not sit in space; the
 * black is a background, not a sky. On a photographic basemap — `Satellite`,
 * `Bing Aerial`, Google's photoreal 3D — the Earth is a photograph taken from
 * orbit, and the sky around it is part of the same claim. So the star field
 * follows the imagery, which is also the only rule short enough to be obvious
 * from the interface without being explained.
 *
 * ── WHY IT IS NEVER LOADED DURING BOOT, EVEN ON A SATELLITE STACK ───────────
 *
 * `sync()` is called at startup too, and a visitor whose build opens on a
 * photographic basemap would otherwise pay exactly the 848 kB this change
 * exists to remove. The first install is therefore deferred to browser idle:
 * the download starts once the boot burst has drained, so it competes with
 * nothing. Later switches — somebody choosing a basemap — install straight
 * away, because by then the boot is long over and a visible delay between the
 * click and the sky would just read as a bug.
 *
 * Cesium's own laziness does the rest: `SkyBox` requests its textures on its
 * first `update()`, so constructing one and showing it IS the trigger, and a
 * hidden one costs nothing. Once built it is kept — switching back and forth
 * between two basemaps must not re-download the sky.
 */

/**
 * Basemaps that show the Earth as photographed rather than drawn.
 *
 * Ids, not `kind`s: `kind` groups by PROVIDER (`ion` holds both Bing Aerial
 * and Bing Labels, `ign-wmts` holds both the orthophoto and the Plan), and
 * provider is not what decides whether the picture is a photograph.
 */
export const STARFIELD_STACK_IDS = Object.freeze([
  'photoreal',
  'bing-aerial',
  'bing-labels',
  'ign-ortho',
]);

/** @param {string|null|undefined} stackId @returns {boolean} */
export function stackWantsStarfield(stackId) {
  return STARFIELD_STACK_IDS.includes(stackId);
}

const SKYBOX_FACES = Object.freeze({
  positiveX: 'px', negativeX: 'mx',
  positiveY: 'py', negativeY: 'my',
  positiveZ: 'pz', negativeZ: 'mz',
});

/** The six Tycho-2 faces, addressed through Cesium's own asset base URL. */
function skyBoxSources() {
  return Object.fromEntries(
    Object.entries(SKYBOX_FACES).map(([axis, suffix]) => [
      axis,
      Cesium.buildModuleUrl(`Assets/Textures/SkyBox/tycho2t3_80_${suffix}.jpg`),
    ]),
  );
}

/**
 * Run `task` when the browser is not busy, with a bounded wait.
 *
 * `requestIdleCallback` alone is not enough: a tab that never goes idle would
 * never show a sky at all, so the timeout is the contract and the idle window
 * is the optimisation. Safari has no `requestIdleCallback`, hence the fallback.
 *
 * @param {() => void} task
 * @param {number} timeoutMs
 * @returns {() => void} cancel
 */
function whenIdle(task, timeoutMs) {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(task, { timeout: timeoutMs });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(task, timeoutMs);
  return () => window.clearTimeout(handle);
}

/**
 * Bind a star field to the active basemap.
 *
 * @param {Cesium.Scene} scene
 * @param {object} [options]
 * @param {(reason: string) => void} [options.requestRender] The render
 *   governor's request function. A parked scene will not repaint on its own
 *   when the sky appears, and an idle-scheduled install lands outside any
 *   frame — so the one that turns the sky on has to ask for the frame that
 *   shows it.
 * @param {number} [options.idleTimeoutMs]
 * @returns {{sync: (stackId: string, opts?: {defer?: boolean}) => void,
 *            isLoaded: () => boolean, destroy: () => void}}
 */
export function installStarfield(scene, { requestRender = null, idleTimeoutMs = 4000 } = {}) {
  let cancelPending = null;
  let destroyed = false;

  const build = () => {
    cancelPending = null;
    if (destroyed || scene.isDestroyed?.()) return;
    if (!scene.skyBox) scene.skyBox = new Cesium.SkyBox({ sources: skyBoxSources() });
    scene.skyBox.show = true;
    requestRender?.('starfield');
  };

  return {
    /**
     * @param {string} stackId The basemap now on the globe.
     * @param {{defer?: boolean}} [opts] `defer` on the boot call only.
     */
    sync(stackId, { defer = false } = {}) {
      if (destroyed) return;
      if (!stackWantsStarfield(stackId)) {
        cancelPending?.();
        cancelPending = null;
        // Hidden, not destroyed: the textures are already paid for, and a
        // reader toggling between two basemaps must not re-download the sky.
        if (scene.skyBox) {
          scene.skyBox.show = false;
          requestRender?.('starfield');
        }
        return;
      }
      if (scene.skyBox) { build(); return; }
      if (cancelPending) return;
      cancelPending = defer ? whenIdle(build, idleTimeoutMs) : (build(), null);
    },
    /** Whether the six faces have been asked for yet. Diagnostics and QA. */
    isLoaded() {
      return Boolean(scene.skyBox);
    },
    destroy() {
      destroyed = true;
      cancelPending?.();
      cancelPending = null;
    },
  };
}
