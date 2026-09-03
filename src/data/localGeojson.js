import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { airportCardDetails, airportLabelPriority } from './airportsPack.js';
import {
  datacenterCardDetails,
  datacenterRenderSpec,
  datacenterSurfaceLegend,
  geometryAreaM2,
} from './datacentersPack.js';
import {
  damCardDetails,
  damLabelPriority,
  damRenderSpec,
  damSpanLegend,
  damStructureTitle,
} from './damsPack.js';
import {
  clearSelectedEntityContextForLayer,
  registerEntityContext,
  selectEntityContext,
} from './contextStore.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';

const DEFAULT_LABEL_MAX = 900;
const DEFAULT_LABEL_GRID_PX = 132;
const VISIBILITY_UPDATE_MS = 450;
// Each source keeps its own bounded cohort; the host sums their ambient-card
// paint budgets only up to its 192-card shared-lane ceiling.
export const LOCAL_OVERLAY_COHORT_LIMIT = 160;
const LOCAL_OVERLAY_COLLISION_CAPACITY = 96;
const LOCAL_OVERLAY_CELL_SURPLUS = 2;
const LOCAL_OVERLAY_MAX_DISTANCE_M = 14000000;
const LOCAL_OVERLAY_FADE_START_M = 250000;
const LOCAL_OVERLAY_FADE_START_RATIO = LOCAL_OVERLAY_FADE_START_M / LOCAL_OVERLAY_MAX_DISTANCE_M;
// Stems are anchored at ellipsoid height 0, but high-elevation features
// (e.g. dams in river canyons) sit hundreds of meters above the ellipsoid,
// burying the short close-in stem inside the photoreal mesh. Once the
// camera is near enough for tiles to be loaded, sample the real surface
// height once per feature and lift the stem onto it.
const GROUND_SAMPLE_MAX_DISTANCE_M = 75000;
const GROUND_SAMPLE_RETRY_MS = 2000;
const GROUND_SAMPLE_MAX_ABS_HEIGHT_M = 9000;
/**
 * Bounded give-up for the self-armed retry. Sampling can be SUPPORTED and still
 * never succeed (no sampleable surface under the feature), in which case each
 * requested frame would arm the next 2 s timer forever — an idle-governor leak
 * dressed up as a retry. After this many consecutive armed retries with no
 * record newly grounded, stop arming; camera motion (a frame we get for free)
 * still retries through the normal preRender walk and re-opens the budget.
 * 30 × 2 s ≈ 60 s, far longer than a tile stream-in.
 */
export const GROUND_SAMPLE_MAX_ARMED_RETRIES = 30;
/** Ignore sub-metre camera-derived stem-tip noise at camera settle. */
export const LOCAL_STEM_TIP_EPSILON_M = 0.5;
const LOCAL_STEM_TIP_EPSILON_SQ = LOCAL_STEM_TIP_EPSILON_M ** 2;

const DEFAULT_OVERLAY_HOST = Object.freeze({
  clearSource: clearOverlaySource,
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
});

/**
 * ── THE RENDER SPEC ─────────────────────────────────────────────────────────
 *
 * One object per feature, resolved once at load, that says how that ONE
 * feature is drawn. It exists because `groupStyles` cannot: a group style is
 * keyed by a classification, and the thing this repo kept failing to draw is a
 * MEASUREMENT — a footprint in square metres, a span in metres — which is
 * different for every feature and therefore cannot live in a key.
 *
 *   key              string   tally + legend bucket for this feature
 *   pixelSize        number   constant-pixel anchor dot (never scaled by range)
 *   hollow           boolean  ring instead of disc — A1's "this was not measured"
 *   color            string?  per-feature colour, overrides the group/layer one
 *   surface          string?  'volume' | 'flat' | null — how the polygon draws
 *   fillAlpha        number?  fill opacity for 'volume'/'flat'
 *   extrudedHeightM  number?  metres, only ever set with surface === 'volume'
 *
 * The spec is produced by the PACK, not here, for the same reason the card
 * copy is: the module that knows what the tags mean is the module that decides
 * what the mark claims, and it is unit-tested without a scene.
 *
 * @type {Readonly<Record<string, {featureRender: Function, renderLegend: Function}>>}
 */
const PACK_RENDERERS = Object.freeze({
  'local-datacenters': Object.freeze({
    featureRender: datacenterRenderSpec,
    renderLegend: datacenterSurfaceLegend,
  }),
  'local-dams': Object.freeze({
    featureRender: (properties) => damRenderSpec(properties),
    renderLegend: damSpanLegend,
  }),
});

/**
 * The default render spec for a pack that declares none: one 10 px dot, no
 * surface styling, exactly the behaviour ports and airports have always had.
 * `key` is empty so the tally stays empty and no size legend is offered — a
 * legend for a channel nobody spends would be a promise about a mark that is
 * not on the map.
 */
const FLAT_RENDER_SPEC = Object.freeze({
  key: '',
  pixelSize: null,
  hollow: false,
  color: null,
  surface: null,
  fillAlpha: null,
  extrudedHeightM: null,
});

/**
 * Apply one render spec's SURFACE half to a Cesium polygon.
 *
 * Split out and exported so the three-line decision that turns a footprint
 * into either a volume or a flat slab is testable, and so the Cesium call
 * sequence is written once rather than inlined in a 200-line load loop.
 *
 * ── WHY `height = 0` IS SET EXPLICITLY ──────────────────────────────────────
 *
 * `GeoJsonDataSource.load({clampToGround: true})` leaves both `height` and
 * `heightReference` undefined, which makes the polygon a ground-classification
 * primitive. Extruding it needs the terrain-relative pair instead — and
 * Cesium's `GroundGeometryUpdater.getGeometryHeight()` emits a one-time
 * console warning and returns undefined if a `heightReference` arrives without
 * a `height` beside it. So the 0 is not decoration: it is what stops the
 * volume from being silently dropped.
 *
 * ── AND WHY THE FLAT SLAB IS FORCED MONOCHROME ──────────────────────────────
 *
 * A batched `GroundPrimitive` colours each instance by its bounding RECTANGLE,
 * not its polygon, so a per-feature ramp on this class bleeds across
 * neighbours. The class is NOT monochrome by construction — that was a claim
 * this header made and the data disproved: `datacenterRenderSpec` emits
 * `surface: 'flat'` for both the 2 739 halls and the 317 site outlines, in two
 * different colours, and a site outline encloses the halls it surrounds. So
 * the class takes ONE colour, declared by the pack as `surfaceColor`, and the
 * per-feature hue stays on the anchor mark, which is a point and outside the
 * batch. The richer fix — drawing a site outline as a clamped POLYLINE, which
 * is what a fence is — is left open; it needs a second geometry in this
 * loader, not a colour rule.
 *
 * ── WHAT THIS DOES NOT SOLVE ────────────────────────────────────────────────
 *
 * `RELATIVE_TO_GROUND` is relative to the GLOBE's terrain, not to a photoreal
 * tileset: over 3D Tiles a volume stands on the terrain surface and the mesh's
 * own roof stands wherever it was photographed, so the two interpenetrate.
 * Cesium's geometry updaters have no 3D-Tiles height reference — only
 * billboards and points do — and the alternative (sampling each footprint
 * against the tileset at load) would make 3 517 async samples a precondition
 * of drawing anything. The flat slabs this layer already drew have had the
 * same limit since they were clamped; the volume does not make it worse.
 *
 * @param {object|null} polygon Cesium PolygonGraphics.
 * @param {object|null} spec Render spec.
 * @param {object} color Cesium Color for this feature.
 * @returns {boolean} Whether anything was applied.
 */
export function applyLocalSurfaceStyle(polygon, spec, color) {
  if (!polygon || !spec || !spec.surface) return false;
  const extruded = Number(spec.extrudedHeightM);
  const isVolume = spec.surface === 'volume' && Number.isFinite(extruded) && extruded > 0;
  // A FLAT slab stays in the batched ground-classification pass, and that pass
  // colours each instance by its bounding RECTANGLE rather than its polygon.
  // Two colours in that class therefore bleed across neighbours — a site
  // outline (median 31 204 m²) encloses by construction the halls it surrounds
  // (median 5 008 m²), so its slate would paint them. `surfaceColor` is the
  // pack's ONE declared colour for the class; the per-feature hue stays on the
  // anchor mark, which is a point and not part of the batch. A volume
  // classifies nothing, so it keeps its own colour.
  const fillColor = !isVolume && spec.surfaceColor
    ? Cesium.Color.fromCssColorString(spec.surfaceColor)
    : color;
  polygon.fill = true;
  // Cesium force-disables an outline on a terrain-clamped polygon and warns
  // once; asking for one on a slab bought a console warning and nothing on
  // screen. Only the extruded volume can actually carry it.
  polygon.outline = isVolume;
  polygon.outlineColor = fillColor;
  const alpha = Number(spec.fillAlpha);
  polygon.material = new Cesium.ColorMaterialProperty(
    fillColor.withAlpha(Number.isFinite(alpha) ? alpha : 0.3),
  );
  if (!isVolume) return true;
  polygon.height = 0;
  polygon.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
  polygon.extrudedHeight = extruded;
  polygon.extrudedHeightReference = Cesium.HeightReference.RELATIVE_TO_GROUND;
  // An OSM outline is a shell, not a solid: the top face is what a reader
  // looks down on, the bottom is buried in the terrain it is clamped to.
  polygon.closeTop = true;
  polygon.closeBottom = false;
  return true;
}

/**
 * Footprint of one Cesium polygon hierarchy, in m².
 *
 * The adapter, and deliberately the ONLY Cesium-aware half of the measurement:
 * `geometryAreaM2()` in `datacentersPack.js` takes lon/lat rings and is unit
 * tested without a scene, so the arithmetic that decides whether a card claims
 * 21 022 m² or 2 033 401 m² is not locked behind a WebGL context.
 *
 * Cesium has already parsed the GeoJSON by the time a record is built, so the
 * source rings are gone; what remains is `PolygonHierarchy`, whose `positions`
 * are the shell and whose `holes` nest. Converting back costs one cartographic
 * per vertex over a pack that totals 46 596 of them, once, at load.
 *
 * @param {object|null|undefined} hierarchy Cesium PolygonHierarchy.
 * @returns {number} Area in m², 0 when the hierarchy is unusable.
 */
export function polygonHierarchyAreaM2(hierarchy) {
  const ring = (positions) => {
    if (!Array.isArray(positions) || positions.length < 3) return null;
    const out = [];
    for (const position of positions) {
      const carto = Cesium.Cartographic.fromCartesian(position);
      if (!carto) return null;
      out.push([
        Cesium.Math.toDegrees(carto.longitude),
        Cesium.Math.toDegrees(carto.latitude),
      ]);
    }
    return out;
  };
  const shell = ring(hierarchy?.positions);
  if (!shell) return 0;
  const rings = [shell];
  for (const hole of (Array.isArray(hierarchy?.holes) ? hierarchy.holes : [])) {
    const inner = ring(hole?.positions);
    if (inner) rings.push(inner);
  }
  return geometryAreaM2({ type: 'Polygon', coordinates: rings });
}

/**
 * Build the validated local-infrastructure card copy.
 * @param {object} properties Unwrapped GeoJSON feature properties.
 * @param {string} layerId Local layer id.
 * @param {{areaM2?: number}} [measured] Facts derived from the GEOMETRY rather
 *   than the tags. Only the footprint so far, and only the datacenter pack
 *   reads it: the size of a hall is the most discriminating thing that pack
 *   holds and the only one no tag carries.
 * @returns {{title:string,details:string[]}}
 */
export function localInfrastructureOverlayCopy(properties, layerId, measured = {}) {
  const props = unwrapProperties(properties) || {};
  const tags = props.tags || {};
  const title = featureLabelFromProperties(props, layerId);
  const details = [];

  if (layerId === 'local-datacenters') {
    // Owned by `datacentersPack.js` now, for the same reason as the dam and
    // airport packs below. What it replaced read an operator plus a capacity
    // chain that matches THREE features in a 4 351-feature pack, so 55.8% of
    // these cards rendered as a bare title.
    for (const line of datacenterCardDetails(props, { areaM2: measured?.areaM2 })) {
      details.push(clampCardLine(line));
    }
  } else if (layerId === 'local-dams') {
    // The dam pack owns its own copy, like the airport pack below: the module
    // that decides what the build emits also writes the lines, so a dropped
    // field is a failing test rather than a blank line. The host still owns the
    // width, hence the clamp on the way out.
    for (const line of damCardDetails(props)) details.push(clampCardLine(line));
  } else if (layerId === 'local-ports') {
    // Harbor size and type come pre-decoded from the build script; a port
    // whose WPI row coded them 'U' simply has no line here.
    const shape = [props.harborSize, props.harborType]
      .map(cleanLabel)
      .filter(Boolean)
      .join(' · ');
    if (shape) details.push(clampCardLine(shape));

    // WPI depths are binned range codes, not surveyed soundings, so the line
    // reads "~11 m channel" — never "11 m channel". See the note in
    // scripts/build-nga-ports.mjs before tightening this wording.
    const depths = props.approxDepthM || {};
    const channel = Number(depths.channel);
    if (Number.isFinite(channel)) {
      details.push(clampCardLine(`~${channel} m channel (approx.)`));
    }
  } else if (layerId === 'local-airports') {
    // The airport pack owns its own copy: the same module decides what the
    // build emits, so a dropped field cannot become a blank line here. The
    // host still owns the width, hence the clamp on the way out.
    for (const line of airportCardDetails(props)) details.push(clampCardLine(line));
  }

  return { title, details };
}

/**
 * Produce one normalized-contract input owned by a local infrastructure layer.
 * The host revalidates the authoritative `source` value while normalizing it.
 * @param {object} options
 * @param {string} options.id Stable id within the source.
 * @param {string} options.layerId Local layer id.
 * @param {Cesium.Cartesian3} options.position Current stem-tip position.
 * @param {object} options.properties Unwrapped feature properties.
 * @param {number} options.priority Source-owned importance score.
 * @param {string} options.accent Source accent color.
 * @param {number} [options.maxDistance] How far out the card may still be read.
 *   A GRADED pack shortens this for its lesser groups: at 260 km over
 *   Île-de-France the label grid was handing fifteen cells to aéroclubs and
 *   three to Roissy, Orly and Le Bourget — which inverts, on the one surface a
 *   reader actually reads, the ranking the dot sizes had just established.
 *   Priority alone cannot fix that: the arbiter awards cells LOCALLY, so a
 *   grass strip with no competition in its own cell always wins it. Range does
 *   fix it, because "you have to come closer to be told about this one" is the
 *   same statement as "this one matters less".
 * @returns {object}
 */
export function createLocalInfrastructureOverlayEntry({
  id,
  layerId,
  position,
  properties,
  priority,
  accent,
  areaM2 = 0,
  maxDistance = LOCAL_OVERLAY_MAX_DISTANCE_M,
}) {
  const copy = localInfrastructureOverlayCopy(properties, layerId, { areaM2 });
  const range = Number.isFinite(maxDistance) && maxDistance > 0
    ? maxDistance
    : LOCAL_OVERLAY_MAX_DISTANCE_M;
  return {
    id: String(id),
    source: layerId,
    position,
    variant: 'card',
    title: copy.title,
    details: copy.details,
    accent,
    priority,
    collisionGroup: 'ambient-card',
    zIndex: 30,
    interactive: false,
    minDistance: 0,
    maxDistance: range,
    // The fade has to start INSIDE the range it fades over. A short-range card
    // whose fade began at the shared 250 km would be born already faded out.
    distanceFadeStartRatio: range > LOCAL_OVERLAY_FADE_START_M
      ? LOCAL_OVERLAY_FADE_START_M / range
      : 0.5,
    distanceScale: {
      near: 250000,
      nearValue: 1,
      far: 9000000,
      farValue: 0.62,
    },
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    placement: 'above',
  };
}

/**
 * Retain a bounded screen-grid surplus for the host's final rectangle arbiter.
 * Two deterministic contenders per legacy grid cell preserve the old density
 * while giving the shared solver an alternative when the first card collides.
 * @param {object[]} records Local stem/entry records.
 * @param {object} options
 * @param {number} options.maxEntries Legacy source cap.
 * @param {number} options.gridPx Legacy screen grid size.
 * @param {number} options.width Viewport width in CSS pixels.
 * @param {number} options.height Viewport height in CSS pixels.
 * @param {function(object):({x:number,y:number}|null)} options.project Projection callback.
 * @param {number} [options.cohortLimit=Infinity] Host-safe materialization cap.
 * @returns {object[]} Bounded overlay entries for shared-host arbitration.
 */
export function selectLocalInfrastructureOverlayCohort(records, {
  maxEntries,
  gridPx,
  width,
  height,
  project,
  cohortLimit = Number.POSITIVE_INFINITY,
}) {
  const sourceCap = Math.max(0, Math.floor(Number(maxEntries) || 0));
  const materializationCap = Number.isFinite(Number(cohortLimit))
    ? Math.max(0, Math.floor(Number(cohortLimit)))
    : Number.POSITIVE_INFINITY;
  const cap = Math.min(sourceCap, materializationCap);
  const cellSize = Math.max(1, Number(gridPx) || 1);
  if (!Array.isArray(records) || records.length === 0 || cap === 0 || typeof project !== 'function') {
    return [];
  }

  const cells = new Map();
  const padding = cellSize;
  for (const record of records) {
    const screen = project(record);
    if (!Number.isFinite(screen?.x) || !Number.isFinite(screen?.y)) continue;
    if (screen.x < -padding || screen.x > width + padding
      || screen.y < -padding || screen.y > height + padding) continue;
    const key = `${Math.floor(screen.x / cellSize)}:${Math.floor(screen.y / cellSize)}`;
    let contenders = cells.get(key);
    if (!contenders) {
      contenders = [];
      cells.set(key, contenders);
    }
    insertLocalCellContender(contenders, record);
  }

  const primary = [];
  const surplus = [];
  for (const contenders of cells.values()) {
    if (contenders[0]) primary.push(contenders[0]);
    if (contenders[1]) surplus.push(contenders[1]);
  }
  primary.sort(compareLocalOverlayRecords);
  surplus.sort(compareLocalOverlayRecords);
  if (primary.length >= cap) return primary.slice(0, cap).map((record) => record.entry);
  const candidates = primary.concat(surplus.slice(0, cap - primary.length));
  return candidates.map((record) => record.entry);
}

/**
 * Bind a local layer's visibility and entry lifecycle to the shared host.
 * @param {object} options
 * @param {string} options.sourceId Local layer id.
 * @param {object} [options.host] Test seam for the three host lifecycle calls.
 * @returns {{show:function():void,publish:function(object[]):void,hide:function():void,destroy:function():void}}
 */
export function createLocalInfrastructureOverlayPublisher({
  sourceId,
  host = DEFAULT_OVERLAY_HOST,
}) {
  let visible = false;
  let published = false;
  let destroyed = false;
  const sourceOptions = {
    cohortLimit: LOCAL_OVERLAY_COHORT_LIMIT,
    collisionCapacity: LOCAL_OVERLAY_COLLISION_CAPACITY,
    moving: false,
  };

  return {
    show() {
      if (destroyed || visible) return;
      visible = true;
      host.setVisible(sourceId, true);
    },
    publish(entries) {
      if (destroyed || !visible) return;
      host.setEntries(sourceId, entries, sourceOptions);
      published = entries.length > 0;
    },
    hide() {
      if (destroyed) return;
      if (published) host.clearSource(sourceId);
      if (visible) host.setVisible(sourceId, false);
      visible = false;
      published = false;
    },
    destroy() {
      if (destroyed) return;
      if (published) host.clearSource(sourceId);
      if (visible) host.setVisible(sourceId, false);
      visible = false;
      published = false;
      destroyed = true;
    },
  };
}

/**
 * Reduce a bundled-dataset load failure to one short, honest stats string.
 *
 * These layers ship their data with the build, so a failure means the asset
 * is missing (404 / bad path) or corrupt — never "the network is slow". Both
 * must reach the user's chip; the raw parser message is console-only because
 * a truncated JSON blob is not a status line.
 *
 * @param {Error|{name?:string, message?:string}|null|undefined} error - The thrown load failure.
 * @returns {string} Short reason for getStats().error.
 */
export function localDatasetError(error) {
  if (error?.name === 'SyntaxError') return 'dataset is malformed';
  const message = String(error?.message || '').trim();
  return message ? `dataset unavailable (${message})` : 'dataset unavailable';
}

/**
 * A minimal, rock-solid native implementation for loading local GeoJSON Data.
 * Draws 3D stems (polylines) attached to Point entities and ensures
 * standard scene.pick natively clicks them.
 */
export function createLocalGeoJsonLayer({
  id,
  url,
  name,
  color,
  icon = '📍',
  source = 'Local JSONL',
  labels = true,
  labelMax = DEFAULT_LABEL_MAX,
  labelGridPx = DEFAULT_LABEL_GRID_PX,
  overlayHost = DEFAULT_OVERLAY_HOST,
  screenSpaceEventHandlerFactory = (canvas) => new Cesium.ScreenSpaceEventHandler(canvas),
  projectToWindow = (scene, position) => Cesium.SceneTransforms.worldToWindowCoordinates(scene, position),
  /*
   * ── OPTIONAL: GRADED DATASETS ──────────────────────────────────────────
   *
   * A pack whose features are NOT all equally important can classify them into
   * groups and let the group drive three things at once: how the marker is
   * drawn, whether it is drawn at all, and what the row's legend says. Airports
   * are the first caller — seven thousand identical dots is a wall, not a map —
   * but nothing here is airport-specific, and ports could grade by harbour size
   * tomorrow without touching this function again.
   *
   * All five default to the flat behaviour the other bundled layers already
   * have: one colour, one size, everything visible, no row controls. In
   * particular `getRowControls` is only ATTACHED when `rowControls` is passed,
   * because the manager tests for the method's existence to decide whether to
   * build the row's control strip at all.
   */
  /** @type {(props:object)=>(string|null)} Classify a feature into a group key. */
  groupOf = null,
  /** @type {Record<string,{color?:string,pixelSize?:number,stemWidth?:number}>} Per-group styling. */
  groupStyles = null,
  /** @type {(groupKey:string, params:object)=>boolean} Whether a group is drawn. */
  groupVisible = null,
  /** @type {object} Initial runtime params (never share-link state). */
  defaultParams = null,
  /** @type {(params:object, tally:Map<string,{total:number,visible:number}>)=>object} Row chips + legend. */
  rowControls = null,
  /*
   * ── OPTIONAL: MEASURED PACKS ───────────────────────────────────────────
   *
   * A pack that holds a MEASUREMENT — not a class — spends the size channel
   * per feature instead of per group. See "THE RENDER SPEC" above for the
   * contract, and `datacentersPack.js` / `damsPack.js` for the two callers.
   *
   * Both default to the pack's own resolver, keyed by layer id in
   * `PACK_RENDERERS`, for the same reason `localInfrastructureOverlayCopy`
   * and `namelessTitle` branch on the id right here: the wiring file passes
   * data, and what a pack's marks CLAIM is not the wiring file's business.
   * Passing them explicitly overrides the table, which is how the tests get
   * at this without a bundled dataset.
   */
  /** @type {(props:object, measured:{areaM2:number})=>(object|null)} Per-feature marks. */
  featureRender = null,
  /** @type {(tally:Map<string,{total:number,visible:number}>)=>Array<object>} Size legend. */
  renderLegend = null,
}) {
  const resolveRenderSpec = featureRender || PACK_RENDERERS[id]?.featureRender || null;
  const resolveRenderLegend = renderLegend || PACK_RENDERERS[id]?.renderLegend || null;
  let _dataSource = null;
  let _enabled = false;
  let _clickHandler = null;
  let _count = 0;
  /** Runtime params owned by the row chips. Cloned so the caller's literal is safe. */
  let _params = { ...(defaultParams || {}) };
  /** @type {Map<string,{total:number, visible:number}>} Per-group counts, drawn vs loaded. */
  const _groupTally = new Map();
  /**
   * Per-render-spec counts, drawn vs loaded — the size legend's source.
   * Kept apart from `_groupTally` because the two answer different questions
   * and a pack may spend one channel without spending the other.
   * @type {Map<string,{total:number, visible:number}>}
   */
  const _renderTally = new Map();
  /** @type {(()=>void)|null} Panel repaint hook, installed by the manager. */
  let _rowControlsListener = null;
  /** @type {number|null} Timestamp of the last successful dataset load. */
  let _lastUpdate = null;
  /** @type {string|null} Short reason the bundled dataset failed to load. */
  let _error = null;
  let _preRenderRemover = null;
  let _cameraMoveEndRemover = null;
  let _stemRecords = [];
  let _stemGeometryDirty = true;
  let _lastVisibilityUpdate = 0;
  let _destroyed = false;
  let _groundRetryTimer = null;
  /** Consecutive self-armed retries since the last grounding/camera motion. */
  let _groundRetryArms = 0;
  /** Last observed scene.sampleHeightSupported; null until the first walk. */
  let _lastGroundSampleCapability = null;

  /**
   * Coalesced one-shot: ask the governor for a frame once the retry window
   * has elapsed, so the preRender ground-sample retry actually runs while the
   * camera is parked. One timer for the whole layer (not per record) — the
   * retry pass walks every record anyway. (perf rebase 2026-08-17)
   *
   * Two gates keep this from becoming an idle leak (second review):
   *   - CAPABILITY: without `scene.sampleHeightSupported` the sample can never
   *     succeed, so a timer here would re-arm on every requested frame,
   *     forever. Records simply stay at ellipsoid height — exactly the
   *     pre-perf keyless behavior.
   *   - BUDGET: sampling can be supported and still keep failing (no sampleable
   *     surface yet/ever). Give up after GROUND_SAMPLE_MAX_ARMED_RETRIES
   *     consecutive arms; free camera-motion frames still retry.
   * @param {Cesium.Viewer} viewer
   * @returns {void}
   */
  function scheduleGroundRetryRender(viewer) {
    if (_groundRetryTimer || !_enabled) return;
    if (!viewer?.scene?.sampleHeightSupported) return;
    if (_groundRetryArms >= GROUND_SAMPLE_MAX_ARMED_RETRIES) return;
    _groundRetryArms += 1;
    _groundRetryTimer = setTimeout(() => {
      _groundRetryTimer = null;
      if (!_enabled || _destroyed) return;
      governorRequestRender(`local-ground-retry:${id}`);
    }, GROUND_SAMPLE_RETRY_MS);
  }

  function clearGroundRetryRender() {
    _groundRetryArms = 0;
    _lastGroundSampleCapability = null;
    if (!_groundRetryTimer) return;
    clearTimeout(_groundRetryTimer);
    _groundRetryTimer = null;
  }

  /**
   * Re-decide which groups are drawn under the current params, and refresh the
   * per-group tally the legend reads.
   *
   * The record keeps `filteredOut` rather than writing `entity.show` here: the
   * pre-render walk owns `show` — it is also where horizon occlusion lands — so
   * two writers would fight, and a filtered marker would flicker back on the
   * next camera move. Ungraded layers exit on the first line and pay nothing.
   * @returns {void}
   */
  function applyGroupFilter() {
    const graded = typeof groupOf === 'function';
    // An ungraded pack that spends no size channel either has nothing to
    // recount, and must keep paying nothing for the walk.
    if (!graded && _renderTally.size === 0) return;
    for (const bucket of _groupTally.values()) bucket.visible = 0;
    for (const bucket of _renderTally.values()) bucket.visible = 0;
    const allow = graded && typeof groupVisible === 'function' ? groupVisible : null;
    for (const record of _stemRecords) {
      const visible = !allow || !record.groupKey || allow(record.groupKey, _params) === true;
      record.filteredOut = !visible;
      if (!visible) continue;
      if (record.groupKey) {
        const bucket = _groupTally.get(record.groupKey);
        if (bucket) bucket.visible += 1;
      }
      if (record.renderKey) {
        const bucket = _renderTally.get(record.renderKey);
        if (bucket) bucket.visible += 1;
      }
    }
  }
  const _overlayPublisher = createLocalInfrastructureOverlayPublisher({
    sourceId: id,
    host: overlayHost,
  });

  const disableLayer = (viewer) => {
    _enabled = false;
    clearGroundRetryRender();
    if (_dataSource) _dataSource.show = false;
    _overlayPublisher.hide();
    clearSelectedEntityContextForLayer(id);
    if (viewer?.selectedEntity?.__localLayerId === id) {
      viewer.selectedEntity = undefined;
    }
    if (_preRenderRemover) {
      _preRenderRemover();
      _preRenderRemover = null;
    }
    if (_cameraMoveEndRemover) {
      _cameraMoveEndRemover();
      _cameraMoveEndRemover = null;
    }
  };

  return {
    id,
    name,
    icon,
    source,
    updateInterval: 0,
    statsRefreshInterval: 1000,

    init: async (viewer) => {
      // DataLayerManager calls this once
    },
    
    update: async (viewer) => {
      // DataLayerManager calls this when enabled
    },
    
    /**
     * @returns {{count:number, lastUpdate:number|null, error:string|null}}
     *   A dead layer must be distinguishable from an empty one: a failed load
     *   surfaces `error` (manager chip → UNAVAILABLE) instead of reporting a
     *   silent zero count as nominal.
     */
    getStats: () => {
      return { count: _count, lastUpdate: _lastUpdate, error: _error };
    },

    // ── Row chips (graded packs only) ─────────────────────────────────────
    // Attached conditionally: the manager treats `setParams` as a layer's
    // whole runtime-parameter surface (share links and the voice tools reach
    // for it), so a pack with no chips must not advertise one. `getRowControls`
    // is attached separately below, because a measured pack has a legend to
    // publish and nothing to filter.
    ...(rowControls ? {
      /**
       * Apply a row chip's params. `count` in `getStats()` deliberately does
       * NOT move: the pack always ships whole, and a floor hides markers
       * without losing them — same contract as the hydro layer's `floorKw`.
       * @param {object} [params] Partial params to merge.
       * @returns {boolean} Whether anything actually changed.
       */
      setParams(params = {}) {
        const next = { ..._params, ...(params || {}) };
        const changed = Object.keys(next).some((key) => next[key] !== _params[key]);
        if (!changed) return false;
        _params = next;
        applyGroupFilter();
        // The walk is throttled to VISIBILITY_UPDATE_MS and the governor is in
        // requestRenderMode, so without both of these the chip would appear to
        // do nothing for up to half a second on a parked camera.
        _lastVisibilityUpdate = Number.NEGATIVE_INFINITY;
        governorRequestRender(`local-group-filter:${id}`);
        _rowControlsListener?.();
        return true;
      },

      setRowControlsListener(listener) {
        _rowControlsListener = typeof listener === 'function' ? listener : null;
      },

    } : {}),

    // ── Row legend (graded OR measured packs) ─────────────────────────────
    // The manager decides whether to build a row's control strip by testing
    // for this method, so ports and airports — which spend neither channel —
    // still get no strip at all. A pack that spends the SIZE channel qualifies
    // on its legend alone: D1 makes a legend mandatory wherever a mark carries
    // a value, and a size with no printed scale is exactly the case D1 is
    // about.
    ...((rowControls || resolveRenderLegend) ? {
      /**
       * The row's chips and legend.
       *
       * Two producers, one array: the pack's own `rowControls` first (what the
       * features ARE, and the chips that filter them), then the size legend
       * (how big they are). The order is the reading order — a reader asks
       * what before how much — and both halves count what is DRAWN, so a chip
       * that hides four fifths of the pack empties both.
       * @returns {{chips?:Array<object>, legend?:Array<object>}|null}
       */
      getRowControls() {
        const base = rowControls ? (rowControls(_params, _groupTally) || null) : null;
        const sizeRows = resolveRenderLegend ? (resolveRenderLegend(_renderTally) || []) : [];
        if (!base && sizeRows.length === 0) return null;
        return { ...(base || {}), legend: [...(base?.legend || []), ...sizeRows] };
      },
    } : {}),

    enable: async (viewer) => {
      if (_destroyed) return;
      _enabled = true;
      _stemGeometryDirty = true;
      _lastVisibilityUpdate = Number.NEGATIVE_INFINITY;
      _groundRetryArms = 0; // fresh give-up budget per enable-cycle
      _lastGroundSampleCapability = null;
      _overlayPublisher.show();

      // 1. Initialize data source
      if (!_dataSource) {
        const baseColor = Cesium.Color.fromCssColorString(color);

        // Fetch and parse JSON Lines (.geojsonl) into a FeatureCollection.
        // The source is built into a local and committed to `_dataSource`
        // only once setup finishes: a half-built source published early would
        // make every later enable() skip this block, so the layer could never
        // clear its error or retry.
        _error = null;
        let loaded = null;
        // Whether the scene has actually accepted `loaded` — the two rollback
        // windows (before vs after the add settles) need different cleanup.
        let addedToScene = false;
        try {
          const response = await fetch(url);
          // A 404 returns an HTML body that would otherwise die in JSON.parse
          // one line later, reported as a parse error for a missing file.
          if (!response.ok) {
            throw new Error(`HTTP ${response.status ?? '?'}`);
          }
          const text = await response.text();
          const lines = text.split('\n').filter(l => l.trim().length > 0);
          
          const features = lines.map(line => JSON.parse(line));
          
          const geojson = {
            type: 'FeatureCollection',
            features
          };

          // Natively parse into entities and use it as our _dataSource
          loaded = await Cesium.GeoJsonDataSource.load(geojson, {
            clampToGround: true,
            stroke: baseColor,
            fill: baseColor.withAlpha(0.3),
            strokeWidth: 2,
            markerSize: 8,
            markerColor: baseColor,
          });

          loaded.name = name;
          loaded.show = false;
          // Cesium's DataSourceCollection.add() returns a promise and only
          // inserts on a later microtask. Without this await, a throw during
          // post-processing would roll back a source the scene had not
          // accepted yet — and Cesium would then insert the "removed" source
          // anyway, leaving an orphan the retry would double up on. Awaiting
          // also routes an add() rejection into the error path below instead
          // of leaving it uncaught with healthy-looking stats.
          await viewer.dataSources.add(loaded);
          addedToScene = true;

          // Convert parsed points into 3D stems or style polygons
          const entities = loaded.entities.values;
          _count = entities.length;
          _stemRecords = [];
          // Rebuilt from scratch below; a retry after a failed load must not
          // inherit the counts of the attempt that died.
          _groupTally.clear();
          _renderTally.clear();
          _stemGeometryDirty = true;
          
          for (let i = 0; i < entities.length; i++) {
            const feature = entities[i];
            feature.__localLayerId = id; // Tag it so our click handler knows it belongs to this layer
            
            let pos = feature.position?.getValue(Cesium.JulianDate.now());
            
            // Footprint, measured off the same hierarchy the stem anchor is
            // read from — 0 for the 834 point features, which then simply get
            // no size line. See `datacentersPack.js` for why the number alone
            // is not enough and the `building` tag decides how it is worded.
            let areaM2 = 0;
            if (!pos) {
              // It's a polygon or line
              if (feature.polygon) {
                feature.polygon.outline = true;
                feature.polygon.outlineColor = baseColor;
                
                // Calculate center point for the stem
                const hierarchy = feature.polygon.hierarchy?.getValue(Cesium.JulianDate.now());
                if (hierarchy && hierarchy.positions && hierarchy.positions.length > 0) {
                  pos = Cesium.BoundingSphere.fromPoints(hierarchy.positions).center;
                  // The one walk that pays for the whole size channel: 46 596
                  // vertices over the datacenter pack, once, at load.
                  areaM2 = polygonHierarchyAreaM2(hierarchy);
                }
              }
            }

            if (!pos) continue;

            const carto = Cesium.Cartographic.fromCartesian(pos);
            const groundHeight = 0; // Ellipsoid surface until a scene sample lands
            const tipHeight = 2000; // Initial Stem height

            const base = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, groundHeight);
            const tip = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, tipHeight);
            const properties = propertyObject(feature);
            const recordId = String(feature.id ?? i);

            // Store references for bounded stem scaling and native picking.
            feature.__localBaseCarto = carto;
            feature.__localBaseCartesian = base;
            registerEntityContext(feature, {
              id: `${id}:${recordId}`,
              layerId: id,
              layerName: name,
              source,
              dataSource: loaded,
              label: featureLabelFromProperties(properties, id),
              properties,
              latitude: Number(Cesium.Math.toDegrees(carto.latitude).toFixed(6)),
              longitude: Number(Cesium.Math.toDegrees(carto.longitude).toFixed(6)),
            });

            // Constant properties are refreshed on the existing 450 ms source
            // cadence. Cesium no longer evaluates 2-3 callbacks per entity on
            // every frame, while the point/stem pick surface stays native.
            feature.position = tip;
            // A graded pack styles per group; a flat one falls through to the
            // single layer colour and the historical 10 px / 3.5 px geometry.
            const groupKey = typeof groupOf === 'function' ? (groupOf(properties) || null) : null;
            const groupStyle = (groupKey && groupStyles?.[groupKey]) || null;
            // Per-feature marks, resolved once. A pack that declares none gets
            // FLAT_RENDER_SPEC and the historical 10 px / 3.5 px geometry.
            const renderSpec = (resolveRenderSpec
              && resolveRenderSpec(properties, { areaM2 })) || FLAT_RENDER_SPEC;
            const markerCss = renderSpec.color || groupStyle?.color || null;
            const markerColor = markerCss
              ? Cesium.Color.fromCssColorString(markerCss)
              : baseColor;
            const accent = markerCss || color;
            const stemPositionBuffers = [[base, tip], [base, tip]];
            feature.polyline = new Cesium.PolylineGraphics({
              positions: stemPositionBuffers[0],
              width: groupStyle?.stemWidth ?? 3.5,
              material: new Cesium.ColorMaterialProperty(markerColor),
            });
            feature.point = new Cesium.PointGraphics({
              pixelSize: renderSpec.pixelSize ?? groupStyle?.pixelSize ?? 10,
              // A1, drawn: a HOLLOW ring is a feature whose measurement was
              // never published, and it must not be reachable by any value of
              // a measured one — hence a transparent centre, not a small disc.
              color: renderSpec.hollow ? Cesium.Color.TRANSPARENT : markerColor,
              outlineColor: renderSpec.hollow ? markerColor : Cesium.Color.BLACK,
              outlineWidth: 2,
              // Never depth-cull the anchor against the photoreal mesh —
              // globe-horizon culling is handled by the pre-render occluder.
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            });
            applyLocalSurfaceStyle(feature.polygon, renderSpec, markerColor);

            if (groupKey) {
              const bucket = _groupTally.get(groupKey);
              if (bucket) bucket.total += 1;
              else _groupTally.set(groupKey, { total: 1, visible: 0 });
            }
            if (renderSpec.key) {
              const bucket = _renderTally.get(renderSpec.key);
              if (bucket) bucket.total += 1;
              else _renderTally.set(renderSpec.key, { total: 1, visible: 0 });
            }

            const priority = labelPriorityFromProperties(properties, id);
            _stemRecords.push({
              id: recordId,
              entity: feature,
              carto,
              base,
              tip,
              nextTip: Cesium.Cartesian3.clone(tip),
              stemPositionBuffers,
              stemPositionBufferIndex: 0,
              groundHeight,
              groundSampled: false,
              lastGroundSampleMs: 0,
              priority,
              groupKey,
              /** Size-legend bucket, '' for a pack that spends no size channel. */
              renderKey: renderSpec.key || '',
              /** Hidden by a row-chip display floor — NOT by the horizon occluder. */
              filteredOut: false,
              entry: labels ? createLocalInfrastructureOverlayEntry({
                id: recordId,
                layerId: id,
                position: tip,
                properties,
                priority,
                accent,
                areaM2,
                maxDistance: groupStyle?.cardMaxDistance,
              }) : null,
            });
          }
          applyGroupFilter();
          // Setup finished — publish it.
          _dataSource = loaded;
          _lastUpdate = Date.now();
        } catch (e) {
          // The dataset ships with the build, so this is a broken install,
          // not a blip — it has to reach the chip, not just the console.
          _error = localDatasetError(e);
          // Roll the partial build back so a later enable() retries from
          // scratch instead of inheriting a half-populated source. Only the
          // post-add window has something in the scene to remove: a failure
          // before (or inside) add() never reached the collection, and
          // removing then would race Cesium's pending insert.
          if (addedToScene) {
            try { viewer?.dataSources?.remove(loaded, true); } catch { /* already gone */ }
          }
          _count = 0;
          _stemRecords = [];
          _groupTally.clear();
          _renderTally.clear();
          console.error(`Failed to load ${id}:`, e);
        }

        // 2. Install native global click handler
        if (!_clickHandler) {
          _clickHandler = screenSpaceEventHandlerFactory(viewer.scene.canvas);
          _clickHandler.setInputAction((click) => {
            if (!_enabled) return;
            const picked = viewer.scene.pick(click.position);
            
            if (picked && picked.id && picked.id.__localLayerId === id) {
              const entity = picked.id;
              viewer.selectedEntity = entity;
              selectEntityContext(entity);
              
              // We zoom to the surface base of the stem or the center of the polygon
              let targetPos = null;
              
              if (entity.polyline) {
                // If it's a stem, fly to the base
                const positions = entity.polyline.positions.getValue(Cesium.JulianDate.now());
                if (positions && positions.length > 0) {
                  targetPos = positions[0];
                }
              } else if (entity.polygon && entity.polygon.hierarchy) {
                // If it's a polygon, just fly to its center
                const hierarchy = entity.polygon.hierarchy.getValue(Cesium.JulianDate.now());
                if (hierarchy && hierarchy.positions.length > 0) {
                  targetPos = Cesium.BoundingSphere.fromPoints(hierarchy.positions).center;
                }
              }
              
              if (targetPos) {
                const carto = Cesium.Cartographic.fromCartesian(targetPos);
                
                // Disable interactions so Cesium doesn't magically cancel the flight
                viewer.scene.screenSpaceCameraController.enableInputs = false;
                
                viewer.camera.flyTo({
                  destination: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 5000),
                  duration: 1.5,
                  complete: () => { viewer.scene.screenSpaceCameraController.enableInputs = true; },
                  cancel: () => { viewer.scene.screenSpaceCameraController.enableInputs = true; },
                });
              }
            }
          }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        }
      }

      // 3. Add an incredibly fast pre-render occluder to hide points behind the globe
      if (_enabled && !_preRenderRemover) {
        _preRenderRemover = viewer.scene.preRender.addEventListener(() => {
          if (!_enabled || !_dataSource) return;
          const now = performance.now();
          if (now - _lastVisibilityUpdate < VISIBILITY_UPDATE_MS) return;
          _lastVisibilityUpdate = now;

          const cameraPos = viewer.camera.positionWC;
          if (!cameraPos) return;
          
          const occluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, cameraPos);
          const visibleOverlayRecords = [];
          const refreshStemGeometry = _stemGeometryDirty;
          
          // A scene that cannot sample heights can never ground a record, so it
          // must never arm a retry (the arm would re-arm on every requested
          // frame, forever) and must not spend ANY per-record work trying.
          // Read once per walk, not per record.
          const canSampleGround = viewer.scene.sampleHeightSupported === true;
          // Capability can arrive late (WebGL context restore, a tileset that
          // finally supports sampling). A parked camera has no moveEnd to
          // re-open a spent budget, so the false→true edge does it.
          if (canSampleGround && _lastGroundSampleCapability === false) _groundRetryArms = 0;
          _lastGroundSampleCapability = canSampleGround;
          let groundRetryPending = false;
          let groundSampleProgress = false;
          for (let i = 0; i < _stemRecords.length; i++) {
            const record = _stemRecords[i];
            const wasGroundSampled = record.groundSampled;
            if (refreshStemGeometry) {
              updateLocalStemGeometry(viewer, record, now);
            } else if (canSampleGround && !record.groundSampled
              && now - record.lastGroundSampleMs >= GROUND_SAMPLE_RETRY_MS) {
              // Capability first: without it the distance below is pure waste,
              // once per ungrounded record per walk, forever.
              const distance = Cesium.Cartesian3.distance(viewer.camera.positionWC, record.base);
              if (distance < GROUND_SAMPLE_MAX_DISTANCE_M
                && sampleLocalGroundHeight(viewer, record, now)) {
                updateLocalStemGeometry(viewer, record, now, distance);
              }
            }
            if (!wasGroundSampled && record.groundSampled) groundSampleProgress = true;
            // Still unsampled AND close enough for a retry to succeed: this
            // layer has no hold and no periodic update, so under the idle
            // governor the retry's preRender never arrives on a parked camera
            // and the stem stays at ellipsoid height (buried/floating) until
            // the user happens to move. Schedule the frame the retry needs.
            // Gated on a sampleable scene and in-range records only, so a far
            // camera (or a keyless scene) stays fully idle; the distance is
            // only computed for still-unsampled stems.
            if (canSampleGround && !record.groundSampled && !groundRetryPending
              && Cesium.Cartesian3.distance(viewer.camera.positionWC, record.base)
                < GROUND_SAMPLE_MAX_DISTANCE_M) {
              groundRetryPending = true;
            }
            // Two independent reasons to be invisible: over the horizon, or
            // below the row's display floor. Both must clear before a marker —
            // or its ambient card — reaches the screen.
            const isVisible = !record.filteredOut && occluder.isPointVisible(record.base);
            if (record.entity.show !== isVisible) record.entity.show = isVisible;
            if (isVisible && record.entry) visibleOverlayRecords.push(record);
          }
          _stemGeometryDirty = false;
          // Tiles ARE streaming in: real progress re-opens the give-up budget
          // so the records still waiting get their own bounded run of retries.
          if (groundSampleProgress) _groundRetryArms = 0;
          if (groundRetryPending) scheduleGroundRetryRender(viewer);

          const canvas = viewer.scene.canvas;
          const cohort = selectLocalInfrastructureOverlayCohort(visibleOverlayRecords, {
            maxEntries: labelMax,
            gridPx: labelGridPx,
            width: canvas.clientWidth || canvas.width || 0,
            height: canvas.clientHeight || canvas.height || 0,
            cohortLimit: LOCAL_OVERLAY_COHORT_LIMIT,
            project: (record) => projectToWindow(viewer.scene, record.tip),
          });
          _overlayPublisher.publish(cohort);
        });
      }
      if (_enabled && !_cameraMoveEndRemover) {
        _cameraMoveEndRemover = viewer.camera.moveEnd.addEventListener(() => {
          if (!_enabled) return;
          _stemGeometryDirty = true;
          _lastVisibilityUpdate = Number.NEGATIVE_INFINITY;
          // Real camera motion is a fresh situation (new tiles, new distances)
          // and its frames are free, so it re-opens the retry budget that a
          // parked camera may have spent.
          _groundRetryArms = 0;
          viewer.scene.requestRender?.();
        });
      }

      // Honor a disable() that landed while we were awaiting the fetch/parse:
      // disable() runs before _dataSource exists, so its show=false is a no-op —
      // reading _enabled here (rather than forcing true) respects the toggle-off.
      if (_dataSource) _dataSource.show = _enabled;
      viewer.scene.requestRender?.();
    },

    disable: disableLayer,

    destroy: (viewer) => {
      if (_destroyed) return;
      _destroyed = true;
      // Defensively disable first so listeners and selection state are
      // torn down even if destroy is called while the layer is enabled.
      disableLayer(viewer);
      if (_clickHandler) {
        _clickHandler.destroy();
        _clickHandler = null;
      }
      if (_dataSource && viewer) {
        viewer.dataSources.remove(_dataSource, true);
      }
      _overlayPublisher.destroy();
      _dataSource = null;
      _stemRecords = [];
      _groupTally.clear();
      _renderTally.clear();
      _count = 0;
      _lastUpdate = null;
      _error = null;
    }
  };
}

function compareLocalOverlayRecords(a, b) {
  return b.priority - a.priority || String(a.id).localeCompare(String(b.id));
}

function insertLocalCellContender(contenders, record) {
  let index = 0;
  while (index < contenders.length && compareLocalOverlayRecords(contenders[index], record) <= 0) {
    index++;
  }
  contenders.splice(index, 0, record);
  if (contenders.length > LOCAL_OVERLAY_CELL_SURPLUS) contenders.length = LOCAL_OVERLAY_CELL_SURPLUS;
}

function sampleLocalGroundHeight(viewer, record, now) {
  if (record.groundSampled || !viewer.scene.sampleHeightSupported) return false;
  if (now - record.lastGroundSampleMs < GROUND_SAMPLE_RETRY_MS) return false;
  record.lastGroundSampleMs = now;
  let sampled;
  try {
    sampled = viewer.scene.sampleHeight(record.carto, [record.entity]);
  } catch {
    return false; // tiles not ready; retry on a later bounded update
  }
  if (!Number.isFinite(sampled) || Math.abs(sampled) > GROUND_SAMPLE_MAX_ABS_HEIGHT_M) return false;
  record.groundSampled = true;
  record.groundHeight = sampled;
  Cesium.Cartesian3.fromRadians(
    record.carto.longitude,
    record.carto.latitude,
    record.groundHeight,
    Cesium.Ellipsoid.WGS84,
    record.base,
  );
  record.entity.__localBaseCartesian = record.base;
  return true;
}

function updateLocalStemGeometry(viewer, record, now, knownDistance = null) {
  const distance = Number.isFinite(knownDistance)
    ? knownDistance
    : Cesium.Cartesian3.distance(viewer.camera.positionWC, record.base);
  if (distance < GROUND_SAMPLE_MAX_DISTANCE_M) sampleLocalGroundHeight(viewer, record, now);
  const effectiveDistance = Math.max(distance, 5000);
  const canvasHeight = viewer.scene.canvas.clientHeight || 1080;
  const fov = viewer.camera.frustum.fov || (Math.PI / 3);
  const targetPx = 65;
  const fovFactor = 2 * Math.tan(fov / 2) * (targetPx / canvasHeight);
  const tipHeight = record.groundHeight + effectiveDistance * fovFactor;
  Cesium.Cartesian3.fromRadians(
    record.carto.longitude,
    record.carto.latitude,
    tipHeight,
    Cesium.Ellipsoid.WGS84,
    record.nextTip,
  );
  if (Cesium.Cartesian3.distanceSquared(record.tip, record.nextTip) <= LOCAL_STEM_TIP_EPSILON_SQ) {
    return false;
  }
  Cesium.Cartesian3.clone(record.nextTip, record.tip);
  record.stemPositionBufferIndex = 1 - record.stemPositionBufferIndex;
  const stemPositions = record.stemPositionBuffers[record.stemPositionBufferIndex];
  stemPositions[0] = record.base;
  stemPositions[1] = record.tip;
  record.entity.position.setValue(record.tip);
  record.entity.polyline.positions.setValue(stemPositions);
  return true;
}

function featureLabelFromProperties(props, layerId) {
  const tags = props.tags || {};

  const candidates = [
    props.name,
    tags.name,
    tags['name:en'],
    tags.official_name,
    tags.operator,
    tags['operator:short'],
    props.operator,
    props.output ? `${layerTitle(layerId)} ${props.output}` : '',
    props.osm_id ? `${layerTitle(layerId)} ${props.osm_id}` : '',
  ];

  const text = candidates.map(cleanLabel).find(Boolean);
  return clampLabel(text || namelessTitle(props, layerId));
}

/**
 * What a feature with no name of its own is called.
 *
 * The layer's title is the right answer only for a pack whose features are all
 * one thing. A GRADED pack that already knows what each feature IS answers per
 * feature instead, or its own classification stops at the card border — see
 * `damStructureTitle` in ./damsPack.js.
 *
 * @param {object} props Unwrapped feature properties.
 * @param {string} layerId Local layer id.
 * @returns {string} Title for a nameless feature.
 */
function namelessTitle(props, layerId) {
  if (layerId === 'local-dams') return damStructureTitle(props);
  return layerTitle(layerId);
}

function labelPriorityFromProperties(props, layerId) {
  const tags = props.tags || {};

  let score = 0;
  if (cleanLabel(props.name) || cleanLabel(tags.name)) score += 1000;
  if (cleanLabel(tags['name:en'])) score += 700;
  if (cleanLabel(tags.operator) || cleanLabel(props.operator)) score += 180;
  if (props.output || tags['plant:output:electricity']) score += 120;
  if (layerId === 'local-datacenters') score += 60;
  // Large harbours outrank very small ones when the label grid is crowded.
  if (layerId === 'local-ports') {
    score += 70;
    const size = String(props.harborSize || '').toLowerCase();
    if (size === 'large') score += 240;
    else if (size === 'medium') score += 160;
    else if (size === 'small') score += 80;
  }
  // Same idea for airports and dams, but each ladder lives with the pack that
  // writes the fields it reads — src/data/airportsPack.js, src/data/damsPack.js.
  if (layerId === 'local-airports') score += airportLabelPriority(props);
  if (layerId === 'local-dams') score += damLabelPriority(props);
  return score;
}

function propertyObject(entity) {
  const source = entity?.properties;
  const raw = typeof source?.getValue === 'function'
    ? source.getValue(Cesium.JulianDate.now())
    : source || {};
  return unwrapProperties(raw);
}

function unwrapProperties(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(unwrapProperties);
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = entry && typeof entry.getValue === 'function'
      ? unwrapProperties(entry.getValue(Cesium.JulianDate.now()))
      : unwrapProperties(entry);
  }
  return out;
}

function cleanLabel(value) {
  const text = String(value || '').trim();
  if (!text || text === 'undefined' || text === 'null') return '';
  return text;
}

function firstClean(values) {
  return values.map(cleanLabel).find(Boolean) || '';
}

function clampLabel(value) {
  const text = cleanLabel(value);
  return text.length > 34 ? `${text.slice(0, 31)}...` : text;
}

function clampCardLine(value) {
  const text = cleanLabel(value);
  return text.length > 48 ? `${text.slice(0, 45)}...` : text;
}

function layerTitle(layerId) {
  if (layerId === 'local-datacenters') return 'Datacenter';
  if (layerId === 'local-dams') return 'Barrage';
  if (layerId === 'local-ports') return 'Port';
  if (layerId === 'local-airports') return 'Aérodrome';
  return 'Feature';
}
