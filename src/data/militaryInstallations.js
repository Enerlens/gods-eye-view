import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import {
  clearSelectedEntityContextForLayer,
  getSelectedEntityContext,
  registerEntityContext,
  removeEntityContextsForLayer,
  selectEntityContext,
} from './contextStore.js';
import {
  cachedGroundFloor,
  floorAltitudeM,
  resolveGroundFloorCellsBounded,
} from './groundFloor.js';
// The shared batched/chunked/session-cached DEM warm chain. The module name is
// historical (it shipped with the FIRMS fire anchors); the mechanism itself is
// generic — cold coarse floor cells for a rendered point set, resolved strictly
// sequentially so overlapping renders cannot stack requests on the proxy.
import { warmFireAnchorFloors } from './fireAnchors.js';
import { normalizeMilitaryInstallations } from './militaryInstallationData.js';
import { loadMilitaryFrancePack, recordsInBox } from './militaryFrancePack.js';
import { militarySiteGlyph } from './militarySiteIcons.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';

const LAYER_ID = 'military-installations';
const REQUEST_DEBOUNCE_MS = 500;
/**
 * The widest box the LIVE query may ask for — the proxy's own contract, and the
 * ceiling Overpass can actually serve. It is not, any more, the altitude at
 * which this layer stops drawing.
 *
 * Measured 2026-09-10 against overpass-api.de with these filters: 1.5° answers
 * in 4 s, 5° in 41 s, 7.5° in 50 s with the geometry dropped, 10° in 84 s. So
 * this number was never a zoom policy — it was the point past which a request
 * stopped coming back, and a probe at 7.7° measured the layer failing outright
 * rather than waiting. Beyond it the map is drawn from the France pack (see
 * `militaryFrancePack.js`), which needs no request at all, and only OUTSIDE
 * France does pulling back still mean "zoom in to load".
 */
const MAX_VIEWPORT_DEGREES = 10;
const MAX_RENDERED = 700;
/**
 * Which classes survive the render cap — A5, made a rule instead of an accident.
 *
 * The cohort used to be cut at 700 in whatever order Overpass answered in, and
 * over a whole région that is 700 arbitrary marks of which nine in ten are the
 * fourre-tout. Sorting by class first means the 39 airfields, 11 naval bases and
 * 149 ranges of the entire French Republic are ALWAYS drawn, and what gets
 * dropped is the class that says least — which the key states in as many words.
 *
 * Named before unnamed inside a class, then OSM id: an order that depends only
 * on the records themselves, never on the camera, so a mark cannot appear and
 * disappear as the globe turns (G3).
 */
const CLASS_PRIORITY = Object.freeze({
  airfield: 0, naval_base: 1, range: 2, military_land: 3,
});
/**
 * The class hues, as the plate's FILL.
 *
 * Each was lifted a step from the value it shipped with, and the reason is the
 * mark's geometry rather than a taste for brighter colours: the hue used to be
 * a thin silhouette floating over the photograph, and it is now a filled disc
 * with a dark ring and a punched shape inside. A disc that dark reads as a hole
 * in the imagery; the ring already supplies the contrast, so the fill is free
 * to carry the hue at the value where hue is actually discriminable.
 *
 * B4 is unaffected: the four are DIFFERENTIATING, not ordered, and no reader is
 * asked to rank them.
 */
const COLOR_BY_CLASS = {
  airfield: '#6fb8ff',
  naval_base: '#4fd2e0',
  range: '#e6b268',
  military_land: '#a8bacd',
};

/**
 * On-screen size of a mark, and of the same mark when it is the selected
 * subject.
 *
 * 28 px, up from 24. The mark is now a plate carrying a punched silhouette, so
 * its diameter has to hold two things rather than one: the hue that names the
 * class and the shape inside it. Measured over a real orthophoto, the punch
 * stops being nameable below ~16 px, which — with the ramp below — is what sets
 * the nominal size rather than the other way round.
 */
const GLYPH_PX = 28;
const SELECTED_GLYPH_PX = 38;
/**
 * The catch-all, four pixels down.
 *
 * `military_land` takes nine marks in ten and its shield names no subject —
 * only the family. Drawing it at the size of the three classes that DO name one
 * would let the class with the least to say cover the map with the most ink.
 * Size is the one channel left to say "this one says less".
 */
const CATCH_ALL_GLYPH_PX = 24;
/**
 * The distance ramp under that size — F6, declared rather than inherited.
 *
 * The old ramp bottomed out at HALF nominal, which put the catch-all at 10 CSS
 * px from 60 km up. That is the picture the layer was rebuilt for: on a Gironde
 * capture at ~50 km, forty sites were 9 px specks the same value as the fields
 * behind them. The floor is now 0.62 and it is reached at 140 km rather than
 * 60, so the same view draws 24 px marks and the widest one this layer will
 * load still draws 17 px — a plate that is found without being hunted for.
 *
 * It still ramps, and that is the point of F6: a mark big enough to read over a
 * rooftop is a blanket over a département.
 */
const GLYPH_SCALE = Object.freeze({ near: 1_000, nearValue: 1, far: 140_000, farValue: 0.62 });
/** Key swatch raster. Small, and masked by the panel rather than tinted here. */
const LEGEND_GLYPH_PX = 32;

/**
 * The colour rows of the on-map key, in reading order.
 *
 * D1 makes a key mandatory wherever a mark carries a claim a reader cannot
 * otherwise decode, and this layer classified on hue alone with no key
 * anywhere: `getRowControls()` was simply never implemented, while 49 other
 * layers publish one.
 *
 * There were FIVE rows once. The fifth was purple, and it stood for a Google
 * Places text search for the words "military installation" — a NAME match, not
 * a survey, which is why it needed a row explaining it was not one. That whole
 * path is gone (2026-09-10): every row here now comes from an OpenStreetMap
 * tag, and the key no longer has to warn anybody about one of its own classes.
 *
 * The catch-all row goes last among the MAPPED classes because that is what it
 * is, and its blurb has to say so: measured 2026-09-10 on four French
 * viewports, `military_land` took 39 of Toulon's 44 records and 68 of the 69
 * west of Paris. A reader who is not told that grey is the fourre-tout reads
 * four evenly-weighted classes off a key that is really one class plus three
 * rarities.
 *
 * Colours are READ from COLOR_BY_CLASS rather than restated here, so a hue can
 * never drift between the map and its key.
 */
const LEGEND_CLASSES = Object.freeze([
  Object.freeze({
    key: 'airfield',
    label: 'Base aérienne',
    blurb: 'Le tag OSM military=airfield. La couche dit que le terrain est levé, '
      + 'jamais qu’il est actif ni ce qui s’y trouve.',
  }),
  Object.freeze({
    key: 'naval_base',
    label: 'Base navale',
    blurb: 'Le tag OSM military=naval_base : arsenal, base ou darse militaire.',
  }),
  Object.freeze({
    key: 'range',
    label: 'Champ de tir',
    blurb: 'Le tag OSM military=range, et lui seul. Un champ de manœuvre '
      + '(training_area) ou une zone dangereuse (danger_area) n’a pas de classe '
      + 'propre : il n’entre dans la couche que s’il porte aussi '
      + 'landuse=military, et tombe alors dans « Terrain militaire ».',
  }),
  Object.freeze({
    key: 'military_land',
    label: 'Terrain militaire',
    blurb: 'landuse=military, plus les tags military=barracks et military=base. '
      + 'C’est le fourre-tout de la couche, et de loin sa classe la plus '
      + 'fournie — 39 des 44 objets de la rade de Toulon, 68 des 69 de l’ouest '
      + 'parisien. Une pastille grise ne dit donc presque rien de ce qu’elle '
      + 'marque ; la fiche, si.',
  }),
]);

const EARTH_MEAN_RADIUS_M = 6371008.8;
const DISTANCE_PREFILTER_MARGIN_M = 5000;
const distanceEndpointScratch = new Cesium.Cartographic();
const distanceGeodesicScratch = new Cesium.EllipsoidGeodesic();

/**
 * Allocation-free spherical distance used only as a conservative rejection
 * pass before the exact ellipsoidal geodesic calculation.
 */
export function approximateSurfaceDistanceM(latitudeARad, longitudeARad, latitudeBDeg, longitudeBDeg) {
  const latitudeBRad = Cesium.Math.toRadians(latitudeBDeg);
  const longitudeBRad = Cesium.Math.toRadians(longitudeBDeg);
  const latitudeDelta = latitudeBRad - latitudeARad;
  const longitudeDelta = Math.atan2(
    Math.sin(longitudeBRad - longitudeARad),
    Math.cos(longitudeBRad - longitudeARad),
  );
  const sinLatitude = Math.sin(latitudeDelta / 2);
  const sinLongitude = Math.sin(longitudeDelta / 2);
  const haversine = sinLatitude * sinLatitude
    + Math.cos(latitudeARad) * Math.cos(latitudeBRad) * sinLongitude * sinLongitude;
  return 2 * EARTH_MEAN_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

const state = {
  viewer: null,
  dataSource: null,
  enabled: false,
  /**
   * The cohort on the globe: the live answer merged with the France pack for
   * the current view, deduplicated by OSM id and ordered by CLASS_PRIORITY.
   *
   * Everything downstream — the render cap, `getNearby`, the pick registry, the
   * count on the row — reads this one array, which is why the pack could be
   * added without any of them learning that a second source exists.
   */
  records: [],
  /** The last bounded Overpass answer, before the pack is folded in. */
  live: [],
  /** The France pack, fetched once per session on first enable. */
  pack: [],
  packRetrievedAt: '',
  packLoading: false,
  /** Cohort size BEFORE the render cap — the N of A5's "n drawn of N". */
  inViewCount: 0,
  /** Whether the camera is past the live query's gate and the pack is carrying. */
  wideView: false,
  recordById: new Map(),
  selectedId: null,
  lastUpdate: null,
  error: null,
  status: 'idle',
  stale: false,
  /** Whether the upstream truncated at its element cap for the current view. */
  saturated: false,
  loading: false,
  abort: null,
  /** Pending timed retry while status is 'unavailable' (see scheduleUnavailableRetry). */
  retryTimer: null,
  /** Current backoff step for that retry; 0 = next failure starts at the minimum. */
  retryDelayMs: 0,
  moveEndRemove: null,
  clickHandler: null,
  timer: null,
  /**
   * The on-map key for the CURRENT paint, rebuilt by `renderRecords` and only
   * there. The panel asks every enabled layer for its controls on each refresh
   * (~1 Hz), so deriving this on demand would slice the 700-record render
   * window and rebuild a tally every second for a block that only ever changes
   * when the paint does. It also removes a window where the key could describe
   * `state.records` that the globe had not drawn yet.
   */
  legend: [],
  /** The key's one-line disclosure of provenance and clipping (A5). */
  legendNote: '',
  /** What the last paint put on the globe, so a camera settle can skip a repaint. */
  paintSignature: '',
};

function colorFor(record) {
  return Cesium.Color.fromCssColorString(COLOR_BY_CLASS[record.class] || '#9ca6b0');
}

/** @param {object} record @returns {string} Human-readable source attribution. */
export function installationSourceLabel(record) {
  const names = [...new Set((Array.isArray(record?.sources) ? record.sources : [])
    .map((source) => String(source?.name || '').trim())
    .filter(Boolean))];
  return names.join(' + ') || 'Unknown mapped source';
}

/**
 * Build the on-map key from the records that are actually DRAWN.
 *
 * Counts are the drawn cohort, never `state.records`: the paint is capped at
 * MAX_RENDERED and the viewport filter runs before it, so a key sourced from
 * the loaded set would keep claiming sites that are nowhere on screen — the
 * same lie `airportTierLegend` refuses to tell about a hidden tier.
 *
 * A class with nothing drawn gets no row. The four are a closed set (see
 * CLASS_BY_MILITARY_TAG), and
 * `militaryInstallations.test.mjs` holds them closed — a sixth class added
 * upstream would otherwise draw dots with no row to explain them, which is the
 * exact hole this key was written to fill.
 *
 * NO SHAPE ROW, and that is a decision rather than an omission. Some sites are
 * drawn with a filled footprint and the rest as a bare pin, and a row was
 * written for it — measured 2026-09-10 over Toulon, Brest, west Paris and
 * Istres, 137 records of 163 carried one and the split was exactly the OSM
 * element type. It came out again: the airports legend had shipped the same
 * two rows and lost them (#138) on the rule that a FORM is what a reader
 * decodes without a key — a filled outline laid on the ground IS ground —
 * leaving the key for what no form says, which is the colour. A second legend
 * in the same panel does not get to answer that differently.
 *
 * STILL NO SHAPE ROW, now that four classes carry a silhouette. The glyph rides
 * INSIDE the colour row it belongs to — the swatch is the mark at key size —
 * so the class is named once, with both of its channels on the same line. A
 * separate list of shapes would be the same five classes printed twice.
 *
 * @param {Array<object>} records The records this paint put on the globe.
 * @returns {Array<{label:string,color:string,glyph:?string,blurb:string,count:number}>}
 */
export function installationLegend(records) {
  const drawn = Array.isArray(records) ? records : [];
  if (!drawn.length) return [];
  const tally = new Map();
  for (const record of drawn) {
    const klass = String(record?.class || '');
    tally.set(klass, (tally.get(klass) || 0) + 1);
  }

  const legend = [];
  for (const row of LEGEND_CLASSES) {
    const count = tally.get(row.key) || 0;
    if (!count) continue;
    legend.push({
      label: row.label,
      color: COLOR_BY_CLASS[row.key],
      // The swatch IS the mark, at key size, minus the ring the swatch's CSS
      // mask would flatten into a plain dot (see `militarySiteIcons.js`). Built
      // by the same call the globe makes, so a shape cannot drift between the
      // map and its key.
      glyph: militarySiteGlyph(row.key, { px: LEGEND_GLYPH_PX, key: true }) || undefined,
      blurb: row.blurb,
      count,
    });
  }

  return legend;
}

/**
 * The key's one-line disclosure: where these marks come from, and what the view
 * is NOT showing.
 *
 * A5 asks two things of any layer that clips — the count and the criterion —
 * and this layer now has a second thing to declare beside it: past the live
 * query's gate the marks come from a file with a date on it and no footprints,
 * which is a different claim from "surveyed just now for this exact view".
 *
 * Empty when there is nothing to say: a view whose sites all fit and all came
 * from the live answer needs no note, and a permanent one would be furniture.
 *
 * Pure, so the sentence can be pinned without a globe.
 *
 * @param {{drawn:number, inView:number, fromPack:number, packRetrievedAt:string}} counts
 * @returns {string} French, like the rest of this key. Empty when silent.
 */
export function installationKeyNote({ drawn, inView, fromPack, packRetrievedAt }) {
  const parts = [];
  if (Number.isFinite(inView) && Number.isFinite(drawn) && inView > drawn) {
    parts.push(`${drawn} marques sur ${inView} dans la vue — les classes nommées `
      + '(base aérienne, base navale, champ de tir) passent avant le fourre-tout, '
      + 'et un site nommé avant un site sans nom.');
  }
  if (fromPack > 0 && packRetrievedAt) {
    parts.push(`${fromPack} viennent du pack France embarqué, relevé OSM du `
      + `${packRetrievedAt} : un point par site, sans emprise. Zoomez pour `
      + 'interroger OpenStreetMap en direct et récupérer les contours.');
  }
  return parts.join(' ');
}

/**
 * Shared rendered-surface height for an installation anchor or footprint.
 * @param {{latitude:number, longitude:number}} record Installation record.
 * @returns {number} Ellipsoidal render height in metres.
 */
export function installationSurfaceHeightM(record) {
  return floorAltitudeM(
    null,
    cachedGroundFloor(record?.latitude, record?.longitude),
  ) ?? 0;
}

/**
 * Whether a mapped record belongs to the REQUESTED viewport.
 *
 * The proxy snaps the request bbox outward onto a shared cache grid, so a
 * response is a SUPERSET of what was asked for, and rendering that superset
 * would put off-screen sites into the map and into the "CURRENT VIEWPORT ONLY"
 * context claim. What may be tested depends on how much of a feature's geometry
 * we actually hold:
 *
 *  - A NODE is a point: its centre IS its whole geometry, so an exact
 *    containment test is correct and loses nothing.
 *  - A record WITH a footprint is tested by bounding-box overlap. Overpass bbox
 *    queries return features that merely INTERSECT the box, so centre-testing
 *    these would drop large bases whose centre sits just outside.
 *  - A way or relation WITHOUT a footprint is KEPT. Relations carry geometry on
 *    their members and ways beyond MAX_FOOTPRINT_POINTS are normalized without
 *    one, so their true extent is unknown here — and Overpass already proved
 *    they intersect the queried bbox. Centre-testing them would erase exactly
 *    the biggest installations. The honest cost is slight over-inclusion,
 *    bounded by one snap cell (~5.5 km) around the viewport.
 *
 * @param {{latitude:number, longitude:number, footprint:?Array, osmType:?string}} record
 * @param {{south:number, west:number, north:number, east:number}} box Requested viewport.
 * @returns {boolean}
 */
export function installationWithinViewport(record, box) {
  if (!record || !box) return false;
  const { latitude, longitude, footprint } = record;
  const centreInside = latitude >= box.south && latitude <= box.north
    && longitude >= box.west && longitude <= box.east;
  if (centreInside) return true;
  if (Array.isArray(footprint) && footprint.length) {
    let minLat = Infinity; let maxLat = -Infinity;
    let minLon = Infinity; let maxLon = -Infinity;
    for (const [lon, lat] of footprint) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    return maxLat >= box.south && minLat <= box.north
      && maxLon >= box.west && minLon <= box.east;
  }
  // Unknown extent: inclusive. Only a point feature may be excluded on centre.
  return record.osmType !== 'node';
}

/**
 * Whether a response was truncated at the upstream element cap.
 *
 * The proxy states this outright, but a `saturated`-less payload is NOT
 * evidence of a complete answer: entries cached before the saturation guard
 * shipped predate the field and live for 30 days. Fall back to deriving it from
 * the element count against the cap the payload itself reports.
 * @param {{saturated?: boolean, elements?: Array, elementCap?: number}} payload
 * @returns {boolean}
 */
export function installationResponseSaturated(payload) {
  if (typeof payload?.saturated === 'boolean') return payload.saturated;
  const cap = Number(payload?.elementCap);
  if (!Number.isFinite(cap) || cap <= 0) return false;
  return Array.isArray(payload?.elements) && payload.elements.length >= cap;
}

/**
 * Commit a status/error transition and buy the one frame it needs.
 *
 * With the render governor idle — Contacts has released its hold and nothing
 * else animates — no frame would otherwise arrive to re-read this, so a load
 * that fails after the scene went quiet would leave the last healthy readout on
 * screen indefinitely.
 * @param {string} status @param {?string} error
 */
/**
 * The row's one-line provenance, and the home of its guidance prompts.
 *
 * Guidance and faults are different claims and live in different fields: this
 * returns what the layer is DOING or asking for, while `getStats().error` stays
 * reserved for something that actually went wrong. The manager renders the two
 * in different slots.
 * @returns {string}
 */
function installationLoadingLabel() {
  if (state.loading) return 'loading mapped installation context';
  if (state.status === 'zoom-in') return 'zoom in to load mapped installation context';
  // Past the live gate the map is not waiting for anything, and saying "zoom
  // in" there was the layer asking for a zoom it no longer needs.
  if (state.wideView && state.records.length) return 'wide view — bundled France pack';
  return '';
}

function setInstallationStatus(status, error = null) {
  if (state.status === status && state.error === error) return;
  state.status = status;
  state.error = error;
  governorRequestRender('installations-status');
}

/**
 * The view rectangle, at ANY size — what the pack is filtered against.
 *
 * Null only when the camera has no rectangle at all (limb in frame) or the box
 * is degenerate. A wide box is a perfectly good question to ask a local file;
 * it is only a bad one to ask Overpass, which is what `viewportBox` is for.
 */
function displayBox(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle(viewer.scene.globe.ellipsoid);
  if (!rectangle) return null;
  const south = Cesium.Math.toDegrees(rectangle.south);
  const north = Cesium.Math.toDegrees(rectangle.north);
  const west = Cesium.Math.toDegrees(rectangle.west);
  const east = Cesium.Math.toDegrees(rectangle.east);
  if (!Number.isFinite(south + north + west + east) || east <= west || north <= south) return null;
  return { south, west, north, east };
}

/**
 * The box the LIVE request may ask for, or null when the camera is past the
 * gate — which is now a statement about Overpass, not about the layer.
 */
function viewportBox(viewer) {
  const box = displayBox(viewer);
  if (!box) return null;
  // Cross-dateline/global views require a zoom before a bounded request.
  if (box.north - box.south > MAX_VIEWPORT_DEGREES
    || box.east - box.west > MAX_VIEWPORT_DEGREES) return null;
  return box;
}

/**
 * Merge the live answer with the pack, and put the result in drawing order.
 *
 * The LIVE record wins every collision, and the collision key is the OSM id
 * both sources carry. That is what keeps a base re-mapped this morning from
 * being drawn as the pack's month-old point — and, more visibly, what keeps its
 * footprint, which the pack does not hold.
 *
 * Pure, and exported, because the ordering IS the clipping policy: it decides
 * which 700 of a région's sites reach the globe.
 *
 * @param {Array<object>} live Records from the last bounded request.
 * @param {Array<object>} pack Pack records inside the current view.
 * @returns {Array<object>} One record per OSM id, in drawing order.
 */
export function mergeInstallationCohort(live, pack) {
  const byId = new Map();
  for (const record of Array.isArray(pack) ? pack : []) byId.set(record.id, record);
  for (const record of Array.isArray(live) ? live : []) byId.set(record.id, record);
  return [...byId.values()].sort((a, b) => {
    const classDelta = (CLASS_PRIORITY[a.class] ?? 9) - (CLASS_PRIORITY[b.class] ?? 9);
    if (classDelta) return classDelta;
    // A named site is a place a reader can look up; an unnamed one is a
    // polygon. Between two of the same class, the name earns the pixels.
    const namedDelta = Number(Boolean(b.named)) - Number(Boolean(a.named));
    if (namedDelta) return namedDelta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Rebuild the cohort for the CURRENT camera, without asking anybody anything.
 *
 * Called on every camera settle, whenever the live answer lands, and when the
 * pack finishes loading. Cheap by construction: one pass over the pack (4 086
 * points) plus a sort of what survives it.
 */
function refreshCohort() {
  const box = displayBox(state.viewer);
  state.wideView = state.pack.length > 0 && viewportBox(state.viewer) === null;
  state.records = mergeInstallationCohort(state.live, recordsInBox(state.pack, box));
  state.inViewCount = state.records.length;
  state.recordById = new Map(state.records.map((record) => [record.id, record]));
}

function clearRendered() {
  if (state.dataSource?.entities) state.dataSource.entities.removeAll();
  removeEntityContextsForLayer(LAYER_ID);
  // No marks, no key. `renderRecords` clears then repaints, and reinstates the
  // key from the cohort it just drew.
  state.legend = [];
  state.legendNote = '';
}

/**
 * The records that get entities this paint: the nearest `MAX_RENDERED`, plus
 * the selected one when it falls outside that window.
 *
 * Context navigation walks the FULL nearby cohort, which is not bounded by the
 * render cap, so selecting item 701+ used to produce no entity at all — the
 * camera flew, `getById` returned null, and the selection was silently dropped
 * on the floor, leaving the Context subject stale so NEXT offered the same
 * installation forever. One extra entity keeps every cohort item selectable
 * and the cohort count honest.
 * @returns {Array<object>} Records to render this paint.
 */
function renderableRecords() {
  const rendered = state.records.slice(0, MAX_RENDERED);
  if (!state.selectedId) return rendered;
  if (rendered.some((record) => record.id === state.selectedId)) return rendered;
  const selected = state.recordById.get(state.selectedId);
  return selected ? [...rendered, selected] : rendered;
}

/**
 * Rebuild this layer's entities from the current records.
 *
 * @param {object} [options]
 * @param {boolean} [options.claimSelection=false] This render exists BECAUSE
 *   the user just picked one of our sites, so our selection is the newest one
 *   and must stand. Every other render — a debounced refetch landing, a ground
 *   floor resolving late — has to yield: context navigation can select an
 *   aircraft or a vessel with no canvas click at all, and a repaint that
 *   arrives afterwards would otherwise paint our old site white again and take
 *   the readout back.
 */
function renderRecords({ claimSelection = false } = {}) {
  const selectedContext = getSelectedEntityContext();
  if (!claimSelection && state.selectedId && selectedContext && selectedContext.id !== state.selectedId) {
    state.selectedId = null;
  }
  // Post-moveEnd debounced fetches commit after the camera settles; the
  // rebuilt entities need one frame in idle mode. (perf wave 2 fix)
  governorRequestRender('installations-render');
  clearRendered();
  const drawn = renderableRecords();
  // The key describes THIS cohort, so it is built from the same array the
  // entities come from rather than re-derived later from `state.records`.
  state.legend = installationLegend(drawn);
  state.legendNote = installationKeyNote({
    drawn: drawn.length,
    inView: state.inViewCount,
    fromPack: drawn.filter((record) => record.pack).length,
    packRetrievedAt: state.packRetrievedAt,
  });
  state.paintSignature = paintSignature();
  for (const record of drawn) {
    const color = colorFor(record);
    const surfaceHeightM = installationSurfaceHeightM(record);
    const displayPosition = Cesium.Cartesian3.fromDegrees(
      record.longitude,
      record.latitude,
      surfaceHeightM,
    );
    const selected = record.id === state.selectedId;
    const glyph = militarySiteGlyph(record.class);
    const glyphPx = record.class === 'military_land' ? CATCH_ALL_GLYPH_PX : GLYPH_PX;
    const entity = state.dataSource.entities.add({
      id: record.id,
      position: displayPosition,
      // Every class the normalizer emits has a silhouette; the pastille below
      // is the fallback for a class that arrives without one. The two are
      // exclusive — a glyph over its own dot reads as two marks on one anchor.
      billboard: glyph ? {
        image: glyph,
        width: selected ? SELECTED_GLYPH_PX : glyphPx,
        height: selected ? SELECTED_GLYPH_PX : glyphPx,
        color: selected ? Cesium.Color.WHITE : color,
        // A mark big enough to read over a rooftop is a blanket over a whole
        // département, so it rides back down with range — to a FLOOR, never to
        // a speck. See GLYPH_SCALE for the measurement that set the floor.
        scaleByDistance: new Cesium.NearFarScalar(
          GLYPH_SCALE.near, GLYPH_SCALE.nearValue,
          GLYPH_SCALE.far, GLYPH_SCALE.farValue,
        ),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      } : undefined,
      point: glyph ? undefined : {
        pixelSize: selected ? 13 : 9,
        color: selected ? Cesium.Color.WHITE : color,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.8),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      polygon: record.footprint ? {
        hierarchy: new Cesium.PolygonHierarchy(record.footprint.map(([longitude, latitude]) => Cesium.Cartesian3.fromDegrees(longitude, latitude))),
        material: color.withAlpha(0.12),
        outline: true,
        outlineColor: color.withAlpha(0.65),
        height: surfaceHeightM,
      } : undefined,
    });
    entity.gevTrackedId = `installations:${record.id}`;
    entity.gevDisplayPosition = () => displayPosition;
    entity.gevLabelModel = {
      title: record.name || 'MAPPED INSTALLATION',
      details: [String(record.class || 'installation').replaceAll('_', ' ').toUpperCase()],
      accent: COLOR_BY_CLASS[record.class] || '#9ca6b0',
    };
    registerEntityContext(entity, {
      id: record.id,
      layerId: LAYER_ID,
      layerName: 'Mapped Military Installations',
      source: installationSourceLabel(record),
      label: record.name,
      latitude: record.latitude,
      longitude: record.longitude,
      properties: {
        class: record.class,
        primaryType: record.primaryType || null,
        placeTypes: Array.isArray(record.placeTypes) ? record.placeTypes : [],
        validation: record.validation,
        retrievedAt: record.retrievedAt,
      },
    });
  }
  const selectedEntity = state.selectedId
    ? state.dataSource.entities.getById(state.selectedId)
    : null;
  if (selectedEntity) selectEntityContext(selectedEntity);
  else state.selectedId = null;
}

/**
 * Second paint for floors that missed the bounded pre-render deadline.
 *
 * `resolveGroundFloorCellsBounded` gives up after FLOOR_RESOLVE_DEADLINE_MS so
 * a cold DEM can never hold the dots hostage — but the resolve keeps running
 * and lands seconds later, and without this the records it covers stay pinned
 * at ellipsoid height 0, sitting visibly under the 3D tiles (field test
 * 2026-08-18: "orange dots at the bottom").
 *
 * This is the render -> warm -> re-render chain FIRMS already uses, with one
 * difference the installations path forces: the trigger is whether a cell that
 * was COLD AT PAINT TIME is warm now, not whether this particular batch warmed
 * it. The bounded resolve above is still running against the same cells, so
 * asking "did MY batch warm anything" would answer false exactly when the other
 * resolve won the race — the common case. Still terminating: a set that is
 * wholly cold afterwards re-renders zero times and the next camera-driven load
 * retries.
 * @param {Array<object>} records Records just rendered.
 * @returns {void}
 */
function warmInstallationFloors(records) {
  const cold = records
    .filter((record) => cachedGroundFloor(record.latitude, record.longitude) == null)
    .map((record) => ({ lat: record.latitude, lon: record.longitude }));
  if (!cold.length) return;
  warmFireAnchorFloors(cold).then(() => {
    if (!state.enabled || !state.dataSource) return;
    if (!cold.some((point) => cachedGroundFloor(point.lat, point.lon) != null)) return;
    renderRecords();
  });
}

function selectRecord(id) {
  const record = state.recordById.get(id);
  if (!record || !state.dataSource) return false;
  state.selectedId = id;
  renderRecords({ claimSelection: true });
  // renderRecords drops selectedId when the record produced no entity.
  return state.selectedId === id;
}

/**
 * What a left click does to this layer's selection.
 *
 * There used to be no gesture that let GO of a site: the handler only ever
 * selected, so a picked installation stayed lit — and kept the shared Context
 * readout — until another layer happened to claim the slot. Clicking it again,
 * clicking empty map, or clicking a contact this layer does not own all mean
 * the same thing, and all three arrive here as "not one of my records".
 *
 * Pure, so the decision is pinnable without a Cesium canvas and a synthetic
 * pointer event.
 * @param {?string} pickedId Entity id under the cursor, if any.
 * @param {?string} selectedId This layer's currently selected record id.
 * @param {boolean} owned Is pickedId one of this layer's records?
 * @returns {'select'|'release'|'ignore'}
 */
export function installationClickOutcome(pickedId, selectedId, owned) {
  if (pickedId && owned && pickedId !== selectedId) return 'select';
  return selectedId ? 'release' : 'ignore';
}

function installInteraction(viewer) {
  if (state.clickHandler) return;
  state.clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  state.clickHandler.setInputAction((click) => {
    if (!state.enabled) return;
    const picked = viewer.scene.pick(click.position);
    const id = typeof picked?.id?.id === 'string' ? picked.id.id : null;
    const outcome = installationClickOutcome(id, state.selectedId, state.recordById.has(id));
    if (outcome === 'select') {
      selectRecord(id);
    } else if (outcome === 'release') {
      // Only OUR shared context is cleared, so a sibling handler's freshly
      // picked aircraft or vessel survives the same click.
      state.selectedId = null;
      clearSelectedEntityContextForLayer(LAYER_ID);
      renderRecords();
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

/**
 * Backoff progression for the unavailable-state retry: 30 s, doubling to a
 * 240 s ceiling. Pure so the progression is pinnable without booting the layer.
 */
export function installationRetryDelayMs(prevDelayMs) {
  const RETRY_MIN_MS = 30000;
  const RETRY_CEIL_MS = 240000;
  if (!Number.isFinite(prevDelayMs) || prevDelayMs <= 0) return RETRY_MIN_MS;
  return Math.min(prevDelayMs * 2, RETRY_CEIL_MS);
}

/**
 * 'Temporarily unavailable' must mean temporarily: fetches otherwise fire only
 * on enable and on camera moveEnd, so a parked camera whose first request died
 * (one flaky Overpass mirror is enough) stayed unavailable forever while the
 * proxy sat healthy while the layer refused to show its features. While the
 * layer is enabled and
 * unavailable, retry on a 30 s → 240 s backoff; any success, user-driven load,
 * zoom-out, or disable cancels it.
 */
function scheduleUnavailableRetry() {
  if (!state.enabled) return;
  clearTimeout(state.retryTimer);
  state.retryDelayMs = installationRetryDelayMs(state.retryDelayMs);
  state.retryTimer = setTimeout(() => {
    state.retryTimer = null;
    if (state.enabled && !state.loading) loadInstallations();
  }, state.retryDelayMs);
}

function clearUnavailableRetry({ resetBackoff = true } = {}) {
  clearTimeout(state.retryTimer);
  state.retryTimer = null;
  if (resetBackoff) state.retryDelayMs = 0;
}

function scheduleLoad() {
  if (!state.enabled) return;
  // A user-driven load supersedes any pending retry; the load reschedules on
  // failure, so the backoff step is kept rather than reset.
  clearUnavailableRetry({ resetBackoff: false });
  clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    // Repaint FIRST, from the pack and the answer already in hand: a camera
    // settle changes which sites are in view, and waiting for Overpass to say
    // so would leave the previous view's marks on screen for seconds — or for
    // ever, past the gate where no request is made at all.
    repaintForView();
    loadInstallations();
  }, REQUEST_DEBOUNCE_MS);
}

/**
 * Rebuild the cohort for the current camera and repaint IF the paint changed.
 *
 * The guard matters: this runs on every camera settle, and `renderRecords`
 * clears and rebuilds up to 700 entities. A pan that moves no site in or out of
 * view must cost nothing.
 */
function repaintForView() {
  if (!state.enabled || !state.dataSource) return;
  refreshCohort();
  const signature = paintSignature();
  if (signature === state.paintSignature) return;
  renderRecords();
}

/**
 * What the next paint would put on the globe, as one comparable string.
 *
 * Source-tagged (`l`/`p`), because a live record and a pack record can share an
 * OSM id and draw differently — the live one carries a footprint.
 */
function paintSignature() {
  return `${state.selectedId || ''}|${renderableRecords()
    .map((record) => `${record.pack ? 'p' : 'l'}${record.id}`).join(',')}`;
}

/**
 * Fetch the France pack, once per session, the first time the layer is enabled.
 *
 * Never on boot: `?url` keeps the ~470 kB out of the bundle, and this keeps it
 * off the wire for anyone who never opens the layer. A failure is not fatal and
 * is not retried — the loader logs it and resolves empty, which leaves the
 * layer exactly as it behaved before the pack existed.
 */
function ensureFrancePack() {
  if (state.pack.length || state.packLoading) return;
  state.packLoading = true;
  loadMilitaryFrancePack().then((pack) => {
    state.packLoading = false;
    state.pack = pack.records;
    state.packRetrievedAt = pack.retrievedAt;
    if (!state.enabled || !state.dataSource) return;
    repaintForView();
    // A wide camera never asks for anything, so nothing else would re-read the
    // status once the pack arrived and put marks on an empty screen.
    if (state.records.length && state.status === 'zoom-in') setInstallationStatus('ready', null);
  });
}

async function loadInstallations() {
  if (!state.enabled || !state.viewer) return;
  const box = viewportBox(state.viewer);
  if (!box) {
    state.abort?.abort();
    state.abort = null;
    state.loading = false;
    // The pack answers a view this wide with no request at all, so a camera
    // past the gate is only "zoom in" where the pack has nothing: outside
    // France, or before it has finished loading.
    refreshCohort();
    renderRecords();
    // The status below passes NULL, not a prompt. `setInstallationStatus`'s
    // second argument is `state.error`, and the row renders a non-empty
    // `error` in its fault slot — so that one argument was the whole of
    // "Sites militaires shows Loaded Error". The layer was never failing: at a
    // country-wide camera it is correctly zoom-gated, and the prompt now
    // travels as `loadingLabel`, which is the guidance slot.
    //
    // These two calls stay ADJACENT: `militaryInstallations.test.mjs` asserts
    // that on the source text, because cancelling the retry is what hands
    // re-entry back to moveEnd. Comments go above the pair, never between it.
    clearUnavailableRetry();
    setInstallationStatus(state.records.length ? 'ready' : 'zoom-in', null);
    return;
  }
  state.abort?.abort();
  const requestAbort = new AbortController();
  state.abort = requestAbort;
  state.loading = true;
  try {
    const fetchInstallations = async (exact) => {
      const query = new URLSearchParams(Object.entries(box).map(([key, value]) => [key, value.toFixed(5)]));
      if (exact) query.set('exact', '1');
      const response = await fetch(`/api/military-installations?${query}`, { signal: requestAbort.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || `Installation feed HTTP ${response.status}`);
      return body;
    };

    let payload = await fetchInstallations(false);
    // A SATURATED snapped tile was truncated upstream, so features from the
    // snap's extra ring may have crowded out sites actually on screen. Re-ask
    // for the exact viewport (separately keyed and cached) before rendering.
    let saturated = installationResponseSaturated(payload);
    if (saturated) {
      payload = await fetchInstallations(true);
      saturated = installationResponseSaturated(payload);
    }
    const normalized = normalizeMilitaryInstallations(payload, payload.retrievedAt || new Date().toISOString());
    // The proxy answers a bbox at least as large as the viewport; keep only what
    // was actually asked for so nothing off-screen reaches the map or the
    // "current viewport only" context claim.
    const records = normalized.records.filter((record) => installationWithinViewport(record, box));
    await resolveGroundFloorCellsBounded(records.map((record) => ({
      lat: record.latitude,
      lon: record.longitude,
    })));
    if (requestAbort.signal.aborted || state.abort !== requestAbort || !state.enabled) return;
    state.live = records;
    refreshCohort();
    state.lastUpdate = Date.now();
    state.stale = payload.status === 'stale';
    // Even the exact-viewport retry can saturate in a dense area. Say so rather
    // than implying the view is completely surveyed.
    state.saturated = saturated;
    clearUnavailableRetry();
    setInstallationStatus(
      state.records.length ? (state.stale ? 'stale' : 'ready') : 'empty',
      payload.status === 'stale'
        ? 'Serving cached mapped context'
        : (saturated ? 'Too many mapped sites in view to list them all' : null),
    );
    renderRecords();
    warmInstallationFloors(state.records);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    setInstallationStatus('unavailable', error?.message || 'Installation context unavailable');
    scheduleUnavailableRetry();
  } finally {
    // An older aborted request must not clear a newer request's busy state.
    if (state.abort === requestAbort) {
      state.abort = null;
      state.loading = false;
    }
  }
}

const militaryInstallationsLayer = {
  id: LAYER_ID,
  name: 'Mapped Installations',
  icon: '⌖',
  source: 'OpenStreetMap',
  updateInterval: 0,
  statsRefreshInterval: 1000,
  init(viewer) {
    state.viewer = viewer;
    state.dataSource = new Cesium.CustomDataSource('military-installations');
    viewer.dataSources.add(state.dataSource);
    state.moveEndRemove = viewer.camera.moveEnd.addEventListener(scheduleLoad);
    installInteraction(viewer);
  },
  enable() {
    state.enabled = true;
    registerPickOwner(LAYER_ID, (id) => state.recordById.has(id));
    state.dataSource.show = true;
    ensureFrancePack();
    // DataLayerManager invokes update() immediately after enable(), which owns
    // the first fetch. Avoid racing it with a second aborting request here.
  },
  disable() {
    state.enabled = false;
    unregisterPickOwner(LAYER_ID);
    // The pack SURVIVES a disable — it is a file, it cost one fetch, and
    // switching the layer back on should not pay for it twice.
    state.paintSignature = '';
    clearUnavailableRetry();
    clearTimeout(state.timer);
    state.abort?.abort();
    state.abort = null;
    state.loading = false;
    if (state.dataSource) state.dataSource.show = false;
    clearSelectedEntityContextForLayer(LAYER_ID);
    state.selectedId = null;
  },
  update() { return loadInstallations(); },
  destroy(viewer) {
    this.disable();
    state.moveEndRemove?.();
    state.clickHandler?.destroy();
    state.clickHandler = null;
    clearRendered();
    if (state.dataSource && viewer) viewer.dataSources.remove(state.dataSource, true);
    state.dataSource = null;
  },
  getNearby(center, rangeM, maxCount = 50) {
    if (!center) return [];
    const range = Number.isFinite(rangeM) ? rangeM : Infinity;
    const centerCartographic = Cesium.Cartographic.fromCartesian(center);
    if (!centerCartographic) return [];
    const nearby = [];
    const approximateLimit = Number.isFinite(range)
      ? range * 1.03 + DISTANCE_PREFILTER_MARGIN_M
      : Infinity;
    for (const record of state.records) {
      if (record.kind !== 'installation') continue;
      if (approximateSurfaceDistanceM(
        centerCartographic.latitude,
        centerCartographic.longitude,
        record.latitude,
        record.longitude,
      ) > approximateLimit) continue;
      // The awareness disk is projected onto the ground. Confirm candidates
      // with an exact ellipsoidal surface distance and reusable scratch state.
      distanceEndpointScratch.longitude = Cesium.Math.toRadians(record.longitude);
      distanceEndpointScratch.latitude = Cesium.Math.toRadians(record.latitude);
      distanceEndpointScratch.height = 0;
      distanceGeodesicScratch.setEndPoints(centerCartographic, distanceEndpointScratch);
      const distanceM = distanceGeodesicScratch.surfaceDistance;
      if (!Number.isFinite(distanceM) || distanceM > range) continue;
      nearby.push({
        ...record,
        position: Cesium.Cartesian3.fromDegrees(
          record.longitude,
          record.latitude,
          installationSurfaceHeightM(record),
        ),
        distanceM,
      });
    }
    nearby.sort((a, b) => a.distanceM - b.distanceM);
    return nearby.slice(0, Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 50);
  },
  /**
   * Select and frame a mapped installation from another contextual UI.
   * @param {string} id Source-backed installation id.
   * @returns {boolean} True when an available installation was focused.
   */
  focusById(id) {
    const record = state.recordById.get(String(id));
    if (!record || !state.viewer) return false;
    // No camera flight without a real selection: a flight plus a stale subject
    // reads as success to Context navigation and strands NEXT on this item.
    if (!selectRecord(record.id)) return false;
    state.viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(
        Cesium.Cartesian3.fromDegrees(
          record.longitude,
          record.latitude,
          installationSurfaceHeightM(record),
        ),
        18000,
      ),
      { duration: 1.4 },
    );
    return true;
  },
  /**
   * The on-map key. No chips: this layer has no control left to publish since
   * the Places search was removed, and an informational chip would render as a
   * button that looks pressable and does nothing.
   *
   * `surfaceFill` stays unset on purpose. That flag mounts the shared drape
   * note, and it would be false here: these footprints are polygons at a fixed
   * `height`, not ground-clamped surfaces, so they do not drape anything.
   */
  getRowControls() {
    return { legend: state.legend, note: state.legendNote };
  },
  getStats() {
    return {
      count: state.records.length,
      /** The two halves of the cohort, so a harness never has to infer them. */
      liveCount: state.live.length,
      packCount: state.pack.length,
      packRetrievedAt: state.packRetrievedAt,
      inViewCount: state.inViewCount,
      wideView: state.wideView,
      lastUpdate: state.lastUpdate,
      stale: state.stale,
      saturated: state.saturated,
      error: state.error,
      status: state.status,
      loading: state.loading,
      loadingLabel: installationLoadingLabel(),
    };
  },
};

export default militaryInstallationsLayer;
