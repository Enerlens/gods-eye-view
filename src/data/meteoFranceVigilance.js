import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { VIGILANCE_PHENOMENA } from './meteoFranceVigilanceFeed.js';

/**
 * Météo-France Vigilance — the 4-colour départemental weather-warning map.
 *
 * Nine phenomena (vent violent, pluie-inondation, orages, crues, neige-verglas,
 * canicule, grand froid, avalanches, vagues-submersion) are assessed twice a
 * day for every French département and published as a colour. This is the
 * signal the whole country reads before a storm, and it pairs with Vigicrues:
 * vigilance phenomenon 4 IS the Vigicrues flood reading, rolled up to the
 * département.
 *
 * ── Where the data comes from ───────────────────────────────────────────────
 * Through the `/api/vigilance` proxy, which prefers Météo-France's own
 * real-time mirror on data.gouv.fr — byte-identical product, Licence Ouverte
 * 2.0, NO credential — and uses the authenticated API only when
 * `METEOFRANCE_API_KEY` is configured. Measured 2026-08-26: the mirror
 * published a 04:00:28Z run with `Last-Modified: 04:00:48 GMT`, a 20-second
 * lag. The proxy exists because that mirror sends no CORS header, and because
 * the 219 KB ungzipped product projects down to ~6 KB of colours.
 *
 * ── Where the shapes come from ──────────────────────────────────────────────
 * The vigilance product carries NO geometry, only `domain_id` → colour. The 96
 * metropolitan département polygons are bundled in
 * `local_data/france_departements/` (IGN ADMIN EXPRESS via france-geojson,
 * Licence Ouverte — see that folder's SOURCE.md). Their 96 `code` values are
 * an exact set-equality match with the 96 département `domain_id` values in
 * the live product, so the join needs no normalisation, and the code set
 * doubles as the WHITELIST that discards everything else the product carries:
 * the national `FRA` roll-up, the seven `ZDF_*` defence zones, the 25 `dd10`
 * coastal strips, and Andorra's `99` — a bare two-digit code that appears
 * seasonally with avalanche bulletins and sails straight through any
 * `/^\d{2}$/` filter.
 *
 * ── Why green is drawn as nothing ───────────────────────────────────────────
 * On the 2026-08-26 bulletin, J was {vert 57, jaune 27, orange 12}. Painting
 * 57 saturated green polygons is not just ugly, it actively misinforms: green
 * means "nothing to report", and a coloured shape reads as "something is
 * happening here". So level 1 is drawn as ABSENCE — the entity is hidden — and
 * only raised départements are filled, with alpha ramping by severity so a
 * single red département dominates the frame the way it should. On the
 * 2026-01-08 bulletin there was exactly 1 rouge against 35 orange and 54
 * jaune; at flat alpha that red is lost.
 *
 * The palette is Météo-France's own (spec: "code informatique RVB de couleur"),
 * not a designer's: recolouring a public-safety signal would misrepresent it.
 * Hue alone is not enough — #f9ff00 is nearly invisible on a bright globe and
 * the orange/red pair is a deuteranopia collision — so the level WORD and the
 * phenomenon name travel in the label, never the colour alone.
 *
 * Only the J (today) échéance is drawn. J1 arrives in the same fetch at no
 * extra cost and is reported in `getStats()`; surfacing it as a toggle would
 * need a layer-option owner, which is a separate change.
 */

const API_URL = '/api/vigilance';
const DEPARTEMENTS_URL = new URL(
  './local_data/france_departements/departements.geojson',
  import.meta.url,
).href;

/** Shared world-overlay source id (matches the layer id). */
export const VIGILANCE_OVERLAY_SOURCE_ID = 'meteofrance-vigilance';
/** Bounded label cohort offered to the shared overlay host. */
export const VIGILANCE_OVERLAY_COHORT_LIMIT = 48;
/** Shared ambient-label paint budget, matching the sibling alert sources. */
export const VIGILANCE_OVERLAY_COLLISION_CAPACITY = 40;

/**
 * Idle refresh cadence. The proxy holds a 5-minute cache in front of both
 * upstreams, so this is about how fast an escalation reaches the screen.
 * Bulletins land at 06:00 and 16:00 Paris in the normal case, but 2026-08-24
 * saw 22 runs and 2026-01-08 saw 38 — a twice-a-day schedule would have missed
 * the twenty that mattered.
 */
const UPDATE_INTERVAL_MS = 300000;

/** The échéance this layer draws. `J1` is fetched and reported, not drawn. */
export const VIGILANCE_DRAWN_ECHEANCE = 'J';

/**
 * The four vigilance levels, in Météo-France's own vocabulary and colours.
 *
 * The hex values are quoted from the official technical spec's "Valeurs du
 * champ risk_color" table. Third-party clients commonly substitute prettier
 * values; those are that project's invention, not the state's signal.
 *
 * `fillAlpha` is the severity ramp — see the module header on why flat alpha
 * loses a lone red département in a field of orange.
 */
export const VIGILANCE_LEVELS = Object.freeze({
  1: Object.freeze({
    level: 1, key: 'green', label: 'VERT', color: '#15ed13', fillAlpha: 0,
    meaning: 'Pas de vigilance particulière',
  }),
  2: Object.freeze({
    level: 2, key: 'yellow', label: 'JAUNE', color: '#f9ff00', fillAlpha: 0.45,
    meaning: 'Soyez attentif',
  }),
  3: Object.freeze({
    level: 3, key: 'orange', label: 'ORANGE', color: '#f7a401', fillAlpha: 0.65,
    meaning: 'Soyez très vigilant',
  }),
  4: Object.freeze({
    level: 4, key: 'red', label: 'ROUGE', color: '#e71919', fillAlpha: 0.85,
    meaning: 'Une vigilance absolue s\'impose',
  }),
});

/** Presentation for a département the bulletin did not assess. */
export const VIGILANCE_UNKNOWN_LEVEL = Object.freeze({
  level: null, key: 'unknown', label: 'INCONNU', color: '#8a93a6', fillAlpha: 0,
  meaning: 'Niveau non publié',
});

/** A département at or above this level is drawn and labelled. */
export const VIGILANCE_ALERT_LEVEL = 2;

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/**
 * `MAP_STACKS` ids that render imagery on the SHOWN Cesium globe. An explicit
 * allowlist, for the same reason the cable and Vigicrues layers keep one: an
 * unknown stack id must reach the safe BOTH fallback rather than be asserted
 * onto a surface that is not there.
 */
const VIGILANCE_GLOBE_STACK_IDS = Object.freeze(new Set(['bing-aerial', 'bing-labels', 'osm', 'ign-ortho', 'ign-plan']));

/**
 * Ground-fill classification for one map stack.
 * @param {string|null|undefined} activeId MapStackController stack id.
 * @returns {Cesium.ClassificationType}
 */
export function vigilanceClassificationTypeForStack(activeId) {
  if (activeId === 'photoreal') return Cesium.ClassificationType.CESIUM_3D_TILE;
  if (VIGILANCE_GLOBE_STACK_IDS.has(activeId)) return Cesium.ClassificationType.TERRAIN;
  return Cesium.ClassificationType.BOTH;
}

/**
 * Derive the active surface from live scene state. Boot calls
 * `setStack(..., { silent: true })` and fire no 'gev:map-stack-changed'.
 * @param {Cesium.Scene|null|undefined} scene
 * @returns {Cesium.ClassificationType}
 */
export function vigilanceClassificationTypeForScene(scene) {
  if (!scene?.globe) return Cesium.ClassificationType.BOTH;
  return scene.globe.show === false
    ? Cesium.ClassificationType.CESIUM_3D_TILE
    : Cesium.ClassificationType.TERRAIN;
}

/**
 * Resolve a colour id to its presentation. Anything outside 1..4 is UNKNOWN
 * and is NOT drawn as green — a warning map must never invent reassurance.
 * @param {unknown} raw
 * @returns {typeof VIGILANCE_UNKNOWN_LEVEL}
 */
export function vigilanceLevel(raw) {
  const value = Number(raw);
  return Number.isInteger(value) && VIGILANCE_LEVELS[value]
    ? VIGILANCE_LEVELS[value]
    : VIGILANCE_UNKNOWN_LEVEL;
}

/**
 * Signed area of a closed ring, by the shoelace formula. Only its magnitude
 * and sign relative to other rings matter here.
 * @param {Array<number[]>} ring
 * @returns {number}
 */
function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    sum += (xj * yi) - (xi * yj);
  }
  return sum / 2;
}

/**
 * Area centroid of a département, used to anchor its label.
 *
 * A vertex average would be dragged toward whichever coast is most finely
 * mapped; the shoelace centroid of the LARGEST ring puts the label where the
 * département actually is. Degenerate rings (zero area) fall back to the
 * vertex average rather than dividing by zero.
 * @param {object|null|undefined} geometry GeoJSON Polygon or MultiPolygon.
 * @returns {number[]|null} [lon, lat], or null when unusable.
 */
export function departementAnchor(geometry) {
  const polygons = geometry?.type === 'Polygon'
    ? [geometry.coordinates]
    : (geometry?.type === 'MultiPolygon' ? geometry.coordinates : null);
  if (!Array.isArray(polygons) || polygons.length === 0) return null;

  let best = null;
  let bestArea = -Infinity;
  for (const polygon of polygons) {
    const ring = Array.isArray(polygon) ? polygon[0] : null;
    if (!Array.isArray(ring) || ring.length < 3) continue;
    const area = Math.abs(ringArea(ring));
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  if (!best) return null;

  const area = ringArea(best);
  if (area === 0) {
    let lon = 0;
    let lat = 0;
    for (const [x, y] of best) { lon += x; lat += y; }
    const centre = [lon / best.length, lat / best.length];
    return Number.isFinite(centre[0]) && Number.isFinite(centre[1]) ? centre : null;
  }

  let cx = 0;
  let cy = 0;
  for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
    const [xi, yi] = best[i];
    const [xj, yj] = best[j];
    const cross = (xj * yi) - (xi * yj);
    cx += (xi + xj) * cross;
    cy += (yi + yj) * cross;
  }
  const lon = cx / (6 * area);
  const lat = cy / (6 * area);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

/**
 * Index the bundled département polygons by their INSEE code.
 * @param {object|null|undefined} geojson
 * @returns {Map<string, {code:string, name:string, anchor:number[]|null}>}
 */
export function parseDepartements(geojson) {
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  const byCode = new Map();
  for (const feature of features) {
    const code = String(feature?.properties?.code ?? '').trim();
    if (!code) continue;
    byCode.set(code, {
      code,
      name: String(feature?.properties?.nom ?? '').trim() || code,
      anchor: departementAnchor(feature?.geometry),
    });
  }
  return byCode;
}

/**
 * Join one échéance of a `/api/vigilance` payload to the known départements.
 *
 * The département code set is the whitelist: a domain the bundled polygons do
 * not know is not a département, whatever its shape. That discards `FRA`, the
 * `ZDF_*` zones, the `dd10` coastal strips and Andorra's `99` in one step, and
 * cannot be fooled by a new domain kind appearing upstream.
 *
 * @param {object|null|undefined} payload `/api/vigilance` body.
 * @param {Map<string, object>} departements From `parseDepartements`.
 * @param {string} [echeance]
 * @returns {Array<object>} One record per KNOWN département present in the bulletin.
 */
export function buildVigilanceRecords(payload, departements, echeance = VIGILANCE_DRAWN_ECHEANCE) {
  const domains = payload?.periods?.[echeance]?.domains;
  if (!domains || typeof domains !== 'object' || !departements) return [];
  const records = [];
  for (const [code, entry] of Object.entries(domains)) {
    const departement = departements.get(code);
    if (!departement) continue;
    const level = vigilanceLevel(entry?.c);
    const phenomena = [];
    for (const item of Array.isArray(entry?.p) ? entry.p : []) {
      const id = String(item?.[0] ?? '').trim();
      const colorId = Number(item?.[1]);
      if (!id || !Number.isInteger(colorId)) continue;
      phenomena.push({
        id,
        name: VIGILANCE_PHENOMENA[id] || `Phénomène ${id}`,
        level: vigilanceLevel(colorId),
      });
    }
    records.push({
      code,
      name: departement.name,
      anchor: departement.anchor,
      level,
      phenomena,
    });
  }
  // Most severe last, so a red fill is painted over the orange it may touch.
  return records.sort((a, b) => (a.level.level ?? 0) - (b.level.level ?? 0)
    || a.code.localeCompare(b.code));
}

/**
 * Count départements per level, plus the raised total.
 * @param {Array<object>} records
 * @returns {{total:number, alerts:number, byKey:Record<string, number>}}
 */
export function summarizeVigilanceRecords(records) {
  const byKey = { green: 0, yellow: 0, orange: 0, red: 0, unknown: 0 };
  let alerts = 0;
  for (const record of Array.isArray(records) ? records : []) {
    const key = record?.level?.key;
    if (key in byKey) byKey[key] += 1;
    if (Number.isInteger(record?.level?.level) && record.level.level >= VIGILANCE_ALERT_LEVEL) {
      alerts += 1;
    }
  }
  return { total: Array.isArray(records) ? records.length : 0, alerts, byKey };
}

/**
 * Build the toggle-row colour legend from a level tally.
 *
 * Green is omitted even when 57 départements carry it: the layer does not draw
 * level 1, and a swatch for something that is never painted would describe a
 * map that is not on screen.
 * @param {Record<string, number>} byKey Tally from `summarizeVigilanceRecords`.
 * @returns {Array<{label:string,color:string,blurb:string,count:number}>}
 */
export function vigilanceLevelLegend(byKey) {
  const legend = [];
  for (const level of [4, 3, 2]) {
    const spec = VIGILANCE_LEVELS[level];
    const count = byKey?.[spec.key];
    if (!(count > 0)) continue;
    legend.push({ label: spec.label, color: spec.color, blurb: spec.meaning, count });
  }
  return legend;
}

/**
 * Label text for a raised département: the name, the level WORD, and the
 * phenomenon driving it. The word and the phenomenon are what carry the
 * meaning when the colour cannot — a bright globe washes out #f9ff00, and
 * orange against red is a common colour-vision collision.
 * @param {object} record
 * @returns {string}
 */
export function vigilanceLabelText(record) {
  const driver = record?.phenomena?.find(
    (phenomenon) => phenomenon.level.level === record.level.level,
  ) || record?.phenomena?.[0] || null;
  return driver
    ? `${record.name} · ${record.level.label} · ${driver.name}`
    : `${record.name} · ${record.level.label}`;
}

/**
 * Build the source-owned presentation for one raised-département label.
 * @param {object} record
 * @param {Cesium.Cartesian3} position
 * @returns {object}
 */
export function createVigilanceOverlayEntry(record, position) {
  return {
    id: `vigilance:${record.code}`,
    position,
    variant: 'label',
    title: vigilanceLabelText(record),
    accent: record.level.color,
    priority: (record.level.level ?? 0) * 1000,
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

/** Keep the most severe raised départements, with stable identity as tie-break. */
export function selectVigilanceOverlayCohort(entries, limit = VIGILANCE_OVERLAY_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(
    VIGILANCE_OVERLAY_COHORT_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/**
 * Map one département to a JSON-safe analyst record (analyst query engine
 * seam). Pure — no Cesium types. Missing fields are null, never NaN.
 * @param {object|null|undefined} record
 * @param {number} [index=0]
 * @returns {object}
 */
export function mapAnalystRecord(record, index = 0) {
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  return {
    id: text(record?.code) || `DEPT-${String(index).padStart(4, '0')}`,
    name: text(record?.name),
    level: Number.isInteger(record?.level?.level) ? record.level.level : null,
    levelLabel: text(record?.level?.label),
    phenomena: (record?.phenomena || []).map((phenomenon) => ({
      name: text(phenomenon?.name),
      level: Number.isInteger(phenomenon?.level?.level) ? phenomenon.level.level : null,
    })),
    lat: record?.anchor ? record.anchor[1] : null,
    lon: record?.anchor ? record.anchor[0] : null,
  };
}

export function createMeteoFranceVigilanceLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  apiUrl = API_URL,
  departementsUrl = DEPARTEMENTS_URL,
  departementsGeoJson = null,
  mapStackEventTarget = typeof window === 'undefined' ? null : window,
} = {}) {
  let _viewer = null;
  let _dataSource = null;
  /** @type {Map<string, object>} INSEE code → bundled polygon metadata. */
  let _departements = new Map();
  /**
   * INSEE code → EVERY entity Cesium made for it.
   *
   * A `MultiPolygon` département becomes one entity PER PART, not one entity:
   * the 96 bundled features produce 112 entities, because 10 départements
   * carry islands (Ré and Oléron for Charente-Maritime, Belle-Île for
   * Morbihan, …). Keying a single entity per code would leave those islands
   * permanently unpainted while their mainland showed the warning.
   * @type {Map<string, Cesium.Entity[]>}
   */
  let _entities = new Map();
  let _shapesPromise = null;
  let _records = [];
  let _summary = summarizeVigilanceRecords([]);
  let _bulletin = { updateTime: null, source: null, national: null, tomorrow: null };
  let _signature = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;
  let _classificationType = Cesium.ClassificationType.BOTH;
  let _mapStackListener = null;

  function applyClassification(next) {
    if (next === undefined || next === _classificationType) return;
    _classificationType = next;
    for (const parts of _entities.values()) {
      for (const entity of parts) {
        if (entity.polygon) entity.polygon.classificationType = next;
      }
    }
    _viewer?.scene?.requestRender?.();
  }

  /**
   * Load the bundled polygons ONCE, hidden. Every département gets an entity
   * up front so a refresh only flips `show` and swaps a material — the
   * alternative, rebuilding clamped ground geometry per bulletin, is the
   * mistake the earthquake layer already paid for.
   */
  async function ensureShapes() {
    if (_shapesPromise) return _shapesPromise;
    _shapesPromise = (async () => {
      const geojson = departementsGeoJson
        || await (await fetch(departementsUrl)).json();
      _departements = parseDepartements(geojson);
      const source = await Cesium.GeoJsonDataSource.load(geojson, {
        clampToGround: true,
        // Fill and stroke are replaced per entity below; these only keep
        // Cesium from allocating its random default palette.
        fill: Cesium.Color.TRANSPARENT,
        stroke: Cesium.Color.TRANSPARENT,
        strokeWidth: 0,
      });
      source.name = 'Météo-France Vigilance';
      source.show = _enabled;
      for (const entity of source.entities.values) {
        const code = String(entity.properties?.code?.getValue?.() ?? '').trim();
        if (!entity.polygon || !code) {
          entity.show = false;
          continue;
        }
        entity.polygon.outline = false;
        entity.polygon.classificationType = _classificationType;
        entity.polygon.material = new Cesium.ColorMaterialProperty(Cesium.Color.TRANSPARENT);
        entity.show = false;
        const parts = _entities.get(code);
        if (parts) parts.push(entity);
        else _entities.set(code, [entity]);
      }
      if (_viewer) await _viewer.dataSources.add(source);
      _dataSource = source;
      return source;
    })().catch((error) => {
      // A failed shape load must be retryable, not a permanently poisoned
      // promise that leaves the layer silently empty for the session.
      _shapesPromise = null;
      throw error;
    });
    return _shapesPromise;
  }

  /** Paint the current records onto the pre-built entities. */
  function repaint() {
    const raised = new Set();
    for (const record of _records) {
      const parts = _entities.get(record.code);
      if (!parts) continue;
      const level = record.level.level;
      if (!Number.isInteger(level) || level < VIGILANCE_ALERT_LEVEL) continue;
      raised.add(record.code);
      // One material instance per département, shared across its parts: an
      // island and its mainland are the same warning.
      const material = new Cesium.ColorMaterialProperty(
        Cesium.Color.fromCssColorString(record.level.color).withAlpha(record.level.fillAlpha),
      );
      for (const entity of parts) {
        if (!entity.polygon) continue;
        entity.polygon.material = material;
        entity.show = true;
      }
    }
    // Green is ABSENCE, not a colour — see the module header.
    for (const [code, parts] of _entities) {
      if (raised.has(code)) continue;
      for (const entity of parts) entity.show = false;
    }
    _viewer?.scene?.requestRender?.();
  }

  function publishOverlay() {
    if (!_enabled) return;
    const entries = [];
    for (const record of _records) {
      const level = record.level.level;
      if (!Number.isInteger(level) || level < VIGILANCE_ALERT_LEVEL) continue;
      if (!record.anchor) continue;
      entries.push(createVigilanceOverlayEntry(
        record,
        Cesium.Cartesian3.fromDegrees(record.anchor[0], record.anchor[1]),
      ));
    }
    overlayHost.setEntries(
      VIGILANCE_OVERLAY_SOURCE_ID,
      selectVigilanceOverlayCohort(entries),
      {
        cohortLimit: VIGILANCE_OVERLAY_COHORT_LIMIT,
        collisionCapacity: VIGILANCE_OVERLAY_COLLISION_CAPACITY,
        moving: false,
      },
    );
  }

  /** Fingerprint of the painted state, so an unchanged bulletin repaints nothing. */
  function signatureOf(records) {
    if (!records.length) return '0';
    return records.map((record) => `${record.code}:${record.level.level ?? 'x'}`).join(',');
  }

  const layer = {
    id: 'meteofrance-vigilance',
    name: 'Vigilance MF (FR)',
    icon: '⚠',
    source: 'Météo-France',
    updateInterval: UPDATE_INTERVAL_MS,

    init(viewer) {
      _viewer = viewer;
      _records = [];
      _summary = summarizeVigilanceRecords([]);
      _bulletin = { updateTime: null, source: null, national: null, tomorrow: null };
      _signature = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      _classificationType = vigilanceClassificationTypeForScene(viewer?.scene);
      if (mapStackEventTarget && !_mapStackListener) {
        _mapStackListener = (event) => {
          applyClassification(event?.detail?.activeId
            ? vigilanceClassificationTypeForStack(event.detail.activeId)
            : vigilanceClassificationTypeForScene(_viewer?.scene));
        };
        mapStackEventTarget.addEventListener('gev:map-stack-changed', _mapStackListener);
      }
      overlayHost.setVisible(VIGILANCE_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Vigilance] Initialized');
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(VIGILANCE_OVERLAY_SOURCE_ID, true);
      publishOverlay();
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(VIGILANCE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(VIGILANCE_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      try {
        await ensureShapes();
      } catch (error) {
        console.warn('[Data:Vigilance] Département polygons unavailable:', error);
        _lastError = 'Département polygons unavailable';
        return false;
      }
      try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
          _lastError = `Vigilance HTTP ${response.status}`;
          console.warn(`[Data:Vigilance] API returned ${response.status}`);
          return false;
        }
        const payload = await response.json();
        if (!payload?.periods?.[VIGILANCE_DRAWN_ECHEANCE]?.domains) {
          _lastError = 'Malformed vigilance response';
          return false;
        }

        const records = buildVigilanceRecords(payload, _departements);
        const signature = signatureOf(records);
        _records = records;
        _summary = summarizeVigilanceRecords(records);
        _bulletin = {
          updateTime: String(payload.updateTime ?? '').trim() || null,
          source: String(payload.source ?? '').trim() || null,
          national: vigilanceLevel(payload.national).level,
          // J1 costs nothing extra to carry and answers "is tomorrow worse?".
          tomorrow: summarizeVigilanceRecords(
            buildVigilanceRecords(payload, _departements, 'J1'),
          ),
        };
        _stale = payload.stale === true;
        _lastUpdate = Date.now();
        _lastError = null;

        if (signature !== _signature) {
          _signature = signature;
          repaint();
          publishOverlay();
        }

        console.log(
          `[Data:Vigilance] Updated: ${_summary.alerts} départements en vigilance`
          + ` (${_summary.byKey.yellow}J/${_summary.byKey.orange}O/${_summary.byKey.red}R)`,
        );
        return true;
      } catch (error) {
        console.warn('[Data:Vigilance] Fetch error:', error);
        _lastError = 'Vigilance network error';
        return false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      overlayHost.clearSource(VIGILANCE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(VIGILANCE_OVERLAY_SOURCE_ID, false);
      if (mapStackEventTarget && _mapStackListener) {
        mapStackEventTarget.removeEventListener('gev:map-stack-changed', _mapStackListener);
        _mapStackListener = null;
      }
      if (_dataSource) {
        viewer?.dataSources?.remove?.(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      _departements = new Map();
      _entities = new Map();
      _shapesPromise = null;
      _records = [];
      _summary = summarizeVigilanceRecords([]);
      _bulletin = { updateTime: null, source: null, national: null, tomorrow: null };
      _signature = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
    },

    /**
     * Snapshot the départements as plain JSON-safe objects for the analyst
     * query engine. On-demand only. Returns [] while the layer is off.
     * @param {number} [maxCount=200]
     * @returns {Array<Object>}
     */
    getAnalystRecords(maxCount = 200) {
      if (!_enabled) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 200;
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
      return { chips: [], legend: vigilanceLevelLegend(_summary.byKey) };
    },

    getStats() {
      return {
        // The count that matters is how many départements are RAISED — the
        // other 57 are "nothing to report", and reporting 96 would read as
        // 96 warnings.
        count: _summary.alerts,
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
        assessed: _summary.total,
        levels: _summary.byKey,
        national: _bulletin.national,
        // Licence Ouverte 2.0 obliges the producer AND the last-update date.
        updateTime: _bulletin.updateTime,
        feedSource: _bulletin.source,
        tomorrowAlerts: _bulletin.tomorrow ? _bulletin.tomorrow.alerts : null,
      };
    },
  };

  return layer;
}

const meteoFranceVigilanceLayer = createMeteoFranceVigilanceLayer();

export default meteoFranceVigilanceLayer;
