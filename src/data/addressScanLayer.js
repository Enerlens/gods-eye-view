import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { governorRequestRender } from '../renderGovernor.js';
import { deriveFetchCenter, greatCircleKm } from './trafficBounds.js';

/**
 * Shared shell for the point-centred French address layers.
 *
 * WHY THESE FOUR LAYERS ARE NOT VIEWPORT LAYERS. Géorisques, DVF, the ADEME
 * DPE register and the Géoportail de l'urbanisme all answer a question about a
 * POINT — "what reaches this address" — and every one of their APIs takes a
 * coordinate and a radius, not a bounding box. Fitting them to the viewport
 * would mean inventing a centre anyway, so the centre is made explicit: each
 * layer scans around the ground point the camera is looking at, and refetches
 * when that point moves far enough to change the answer.
 *
 * WHY THERE IS A SHARED FACTORY AT ALL, against the one-self-contained-module
 * convention. The four layers differ only in their endpoint and in how they
 * draw; the camera-centre derivation, the altitude gate, the movement
 * threshold, the abort handling and the error reporting are identical, and
 * four copies of that would be four places for the same bug. Each layer is
 * still one module with one default export implementing the manager's
 * interface — this file is a helper they share, like `worldOverlay.js`.
 *
 * THE CENTRE IS THE LOOK-AT POINT, NOT THE NADIR. Reusing
 * `deriveFetchCenter()` from the traffic layer, which exists because
 * `computeViewRectangle()` spans toward the horizon at oblique pitch: centring
 * on the rectangle midpoint put fetches tens of kilometres from what the user
 * was actually looking at. An address scan centred on the wrong block is worse
 * than no scan, because it looks like an answer.
 *
 * @module data/addressScanLayer
 */

/**
 * Above this altitude a point scan means nothing.
 *
 * A radius of at most a kilometre is invisible from 30 km up, and firing one
 * scan per camera nudge across a whole country is the behaviour that gets an
 * open service to rate-limit a client. The layers switch themselves off
 * instead, and say so.
 */
export const ADDRESS_SCAN_MAX_ALTITUDE_M = 12_000;

/**
 * Distance the look-at point must move before a scan is repeated, in km.
 * Below this the previous answer still describes the same block.
 */
export const ADDRESS_SCAN_MIN_SHIFT_KM = 0.25;

/**
 * Settle time after the camera stops, in ms, before a scan is issued.
 *
 * These layers are camera-driven but the manager ticks them every 5 to 15
 * minutes — correct for registers that move in weeks, and useless for someone
 * flying across a city. Without a `moveEnd` listener the reported symptom is
 * exactly what it sounds like: the layer "has trouble refreshing" when you
 * navigate, then catches up minutes later when the timer happens to fire.
 * Matches the 450 ms the BD TOPO layer already settles on.
 */
export const ADDRESS_SCAN_MOVE_DEBOUNCE_MS = 450;

/**
 * WHY NO `heightReference` ON THESE MARKERS.
 *
 * `HeightReference.CLAMP_TO_GROUND` looks like the right answer for an
 * annotation that belongs to a building — and it makes the marker
 * UNPICKABLE. Measured in the running app: 30 Géorisques points drawn,
 * `scene.pick` at their own projected screen position returning null and
 * `scene.drillPick` returning an empty list, so a click found nothing to
 * select. Every point layer already in this repo (`marineBuoys`,
 * `hubeauHydrometry`, `sharedMobilityFrance`) places its markers with a plain
 * `Cartesian3.fromDegrees(lon, lat)` and either `HeightReference.NONE` or
 * nothing at all; these follow that. Depth testing is disabled instead, which
 * is what actually keeps a marker from being swallowed by the ground.
 */

/**
 * WHY THE MARKERS ARE SEATED ON THE TERRAIN BY HAND.
 *
 * Not clamping is only half an answer. `Cartesian3.fromDegrees(lon, lat)` puts
 * a marker on the ELLIPSOID, at height 0 — and the globe draws avenue de
 * France at 79 to 83 m of ellipsoidal height. The marker is eighty metres
 * under the street it describes, and because depth testing is disabled it is
 * still painted, just in the wrong place. Measured in the running app at 700 m
 * and a pitch of −35°: a DVF dot landed 83 px below its own address, and
 * turning the camera 35° moved the error to 62 px sideways.
 *
 * That is the whole of the reported symptom — "the dots aren't fixed, they
 * move when I nudge the map". A parallax error is not a constant offset; it is
 * a function of the camera pose, so the dots slide over the city instead of
 * sticking to it, and no amount of squinting at the data explains it.
 *
 * The height is therefore read rather than assumed. `globe.getHeight()`
 * returns the height of the terrain triangle the globe is ACTUALLY rendering —
 * the same call `bdtopoBuildings.js` uses to seat a footprint — synchronously,
 * with no network. Markers are re-seated when terrain finishes streaming and
 * when the camera settles, because the LOD under a point refines as you fly
 * toward it.
 */

/** Height change, in metres, below which re-seating a marker buys nothing. */
export const SEAT_EPSILON_M = 0.25;

/** Settle time before a re-seat, in ms. Coalesces a burst of tile loads. */
export const SEAT_SETTLE_MS = 250;

const _seatScratch = new Cesium.Cartographic();
const _centreScratch = new Cesium.Cartographic();

/**
 * The height of the surface the globe is DRAWING at a point, in ellipsoidal
 * metres, or null when no terrain tile covers it yet.
 *
 * @param {object} globe Cesium globe.
 * @param {number} lonRadians
 * @param {number} latRadians
 * @param {object} [scratch] Reused Cartographic.
 * @returns {?number}
 */
export function renderedGroundM(globe, lonRadians, latRadians, scratch = _centreScratch) {
  if (typeof globe?.getHeight !== 'function') return null;
  scratch.longitude = lonRadians;
  scratch.latitude = latRadians;
  scratch.height = 0;
  const height = globe.getHeight(scratch);
  return Number.isFinite(height) ? height : null;
}

/**
 * Move every marker onto the terrain underneath it.
 *
 * Each entity's own longitude and latitude are read back off the position it
 * was drawn with, so a layer opts into this simply by placing its markers
 * where its data says they are; nothing has to be threaded through `render()`.
 *
 * `fallbackHeightM` is the ground under the scan centre, and it exists for the
 * cold case: a camera that has just arrived has drawn its markers before a
 * single terrain tile answered. Every marker in these layers is within a few
 * hundred metres of that centre, so its height is a far better prior than
 * zero — and `pending` reports that a real reading is still owed, so the next
 * pass comes back for it.
 *
 * @param {Iterable<object>} entities Cesium entities.
 * @param {object} globe Cesium globe.
 * @param {?number} [fallbackHeightM]
 * @returns {{moved: number, pending: number}} How many markers changed height,
 *   and how many are still seated without a terrain reading of their own.
 */
export function seatEntitiesOnGround(entities, globe, fallbackHeightM = null) {
  const result = { moved: 0, pending: 0 };
  if (!entities || typeof globe?.getHeight !== 'function') return result;
  const now = Cesium.JulianDate.now();
  for (const entity of entities) {
    const position = entity?.position?.getValue?.(now);
    // A clamped polyline carries `polyline.positions` and no `position` of its
    // own. It is already on the ground; there is nothing here to seat.
    if (!position) continue;
    const carto = Cesium.Cartographic.fromCartesian(position, Cesium.Ellipsoid.WGS84, _seatScratch);
    if (!carto) continue;
    const current = carto.height;
    const ground = globe.getHeight(carto);
    const measured = Number.isFinite(ground);
    if (!measured) result.pending += 1;
    const target = measured ? ground : fallbackHeightM;
    if (!Number.isFinite(target) || Math.abs(target - current) <= SEAT_EPSILON_M) continue;
    entity.position = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, target);
    result.moved += 1;
  }
  return result;
}

/** Accent of a selected marker and of the card it opens. */
export const ADDRESS_SCAN_SELECTED_COLOR = '#7fd7ff';

/** Extra pixels a selected marker grows by. */
export const ADDRESS_SCAN_SELECTED_GROWTH_PX = 6;

/**
 * Raise one marker to the selected state, returning what to put back.
 *
 * Shared because the five layers must agree on what "selected" looks like, and
 * because a billboard takes its size from TWO properties rather than one: miss
 * `height` and the glyph stretches instead of growing.
 *
 * @param {object} entity Cesium entity.
 * @param {number} [growthPx]
 * @returns {?object} Snapshot for {@link restoreAddressMarker}, or null when
 *   the entity draws no marker of its own (a clamped zoning ring).
 */
export function emphasiseAddressMarker(entity, growthPx = ADDRESS_SCAN_SELECTED_GROWTH_PX) {
  const billboard = entity?.billboard;
  if (!billboard) return null;
  const read = (property) => property?.getValue?.(Cesium.JulianDate.now()) ?? property;
  const snapshot = {
    color: billboard.color,
    width: billboard.width,
    height: billboard.height,
  };
  const width = Number(read(billboard.width));
  const height = Number(read(billboard.height));
  billboard.color = Cesium.Color.fromCssColorString(ADDRESS_SCAN_SELECTED_COLOR);
  if (Number.isFinite(width)) billboard.width = width + growthPx;
  if (Number.isFinite(height)) billboard.height = height + growthPx;
  return snapshot;
}

/**
 * Put a marker back the way {@link emphasiseAddressMarker} found it.
 * @param {object} entity
 * @param {?object} snapshot
 */
export function restoreAddressMarker(entity, snapshot) {
  if (!entity?.billboard || !snapshot) return;
  entity.billboard.color = snapshot.color;
  entity.billboard.width = snapshot.width;
  entity.billboard.height = snapshot.height;
}

/**
 * Overlay source options for the one card these layers ever paint.
 *
 * `cohortLimit: 1` — a selection is singular. `collisionCapacity: 0` — the card
 * is protected and never yields to an ambient label.
 */
export const ADDRESS_SCAN_OVERLAY_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 0,
  moving: false,
});

/**
 * Build the world-overlay entry for a selected marker.
 *
 * The title and details are read back off the entity the render callback
 * already wrote — `name` and `description` — so a layer adds a card simply by
 * describing its entity well, and there is one card implementation rather than
 * four.
 *
 * @param {{id: string, title: string, details: string[], position: object}} card
 * @returns {object|null}
 */
export function createAddressScanOverlayEntry(card) {
  if (!card?.id || !card.position) return null;
  return {
    id: String(card.id),
    position: card.position,
    variant: 'selected',
    selected: true,
    protected: true,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    title: card.title || 'Sans titre',
    details: Array.isArray(card.details) ? card.details.filter(Boolean).slice(0, 6) : [],
    accent: ADDRESS_SCAN_SELECTED_COLOR,
    interactive: false,
    anchorRadiusPx: 9,
    minAnchorGapPx: 11,
    verticalOnly: true,
    placement: 'above',
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
  };
}

/**
 * Anchor a card on an entity that has no position of its own.
 *
 * The urbanism layer draws zoning and easements as clamped POLYLINES, and a
 * polyline entity carries `polyline.positions` but no `position`. The first
 * version of this indexer required `position` and so quietly indexed **zero**
 * clickable shapes for that layer while the other four worked — an outline you
 * cannot click is exactly as useful as one that was never drawn.
 *
 * The midpoint of the ring is used rather than its centroid: for a ring the two
 * are close enough at the zoom this is read at, and a midpoint cannot land
 * outside a concave boundary the way a centroid can.
 *
 * @param {object} entity
 * @returns {object|null} Cartesian3, or null when the entity draws no line.
 */
function polylineAnchor(entity) {
  const positions = entity?.polyline?.positions?.getValue?.(Cesium.JulianDate.now());
  if (!Array.isArray(positions) || positions.length === 0) return null;
  return positions[Math.floor(positions.length / 2)] ?? null;
}

/**
 * Read a drawn entity back into the card it should open.
 *
 * `description` is a Cesium Property, and the app runs with `infoBox: false`,
 * so nothing displays it on its own — splitting it here is what turns the text
 * the render callbacks already write into a card a click can open.
 *
 * @param {object} entity Cesium entity.
 * @returns {{id: string, title: string, details: string[], position: object}|null}
 */
export function cardFromEntity(entity) {
  const position = entity?.position?.getValue?.(Cesium.JulianDate.now())
    ?? polylineAnchor(entity);
  if (!position) return null;
  const description = entity.description?.getValue?.(Cesium.JulianDate.now());
  return {
    id: String(entity.id),
    title: typeof entity.name === 'string' && entity.name ? entity.name : String(entity.id),
    details: typeof description === 'string' && description ? description.split(' · ') : [],
    position,
  };
}

/**
 * Read the ground point the camera is looking at.
 * @param {object} viewer Cesium viewer.
 * @returns {{lat: number, lon: number, altitudeM: number}|null}
 */
export function cameraScanPoint(viewer) {
  const camera = viewer?.camera;
  if (!camera) return null;
  const carto = camera.positionCartographic;
  if (!carto) return null;
  const nadirLat = Cesium.Math.toDegrees(carto.latitude);
  const nadirLon = Cesium.Math.toDegrees(carto.longitude);
  const altitudeM = carto.height;

  let hitLat;
  let hitLon;
  const canvas = viewer.scene?.canvas;
  const width = canvas?.clientWidth || canvas?.width || 0;
  const height = canvas?.clientHeight || canvas?.height || 0;
  if (width > 0 && height > 0 && typeof camera.pickEllipsoid === 'function') {
    const hit = camera.pickEllipsoid(
      new Cesium.Cartesian2(width / 2, height / 2),
      Cesium.Ellipsoid.WGS84,
    );
    if (hit) {
      const hitCarto = Cesium.Cartographic.fromCartesian(hit);
      hitLat = Cesium.Math.toDegrees(hitCarto.latitude);
      hitLon = Cesium.Math.toDegrees(hitCarto.longitude);
    }
  }
  const centre = deriveFetchCenter({ nadirLat, nadirLon, hitLat, hitLon, maxPullKm: 6 });
  if (!centre || !Number.isFinite(centre.lat) || !Number.isFinite(centre.lon)) return null;
  return { lat: centre.lat, lon: centre.lon, altitudeM };
}

/**
 * Whether a new scan is warranted for a point.
 * @param {{lat: number, lon: number}|null} last
 * @param {{lat: number, lon: number}} next
 * @param {number} [minShiftKm]
 * @returns {boolean}
 */
export function scanShiftNeeded(last, next, minShiftKm = ADDRESS_SCAN_MIN_SHIFT_KM) {
  if (!last) return true;
  return greatCircleKm(last.lat, last.lon, next.lat, next.lon) >= minShiftKm;
}

/**
 * Build a point-centred layer module implementing the manager's interface.
 *
 * @param {object} config
 * @param {string} config.id Layer id, matching the taxonomy and state registry.
 * @param {string} config.name Human name shown in the layer list.
 * @param {string} config.icon Single-glyph icon.
 * @param {string} config.source Attribution string shown on the card.
 * @param {string} config.endpoint Proxy route, e.g. `/api/dvf`.
 * @param {number} config.updateInterval Manager refresh cadence, ms.
 * @param {(point: {lat: number, lon: number}) => Record<string, string>} [config.params]
 *   Extra query parameters for a scan.
 * @param {(context: {payload: object, dataSource: object, point: object}) => number}
 *   config.render Draws the payload and returns how many entities it created.
 * @param {(payload: object) => Record<string, unknown>} [config.summarize]
 *   Extra fields merged into `getStats()`.
 * @param {number} [config.maxAltitudeM]
 * @param {number} [config.minShiftKm]
 * @param {typeof fetch} [config.fetchImpl] Injection seam for tests.
 * @returns {object} A layer module.
 */
export function createAddressScanLayer(config) {
  const {
    id, name, icon, source, endpoint, updateInterval,
    params = () => ({}),
    render,
    summarize = () => ({}),
    maxAltitudeM = ADDRESS_SCAN_MAX_ALTITUDE_M,
    minShiftKm = ADDRESS_SCAN_MIN_SHIFT_KM,
    fetchImpl = (...args) => fetch(...args),
    // OFF for the four layers that draw billboards: a marker is a billboard
    // wherever the basemap came from, and rebuilding one on every map-stack
    // change would be work for nothing. ON for the layer that draws GROUND
    // CLASSIFICATION geometry, which reads its classification surface once,
    // when the primitive is built — see `urbanismeGpu.js`.
    redrawOnMapStack = false,
    mapStackEventTarget = typeof window === 'undefined' ? null : window,
  } = config;

  let _dataSource = null;
  let _enabled = false;
  let _lastPoint = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _count = 0;
  let _stale = false;
  let _dormant = false;
  let _payload = null;
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
  let _mapStackListener = null;
  const _cards = new Map();

  /** Restore the marker a selection had enlarged. */
  function restoreSelectedStyle() {
    if (!_selectedId || !_selectedBase || !_dataSource) return;
    restoreAddressMarker(_dataSource.entities.getById(_selectedId), _selectedBase);
    _selectedBase = null;
  }

  function clearSelection() {
    restoreSelectedStyle();
    _selectedId = null;
    clearOverlaySource(id);
    governorRequestRender(`${id}-deselect`);
  }

  function selectEntity(entityId) {
    const card = _cards.get(entityId);
    if (!card) return false;
    if (_selectedId === entityId) return true;
    clearSelection();
    _selectedBase = emphasiseAddressMarker(_dataSource?.entities?.getById(entityId));
    _selectedId = entityId;
    const entry = createAddressScanOverlayEntry(card);
    if (entry) {
      setOverlaySourceVisible(id, true);
      setOverlayEntries(id, [entry], ADDRESS_SCAN_OVERLAY_OPTIONS);
    }
    governorRequestRender(`${id}-select`);
    return true;
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && _selectedId) clearSelection();
  }

  /**
   * Install the layer's own click handler.
   *
   * The app runs with `infoBox: false` and `selectionIndicator: false`, so
   * Cesium opens nothing by itself: without this, a marker with a perfectly
   * good `description` is simply inert under the cursor. Every sibling layer
   * owns its own LEFT_CLICK handler for the same reason.
   */
  function installClickHandler(viewer) {
    if (_clickHandler || !viewer?.scene?.canvas) return;
    _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    _clickHandler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position);
      // Entity-backed primitives hand back the Entity itself as `picked.id`.
      const pickedId = typeof picked?.id === 'string' ? picked.id : picked?.id?.id;
      if (typeof pickedId === 'string' && _cards.has(pickedId)) {
        selectEntity(pickedId);
        return;
      }
      // A click on empty globe dismisses, but a click on ANOTHER layer's
      // object does not — that layer is about to open its own card.
      if (_selectedId && !picked) clearSelection();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    document.addEventListener('keydown', onKeyDown);
  }

  function removeMapStackListener() {
    if (!_mapStackListener) return;
    mapStackEventTarget?.removeEventListener?.('gev:map-stack-changed', _mapStackListener);
    _mapStackListener = null;
  }

  function removeClickHandler() {
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    document.removeEventListener('keydown', onKeyDown);
  }

  /** Rebuild the click index from what was just drawn. */
  function indexCards() {
    _cards.clear();
    if (!_dataSource) return;
    for (const entity of _dataSource.entities.values) {
      const card = cardFromEntity(entity);
      if (card) _cards.set(card.id, card);
    }
  }

  /**
   * Re-anchor the open card after its marker has been moved.
   *
   * The overlay entry carries a COPY of the marker's world position, so a card
   * left over a re-seated marker would hang eighty metres under it — the same
   * error being fixed, wearing the card's clothes.
   */
  function refreshSelectionAnchor() {
    if (!_selectedId) return;
    const card = _cards.get(_selectedId);
    if (!card) { clearSelection(); return; }
    const entry = createAddressScanOverlayEntry(card);
    if (entry) setOverlayEntries(id, [entry], ADDRESS_SCAN_OVERLAY_OPTIONS);
  }

  /**
   * Put every drawn marker on the terrain the globe is rendering under it.
   *
   * @param {{lat: number, lon: number}|null} [centre] Scan centre, whose ground
   *   height stands in for any marker terrain cannot answer for yet.
   * @returns {number} How many markers moved.
   */
  function seatMarkers(centre = _lastPoint) {
    const globe = _viewer?.scene?.globe;
    if (!globe || !_dataSource || _dormant) return 0;
    const fallback = centre
      ? renderedGroundM(globe, Cesium.Math.toRadians(centre.lon), Cesium.Math.toRadians(centre.lat))
      : null;
    const { moved, pending } = seatEntitiesOnGround(_dataSource.entities.values, globe, fallback);
    _seatPending = pending > 0;
    if (moved > 0) {
      indexCards();
      refreshSelectionAnchor();
      governorRequestRender(`${id}-seat`);
    }
    return moved;
  }

  /** Re-seat once terrain settles, coalescing the burst of tile-load events. */
  function scheduleSeat() {
    clearTimeout(_seatTimer);
    _seatTimer = setTimeout(() => { seatMarkers(); }, SEAT_SETTLE_MS);
  }

  /**
   * Redraw the answer ALREADY IN HAND onto a new map stack.
   *
   * Not a rescan: the register has not changed, the ground under it has. A
   * layer that draws ground-classification geometry chooses its classification
   * surface when the primitive is BUILT, so switching from IGN ortho to the
   * Google photoreal tileset — which hides the globe — leaves a wash addressed
   * to terrain that is no longer being drawn, and the layer silently shows
   * nothing. Rebuilding from `_payload` costs no request and no rate limit.
   *
   * @returns {boolean} True when something was redrawn.
   */
  function redrawForMapStack() {
    if (!_dataSource || !_payload || !_lastPoint || _dormant) return false;
    clearSelection();
    _dataSource.entities.removeAll();
    _count = render({
      payload: _payload, dataSource: _dataSource, point: _lastPoint, viewer: _viewer,
    }) || 0;
    seatMarkers(_lastPoint);
    indexCards();
    governorRequestRender(`${id}-map-stack`);
    return true;
  }

  /**
   * Scan around the camera's ground point and redraw.
   *
   * Shared by the manager's periodic tick and by the `moveEnd` listener, with a
   * single-flight guard: a scan already in progress queues one repeat rather
   * than stacking a request per camera nudge.
   *
   * @param {object} viewer
   * @param {AbortSignal|null} [signal]
   * @returns {Promise<boolean>}
   */
  async function runScan(viewer, signal = null) {
    if (_scanning) { _rescanQueued = true; return true; }
    _scanning = true;
    try {
      if (!_enabled || !_dataSource) return false;
      const point = cameraScanPoint(viewer);
      if (!point) {
        _lastError = 'No ground point under the camera';
        return false;
      }
      if (point.altitudeM > maxAltitudeM) {
        // Dormant, not broken. Clearing the draw is deliberate: a scan of a
        // block left on screen from 40 km up invites reading it as a scan of
        // the region.
        if (!_dormant) {
          clearSelection();
          _dataSource.entities.removeAll();
          _cards.clear();
          _count = 0;
          _payload = null;
          _dormant = true;
          _lastPoint = null;
          _seatPending = false;
        }
        _lastError = null;
        governorRequestRender(`${id}-dormant`);
        return true;
      }
      _dormant = false;
      if (!scanShiftNeeded(_lastPoint, point, minShiftKm)) return true;

      const query = new URLSearchParams({
        lat: point.lat.toFixed(6),
        lon: point.lon.toFixed(6),
        ...params(point),
      });
      try {
        const response = await fetchImpl(`${endpoint}?${query}`, signal ? { signal } : undefined);
        if (!response.ok) {
          _lastError = `${name} HTTP ${response.status}`;
          return false;
        }
        const payload = await response.json();
        if (!payload || payload.error) {
          _lastError = payload?.error || `Malformed ${name} response`;
          return false;
        }
        clearSelection();
        _dataSource.entities.removeAll();
        _count = render({
          payload, dataSource: _dataSource, point, viewer: _viewer,
        }) || 0;
        // Before the index, so a card is built from the seated position rather
        // than from the ellipsoid one it was drawn at.
        seatMarkers(point);
        indexCards();
        _payload = payload;
        _lastPoint = point;
        _lastUpdate = Date.now();
        _stale = payload.stale === true;
        _lastError = null;
        // The render governor runs in requestRenderMode: a redraw nobody asks
        // to paint simply never appears on screen.
        governorRequestRender(`${id}-scan`);
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
        // The camera moved again while this scan was in flight; the answer just
        // drawn describes where the user no longer is.
        setTimeout(() => { void runScan(_viewer); }, 0);
      }
    }
  }

  /** Re-scan once the camera settles, not on every frame of a fly-through. */
  function scheduleScan() {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => { void runScan(_viewer); }, ADDRESS_SCAN_MOVE_DEBOUNCE_MS);
  }

  /**
   * The camera stopped.
   *
   * Two separate jobs, and only one of them is the scan. Below the 250 m
   * movement threshold `runScan` returns without refetching — correct, the
   * previous answer still describes the same block — but the terrain LOD under
   * those markers may well have refined on the way, and a marker seated on a
   * coarse tile has to be read again. Re-seating is local and free; it must not
   * be gated behind a decision about the network.
   */
  function onCameraSettled() {
    scheduleSeat();
    scheduleScan();
  }

  return {
    id,
    name,
    icon,
    source,
    updateInterval,

    init(viewer) {
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource(id);
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      setOverlaySourceVisible(id, false);
      _enabled = false;
      _lastPoint = null;
      _lastUpdate = null;
      _lastError = null;
      _count = 0;
      _stale = false;
      _dormant = false;
      _payload = null;
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
      // Terrain arrives after the markers do. `queued === 0` is the globe
      // saying it has finished streaming what the current view needs, which is
      // the first moment `getHeight` can answer for every one of them.
      const globe = _viewer?.scene?.globe;
      if (!_tileProgressRemover && globe?.tileLoadProgressEvent) {
        _tileProgressRemover = globe.tileLoadProgressEvent.addEventListener((queued) => {
          if (queued === 0 || _seatPending) scheduleSeat();
        });
      }
      if (redrawOnMapStack && !_mapStackListener && mapStackEventTarget?.addEventListener) {
        _mapStackListener = () => { redrawForMapStack(); };
        mapStackEventTarget.addEventListener('gev:map-stack-changed', _mapStackListener);
      }
      // Force the next update to scan: the camera may have travelled a
      // continent while the layer was off.
      _lastPoint = null;
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      clearSelection();
      setOverlaySourceVisible(id, false);
      removeClickHandler();
      clearTimeout(_debounceTimer);
      clearTimeout(_seatTimer);
      if (_moveEndRemover) { _moveEndRemover(); _moveEndRemover = null; }
      if (_tileProgressRemover) { _tileProgressRemover(); _tileProgressRemover = null; }
      removeMapStackListener();
    },

    destroy(viewer) {
      clearTimeout(_debounceTimer);
      clearTimeout(_seatTimer);
      if (_moveEndRemover) { _moveEndRemover(); _moveEndRemover = null; }
      if (_tileProgressRemover) { _tileProgressRemover(); _tileProgressRemover = null; }
      removeMapStackListener();
      removeClickHandler();
      clearOverlaySource(id);
      if (_dataSource) {
        _dataSource.entities.removeAll();
        viewer?.dataSources?.remove(_dataSource, true);
      }
      _cards.clear();
      _dataSource = null;
      _payload = null;
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
        stale: _stale,
        // Reported so "nothing is drawn" is never ambiguous between "the
        // camera is too high to scan" and "this address is clear".
        dormant: _dormant,
        selectedId: _selectedId,
        clickableCount: _cards.size,
        // True while at least one marker is still standing on the scan
        // centre's height rather than on a terrain reading of its own — the
        // only state in which a marker can still drift as the camera turns.
        seatPending: _seatPending,
        scanCentre: _lastPoint ? { lat: _lastPoint.lat, lon: _lastPoint.lon } : null,
        ...(_payload ? summarize(_payload) : {}),
      };
    },
  };
}
