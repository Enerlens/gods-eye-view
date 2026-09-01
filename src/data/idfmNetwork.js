import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { governorRequestRender } from '../renderGovernor.js';
import {
  ADDRESS_SCAN_MOVE_DEBOUNCE_MS,
  ADDRESS_SCAN_OVERLAY_OPTIONS,
  SEAT_SETTLE_MS,
  cardFromEntity,
  createAddressScanOverlayEntry,
  emphasiseAddressMarker,
  renderedGroundM,
  restoreAddressMarker,
  seatEntitiesOnGround,
} from './addressScanLayer.js';
import { addressMarkerGlyph, idfmStopGlyphKind } from './addressMarkerIcons.js';
import { IDFM_MODES } from './idfmFeed.js';
import { transitVehicleGlyph } from './transitVehicleIcons.js';
import { greatCircleKm } from './trafficBounds.js';

/**
 * Île-de-France Mobilités — the Paris network drawn as an OFFER, because
 * nobody publishes where its vehicles are.
 *
 * THE ABSENCE THIS LAYER ANSWERS. `transitCoverage.js` measured it across all
 * 148 queryable national feeds: **0 live vehicles in Paris intra-muros**
 * against 453 in Bordeaux, because IDFM publishes no GTFS-Realtime vehicle
 * positions at all. The flagship live-transit layer is therefore blank over the
 * one city this fork opens on, and blank is indistinguishable from broken.
 *
 * What IDFM does publish, keylessly and completely, is the network: 37,956
 * stops and 2,121 lines, each line with its OFFICIAL colour. For someone
 * deciding where to live that is the more useful half — not "where is the bus
 * right now" but "which lines, which modes, how far from the door, and is the
 * stop step-free". So this layer draws the offer and never fakes a vehicle.
 *
 * WHY IT IS A VIEWPORT LAYER while its four French siblings are point scans:
 * the stops API takes a bounding box, so the viewport IS the natural query.
 *
 * @module data/idfmNetwork
 */

/** Above this the stop density is a smear, and the box exceeds what is served. */
const ACTIVATION_ALTITUDE_M = 20_000;
/** Refresh cadence. A stop referential does not move; this is camera-driven. */
const UPDATE_INTERVAL_MS = 300_000;
/** Movement, in km, before the box is re-queried. */
const MIN_SHIFT_KM = 0.4;
/** Widest box the proxy accepts, in degrees per side. */
const MAX_BOX_DEG = 1;
/** Stops asked for in one query. */
const STOP_LIMIT = 100;

/**
 * Fallback colours by mode, used ONLY for stops.
 *
 * The lines carry their own published livery and it is never overridden. A
 * stop, though, serves several lines at once and has no colour of its own, so
 * these are the mode families — deliberately muted, so they never read as a
 * line colour a Parisian would recognise.
 */
export const IDFM_MODE_COLORS = Object.freeze({
  metro: '#ffb03d',
  rail: '#3d8bff',
  tram: '#3dd6c4',
  bus: '#c9d4e0',
  funicular: '#ff7ad9',
  cableway: '#ff7ad9',
});
const COLOR_UNKNOWN_MODE = Cesium.Color.fromCssColorString('#7c8aa0');

/**
 * Marker size by mode, in CSS px: a metro entrance matters more to a reader
 * than one of the eighteen bus poles around it.
 */
const MODE_SIZE = Object.freeze({ metro: 24, rail: 24, tram: 20, bus: 14 });
/** A mode this layer has no size rule for. */
const DEFAULT_MODE_SIZE = 16;

/**
 * The pictogram a stop is drawn with.
 *
 * A stop is signed in the street with its MODE's pictogram — the bus on the
 * pole, the M on the entrance — so these reuse `transitVehicleIcons.js` rather
 * than inventing a second transit vocabulary for the same city. A mode that
 * pack cannot draw falls back to the urbanism plan sheet rather than borrowing
 * another mode's vehicle, which would assert something the referential never
 * said.
 *
 * @param {?string} mode
 * @returns {string} data URI.
 */
export function stopGlyph(mode) {
  return transitVehicleGlyph(idfmStopGlyphKind(mode)) || addressMarkerGlyph('plan');
}

/**
 * Colour a stop by its mode family.
 * @param {string} mode
 * @returns {object} Cesium colour.
 */
export function stopColor(mode) {
  const css = IDFM_MODE_COLORS[mode];
  return css ? Cesium.Color.fromCssColorString(css) : COLOR_UNKNOWN_MODE;
}

/**
 * Read the current viewport as a bounding box, clamped to what the proxy takes.
 * @param {object} viewer
 * @returns {{west: number, south: number, east: number, north: number,
 *   lat: number, lon: number, altitudeM: number}|null}
 */
export function viewportBox(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.(viewer.scene?.globe?.ellipsoid);
  const carto = viewer?.camera?.positionCartographic;
  if (!rectangle || !carto) return null;
  const west = Cesium.Math.toDegrees(rectangle.west);
  const south = Cesium.Math.toDegrees(rectangle.south);
  const east = Cesium.Math.toDegrees(rectangle.east);
  const north = Cesium.Math.toDegrees(rectangle.north);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  const lat = (south + north) / 2;
  const lon = (west + east) / 2;
  // At oblique pitch the rectangle runs to the horizon; clamping keeps the
  // query over what is actually on screen instead of over the next département.
  const halfLon = Math.min(MAX_BOX_DEG / 2, Math.abs(east - west) / 2);
  const halfLat = Math.min(MAX_BOX_DEG / 2, Math.abs(north - south) / 2);
  return {
    west: lon - halfLon,
    south: lat - halfLat,
    east: lon + halfLon,
    north: lat + halfLat,
    lat,
    lon,
    altitudeM: carto.height,
  };
}

/**
 * Build the IDFM network layer.
 * @param {{fetchImpl?: typeof fetch}} [options]
 * @returns {object} Layer module.
 */
export function createIdfmNetworkLayer({ fetchImpl = (...args) => fetch(...args) } = {}) {
  let _dataSource = null;
  let _enabled = false;
  let _lastCentre = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _count = 0;
  let _total = null;
  let _truncated = false;
  let _byMode = {};
  let _dormant = false;
  let _clickHandler = null;
  let _selectedId = null;
  let _selectedBase = null;
  let _viewer = null;
  let _moveEndRemover = null;
  let _debounceTimer = null;
  let _scanning = false;
  let _rescanQueued = false;
  let _tileProgressRemover = null;
  let _seatTimer = null;
  let _seatPending = false;
  const _cards = new Map();

  // Selection reuses the address-scan card so a stop and a risk site open the
  // same kind of panel. The layer is not built on that factory — its query is a
  // bounding box, not a point — but the card is the user-facing contract and
  // there is no reason for it to differ.
  function clearSelection() {
    if (_selectedId && _selectedBase) {
      restoreAddressMarker(_dataSource?.entities?.getById(_selectedId), _selectedBase);
    }
    _selectedBase = null;
    _selectedId = null;
    clearOverlaySource('idfm-network');
    governorRequestRender('idfm-network-deselect');
  }

  function selectEntity(entityId) {
    const card = _cards.get(entityId);
    if (!card || _selectedId === entityId) return Boolean(card);
    clearSelection();
    _selectedBase = emphasiseAddressMarker(_dataSource?.entities?.getById(entityId));
    _selectedId = entityId;
    const entry = createAddressScanOverlayEntry(card);
    if (entry) {
      setOverlaySourceVisible('idfm-network', true);
      setOverlayEntries('idfm-network', [entry], ADDRESS_SCAN_OVERLAY_OPTIONS);
    }
    governorRequestRender('idfm-network-select');
    return true;
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && _selectedId) clearSelection();
  }

  function installClickHandler(viewer) {
    if (_clickHandler || !viewer?.scene?.canvas) return;
    _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    _clickHandler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position);
      const pickedId = typeof picked?.id === 'string' ? picked.id : picked?.id?.id;
      if (typeof pickedId === 'string' && _cards.has(pickedId)) {
        selectEntity(pickedId);
        return;
      }
      if (_selectedId && !picked) clearSelection();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    document.addEventListener('keydown', onKeyDown);
  }

  function removeClickHandler() {
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    document.removeEventListener('keydown', onKeyDown);
  }

  function indexCards() {
    _cards.clear();
    if (!_dataSource) return;
    for (const entity of _dataSource.entities.values) {
      const card = cardFromEntity(entity);
      if (card) _cards.set(card.id, card);
    }
  }

  /**
   * Put every stop on the terrain underneath it.
   *
   * The same mechanism the address-scan factory runs, for the same reason: a
   * stop drawn on the ellipsoid stands eighty metres under the pavement it
   * serves, and a vertical error under an oblique camera is a horizontal error
   * on screen that moves with the camera. See `addressScanLayer.js` for the
   * measurement. This layer keeps its own copy of the wiring rather than the
   * logic — its scan is a bounding box, not a radius, so it does not sit on the
   * factory — and the box centre stands in for terrain that has not streamed
   * in yet.
   *
   * @returns {number} How many stops moved.
   */
  function seatMarkers(centre = _lastCentre) {
    const globe = _viewer?.scene?.globe;
    if (!globe || !_dataSource || _dormant) return 0;
    const fallback = centre
      ? renderedGroundM(globe, Cesium.Math.toRadians(centre.lon), Cesium.Math.toRadians(centre.lat))
      : null;
    const { moved, pending } = seatEntitiesOnGround(_dataSource.entities.values, globe, fallback);
    _seatPending = pending > 0;
    if (moved > 0) {
      indexCards();
      // The open card carries a copy of its marker's position, so it has to
      // follow the marker up rather than stay where the marker used to be.
      if (_selectedId) {
        const card = _cards.get(_selectedId);
        const entry = card ? createAddressScanOverlayEntry(card) : null;
        if (entry) setOverlayEntries('idfm-network', [entry], ADDRESS_SCAN_OVERLAY_OPTIONS);
        else clearSelection();
      }
      governorRequestRender('idfm-network-seat');
    }
    return moved;
  }

  /** Re-seat once terrain settles, coalescing the burst of tile-load events. */
  function scheduleSeat() {
    clearTimeout(_seatTimer);
    _seatTimer = setTimeout(() => { seatMarkers(); }, SEAT_SETTLE_MS);
  }

  /**
   * Query the viewport and redraw.
   *
   * Shared by the manager's 5-minute tick and by the camera's `moveEnd`, with a
   * single-flight guard. Without the listener the layer only notices that you
   * have flown somewhere else when the timer next fires — which reads as a
   * layer that "has trouble refreshing" as you navigate.
   *
   * @param {object} viewer @param {AbortSignal|null} [signal]
   * @returns {Promise<boolean>}
   */
  async function runScan(viewer, signal = null) {
    if (_scanning) { _rescanQueued = true; return true; }
    _scanning = true;
    try {
  if (!_enabled || !_dataSource) return false;
  const box = viewportBox(viewer);
  if (!box) {
    _lastError = 'No viewport bounds';
    return false;
  }
  if (box.altitudeM > ACTIVATION_ALTITUDE_M) {
    if (!_dormant) {
      clearSelection();
      _dataSource.entities.removeAll();
      _cards.clear();
      _count = 0;
      _total = null;
      _byMode = {};
      _dormant = true;
      _lastCentre = null;
      _seatPending = false;
    }
    _lastError = null;
    return true;
  }
  _dormant = false;
  if (_lastCentre && greatCircleKm(_lastCentre.lat, _lastCentre.lon, box.lat, box.lon) < MIN_SHIFT_KM) {
    return true;
  }

  const query = new URLSearchParams({
    bbox: [box.west, box.south, box.east, box.north].map((v) => v.toFixed(5)).join(','),
    limit: String(STOP_LIMIT),
  });
  try {
    const response = await fetchImpl(`/api/idfm/stops?${query}`, signal ? { signal } : undefined);
    if (!response.ok) {
      _lastError = `IDFM HTTP ${response.status}`;
      return false;
    }
    const payload = await response.json();
    if (!payload || payload.error || !Array.isArray(payload.stops)) {
      _lastError = payload?.error || 'Malformed IDFM response';
      return false;
    }
    clearSelection();
    _dataSource.entities.removeAll();
    let drawn = 0;
    for (const stop of payload.stops) {
      if (!Number.isFinite(stop.lon) || !Number.isFinite(stop.lat)) continue;
      _dataSource.entities.add({
        id: `idfm:stop:${stop.id}`,
        position: Cesium.Cartesian3.fromDegrees(stop.lon, stop.lat),
        billboard: {
          // The mode's own pictogram, not a disc: five French registers scan
          // the same address and a coloured dot said nothing about which one
          // a marker came from. See `addressMarkerIcons.js`.
          image: stopGlyph(stop.mode),
          width: MODE_SIZE[stop.mode] ?? DEFAULT_MODE_SIZE,
          height: MODE_SIZE[stop.mode] ?? DEFAULT_MODE_SIZE,
          // The glyph is white line-art; this tint is the mode family.
          color: stopColor(stop.mode),
          // POSITIVE_INFINITY: see `addressScanLayer.js`. A finite value
          // leaves the terrain clipping the bottom of every stop marker
          // as soon as the camera is further off than that distance.
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: {
          kind: 'idfm-stop',
          mode: stop.mode,
          accessible: stop.accessible,
          fareZone: stop.fareZone,
          communeCode: stop.communeCode,
        },
        name: stop.name || 'Arrêt',
        description: [
          stop.modeLabel,
          stop.town,
          stop.fareZone ? `zone ${stop.fareZone}` : null,
          // `null` is "nobody surveyed it", which is not "not accessible".
          stop.accessible === true ? 'accessible'
            : stop.accessible === 'partial' ? 'partiellement accessible'
              : stop.accessible === false ? 'non accessible'
                : 'accessibilité non renseignée',
        ].filter(Boolean).join(' · '),
      });
      drawn += 1;
    }
    _count = drawn;
    // Seat before indexing, so a card is built from the seated position rather
    // than from the ellipsoid one the stop was drawn at.
    seatMarkers({ lat: box.lat, lon: box.lon });
    indexCards();
    _total = payload.total ?? null;
    _truncated = payload.truncated === true;
    _byMode = payload.byMode || {};
    _lastCentre = { lat: box.lat, lon: box.lon };
    _lastUpdate = Date.now();
    _lastError = null;
    return true;
  } catch (error) {
    if (error?.name === 'AbortError') return false;
    _lastError = error?.message || String(error);
    return false;
  }
    } finally {
      _scanning = false;
      if (_rescanQueued) {
        _rescanQueued = false;
        setTimeout(() => { void runScan(_viewer); }, 0);
      }
    }
  }

  /** Re-query once the camera settles, not on every frame of a fly-through. */
  function scheduleScan() {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => { void runScan(_viewer); }, ADDRESS_SCAN_MOVE_DEBOUNCE_MS);
  }

  /**
   * The camera stopped: re-seat, and separately consider re-querying.
   *
   * Under the movement threshold `runScan` returns without a request — right,
   * the same box is still on screen — but the terrain LOD beneath those stops
   * may have refined on the way in. Re-seating is a local read; it must not be
   * gated behind a decision about the network.
   */
  function onCameraSettled() {
    scheduleSeat();
    scheduleScan();
  }

  return {
    id: 'idfm-network',
    name: 'Réseau IDFM (Paris)',
    icon: 'Ⓜ',
    source: 'Île-de-France Mobilités (ODbL)',
    updateInterval: UPDATE_INTERVAL_MS,

    init(viewer) {
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('idfm-network');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      setOverlaySourceVisible('idfm-network', false);
      _enabled = false;
      _lastCentre = null;
      _lastUpdate = null;
      _lastError = null;
      _count = 0;
      _total = null;
      _truncated = false;
      _byMode = {};
      _dormant = false;
      _seatPending = false;
    },

    enable(viewer) {
      _enabled = true;
      if (viewer) _viewer = viewer;
      if (_dataSource) _dataSource.show = true;
      installClickHandler(_viewer);
      if (!_moveEndRemover && _viewer?.camera?.moveEnd) {
        _moveEndRemover = _viewer.camera.moveEnd.addEventListener(onCameraSettled);
      }
      // Terrain arrives after the stops do. `queued === 0` is the globe saying
      // it has streamed what this view needs, which is the first moment
      // `getHeight` can answer for every one of them.
      const globe = _viewer?.scene?.globe;
      if (!_tileProgressRemover && globe?.tileLoadProgressEvent) {
        _tileProgressRemover = globe.tileLoadProgressEvent.addEventListener((queued) => {
          if (queued === 0 || _seatPending) scheduleSeat();
        });
      }
      _lastCentre = null;
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      clearSelection();
      setOverlaySourceVisible('idfm-network', false);
      removeClickHandler();
      clearTimeout(_debounceTimer);
      clearTimeout(_seatTimer);
      if (_moveEndRemover) { _moveEndRemover(); _moveEndRemover = null; }
      if (_tileProgressRemover) { _tileProgressRemover(); _tileProgressRemover = null; }
    },

    destroy(viewer) {
      clearTimeout(_debounceTimer);
      clearTimeout(_seatTimer);
      if (_moveEndRemover) { _moveEndRemover(); _moveEndRemover = null; }
      if (_tileProgressRemover) { _tileProgressRemover(); _tileProgressRemover = null; }
      removeClickHandler();
      clearOverlaySource('idfm-network');
      if (_dataSource) {
        _dataSource.entities.removeAll();
        viewer?.dataSources?.remove(_dataSource, true);
      }
      _cards.clear();
      _dataSource = null;
      _viewer = null;
    },

    async update(viewer, { signal } = {}) {
      if (viewer) _viewer = viewer;
      return runScan(viewer || _viewer, signal);
    },
    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
        dormant: _dormant,
        // Named `scanCentre` to match the four point-scan siblings: it is the
        // centre of the box last queried, and it is how a reader (or a harness)
        // tells "this answer is about where I am" from "this answer is stale".
        scanCentre: _lastCentre ? { lat: _lastCentre.lat, lon: _lastCentre.lon } : null,
        selectedId: _selectedId,
        clickableCount: _cards.size,
        // True while at least one stop still stands on the box centre's height
        // rather than on a terrain reading of its own.
        seatPending: _seatPending,
        stopsInBox: _total,
        truncated: _truncated,
        byMode: _byMode,
        modeLabels: IDFM_MODES,
        // Stated in the layer's own stats so a reader is never left to conclude
        // the vehicles are missing because the layer is broken.
        liveVehicles: null,
        liveVehicleNote: 'IDFM ne publie aucune position de véhicule en temps réel',
      };
    },
  };
}

const idfmNetworkLayer = createIdfmNetworkLayer();

export default idfmNetworkLayer;
