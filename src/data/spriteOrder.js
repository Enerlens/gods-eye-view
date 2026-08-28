/** Bottom-to-top order for near-plane-clamped contact sprite collections. */
export const SPRITE_LAYER_ORDER = Object.freeze([
  'cctv',
  'firms',
  'gas-fr',
  'power-grid',
  'bikeshare',
  'shared-mobility-fr',
  'transit-fr',
  'ais',
  'military',
  'flights',
]);

/**
 * One layer may own SEVERAL collections — the French shared-mobility layer
 * draws station dots from a `PointPrimitiveCollection` and vehicle glyphs from
 * a `BillboardCollection`, and both have to land in this layer's slot rather
 * than one of them sinking under every other layer. Registration order within
 * a layer is its own bottom-to-top order.
 * @type {Map<string, Array<Object>>}
 */
const _collections = new Map();

/**
 * Register a primitive collection for a sprite layer.
 * Registering twice is idempotent; registering a second, distinct collection
 * stacks it above the first.
 * @param {string} layerId - Stable sprite-order layer key.
 * @param {Object} collection - Cesium billboard/point primitive collection.
 * @returns {void}
 */
export function registerSpriteCollection(layerId, collection) {
  if (!layerId || !collection) return;
  const registered = _collections.get(layerId);
  if (!registered) {
    _collections.set(layerId, [collection]);
    return;
  }
  // Drop collections a re-init already destroyed, so a layer that rebuilds its
  // collection does not accumulate dead entries across enable cycles.
  const live = registered.filter((entry) => entry !== collection && !entry.isDestroyed?.());
  live.push(collection);
  _collections.set(layerId, live);
}

/**
 * Remove a registered collection (primarily useful to lifecycle tests).
 * @param {string} layerId - Stable sprite-order layer key.
 * @param {Object} [collection] - Optional identity guard against stale teardown;
 *   omitted, every collection registered for the layer is dropped.
 * @returns {void}
 */
export function unregisterSpriteCollection(layerId, collection) {
  if (!collection) {
    _collections.delete(layerId);
    return;
  }
  const registered = _collections.get(layerId);
  if (!registered) return;
  const remaining = registered.filter((entry) => entry !== collection);
  if (remaining.length === registered.length) return; // identity guard: not ours
  if (remaining.length) _collections.set(layerId, remaining);
  else _collections.delete(layerId);
}

/**
 * Reassert deterministic sprite stacking after any layer enable/init.
 * Cesium's stable translucent sort otherwise preserves first-enable primitive
 * order. Raising bottom-to-top makes flights the final/top collection.
 * @param {Cesium.Viewer|Object} viewer - Active viewer.
 * @returns {void}
 */
export function restoreSpriteOrder(viewer) {
  if (!viewer || viewer.isDestroyed?.()) return;
  const scene = viewer.scene;
  const primitives = scene?.primitives;
  if (!primitives || scene.isDestroyed?.() || primitives.isDestroyed?.()) return;

  for (const layerId of SPRITE_LAYER_ORDER) {
    for (const collection of _collections.get(layerId) || []) {
      if (collection.isDestroyed?.()) continue;
      if (primitives.contains?.(collection) === false) continue;
      primitives.raiseToTop(collection);
    }
  }
}

/**
 * Explicit layer-enable wiring seam. Production callers use the shared
 * restorer by default; tests inject a spy to pin each enable path without
 * constructing a WebGL viewer.
 * @param {string} layerId - Sprite layer whose enable path is restoring order.
 * @param {Cesium.Viewer|Object} viewer - Active viewer.
 * @param {(viewer: Object) => void} [restore=restoreSpriteOrder] - Test seam.
 * @returns {void}
 */
export function restoreSpriteOrderOnEnable(
  layerId,
  viewer,
  restore = restoreSpriteOrder,
) {
  if (!SPRITE_LAYER_ORDER.includes(layerId) || typeof restore !== 'function') return;
  restore(viewer);
}
