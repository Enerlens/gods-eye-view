import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { bucketSeries, textSparkline } from './sparkline.js';
import {
  clearOverlaySource,
  hitTestWorldOverlay,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { pickOverlayLabelId } from './overlayLabelPick.js';

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

/** Layer id — also the pick-registry key. */
export const HUBEAU_LAYER_ID = 'hubeau-hydro';
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
  hitTest: hitTestWorldOverlay,
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
    // MEASURED cost of this list, gzipped, over the national bbox: 207 KB with
    // the five fields it used to carry, 310 KB with these, 685 KB with no
    // `fields` at all. +103 KB once per bbox is what turns a card that says
    // "717 m³/s" into one that says which river, which commune, and since when.
    //
    // Two fields are load-bearing for reasons that are not about the card:
    // the coordinates must stay or the API returns `"geometry": null` for every
    // feature and silently empties the layer, and `code_site` is the join key to
    // `referentiel/sites`, which is where catchment area actually lives.
    //
    // Deliberately ABSENT: `type_station` (91.7 % of active stations are the
    // single value STD, and the documented enum does not match the data) and
    // `descriptif_station` (33.9 %-filled free text whose commonest values are
    // 'Aval', 'Pont', '2' and 'Historique' — not an operator, whatever it looks
    // like).
    fields: [
      'code_station',
      'libelle_station',
      'libelle_cours_eau',
      'longitude_station',
      'latitude_station',
      'code_site',
      'libelle_commune',
      'libelle_departement',
      'date_ouverture_station',
      'influence_locale_station',
      'qualification_donnees_station',
      'altitude_ref_alti_station',
    ].join(','),
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
 *
 * Everything here is optional except the name. Measured fill rates over the
 * 4 151 active stations: commune and département 99.1 %, opening date 99.9 %,
 * river 93.3 %, local influence 79.3 %, gauge-zero altitude 65.3 %. A field
 * that is absent stays `null` and simply produces no card line — the sparse-
 * network rule the rest of this module already follows for readings.
 *
 * `openedYear` is reduced to a YEAR on the way in. The API publishes a full
 * timestamp, and "gauging since 1994" is the claim the field supports; a day
 * and an hour would suggest the record is continuous from that instant, which
 * for a hydrometric station it is not.
 * @param {object|null|undefined} geojson
 * @returns {Map<string, object>}
 */
export function parseHubeauStations(geojson) {
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  const stations = new Map();
  const text = (value) => {
    const cleaned = String(value ?? '').trim();
    return cleaned || null;
  };
  for (const feature of features) {
    const properties = feature?.properties || {};
    const code = String(properties.code_station ?? '').trim();
    if (!code) continue;
    const opened = /^(\d{4})/.exec(String(properties.date_ouverture_station ?? ''));
    const altitude = Number(properties.altitude_ref_alti_station);
    stations.set(code, {
      name: text(properties.libelle_station) || code,
      river: text(properties.libelle_cours_eau),
      siteCode: text(properties.code_site),
      commune: text(properties.libelle_commune),
      departement: text(properties.libelle_departement),
      openedYear: opened ? Number(opened[1]) : null,
      influence: text(properties.influence_locale_station),
      qualification: text(properties.qualification_donnees_station),
      // Gauge zero, metres. Carried for the CARD, never used to convert a stage
      // to an absolute altitude: cross-checked against the site altitude over
      // 1 756 stations that disagreement is a median 1.1 m but a p90 of 30.8 m
      // and a max of 20 km, across at least six altimetric systems.
      gaugeZeroM: Number.isFinite(altitude) ? altitude : null,
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
      // The reference half of the record. Every one of these is optional and
      // every one of them was already on the wire before this layer asked for
      // it — see `hubeauStationsRequestUrl`.
      siteCode: meta?.siteCode || null,
      commune: meta?.commune || null,
      departement: meta?.departement || null,
      openedYear: Number.isFinite(meta?.openedYear) ? meta.openedYear : null,
      influence: meta?.influence || null,
      qualification: meta?.qualification || null,
      gaugeZeroM: Number.isFinite(meta?.gaugeZeroM) ? meta.gaugeZeroM : null,
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
    // The station's NAME is a click surface, not a caption. A gauge dot is
    // 5–15 px across and floats under a label five times its width; asking
    // people to hit the dot when the name is what they read is a target they
    // will miss. See `overlayLabelPick.js` for the host mechanism and the
    // pick-ordering rule.
    interactive: true,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 14,
    verticalOnly: true,
    placement: 'above',
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * SELECTION — the click this layer never had
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The layer drew up to 900 dots and every one of them was inert: it registered
 * no pick owner and installed no click handler, so the only thing a station
 * could ever tell you was the one number already printed beside it. The point
 * primitives have carried a stable `hubeau:<code>` id all along, so the hit
 * target existed; nothing listened for it.
 *
 * The NAME is now a click surface too, and it is the one people actually aim
 * at: it says which river this is and it is several times the dot's target
 * area. The ambient label carries the same `hubeau:<code>` id as the dot, so
 * one string identifies a station across the native drill pick, the overlay
 * hit test and the pick registry. See `overlayLabelPick.js` for the shared
 * mechanism and the pick-ordering rule.
 */

/** Selected-station card, on its own protected overlay source. */
export const HUBEAU_SELECTED_OVERLAY_SOURCE_ID = 'hubeau-hydro-selected';
export const HUBEAU_SELECTED_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});
/** Accent for the selected dot and its card. */
export const HUBEAU_SELECTED_COLOR = '#7ee8fa';
/** Pixels the selected dot gains, so the click reads as a click. */
const SELECTED_POINT_BONUS_PX = 5;
/** How far back the per-click hydrograph reaches. */
export const HUBEAU_HISTORY_WINDOW_MS = 24 * 60 * 60_000;
/** Glyphs in the drawn hydrograph. 48 is a bar every half hour over 24 h. */
export const HUBEAU_SPARK_WIDTH = 48;
/** Page cap for one station's 24 h series — 288 rows at the 5-minute cadence. */
const HISTORY_PAGE_SIZE = 500;
/** One station's history must never hold the card hostage. */
const HISTORY_TIMEOUT_MS = 12_000;
/** How deep to look for one of our dots under a click. */
const DRILL_PICK_LIMIT = 8;

/**
 * Build the per-station history request.
 *
 * Deliberately no `fields`, for the same measured reason the observation
 * request above gives: trimming this call costs 17 KB instead of 146 KB and
 * takes 2.18 s instead of 0.49 s. Bandwidth is not the scarce thing here.
 *
 * `sort=asc` because a hydrograph is read left to right, and `date_debut_obs`
 * because the endpoint keeps a rolling ~30-day archive per station — without a
 * lower bound this would page through a month to show a day.
 * @param {string} code Station code.
 * @param {string} kind `'Q'` or `'H'` — the grandeur already on the dot.
 * @param {number} sinceMs
 * @param {string} [baseUrl]
 * @returns {string}
 */
export function hubeauHistoryRequestUrl(code, kind, sinceMs, baseUrl = OBSERVATIONS_URL) {
  const params = new URLSearchParams({
    code_entite: String(code),
    grandeur_hydro: kind === 'H' ? 'H' : 'Q',
    date_debut_obs: new Date(sinceMs).toISOString(),
    size: String(HISTORY_PAGE_SIZE),
    sort: 'asc',
  });
  return `${baseUrl}?${params}`;
}

/**
 * Reduce a history page to an ordered series in the reading's own unit.
 *
 * The API publishes discharge in litres per second and stage in millimetres,
 * exactly as the live census does, so the same two converters apply — a series
 * left in raw units would draw the right SHAPE under a wrong axis, and the
 * min/max printed beside it would be nonsense.
 * @param {object|null|undefined} payload
 * @param {string} kind
 * @returns {{values:Array<number|null>, min:number|null, max:number|null, count:number}}
 */
export function parseHubeauHistory(payload, kind) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const convert = kind === 'H' ? hubeauStageM : hubeauDischargeM3s;
  const values = [];
  let min = null;
  let max = null;
  let count = 0;
  for (const row of rows) {
    const published = row?.resultat_obs;
    // A null result is a published GAP, not a zero — and `Number(null)` is 0,
    // which is finite, so testing the COERCED value alone turns every gap into
    // a river that briefly stopped flowing. Checked before the coercion, not
    // after.
    if (published === null || published === undefined || published === '') {
      values.push(null);
      continue;
    }
    const raw = Number(published);
    if (!Number.isFinite(raw)) { values.push(null); continue; }
    const value = convert(raw);
    if (!Number.isFinite(value)) { values.push(null); continue; }
    values.push(value);
    count += 1;
    if (min === null || value < min) min = value;
    if (max === null || value > max) max = value;
  }
  return { values, min, max, count };
}

/**
 * The card for one station.
 *
 * Tiered on purpose. Everything above the hydrograph comes from data the layer
 * already had on the wire and is therefore always present; the hydrograph is
 * one extra request and the card renders completely without it.
 *
 * WHAT THIS CARD DELIBERATELY DOES NOT SAY:
 *
 * • **An absolute water altitude.** `altitude_ref_alti_station` is published
 *   for 81.6 % of stage stations and its documented purpose is exactly this
 *   conversion, but checked against the site's own altitude over 1 756
 *   stations the two disagree by a median 1.1 m, a p90 of 30.8 m and a max of
 *   20 km, across at least six altimetric systems. The gauge zero is shown as
 *   what it is — the datum the stage is counted from — and the addition is
 *   left to a reader who knows which system their station uses.
 *
 * • **A historical percentile.** It is reachable in two 526-byte requests and
 *   it would compare an INSTANTANEOUS reading against a distribution of DAILY
 *   MEANS across all seasons, so a September low would read as an extreme
 *   partly because September is always low. Half the active network has no
 *   recent daily series either, so the line would appear for some stations and
 *   not others and read as a bug.
 *
 * • **Anything resembling a flood warning.** These values are raw and
 *   unqualified, 23 % of live discharge readings carry the producer's own
 *   `Douteuse` flag, and Vigicrues is the official channel. The module header
 *   has always said so; the card now has room to repeat it where it matters.
 *
 * @param {object} record
 * @param {{values?:Array, min?:number|null, max?:number|null, count?:number}|null} [history]
 * @returns {string} Newline-separated; the first line is the title.
 */
export function buildHubeauCard(record, history = null) {
  const lines = [String(record?.name ?? '').trim() || String(record?.code ?? 'Station')];
  const reading = record?.reading || {};
  const unit = reading.kind === 'H' ? 'm' : 'm³/s';

  const measured = reading.kind === 'H' ? 'hauteur' : 'débit';
  lines.push(`◈ ${reading.text || '—'} · ${measured}${reading.freshness === 'stale' ? ' · relevé ancien' : ''}`);

  if (record?.river) lines.push(`≈ ${record.river}`);

  const where = [record?.commune, record?.departement]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .join(' · ');
  if (where) lines.push(`📍 ${where}`);

  if (history?.count) {
    const spark = textSparkline(bucketSeries(history.values, HUBEAU_SPARK_WIDTH));
    if (spark) lines.push(`↻ 24 h ${spark}`);
    if (Number.isFinite(history.min) && Number.isFinite(history.max)) {
      const fmt = (value) => (reading.kind === 'H'
        ? formatHubeauStage(value)
        : formatHubeauDischarge(value));
      // The sparkline is drawn from ZERO, so a flat river reads flat — which is
      // true, and hides the amplitude. This line is where the amplitude goes.
      lines.push(history.min === history.max
        ? `   ${fmt(history.min)} sur 24 h`
        : `   de ${fmt(history.min)} à ${fmt(history.max)} sur 24 h`);
    }
  } else if (history?.pending) {
    lines.push('↻ 24 h …');
  } else if (history?.failed) {
    lines.push('↻ historique 24 h indisponible');
  }

  if (Number.isFinite(record?.openedYear)) {
    lines.push(`🕐 station ouverte en ${record.openedYear}`);
  }
  if (reading.kind === 'H' && Number.isFinite(record?.gaugeZeroM)) {
    // NOT added to the stage. See the header of this function.
    lines.push(`↧ zéro de l'échelle à ${record.gaugeZeroM} m`);
  }
  const influence = String(record?.influence ?? '').trim();
  // 'Nulle' is the majority value and says nothing; anything else is a caveat
  // the producer chose to publish about their own measurement.
  if (influence && !/^nulle$/i.test(influence)) lines.push(`⚠ influence locale : ${influence}`);

  const unqualified = /non\s*qualifi/i.test(String(record?.qualification ?? ''));
  if (reading.doubtful) {
    lines.push('⚠ relevé signalé douteux par le producteur');
  } else if (unqualified) {
    lines.push('⚠ données non qualifiées — Vigicrues reste le canal officiel');
  }

  return lines.join('\n');
}

/**
 * The protected card entry for the selected station.
 * @param {object} record
 * @param {object} position Cesium.Cartesian3.
 * @param {object|null} [history]
 * @returns {object|null}
 */
export function createHubeauSelectedOverlayEntry(record, position, history = null) {
  if (!record || !position) return null;
  const [title, ...details] = buildHubeauCard(record, history).split('\n');
  return {
    id: `hubeau:${record.code}`,
    position,
    variant: 'selected',
    selected: true,
    protected: true,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    title,
    details,
    accent: HUBEAU_SELECTED_COLOR,
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
  // Cesium registers DOM listeners in the ScreenSpaceEventHandler constructor,
  // and this layer's lifecycle is exercised headless. The factory is the seam
  // that keeps the click ORDER — dot, then name, then empty space — under test
  // off-browser; the Escape listener still needs a real `document`.
  screenSpaceEventHandlerFactory = (viewer) => (
    new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  ),
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
  /** Rendered dots by pick id, so a click resolves to a record and a position. */
  let _drawn = new Map();
  let _selectedId = null;
  let _clickHandler = null;
  /** 24 h series for the selected station: {pending}|{failed}|{values,min,max,count}. */
  let _history = null;
  let _historyAbort = null;
  /** Guards a landing history against a selection the visitor has since changed. */
  let _historyGeneration = 0;

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

  /** Republish the selected card, e.g. once its history lands. */
  function publishSelected() {
    const drawn = _selectedId ? _drawn.get(_selectedId) : null;
    if (!drawn) return;
    const entry = createHubeauSelectedOverlayEntry(drawn.record, drawn.position, _history);
    if (!entry) return;
    overlayHost.setEntries(
      HUBEAU_SELECTED_OVERLAY_SOURCE_ID,
      [entry],
      HUBEAU_SELECTED_OVERLAY_SOURCE_OPTIONS,
    );
    governorRequestRender('hubeau-select');
  }

  /**
   * Fetch the selected station's last 24 hours.
   *
   * Its own abort and its own generation counter, separate from the layer's:
   * a visitor clicking three dots in a second must not have the first station's
   * hydrograph land on the third station's card, and a history still in flight
   * must not cancel the viewport census that shares `_abort`.
   *
   * Every failure path lands on `{failed:true}` rather than throwing, because
   * the card above it is already complete and correct without this. Two of
   * twenty sampled single-station requests to this endpoint timed out at 30 s;
   * Hub'Eau publishes the API "sans garantie sur leur disponibilité".
   * @param {object} record
   */
  async function loadHistory(record) {
    const kind = record?.reading?.kind;
    if (!kind || typeof fetchImpl !== 'function') {
      _history = null;
      return;
    }
    _historyAbort?.abort();
    const abort = new AbortController();
    _historyAbort = abort;
    const generation = ++_historyGeneration;
    const owns = () => generation === _historyGeneration && !abort.signal.aborted;
    _history = { pending: true };
    const timer = setTimeout(() => abort.abort(), HISTORY_TIMEOUT_MS);
    try {
      const url = hubeauHistoryRequestUrl(
        record.code,
        kind,
        now() - HUBEAU_HISTORY_WINDOW_MS,
        observationsUrl,
      );
      const response = await fetchImpl(url, { signal: abort.signal });
      if (!owns()) return;
      // A capped page comes back as 206 Partial Content, which is a success:
      // the request asks for a bounded page on purpose.
      if (!response.ok && response.status !== 206) {
        _history = { failed: true };
        publishSelected();
        return;
      }
      const body = await response.json();
      if (!owns()) return;
      const parsed = parseHubeauHistory(body, kind);
      _history = parsed.count ? parsed : { failed: true };
      publishSelected();
    } catch {
      if (!owns()) return;
      _history = { failed: true };
      publishSelected();
    } finally {
      clearTimeout(timer);
      if (_historyAbort === abort) _historyAbort = null;
    }
  }

  function clearSelection() {
    const drawn = _selectedId ? _drawn.get(_selectedId) : null;
    if (drawn?.point) {
      drawn.point.outlineColor = COLOR_OUTLINE;
      drawn.point.pixelSize = drawn.basePixelSize;
    }
    _selectedId = null;
    _history = null;
    _historyAbort?.abort();
    _historyAbort = null;
    _historyGeneration += 1;
    overlayHost.clearSource(HUBEAU_SELECTED_OVERLAY_SOURCE_ID);
  }

  function selectObject(pickId) {
    const drawn = _drawn.get(pickId);
    clearSelection();
    if (!drawn) return;
    _selectedId = pickId;
    if (drawn.point) {
      drawn.point.outlineColor = Cesium.Color.fromCssColorString(HUBEAU_SELECTED_COLOR);
      drawn.point.pixelSize = drawn.basePixelSize + SELECTED_POINT_BONUS_PX;
    }
    // Paint the complete card FIRST, then let the hydrograph arrive into it.
    // The other order would show an empty card for up to a second on a service
    // that has no availability guarantee.
    publishSelected();
    void loadHistory(drawn.record);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && _selectedId) {
      clearSelection();
      governorRequestRender('hubeau-deselect');
    }
  }

  /**
   * Install the click-to-select handler.
   *
   * `drillPick`, not `pick`: these dots draw at `disableDepthTestDistance:
   * 2500` while several sibling French layers use `Number.POSITIVE_INFINITY`,
   * so on a river running past a charging point or a production group a plain
   * pick would return the neighbour and this layer would look dead — the same
   * contention measured on the EDF discs.
   *
   * The default handler factory touches the DOM in its constructor, so it is
   * injectable; the Escape listener below is skipped when there is no
   * `document` rather than skipping the whole install.
   */
  function installClickHandler(viewer) {
    if (_clickHandler || !viewer?.scene?.canvas) return;
    _clickHandler = screenSpaceEventHandlerFactory(viewer);
    _clickHandler.setInputAction((click) => {
      if (!_enabled) return;
      const drilled = viewer.scene.drillPick(click.position, DRILL_PICK_LIMIT) || [];
      for (const hit of drilled) {
        const id = typeof hit?.primitive?.id === 'string' ? hit.primitive.id : null;
        if (id && _drawn.has(id)) {
          selectObject(id);
          return;
        }
      }
      // The label plane the depth buffer knows nothing about, resolved after
      // the drill pick so a name drawn across a neighbouring gauge cannot
      // steal that gauge's click. The label id IS the dot's render id.
      const labelled = pickOverlayLabelId(click.position, {
        sourceId: HUBEAU_OVERLAY_SOURCE_ID,
        has: (renderId) => _drawn.has(renderId),
        hitTest: overlayHost.hitTest,
      });
      if (labelled) {
        selectObject(labelled);
        return;
      }
      clearSelection();
      governorRequestRender('hubeau-deselect');
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);
  }

  function removeClickHandler() {
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
  }

  function repaint() {
    if (!_pointCollection) return;
    _pointCollection.removeAll();
    const entries = [];
    for (const record of _records) {
      const position = Cesium.Cartesian3.fromDegrees(record.lon, record.lat);
      const pickId = `hubeau:${record.code}`;
      const basePixelSize = hubeauPixelSize(record.reading);
      const point = _pointCollection.add({
        position,
        pixelSize: basePixelSize,
        color: hubeauPointColor(record.reading),
        outlineColor: COLOR_OUTLINE,
        outlineWidth: 1,
        scaleByDistance: new Cesium.NearFarScalar(2000, 1.3, 900000, 0.45),
        translucencyByDistance: new Cesium.NearFarScalar(2000, 1, 1400000, 0.25),
        disableDepthTestDistance: 2500,
        id: pickId,
      });
      _drawn.set(pickId, { record, position, point, basePixelSize });
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
    _drawn.clear();
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
    id: HUBEAU_LAYER_ID,
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
      _selectedId = null;
      _history = null;
      setStatus('idle', null);
      overlayHost.setVisible(HUBEAU_OVERLAY_SOURCE_ID, false);
      overlayHost.setVisible(HUBEAU_SELECTED_OVERLAY_SOURCE_ID, false);
      // Registered for as long as the collection exists, so the shared pick
      // registry knows these ids belong to this layer even while it is off.
      registerPickOwner(HUBEAU_LAYER_ID, (id) => _drawn.has(id));
      console.log('[Data:Hubeau] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (viewer) _viewer = viewer;
      if (_pointCollection) _pointCollection.show = true;
      overlayHost.setVisible(HUBEAU_OVERLAY_SOURCE_ID, true);
      overlayHost.setVisible(HUBEAU_SELECTED_OVERLAY_SOURCE_ID, true);
      if (!_moveEndRemove && viewer?.camera?.moveEnd?.addEventListener) {
        _moveEndRemove = viewer.camera.moveEnd.addEventListener(scheduleLoad);
      }
      installClickHandler(_viewer);
      load();
    },

    disable() {
      _enabled = false;
      clearSelection();
      removeClickHandler();
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
      _abort?.abort();
      _abort = null;
      _moveEndRemove?.();
      _moveEndRemove = null;
      if (_pointCollection) _pointCollection.show = false;
      overlayHost.clearSource(HUBEAU_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(HUBEAU_OVERLAY_SOURCE_ID, false);
      overlayHost.setVisible(HUBEAU_SELECTED_OVERLAY_SOURCE_ID, false);
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
      clearSelection();
      removeClickHandler();
      unregisterPickOwner(HUBEAU_LAYER_ID);
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
      _abort?.abort();
      _abort = null;
      _moveEndRemove?.();
      _moveEndRemove = null;
      overlayHost.clearSource(HUBEAU_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(HUBEAU_OVERLAY_SOURCE_ID, false);
      overlayHost.setVisible(HUBEAU_SELECTED_OVERLAY_SOURCE_ID, false);
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
