import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';

/**
 * Capteurs trafic (FR) — the state's own counting loops, and what they measured.
 *
 * QTV-DIR is the other half of what Bison Futé publishes openly: every six
 * minutes, ~1 200 measurement stations on the non-conceded national network
 * report an average vehicle speed and an hourly flow rate. Keyless, DATEX II,
 * Licence Ouverte 2.0, through the same `/api/bison-fute` proxy as
 * `Événements routiers`.
 *
 * WHY THIS IS A SEPARATE LAYER FROM `Trafic routier`. The traffic layer paints
 * *inferred* congestion across a whole road network — TomTom's ratio of live to
 * free-flow speed, or OpenStreetMap's road classes with no live data at all.
 * This one paints ~840 INSTRUMENTS and the numbers they returned. They answer
 * different questions ("how bad is this road right now" against "what did the
 * loop at PR 91 count in the last six minutes"), they disagree in interesting
 * places, and merging them would let an official measurement inherit a
 * commercial model's colour. Two layers, two legends, both on at once.
 *
 * ── What the drawing is careful about ───────────────────────────────────────
 *
 * • **A speed is not a congestion level.** QTV publishes what was measured and
 *   nothing to compare it against — no free-flow reference, no speed limit, not
 *   even a reliable lane count (922 of 1 206 referential rows say `0` lanes).
 *   90 km/h is fast on an N-road and a jam on an A-road, and this layer has no
 *   way to know which. So the legend is labelled in km/h, in plain bands, and
 *   never in words like "fluide" or "congestionné" that would claim a judgement
 *   the data cannot support. The one exception is earned: a station reporting
 *   VEHICLES at ZERO km/h is stopped traffic by arithmetic, not by inference.
 *
 * • **A zero from no samples is not a zero.** `numberOfInputValuesUsed="0"` was
 *   attached to 206 of the 2 412 values in the 2026-08-31 snapshot, published
 *   as `0`. One station — MYK69.K1 on the N346 — counted 7 114 vehicles an hour
 *   beside a 0.0 km/h built from no samples at all. Drawn literally that is a
 *   motorway at a standstill that is not at a standstill. The rule lives in
 *   `bisonFuteFeed.js` under test against exactly that row.
 *
 * • **The age is part of the reading.** Measured 2026-08-31: the file carrying
 *   a 22:00 measurement was written at 22:11. A QTV value is ~12 minutes old
 *   before a browser can ask for it, so the age is on the row, on every card,
 *   and greys the whole layer out when the feed stops moving.
 *
 * • **840 of 1 206 stations, and the row says so.** 364 referential rows carry
 *   no coordinates at all and one measured station (`#MZo57.2`) has no
 *   referential row. They are counted and not drawn — a map that showed 1 206
 *   would be inventing 366 positions.
 *
 * • **The RRN non concédé only**, like its sibling: no conceded motorway
 *   carries a QTV station in this feed.
 */

const MEASUREMENTS_URL = '/api/bison-fute/measurements';

/** Layer id, shared with the world overlay and the pick registry. */
export const ROAD_SENSORS_FR_LAYER_ID = 'road-sensors-fr';
const OVERLAY_SOURCE_ID = ROAD_SENSORS_FR_LAYER_ID;
const SELECTED_OVERLAY_SOURCE_ID = `${ROAD_SENSORS_FR_LAYER_ID}-selected`;
/** Bounded ambient-label cohort. 840 stations is not 840 labels. */
export const ROAD_SENSORS_FR_OVERLAY_COHORT_LIMIT = 24;
/** Shared ambient-label paint budget. */
export const ROAD_SENSORS_FR_OVERLAY_COLLISION_CAPACITY = 20;

/** The product republishes every ~6 minutes; the proxy caches for 3. */
const UPDATE_INTERVAL_MS = 180_000;

/**
 * Speed bands, in km/h, labelled as speeds.
 *
 * `stopped` is the only band that makes a claim beyond the number, and it is
 * the only one entitled to: vehicles counted at zero speed is a queue, whatever
 * the road's reference speed would have been.
 */
export const ROAD_SENSOR_SPEED_BANDS = Object.freeze([
  Object.freeze({ id: 'stopped', label: 'À l’arrêt', color: '#ff3b30', min: 0, max: 1, blurb: 'Véhicules comptés, vitesse nulle' }),
  Object.freeze({ id: 'crawl', label: '< 30 km/h', color: '#ff7a1a', min: 1, max: 30, blurb: 'Vitesse moyenne sous 30 km/h' }),
  Object.freeze({ id: 'slow', label: '30 – 60', color: '#ffd60a', min: 30, max: 60, blurb: 'Vitesse moyenne de 30 à 60 km/h' }),
  Object.freeze({ id: 'medium', label: '60 – 90', color: '#a3e635', min: 60, max: 90, blurb: 'Vitesse moyenne de 60 à 90 km/h' }),
  Object.freeze({ id: 'fast', label: '≥ 90 km/h', color: '#2ecc71', min: 90, max: Infinity, blurb: 'Vitesse moyenne d’au moins 90 km/h' }),
]);

/**
 * Flow bands, in vehicles/hour, as the feed publishes them — an extrapolation
 * of a six-minute count, summed across the station's lanes.
 */
export const ROAD_SENSOR_FLOW_BANDS = Object.freeze([
  Object.freeze({ id: 'empty', label: 'Aucun véhicule', color: '#4b5563', min: 0, max: 1, blurb: 'Aucun véhicule compté sur la période' }),
  Object.freeze({ id: 'light', label: '< 500 véh/h', color: '#4dd0e1', min: 1, max: 500, blurb: 'Moins de 500 véhicules par heure' }),
  Object.freeze({ id: 'moderate', label: '500 – 2 000', color: '#6ea8fe', min: 500, max: 2000, blurb: 'De 500 à 2 000 véhicules par heure' }),
  Object.freeze({ id: 'heavy', label: '2 000 – 5 000', color: '#b06bff', min: 2000, max: 5000, blurb: 'De 2 000 à 5 000 véhicules par heure' }),
  Object.freeze({ id: 'saturated', label: '≥ 5 000 véh/h', color: '#ff2d95', min: 5000, max: Infinity, blurb: 'Au moins 5 000 véhicules par heure' }),
]);

/**
 * The band for a station whose value this poll is not a measurement.
 *
 * Grey, and it is the point: a station that published nothing usable must not
 * be indistinguishable from one that measured a free-flowing road. On the
 * 2026-08-31 snapshot ~100 of 1 200 stations landed here every six minutes.
 */
export const ROAD_SENSOR_NO_DATA_BAND = Object.freeze({
  id: 'nodata', label: 'Pas de mesure', color: '#6b7280', min: null, max: null,
  blurb: 'Aucune valeur exploitable publiée par la station',
});

/** The two things this layer can colour by. */
export const ROAD_SENSOR_METRICS = Object.freeze([
  Object.freeze({
    id: 'speed', label: 'Vitesse', bands: ROAD_SENSOR_SPEED_BANDS,
    title: 'Colorer par vitesse moyenne mesurée (km/h)',
  }),
  Object.freeze({
    id: 'flow', label: 'Débit', bands: ROAD_SENSOR_FLOW_BANDS,
    title: 'Colorer par débit horaire mesuré (véhicules/h)',
  }),
]);

const METRIC_BY_ID = new Map(ROAD_SENSOR_METRICS.map((metric) => [metric.id, metric]));
/** Default metric: speed is the reading a reader can interpret unaided. */
export const ROAD_SENSOR_DEFAULT_METRIC = 'speed';

/**
 * Resolve one station's band for a metric.
 *
 * The `stopped` band needs BOTH values: a speed of 0 means "queue" only when
 * the station also counted vehicles. Zero speed beside zero flow is an empty
 * road at four in the morning, and it resolves to the no-data grey rather than
 * painting rural France as a national traffic jam every night.
 *
 * @param {object|null|undefined} station Served station.
 * @param {string} metricId 'speed' | 'flow'
 * @returns {typeof ROAD_SENSOR_NO_DATA_BAND}
 */
export function roadSensorBand(station, metricId = ROAD_SENSOR_DEFAULT_METRIC) {
  const metric = METRIC_BY_ID.get(metricId) || METRIC_BY_ID.get(ROAD_SENSOR_DEFAULT_METRIC);
  const value = metric.id === 'flow' ? station?.flow : station?.speed;
  if (!Number.isFinite(value)) return ROAD_SENSOR_NO_DATA_BAND;
  if (metric.id === 'speed' && value === 0) {
    const flow = station?.flow;
    if (!Number.isFinite(flow) || flow <= 0) return ROAD_SENSOR_NO_DATA_BAND;
  }
  for (const band of metric.bands) {
    if (value >= band.min && value < band.max) return band;
  }
  return ROAD_SENSOR_NO_DATA_BAND;
}

/** True when a station is measuring vehicles that are not moving. */
export function roadSensorIsStopped(station) {
  return station?.speed === 0 && Number.isFinite(station?.flow) && station.flow > 0;
}

/** Format a measurement age for a row or a card. */
export function formatSensorAge(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  // FLOOR, not round: "il y a 1 min" should mean a minute has actually passed.
  // Rounding would report a 31-second-old reading as a minute old, which is the
  // wrong direction to be wrong about on a layer whose headline is the age.
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `il y a ${hours} h` : `il y a ${Math.floor(hours / 24)} j`;
}

/**
 * Past this age a reading has stopped being live.
 *
 * Two publication cycles plus the ~12-minute publication lag: at 30 minutes the
 * feed has missed several editions and the numbers on screen are history, so
 * the layer reports STALE rather than presenting them as current.
 */
export const ROAD_SENSOR_STALE_AGE_MS = 30 * 60_000;

/**
 * French thousands grouping, normalised the way the rest of the French layers
 * normalise it: `toLocaleString('fr-FR')` groups with U+202F on modern ICU and
 * U+00A0 on older ones, and both become a plain space so a label measures and
 * wraps predictably in the overlay's text layout. Same rule, same reason, as
 * `formatMegawatts` in `edfPowerPlants.js`.
 * @param {number} value
 * @returns {string|null}
 */
function formatInteger(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value).toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g, ' ');
}

/** Title for one station: its road and the reading a reader came for. */
export function roadSensorTitle(station, metricId = ROAD_SENSOR_DEFAULT_METRIC) {
  const road = station?.road || station?.id || 'Station';
  if (metricId === 'flow') {
    return Number.isFinite(station?.flow)
      ? `${road} · ${formatInteger(station.flow)} véh/h`
      : `${road} · débit non mesuré`;
  }
  if (roadSensorIsStopped(station)) return `${road} · à l’arrêt`;
  return Number.isFinite(station?.speed)
    ? `${road} · ${Math.round(station.speed)} km/h`
    : `${road} · vitesse non mesurée`;
}

/**
 * Card body for one station. Both measurements are always shown — they only
 * mean something together — and each carries the number of samples behind it.
 * @param {object} station
 * @param {number|null} ageMs
 * @returns {string[]}
 */
export function roadSensorDetails(station, ageMs = null) {
  const lines = [];
  const samples = (count) => (Number.isFinite(count) ? ` (${formatInteger(count)} mesures)` : '');

  lines.push(Number.isFinite(station?.speed)
    ? `Vitesse moyenne ${Math.round(station.speed)} km/h${samples(station.speedSamples)}`
    : 'Vitesse moyenne non mesurée sur cette période');
  lines.push(Number.isFinite(station?.flow)
    ? `Débit ${formatInteger(station.flow)} véh/h${samples(station.flowSamples)}`
    : 'Débit non mesuré sur cette période');
  if (roadSensorIsStopped(station)) lines.push('Véhicules comptés à vitesse nulle — trafic arrêté');

  const place = [station?.dir, station?.direction ? `sens ${station.direction.toLowerCase().replace('_', '-')}` : null]
    .filter(Boolean).join(' · ');
  if (place) lines.push(place);
  if (station?.marker) lines.push(`PR ${station.marker}`);
  if (Number.isFinite(station?.lanes)) lines.push(`${station.lanes} voies`);
  if (Number.isFinite(station?.length)) lines.push(`Section instrumentée de ${formatInteger(station.length)} m`);

  const age = formatSensorAge(ageMs);
  if (age) lines.push(`Mesure ${age}`);
  lines.push(`Station ${station?.id}`);
  // The caveat that keeps the colour honest. It is on every card because the
  // legend it qualifies is on every screen.
  lines.push('Vitesse mesurée, pas un niveau de congestion : aucune vitesse de référence n’est publiée.');
  return lines;
}

/**
 * Tally the drawn stations by band, plus the readings worth a headline.
 * @param {object[]} stations
 * @param {string} metricId
 * @returns {{total:number, byBand:Record<string,number>, stopped:number, measured:number}}
 */
export function summarizeRoadSensors(stations, metricId = ROAD_SENSOR_DEFAULT_METRIC) {
  const byBand = {};
  let stopped = 0;
  let measured = 0;
  for (const station of Array.isArray(stations) ? stations : []) {
    const band = roadSensorBand(station, metricId);
    byBand[band.id] = (byBand[band.id] || 0) + 1;
    if (band !== ROAD_SENSOR_NO_DATA_BAND) measured += 1;
    if (roadSensorIsStopped(station)) stopped += 1;
  }
  return { total: Array.isArray(stations) ? stations.length : 0, byBand, stopped, measured };
}

/**
 * Legend rows for the toggle panel: the active metric's bands in order, zero
 * counts omitted, with the no-data grey last when it has any.
 * @param {Record<string, number>} byBand
 * @param {string} metricId
 * @returns {Array<{label:string,color:string,blurb:string,count:number}>}
 */
export function roadSensorLegend(byBand, metricId = ROAD_SENSOR_DEFAULT_METRIC) {
  const metric = METRIC_BY_ID.get(metricId) || METRIC_BY_ID.get(ROAD_SENSOR_DEFAULT_METRIC);
  const rows = [];
  for (const band of metric.bands) {
    const count = byBand?.[band.id];
    if (count > 0) rows.push({ label: band.label, color: band.color, blurb: band.blurb, count });
  }
  const missing = byBand?.[ROAD_SENSOR_NO_DATA_BAND.id];
  if (missing > 0) {
    rows.push({
      label: ROAD_SENSOR_NO_DATA_BAND.label,
      color: ROAD_SENSOR_NO_DATA_BAND.color,
      blurb: ROAD_SENSOR_NO_DATA_BAND.blurb,
      count: missing,
    });
  }
  return rows;
}

/** Anchor for a station: its published start, which is where the loop is. */
export function roadSensorAnchor(station) {
  const from = station?.from;
  return Array.isArray(from) && from.length >= 2 ? from : null;
}

/**
 * Whether a station's two ends are far enough apart to draw as a line.
 *
 * Real rows publish `x_deb === x_fin` — station MY269.C4 on the A42 does — and
 * a zero-length clamped polyline is a tessellation failure, not a drawing.
 * 20 m is below any instrumented section the referential declares (the shortest
 * `longueur` in the live file is 4 m, but those rows publish one point twice).
 */
export const ROAD_SENSOR_MIN_SEGMENT_DEG = 0.0002;

/** True when the station should be drawn as a segment rather than a point. */
export function roadSensorIsSegment(station) {
  const from = station?.from;
  const to = station?.to;
  if (!Array.isArray(from) || !Array.isArray(to) || from.length < 2 || to.length < 2) return false;
  return Math.abs(from[0] - to[0]) >= ROAD_SENSOR_MIN_SEGMENT_DEG
    || Math.abs(from[1] - to[1]) >= ROAD_SENSOR_MIN_SEGMENT_DEG;
}

/** Ambient label for one station. */
export function createRoadSensorOverlayEntry({ id, position, station, metricId }) {
  const band = roadSensorBand(station, metricId);
  // A stopped road outranks a fast one; among the rest the busiest wins, since
  // "9 000 véh/h" is the reading worth reading at a glance.
  const priority = (roadSensorIsStopped(station) ? 1_000_000 : 0)
    + (Number.isFinite(station?.flow) ? Math.round(station.flow) : 0);
  return {
    id: `road-sensor-label:${id}`,
    position,
    variant: 'label',
    title: roadSensorTitle(station, metricId),
    accent: band.color,
    priority,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Card entry for the selected station. */
export function createRoadSensorSelectedEntry({ id, position, station, metricId, ageMs = null }) {
  if (!id || !position) return null;
  return {
    id: String(id),
    position,
    variant: 'selected',
    selected: true,
    protected: true,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    title: roadSensorTitle(station, metricId),
    details: roadSensorDetails(station, ageMs),
    accent: roadSensorBand(station, metricId).color,
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

/** Keep the loudest readings, with stable identity as the tie-break. */
export function selectRoadSensorOverlayCohort(entries, limit = ROAD_SENSORS_FR_OVERLAY_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(
    ROAD_SENSORS_FR_OVERLAY_COHORT_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/**
 * Map one station to a JSON-safe analyst record. Pure — no Cesium types.
 * @param {object|null|undefined} station
 * @param {number} [index=0]
 * @returns {object}
 */
export function mapRoadSensorAnalystRecord(station, index = 0) {
  const text = (value) => { const trimmed = String(value ?? '').trim(); return trimmed || null; };
  const anchor = roadSensorAnchor(station);
  return {
    id: text(station?.id) || `QTV-${String(index).padStart(4, '0')}`,
    road: text(station?.road),
    operator: text(station?.dir),
    direction: text(station?.direction),
    speedKmh: Number.isFinite(station?.speed) ? station.speed : null,
    speedSamples: Number.isFinite(station?.speedSamples) ? station.speedSamples : null,
    flowVehH: Number.isFinite(station?.flow) ? station.flow : null,
    flowSamples: Number.isFinite(station?.flowSamples) ? station.flowSamples : null,
    stopped: roadSensorIsStopped(station),
    lat: anchor ? anchor[1] : null,
    lon: anchor ? anchor[0] : null,
    measuredAtMs: Number.isFinite(station?.measuredAt) ? station.measuredAt : null,
  };
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/** Same globe-stack allowlist, and same fallback reason, as its siblings. */
const GLOBE_STACK_IDS = Object.freeze(new Set(['bing-aerial', 'bing-labels', 'osm', 'ign-ortho', 'ign-plan']));

/** Ground-line classification for one map stack. */
export function roadSensorClassificationForStack(activeId) {
  if (activeId === 'photoreal') return Cesium.ClassificationType.CESIUM_3D_TILE;
  if (GLOBE_STACK_IDS.has(activeId)) return Cesium.ClassificationType.TERRAIN;
  return Cesium.ClassificationType.BOTH;
}

/** Derive the active surface from live scene state (boot fires no event). */
export function roadSensorClassificationForScene(scene) {
  if (!scene?.globe) return Cesium.ClassificationType.BOTH;
  return scene.globe.show === false
    ? Cesium.ClassificationType.CESIUM_3D_TILE
    : Cesium.ClassificationType.TERRAIN;
}

export function createRoadSensorsFranceLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  measurementsUrl = MEASUREMENTS_URL,
  mapStackEventTarget = typeof window === 'undefined' ? null : window,
  fetchImpl = typeof fetch === 'undefined' ? null : fetch,
} = {}) {
  let _viewer = null;
  let _dataSource = null;
  let _stations = [];
  let _byRenderId = new Map();
  let _summary = summarizeRoadSensors([]);
  let _metric = ROAD_SENSOR_DEFAULT_METRIC;
  let _publishedAtMs = null;
  let _measuredAtMs = null;
  let _ageMs = null;
  let _counts = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _loading = false;
  let _enabled = false;
  let _selectedId = null;
  let _clickHandler = null;
  let _mapStackListener = null;
  let _rowControlsListener = null;
  let _classificationType = Cesium.ClassificationType.BOTH;

  const renderId = (id) => `road-sensor:${id}`;

  function applyClassification(next) {
    if (next === undefined || next === _classificationType) return;
    _classificationType = next;
    if (!_dataSource) return;
    for (const entity of _dataSource.entities.values) {
      if (entity.polyline) entity.polyline.classificationType = next;
    }
    _viewer?.scene?.requestRender?.();
  }

  function rebuildEntities() {
    if (!_dataSource) return;
    _dataSource.entities.removeAll();
    _byRenderId = new Map();
    for (const station of _stations) {
      const anchor = roadSensorAnchor(station);
      if (!anchor) continue;
      const band = roadSensorBand(station, _metric);
      const color = Cesium.Color.fromCssColorString(band.color);
      const id = renderId(station.id);
      const position = Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1]);

      if (roadSensorIsSegment(station)) {
        _dataSource.entities.add({
          id,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray([
              station.from[0], station.from[1], station.to[0], station.to[1],
            ]),
            width: 5,
            material: new Cesium.ColorMaterialProperty(color.withAlpha(0.9)),
            clampToGround: true,
            classificationType: _classificationType,
          },
        });
      } else {
        // A station whose two ends coincide, or which publishes only one. Its
        // position is real; its extent is not, so it is drawn as what it is.
        _dataSource.entities.add({
          id,
          position,
          point: {
            pixelSize: 8,
            color: color.withAlpha(0.9),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
            outlineWidth: 1,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: 5000,
          },
        });
      }
      _byRenderId.set(id, { station, position });
    }
    if (_selectedId && !_byRenderId.has(_selectedId)) clearSelection();
  }

  function publishOverlay() {
    if (!_enabled) return;
    const entries = [];
    for (const [id, record] of _byRenderId) {
      entries.push(createRoadSensorOverlayEntry({
        id, position: record.position, station: record.station, metricId: _metric,
      }));
    }
    overlayHost.setEntries(
      OVERLAY_SOURCE_ID,
      selectRoadSensorOverlayCohort(entries),
      {
        cohortLimit: ROAD_SENSORS_FR_OVERLAY_COHORT_LIMIT,
        collisionCapacity: ROAD_SENSORS_FR_OVERLAY_COLLISION_CAPACITY,
        moving: false,
      },
    );
  }

  function clearSelection() {
    _selectedId = null;
    overlayHost.clearSource(SELECTED_OVERLAY_SOURCE_ID);
  }

  function selectStation(id) {
    const record = _byRenderId.get(id);
    if (!record) return;
    _selectedId = id;
    const entry = createRoadSensorSelectedEntry({
      id,
      position: record.position,
      station: record.station,
      metricId: _metric,
      ageMs: _ageMs,
    });
    if (entry) {
      overlayHost.setEntries(SELECTED_OVERLAY_SOURCE_ID, [entry], {
        cohortLimit: 1,
        collisionCapacity: 1,
        moving: false,
      });
    }
    governorRequestRender('road-sensors-fr-select');
  }

  function resolvePick(picked) {
    if (!picked) return null;
    const direct = picked.id?.id;
    if (typeof direct === 'string' && _byRenderId.has(direct)) return direct;
    if (typeof picked.id === 'string' && _byRenderId.has(picked.id)) return picked.id;
    const primitiveId = picked.primitive?.id;
    if (typeof primitiveId === 'string' && _byRenderId.has(primitiveId)) return primitiveId;
    return null;
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && _selectedId) clearSelection();
  }

  function installClickHandler(viewer) {
    // No canvas means no scene to click on — a unit harness, or a viewer torn
    // down mid-enable. Cesium would throw on the listener install.
    if (_clickHandler || !viewer?.scene?.canvas) return;
    _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    _clickHandler.setInputAction((click) => {
      const id = resolvePick(viewer.scene.pick(click.position));
      if (id) selectStation(id);
      else if (_selectedId) clearSelection();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);
  }

  async function load() {
    if (!fetchImpl) return false;
    _loading = true;
    try {
      const response = await fetchImpl(measurementsUrl);
      if (!response.ok) {
        _lastError = `QTV HTTP ${response.status}`;
        console.warn(`[Data:RoadSensors FR] Feed returned ${response.status}`);
        return false;
      }
      const payload = await response.json();
      if (!Array.isArray(payload?.stations)) {
        _lastError = 'Réponse QTV malformée';
        return false;
      }
      _stations = payload.stations;
      _publishedAtMs = Number.isFinite(payload.publishedAtMs) ? payload.publishedAtMs : null;
      _measuredAtMs = Number.isFinite(payload.measuredAtMs) ? payload.measuredAtMs : null;
      _ageMs = Number.isFinite(payload.ageMs) ? payload.ageMs : null;
      _counts = payload.counts || null;
      _stale = payload.stale === true || (_ageMs !== null && _ageMs > ROAD_SENSOR_STALE_AGE_MS);
      _lastUpdate = Date.now();
      _lastError = null;
      _summary = summarizeRoadSensors(_stations, _metric);
      rebuildEntities();
      publishOverlay();
      _rowControlsListener?.();
      _viewer?.scene?.requestRender?.();
      console.log(
        `[Data:RoadSensors FR] ${_summary.total} stations dessinées, `
        + `${_summary.measured} mesurantes, ${_summary.stopped} à l’arrêt`,
      );
      return true;
    } catch (error) {
      console.warn('[Data:RoadSensors FR] Fetch error:', error);
      _lastError = 'Réseau Bison Futé indisponible';
      return false;
    } finally {
      _loading = false;
    }
  }

  const layer = {
    id: ROAD_SENSORS_FR_LAYER_ID,
    name: 'Capteurs trafic (FR)',
    icon: '≋',
    source: 'Bison Futé / QTV-DIR',
    updateInterval: UPDATE_INTERVAL_MS,

    init(viewer) {
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource(ROAD_SENSORS_FR_LAYER_ID);
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _stations = [];
      _byRenderId = new Map();
      _summary = summarizeRoadSensors([]);
      _publishedAtMs = null;
      _measuredAtMs = null;
      _ageMs = null;
      _counts = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      _classificationType = roadSensorClassificationForScene(viewer?.scene);
      if (mapStackEventTarget && !_mapStackListener) {
        _mapStackListener = (event) => {
          applyClassification(event?.detail?.activeId
            ? roadSensorClassificationForStack(event.detail.activeId)
            : roadSensorClassificationForScene(_viewer?.scene));
        };
        mapStackEventTarget.addEventListener('gev:map-stack-changed', _mapStackListener);
      }
      overlayHost.setVisible(OVERLAY_SOURCE_ID, false);
      overlayHost.setVisible(SELECTED_OVERLAY_SOURCE_ID, false);
      console.log('[Data:RoadSensors FR] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      applyClassification(roadSensorClassificationForScene(viewer?.scene || _viewer?.scene));
      overlayHost.setVisible(OVERLAY_SOURCE_ID, true);
      overlayHost.setVisible(SELECTED_OVERLAY_SOURCE_ID, true);
      if (viewer) {
        installClickHandler(viewer);
        registerPickOwner(ROAD_SENSORS_FR_LAYER_ID, (pickedId) => _byRenderId.has(pickedId));
      }
      publishOverlay();
    },

    disable() {
      _enabled = false;
      clearSelection();
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(OVERLAY_SOURCE_ID);
      overlayHost.setVisible(OVERLAY_SOURCE_ID, false);
      overlayHost.setVisible(SELECTED_OVERLAY_SOURCE_ID, false);
      if (_clickHandler) {
        _clickHandler.destroy();
        _clickHandler = null;
      }
      if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
      unregisterPickOwner(ROAD_SENSORS_FR_LAYER_ID);
    },

    async update() {
      if (!_enabled) return false;
      return load();
    },

    destroy(viewer) {
      this.disable();
      if (mapStackEventTarget && _mapStackListener) {
        mapStackEventTarget.removeEventListener('gev:map-stack-changed', _mapStackListener);
        _mapStackListener = null;
      }
      if (_dataSource && viewer) {
        viewer.dataSources.remove(_dataSource, true);
      }
      _dataSource = null;
      _viewer = null;
      _stations = [];
      _byRenderId = new Map();
      _summary = summarizeRoadSensors([]);
      _publishedAtMs = null;
      _measuredAtMs = null;
      _ageMs = null;
      _counts = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
    },

    setParams(params = {}) {
      if (params.metric === undefined) return false;
      const next = METRIC_BY_ID.has(params.metric) ? params.metric : null;
      if (!next || next === _metric) return false;
      _metric = next;
      _summary = summarizeRoadSensors(_stations, _metric);
      rebuildEntities();
      publishOverlay();
      if (_selectedId) selectStation(_selectedId);
      _rowControlsListener?.();
      governorRequestRender('road-sensors-fr-metric');
      return true;
    },

    setRowControlsListener(listener) {
      _rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    getRowControls() {
      const chips = ROAD_SENSOR_METRICS.map((metric) => ({
        id: metric.id,
        label: metric.label,
        active: _metric === metric.id,
        state: _metric === metric.id ? 'active' : 'idle',
        title: metric.title,
        params: { metric: metric.id },
      }));
      return { chips, legend: roadSensorLegend(_summary.byBand, _metric) };
    },

    getAnalystRecords(maxCount = 900) {
      if (!_enabled) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 900;
      const records = [];
      for (const station of _stations) {
        if (records.length >= limit) break;
        records.push(mapRoadSensorAnalystRecord(station, records.length));
      }
      return records;
    },

    getStats() {
      return {
        count: _summary.total,
        lastUpdate: _lastUpdate,
        error: _lastError,
        loading: _loading,
        // Two ways to be stale: the proxy is serving a cache past its TTL, or
        // the newest reading is simply old. Both mean the same to a reader.
        stale: _stale,
        publishedAt: _publishedAtMs,
        measuredAt: _measuredAtMs,
        ageMs: _ageMs,
        metric: _metric,
        measured: _summary.measured,
        stopped: _summary.stopped,
        bands: _summary.byBand,
        // The published census behind the drawn set: 1 206 stations reported,
        // 840 of them placeable. The row shows both so the gap is never silent.
        published: _counts?.published ?? null,
        upstream: _counts,
        coverage: 'RRN non concédé',
      };
    },
  };

  return layer;
}

const roadSensorsFranceLayer = createRoadSensorsFranceLayer();

export default roadSensorsFranceLayer;
