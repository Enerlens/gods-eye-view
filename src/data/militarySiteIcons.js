/**
 * @module militarySiteIcons
 *
 * The MARK of a mapped military site — one per class of the key
 * `militaryInstallations.js` publishes: a tinted plate with the class's
 * silhouette punched out of it.
 *
 * ── WHY A PLATE, WHEN THE SILHOUETTES ALREADY SHIPPED ───────────────────────
 *
 * The first version of this module drew bare silhouettes over a soft halo, the
 * treatment the vehicle packs use. On a live globe that failed, and the failure
 * was measurable rather than a matter of taste: at the top of this layer's own
 * distance ramp the catch-all was drawn at 20 px × 0.5 = **10 CSS px**, and a
 * 10 px silhouette over an orthophoto is a smudge the same size and value as
 * the field texture behind it. Rendered over three crops of a real Gironde
 * capture — forest, urban, water — the bare shapes were unfindable below 18 px;
 * a plate is still a plate at 10.
 *
 * A plate is not a new idiom here either. It is what the four local packs
 * already draw for static ground sites (`localGeojson.js`: a 10 px disc with a
 * 2 px black outline), and that mark stays visible exactly where the bare
 * silhouettes disappear. What this module adds is the class INSIDE it: the
 * pastille says "there is a site here" at any size, and the punched shape says
 * which kind as soon as the ramp allows it.
 *
 * The distinction that decides it: a vehicle is a moving object that a reader
 * follows, and a silhouette against the world is right for that. A base is a
 * PLACE on a photograph of places, competing with roofs, fields and roads for
 * the same pixels. Marks for places carry a plate; marks for things do not.
 *
 * ── WHAT IS BORROWED, AND FROM WHERE ────────────────────────────────────────
 *
 * Nothing is drawn from scratch that a public-domain map set already draws:
 *
 *   - `airfield` — Temaki's `fighter_jet`, a combat aircraft in plan view.
 *   - `naval_base` — Maki's `harbor`, an anchor.
 *
 * Both are CC0, both are vendored in `mapIcons.js` and fetched through its
 * public door, so one copy of each path exists in the repository. Both replaced
 * a Material Symbols INTERFACE glyph borrowed from the transit pack — an
 * airliner and a passenger ferry. Those said "aviation" and "boat" where the
 * OSM tag says "air base" and "arsenal", and neither survived being reduced to
 * a punch in a 16 px plate: the airliner became a cross, the ferry a blob.
 *
 * The remaining two classes are GEOMETRY, not artwork — circles, and a shield
 * that is four lines and two curves. There is no authored letterform or
 * silhouette to recognise in either, so vendoring one would buy nothing:
 *
 *   - `range` — a bullseye. Neither CC0 set carries a target; Temaki's
 *     `archery` is an archer with a bow, which names a sport.
 *   - `military_land` — a heater shield, the plainest sign of a defence
 *     establishment there is. It is the fourre-tout (39 of Toulon's 44
 *     records), so its mark must say "military" and refuse to say anything
 *     narrower. Temaki's own `military` — the glyph the iD editor uses for
 *     `landuse=military` — is a star hanging from a medal ribbon, and it was
 *     measured against the shield on the same three backdrops: it collapses
 *     into noise below 18 px where the shield still reads by its outline.
 *
 * ── HOW THE PUNCH IS MADE, AND WHY IT IS A MASK ─────────────────────────────
 *
 * `fill-rule="evenodd"` only spans the subpaths of ONE path element, so it
 * cannot punch a hole through artwork that arrives as several paths inside a
 * `<g transform>` — which is every borrowed icon, since fitting a 15- or
 * 48-unit box into this 96-unit plate is a transform. The hole is therefore an
 * SVG `<mask>`: a white disc with the silhouette painted black over it.
 *
 * ── TINT-SAFE BY CONSTRUCTION, like every other pack in this fleet ──────────
 *
 * Cesium multiplies `billboard.color` into the texture. The plate is WHITE, so
 * it takes the class colour exactly; the ring behind it is black, and black
 * survives any multiply (0 × c = 0). The punched silhouette is a hole, so what
 * shows through it is that same ring — a dark shape on a coloured plate, whose
 * contrast does not depend on what the site happens to sit on. No hue is baked
 * into the artwork, and a class colour can be changed in one place.
 *
 * ── THE KEY GETS THE SAME MARK WITH ITS RING REMOVED ────────────────────────
 *
 * The on-map key masks its swatch, and a CSS mask reads ALPHA. The map mark's
 * ring makes the whole disc opaque, so masking it would flatten every class
 * into the same plain dot — the one thing the shape channel exists to prevent.
 * `{ key: true }` returns the identical geometry with the ring pass omitted:
 * the swatch is then a coloured disc with the silhouette showing through as a
 * transparent shape, which is the same mark read against the panel instead of
 * against a photograph.
 */
import { mapIconArtwork } from './mapIcons.js';

/** Glyph coordinate space. Same 96-unit box the other marker packs author to. */
const VIEW = 96;
const CENTRE = VIEW / 2;

/**
 * Plate radius and the ring around it, in box units.
 *
 * The ring is what makes the mark survive a pale roof or a sandbank: the plate
 * carries the class hue, the ring carries the edge. 7 units is ~7% of the box,
 * close to the 10.4% halo the vehicle packs stroke — narrower on purpose,
 * because a halo has to outline a thin silhouette while this only has to
 * outline a disc.
 */
const DISC_R = 40;
const RING_W = 7;

/**
 * Ring colour.
 *
 * Darker than the fleet's `rgba(0,0,0,0.62)` halo, and deliberately: a halo is
 * a soft shadow around ink that already reads, while this ring is the mark's
 * only edge and the only thing separating a pale plate from a pale field. It is
 * the same black; only the alpha differs.
 */
const RING_COLOR = 'rgba(0,0,0,0.86)';

/**
 * Raster size. Cesium's billboard atlas has no mipmaps, so a texture much
 * larger than its on-screen footprint is minified into mush; 88 covers the
 * 14–36 CSS px band this layer draws at, the same figure the three sibling
 * packs record.
 */
export const MILITARY_GLYPH_RASTER_PX = 88;

/** A circle as a path, so several can share one `fill-rule="evenodd"` shape. */
const circlePath = (cx, cy, r) => `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0 Z`;

/**
 * Fit artwork authored in `box` units into this module's 96-unit space, filling
 * `fraction` of it.
 *
 * A transform, never a rewrite: the vendored coordinates are handed to the SVG
 * renderer untouched, which is the claim both CC0 notices make and the reason
 * the artwork is still the artwork that was judged.
 *
 * @param {string} geometry `<path>` markup.
 * @param {number} box Authoring box of that markup.
 * @param {number} fraction Share of the 96-unit box the artwork should occupy.
 * @returns {string} The markup wrapped in a centring transform.
 */
function fitted(geometry, box, fraction) {
  const scale = (VIEW * fraction) / box;
  const offset = (VIEW - box * scale) / 2;
  return `<g transform="translate(${offset.toFixed(3)} ${offset.toFixed(3)}) `
    + `scale(${scale.toFixed(5)})">${geometry}</g>`;
}

/**
 * The bullseye of a firing range: a ring and a bull, with the band between them
 * punched.
 *
 * ONE path with two subpaths and `fill-rule="evenodd"`, which is the one place
 * that rule still works here — both subpaths are in the same element. The gap
 * has to be a hole rather than a drawn dark band so the key's masked swatch
 * still reads as a target instead of a filled dot.
 */
const TARGET_PUNCH = `<path fill-rule="evenodd" d="${circlePath(CENTRE, CENTRE, 26)}${circlePath(CENTRE, CENTRE, 13)}"/>`;

/**
 * The heater shield of the catch-all: two straight shoulders and two curves
 * into the point. At map size a heraldic shape reads by its outline alone, and
 * any charge inside it would be mush at the size this class is drawn.
 */
const SHIELD_PATH = '<path d="M48,9 L80,19 V47 Q80,73 48,87 Q16,73 16,47 V19 Z"/>';

/**
 * What each class punches into its plate, and how much of the plate it takes.
 *
 * The fractions are not uniform because the artwork is not: a jet is mostly
 * empty box (a wing span with air above and below it), an anchor is a tall
 * narrow mass, and the shield already fills its own box corner to corner. Each
 * is set so the punched shape reads at 16 px without swallowing the hue that
 * names its class — the reason the shield takes the smallest share of all.
 *
 * Borrowed entries name a vendored icon; drawn entries carry their own markup.
 */
const PUNCH = Object.freeze({
  airfield: Object.freeze({ borrow: Object.freeze(['temaki', 'fighter_jet']), fraction: 0.60 }),
  naval_base: Object.freeze({ borrow: Object.freeze(['maki', 'harbor']), fraction: 0.56 }),
  range: Object.freeze({ markup: TARGET_PUNCH, box: VIEW, fraction: 1 }),
  military_land: Object.freeze({ markup: SHIELD_PATH, box: VIEW, fraction: 0.48 }),
});

/** Every class that carries a silhouette — which is every class there is. */
export const MILITARY_SHAPED_CLASSES = Object.freeze(Object.keys(PUNCH));

/** @type {Map<string, string>} class@px(+key) → data URI. */
const _cache = new Map();

const _b64 = (text) => (typeof btoa === 'function'
  ? btoa(text)
  : Buffer.from(text, 'utf8').toString('base64'));

/**
 * The silhouette one class punches, already fitted into the 96-unit box.
 * @param {string} klass
 * @returns {?string} SVG markup, or null for a class with no mark.
 */
function punchFor(klass) {
  const spec = PUNCH[klass];
  if (!spec) return null;
  if (spec.markup) return fitted(spec.markup, spec.box, spec.fraction);
  const artwork = mapIconArtwork(...spec.borrow);
  // A vendored icon that disappeared upstream must not silently become a bare
  // plate: every class here is pinned by `militarySiteIcons.test.mjs`.
  if (!artwork) return null;
  return fitted(artwork.geometry, artwork.box, spec.fraction);
}

/**
 * The mark one installation class is drawn with.
 *
 * Null is a VALID answer and the caller must handle it: a class this module has
 * never heard of falls back to the bare pastille the layer drew before it had
 * shapes, rather than borrowing a silhouette that would name it something it is
 * not. Every class the normalizer can currently emit has one, and
 * `militaryInstallations.test.mjs` holds that closed.
 *
 * @param {string} klass Installation class, as `militaryInstallationData` emits it.
 * @param {Object} [options]
 * @param {number} [options.px=MILITARY_GLYPH_RASTER_PX] Raster size.
 * @param {boolean} [options.key=false] Omit the ring, for the masked key swatch.
 * @returns {?string} `data:image/svg+xml;base64,…`, or null for an unknown class.
 */
export function militarySiteGlyph(klass, { px = MILITARY_GLYPH_RASTER_PX, key = false } = {}) {
  const cacheKey = `${String(klass || '')}@${px}${key ? ':key' : ''}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;

  const punch = punchFor(String(klass || ''));
  if (!punch) return null;

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
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _cache.set(cacheKey, uri);
  return uri;
}

/** Raw punches, for tests that assert the silhouettes actually differ. */
export function _militaryGlyphPunchesForTest() {
  return Object.fromEntries(MILITARY_SHAPED_CLASSES.map((klass) => [klass, punchFor(klass)]));
}
