import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';

/**
 * Vigicrues — France's official river-flood vigilance map.
 *
 * The SCHAPI (Service central d'hydrométéorologie et d'appui à la prévision
 * des inondations) publishes one keyless GeoJSON holding every monitored
 * river reach ("tronçon de vigilance crues") with its current 4-level
 * vigilance colour. This is the state's own reading of French flood risk —
 * Hub'Eau (see `hubeauHydrometry.js`) carries the raw gauge measurements
 * underneath it.
 *
 * MEASURED against the live feed on 2026-08-26:
 *   - `GET /services/InfoVigiCru.geojson` → 200, 2,245,691 bytes, NO gzip
 *     (the origin ignores `Accept-Encoding`), and NO ETag or Last-Modified,
 *     so a conditional GET is impossible
 *   - 337 reaches, all `MultiLineString`, 537 line parts, 56,110 vertices
 *   - every reach carried `NivInfViCr: 1` (green) — late August, no episode
 *   - the map is republished twice a day, at 10:00 and 16:00 Paris (the file
 *     lands ~5 min early), and "at any moment" during an episode
 *
 * WHY THIS GOES THROUGH A PROXY even though the origin sends CORS headers and
 * a direct browser fetch works: 2.2 MB uncompressed with no conditional GET,
 * against a map that changes twice a day, means any useful poll cadence costs
 * hundreds of megabytes a day for two meaningful changes. The `/api/vigicrues`
 * proxy splits the feed along its real seam — a ~1.1 MB geometry document
 * fetched ONCE per session, and a ~3 KB level document that is polled — joined
 * by `geometryVersion`. Measured end to end: 2,245,691 → 3,116 bytes per poll.
 *
 * The honest headline for this layer: **outside a flood episode every reach is
 * green.** It is therefore drawn as "the monitored river network of France,
 * dim" in calm weather, and only lights up — wider strokes, labels, non-zero
 * alert counts — when a reach is raised to yellow/orange/red. Labels are
 * published ONLY for raised reaches, so a calm France costs zero label work.
 *
 * The reaches are clamped ground polylines, so they follow the same
 * surface-classification rule the submarine-cable layer established: classify
 * against ONLY the active surface (Google 3D tiles under the photoreal stack,
 * terrain under the globe stacks), and fall back to BOTH for an unknown
 * stack rather than risk drawing nothing.
 */

const LEVELS_URL = '/api/vigicrues';
const GEOMETRY_URL = '/api/vigicrues/geometry';

/** Shared world-overlay source id (matches the layer id). */
export const VIGICRUES_OVERLAY_SOURCE_ID = 'vigicrues';
/** Bounded label cohort offered to the shared overlay host. */
export const VIGICRUES_OVERLAY_COHORT_LIMIT = 64;
/** Shared ambient-label paint budget, matching the sibling alert sources. */
export const VIGICRUES_OVERLAY_COLLISION_CAPACITY = 48;

/**
 * A poll is ~3 KB through the proxy, and the proxy holds its own 10-minute
 * cache in front of the origin, so this cadence is about how fast a raised
 * reach should reach the screen during an episode — not about bandwidth.
 */
const UPDATE_INTERVAL_MS = 300000;

/**
 * The four vigilance levels, in the state's own vocabulary and colours.
 * `NivInfViCr` carries the level as a small integer; anything outside 1..4
 * (including the `null` the feed has been observed to emit for a reach with
 * no current assessment) is UNKNOWN and is not drawn as green — inventing a
 * reassuring colour for missing data is the one failure mode a vigilance map
 * must not have.
 */
export const VIGICRUES_LEVELS = Object.freeze({
  1: Object.freeze({
    level: 1,
    key: 'green',
    label: 'VERT',
    meaning: 'Pas de vigilance particulière requise',
    color: '#009245',
    alpha: 0.5,
    width: 1.6,
  }),
  2: Object.freeze({
    level: 2,
    key: 'yellow',
    label: 'JAUNE',
    meaning: 'Risque de crue ou de montée rapide et dangereuse des eaux',
    color: '#fcff19',
    alpha: 0.95,
    width: 3,
  }),
  3: Object.freeze({
    level: 3,
    key: 'orange',
    label: 'ORANGE',
    meaning: 'Risque de crue génératrice de débordements importants',
    color: '#ee5e2e',
    alpha: 0.97,
    width: 4.5,
  }),
  4: Object.freeze({
    level: 4,
    key: 'red',
    label: 'ROUGE',
    meaning: 'Risque de crue majeure — menace directe et généralisée',
    color: '#ff0000',
    alpha: 1,
    width: 6,
  }),
});

/** Presentation for a reach whose level the feed did not supply. */
export const VIGICRUES_UNKNOWN_LEVEL = Object.freeze({
  level: null,
  key: 'unknown',
  label: 'INCONNU',
  meaning: 'Niveau non publié',
  color: '#8a93a6',
  alpha: 0.45,
  width: 1.4,
});

/** A reach at or above this level is an ALERT: wider stroke, label, counted. */
export const VIGICRUES_ALERT_LEVEL = 2;

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/**
 * `MAP_STACKS` ids that render imagery on the SHOWN Cesium globe. Kept as an
 * explicit allowlist for the same reason the cable layer keeps one: a stack
 * id this module has never heard of must reach the safe BOTH fallback rather
 * than be asserted onto a surface that is not there.
 */
const VIGICRUES_GLOBE_STACK_IDS = Object.freeze(new Set(['bing-aerial', 'bing-labels', 'osm', 'ign-ortho', 'ign-plan']));

/**
 * Ground-line classification for one map stack.
 * @param {string|null|undefined} activeId MapStackController stack id.
 * @returns {Cesium.ClassificationType}
 */
export function vigicruesClassificationTypeForStack(activeId) {
  if (activeId === 'photoreal') return Cesium.ClassificationType.CESIUM_3D_TILE;
  if (VIGICRUES_GLOBE_STACK_IDS.has(activeId)) return Cesium.ClassificationType.TERRAIN;
  return Cesium.ClassificationType.BOTH;
}

/**
 * Derive the active surface from live scene state. Boot calls
 * `setStack(..., { silent: true })` and fire no 'gev:map-stack-changed', so
 * the initial classification reads the scene directly: the photoreal regime
 * is exactly "globe hidden".
 * @param {Cesium.Scene|null|undefined} scene
 * @returns {Cesium.ClassificationType}
 */
export function vigicruesClassificationTypeForScene(scene) {
  if (!scene?.globe) return Cesium.ClassificationType.BOTH;
  return scene.globe.show === false
    ? Cesium.ClassificationType.CESIUM_3D_TILE
    : Cesium.ClassificationType.TERRAIN;
}

/**
 * Resolve `NivInfViCr` to its presentation. Accepts the numeric-string form
 * the feed has also been seen to use; rejects everything else to UNKNOWN
 * rather than rounding it into a level.
 * @param {unknown} raw
 * @returns {typeof VIGICRUES_UNKNOWN_LEVEL}
 */
export function vigicruesLevel(raw) {
  if (typeof raw === 'number' || typeof raw === 'string') {
    const value = Number(raw);
    if (Number.isInteger(value) && VIGICRUES_LEVELS[value]) return VIGICRUES_LEVELS[value];
  }
  return VIGICRUES_UNKNOWN_LEVEL;
}

/**
 * Parse the feed's `dhmentcru` / `dhcentcru` stamps ("2020/09/15 09:00:00.000",
 * Paris local time, no zone marker) into epoch ms. Returns null rather than an
 * `Invalid Date` so a malformed stamp can never reach the HUD as NaN.
 * @param {unknown} raw
 * @returns {number|null}
 */
export function vigicruesTimestampMs(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const match = /^(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Read the publication stamp from a `/api/vigicrues` payload.
 *
 * This is not decoration: Licence Ouverte 2.0's single obligation has TWO
 * limbs — name the concédant AND state «la date de la dernière mise à jour de
 * l'Information réutilisée». `updateTime` carries the upstream's
 * `DtHrInfoVigiCru`, and `reference` its `RefInfoVigiCru` ("26082026_10"),
 * which names the map edition.
 * @param {object|null|undefined} payload
 * @returns {{publishedAtMs:number|null, reference:string|null}}
 */
export function parseVigicruesPublication(payload) {
  const raw = String(payload?.updateTime ?? '').trim();
  const parsed = raw ? Date.parse(raw) : NaN;
  return {
    publishedAtMs: Number.isFinite(parsed) ? parsed : null,
    reference: String(payload?.reference ?? '').trim() || null,
  };
}

/**
 * Join the cached geometry document to a freshly polled level document.
 *
 * A reach present in the geometry but absent from `levels` resolves to
 * UNKNOWN, never to green — the same rule the projection follows upstream.
 * Alert reaches are ordered LAST so their brighter, wider strokes win the
 * depth tie against the green network they cross.
 *
 * @param {Array<object>|null|undefined} reaches Geometry document reaches.
 * @param {Record<string, number|null>|null|undefined} levels Level document.
 * @returns {object[]}
 */
export function buildVigicruesRecords(reaches, levels) {
  const records = [];
  for (const reach of Array.isArray(reaches) ? reaches : []) {
    const id = String(reach?.id ?? '').trim();
    if (!id || !Array.isArray(reach?.parts) || reach.parts.length === 0) continue;
    records.push({
      id,
      name: String(reach.name ?? '').trim() || id,
      level: vigicruesLevel(levels ? levels[id] : undefined),
      updatedAtMs: vigicruesTimestampMs(reach.updatedAt),
      parts: reach.parts,
    });
  }
  return records.sort((a, b) => (a.level.level ?? 0) - (b.level.level ?? 0)
    || a.id.localeCompare(b.id));
}

/**
 * Count reaches per level key, plus the alert total. Drives the toggle-row
 * readout and keeps "how many rivers are actually raised" a single number.
 * @param {object[]} records
 * @returns {{total:number, alerts:number, byKey:Record<string, number>}}
 */
export function summarizeVigicruesRecords(records) {
  const byKey = { green: 0, yellow: 0, orange: 0, red: 0, unknown: 0 };
  let alerts = 0;
  for (const record of Array.isArray(records) ? records : []) {
    const key = record?.level?.key;
    if (key in byKey) byKey[key] += 1;
    if (Number.isInteger(record?.level?.level) && record.level.level >= VIGICRUES_ALERT_LEVEL) {
      alerts += 1;
    }
  }
  return { total: Array.isArray(records) ? records.length : 0, alerts, byKey };
}

/**
 * A stable fingerprint of the drawn state. The feed body is 2.2 MB and the
 * geometry is effectively static, so a poll that changes no colour must not
 * rebuild 537 clamped ground primitives.
 * @param {object[]} records
 * @returns {string}
 */
export function vigicruesStateSignature(records) {
  if (!Array.isArray(records) || records.length === 0) return '0';
  const parts = new Array(records.length);
  for (let i = 0; i < records.length; i++) {
    parts[i] = `${records[i].id}:${records[i].level.level ?? 'x'}`;
  }
  return `${records.length}|${parts.join(',')}`;
}

/**
 * Build the toggle-row colour legend from a level tally.
 *
 * Follows the satellite-class legend convention: severity order, zero-count
 * levels omitted, official swatch colours, and the level's official meaning as
 * the tooltip. On a calm day this reads "VERT 337", which is the honest
 * summary — the network is monitored and nothing is raised.
 * @param {Record<string, number>} byKey Tally from `summarizeVigicruesRecords`.
 * @returns {Array<{label:string,color:string,blurb:string,count:number}>}
 */
export function vigicruesLevelLegend(byKey) {
  const legend = [];
  for (const level of [4, 3, 2, 1]) {
    const spec = VIGICRUES_LEVELS[level];
    const count = byKey?.[spec.key];
    if (!(count > 0)) continue;
    legend.push({ label: spec.label, color: spec.color, blurb: spec.meaning, count });
  }
  const unknown = byKey?.unknown;
  if (unknown > 0) {
    legend.push({
      label: VIGICRUES_UNKNOWN_LEVEL.label,
      color: VIGICRUES_UNKNOWN_LEVEL.color,
      blurb: VIGICRUES_UNKNOWN_LEVEL.meaning,
      count: unknown,
    });
  }
  return legend;
}

/**
 * Anchor a reach's label at the midpoint VERTEX of its longest part. A true
 * midpoint would need cumulative arc length over up to 56k vertices per poll;
 * the vertex midpoint is within a pixel of it at any altitude where the label
 * is legible, and costs one index.
 * @param {Array<Array<number[]>>} parts
 * @returns {number[]|null} [lon, lat] or null.
 */
export function vigicruesLabelAnchor(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  let longest = null;
  for (const part of parts) {
    if (!Array.isArray(part) || part.length === 0) continue;
    if (!longest || part.length > longest.length) longest = part;
  }
  if (!longest) return null;
  const point = longest[Math.floor(longest.length / 2)];
  const lon = Number(point?.[0]);
  const lat = Number(point?.[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

/**
 * Build the source-owned presentation for one raised-reach label.
 * @param {object} input
 * @param {string} input.id Stable reach id.
 * @param {Cesium.Cartesian3} input.position Ground anchor.
 * @param {string} input.title Reach name.
 * @param {object} input.level Resolved VIGICRUES_LEVELS entry.
 * @returns {object}
 */
export function createVigicruesOverlayEntry({ id, position, title, level }) {
  return {
    id: String(id),
    position,
    variant: 'label',
    title,
    accent: level.color,
    // Red outranks orange outranks yellow; ties break on id in the selector.
    priority: (level.level ?? 0) * 1000,
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

/** Keep the most severe raised reaches, with stable identity as the tie-break. */
export function selectVigicruesOverlayCohort(entries, limit = VIGICRUES_OVERLAY_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(
    VIGICRUES_OVERLAY_COHORT_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/**
 * Map one reach to a JSON-safe analyst record (analyst query engine seam).
 * Pure — no Cesium types. Missing fields are null, never NaN/undefined.
 * @param {object|null|undefined} record
 * @param {number} [index=0]
 * @returns {object}
 */
export function mapAnalystRecord(record, index = 0) {
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  const anchor = vigicruesLabelAnchor(record?.parts);
  return {
    id: text(record?.id) || `TRONCON-${String(index).padStart(4, '0')}`,
    name: text(record?.name),
    level: Number.isInteger(record?.level?.level) ? record.level.level : null,
    levelLabel: text(record?.level?.label),
    lat: anchor ? anchor[1] : null,
    lon: anchor ? anchor[0] : null,
    updatedAtMs: Number.isFinite(record?.updatedAtMs) ? record.updatedAtMs : null,
  };
}

export function createVigicruesLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  levelsUrl = LEVELS_URL,
  geometryUrl = GEOMETRY_URL,
  mapStackEventTarget = typeof window === 'undefined' ? null : window,
} = {}) {
  let _viewer = null;
  let _dataSource = null;
  // The geometry document is ~1.1 MB and effectively static — the SCHAPI
  // redraws reaches rarely — so it is fetched once and held against the
  // proxy's `geometryVersion`, which moves only when a reach is added,
  // removed or redrawn.
  let _geometryVersion = null;
  let _reaches = [];
  let _records = [];
  let _summary = summarizeVigicruesRecords([]);
  let _publication = { publishedAtMs: null, reference: null };
  let _signature = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;
  let _classificationType = Cesium.ClassificationType.BOTH;
  let _mapStackListener = null;

  /**
   * Re-classify every reach for the active surface. One batched ground-
   * primitive rebuild per stack switch — never per frame.
   * @param {Cesium.ClassificationType} next
   */
  function applyClassification(next) {
    if (next === undefined || next === _classificationType) return;
    _classificationType = next;
    if (!_dataSource) return;
    const entities = _dataSource.entities.values;
    for (let i = 0; i < entities.length; i++) {
      const polyline = entities[i].polyline;
      if (polyline) polyline.classificationType = next;
    }
    _viewer?.scene?.requestRender?.();
  }

  /** Rebuild every reach entity from `_records`. */
  function rebuildEntities() {
    if (!_dataSource) return;
    _dataSource.entities.removeAll();
    for (const record of _records) {
      const { level } = record;
      const material = Cesium.Color
        .fromCssColorString(level.color)
        .withAlpha(level.alpha);
      for (let part = 0; part < record.parts.length; part++) {
        const coordinates = record.parts[part];
        if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
        const positions = Cesium.Cartesian3.fromDegreesArray(
          coordinates.flatMap(([lon, lat]) => [Number(lon), Number(lat)]),
        );
        _dataSource.entities.add({
          id: `vigicrues:${record.id}:${part}`,
          polyline: {
            positions,
            // Static positions and a static material — a CallbackProperty on
            // clamped ground geometry re-tessellates it every frame, the
            // lesson the earthquake layer paid for in measured milliseconds.
            width: level.width,
            material: new Cesium.ColorMaterialProperty(material),
            clampToGround: true,
            classificationType: _classificationType,
          },
          properties: {
            vigicruesId: record.id,
            reachCode: record.reachCode,
            name: record.name,
            level: level.level,
            levelLabel: level.label,
            levelMeaning: level.meaning,
            updatedAtMs: record.updatedAtMs,
          },
        });
      }
    }
  }

  /** Publish labels for raised reaches only; a calm France publishes none. */
  function publishOverlay() {
    if (!_enabled) return;
    const entries = [];
    for (const record of _records) {
      const level = record.level.level;
      if (!Number.isInteger(level) || level < VIGICRUES_ALERT_LEVEL) continue;
      const anchor = vigicruesLabelAnchor(record.parts);
      if (!anchor) continue;
      entries.push(createVigicruesOverlayEntry({
        id: record.id,
        position: Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1]),
        title: `${record.name} · ${record.level.label}`,
        level: record.level,
      }));
    }
    overlayHost.setEntries(
      VIGICRUES_OVERLAY_SOURCE_ID,
      selectVigicruesOverlayCohort(entries),
      {
        cohortLimit: VIGICRUES_OVERLAY_COHORT_LIMIT,
        collisionCapacity: VIGICRUES_OVERLAY_COLLISION_CAPACITY,
        moving: false,
      },
    );
  }

  const layer = {
    id: 'vigicrues',
    name: 'Vigicrues (FR)',
    icon: '≋',
    source: 'SCHAPI / Vigicrues',
    updateInterval: UPDATE_INTERVAL_MS,

    init(viewer) {
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('vigicrues');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _records = [];
      _summary = summarizeVigicruesRecords([]);
      _publication = { publishedAtMs: null, reference: null };
      _signature = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      _classificationType = vigicruesClassificationTypeForScene(viewer?.scene);
      if (mapStackEventTarget && !_mapStackListener) {
        _mapStackListener = (event) => {
          applyClassification(event?.detail?.activeId
            ? vigicruesClassificationTypeForStack(event.detail.activeId)
            : vigicruesClassificationTypeForScene(_viewer?.scene));
        };
        mapStackEventTarget.addEventListener('gev:map-stack-changed', _mapStackListener);
      }
      overlayHost.setVisible(VIGICRUES_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Vigicrues] Initialized');
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(VIGICRUES_OVERLAY_SOURCE_ID, true);
      publishOverlay();
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(VIGICRUES_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(VIGICRUES_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      try {
        const levelsResponse = await fetch(levelsUrl);
        if (!levelsResponse.ok) {
          _lastError = `Vigicrues HTTP ${levelsResponse.status}`;
          console.warn(`[Data:Vigicrues] Level feed returned ${levelsResponse.status}`);
          return false;
        }
        const payload = await levelsResponse.json();
        const geometryVersion = String(payload?.geometryVersion ?? '').trim();
        if (!geometryVersion || !payload?.levels || typeof payload.levels !== 'object') {
          _lastError = 'Malformed Vigicrues response';
          return false;
        }

        // Only the first poll of a session — and a genuine redraw of the reach
        // network — pays for the geometry document.
        if (geometryVersion !== _geometryVersion) {
          const geometryResponse = await fetch(geometryUrl);
          if (!geometryResponse.ok) {
            _lastError = `Vigicrues geometry HTTP ${geometryResponse.status}`;
            console.warn(`[Data:Vigicrues] Geometry returned ${geometryResponse.status}`);
            return false;
          }
          const geometry = await geometryResponse.json();
          if (!Array.isArray(geometry?.reaches)) {
            _lastError = 'Malformed Vigicrues geometry';
            return false;
          }
          // A level document that raced ahead of the geometry it names would
          // colour the wrong rivers. Trust the geometry document's own stamp.
          _geometryVersion = String(geometry.geometryVersion ?? '').trim() || geometryVersion;
          _reaches = geometry.reaches;
        }

        const records = buildVigicruesRecords(_reaches, payload.levels);
        const signature = vigicruesStateSignature(records);
        _publication = parseVigicruesPublication(payload);
        _records = records;
        _summary = summarizeVigicruesRecords(records);
        _lastUpdate = Date.now();
        _lastError = null;
        _stale = payload.stale === true;

        // Colours rarely move. Skipping the rebuild on an unchanged poll is
        // what keeps 537 clamped ground primitives off the critical path.
        if (signature !== _signature) {
          _signature = signature;
          rebuildEntities();
          publishOverlay();
          _viewer?.scene?.requestRender?.();
        }

        console.log(
          `[Data:Vigicrues] Updated: ${_summary.total} tronçons, ${_summary.alerts} en vigilance`,
        );
        return true;
      } catch (e) {
        console.warn('[Data:Vigicrues] Fetch error:', e);
        _lastError = 'Vigicrues network error';
        return false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      overlayHost.clearSource(VIGICRUES_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(VIGICRUES_OVERLAY_SOURCE_ID, false);
      if (mapStackEventTarget && _mapStackListener) {
        mapStackEventTarget.removeEventListener('gev:map-stack-changed', _mapStackListener);
        _mapStackListener = null;
      }
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      _geometryVersion = null;
      _reaches = [];
      _records = [];
      _summary = summarizeVigicruesRecords([]);
      _publication = { publishedAtMs: null, reference: null };
      _signature = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
    },

    /**
     * Snapshot the reaches as plain JSON-safe objects for the analyst query
     * engine. On-demand only — zero per-frame cost. Returns [] while disabled.
     * @param {number} [maxCount=2000]
     * @returns {Array<Object>}
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_dataSource || !_dataSource.show) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 2000;
      const result = [];
      for (const record of _records) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(record, result.length));
      }
      return result;
    },

    /**
     * Colour legend for the toggle row. No chips: the layer has no options.
     * @returns {{chips: Array<object>, legend: Array<object>}}
     */
    getRowControls() {
      return { chips: [], legend: vigicruesLevelLegend(_summary.byKey) };
    },

    getStats() {
      return {
        count: _summary.total,
        lastUpdate: _lastUpdate,
        error: _lastError,
        // A calm France is NOMINAL with zero alerts, not "empty" — the reach
        // network is drawn and the reading is real.
        alerts: _summary.alerts,
        levels: _summary.byKey,
        // The proxy says so when it is serving its cache past TTL because the
        // origin is down; the map is still real, just not freshly confirmed.
        stale: _stale,
        // Surfaced because Licence Ouverte 2.0 requires the reused
        // information's last-update date to be stated, not just the producer.
        publishedAt: _publication.publishedAtMs,
        reference: _publication.reference,
      };
    },
  };

  return layer;
}

const vigicruesLayer = createVigicruesLayer();

export default vigicruesLayer;
