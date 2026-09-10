/**
 * @module layerCoverage
 *
 * WHERE a layer has data, as a table the panel can read — so a control can say
 * "not here" instead of looking broken.
 *
 * ── The defect this exists to close ─────────────────────────────────────────
 * `comptages-fr` draws 2 946 arcs of Paris street and nothing else on Earth:
 * its whole extent is 12,6 km by 10,0 km. It was a companion of the `traffic`
 * row WITHOUT `optIn`, so switching road traffic on over Tokyo switched it on
 * too — and `getRowControls()` then contributed SEVEN hour chips (`Moyenne
 * ouvrée` … `W-E 18 h`) to a strip of fifteen. Seven of fifteen controls, on
 * every view of the planet, steering a layer with no payload.
 *
 * The obvious repair — hide the control outside Paris — is the wrong one, and
 * the reason is discoverability: a chip that only exists over Paris is a chip
 * nobody ever learns about, because you have to already know it exists to go
 * and look for it. So the rule here is DECLARE, NEVER HIDE. The control stays
 * visible everywhere, it states its own territory, and it offers the flight.
 *
 * ── Three states, and they are not the same statement ───────────────────────
 *   • `in`    — the camera intersects an area the layer holds data for.
 *   • `out`   — it does not. The layer would draw nothing here, and saying so
 *               is not an error message: it is the layer's territory.
 *   • `dark`  — inside the coverage, inside a documented HOLE. `road-status-fr`
 *               covers the non-conceded national road network and Île-de-France
 *               has no publisher at all, so Paris is black on a layer that is
 *               otherwise national. That is not "out of coverage", it is
 *               "covered and empty, and here is who does not publish".
 *
 * A layer with no row in this table returns `null`, which means "no territorial
 * claim recorded" — never "everywhere". The panel treats `null` exactly as it
 * treated every layer before this module existed, so adding a row is opt-in and
 * a missing row costs nothing.
 *
 * ── Why the boxes are restated here rather than imported ────────────────────
 * `comptagesParis.js` exports `COMPTAGES_PARIS_BOX` and `fraicheurParis.js`
 * exports `FRAICHEUR_PARIS_BOX`, and importing them would be the DRY move. It
 * is also the move that would undo the fix: both modules import Cesium and both
 * are lazy chunks, so an import here — in a module the panel loads at boot —
 * would pull the Paris layers into the entry bundle for every visitor on Earth,
 * which is the exact cost `optIn` was added to stop paying.
 *
 * So the numbers are restated, and `layerCoverage.test.mjs` asserts they equal
 * the layers' own exported boxes. Drift is a test failure, not a silent lie.
 *
 * The dark areas ARE imported: `roadStatusCoverage.js` is pure (it imports only
 * `viewportBox.js`), it is already the measured source of truth for where the
 * DIR feeds are black, and a second copy of that table is the one thing worse
 * than a restated box.
 */

import { boxesIntersect } from './viewportBox.js';
import { ROAD_STATUS_DARK_AREAS } from './roadStatusCoverage.js';

/**
 * A layer's territory.
 *
 * `chip` is the SHORT form, and it goes on the control itself — so it has to
 * survive being read at 10 px next to a label, which is why it is `PARIS` and
 * not `Paris intra-muros`. `where` is the long form for tooltips and the
 * briefing card, and it is the one allowed to be precise.
 *
 * `boxes` is where the layer has data AT ALL, padded outward from the measured
 * extent. Padding is deliberate and it is not slack: a reader panning towards
 * Paris should see the control come alive before the first arc is on screen,
 * not after.
 *
 * `goto` names a preset city (`src/locations.js`), which is how this repo
 * already moves a camera to a place a human would name. A coverage with no
 * `goto` simply offers no flight.
 *
 * `brief` is the copy for the first-activation card, and it is present ONLY on
 * layers whose subject is genuinely surprising. A card is an interruption; a
 * layer that a reader can understand from its own name has not earned one.
 */
export const LAYER_COVERAGE = Object.freeze([
  /*
   * Measured off the 7 449 published vertices of the arc pack: lon 2,249 →
   * 2,421, lat 48,813 → 48,902. `comptagesParis.js` pads that by 0,05° and this
   * row carries the padded box verbatim.
   */
  Object.freeze({
    id: 'comptages-fr',
    chip: 'PARIS',
    where: 'Paris intra-muros',
    boxes: Object.freeze([
      Object.freeze({ south: 48.76, west: 2.20, north: 48.95, east: 2.47 }),
    ]),
    goto: 'paris',
    brief: Object.freeze({
      title: 'Comptages routiers',
      // Three lines, and each one answers a question a reader actually has.
      // No fourth line: a card that has to be read is a card that is not read.
      lines: Object.freeze([
        'Des capteurs installés dans les rues de Paris comptent les véhicules qui passent, rue par rue.',
        'Ce n’est pas de la congestion : c’est un nombre de véhicules par heure. Les sept boutons de créneau lisent la même semaine à des heures différentes.',
        'Semaine archivée, pas du direct — et Paris intra-muros uniquement : ailleurs, cette couche ne dessine rien.',
      ]),
    }),
  }),

  /*
   * NOT the city boundary, and `fraicheurFeed.js` says why: 159 fountains and
   * 25 045 trees are outside the périphérique, because Paris buries and waters
   * its dead in Thiais and Saint-Ouen. Measured 2026-09-01 over all four files:
   * lat 48,7423 → 48,9122, lon 2,2102 → 2,4698.
   */
  Object.freeze({
    id: 'fraicheur-fr',
    chip: 'PARIS',
    where: 'Paris et sa proche couronne',
    boxes: Object.freeze([
      Object.freeze({ south: 48.73, west: 2.20, north: 48.92, east: 2.48 }),
    ]),
    goto: 'paris',
  }),

  /*
   * The eight Île-de-France départements, measured off the contours this repo
   * already ships (`local_data/france_departements/departements.geojson`):
   * lat 48,1222 → 49,2322, lon 1,4474 → 3,5556. Padded by ~0,02°.
   *
   * The region rather than the city: IDFM's referential holds 37 956 stops and
   * they run to Provins and Mantes, so a Paris-sized box would report a real
   * layer as absent over two thirds of its own network.
   *
   * ONE row, not two. `idfm-frequency` had a territory of its own here until
   * 2026-09-10, when it stopped being a layer at all — its module folded into
   * `idfmNetwork.js`, which kept the id, the share token and the panel row. The
   * frequency dimension did not move region when it moved module, so this row
   * covers both publications.
   */
  Object.freeze({
    id: 'idfm-network',
    chip: 'IDF',
    where: 'Île-de-France',
    boxes: Object.freeze([
      Object.freeze({ south: 48.10, west: 1.42, north: 49.25, east: 3.58 }),
    ]),
    goto: 'paris',
  }),

  /*
   * Two cities and they are not one subject measured twice: Lyon publishes dock
   * STOCKS for 450 Vélo'v stations, Paris publishes cyclist FLOWS across 111
   * permanent counters. Both extents measured off the shipped pack —
   * Lyon lat 45,6933 → 45,8875 / lon 4,7785 → 4,9696, Paris lat 48,8196 →
   * 48,8987 / lon 2,2653 → 2,4114 — and padded by ~0,03°.
   *
   * `goto` is Paris because the row it hangs on (`bikeshare`) is a world layer
   * and a reader who presses this chip from Osaka is likelier to want the
   * capital. Lyon is named in `where`, so the offer is honest about being one
   * of two.
   */
  Object.freeze({
    id: 'velo-pulse-fr',
    chip: 'PARIS · LYON',
    where: 'Paris et Lyon',
    boxes: Object.freeze([
      Object.freeze({ south: 48.78, west: 2.23, north: 48.93, east: 2.45 }),
      Object.freeze({ south: 45.66, west: 4.74, north: 45.92, east: 5.01 }),
    ]),
    goto: 'paris',
  }),

  /*
   * The reciprocal case, and the reason this table has a `dark` state at all.
   *
   * `road-status-fr` is national — the non-conceded RRN, métropole and Corse —
   * and it is BLACK exactly where `comptages-fr` is the only layer with a
   * number: Île-de-France has no DIRIF publication of any kind. So over Paris
   * the two controls on the traffic row now read opposite ways at a glance,
   * which is the whole point: one lights up, one goes quiet and says who is not
   * publishing.
   *
   * The holes come from `roadStatusCoverage.js`, measured 2026-09-01. They are
   * imported rather than copied.
   */
  Object.freeze({
    id: 'road-status-fr',
    chip: 'FR',
    where: 'réseau routier national non concédé',
    boxes: Object.freeze([
      Object.freeze({ south: 41.2, west: -5.3, north: 51.2, east: 9.7 }),
    ]),
    dark: ROAD_STATUS_DARK_AREAS,
    goto: null,
  }),
]);

const COVERAGE_BY_ID = new Map(LAYER_COVERAGE.map((entry) => [entry.id, entry]));

/** A finite, non-inverted lat/lon box. */
function isSaneBox(box) {
  return !!box
    && Number.isFinite(box.south) && Number.isFinite(box.north)
    && Number.isFinite(box.west) && Number.isFinite(box.east)
    && box.south < box.north && box.west < box.east
    && box.south >= -90 && box.north <= 90;
}

/**
 * Validate the shipped table.
 *
 * Called at import, like {@link module:layerFusions}'s own check: a table this
 * small is not worth a lazy validation path, and a malformed row should fail
 * the build rather than dim the wrong control in production.
 *
 * @param {ReadonlyArray<object>} [table] Table under test.
 * @returns {true} When valid.
 * @throws {Error} On a duplicate id, an empty or inverted box, or a chip that
 *   would not survive being read on a control.
 */
export function validateLayerCoverage(table = LAYER_COVERAGE) {
  if (!Array.isArray(table)) throw new Error('Layer coverage must be an array');
  const seen = new Set();
  for (const entry of table) {
    const id = entry?.id;
    if (typeof id !== 'string' || !id) throw new Error('Coverage row missing id');
    if (seen.has(id)) throw new Error(`Duplicate coverage row: ${id}`);
    seen.add(id);
    if (typeof entry.chip !== 'string' || !entry.chip.trim()) {
      throw new Error(`Coverage row missing chip text: ${id}`);
    }
    if (typeof entry.where !== 'string' || !entry.where.trim()) {
      throw new Error(`Coverage row missing long-form territory: ${id}`);
    }
    if (!Array.isArray(entry.boxes) || entry.boxes.length === 0) {
      throw new Error(`Coverage row has no box: ${id}`);
    }
    for (const box of entry.boxes) {
      if (!isSaneBox(box)) throw new Error(`Coverage row has an unusable box: ${id}`);
    }
    for (const area of entry.dark || []) {
      if (!isSaneBox(area?.bbox)) throw new Error(`Coverage row has an unusable dark area: ${id}`);
    }
    // A brief with no lines is a card that opens on nothing, which is worse
    // than no card: it costs the reader a click and gives back an empty box.
    if (entry.brief && (!Array.isArray(entry.brief.lines) || !entry.brief.lines.length)) {
      throw new Error(`Coverage row has an empty briefing: ${id}`);
    }
  }
  return true;
}

validateLayerCoverage();

/**
 * The territory recorded for a layer.
 * @param {string} layerId Registered layer id.
 * @returns {?object} Coverage row, or null when the layer makes no claim.
 */
export function layerCoverageFor(layerId) {
  return COVERAGE_BY_ID.get(layerId) || null;
}

/**
 * Whether a view box touches one of a coverage's areas, folded across the seam.
 *
 * `cameraViewBox` unwraps east past 180 for a view that crosses the
 * antimeridian, and every box in this table sits between -5° and +10°, so a
 * camera that crossed the dateline has to be tested folded back or Europe
 * silently stops existing. This is the same fold `comptagesInView` performs;
 * it lives here now so every layer gets it rather than the one that thought
 * of it.
 *
 * @param {?{south:number, west:number, north:number, east:number}} view
 * @param {ReadonlyArray<object>} boxes
 * @returns {boolean}
 */
function viewTouches(view, boxes) {
  if (!view || !boxes?.length) return false;
  const folded = { ...view, west: view.west - 360, east: view.east - 360 };
  for (const box of boxes) {
    if (boxesIntersect(view, box) || boxesIntersect(folded, box)) return true;
  }
  return false;
}

/**
 * Where a view stands relative to a coverage row.
 *
 * `dark` outranks `in` deliberately. A camera over Paris DOES intersect
 * `road-status-fr`'s national box — the box is the whole country — and
 * reporting `in` there would light a control over the one region whose
 * operator publishes nothing at all. The hole is the more specific truth and
 * the more specific truth wins.
 *
 * @param {?object} entry Coverage row.
 * @param {?{south:number, west:number, north:number, east:number}} view
 * @returns {?('in'|'out'|'dark')} Null when there is nothing to say.
 */
export function coverageStateFor(entry, view) {
  if (!entry) return null;
  // No view box is not the same as no data: a camera that cannot report a
  // rectangle (globe view, degenerate frustum) has not proved anything, and
  // dimming a control on that basis would dim it at boot.
  if (!view) return null;
  if (!viewTouches(view, entry.boxes)) return 'out';
  const holes = entry.dark;
  if (holes?.length) {
    const bboxes = holes.map((area) => area.bbox);
    if (viewTouches(view, bboxes)) return 'dark';
  }
  return 'in';
}

/**
 * Where a view stands relative to a layer's territory.
 * @param {string} layerId Registered layer id.
 * @param {?{south:number, west:number, north:number, east:number}} view
 * @returns {?('in'|'out'|'dark')} Null when the layer makes no claim.
 */
export function layerCoverageState(layerId, view) {
  return coverageStateFor(COVERAGE_BY_ID.get(layerId) || null, view);
}

/**
 * The dark area a view has fallen into, for the sentence that names an
 * operator instead of shrugging.
 * @param {string} layerId Registered layer id.
 * @param {?{south:number, west:number, north:number, east:number}} view
 * @returns {?object} The first matching dark area, or null.
 */
export function layerDarkAreaAt(layerId, view) {
  const entry = COVERAGE_BY_ID.get(layerId);
  if (!entry?.dark?.length || !view) return null;
  for (const area of entry.dark) {
    if (viewTouches(view, [area.bbox])) return area;
  }
  return null;
}

/**
 * Every claim resolved for one view, as a string.
 *
 * The panel repaints on layer state, not on camera motion, so something has to
 * decide whether a camera stop is worth a repaint. Comparing this signature to
 * the last one answers that in a string compare: a pan across Paris produces
 * the same signature and repaints nothing, a pan OFF Paris produces a different
 * one and repaints once.
 *
 * @param {?{south:number, west:number, north:number, east:number}} view
 * @returns {string} Stable for a given set of states.
 */
export function coverageSignature(view) {
  const parts = [];
  for (const entry of LAYER_COVERAGE) {
    parts.push(`${entry.id}:${coverageStateFor(entry, view) || '?'}`);
  }
  return parts.join('|');
}

/**
 * The sentence a control carries when it is not where its data is.
 *
 * Written as one line because it lands in a `title`, and a tooltip that wraps
 * to four lines is a tooltip that is dismissed before it is read.
 *
 * `clickable` is what separates the two mount points, and getting it wrong is
 * the kind of small lie that erodes a whole interface: a companion CHIP can be
 * pressed to be taken there, a row's scope BADGE cannot be pressed at all, and
 * offering the flight from something inert teaches a reader that this map's
 * instructions are decorative.
 *
 * @param {string} layerId Registered layer id.
 * @param {?('in'|'out'|'dark')} state
 * @param {?object} [darkArea] Result of {@link layerDarkAreaAt}, when known.
 * @param {{clickable?: boolean}} [options]
 * @returns {string} Empty when the control has nothing extra to say.
 */
export function coverageNoticeFor(layerId, state, darkArea = null, { clickable = false } = {}) {
  const entry = COVERAGE_BY_ID.get(layerId);
  if (!entry) return '';
  if (state === 'out') {
    return clickable && entry.goto
      ? `Aucune donnée dans cette vue — couvre ${entry.where}. Cliquer pour y aller.`
      : `Aucune donnée dans cette vue — couvre ${entry.where}.`;
  }
  if (state === 'dark') {
    // Name the operator. "No data here" invites the reader to blame the map;
    // "DIRIF publishes nothing" is the fact, and it is checkable.
    return darkArea
      ? `${darkArea.name} : ${darkArea.operator} ne publie rien ici — le reste du réseau reste dessiné.`
      : `Zone non publiée — le reste du réseau reste dessiné.`;
  }
  return '';
}
