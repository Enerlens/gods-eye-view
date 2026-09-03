// src/globeHeadingTape.js
/**
 * Camera heading tape for the ordinary globe view.
 *
 * Orientation is one of the two conventions the printed map guaranteed for
 * free (the sheet's top edge was north) and that a free-flying 3D camera
 * removes without announcing it. GEV already had the answer — the cockpit
 * carries a compass tape and a heading readout — but both live inside
 * `#cockpit-*` markup and exist only in cockpit view. Outside it, in an
 * application whose camera rotates on drag, nothing on screen said where north
 * was (CARTOGRAPHIE: state the frame the reader is in).
 *
 * This is the rare correction where the spectacle and the cartography ask for
 * exactly the same object: a heading tape is both the instrument the 3D view
 * destroyed and a piece of cockpit furniture. So it reuses the cockpit's own
 * `compassDivisions` / `formatCompassDivision` and the cockpit tape's CSS
 * vocabulary — one convention, two mounts, no chance of the two disagreeing
 * about which way is north.
 *
 * Cost contract, modelled on `scopeMask.js`: sampled on the scene's existing
 * `preRender` signal, throttled, and repainted only when the DIVISION SET
 * changes — a rotation of a few degrees inside one 30° step writes nothing.
 * Under the idle render governor a parked camera produces no frames at all, so
 * a still view costs nothing. The tape hides itself in cockpit view (which has
 * its own) and follows the rest of the chrome into clean view and recording
 * mode via CSS.
 */
import * as Cesium from 'cesium';
import { compassDivisions, formatCompassDivision } from './cockpitMath.js';

/** Minimum gap between camera-heading samples (ms). */
const SAMPLE_INTERVAL_MS = 120;

let _element = null;
let _tape = null;
let _value = null;
let _viewer = null;
let _sampleRemover = null;
let _moveEndRemover = null;
let _lastSignature = null;
let _lastSampleMs = 0;

/** @returns {number|null} Live camera heading in degrees, or null. */
function currentHeadingDeg() {
  const heading = _viewer?.camera?.heading;
  if (!Number.isFinite(heading)) return null;
  const degrees = Cesium.Math.toDegrees(heading);
  return ((degrees % 360) + 360) % 360;
}

/**
 * Repaint the tape when — and only when — the visible division set changed.
 * @returns {void}
 */
function paint() {
  if (!_element) return;
  const heading = currentHeadingDeg();
  if (heading === null) {
    // No camera reading is not "north": blank the readout rather than let the
    // last known heading stand for a heading we no longer have. Guarded on the
    // rendered text, not on internal state, so the blank is idempotent however
    // this path is reached.
    _lastSignature = null;
    if (_tape && _tape.innerHTML !== '') _tape.innerHTML = '';
    if (_value && _value.textContent !== '---') _value.textContent = '---';
    return;
  }
  const divisions = compassDivisions(heading);
  const signature = divisions.join(',');
  const rounded = String(Math.round(heading)).padStart(3, '0');
  if (_value && _value.textContent !== rounded) _value.textContent = rounded;
  if (signature === _lastSignature) return;
  _lastSignature = signature;
  if (!_tape) return;
  _tape.innerHTML = divisions
    .map((division, index) => {
      const slot = index - 3;
      return `<span class="${slot === 0 ? 'active' : ''}" style="--slot:${slot};--depth:${Math.abs(slot)}">`
        + `${formatCompassDivision(division)}</span>`;
    })
    .join('');
}

/**
 * Mount the heading tape and bind it to the camera.
 * Idempotent; a missing `#globe-heading-tape` element is a no-op.
 * @param {Cesium.Viewer} viewer Live viewer.
 * @returns {void}
 */
export function installGlobeHeadingTape(viewer) {
  if (_element || typeof document === 'undefined') return;
  _element = document.getElementById('globe-heading-tape');
  if (!_element) return;
  _viewer = viewer;
  _tape = document.getElementById('globe-heading-divisions');
  _value = document.getElementById('globe-heading-value');

  const preRender = viewer?.scene?.preRender;
  if (preRender?.addEventListener) {
    _sampleRemover = preRender.addEventListener(() => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - _lastSampleMs < SAMPLE_INTERVAL_MS) return;
      _lastSampleMs = now;
      paint();
    });
  }
  // A settled camera pins the exact final heading even if the throttle skipped
  // the last frame of the gesture.
  if (viewer?.camera?.moveEnd?.addEventListener) {
    _moveEndRemover = viewer.camera.moveEnd.addEventListener(paint);
  }
  paint();
}

/** Tear down for tests and hot reloads. */
export function _destroyGlobeHeadingTapeForTest() {
  if (_sampleRemover) _sampleRemover();
  if (_moveEndRemover) _moveEndRemover();
  _sampleRemover = null;
  _moveEndRemover = null;
  _element = null;
  _tape = null;
  _value = null;
  _viewer = null;
  _lastSignature = null;
  _lastSampleMs = 0;
}

/** Test seam: repaint on demand against an injected viewer. */
export function _paintGlobeHeadingTapeForTest({ viewer, element, tape, value }) {
  _viewer = viewer;
  _element = element;
  _tape = tape;
  _value = value;
  _lastSignature = null;
  paint();
}
