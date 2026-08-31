import * as Cesium from 'cesium';

/**
 * Camera presets for notable locations. The boot view is NOT one of these —
 * it is DEFAULT_CITY_VIEW below. This table and flyToPreset() currently have no
 * callers anywhere in the app; left as-is rather than grown or deleted here.
 */
export const CAMERA_PRESETS = {
  austin: {
    destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 800),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-35),
      roll: 0.0,
    },
  },
  sf: {
    destination: Cesium.Cartesian3.fromDegrees(-122.4194, 37.7749, 1000),
    orientation: {
      heading: Cesium.Math.toRadians(30),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
  nyc: {
    destination: Cesium.Cartesian3.fromDegrees(-73.9857, 40.7484, 1200),
    orientation: {
      heading: Cesium.Math.toRadians(-20),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
};

/**
 * Fly the camera to a preset location with a smooth animation.
 */
export function flyToPreset(viewer, presetName, duration = 3.0) {
  const preset = CAMERA_PRESETS[presetName];
  if (!preset) return;

  viewer.camera.flyTo({
    destination: preset.destination,
    orientation: preset.orientation,
    duration,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });
}

/**
 * Where the globe opens when a visit carries no share state: the Eiffel Tower,
 * framed toward the Trocadéro. The same 315° heading the Paris landmark preset
 * in ./locations.js uses, so the opening shot and the LOCATION pill agree.
 */
export const DEFAULT_CITY_VIEW = Object.freeze({
  label: 'Paris',
  lon: 2.2945,
  lat: 48.8584,
  approachAltitudeM: 25000,
  settleAltitudeM: 600,
  headingDeg: 315,
  pitchDeg: -30,
});

/**
 * Set the camera on the default city at load with a cinematic fly-in.
 * @param {Cesium.Viewer} viewer
 * @param {object} [view] Override target, same shape as DEFAULT_CITY_VIEW.
 */
export function flyToDefaultCity(viewer, view = DEFAULT_CITY_VIEW) {
  // Start from a high altitude, then fly down
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(view.lon, view.lat, view.approachAltitudeM),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0.0,
    },
  });

  // Cinematic fly-in after a brief pause
  setTimeout(() => {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(view.lon, view.lat, view.settleAltitudeM),
      orientation: {
        heading: Cesium.Math.toRadians(view.headingDeg),
        pitch: Cesium.Math.toRadians(view.pitchDeg),
        roll: 0.0,
      },
      duration: 4.0,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, 500);
}
