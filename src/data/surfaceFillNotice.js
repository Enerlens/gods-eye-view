// src/data/surfaceFillNotice.js
/**
 * Whether a thematic SURFACE FILL is currently being draped over building
 * geometry, and the sentence that says so.
 *
 * A choropleth spends HUE on the datum. Hue is the one visual variable that
 * perspective does not distort — two départements read the same colour at the
 * top and the bottom of the frame — which is why the layers below are correct
 * to keep painting in an oblique 3D view.
 *
 * What DOES modulate hue is shading, and there is exactly one place it happens:
 * when the photorealistic tileset is the surface, the globe is hidden, so the
 * fill has to be classified as `CESIUM_3D_TILE` — and that mesh is the ground
 * and the buildings in ONE geometry. There is no flag that classifies only the
 * ground: the fill climbs the façades, where the tileset's own baked shading
 * darkens it. Six declared bands stop being six perceived bands
 * (CARTOGRAPHIE B3) on every vertical surface in the frame.
 *
 * Cesium cannot split that drape, so the map says it instead of pretending.
 * The alternative — forcing the camera to nadir, or unloading the tileset when
 * a zonal layer turns on — was considered and rejected: it is the most
 * intrusive gesture the product can make, for a defect the reader would not
 * otherwise notice, and immersion is this product's main asset.
 */

/**
 * True when a ground-classified fill is landing on the photorealistic mesh
 * (ground AND buildings) rather than on terrain.
 *
 * The test is the same one every zonal layer already uses to choose its
 * `ClassificationType`: a hidden globe means the tileset is the only surface
 * left to classify onto.
 * @param {{globe?: {show?: boolean}}|null|undefined} scene Cesium scene.
 * @returns {boolean} Whether the fill drapes over buildings.
 */
export function surfaceFillDrapesBuildings(scene) {
  return Boolean(scene?.globe) && scene.globe.show === false;
}

/** The sentence shown in the map legend while {@link surfaceFillDrapesBuildings}. */
export const SURFACE_FILL_DRAPE_NOTE =
  'Area fills are draped on the photorealistic mesh, buildings included — '
  + 'shading on a wall darkens the colour you read there. Switch to a flat map '
  + 'stack to compare bands by eye.';
