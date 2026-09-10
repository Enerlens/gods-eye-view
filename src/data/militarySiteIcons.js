/**
 * @module militarySiteIcons
 *
 * The SHAPE of a mapped military site — one silhouette per class of the key
 * `militaryInstallations.js` publishes, so a reader can name a mark without
 * matching two cyans against each other.
 *
 * ── WHY A SHAPE AT ALL, WHEN THE KEY ALREADY SHIPPED ────────────────────────
 *
 * The key decodes the colour, and colour was the ONLY channel: four hues on
 * identical 9 px dots, two of them (#5aa9ff base aérienne, #48c7d5 base navale)
 * a step apart on the same blue. A reader who has to carry a hue across the
 * screen to the panel is doing the key's work by eye. The silhouette answers
 * where the mark is, and the key keeps saying what the colour means — the two
 * now agree instead of one carrying everything.
 *
 * ── WHAT IS BORROWED, AND WHAT IS DELIBERATELY NOT ──────────────────────────
 *
 * Nothing here is drawn from scratch that already exists:
 *
 *   - the aeroplane and the ship are Material Symbols, already vendored in
 *     `transitVehicleIcons.js` for the `air` and `ferry` transit modes.
 *
 * What is NOT borrowed is the TREATMENT of the address-marker pack next door.
 * Its bodies are line art — a 7-unit stroke in a 96-unit box, roughly 7% ink —
 * drawn at 14 to 30 CSS px, and at map size a hairline outline reads as a
 * character typed onto the photo rather than as a mark placed on it.
 * Everything here is SOLID: a filled silhouette, or a ring with real width,
 * over a wide dark halo.
 *
 * ── THE CATCH-ALL GETS THE MOST GENERIC MARK THERE IS ───────────────────────
 *
 * `military_land` is the fourre-tout — `landuse=military` plus `barracks` and
 * `base`, 39 of Toulon's 44 records — so its mark must say "military" and
 * refuse to say anything else. It carries a shield: no vehicle, no target, no
 * activity, the sign of a defence establishment and nothing narrower. A
 * barracks glyph or a tank would claim a precision the tag does not hold.
 *
 * It shipped as a bare pastille first, and a dot is a defensible picture of
 * "we cannot tell you more" — but it is also indistinguishable from a mark that
 * simply has not loaded yet, and it left the layer's most common class as the
 * only one a reader could not name. The size is where "says less" is now
 * spoken: `militaryInstallations.js` draws this one smaller than the three that
 * name a subject.
 *
 * ── TINT-SAFE BY CONSTRUCTION, like every other pack in this fleet ──────────
 *
 * One geometry, two passes: a wide dark halo first, the white artwork second.
 * Cesium multiplies `billboard.color` into the texture, so white takes the
 * class colour exactly while black survives the multiply (0 × c = 0) and keeps
 * the glyph readable over a pale orthophoto. No hue is baked into the artwork.
 *
 * The same rasters serve the on-map key, where the swatch masks them: a mask
 * reads ALPHA, so a glyph whose gaps are transparent (the target's) still reads
 * as a target at 14 px, which a glyph backed by an opaque disc would not.
 */
import { transitVehicleGlyph } from './transitVehicleIcons.js';

/** Glyph coordinate space. Same 96-unit box the other marker packs author to. */
const VIEW = 96;
const CENTRE = VIEW / 2;

/** Halo colour, identical to every other pack so the sets stay one look. */
const HALO_COLOR = 'rgba(0,0,0,0.62)';
/**
 * Halo width, in box units.
 *
 * ~10.4% of the box, the ratio `transitVehicleIcons` strokes (110 of 960) and
 * `mapIcons` matched. Keeping the proportion is what lets a Material aeroplane
 * and the target drawn below read as one renderer on one globe.
 */
const HALO_STROKE = 10;

/**
 * Raster size. Cesium's billboard atlas has no mipmaps, so a texture much
 * larger than its on-screen footprint is minified into mush; 88 covers the
 * 12–32 CSS px band this layer draws at, the same figure the three sibling
 * packs record.
 */
export const MILITARY_GLYPH_RASTER_PX = 88;

/** A circle as a path, so several can share one `fill-rule="evenodd"` shape. */
const circlePath = (cx, cy, r) => `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0 Z`;

/**
 * The target: a ring and a bull, the sign a firing range is marked with
 * everywhere.
 *
 * Drawn here rather than borrowed because the two vendored targets in this
 * repository are line art from the pack whose treatment this module exists to
 * avoid — and because a ring and a disc are geometry, not artwork: there is
 * nothing to recognise that a type or icon designer authored.
 *
 * The gap between ring and bull is left TRANSPARENT and filled by the halo
 * pass. Painting it dark instead would make the whole glyph opaque, which costs
 * nothing on the globe but flattens the key's masked swatch into a plain disc.
 */
const TARGET_GEOMETRY = `${circlePath(CENTRE, CENTRE, 39)}${circlePath(CENTRE, CENTRE, 28)}`
  + circlePath(CENTRE, CENTRE, 12);

function targetPasses() {
  const shape = `<path d="${TARGET_GEOMETRY}" fill-rule="evenodd"/>`;
  return {
    halo: `<g fill="${HALO_COLOR}" stroke="${HALO_COLOR}" stroke-width="${HALO_STROKE}"`
      + ` stroke-linejoin="round">${shape}</g>`,
    fill: `<g fill="#ffffff" stroke="none">${shape}</g>`,
  };
}

/**
 * The shield of the catch-all: a heater outline, the plainest sign of a
 * defence establishment that exists.
 *
 * Geometry rather than a borrowed icon, for the same reason as the target —
 * there is no authored letterform or silhouette to recognise here — and SOLID
 * rather than an outline, so the class that owns nine marks in ten never
 * dissolves into a ring at 12 px. Two straight shoulders and two curves into
 * the point: at map size a heraldic shape reads by its outline alone, and any
 * charge inside it would be mush.
 */
const SHIELD_GEOMETRY = 'M48,9 L80,19 V47 Q80,73 48,87 Q16,73 16,47 V19 Z';

function shieldPasses() {
  const shape = `<path d="${SHIELD_GEOMETRY}"/>`;
  return {
    halo: `<g fill="${HALO_COLOR}" stroke="${HALO_COLOR}" stroke-width="${HALO_STROKE}"`
      + ` stroke-linejoin="round">${shape}</g>`,
    fill: `<g fill="#ffffff" stroke="none">${shape}</g>`,
  };
}

/**
 * The transit mode each borrowed Material silhouette is fetched by.
 *
 * Indirect on purpose: `transitVehicleIcons` publishes glyphs by TRANSIT KIND,
 * and going through its public door is what keeps one aeroplane in the
 * repository instead of two copies of one path drifting apart.
 */
const BORROWED_TRANSIT_KIND = Object.freeze({
  airfield: 'air',
  naval_base: 'ferry',
});

/** The builders this module draws itself, by class. */
const DRAWN = Object.freeze({
  range: targetPasses,
  military_land: shieldPasses,
});

/** Every class that carries a silhouette — which is every class there is. */
export const MILITARY_SHAPED_CLASSES = Object.freeze([
  ...Object.keys(BORROWED_TRANSIT_KIND), ...Object.keys(DRAWN),
]);

/** @type {Map<string, string>} class@px → data URI. */
const _cache = new Map();

const _b64 = (text) => (typeof btoa === 'function'
  ? btoa(text)
  : Buffer.from(text, 'utf8').toString('base64'));

/**
 * The silhouette one installation class is drawn with.
 *
 * Null is a VALID answer and the caller must handle it: a class this module
 * has never heard of falls back to the bare pastille the layer drew before it
 * had shapes, rather than borrowing a silhouette that would name it something
 * it is not. Every class the normalizer can currently emit has one, and
 * `militaryInstallations.test.mjs` holds that closed.
 *
 * @param {string} klass Installation class, as `militaryInstallationData` emits it.
 * @param {Object} [options]
 * @param {number} [options.px=MILITARY_GLYPH_RASTER_PX] Raster size.
 * @returns {?string} `data:image/svg+xml;base64,…`, or null for an unknown class.
 */
export function militarySiteGlyph(klass, { px = MILITARY_GLYPH_RASTER_PX } = {}) {
  const key = String(klass || '');
  const borrowed = BORROWED_TRANSIT_KIND[key];
  if (borrowed) return transitVehicleGlyph(borrowed, { px });
  const passes = DRAWN[key];
  if (!passes) return null;

  const cacheKey = `${key}@${px}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;

  const { halo, fill } = passes();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"`
    + ` viewBox="0 0 ${VIEW} ${VIEW}">${halo}${fill}</svg>`;
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _cache.set(cacheKey, uri);
  return uri;
}

/** Raw geometry, for tests that assert the silhouettes actually differ. */
export function _militaryGlyphPassesForTest() {
  return Object.fromEntries(Object.entries(DRAWN).map(([key, passes]) => [key, passes()]));
}
