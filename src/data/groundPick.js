/**
 * Where on the globe a screen point lands.
 *
 * The one question every layer that draws GROUND has to answer, and the one
 * `scene.pick` answers badly. Ground-classification geometry — the cadastral
 * parcels, the PLU wash — is picked by whichever shadow volume the ray enters
 * first, and at the grazing angles this globe is flown at that is not reliably
 * the shape under the pointer: `cadastreParcels.js` paid for that lesson by
 * lighting up a parcel somewhere else. A layer that already holds its polygons
 * in memory should ask them directly, and to do that it needs a coordinate.
 *
 * THREE SOURCES, IN THE ORDER OF HOW WELL EACH ANSWERS "WHAT IS THE OPERATOR
 * POINTING AT". The rendered terrain first, because that is the surface the
 * shapes are draped on and it is exact. The depth buffer second, which is what
 * answers on the photoreal stack where the globe is hidden. The bare ellipsoid
 * last, which ignores relief and is wrong by the local terrain height times the
 * tangent of the view angle — acceptable as a floor, never as a first choice.
 *
 * AND THE DEPTH BUFFER IS VALIDATED, not trusted. Over empty sky it hands back
 * a finite Cartesian that is not a place: `isPickedWorldPosition` rejects the
 * ones that would otherwise convert without complaint into somewhere
 * underground and reverse-geocode as 0°, 0°.
 *
 * @module data/groundPick
 */

import * as Cesium from 'cesium';
import { isPickedWorldPosition } from './scenePick.js';

/**
 * The ground point under a screen position, in degrees.
 *
 * @param {?object} viewer Cesium viewer.
 * @param {{x:number, y:number}} windowPosition Canvas coordinates.
 * @returns {?{lon:number, lat:number}} Null when the ray met nothing real.
 */
export function sceneGroundPoint(viewer, windowPosition) {
  const scene = viewer?.scene;
  if (!scene || !windowPosition) return null;
  const ellipsoid = scene.globe?.ellipsoid || Cesium.Ellipsoid.WGS84;
  const toDegrees = (cartesian) => {
    if (!isPickedWorldPosition(cartesian)) return null;
    const carto = ellipsoid.cartesianToCartographic(cartesian);
    if (!carto) return null;
    const lon = Cesium.Math.toDegrees(carto.longitude);
    const lat = Cesium.Math.toDegrees(carto.latitude);
    return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat } : null;
  };

  if (scene.globe?.show !== false) {
    try {
      const ray = scene.camera?.getPickRay?.(windowPosition);
      const hit = ray ? scene.globe.pick(ray, scene) : null;
      const point = toDegrees(hit);
      if (point) return point;
    } catch { /* no terrain resident under this pixel */ }
  }
  try {
    if (scene.pickPositionSupported) {
      const point = toDegrees(scene.pickPosition(windowPosition));
      if (point) return point;
    }
  } catch { /* no depth texture */ }
  try {
    return toDegrees(scene.camera?.pickEllipsoid?.(windowPosition, ellipsoid));
  } catch {
    return null;
  }
}

export default sceneGroundPoint;
