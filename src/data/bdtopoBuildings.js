import * as Cesium from 'cesium';
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import {
  cachedGroundFloor,
  resolveGroundFloorCellsBounded,
  warmGroundFloor,
} from './groundFloor.js';
import { ensureGeoidReady, geoidHeight } from './geoid.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { boxKey, snapBoxOutward } from './viewportBox.js';
import { applyViewGate } from './viewGate.js';
import {
  BASE_SINK_M,
  BDTOPO_LAYER_NAME,
  BDTOPO_MAX_BOX_DEG,
  BDTOPO_USAGE_TIERS,
  BDTOPO_VOLUME_CAP,
  BDTOPO_ZOOM,
  bdtopoBoxTooWide,
  bdtopoTileUrl,
  bdtopoTiles,
  bdtopoUsageTier,
  datumOffsetsByCell,
  declaredAltimetricPrecisionM,
  finiteOrNull,
  formatCount,
  formatMetres,
  offsetCellCentre,
  offsetCellKey,
  offsetForCell,
  seatBuilding,
  summarizeBuildings,
  surveyedGroundM,
} from './bdtopoBuildingsFeed.js';

/**
 * Bâti 3D (FR) — every building France has surveyed, at its own altitude.
 *
 * The IGN's BD TOPO published as vector tiles: a footprint, a measured height,
 * a floor altitude, a use, a dwelling count and a national building identifier
 * (RNB), for roughly 47 million buildings. This layer draws the ones in the
 * viewport as volumes and hands the rest of the record to the card.
 *
 * Keyless and unproxied, straight from `data.geopf.fr/tms`, which is unusual in
 * this codebase and deliberate: the tiles are CORS-open, rate-limited at 400
 * req/min (ten times the raster services), and served with `max-age=21 days`,
 * so the browser's own cache does the job a proxy would otherwise do. There is
 * nothing to hide and nothing to key.
 *
 * ── What the drawing is careful about ───────────────────────────────────────
 *
 * • **A building is drawn where France says it is, not where it fits.** The
 *   altitudes are BD TOPO's own (NGF-IGN69, converted h = H + N), so the block
 *   keeps the exact relative relief IGN measured between neighbours. What the
 *   layer adds is a per-cell RE-ANCHORING onto the surface the globe actually
 *   renders — because a 30 m global terrain and a 20 cm national survey do not
 *   agree, and the disagreement is where buildings float or drown. The shift is
 *   local — the median over a ~1.1 km cell — so a hillside stays a hillside
 *   instead of being flattened by a single viewport-wide correction.
 *
 * • **Every building is measured under its own feet.** The rendered surface is
 *   read where the building stands, via `globe.getHeight` — the resident terrain
 *   triangles, one synchronous call per volume and no network at all. The first
 *   version took ONE height per ~1.1 km cell and differenced it against each
 *   building's own floor; on flat ground that difference is the datum error, but
 *   on the Croix-Rousse it is the drop from the cell centre to the building, and
 *   it lifted whole blocks of Lyon into the air. Per-building sampling was priced
 *   as unaffordable against the network DEM; against resident triangles it is
 *   free. What is left after the shift is the mesh disagreeing with the survey
 *   building by building, and the volume absorbs it by growing rather than
 *   moving (see `seatOnGround`).
 *
 * • **The height and the floor come from different places, and the card says
 *   which.** `published` = both altitudes are IGN's. `height` = floor is IGN's,
 *   roof is floor + the published height — that is all of Paris, whose buildings
 *   come from the cadastre with an interpolated Z and carry no roof altitude at
 *   all. `surface` = nothing altimetric survived and the floor is the rendered
 *   ground. Four bases, counted separately, never averaged into one number.
 *
 * • **`precision_altimetrique: 9999` is discarded, not read.** It is the IGN
 *   sentinel for "no Z", and taken literally it is a ±10 km tolerance that would
 *   validate anything.
 *
 * • **A truncated city looks like a small city.** Past `BDTOPO_VOLUME_CAP` the
 *   layer stops drawing and reports `saturated`, because a straight edge through
 *   the middle of Marseille is otherwise indistinguishable from the edge of the
 *   data.
 *
 * • **Google 3D already contains these buildings.** On the photoreal stack the
 *   volumes are hidden rather than double-drawn, and the status says so instead
 *   of leaving the operator to wonder why the layer looks broken.
 */

/** Layer id — also the share-link registry key and the voice-tool enum value. */
export const BDTOPO_LAYER_ID = 'bdtopo-buildings';
/** Selected-object card, on its own protected overlay source. */
export const BDTOPO_SELECTED_OVERLAY_SOURCE_ID = 'bdtopo-buildings-selected';

export const BDTOPO_SELECTED_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/** Debounce between the camera settling and the request that follows it. */
const REQUEST_DEBOUNCE_MS = 450;
/** First step of the failed-load backoff, and its ceiling. */
const RETRY_MIN_MS = 20_000;
const RETRY_CEIL_MS = 240_000;
/**
 * Idle refresh cadence. BD TOPO is republished quarterly and a building takes a
 * year to build; this exists so a session left open overnight is not holding a
 * payload from a previous edition, not because anything moves.
 */
const UPDATE_INTERVAL_MS = 30 * 60_000;
const REQUEST_TIMEOUT_MS = 45_000;

/**
 * Cache grid the request box is snapped onto. 0.004° ≈ 300 m: panning a few
 * streets re-uses the tiles already in the browser cache instead of minting a
 * fresh tile set for every camera nudge.
 */
const BOX_SNAP_DEG = 0.004;

/**
 * How long to wait before re-seating a payload that was drawn while the shared
 * floor grid was still cold.
 *
 * The first load into a fresh area gets no rendered-surface heights at all —
 * `resolveGroundFloorCellsBounded` gives up after 1.2 s and the resolve lands in
 * the cache a moment later. Without this, the city keeps its uncorrected NGF
 * altitudes until the operator happens to move the camera. Once per box, so a
 * genuinely unreachable terrain proxy costs one extra load and not a loop.
 */
const COLD_FLOOR_RETRY_MS = 3_000;

/** Reused so a 14 000-volume payload does not mint 14 000 Cartographics. */
const _groundScratch = new Cesium.Cartographic();

const SELECTED_COLOR = '#00ffff';

/**
 * Where BD TOPO exists at all. Outside these boxes every tile request is a
 * guaranteed 404, and 64 guaranteed 404s per camera move is a rude thing to do
 * to a public service that asks for nothing in return.
 */
const BDTOPO_COVERAGE = Object.freeze([
  Object.freeze({ south: 41.2, west: -5.3, north: 51.2, east: 9.7 }), // métropole + Corse
  Object.freeze({ south: 15.7, west: -61.9, north: 16.6, east: -60.9 }), // Guadeloupe
  Object.freeze({ south: 14.3, west: -61.3, north: 15.0, east: -60.7 }), // Martinique
  Object.freeze({ south: 2.0, west: -54.7, north: 6.0, east: -51.5 }), // Guyane
  Object.freeze({ south: -21.5, west: 55.1, north: -20.8, east: 55.9 }), // La Réunion
  Object.freeze({ south: -13.1, west: 44.9, north: -12.5, east: 45.4 }), // Mayotte
]);

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

let _viewer = null;
let _overlayHost = DEFAULT_OVERLAY_HOST;
let _enabled = false;
let _primitive = null;
let _records = new Map();
let _payload = null;
let _selectedId = null;
let _loading = false;
let _error = null;
let _status = 'idle';
let _lastUpdate = null;
let _loadedKey = null;
let _abort = null;
let _debounceTimer = null;
let _retryTimer = null;
let _retryDelayMs = 0;
let _clickHandler = null;
let _moveEndRemover = null;
let _mapStackListener = null;
let _photoreal = false;
let _coldFloorTimer = null;
let _coldFloorKey = null;

/**
 * The viewport this layer will ask for, or null when there is nothing to ask.
 *
 * Three distinct "no" answers, kept distinct because they need three different
 * things said to the operator: no camera rectangle at all, a view too wide for
 * a building to be worth a pixel, and a view outside the country this data
 * describes.
 * @param {?Cesium.Viewer} viewer
 * @returns {{box: ?object, reason: ?string}}
 */
export function bdtopoViewportBox(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle(viewer.scene.globe.ellipsoid);
  if (!rectangle) return { box: null, reason: 'no-view' };
  const box = {
    south: Cesium.Math.toDegrees(rectangle.south),
    north: Cesium.Math.toDegrees(rectangle.north),
    west: Cesium.Math.toDegrees(rectangle.west),
    east: Cesium.Math.toDegrees(rectangle.east),
  };
  if (!Number.isFinite(box.south) || !Number.isFinite(box.west)) return { box: null, reason: 'no-view' };
  if (box.west >= box.east || box.south >= box.north) return { box: null, reason: 'no-view' };
  // Coverage BEFORE width, or a wide view of the mid-Atlantic is told to zoom
  // in — advice that would still find nothing at any altitude.
  if (!bdtopoCoverageIntersects(box)) return { box: null, reason: 'off-coverage' };
  if (bdtopoBoxTooWide(box)) return { box: null, reason: 'too-wide' };
  return { box, reason: null };
}

/**
 * @param {{south:number, west:number, north:number, east:number}} box
 * @returns {boolean} Whether the box touches any BD TOPO coverage area.
 */
export function bdtopoCoverageIntersects(box) {
  if (!box) return false;
  return BDTOPO_COVERAGE.some((area) => box.south <= area.north && box.north >= area.south
    && box.west <= area.east && box.east >= area.west);
}

/**
 * Whether the active map stack already draws these buildings itself.
 * @param {?string} activeId
 * @returns {boolean}
 */
export function bdtopoStackDrawsBuildings(activeId) {
  return activeId === 'photoreal';
}

/** @returns {string} A one-line human label for a building. */
export function bdtopoLabel(props) {
  const usage = props?.usage_1;
  const nature = props?.nature && props.nature !== 'Indifférenciée' ? props.nature : null;
  return nature || usage || 'Bâtiment';
}

/**
 * The selected-building card.
 *
 * Every line is either a published value or an explicit statement that the
 * value is absent. The seating basis is on the card because it is the one thing
 * a viewer cannot tell by looking: two buildings side by side, one standing on
 * its surveyed roof altitude and one on a cadastral interpolation, are drawn
 * identically and are not the same claim.
 * @param {object} record
 * @returns {?object}
 */
export function createBdtopoSelectedOverlayEntry(record) {
  if (!record?.id || !record.position) return null;
  const props = record.props || {};
  const details = [];

  details.push(record.heightM !== null
    ? `Hauteur ${formatMetres(record.heightM)}${props.nombre_d_etages ? ` · ${props.nombre_d_etages} étages` : ''}`
    : 'Hauteur non publiée');

  if (record.dwellings) details.push(`${formatCount(record.dwellings)} logements déclarés`);
  if (props.usage_2) details.push(`Usage secondaire ${props.usage_2}`);

  const minSol = finiteOrNull(props.altitude_minimale_sol);
  if (minSol !== null) {
    const maxToit = finiteOrNull(props.altitude_maximale_toit);
    details.push(maxToit !== null
      ? `Sol ${minSol.toFixed(1)} m → toit ${maxToit.toFixed(1)} m NGF`
      : `Sol ${minSol.toFixed(1)} m NGF · toit non publié`);
  }

  details.push({
    published: 'Posé sur ses deux altitudes IGN',
    height: 'Posé sur son altitude de sol IGN + sa hauteur',
    surface: 'Posé sur la surface rendue — pas d\'altitude IGN utilisable',
    default: 'Hauteur inconnue : 6 m par défaut',
  }[record.basis]);

  // The volume on screen is taller than the two altitudes above whenever the
  // globe's terrain and the survey disagree, and a viewer cannot tell by
  // looking. Under a metre is the survey's own tolerance and not worth a line.
  if (Number.isFinite(record.gapM) && Math.abs(record.gapM) >= 1) {
    const metres = formatMetres(Math.abs(record.gapM));
    details.push(record.gapM < 0
      ? `Sol rendu ${metres} sous l'altitude IGN · base prolongée d'autant`
      : `Sol rendu ${metres} au-dessus de l'altitude IGN · toit relevé d'autant`);
  }

  const precision = declaredAltimetricPrecisionM(props);
  details.push(precision !== null
    ? `Altimétrie ${String(props.methode_d_acquisition_altimetrique || 'non précisée').toLowerCase()}, ±${precision} m`
    : 'Altimétrie non renseignée par l\'IGN');

  if (props.identifiants_rnb) details.push(`RNB ${String(props.identifiants_rnb).split('/')[0]}`);

  return {
    id: String(record.id),
    position: record.position,
    variant: 'selected',
    selected: true,
    protected: true,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    title: record.label,
    details,
    accent: SELECTED_COLOR,
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

/** Fetch one vector tile. A 404 means "no data on this square", not a failure. */
async function fetchTile(tile, signal) {
  const response = await fetch(bdtopoTileUrl(tile), { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`BD TOPO ${tile.z}/${tile.x}/${tile.y}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) return null;
  return { tile: new VectorTile(new PbfReader(bytes)), meta: tile, bytes: bytes.length };
}

/**
 * Fetch every tile of one viewport, tolerating the ones that refuse.
 *
 * A city-sized box is 30–60 separate tile requests, and the Géoplateforme is a
 * free public service that rate-limits (400 req/min) and occasionally answers
 * 5xx under load. `Promise.all` turns any ONE of those into a rejection, which
 * is how a layer that had 59 good tiles in hand ended up reporting itself
 * UNAVAILABLE on the hosted deployment and backing off for four minutes.
 *
 * So a refusal is now per-tile: the squares that arrived are drawn, the ones
 * that did not are COUNTED and reported, and the layer asks again shortly. The
 * one case that is still a genuine failure is every tile refusing — there is
 * nothing to draw then, and saying so is the honest answer.
 *
 * `AbortError` is never a tile fault: it is this layer superseding its own
 * request, and it is rethrown so `load()` can drop the whole attempt.
 * @param {Array<object>} wanted
 * @param {AbortSignal} signal
 * @returns {Promise<{fetched: Array<object>, failed: number, firstError: ?Error}>}
 */
async function fetchTiles(wanted, signal) {
  const settled = await Promise.all(wanted.map((tile) => fetchTile(tile, signal).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  )));

  const aborted = settled.find((entry) => !entry.ok && entry.error?.name === 'AbortError');
  if (aborted) throw aborted.error;

  const failures = settled.filter((entry) => !entry.ok);
  return {
    fetched: settled.filter((entry) => entry.ok).map((entry) => entry.value).filter(Boolean),
    failed: failures.length,
    firstError: failures[0]?.error || null,
  };
}

/**
 * The height of the surface the globe is DRAWING at a point, in ellipsoidal
 * metres, or null.
 *
 * `globe.getHeight` reads the terrain tile that is already resident — the exact
 * triangles on screen, at the LOD they are being rendered at, synchronously and
 * with no network at all. That is the surface a building has to sit on: not the
 * DEM the terrain was built from, and not a neighbouring cell's DEM value.
 *
 * The coarse DEM grid stays as the fallback for the one case the globe cannot
 * answer — a camera that has just teleported, with nothing streamed yet — where
 * it is the only prior available and the layer's cold-floor retry will come
 * back for a second look regardless.
 * @param {number} lat
 * @param {number} lon
 * @returns {?number}
 */
function renderedGroundM(lat, lon) {
  const globe = _viewer?.scene?.globe;
  if (globe) {
    _groundScratch.longitude = Cesium.Math.toRadians(lon);
    _groundScratch.latitude = Cesium.Math.toRadians(lat);
    _groundScratch.height = 0;
    const height = globe.getHeight(_groundScratch);
    if (Number.isFinite(height)) return height;
  }
  const warm = cachedGroundFloor(lat, lon);
  return Number.isFinite(warm) ? warm : null;
}

/**
 * Turn decoded tiles into one record per drawn footprint.
 *
 * Two passes on purpose. The first reads the geometry and the rendered surface
 * under each building; the second seats the buildings once the datum offset for
 * each cell is known. Seating in one pass would mean seating the first building
 * before the surface under the last one had been looked at.
 * @param {Array<object>} tiles
 * @returns {Promise<{records: Array<object>, saturated: boolean, offsets: object}>}
 */
async function buildRecords(tiles) {
  const raw = [];
  const seen = new Set();
  const geoidByCell = new Map();
  let saturated = false;

  for (const { tile, meta } of tiles) {
    const layer = tile.layers?.[BDTOPO_LAYER_NAME];
    if (!layer) continue;
    for (let index = 0; index < layer.length; index += 1) {
      if (raw.length >= BDTOPO_VOLUME_CAP) { saturated = true; break; }
      const feature = layer.feature(index);
      const props = feature.properties || {};
      const geojson = feature.toGeoJSON(meta.x, meta.y, meta.z);
      const polygons = geojson.geometry?.type === 'MultiPolygon'
        ? geojson.geometry.coordinates
        : [geojson.geometry?.coordinates];

      for (const polygon of polygons) {
        const ring = polygon?.[0];
        if (!ring || ring.length < 4) continue;
        if (raw.length >= BDTOPO_VOLUME_CAP) { saturated = true; break; }

        const degrees = [];
        let sumLon = 0;
        let sumLat = 0;
        for (const [lon, lat] of ring) { degrees.push(lon, lat); sumLon += lon; sumLat += lat; }
        const lon = sumLon / ring.length;
        const lat = sumLat / ring.length;

        // Interior rings — courtyards and light wells — on 11% of Lyon's
        // polygons and 6% of Grenoble's. Dropping them fills exactly the voids
        // that separate one building from the next, and a continuous street
        // front becomes one solid block.
        const holes = [];
        for (let h = 1; h < polygon.length; h += 1) {
          const inner = polygon[h];
          if (!inner || inner.length < 4) continue;
          const flat = [];
          for (const [holeLon, holeLat] of inner) flat.push(holeLon, holeLat);
          holes.push(flat);
        }

        // A building cut across two tiles is drawn twice (the halves re-join)
        // and counted once. `first` is what the statistics and the dwelling
        // total are allowed to look at.
        const cleabs = props.cleabs ? String(props.cleabs) : null;
        const first = !cleabs || !seen.has(cleabs);
        if (cleabs) seen.add(cleabs);

        const cellKey = offsetCellKey(lat, lon);
        if (!geoidByCell.has(cellKey)) {
          const centre = offsetCellCentre(lat, lon);
          geoidByCell.set(cellKey, geoidHeight(centre.lat, centre.lon));
        }

        raw.push({
          id: `bdtopo:${cleabs || `${meta.x}/${meta.y}`}:${raw.length}`,
          props,
          degrees,
          holes,
          lat,
          lon,
          cellKey,
          geoidN: geoidByCell.get(cellKey),
          first,
        });
      }
    }
  }

  // The surface under each building, read off the terrain the globe already has
  // resident. Free and synchronous, so it is taken PER BUILDING — which is the
  // whole correctness of the datum offset below. Sampling one point per ~1.1 km
  // cell and differencing it against each building's own IGN floor measures the
  // relief between the cell centre and the building, not the datum error, and on
  // a hillside that is tens of metres of lift applied to a whole block.
  let coldGround = 0;
  for (const entry of raw) {
    entry.surfaceM = renderedGroundM(entry.lat, entry.lon);
    if (entry.surfaceM === null) coldGround += 1;
  }

  // Only when the globe could not answer — a camera that just teleported, with
  // no terrain tile resident yet — is the network DEM worth a bounded wait. One
  // sample per offset cell, so a 6 km viewport costs ~64 heights and not 6 400.
  //
  // And a cell-centre height is then given ONLY to the buildings that have no
  // altimetry of their own, for which it is the difference between being drawn
  // and being dropped. A building that HAS a surveyed floor keeps it: correcting
  // it against a height from up to a kilometre away is the bug this layer was
  // just fixed for, and its own altitude is the honest answer until the terrain
  // arrives and the cold-ground reload asks again.
  const cellPoints = new Map();
  if (coldGround) {
    for (const entry of raw) {
      if (!cellPoints.has(entry.cellKey)) {
        cellPoints.set(entry.cellKey, offsetCellCentre(entry.lat, entry.lon));
      }
    }
    const points = [...cellPoints.values()];
    warmGroundFloor(points);
    await resolveGroundFloorCellsBounded(points);
    for (const entry of raw) {
      if (entry.surfaceM !== null || surveyedGroundM(entry.props) !== null) continue;
      const centre = cellPoints.get(entry.cellKey);
      const fallback = cachedGroundFloor(centre.lat, centre.lon);
      if (Number.isFinite(fallback)) entry.surfaceM = fallback;
    }
  }

  // Both sides of the difference describe the SAME SPOT: the middle of this
  // building's footprint, measured on the mesh and stated by the survey.
  const samples = [];
  for (const entry of raw) {
    const groundM = surveyedGroundM(entry.props);
    if (groundM === null) continue;
    samples.push({
      cellKey: entry.cellKey,
      ignM: groundM + entry.geoidN,
      renderedM: entry.surfaceM,
    });
  }
  const offsets = datumOffsetsByCell(samples);

  const records = [];
  for (const entry of raw) {
    const seat = seatBuilding(entry.props, {
      geoidN: entry.geoidN,
      surfaceM: entry.surfaceM,
      offsetM: offsetForCell(offsets, entry.cellKey),
    });
    if (!Number.isFinite(seat.baseM) || !Number.isFinite(seat.topM) || seat.topM <= seat.baseM) continue;

    const tier = bdtopoUsageTier(entry.props.usage_1);
    records.push({
      id: entry.id,
      props: entry.props,
      degrees: entry.degrees,
      holes: entry.holes,
      lat: entry.lat,
      lon: entry.lon,
      tierId: tier.id,
      color: tier.color,
      baseM: seat.baseM,
      topM: seat.topM,
      basis: seat.basis,
      gapM: seat.gapM,
      heightM: finiteOrNull(entry.props.hauteur),
      dwellings: Number(entry.props.nombre_de_logements) || 0,
      rnb: entry.props.identifiants_rnb || null,
      label: bdtopoLabel(entry.props),
      first: entry.first,
      position: Cesium.Cartesian3.fromDegrees(entry.lon, entry.lat, seat.topM),
    });
  }

  return { records, saturated, offsets, requestedCells: cellPoints.size, coldGround };
}

/** Drop the drawn primitive and everything that indexes into it. */
function clearPrimitive() {
  if (_primitive && _viewer?.scene) {
    _viewer.scene.primitives.remove(_primitive);
  }
  _primitive = null;
  _records = new Map();
  _selectedId = null;
}

/** Build one batched primitive for the whole payload. */
function drawRecords(records) {
  clearPrimitive();
  if (!records.length || !_viewer) return;

  const instances = [];
  for (const record of records) {
    _records.set(record.id, record);
    instances.push(new Cesium.GeometryInstance({
      id: record.id,
      geometry: new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(
          Cesium.Cartesian3.fromDegreesArray(record.degrees),
          record.holes.map((hole) => new Cesium.PolygonHierarchy(
            Cesium.Cartesian3.fromDegreesArray(hole),
          )),
        ),
        height: record.baseM,
        extrudedHeight: record.topM,
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        closeTop: true,
        // Closed: on a slope a volume's base breaks the surface, and an open
        // bottom shows the inside of the far walls through the opening.
        closeBottom: true,
      }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(volumeColor(record)),
      },
    }));
  }

  _primitive = new Cesium.Primitive({
    geometryInstances: instances,
    // Lit rather than flat: without normals a city of one-colour boxes reads as
    // a single mass, and the whole point of the layer is that it has shape.
    appearance: new Cesium.PerInstanceColorAppearance({ closed: true, translucent: false }),
    // Tessellating ten thousand extruded polygons on the render thread drops
    // frames for a second; Cesium's worker pool does it without a stutter.
    asynchronous: true,
    releaseGeometryInstances: false,
  });
  _primitive.show = _enabled && !_photoreal;
  _viewer.scene.primitives.add(_primitive);
  governorRequestRender('bdtopo-buildings');
}

/**
 * A volume's colour: its usage band, darkened towards the ground.
 *
 * Opaque, always — an alpha below 1 moves the geometry into Cesium's
 * translucent pass, which does not write depth, and a city then renders as one
 * mass with everything showing through everything.
 *
 * The brightness carries HEIGHT because the usage does not carry enough: 83-87%
 * of buildings on a French urban tile are `Résidentiel` or `Indifférencié`, so
 * two neighbours almost always share a hue, and with no outline between them a
 * street front reads as a single polygon. Height varies between immediate
 * neighbours and is the channel that separates them.
 * @param {object} record
 * @returns {Cesium.Color}
 */
function volumeColor(record) {
  const base = Cesium.Color.fromCssColorString(record.color);
  const visibleM = record.topM - record.baseM - BASE_SINK_M;
  const t = Math.min(Math.max((visibleM - 4) / 34, 0), 1);
  // `darken` is an INSTANCE method on Cesium.Color; there is no static form.
  return base.darken(0.42 * (1 - t), new Cesium.Color());
}

function clearSelection() {
  if (_selectedId) {
    const record = _records.get(_selectedId);
    if (record) applyInstanceColor(_selectedId, volumeColor(record));
  }
  _selectedId = null;
  _overlayHost.clearSource(BDTOPO_SELECTED_OVERLAY_SOURCE_ID);
}

/**
 * Recolour one instance inside the batched primitive.
 *
 * Cheaper than a second highlight primitive by an order of magnitude, and the
 * only reason it is safe: `releaseGeometryInstances: false` keeps the per-
 * instance attribute table alive after the primitive is built. Before the
 * primitive is ready there is no table, which is a no-op rather than an error.
 * @param {string} id
 * @param {?Cesium.Color} color
 * @returns {boolean} whether the colour was applied.
 */
function applyInstanceColor(id, color) {
  if (!_primitive || !_primitive.ready || !color) return false;
  try {
    const attributes = _primitive.getGeometryInstanceAttributes(id);
    if (!attributes) return false;
    attributes.color = Cesium.ColorGeometryInstanceAttribute.toValue(color);
    return true;
  } catch {
    return false;
  }
}

function selectObject(id) {
  clearSelection();
  const record = _records.get(id);
  if (!record) return;
  _selectedId = id;
  applyInstanceColor(id, Cesium.Color.fromCssColorString(SELECTED_COLOR));
  const entry = createBdtopoSelectedOverlayEntry(record);
  if (entry) {
    _overlayHost.setEntries(
      BDTOPO_SELECTED_OVERLAY_SOURCE_ID,
      [entry],
      BDTOPO_SELECTED_OVERLAY_SOURCE_OPTIONS,
    );
  }
  governorRequestRender('bdtopo-select');
}

/** Resolve a Cesium pick into one of this layer's render ids. */
export function resolveBdtopoPickId(picked, has = (id) => _records.has(id)) {
  if (!picked) return null;
  if (typeof picked.id === 'string' && has(picked.id)) return picked.id;
  const nested = picked.id?.id;
  if (typeof nested === 'string' && has(nested)) return nested;
  return null;
}

function onKeyDown(event) {
  if (event.key === 'Escape' && _selectedId) clearSelection();
}

function installClickHandler(viewer) {
  if (_clickHandler) return;
  _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _clickHandler.setInputAction((click) => {
    const id = resolveBdtopoPickId(viewer.scene.pick(click.position));
    if (id) selectObject(id);
    else if (_selectedId) clearSelection();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);
}

function clearRetry() {
  if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
}

function clearColdFloorRetry() {
  if (_coldFloorTimer) { clearTimeout(_coldFloorTimer); _coldFloorTimer = null; }
}

function scheduleLoad() {
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => { void load(); }, REQUEST_DEBOUNCE_MS);
}

function scheduleRetry() {
  clearRetry();
  _retryDelayMs = _retryDelayMs
    ? Math.min(_retryDelayMs * 2, RETRY_CEIL_MS)
    : RETRY_MIN_MS;
  _retryTimer = setTimeout(() => { void load(); }, _retryDelayMs);
}

/** Fetch, seat and draw the buildings for the current viewport. */
async function load() {
  if (!_enabled || !_viewer) return false;

  const { box, reason } = bdtopoViewportBox(_viewer);
  if (!box) {
    clearPrimitive();
    _payload = null;
    _loadedKey = null;
    _error = null;
    _status = reason === 'too-wide' ? 'zoom-in' : (reason === 'off-coverage' ? 'off-coverage' : 'idle');
    governorRequestRender('bdtopo-clear');
    return false;
  }

  const snapped = snapBoxOutward(box, BOX_SNAP_DEG);
  const key = boxKey(snapped, 3);
  if (key === _loadedKey && _payload && !_error) return false;

  _abort?.abort();
  _abort = new AbortController();
  const signal = _abort.signal;
  const timeout = setTimeout(() => _abort?.abort(), REQUEST_TIMEOUT_MS);
  _loading = true;
  _status = 'loading';
  _error = null;

  try {
    await ensureGeoidReady();
    const { tiles: wanted, overflow } = bdtopoTiles(snapped, BDTOPO_ZOOM);
    const started = performance.now();
    const { fetched, failed, firstError } = await fetchTiles(wanted, signal);
    if (signal.aborted) return false;
    // Nothing came back at all — that is the service being down, not a gap in
    // the coverage, and it is the one case that still fails the whole load.
    if (failed > 0 && failed === wanted.length) throw firstError;

    const bytes = fetched.reduce((total, entry) => total + entry.bytes, 0);
    const { records, saturated, offsets, requestedCells, coldGround } = await buildRecords(fetched);
    if (signal.aborted) return false;

    drawRecords(records);
    const distinct = records.filter((record) => record.first);
    _payload = summarizeBuildings(distinct, {
      volumes: records.length,
      tiles: fetched.length,
      requestedTiles: wanted.length,
      missingTiles: failed,
      bytes,
      saturated: saturated || overflow,
      offsetM: offsets.medianM,
      offsetCells: offsets.cells,
      offsetCellsRequested: requestedCells,
      coldGround,
      elapsedMs: performance.now() - started,
      box: snapped,
    });
    _lastUpdate = Date.now();
    _status = 'ready';

    if (failed > 0) {
      // Some squares of this viewport are missing, so what is drawn is a real
      // but INCOMPLETE city — the same shape a straight edge through Marseille
      // has, and it must not read as "this is all there is". The box is not
      // memoized, so the retry actually refetches rather than short-circuiting.
      _loadedKey = null;
      scheduleRetry();
    } else {
      _loadedKey = key;
      _retryDelayMs = 0;
      clearRetry();
    }

    // Drawn against ground that was not all there: terrain still streaming into
    // a freshly entered area, and for those buildings the seating fell back to
    // a cell-centre DEM height or to the raw NGF altitude. Both are honest and
    // neither is final, so ask again once the tiles have landed — once per box,
    // so a genuinely unreachable surface costs one extra load and not a loop.
    if ((coldGround > 0 || (offsets.cells === 0 && requestedCells > 0)) && _coldFloorKey !== key) {
      _coldFloorKey = key;
      _loadedKey = null;
      clearTimeout(_coldFloorTimer);
      _coldFloorTimer = setTimeout(() => { void load(); }, COLD_FLOOR_RETRY_MS);
    }
    return true;
  } catch (error) {
    if (error?.name === 'AbortError') return false;
    _error = error?.message || String(error);
    _status = 'unavailable';
    _loadedKey = null;
    scheduleRetry();
    console.warn('[Data:Bâti 3D] load failed:', error);
    return false;
  } finally {
    clearTimeout(timeout);
    _loading = false;
  }
}

/** Apply the active map stack's verdict on whether these volumes belong. */
function applyMapStack(activeId) {
  const next = bdtopoStackDrawsBuildings(activeId);
  if (next === _photoreal) return;
  _photoreal = next;
  if (_primitive) _primitive.show = _enabled && !_photoreal;
  if (_photoreal) clearSelection();
  governorRequestRender('bdtopo-map-stack');
}

/** Bâti 3D (FR) layer. @type {Object} */
const bdtopoBuildingsLayer = {
  id: BDTOPO_LAYER_ID,
  name: 'Bâti 3D (FR)',
  icon: '▤',
  source: 'IGN BD TOPO (Géoplateforme)',
  updateInterval: UPDATE_INTERVAL_MS,

  init(viewer) {
    _viewer = viewer;
    _enabled = false;
    _records = new Map();
    _payload = null;
    _selectedId = null;
    _loading = false;
    _error = null;
    _status = 'idle';
    _lastUpdate = null;
    _loadedKey = null;
    _coldFloorKey = null;
    _retryDelayMs = 0;
    // The globe being hidden IS the photoreal stack — that is how
    // `mapStackController` switches to it, and no event has fired yet at init.
    _photoreal = viewer?.scene?.globe?.show === false;

    if (typeof window !== 'undefined' && !_mapStackListener) {
      _mapStackListener = (event) => applyMapStack(event?.detail?.activeId ?? null);
      window.addEventListener('gev:map-stack-changed', _mapStackListener);
    }
    _overlayHost.setVisible(BDTOPO_SELECTED_OVERLAY_SOURCE_ID, false);
    console.log('[Data:Bâti 3D] Initialized');
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    // The boot-time stack settle fires no event, so re-derive from the scene
    // rather than trusting whatever the last event left behind.
    _photoreal = viewer?.scene?.globe?.show === false;
    if (_primitive) _primitive.show = !_photoreal;
    _overlayHost.setVisible(BDTOPO_SELECTED_OVERLAY_SOURCE_ID, true);
    installClickHandler(viewer);
    registerPickOwner(BDTOPO_LAYER_ID, (pickedId) => _records.has(pickedId));
    if (!_moveEndRemover) {
      _moveEndRemover = viewer.camera.moveEnd.addEventListener(scheduleLoad);
    }
    // DataLayerManager invokes update() immediately after enable(), which owns
    // the first fetch. Avoid racing it with a second aborting request here.
  },

  disable() {
    _enabled = false;
    clearSelection();
    clearRetry();
    clearColdFloorRetry();
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
    _abort?.abort();
    _abort = null;
    if (_primitive) _primitive.show = false;
    _overlayHost.setVisible(BDTOPO_SELECTED_OVERLAY_SOURCE_ID, false);
    if (_clickHandler) { _clickHandler.destroy(); _clickHandler = null; }
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(BDTOPO_LAYER_ID);
    if (_moveEndRemover) { _moveEndRemover(); _moveEndRemover = null; }
    _loading = false;
    _status = 'idle';
  },

  /**
   * Bring the camera inside the box this layer loads behind, on the way in.
   *
   * Only the WIDTH is worth flying for. Off coverage is a different answer —
   * Berlin does not become French at 2 km — and a camera with no rectangle at
   * all has nothing to aim at. Both keep their guidance state instead.
   * @param {?Cesium.Viewer} viewer
   * @param {{signal?: ?AbortSignal}} [options]
   * @returns {Promise<boolean>} Whether the camera ended inside the gate.
   */
  async ensureViewGate(viewer, { signal } = {}) {
    const target = viewer || _viewer;
    if (!target) return false;
    const { box, reason } = bdtopoViewportBox(target);
    if (reason !== 'too-wide') return Boolean(box);
    return applyViewGate(target, {
      fits: () => Boolean(bdtopoViewportBox(target).box),
      maxDeg: BDTOPO_MAX_BOX_DEG,
      coverage: BDTOPO_COVERAGE,
      signal,
      reason: 'bdtopo-view-gate',
    });
  },

  async update() {
    if (!_enabled) return false;
    // An idle refresh has to actually refetch, so drop the box memo first.
    _loadedKey = null;
    const loaded = await load();
    // `load()` answers "did this tick fetch anything", which is not the question
    // the manager asks. A guidance state — too wide, off coverage, superseded by
    // a newer camera — fetched nothing and failed at nothing, and reporting it
    // as false made the manager tear a freshly enabled layer back down with
    // "could not start cleanly". Only a recorded error is a failed refresh.
    return loaded || !_error;
  },

  /**
   * Buildings are not contacts. They do not move, they are not tracked, and a
   * detection reticle over every house in Lyon would drown every layer that
   * does have something moving to report.
   * @returns {Array}
   */
  getDetectableObjects() {
    return [];
  },

  /**
   * The legend: the six usage bands, in the order they are drawn.
   * @returns {{chips: Array<object>, legend: Array<object>}}
   */
  getRowControls() {
    const legend = [];
    for (const tier of _payload?.tiers || BDTOPO_USAGE_TIERS.map((t) => ({ ...t, count: 0 }))) {
      legend.push({
        label: tier.label,
        color: tier.color,
        count: tier.count,
        blurb: tier.blurb,
      });
    }
    return { chips: [], legend };
  },

  getStats() {
    const result = {
      count: _payload?.count ?? 0,
      volumes: _payload?.volumes ?? null,
      dwellings: _payload?.dwellings ?? null,
      tallestM: _payload?.tallestM ?? null,
      heightCoverage: _payload?.heightCoverage ?? null,
      rnbCoverage: _payload?.rnbCoverage ?? null,
      basis: _payload?.basis ?? null,
      datumOffsetM: _payload?.offsetM ?? null,
      datumCells: _payload?.offsetCells ?? null,
      datumCellsRequested: _payload?.offsetCellsRequested ?? null,
      groundColdVolumes: _payload?.coldGround ?? null,
      groundGapMedianM: _payload?.groundGapMedianM ?? null,
      groundGapWorstM: _payload?.groundGapWorstM ?? null,
      saturated: Boolean(_payload?.saturated),
      missingTiles: _payload?.missingTiles ?? 0,
      lastUpdate: _lastUpdate,
      loading: _loading,
      status: _status === 'ready' ? 'ok' : _status,
      feedSource: 'IGN BD TOPO — Licence Ouverte 2.0',
    };
    // Buildings are drawn and some squares are not. DEGRADED rather than an
    // error string: there IS a city on screen, it is simply short of a few
    // tiles, and the row has to say which of the two it is looking at.
    const missing = Number(_payload?.missingTiles) || 0;
    if (missing > 0 && !_photoreal) {
      result.degraded = true;
      result.loadingLabel = `${missing} tuile${missing > 1 ? 's' : ''} BD TOPO refusée${missing > 1 ? 's' : ''} sur ${formatCount(_payload?.requestedTiles ?? 0)} — bâti incomplet, nouvelle tentative`;
    }
    if (_photoreal) {
      result.status = 'ok';
      result.loadingLabel = 'Masqué : Google 3D dessine déjà ce bâti';
    } else if (_status === 'zoom-in') {
      result.status = 'ok';
      result.loadingLabel = `Zoome sous ${BDTOPO_MAX_BOX_DEG}° pour charger le bâti`;
    } else if (_status === 'off-coverage') {
      result.status = 'ok';
      result.loadingLabel = 'Hors couverture BD TOPO (France et DROM)';
    } else if (_loading) {
      result.loadingLabel = 'Tuiles BD TOPO…';
    }
    if (_error) result.error = _error;
    return result;
  },

  destroy(viewer) {
    if (_enabled) this.disable(viewer);
    else {
      clearSelection();
      if (_clickHandler) { _clickHandler.destroy(); _clickHandler = null; }
      if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
      unregisterPickOwner(BDTOPO_LAYER_ID);
    }
    if (typeof window !== 'undefined' && _mapStackListener) {
      window.removeEventListener('gev:map-stack-changed', _mapStackListener);
      _mapStackListener = null;
    }
    if (_moveEndRemover) { _moveEndRemover(); _moveEndRemover = null; }
    clearColdFloorRetry();
    clearPrimitive();
    _payload = null;
    _viewer = null;
  },
};

/** Seed rendered records so selection/card/legend paths run without WebGL. */
export function _setBdtopoStateForTest({
  viewer, records, payload, overlayHost, enabled = true, photoreal = false,
} = {}) {
  _viewer = viewer || null;
  if (records) _records = records instanceof Map ? records : new Map(Object.entries(records));
  if (payload !== undefined) _payload = payload;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  _enabled = enabled;
  _photoreal = photoreal;
  _selectedId = null;
  _status = 'ready';
}

/** @returns {?string} */
export function _bdtopoSelectedIdForTest() {
  return _selectedId;
}

export function _selectBdtopoObjectForTest(id) {
  selectObject(id);
}

export function _clearBdtopoSelectionForTest() {
  clearSelection();
}

export function _bdtopoRowControlsForTest() {
  return bdtopoBuildingsLayer.getRowControls();
}

export function _bdtopoStatsForTest() {
  return bdtopoBuildingsLayer.getStats();
}

export function _bdtopoApplyMapStackForTest(activeId) {
  applyMapStack(activeId);
}

/** The per-tile failure tolerance, without a viewport or a globe. */
export function _fetchBdtopoTilesForTest(wanted, signal) {
  return fetchTiles(wanted, signal);
}

/** Seed a payload so `getStats()` can be read for a partial load. */
export function _setBdtopoPayloadForTest(payload) {
  _payload = payload;
}

export default bdtopoBuildingsLayer;
