/**
 * Shared pick-ownership registry for layers that install their own
 * ScreenSpaceEventHandler click handlers.
 *
 * Two questions live here, and both are about WHOSE click it is rather than
 * where it landed: {@link isOwnedByOtherLayer}, so a layer leaves a sibling's
 * marker alone, and {@link isWorldPick}, so a layer can still recognise a
 * click on the map itself now that the map is a 3D Tiles surface.
 *
 * Problem solved: each entity layer (commercial flights, military flights)
 * receives every LEFT_CLICK. When the user clicks a military aircraft while
 * a commercial flight is tracked, the commercial handler used to classify
 * the pick as "empty space" and clear tracking (with a camera flight) at the
 * same moment the military handler started tracking — two competing camera
 * commands. Layers now register a predicate so siblings can recognize picks
 * that belong to someone else and leave them alone.
 */

/** @type {Map<string, (pickedId: string) => boolean>} layerId -> ownership predicate */
const _owners = new Map();

/**
 * Resolves a scene.pick() result to a String pick id for the ownership scan.
 *
 * Layers use heterogeneous pick ids: flights/military/bikeshare/CCTV use
 * strings, satellites use numeric NORAD catalog ids, live AIS vessels attach
 * the vessel record OBJECT (identity = its `mmsi`), and entity picks surface
 * the Cesium Entity (identity = its string `id`). Everything is coerced to a
 * String so predicates match against one canonical form.
 *
 * @param {object|null|undefined} picked - Result of `scene.pick()`.
 * @returns {string|null} Canonical pick id, or null when the pick carries none.
 */
export function resolvePickId(picked) {
  if (!picked) return null;
  const unwrap = (id) => {
    if (id === null || id === undefined) return undefined;
    if (typeof id === 'object') {
      // AIS vessel record (id object with .mmsi) or Cesium Entity (.id string)
      if (typeof id.mmsi === 'string' || typeof id.mmsi === 'number') return id.mmsi;
      if (typeof id.id === 'string' || typeof id.id === 'number') return id.id;
      return undefined;
    }
    return id;
  };
  let id = unwrap(picked.id);
  if (id === undefined) id = unwrap(picked.primitive?.id);
  return (typeof id === 'string' || typeof id === 'number') ? String(id) : null;
}

/**
 * Whether a pick is the WORLD rather than an object somebody could select.
 *
 * ── The bug this exists to end, and it shipped in four places ─────────────
 * Before the photorealistic globe, "the reader clicked the map" was
 * `!picked` — `scene.pick` answers nothing for the bare globe, which is not a
 * primitive. With a 3D Tiles surface under the cursor that stopped being true,
 * and the layers that had written `if (!picked) clearSelection()` quietly lost
 * the ability to close their own cards: measured 2026-09-10 over Paris at
 * 700 m with 470 tiles of content ready, **six probes across the screen, six
 * non-falsy picks**, each a plain pick object whose `primitive` is the
 * `Cesium3DTileset` and whose `id` — and whose `primitive.id` — is `undefined`.
 *
 * That last detail is the whole test. A tile feature carries NO id, so it can
 * never be claimed by a `registerPickOwner` predicate and can never be
 * selected by anybody; `resolvePickId` already answers `null` for it, exactly
 * as it does for the empty pick. So "nobody could own this" is the durable
 * statement, and it holds for the bare globe, for terrain, and for the
 * photoreal tileset alike — while `!picked` was a statement about which
 * SURFACE happened to be switched on.
 *
 * `localGeojson.js` reached this conclusion first and wrote it in a comment
 * next to its own handler; it is here so the next handler inherits it instead
 * of rediscovering it.
 *
 * @param {object|null|undefined} picked - Result of `scene.pick()`.
 * @returns {boolean} True for the empty pick and for anything with no pick id.
 */
export function isWorldPick(picked) {
  return !picked || resolvePickId(picked) === null;
}

/**
 * Registers a pick-ownership predicate for a layer.
 * @param {string} layerId - Owning layer id (e.g. 'flights').
 * @param {(pickedId: string) => boolean} predicate - Returns true when the
 *   picked primitive/entity id belongs to this layer.
 * @returns {void}
 */
export function registerPickOwner(layerId, predicate) {
  if (!layerId || typeof predicate !== 'function') return;
  _owners.set(layerId, predicate);
}

/**
 * Removes a layer's ownership predicate (call on disable/destroy).
 * @param {string} layerId - Owning layer id.
 * @returns {void}
 */
export function unregisterPickOwner(layerId) {
  _owners.delete(layerId);
}

/**
 * True when some OTHER registered layer owns the picked id.
 * @param {string} layerId - The asking layer's id (excluded from the scan).
 * @param {string} pickedId - Picked primitive/entity id.
 * @returns {boolean}
 */
export function isOwnedByOtherLayer(layerId, pickedId) {
  if (!pickedId) return false;
  for (const [ownerId, predicate] of _owners) {
    if (ownerId === layerId) continue;
    try {
      if (predicate(pickedId)) return true;
    } catch {
      // a broken predicate must never break click handling
    }
  }
  return false;
}
