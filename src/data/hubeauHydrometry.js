import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';

/**
 * Hub'Eau Hydrométrie — France's live river-gauge mesh.
 *
 * Eaufrance publishes every hydrometric station in France and its real-time
 * observations through a keyless REST API (api_version 2.0.1). This is the raw
 * measurement layer underneath Vigicrues (see `vigicrues.js`): Vigicrues gives
 * the state's colour-coded reading of flood risk, Hub'Eau gives the numbers
 * that reading is made from. Upstream chain: measurements from the DREALs and
 * other operators → the PHyC platform run by the Service Central Vigicrues
 * (SCV, ex-SCHAPI) → Hub'Eau, edited by the OFB and hosted by the BRGM.
 *
 * MEASURED against the live API on 2026-08-26:
 *   - `Access-Control-Allow-Origin: *` — fetched straight from the browser, no
 *     proxy, exactly like the USGS and Vigicrues feeds
 *   - 6,469 stations in the reference set, 4,150 flagged `en_service`
 *   - a France-wide bbox reference request returned 3,919 active stations
 *
 * ── The two unit traps ──────────────────────────────────────────────────────
 * Verified against Le Rhône à Tarascon (V720001002), which returned
 * `Q: 717000`, and a Seine station returning `H: 978`:
 *   - **Q (débit) is in LITRES per second.** 717,000 L/s = 717 m³/s, right for
 *     the lower Rhône in late August. Read as m³/s it would be 3.4 Amazons.
 *   - **H (hauteur) is in MILLIMETRES**, and — the bigger trap — it is a
 *     staff-gauge reading against each station's OWN arbitrary zero. All 2,463
 *     stations reporting H carry `code_systeme_alti_serie = 31`, SANDRE's
 *     "système local, hauteur relative". 15% of live H values are negative,
 *     and the semantics are not even consistent between producers: one dam
 *     reports 937,000 mm (a reservoir surface as an absolute NGF altitude)
 *     while another reports −17,180 mm (drawdown below its local zero).
 *     H therefore CANNOT drive a colour ramp or a size ramp, and two stations'
 *     H values are not comparable. Only Q scales anything here, and H is only
 *     ever shown as that one station's own number, labelled as a gauge reading.
 *
 * ── Why only reporting stations are drawn ───────────────────────────────────
 * `en_service=true` is not the same as reporting: of 4,150 nominally active
 * stations, roughly 2,429 (H) and 1,786 (Q) actually delivered a reading in the
 * last hour. Drawing the reference set would put ~1,700 permanently dark dots
 * on the map that read as a rendering bug. So the layer draws stations that
 * have a reading in the window, and reports the silent ones as a number in
 * `getStats()` instead of as dead pixels.
 *
 * ── Why the window is an hour ───────────────────────────────────────────────
 * Readings do not arrive smoothly. A national census by lookback window:
 * 15 min → 261 stations, 30 min → 891, 60 min → 2,429, and the census
 * saturates around 2,500–2,700. Per-station age of the latest reading inside a
 * 60-minute window: p10 12 min, median 27 min, p90 42 min. An hour is the
 * narrowest window that sees most of the network.
 *
 * At a France-wide camera that hour exceeds the 20,000-row page cap: a live
 * run on 2026-08-26 drew 2,070 stations and reported `truncated: true`. That
 * is ~77% of the reporting network at national zoom and all of it at regional
 * zoom, and `getStats().truncated` says which — a truncated page is never
 * presented as the whole network.
 *
 * This is not a flood-warning tool. The values are raw, unvalidated
 * ("Brute" / "Non qualifiée"), 23% of live Q readings are flagged *Douteuse*
 * by the producer, and Hub'Eau publishes the API "sans garantie sur leur
 * disponibilité et leur performance". Vigicrues is the official channel.
 */

const STATIONS_URL = 'https://hubeau.eaufrance.fr/api/v2/hydrometrie/referentiel/stations';
const OBSERVATIONS_URL = 'https://hubeau.eaufrance.fr/api/v2/hydrometrie/observations_tr';

/** Shared world-overlay source id (matches the layer id). */
export const HUBEAU_OVERLAY_SOURCE_ID = 'hubeau-hydro';
/** Bounded label cohort offered to the shared overlay host. */
export const HUBEAU_OVERLAY_COHORT_LIMIT = 120;
/** Shared ambient-label paint budget, matching the sibling ambient sources. */
export const HUBEAU_OVERLAY_COLLISION_CAPACITY = 72;

/**
 * Widest viewport that still makes a bounded request.
 *
 * Metropolitan France is 14.8° of longitude wide (−5.2 → 9.6), not the ~10°
 * its latitude span suggests, and a camera that FRAMES the country sees wider
 * still. 20° is the smallest cap that serves the country-wide view — the one
 * that makes this layer worth having — while still refusing a continental or
 * global camera. The upper bound on what any request can return is the French
 * network itself, so the gate is about not fetching France while the user
 * looks at Brazil, not about protecting against an unbounded result.
 */
export const HUBEAU_MAX_VIEWPORT_DEGREES = 20;
/** Camera settle window before a bounded request commits. */
export const HUBEAU_REQUEST_DEBOUNCE_MS = 500;
/**
 * Idle refresh cadence. A station's fastest publish cadence is 5 minutes and
 * the median reading is already 27 minutes old, so polling faster than this
 * returns unchanged rows and only loads a public service that offers no
 * availability guarantee. Camera motion refreshes out of band.
 */
const UPDATE_INTERVAL_MS = 180000;
/** Observation lookback — see the window rationale in the module header. */
export const HUBEAU_OBSERVATION_WINDOW_MS = 3600000;
/**
 * Page sizes. The two endpoints do NOT share a cap: `observations_tr` accepts
 * 20,000 while `referentiel/stations` rejects anything over 10,000 with
 * `ValidatePageSize`, despite the docs quoting 20,000 for both.
 */
const STATION_PAGE_SIZE = 10000;
const OBSERVATION_PAGE_SIZE = 20000;
/** Hard render cap, mirroring the bikeshare dot budget. */
export const HUBEAU_MAX_RENDERED_STATIONS = 4200;
/** A reading older than this is drawn, but marked stale. */
export const HUBEAU_STALE_AFTER_MS = 3 * 3600000;

/** SANDRE nsa 515 — a producer-flagged doubtful observation. */
export const HUBEAU_QUALIFICATION_DOUBTFUL = 12;

const COLOR_LIVE = Cesium.Color.fromCssColorString('#4fc3f7');
const COLOR_STALE = Cesium.Color.fromCssColorString('#7c8aa0');
const COLOR_OUTLINE = Cesium.Color.fromCssColorString('#04121f');

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/**
 * Clamp a viewport rectangle (already in degrees) to a bounded request box.
 * Kept Cesium-free so it can be unit-tested with node:test, following the
 * `trafficBounds` precedent.
 * @param {{south:number,west:number,north:number,east:number}|null} rectangle
 * @returns {{south:number,west:number,north:number,east:number}|null}
 */
export function hubeauViewportBox(rectangle) {
  if (!rectangle) return null;
  const { south, west, north, east } = rectangle;
  if (!Number.isFinite(south + west + north + east)) return null;
  // A view that wraps the dateline reports east <= west; France never does,
  // so that is a global camera and belongs behind the zoom-in gate.
  if (east <= west || north <= south) return null;
  if (north - south > HUBEAU_MAX_VIEWPORT_DEGREES) return null;
  if (east - west > HUBEAU_MAX_VIEWPORT_DEGREES) return null;
  return { south, west, north, east };
}

/**
 * Hub'Eau's bbox parameter, in its documented order:
 * `lon_min,lat_min,lon_max,lat_max`.
 *
 * Getting this order wrong fails SILENTLY, which is why it has its own
 * function and its own test: transposing lat and lon still describes a
 * geometrically valid box (off Somalia, for French inputs) and the API
 * answers HTTP 200 with `count: 0`. That reads as "no station is reporting",
 * not as a bug. Only reversing the CORNERS is caught, with a 400
 * `ValidateBbox`.
 * @param {{south:number,west:number,north:number,east:number}} box
 * @returns {string}
 */
export function hubeauBboxParam(box) {
  return [box.west, box.south, box.east, box.north]
    .map((value) => value.toFixed(4))
    .join(',');
}

/**
 * Build the station-reference request. `fields` is worth it HERE — it cuts the
 * bootstrap from 698 KiB to 152 KiB — but the two coordinate fields must stay
 * in the list: asking for `fields` without them makes the API return
 * `"geometry": null` for every feature, which silently empties the layer.
 * @param {object} box
 * @param {string} [baseUrl]
 * @returns {string}
 */
export function hubeauStationsRequestUrl(box, baseUrl = STATIONS_URL) {
  const params = new URLSearchParams({
    bbox: hubeauBboxParam(box),
    en_service: 'true',
    format: 'geojson',
    size: String(STATION_PAGE_SIZE),
    fields: 'code_station,libelle_station,libelle_cours_eau,longitude_station,latitude_station',
  });
  return `${baseUrl}?${params}`;
}

/**
 * Build the real-time observation request.
 *
 * Deliberately does NOT use `fields`. It is flagged experimental upstream and
 * measured 5x SLOWER on this hot path for 21% less wire (3.15 s / 396 KiB full
 * against 16.18 s / 312 KiB trimmed) — the opposite of the reference request
 * above, where it pays.
 *
 * `date_debut_obs` is what makes the census complete; without it, `sort=desc`
 * plus a page cap only reaches back about 15 minutes, which sees ~11% of the
 * network.
 * @param {object} box
 * @param {number} sinceMs
 * @param {string} [baseUrl]
 * @returns {string}
 */
export function hubeauObservationsRequestUrl(box, sinceMs, baseUrl = OBSERVATIONS_URL) {
  const params = new URLSearchParams({
    bbox: hubeauBboxParam(box),
    date_debut_obs: new Date(sinceMs).toISOString(),
    size: String(OBSERVATION_PAGE_SIZE),
    sort: 'desc',
  });
  return `${baseUrl}?${params}`;
}

/**
 * Parse a station-reference GeoJSON page into a code → metadata map.
 * @param {object|null|undefined} geojson
 * @returns {Map<string, {name:string, river:string|null}>}
 */
export function parseHubeauStations(geojson) {
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  const stations = new Map();
  for (const feature of features) {
    const properties = feature?.properties || {};
    const code = String(properties.code_station ?? '').trim();
    if (!code) continue;
    stations.set(code, {
      name: String(properties.libelle_station ?? '').trim() || code,
      river: String(properties.libelle_cours_eau ?? '').trim() || null,
    });
  }
  return stations;
}

/**
 * Reduce an observation page to the newest H and Q per station.
 *
 * Two filters carry real weight:
 *   - Rows with a null `code_station` are SITE-level series, and 98.8% of them
 *     duplicate a station-level row with the same site, timestamp and value.
 *     They are ~49% of a national Q window; keeping them double-counts half
 *     the discharge network. (H exhibits none, so a bug here would be
 *     invisible to anyone who only tests with `grandeur_hydro=H`.)
 *   - Each station's series is a time series; only its head is a current
 *     reading. `sort=desc` means the first row seen is already that head, but
 *     the newest-wins comparison below does not depend on that ordering.
 * @param {object|null|undefined} payload
 * @returns {Map<string, object>}
 */
export function parseHubeauObservations(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const byStation = new Map();
  for (const row of rows) {
    const code = String(row?.code_station ?? '').trim();
    if (!code) continue; // site-level duplicate — see the note above
    const grandeur = String(row?.grandeur_hydro ?? '').trim().toUpperCase();
    if (grandeur !== 'H' && grandeur !== 'Q') continue;
    // `Number(null)` is 0, not NaN — a Number()-only guard would turn a
    // missing discharge into a confident "0 m³/s" on a live river.
    const raw = row?.resultat_obs;
    if (raw === null || raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const atMs = Date.parse(String(row?.date_obs ?? ''));
    if (!Number.isFinite(atMs)) continue;
    const lon = Number(row?.longitude);
    const lat = Number(row?.latitude);
    let entry = byStation.get(code);
    if (!entry) {
      entry = { code, lon: null, lat: null, H: null, Q: null };
      byStation.set(code, entry);
    }
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      entry.lon = lon;
      entry.lat = lat;
    }
    if (!entry[grandeur] || atMs > entry[grandeur].atMs) {
      entry[grandeur] = {
        value,
        atMs,
        doubtful: Number(row?.code_qualification_obs) === HUBEAU_QUALIFICATION_DOUBTFUL,
      };
    }
  }
  return byStation;
}

/** Convert a raw Q observation (litres per second) to m³/s. */
export function hubeauDischargeM3s(litresPerSecond) {
  return litresPerSecond / 1000;
}

/**
 * Convert a raw H observation (millimetres) to metres. The result is a stage
 * against the station's own local datum: it may be negative, and it is not
 * comparable with any other station's.
 */
export function hubeauStageM(millimetres) {
  return millimetres / 1000;
}

/**
 * Freshness of a reading relative to `nowMs`. `expired` cannot occur inside
 * the requested window, but overseas territories publish erratically — Réunion
 * was 25 days stale on 2026-08-26 — so a dot is never drawn without checking
 * its own timestamp.
 * @param {number|null|undefined} atMs
 * @param {number} nowMs
 * @returns {'live'|'stale'|'expired'|'none'}
 */
export function hubeauFreshness(atMs, nowMs) {
  if (!Number.isFinite(atMs)) return 'none';
  const age = nowMs - atMs;
  if (age >= HUBEAU_OBSERVATION_WINDOW_MS * 24) return 'expired';
  if (age >= HUBEAU_STALE_AFTER_MS) return 'stale';
  return 'live';
}

/**
 * Format a discharge for display, at a precision that suits both a 0.4 m³/s
 * brook and a 2,400 m³/s Rhône. Negative discharges are real (tidal reaches).
 * @param {number} m3s
 * @returns {string}
 */
export function formatHubeauDischarge(m3s) {
  const abs = Math.abs(m3s);
  if (abs < 1) return `${m3s.toFixed(2)} m³/s`;
  if (abs < 100) return `${m3s.toFixed(1)} m³/s`;
  return `${Math.round(m3s)} m³/s`;
}

/**
 * Format a stage for display. Named "gauge" rather than a bare metre value
 * because it is a staff-gauge reading against a local zero, not a depth.
 * @param {number} metres
 * @returns {string}
 */
export function formatHubeauStage(metres) {
  return `gauge ${metres.toFixed(2)} m`;
}

/**
 * Resolve one station's observations into the single reading its dot and label
 * present. Discharge wins when both exist: it is the only one of the two that
 * means the same thing at every station.
 * @param {object|null|undefined} observation Entry from parseHubeauObservations.
 * @param {number} nowMs
 * @returns {{kind:'Q'|'H'|null, value:number|null, atMs:number|null,
 *   doubtful:boolean, freshness:string, text:string|null}}
 */
export function hubeauReading(observation, nowMs) {
  const candidates = [];
  if (observation?.Q) {
    candidates.push({
      kind: 'Q',
      value: hubeauDischargeM3s(observation.Q.value),
      atMs: observation.Q.atMs,
      doubtful: observation.Q.doubtful === true,
    });
  }
  if (observation?.H) {
    candidates.push({
      kind: 'H',
      value: hubeauStageM(observation.H.value),
      atMs: observation.H.atMs,
      doubtful: observation.H.doubtful === true,
    });
  }
  for (const candidate of candidates) {
    const freshness = hubeauFreshness(candidate.atMs, nowMs);
    if (freshness === 'expired' || freshness === 'none') continue;
    const text = candidate.kind === 'Q'
      ? formatHubeauDischarge(candidate.value)
      : formatHubeauStage(candidate.value);
    return {
      ...candidate,
      freshness,
      // The producer's own doubt is carried into the label rather than
      // silently dropped: 23% of live Q readings are flagged Douteuse, and
      // discharge is derived through a rating curve that is least reliable at
      // exactly the extremes a globe makes most prominent.
      text: candidate.doubtful ? `${text} ?` : text,
    };
  }
  return { kind: null, value: null, atMs: null, doubtful: false, freshness: 'none', text: null };
}

/**
 * Dot size for a station. Only a trustworthy discharge scales it: comparing
 * two stations' stage readings would be comparing two different local datums,
 * and a producer-flagged doubtful value should not be given visual weight it
 * has not earned. Both fall back to the neutral base size.
 * @param {{kind:string|null, value:number|null, doubtful:boolean}} reading
 * @returns {number} Pixel size.
 */
export function hubeauPixelSize(reading) {
  if (reading?.kind !== 'Q' || reading.doubtful || !Number.isFinite(reading.value)) return 5;
  // log10 over the 0.1 → 5,000 m³/s span French rivers actually cover.
  const magnitude = Math.log10(Math.max(0.1, reading.value)) + 1; // 0 … ~4.7
  return Math.max(5, Math.min(15, 5 + magnitude * 2.2));
}

/**
 * Dot colour for a station, by how current its reading is.
 * @param {{freshness:string}} reading
 * @returns {Cesium.Color}
 */
export function hubeauPointColor(reading) {
  return reading?.freshness === 'live' ? COLOR_LIVE : COLOR_STALE;
}

/**
 * Join observations to station names into the records the layer draws. Only
 * stations that actually reported are drawn — see the module header.
 * @param {Map<string, object>} observations
 * @param {Map<string, object>} stations
 * @param {number} nowMs
 * @returns {Array<object>}
 */
export function buildHubeauRecords(observations, stations, nowMs) {
  const records = [];
  for (const entry of observations?.values?.() || []) {
    if (!Number.isFinite(entry.lon) || !Number.isFinite(entry.lat)) continue;
    const reading = hubeauReading(entry, nowMs);
    if (!reading.text) continue;
    const meta = stations?.get?.(entry.code) || null;
    records.push({
      code: entry.code,
      name: meta?.name || entry.code,
      river: meta?.river || null,
      lon: entry.lon,
      lat: entry.lat,
      reading,
    });
  }
  // Live readings are the point of the layer, so they survive the render cap
  // first; discharge magnitude orders the rest.
  const rank = (record) => (record.reading.freshness === 'live' ? 1 : 0);
  const flow = (record) => (record.reading.kind === 'Q' ? record.reading.value : -Infinity);
  records.sort((a, b) => rank(b) - rank(a) || flow(b) - flow(a) || a.code.localeCompare(b.code));
  return records.slice(0, HUBEAU_MAX_RENDERED_STATIONS);
}

/**
 * Count what is actually on screen.
 * @param {Array<object>} records
 * @returns {{total:number, live:number, stale:number, doubtful:number, discharge:number}}
 */
export function summarizeHubeauRecords(records) {
  const summary = { total: 0, live: 0, stale: 0, doubtful: 0, discharge: 0 };
  for (const record of Array.isArray(records) ? records : []) {
    summary.total += 1;
    if (record?.reading?.freshness === 'live') summary.live += 1;
    else summary.stale += 1;
    if (record?.reading?.doubtful) summary.doubtful += 1;
    if (record?.reading?.kind === 'Q') summary.discharge += 1;
  }
  return summary;
}

/**
 * Build the source-owned presentation for one station label.
 * @param {object} record
 * @param {Cesium.Cartesian3} position
 * @returns {object}
 */
export function createHubeauOverlayEntry(record, position) {
  return {
    id: `hubeau:${record.code}`,
    position,
    variant: 'label',
    title: `${record.name} · ${record.reading.text}`,
    accent: hubeauPointColor(record.reading).toCssColorString(),
    // Bigger rivers win a contested label slot; ties break on code.
    priority: record.reading.kind === 'Q' && !record.reading.doubtful
      ? Math.round(1000 + Math.log10(Math.max(0.1, record.reading.value)) * 100)
      : 500,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 14,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Keep the highest-priority readings, with stable identity as the tie-break. */
export function selectHubeauOverlayCohort(entries, limit = HUBEAU_OVERLAY_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(
    HUBEAU_OVERLAY_COHORT_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/**
 * Map one station to a JSON-safe analyst record (analyst query engine seam).
 * Values are the CONVERTED SI ones — an analyst asking "the biggest river"
 * must not be handed litres per second labelled as discharge — and stage is
 * reported under a name that says what it is.
 * @param {object|null|undefined} record
 * @param {number} [index=0]
 * @returns {object}
 */
export function mapAnalystRecord(record, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  const reading = record?.reading || {};
  return {
    id: text(record?.code) || `STATION-${String(index).padStart(4, '0')}`,
    name: text(record?.name),
    river: text(record?.river),
    lat: num(record?.lat),
    lon: num(record?.lon),
    dischargeM3s: reading.kind === 'Q' ? num(reading.value) : null,
    localGaugeM: reading.kind === 'H' ? num(reading.value) : null,
    observedAtMs: num(reading.atMs),
    freshness: text(reading.freshness) || 'none',
    producerFlaggedDoubtful: reading.doubtful === true,
  };
}

export function createHubeauHydrometryLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  stationsUrl = STATIONS_URL,
  observationsUrl = OBSERVATIONS_URL,
  now = () => Date.now(),
} = {}) {
  let _viewer = null;
  let _pointCollection = null;
  // Station metadata is a REFERENCE table — names and rivers do not change
  // between polls, and the France-wide page is 1.5 MB against 400 KB for the
  // observations. Cached per bbox so an idle refresh re-fetches only the
  // measurements, which are the only part that moves.
  let _stationCacheKey = null;
  let _stationCache = new Map();
  let _records = [];
  let _summary = summarizeHubeauRecords([]);
  let _activeInView = 0;
  let _truncated = false;
  let _lastUpdate = null;
  let _lastError = null;
  let _status = 'idle';
  let _enabled = false;
  let _loading = false;
  let _abort = null;
  let _moveEndRemove = null;
  let _debounceTimer = null;
  let _generation = 0;

  function setStatus(status, error = null) {
    _status = status;
    _lastError = error;
  }

  function viewportBox() {
    const camera = _viewer?.camera;
    const ellipsoid = _viewer?.scene?.globe?.ellipsoid;
    const rectangle = camera?.computeViewRectangle?.(ellipsoid);
    if (!rectangle) return null;
    return hubeauViewportBox({
      south: Cesium.Math.toDegrees(rectangle.south),
      west: Cesium.Math.toDegrees(rectangle.west),
      north: Cesium.Math.toDegrees(rectangle.north),
      east: Cesium.Math.toDegrees(rectangle.east),
    });
  }

  function repaint() {
    if (!_pointCollection) return;
    _pointCollection.removeAll();
    const entries = [];
    for (const record of _records) {
      const position = Cesium.Cartesian3.fromDegrees(record.lon, record.lat);
      _pointCollection.add({
        position,
        pixelSize: hubeauPixelSize(record.reading),
        color: hubeauPointColor(record.reading),
        outlineColor: COLOR_OUTLINE,
        outlineWidth: 1,
        scaleByDistance: new Cesium.NearFarScalar(2000, 1.3, 900000, 0.45),
        translucencyByDistance: new Cesium.NearFarScalar(2000, 1, 1400000, 0.25),
        disableDepthTestDistance: 2500,
        id: `hubeau:${record.code}`,
      });
      entries.push(createHubeauOverlayEntry(record, position));
    }
    if (_enabled) {
      overlayHost.setEntries(
        HUBEAU_OVERLAY_SOURCE_ID,
        selectHubeauOverlayCohort(entries),
        {
          cohortLimit: HUBEAU_OVERLAY_COHORT_LIMIT,
          collisionCapacity: HUBEAU_OVERLAY_COLLISION_CAPACITY,
          moving: false,
        },
      );
    }
    _viewer?.scene?.requestRender?.();
  }

  function clearRendered() {
    _pointCollection?.removeAll();
    _records = [];
    _summary = summarizeHubeauRecords([]);
    _activeInView = 0;
    _truncated = false;
  }

  async function load() {
    if (!_enabled || !_viewer) return false;
    const box = viewportBox();
    if (!box) {
      _abort?.abort();
      _abort = null;
      _loading = false;
      clearRendered();
      overlayHost.clearSource(HUBEAU_OVERLAY_SOURCE_ID);
      setStatus('zoom-in', null);
      return false;
    }

    _abort?.abort();
    const abort = new AbortController();
    _abort = abort;
    const generation = ++_generation;
    const owns = () => generation === _generation && !abort.signal.aborted && _enabled;
    _loading = true;
    const nowMs = now();

    const boxKey = hubeauBboxParam(box);
    const stationsAreCached = boxKey === _stationCacheKey;

    try {
      const [stationsResponse, observationsResponse] = await Promise.all([
        stationsAreCached
          ? null
          : fetch(hubeauStationsRequestUrl(box, stationsUrl), { signal: abort.signal }),
        fetch(
          hubeauObservationsRequestUrl(box, nowMs - HUBEAU_OBSERVATION_WINDOW_MS, observationsUrl),
          { signal: abort.signal },
        ),
      ]);
      if (!owns()) return false;
      // Hub'Eau answers a capped page with 206 Partial Content, which is a
      // SUCCESS here — the layer asks for a bounded page on purpose.
      const ok = (response) => response.ok || response.status === 206;
      if (stationsResponse && !ok(stationsResponse)) {
        setStatus('unavailable', `Hub'Eau stations HTTP ${stationsResponse.status}`);
        return false;
      }
      if (!ok(observationsResponse)) {
        setStatus('unavailable', `Hub'Eau observations HTTP ${observationsResponse.status}`);
        return false;
      }

      const [stationsBody, observationsBody] = await Promise.all([
        stationsResponse ? stationsResponse.json() : null,
        observationsResponse.json(),
      ]);
      if (!owns()) return false;

      const stations = stationsResponse ? parseHubeauStations(stationsBody) : _stationCache;
      if (stationsResponse) {
        _stationCache = stations;
        _stationCacheKey = boxKey;
      }
      const observations = parseHubeauObservations(observationsBody);
      _records = buildHubeauRecords(observations, stations, nowMs);
      _summary = summarizeHubeauRecords(_records);
      _activeInView = stations.size;
      // The page cap is a real ceiling during a flood, when more stations
      // report and report more often — exactly when the map matters. Say so
      // rather than presenting a truncated page as the whole network.
      _truncated = Boolean(observationsBody?.next);
      _lastUpdate = nowMs;
      setStatus(_records.length ? 'nominal' : 'empty', null);
      repaint();
      console.log(
        `[Data:Hubeau] ${_summary.total} reporting stations of ${_activeInView} active in view`,
      );
      return true;
    } catch (error) {
      if (abort.signal.aborted) return false;
      console.warn('[Data:Hubeau] Fetch error:', error);
      setStatus('unavailable', "Hub'Eau network error");
      return false;
    } finally {
      if (generation === _generation) {
        _loading = false;
        if (_abort === abort) _abort = null;
      }
    }
  }

  function scheduleLoad() {
    if (!_enabled) return;
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      _debounceTimer = null;
      load();
    }, HUBEAU_REQUEST_DEBOUNCE_MS);
  }

  const layer = {
    id: 'hubeau-hydro',
    name: "Hub'Eau Gauges (FR)",
    icon: '◉',
    source: "Hub'Eau / Eaufrance",
    updateInterval: UPDATE_INTERVAL_MS,

    init(viewer) {
      _viewer = viewer;
      _pointCollection = new Cesium.PointPrimitiveCollection({
        blendOption: Cesium.BlendOption.TRANSLUCENT,
      });
      viewer.scene.primitives.add(_pointCollection);
      _pointCollection.show = false;
      clearRendered();
      _stationCache = new Map();
      _stationCacheKey = null;
      _lastUpdate = null;
      _enabled = false;
      setStatus('idle', null);
      overlayHost.setVisible(HUBEAU_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Hubeau] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_pointCollection) _pointCollection.show = true;
      overlayHost.setVisible(HUBEAU_OVERLAY_SOURCE_ID, true);
      if (!_moveEndRemove && viewer?.camera?.moveEnd?.addEventListener) {
        _moveEndRemove = viewer.camera.moveEnd.addEventListener(scheduleLoad);
      }
      load();
    },

    disable() {
      _enabled = false;
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
      _abort?.abort();
      _abort = null;
      _moveEndRemove?.();
      _moveEndRemove = null;
      if (_pointCollection) _pointCollection.show = false;
      overlayHost.clearSource(HUBEAU_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(HUBEAU_OVERLAY_SOURCE_ID, false);
    },

    /** Manager-driven idle refresh; camera motion refreshes separately. */
    async update() {
      if (!_enabled) return false;
      const loaded = await load();
      // A camera wider than the gate fetched nothing and failed at nothing: the
      // layer asked for a zoom, which is guidance, not a fault. Reporting it as
      // a rejected refresh tore the layer back down on enable. Only the
      // unavailable state is a failed refresh.
      //
      // No `ensureViewGate` here, unlike the layers gated at city scale: this
      // gate is 20°, so the only camera it refuses is a global one, and the
      // zoom that satisfies it over the mid-Pacific still finds no French river
      // gauge. "Zoom in" is the honest answer there; flying somewhere is not.
      return loaded || _status !== 'unavailable';
    },

    destroy(viewer) {
      _enabled = false;
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
      _abort?.abort();
      _abort = null;
      _moveEndRemove?.();
      _moveEndRemove = null;
      overlayHost.clearSource(HUBEAU_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(HUBEAU_OVERLAY_SOURCE_ID, false);
      if (_pointCollection) {
        viewer?.scene?.primitives?.remove?.(_pointCollection);
        _pointCollection = null;
      }
      _viewer = null;
      clearRendered();
      _stationCache = new Map();
      _stationCacheKey = null;
      _lastUpdate = null;
      setStatus('idle', null);
    },

    /**
     * Snapshot the stations as plain JSON-safe objects for the analyst query
     * engine. On-demand only. Returns [] while the layer is off.
     * @param {number} [maxCount=2000]
     * @returns {Array<Object>}
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 2000;
      const result = [];
      for (const record of _records) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(record, result.length));
      }
      return result;
    },

    getStats() {
      return {
        count: _summary.total,
        lastUpdate: _lastUpdate,
        error: _lastError,
        loading: _loading,
        status: _status,
        // Reported so "how much of the network is this" is answerable:
        // roughly 40% of nominally-active stations are silent at any moment.
        activeStationsInView: _activeInView,
        liveReadings: _summary.live,
        staleReadings: _summary.stale,
        doubtfulReadings: _summary.doubtful,
        truncated: _truncated,
      };
    },
  };

  return layer;
}

const hubeauHydrometryLayer = createHubeauHydrometryLayer();

export default hubeauHydrometryLayer;
