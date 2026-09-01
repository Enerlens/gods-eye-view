import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';

/**
 * NOAA NDBC marine observation buoys — latest report per station.
 *
 * Fetched live through the keyless `/api/ndbc` proxy (10-minute TTL, disk
 * cache, serve-stale). Stations are FIXED points, so unlike vessels or
 * aircraft nothing here interpolates or animates: a poll replaces values in
 * place and the render governor is only nudged on that discrete change.
 *
 * NOAA IS THE OPERATOR, NOT THE EXTENT
 * ------------------------------------
 * `latest_obs` republishes international partner moorings beside NOAA's own,
 * so this layer is not a map of American waters. Counted on the 2026-09-01
 * report: 882 stations, 38 in the eastern hemisphere — 28 in the North Sea
 * and north-east Atlantic, 19 in the western Pacific, 2 in the Indian Ocean.
 * The network is DENSEST over the Americas, which the map shows for itself;
 * that density is why the layer used to carry a `US` scope chip, and why it
 * no longer does — see the `marine-buoys` entry in `layerTaxonomy.js`.
 *
 * WHY MOST BUOYS SHOW NO WAVE HEIGHT
 * ----------------------------------
 * The network is not homogeneous. Measured over the full 892-station report on
 * 2026-08-26: 21% carry wave height, 57% sea temperature, 72% wind. Only 533
 * of 892 report wave height OR sea temperature at all. A station with no wave
 * sensor is not a station reporting a flat sea, so a missing value renders as
 * an omitted line — never as `0.0 m` and never as `—` styled like a reading.
 * The layer's status line carries the measured/total split so the sparseness
 * is visible rather than inferred from gaps.
 *
 * COLOR ENCODES SEA STATE, AND ONLY WHERE SEA STATE IS KNOWN
 * ----------------------------------------------------------
 * Buoys reporting wave height are colored on the WMO sea-state ladder. Buoys
 * that report nothing marine stay neutral grey: coloring them by their air
 * temperature or wind would imply a sea reading they never took.
 */

const API_URL = '/api/ndbc';

export const BUOY_OVERLAY_SOURCE_ID = 'marine-buoys';
export const BUOY_OVERLAY_COHORT_LIMIT = 96;
export const BUOY_OVERLAY_COLLISION_CAPACITY = 48;

/** Poll cadence. The proxy TTL is 10 min; this only has to not lag it. */
const UPDATE_INTERVAL_MS = 5 * 60_000;

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/**
 * WMO sea-state bands by significant wave height (metres).
 * Boundaries follow the WMO sea-state code; the colors run calm→severe.
 * @type {ReadonlyArray<{maxM:number, label:string, css:string}>}
 */
export const SEA_STATE_BANDS = Object.freeze([
  Object.freeze({ maxM: 0.1, label: 'Calm', css: '#7fe7ff' }),
  Object.freeze({ maxM: 0.5, label: 'Smooth', css: '#4fd0e0' }),
  Object.freeze({ maxM: 1.25, label: 'Slight', css: '#3ec46f' }),
  Object.freeze({ maxM: 2.5, label: 'Moderate', css: '#d6d13a' }),
  Object.freeze({ maxM: 4, label: 'Rough', css: '#f0a33c' }),
  Object.freeze({ maxM: 6, label: 'Very rough', css: '#f2683c' }),
  Object.freeze({ maxM: 9, label: 'High', css: '#e5453f' }),
  Object.freeze({ maxM: 14, label: 'Very high', css: '#c62dab' }),
  Object.freeze({ maxM: Infinity, label: 'Phenomenal', css: '#9b5bff' }),
]);

/** Neutral color for a station that reports no wave height. */
export const NO_SEA_STATE_CSS = '#8a97a8';

/**
 * Classify a wave height onto the WMO ladder.
 * @param {number|null|undefined} waveHeightM Significant wave height, metres.
 * @returns {{label:string|null, css:string}} Band label (null when unmeasured) and color.
 */
export function seaState(waveHeightM) {
  if (!Number.isFinite(waveHeightM) || waveHeightM < 0) {
    return { label: null, css: NO_SEA_STATE_CSS };
  }
  const band = SEA_STATE_BANDS.find((entry) => waveHeightM <= entry.maxM);
  return { label: band.label, css: band.css };
}

/** Compass point for a bearing in degrees. */
function compass(deg) {
  if (!Number.isFinite(deg)) return '';
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

/** Metres per second → knots. */
export function msToKnots(ms) {
  return Number.isFinite(ms) ? ms * 1.9438444924406 : null;
}

/**
 * Build the card copy for one station.
 *
 * Every line is omitted when its measurement is absent — the sparse-network
 * rule from the module header. A station with no marine reading yields a
 * title and no detail lines at all, which is the honest rendering of a buoy
 * that reported only a timestamp.
 *
 * @param {object} station Parsed NDBC observation.
 * @returns {{title:string, details:string[]}}
 */
export function buoyOverlayCopy(station) {
  const details = [];

  if (Number.isFinite(station?.waveHeightM)) {
    const { label } = seaState(station.waveHeightM);
    const period = Number.isFinite(station.dominantPeriodS)
      ? ` · ${station.dominantPeriodS.toFixed(0)}s`
      : '';
    const direction = Number.isFinite(station.waveDirDeg)
      ? ` ${compass(station.waveDirDeg)}`
      : '';
    details.push(`${station.waveHeightM.toFixed(1)} m${direction}${period} · ${label}`);
  }

  if (Number.isFinite(station?.seaTempC)) {
    details.push(`Sea ${station.seaTempC.toFixed(1)} °C`);
  }

  if (Number.isFinite(station?.windSpeedMs)) {
    const knots = msToKnots(station.windSpeedMs);
    const direction = Number.isFinite(station.windDirDeg)
      ? `${compass(station.windDirDeg)} `
      : '';
    details.push(`Wind ${direction}${knots.toFixed(0)} kt`);
  }

  return { title: String(station?.station ?? 'BUOY'), details };
}

/**
 * Source-owned overlay entry for one buoy.
 * Priority favours the roughest measured seas, so the cohort cap keeps the
 * stations that matter when the screen is crowded. Unmeasured stations sort
 * below every measured one rather than winning a slot by accident.
 */
export function createBuoyOverlayEntry({ id, position, station, accent }) {
  const copy = buoyOverlayCopy(station);
  const wave = Number.isFinite(station?.waveHeightM) ? station.waveHeightM : -1;
  return {
    id: String(id),
    source: BUOY_OVERLAY_SOURCE_ID,
    position,
    variant: 'card',
    title: copy.title,
    details: copy.details,
    accent,
    priority: Math.round(wave * 1000),
    collisionGroup: 'ambient-card',
    zIndex: 30,
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    placement: 'above',
  };
}

/**
 * Render the measured/total split as the one-line `coverage` string the
 * manager prints into the control chip.
 *
 * This field is part of the layer-stats contract as a STRING — `manager.js`
 * interpolates it straight into chip text and into the fallback-detection
 * source string. Handing it an object prints "[object Object]" on the chip,
 * so the numeric breakdown travels separately under `measuring`.
 *
 * @param {?{stations:number, marine:number}} coverage Proxy coverage summary.
 * @returns {string} Chip-ready text, empty when the summary is unusable.
 */
export function coverageLabel(coverage) {
  const stations = Number(coverage?.stations);
  const marine = Number(coverage?.marine);
  if (!Number.isFinite(stations) || stations <= 0) return '';
  if (!Number.isFinite(marine)) return `${stations} stations`;
  return `${marine} of ${stations} measuring sea`;
}

/** Keep the roughest seas, with stable identity as the tie-break. */
export function selectBuoyOverlayCohort(entries, limit = BUOY_OVERLAY_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(
    BUOY_OVERLAY_COHORT_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/**
 * Map one station to a JSON-safe analyst record (analyst query engine seam).
 * Missing fields stay null, never NaN or undefined.
 */
export function mapAnalystRecord(station, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const id = String(station?.station ?? '').trim();
  return {
    id: id || `BUOY-${String(index).padStart(4, '0')}`,
    lat: num(station?.lat),
    lon: num(station?.lon),
    timeMs: num(station?.observedAt),
    waveHeightM: num(station?.waveHeightM),
    dominantPeriodS: num(station?.dominantPeriodS),
    waveDirectionDeg: num(station?.waveDirDeg),
    seaTempC: num(station?.seaTempC),
    airTempC: num(station?.airTempC),
    windSpeedMs: num(station?.windSpeedMs),
    windDirectionDeg: num(station?.windDirDeg),
    pressureHpa: num(station?.pressureHpa),
    seaState: seaState(station?.waveHeightM).label,
  };
}

export function createMarineBuoysLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _stale = false;
  /** @type {?{stations:number, waveHeight:number, seaTemp:number, wind:number, marine:number}} */
  let _coverage = null;
  /** @type {Array<object>} Latest parsed stations, kept for the analyst seam. */
  let _stations = [];

  const layer = {
    id: 'marine-buoys',
    name: 'Marine Buoys',
    icon: '⬡',
    source: 'NOAA NDBC',
    updateInterval: UPDATE_INTERVAL_MS,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource('marine-buoys');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      _stale = false;
      _coverage = null;
      _stations = [];
      overlayHost.setVisible(BUOY_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(BUOY_OVERLAY_SOURCE_ID, true);
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(BUOY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(BUOY_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      try {
        const response = await fetchImpl(API_URL);
        if (!response.ok) {
          _lastError = `NDBC HTTP ${response.status}`;
          return false;
        }

        const payload = await response.json();
        if (!payload || !Array.isArray(payload.stations)) {
          _lastError = 'Malformed NDBC response';
          return false;
        }

        // The proxy already dropped stale rows and rejected non-report bodies;
        // an empty array here therefore means the cache is empty, not that the
        // ocean fell silent. Surface it rather than clearing a good render.
        if (!payload.stations.length) {
          _lastError = 'NDBC reported no stations';
          return false;
        }

        if (!_dataSource) return false;
        _dataSource.entities.removeAll();
        const overlayEntries = [];

        for (const station of payload.stations) {
          if (!Number.isFinite(station?.lat) || !Number.isFinite(station?.lon)) continue;
          const { css } = seaState(station.waveHeightM);
          const color = Cesium.Color.fromCssColorString(css);
          const position = Cesium.Cartesian3.fromDegrees(station.lon, station.lat);
          const measured = Number.isFinite(station.waveHeightM);

          _dataSource.entities.add({
            id: `marine-buoy:${station.station}`,
            position,
            point: {
              // Measured stations read slightly larger — the size difference
              // carries "this one took a reading", the color carries the value.
              pixelSize: measured ? 9 : 6,
              color: color.withAlpha(measured ? 0.95 : 0.6),
              outlineColor: Cesium.Color.BLACK.withAlpha(0.5),
              outlineWidth: 1,
              heightReference: Cesium.HeightReference.NONE,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            properties: {
              ndbcStation: station.station,
              observedAt: station.observedAt ?? null,
              waveHeightM: station.waveHeightM ?? null,
              dominantPeriodS: station.dominantPeriodS ?? null,
              waveDirDeg: station.waveDirDeg ?? null,
              seaTempC: station.seaTempC ?? null,
              airTempC: station.airTempC ?? null,
              windSpeedMs: station.windSpeedMs ?? null,
              windDirDeg: station.windDirDeg ?? null,
              pressureHpa: station.pressureHpa ?? null,
            },
          });

          overlayEntries.push(createBuoyOverlayEntry({
            id: station.station,
            position,
            station,
            accent: css,
          }));
        }

        if (_enabled) {
          overlayHost.setEntries(
            BUOY_OVERLAY_SOURCE_ID,
            selectBuoyOverlayCohort(overlayEntries),
            {
              cohortLimit: BUOY_OVERLAY_COHORT_LIMIT,
              collisionCapacity: BUOY_OVERLAY_COLLISION_CAPACITY,
              moving: false,
            },
          );
        }

        _stations = payload.stations;
        _count = _dataSource.entities.values.length;
        _coverage = payload.coverage ?? null;
        _stale = payload.stale === true;
        _lastUpdate = Number.isFinite(payload.fetchedAt) ? payload.fetchedAt : Date.now();
        _lastError = null;
        return true;
      } catch (error) {
        console.warn('[Data:MarineBuoys] Fetch error:', error);
        _lastError = 'NDBC network error';
        return false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      overlayHost.clearSource(BUOY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(BUOY_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _coverage = null;
      _stations = [];
    },

    /**
     * Snapshot stations as plain JSON-safe records for the analyst engine.
     * On-demand only; returns [] while disabled or empty.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_dataSource || !_dataSource.show) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 2000;
      return _stations.slice(0, limit).map((station, index) => mapAnalystRecord(station, index));
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
        // A string by contract — the manager prints it into the chip. It says
        // "533 of 892 measuring sea" so the display never implies that every
        // rendered buoy carries a sea reading.
        coverage: coverageLabel(_coverage),
        // Numeric breakdown for callers that want the counts rather than the
        // sentence (tests, analyst seam).
        measuring: _coverage,
      };
    },
  };

  return layer;
}

const marineBuoysLayer = createMarineBuoysLayer();

export default marineBuoysLayer;
