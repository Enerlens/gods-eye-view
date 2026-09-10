/**
 * @module plantFiliereIcons
 *
 * The MARK of a generating station — one per filière of `edfPowerPlants.js`: a
 * tinted plate with the filière's silhouette punched out of it.
 *
 * ── WHY A SHAPE, WHEN THE COLOUR ALREADY SAYS IT ────────────────────────────
 *
 * It says it in the key, which is on the other side of the screen, and it says
 * it in a LABEL that most sites do not get: the shared overlay host paints at
 * most 60 of the 79 marks and drops the rest on collision, so on a full view of
 * France the majority of these stations were a coloured dot and nothing else.
 * The same argument `militarySiteIcons.js` won for four cyans on identical
 * pastilles, with the same answer — the silhouette says WHERE the mark is, the
 * key keeps saying what the colour means, and neither carries the load alone.
 *
 * ── WHY A PLATE, AND NOT THE BARE SILHOUETTE THIS PACK FIRST DREW ───────────
 *
 * Because a bare silhouette fails at the bottom of this layer's own size ramp,
 * and that was measured next door rather than argued here: rendered over three
 * crops of a real Gironde capture — forest, urban, water — bare shapes were
 * unfindable below 18 px, while a plate is still a plate at 10
 * (`militarySiteIcons.js`, which shipped the finding). This layer's smallest
 * site, Grandval at 74 MW, draws at **15.6 px**, and half the hydro fleet sits
 * under 18. A drop rendered as ink over an orthophoto of a valley is a drop of
 * water on a photograph of water.
 *
 * The distinction that decides it is the same one: a vehicle is a moving object
 * a reader follows, and a silhouette against the world is right for that. A
 * power station is a PLACE on a photograph of places, competing with roofs,
 * fields and rivers for the same pixels. Marks for places carry a plate.
 *
 * ── WHAT IS BORROWED, AND WHY EACH ONE ──────────────────────────────────────
 *
 * Nothing is drawn from scratch. Two vendored sets, three glyphs:
 *
 *   - **nucléaire** — Temaki's `cooling_tower_radiation`, vendored in
 *     `mapIcons.js`. It is that set's own icon for `plant:source=nuclear`, and
 *     it is the only glyph in any vetted set that says *nuclear power station*
 *     rather than *physics*: an atom reads as a science museum, and the bare
 *     trefoil is a HAZARD sign — a claim this map does not make and has no data
 *     for. A plain cooling tower would have been the safer-looking choice and
 *     is the wrong one: coal plants have cooling towers too. The trefoil is
 *     what makes the tower nuclear, and under the punch it survives as its own
 *     shape: it winds against the tower, so it is a hole in the hole, and it
 *     comes back in the plate's colour inside the dark tower.
 *
 *   - **hydraulique** — Material's `water_drop`, NOT a barrage. Maki has a
 *     `dam` and it was rejected on the module header of `edfPowerPlants.js`:
 *     "a dam is not a power station", 37 of these 51 plants have a mapped dam
 *     vertex within 3 km, and this project draws those structures as their own
 *     layer. A mark that pictured a dam would quietly assert an identity that
 *     file spends a paragraph refusing. A drop says water — which is the whole
 *     of what "hydraulique" claims — and it survives being punched into a 16 px
 *     plate, which the dam's three hairline ripples do not.
 *
 *   - **thermique** — Material's `local_fire_department`. EDF's own name for
 *     the filière is *thermique à flamme*; the glyph is that word.
 *
 * ── HOW THE PUNCH IS MADE, AND WHY IT IS A MASK ─────────────────────────────
 *
 * `fill-rule="evenodd"` only spans the subpaths of ONE path element, so it
 * cannot punch a hole through artwork that arrives inside a `<g transform>` —
 * which is every borrowed icon, since fitting a 15- or 960-unit box into this
 * 96-unit plate is a transform. The hole is an SVG `<mask>`: a white disc with
 * the silhouette painted black over it.
 *
 * ── TINT-SAFE BY CONSTRUCTION, like every other pack in this fleet ──────────
 *
 * Cesium multiplies `billboard.color` into the texture. The plate is WHITE, so
 * it takes the filière colour exactly; the ring behind it is black, and black
 * survives any multiply (0 × c = 0). The punched silhouette is a hole, so what
 * shows through it is that same ring — a dark shape on a coloured plate, whose
 * contrast does not depend on what the site happens to sit on. No hue is baked
 * into the artwork, which is also what lets the same rasters serve the on-map
 * key, where the swatch masks them and reads their ALPHA.
 *
 * ATTRIBUTION. `licenses/material-symbols/NOTICE` and `licenses/temaki/NOTICE`
 * record exactly which glyphs are used, that only the `d` path string of each
 * is vendored, and that no coordinate was touched.
 */
import { mapIconArtwork } from './mapIcons.js';

/** Glyph coordinate space. Same 96-unit box the other marker packs author to. */
const VIEW = 96;
const CENTRE = VIEW / 2;

/**
 * Plate radius and the ring around it, in box units. Identical to
 * `militarySiteIcons.js`, deliberately: two packs of PLACE marks that differed
 * by a pixel of edge would read as two renderers on one globe.
 */
const DISC_R = 40;
const RING_W = 7;

/** Ring colour, likewise shared with the sibling place pack. */
const RING_COLOR = 'rgba(0,0,0,0.86)';

/**
 * Vendored Material Symbols path data (Rounded, filled, weight 400).
 *
 * Authored in Material's own `0 -960 960 960` box, which is why that box is
 * declared rather than normalised: rewriting the coordinates would be a
 * modification of the artwork for no benefit. Retrieved 2026-09-10 at commit
 * 0cbb08816df0 from `symbols/web/<name>/materialsymbolsrounded/<name>_fill1_24px.svg`.
 *
 * @see licenses/material-symbols/NOTICE
 */
const MATERIAL_SYMBOL_PATHS = Object.freeze({
  // A drop with a highlight crescent cut out of its lower left. The crescent is
  // a counter-wound subpath and stays one: filled in, the drop is a featureless
  // blob and reads as a map pin rather than as water.
  water_drop: 'M480-80q-137 0-228.5-94T160-408q0-62 28-124t70-119q42-57 91-107t91-87q8-8 18.5-11.5T480-860q11 0 21.5 3.5T520-845q42 37 91 87t91 107q42 57 70 119t28 124q0 140-91.5 234T480-80Zm11-120q12-1 20.5-9.5T520-230q0-14-9-22.5t-23-7.5q-41 3-87-22.5T343-375q-2-11-10.5-18t-19.5-7q-14 0-23 10.5t-6 24.5q17 91 80 130t127 35Z',
  local_fire_department: 'M160-400q0-113 67-217t184-182q22-15 45.5-1.5T480-760v52q0 34 23.5 57t57.5 23q17 0 32.5-7.5T621-657q8-10 20.5-12.5T665-664q63 45 99 115t36 149q0 88-43 160.5T644-125q17-24 26.5-52.5T680-238q0-40-15-75.5T622-377L480-516 339-377q-29 29-44 64t-15 75q0 32 9.5 60.5T316-125q-70-42-113-114.5T160-400Zm320-4 85 83q17 17 26 38t9 45q0 49-35 83.5T480-120q-50 0-85-34.5T360-238q0-23 9-44.5t26-38.5l85-83Z',
});

/**
 * Material's own authoring box, and the fact that its origin is not zero.
 *
 * Every other box in this fleet spans `0 → box` on both axes; Material's spans
 * `0 → 960` in x and `-960 → 0` in y. Fitting it therefore needs its y origin,
 * not just its size — and getting that wrong draws the glyph one full box below
 * the plate, which renders as an empty pastille rather than as an error.
 */
const MATERIAL_BOX = 960;
const MATERIAL_Y_ORIGIN = -960;

/**
 * Raster size. Cesium's billboard atlas has no mipmaps, so a texture much
 * larger than its on-screen footprint is minified into mush; 88 covers the
 * 13–34 CSS px band `edfPowerPlants.js` draws at, the same figure the sibling
 * packs record.
 */
export const PLANT_GLYPH_RASTER_PX = 88;

/**
 * What each filière punches into its plate, and how much of the plate it takes.
 *
 * The fractions are not uniform because the artwork is not: the cooling tower
 * fills its own box corner to corner and carries a trefoil that has to stay
 * legible inside it, while the drop and the flame are tall narrow masses with
 * empty box on either side. Each is set so the punched shape reads at 16 px
 * without swallowing the hue that names its filière.
 */
const PUNCH = Object.freeze({
  // 0.58 and not more, and the number is geometry rather than taste: the tower
  // fills its own 15-unit box corner to corner, so its half-diagonal at
  // fraction f is 0.707 x 96f, which has to stay under the plate's radius of
  // 40. Above 0.59 the flare of the base is clipped by the disc and the mark
  // stops being a plate with a shape in it.
  nucleaire: Object.freeze({ borrow: Object.freeze(['temaki', 'cooling_tower_radiation']), fraction: 0.58 }),
  hydraulique: Object.freeze({ material: 'water_drop', fraction: 0.62 }),
  thermique: Object.freeze({ material: 'local_fire_department', fraction: 0.64 }),
});

/** Every filière that carries a silhouette — which is every filière EDF publishes. */
export const PLANT_SHAPED_FILIERES = Object.freeze(Object.keys(PUNCH));

/** @type {Map<string, string>} filière@px(+key) → data URI. */
const _cache = new Map();

const _b64 = (text) => (typeof btoa === 'function'
  ? btoa(text)
  : Buffer.from(text, 'utf8').toString('base64'));

/**
 * Fit artwork authored in `box` units into this module's 96-unit space, filling
 * `fraction` of it.
 *
 * A transform, never a rewrite: the vendored coordinates are handed to the SVG
 * renderer untouched, which is the claim both notices make and the reason the
 * artwork is still the artwork that was judged.
 *
 * @param {string} geometry `<path>` markup.
 * @param {number} box Authoring box of that markup.
 * @param {number} fraction Share of the 96-unit box the artwork should occupy.
 * @param {number} [yOrigin=0] Top edge of the authoring box on the y axis.
 * @returns {string} The markup wrapped in a centring transform.
 */
function fitted(geometry, box, fraction, yOrigin = 0) {
  const scale = (VIEW * fraction) / box;
  const offset = (VIEW - box * scale) / 2;
  return `<g transform="translate(${offset.toFixed(3)} ${(offset - yOrigin * scale).toFixed(3)}) `
    + `scale(${scale.toFixed(5)})">${geometry}</g>`;
}

/**
 * The silhouette one filière punches, already fitted into the 96-unit box.
 * @param {string} filiere
 * @returns {?string} SVG markup, or null for a filière with no mark.
 */
function punchFor(filiere) {
  const spec = PUNCH[filiere];
  if (!spec) return null;
  if (spec.material) {
    return fitted(`<path d="${MATERIAL_SYMBOL_PATHS[spec.material]}"/>`,
      MATERIAL_BOX, spec.fraction, MATERIAL_Y_ORIGIN);
  }
  const artwork = mapIconArtwork(...spec.borrow);
  // A vendored icon that disappeared upstream must not silently become a bare
  // plate: every filière here is pinned by `plantFiliereIcons.test.mjs`.
  if (!artwork) return null;
  return fitted(artwork.geometry, artwork.box, spec.fraction);
}

/**
 * The mark one filière is drawn with.
 *
 * Null is a VALID answer and the caller must handle it: EDF publishes three
 * filières and all three are here, but a fourth appearing in a future
 * republication must fall back to {@link plantUnknownGlyph} rather than
 * borrowing a picture of something it is not.
 *
 * @param {string|null|undefined} filiere Filière key, as `edfPlantsFeed` emits it.
 * @param {Object} [options]
 * @param {number} [options.px=PLANT_GLYPH_RASTER_PX] Raster size.
 * @param {boolean} [options.key=false] Omit the ring, for the masked key swatch.
 * @returns {?string} `data:image/svg+xml;base64,…`, or null for an unknown filière.
 */
export function plantFiliereGlyph(filiere, { px = PLANT_GLYPH_RASTER_PX, key = false } = {}) {
  const cacheKey = `${String(filiere ?? '')}@${px}${key ? ':key' : ''}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;

  const punch = punchFor(String(filiere ?? ''));
  if (!punch) return null;

  const uri = plate(punch, px, key);
  _cache.set(cacheKey, uri);
  return uri;
}

/**
 * The plate itself: a black ring, then a white disc with `punch` masked out of
 * it. `key: true` omits the ring — the on-map key masks its swatch and a CSS
 * mask reads ALPHA, so an opaque ring would flatten every filière into the same
 * plain dot, which is the one thing the shape channel exists to prevent.
 * @param {string} punch Fitted `<path>` markup, or '' for a bare plate.
 * @param {number} px Raster size.
 * @param {boolean} key Omit the ring.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
function plate(punch, px, key) {
  // The mask id is local to this document, and each glyph is its own data URI,
  // so no two of these can collide however many are on screen.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"`
    + ` viewBox="0 0 ${VIEW} ${VIEW}">`
    + `<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${VIEW}" height="${VIEW}">`
    + `<circle cx="${CENTRE}" cy="${CENTRE}" r="${DISC_R}" fill="#ffffff"/>`
    + `<g fill="#000000">${punch}</g></mask>`
    + (key ? '' : `<circle cx="${CENTRE}" cy="${CENTRE}" r="${DISC_R + RING_W / 2}" fill="${RING_COLOR}"/>`)
    + `<circle cx="${CENTRE}" cy="${CENTRE}" r="${DISC_R}" fill="#ffffff" mask="url(#m)"/>`
    + '</svg>';
  return `data:image/svg+xml;base64,${_b64(svg)}`;
}

/**
 * The mark for a filière this module has no silhouette for: the bare plate.
 *
 * It is NOT a fourth subject — it is the pastille every place pack in this
 * fleet falls back to, kept for the one case where drawing a shape would be a
 * claim: EDF publishes three filières today, and a fourth appearing in a future
 * republication must arrive as "a station, and we cannot tell you which kind"
 * rather than wearing whichever of the three looked closest.
 * @param {number} [px=PLANT_GLYPH_RASTER_PX] Raster size.
 * @param {Object} [options]
 * @param {boolean} [options.key=false] Omit the ring, for the masked key swatch.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function plantUnknownGlyph(px = PLANT_GLYPH_RASTER_PX, { key = false } = {}) {
  const cacheKey = `plate@${px}${key ? ':key' : ''}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;
  const uri = plate('', px, key);
  _cache.set(cacheKey, uri);
  return uri;
}

/** Raw path data, for the tests that pin the vendored geometry. */
export function _plantSymbolPathsForTest() {
  return { ...MATERIAL_SYMBOL_PATHS };
}

/** Raw punches, for tests that assert the silhouettes actually differ. */
export function _plantPunchesForTest() {
  return Object.fromEntries(PLANT_SHAPED_FILIERES.map((key) => [key, punchFor(key)]));
}
