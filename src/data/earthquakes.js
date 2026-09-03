import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { PRISM_HEIGHT_SWATCH_COLOR, prismHeightGlyph } from './choroplethPrism.js';

/**
 * USGS earthquakes — last 24 hours, M2.5+, drawn as a 3D phenomenon.
 *
 * ── What this draws ─────────────────────────────────────────────────────────
 *
 *   · a POINT at the epicentre, clamped to the ground, whose diameter is in
 *     CONSTANT SCREEN PIXELS and carries the MAGNITUDE;
 *   · a vertical LINE rising from that epicentre whose length, in world
 *     metres at 1:1, is the FOCAL DEPTH — an inverted depth ruler, not the
 *     position of the focus (see "why the ruler points up");
 *   · one COLOUR shared by the point and its ruler, carrying the AGE of the
 *     event inside the 24 h window (A2).
 *
 * ── What it replaced, and why ───────────────────────────────────────────────
 *
 * Until this rewrite the layer drew one CLAMP_TO_GROUND ellipse per event of
 * radius `2^magnitude × 1000` metres, tinted red / orange / yellow by depth
 * band. Two faults, both named in `docs/REPRESENTATION.md`:
 *
 * (1) THE RADIUS MEASURED NOTHING. `2^M × 1000 m` is not the rupture area, not
 *     the felt radius, not an isoseismal, not a ShakeMap contour. It is a
 *     decorative exponential wearing the costume of a measurement: 5.6 km at
 *     M2.5, 128 km at M7, 512 km at M9. A reader saw a footprint and there was
 *     no footprint. Worse, it was drawn in WORLD units, so the mark also broke
 *     B2 — screen size on a globe is already spent on depth, and a distant M7
 *     could render smaller than a nearby M3 under a legend claiming otherwise.
 *
 * (2) DEPTH — a continuous quantitative variable — WAS ENCODED IN HUE, red →
 *     orange → yellow. B4: « la teinte n'ordonne pas ». That ramp reads as a
 *     SEVERITY scale, so a 600 km-deep event, whose depth is the single
 *     remarkable thing about it, was painted yellow and therefore "mild".
 *
 * ── A3 · what each channel carried, and what it carries now ────────────────
 *
 *   | channel        | before                    | now                        |
 *   |----------------|---------------------------|----------------------------|
 *   | world radius   | 2^magnitude (meaningless) | not used                   |
 *   | hue            | depth band                | AGE in the 24 h window     |
 *   | fill alpha     | M5+ emphasis (redundant)  | constant                   |
 *   | outline width  | M5+ emphasis (redundant)  | constant                   |
 *   | screen pixels  | not used                  | MAGNITUDE                  |
 *   | world height   | not used                  | DEPTH, 1:1                 |
 *
 * The M5+ emphasis was a second, coarser copy of the magnitude channel; with
 * magnitude now on a continuous pixel scale it is deleted rather than kept
 * "for punch". Alpha and outline width are constants and say nothing.
 *
 * ── Magnitude → pixels: the relation, and why this one ─────────────────────
 *
 * `pixelSize = 6 + 3 × (M − 2.5)`, clamped to the frozen domain M2.5…M9.5
 * (C1 — the feed floor and the largest instrumentally recorded earthquake,
 * Valdivia 1960 at Mw 9.5). So M2.5 → 6 px, M5 → 13.5 px, M7 → 19.5 px,
 * M9 → 25.5 px, and every whole magnitude step is the same 3 px step.
 *
 * The two alternatives were rejected with arithmetic, not taste:
 *
 *   · AREA ∝ ENERGY, the Bertin proportional circle applied to what the event
 *     actually released. Mw = ⅔·log₁₀(M₀) − 6.06, so one magnitude unit is
 *     ×31.6 of seismic moment and the diameter would go as 10^(0.75·M): from
 *     M2.5 to M9 that is a factor 10^4.875 ≈ 75 000. A 6 px M2.5 makes a
 *     450 000 px M9. Undrawable, so unusable.
 *   · AREA ∝ MAGNITUDE, treating the published number as if it were a count.
 *     Diameter would go as √M: M9 would be 1.9× the diameter of M2.5. The most
 *     important event on the map would be twice a background tremor. Under-
 *     stating by 4 decimal orders is not more honest than overstating.
 *
 * A diameter LINEAR IN MAGNITUDE encodes the number the feed publishes and the
 * number the reader has heard on the radio, and it puts equal magnitude steps
 * at equal pixel steps — which is exactly how the scale is quoted. The legend
 * says so in as many words: the mark measures the MAGNITUDE, not the energy.
 * An M7 disc is 3.25× the M2.5 disc across while releasing about 5.6 million
 * times the energy, and that gap belongs written down, not hidden in a radius.
 *
 * Pixels, not metres: `PointGraphics.pixelSize` is constant on screen and is
 * never composed with `scaleByDistance` here (B2). Deliberately no
 * `scaleByDistance`, no `translucencyByDistance`, no `distanceDisplayCondition`
 * on the mark — any of the three would multiply the thematic size by a
 * function of range and reintroduce the inversion this rewrite removes.
 *
 * ── Depth → a vertical ruler, and why it points UP ─────────────────────────
 *
 * A focus IS below its epicentre and a globe CAN draw it there, so the first
 * design put the stem underground. It cannot be made honest, and the reason is
 * that the globe is opaque. Three options were built and looked at in a real
 * browser (Chromium, dev server, live USGS feed, 2026-09-03):
 *
 *   (a) STEM UNDERGROUND WITH `disableDepthTestDistance`. Built and looked at.
 *       It draws THROUGH THE PLANET, and the size of that lie was counted
 *       rather than guessed: parked over the antipode of the day's deepest
 *       event (Fiji, 581 km), 26 of the 28 M2.5+ events were on the FAR
 *       hemisphere and all 26 projected inside the 1440×900 viewport. With the
 *       depth test defeated the frame therefore shows 28 marks of which 26 are
 *       phantoms — verified on screen, with Fijian and Tongan events painted
 *       over Mali, Niger, Türkiye and the United Kingdom. That is the X-ray
 *       image F1 forbids, and a hemisphere the reader is not looking at
 *       leaking into the one they are.
 *       A second failure, subtler and worse, showed up in the grazing view: an
 *       underground stem drawn with `depthFailMaterial` projects into exactly
 *       the same screen direction as a line lying FLAT on the water running
 *       toward the camera. Seen from above, "down" and "toward me" are the
 *       same pixels. The sign cannot mean depth even when the reader is
 *       willing to believe it does.
 *   (b) STEM UNDERGROUND WITH `scene.globe.translucency`. Measured for the
 *       record before being rejected. `frontFaceAlpha = 0.45`, same camera,
 *       same live feed, took the WHOLE SCENE from a 0.30 ms median
 *       `scene.render()` to 1.30–2.40 ms median and 3.50–7.30 ms p90 across
 *       two runs — a factor of four to eight, paid by every other enabled
 *       layer, for one layer's symbology. And the scope objection stands on
 *       its own: `scene.globe` is a GLOBAL object owned by no layer, and
 *       turning the planet transparent repaints every other reading on the
 *       map. One layer's symbology may not redefine the planet.
 *   (c) THE RULER ABOVE THE SURFACE — chosen. The line rises from the
 *       epicentre and its LENGTH is the depth, at 1:1. It is a declared
 *       reading device, not a position claim, and the legend says exactly
 *       that: « la tige monte, le foyer descend ». A1 is satisfied because the
 *       sign asserts no position that was not measured — the only position it
 *       asserts is the epicentre, which IS measured, and the only length it
 *       asserts is the depth, which IS measured. At the antipode nothing from
 *       the far hemisphere appears at all: the two marks genuinely in view are
 *       the two marks drawn.
 *
 * 1:1 and not exaggerated, which self-scales rather well. Seen on screen on
 * the live feed, on the Fiji event at 581 km and its 145 km neighbour:
 *
 *   · 1 400 km slant range, 40° pitch — the 581 km ruler runs off the top of
 *     the frame while the 145 km one is about a third of its height. The two
 *     depths are read against each other in one glance, which is the whole
 *     point and is what the old three colour bands could never do.
 *   · 900 km range, 4° pitch (horizon view) — both rulers stand vertically
 *     against the sky, unambiguous, and the epicentre marks sit on the limb.
 *   · 40 km regional altitude — a 10 km ruler is the tall object in frame.
 *
 * The one honest limit, and it is inherent to any vertical encoding on a
 * globe: AT NADIR A VERTICAL LINE HAS NO SCREEN LENGTH. Straight down over the
 * Fiji event from 14 000 km, the 581 km ruler is foreshortened to nothing and
 * only the magnitude marks read. The ruler's legibility is a function of
 * camera PITCH, not of altitude, and the reader tilts to read depth exactly as
 * they would to read any prism on this globe. That is stated rather than
 * papered over with a billboard.
 *
 * An exaggeration factor would have had to be published, defended and
 * remembered; 1:1 needs none of that, and it keeps the ruler measurable
 * against the anchored ground scale (F2).
 *
 * DATUM, stated because it is a real approximation. USGS publishes depth below
 * sea level, and the ruler's foot is placed on the WGS84 ellipsoid (h = 0),
 * not on the terrain: the anchor and the measurement then share one datum, and
 * two readers of the same share link get the same ruler. The cost is that over
 * relief the first kilometres of the ruler are inside the mountain — up to
 * ~8.8 km at the extreme, more usually a few hundred metres — so the VISIBLE
 * ruler under-reads by the local elevation. It is not corrected by sampling
 * terrain: `globe.getHeight()` answers from whatever tiles happen to be
 * loaded, which would make the same event draw a different length in two
 * sessions. A deterministic small error beats a non-reproducible small
 * correction. The epicentre point is CLAMP_TO_GROUND, so it always sits on the
 * visible surface and the ruler emerges exactly from it.
 *
 * ── Colour → age, freed by the geometry (A2) ───────────────────────────────
 *
 * Four frozen bands — ≤1 h, 1–6 h, 6–12 h, 12–24 h — on a single warm hue
 * varying in VALUE, so the order survives greyscale as B4 demands. Measured
 * sRGB relative luminance: 0.891 → 0.603 → 0.320 → 0.105, strictly decreasing,
 * every neighbouring pair separated by a factor ≥ 1.5. An event twenty minutes
 * old and one twenty-three hours old are now different marks without opening
 * anything.
 *
 * The bands are DOMAIN thresholds (C1): they are hours, not quantiles, they are
 * never recomputed from the current feed or the current view, and the same
 * event reads the same in two sessions.
 *
 * ── A1 · the three fallbacks, all visible, all counted ─────────────────────
 *
 *   · AGE NOT PUBLISHED (no `time`, or a timestamp more than 5 min in the
 *     future, i.e. a clock nobody can trust): slate `#7f8c99`, off the warm
 *     ramp entirely, with its own legend row and count. Its greyscale
 *     luminance (0.256) does sit between the 6–12 h and 12–24 h bands, and
 *     that is accepted rather than fixed: « non publié » is a NOMINAL state,
 *     not a rank on the ordered scale, and B4 gives hue exactly that job —
 *     hue differentiates, value orders.
 *   · DEPTH NOT PUBLISHED: no ruler at all, and the point is drawn HOLLOW —
 *     transparent fill, coloured ring. A missing ruler alone would be
 *     ambiguous with a shallow one, so the shape carries the distinction and
 *     the legend counts the row.
 *   · DEPTH MEASURED AT OR ABOVE SEA LEVEL (USGS publishes 0.0 km, and
 *     negative depths for shallow and induced events): a floor ruler of 1 km
 *     is drawn, because « mesuré à zéro » must not render as « non mesuré ».
 *     Same argument as `choroplethPrism`'s 1 px baseline, same legend row.
 *
 * ── A5 · what is clipped ───────────────────────────────────────────────────
 *
 * Every event above M2.5 in the feed is DRAWN. What is capped is the floating
 * magnitude LABEL: {@link EARTHQUAKE_OVERLAY_COHORT_LIMIT} of them, selected
 * by descending magnitude with the event id as tie-break
 * ({@link selectEarthquakeOverlayCohort}). The legend publishes
 * « n étiquettes / N séismes » and the criterion whenever the cap bites.
 *
 * ── F1 · occlusion policy: regime (a), occluded ────────────────────────────
 *
 * Point and ruler both keep the depth test. Behind a mountain or a
 * photorealistic building they disappear, like anything else in the world.
 * Nothing here is drawn as "guessed", because nothing here needs to be.
 *
 * ── Performance ────────────────────────────────────────────────────────────
 *
 * The pin inherited from the 2026-08-20 hunt still holds and still matters:
 * axes/geometry are STATIC, redefined only when a poll brings new data, and a
 * `CallbackProperty` must never come back. Measured then, parked camera over
 * SF at 40 km, on the shipped 58-event feed:
 *
 *   58 clamped discs, callback axes → 32.4 ms/frame, 30 fps
 *   58 clamped discs, static axes   →  1.4 ms/frame, 60 fps
 *
 * The new geometry costs less than that, by construction and by measurement.
 * By construction: the CLAMP_TO_GROUND ellipses were N ground primitives, each
 * needing a classification pass against terrain and tiles; they are gone. What
 * replaces them BATCHES — N points collapse into one `PointPrimitiveCollection`
 * and N rulers into one `PolylineCollection` — so the draw-call count stops
 * growing with the feed.
 *
 * By measurement, 2026-09-03, headless Chromium on the dev server, camera
 * parked obliquely over the Atlantic, a SYNTHETIC 600-event feed (21× the 28
 * events the live feed carried that day), `scene.render()` + `gl.finish()`,
 * 120 timed frames per run, layer toggled ON/OFF three times to cancel drift:
 *
 *   600 points + 600 rulers ON → 1.00 ms median  (p10 0.70 / p90 1.60)
 *   layer OFF                  → 0.80 ms median  (p10 0.50 / p90 1.40)
 *
 * i.e. +0.20 ms at 600 events, which is inside this rig's own noise: the
 * difference between two consecutive OFF runs was 0.50 ms. On the live 28-event
 * feed the layer is not measurable at all. The number to distrust is the
 * absolute one — this is a software rasteriser (SwiftShader), not the GPU a
 * reader has — but the SHAPE holds: the cost does not scale with the feed, and
 * it never approaches the 32.4 ms the callback axes used to cost.
 *
 * Nothing is per-frame. The AGE colour is the one thing here that changes with
 * the clock, and it is rebanded ON POLL — every 60 s — not per frame: the
 * narrowest band is one hour, so a band boundary is crossed at worst 60 polls
 * late by 60 s, i.e. 1.7 % of the narrowest band. Paying 60 fps to sharpen
 * that would be the exact trade the 2026-08-20 hunt refused. With no per-frame
 * animator the layer still holds no continuous-render lock; the manager's
 * `layer-tick` / `layer-visibility` requests cover every mutation it makes.
 */

const API_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';

export const EARTHQUAKE_OVERLAY_SOURCE_ID = 'earthquakes';
export const EARTHQUAKE_OVERLAY_COHORT_LIMIT = 96;
export const EARTHQUAKE_OVERLAY_COLLISION_CAPACITY = 48;

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

// ---------------------------------------------------------------------------
// Magnitude → constant screen pixels (B2)
// ---------------------------------------------------------------------------

/** Feed floor. Micro-quakes below this are not drawn and never were. */
export const EARTHQUAKE_MAG_FLOOR = 2.5;
/** Top of the frozen display domain: Valdivia 1960, the largest ever recorded. */
export const EARTHQUAKE_MAG_DOMAIN_MAX = 9.5;
/** Diameter of an event sitting exactly on the feed floor. */
export const EARTHQUAKE_MAG_BASE_PX = 6;
/** Diameter added per whole magnitude unit — the scale's own step, in pixels. */
export const EARTHQUAKE_MAG_PX_PER_UNIT = 3;
/** Magnitudes printed in the legend's size ruler. */
export const EARTHQUAKE_MAG_TICKS = Object.freeze([3, 5, 7, 9]);

/**
 * Screen diameter, in constant pixels, for one magnitude.
 *
 * Linear in magnitude by design — see the header. Clamped to the frozen
 * domain at both ends so a mis-parsed feed cannot produce a 400 px blob, and
 * so the mark keeps the same meaning session to session (C1).
 * @param {number} magnitude USGS magnitude.
 * @returns {number|null} Pixels, or null when the magnitude is not a number.
 */
export function magnitudePixelSize(magnitude) {
  // `typeof` before `Number()`: `Number(null)` is 0, so a feed field that is
  // absent would otherwise come back as a drawable floor-sized mark instead of
  // an unmeasured one (A1).
  if (typeof magnitude !== 'number' || !Number.isFinite(magnitude)) return null;
  const mag = magnitude;
  const clamped = Math.min(EARTHQUAKE_MAG_DOMAIN_MAX, Math.max(EARTHQUAKE_MAG_FLOOR, mag));
  const px = EARTHQUAKE_MAG_BASE_PX
    + EARTHQUAKE_MAG_PX_PER_UNIT * (clamped - EARTHQUAKE_MAG_FLOOR);
  return Math.round(px * 10) / 10;
}

// ---------------------------------------------------------------------------
// Depth → world metres of vertical ruler
// ---------------------------------------------------------------------------

/** No exaggeration: one metre of ruler is one metre of depth. */
export const EARTHQUAKE_DEPTH_SCALE = 1;
/**
 * Shortest ruler drawn for a MEASURED depth, in metres.
 *
 * A1: an event the network placed at 0.0 km — or above sea level, which USGS
 * publishes as a negative depth — still gets a mark, because "measured at
 * zero" and "not measured" may not share a sign.
 */
export const EARTHQUAKE_DEPTH_FLOOR_M = 1000;
/** Depths printed in the legend's depth ruler, in km. */
export const EARTHQUAKE_DEPTH_TICKS_KM = Object.freeze([10, 70, 300, 700]);
/** Deepest earthquake ever located, in km — the ruler's reference top. */
export const EARTHQUAKE_DEPTH_MAX_KM = 700;

/**
 * Ruler length in metres for one published depth.
 * @param {number} depthKm Depth below sea level, in km, as USGS publishes it.
 * @returns {number|null} Metres of ruler, or null when depth is not published.
 */
export function depthRulerMetres(depthKm) {
  // Same `typeof` guard as {@link magnitudePixelSize}, and for the same
  // reason: GeoJSON writes a missing third coordinate as `null`, and
  // `Number(null)` is a perfectly finite 0 km.
  if (typeof depthKm !== 'number' || !Number.isFinite(depthKm)) return null;
  return Math.max(EARTHQUAKE_DEPTH_FLOOR_M, depthKm * 1000 * EARTHQUAKE_DEPTH_SCALE);
}

// ---------------------------------------------------------------------------
// Age → colour (A2, B4, C1)
// ---------------------------------------------------------------------------

/**
 * A timestamp may run this far ahead of the local clock and still be believed.
 * Beyond it the client's clock, the server's, or the feed is wrong, and an age
 * computed from it is not a measurement.
 */
export const EARTHQUAKE_CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * The frozen age ramp. One warm hue, four values, strictly decreasing
 * luminance — the order survives a greyscale conversion (B4), and the bounds
 * are hours of the wall clock, never quantiles of the current feed (C1).
 */
export const EARTHQUAKE_AGE_BANDS = Object.freeze([
  Object.freeze({
    id: 'h1', maxAgeMs: 3600e3, color: '#fff1c9', label: 'moins d’1 h',
    blurb: 'Secousse de la dernière heure. La bande la plus claire de l’échelle.',
  }),
  Object.freeze({
    id: 'h6', maxAgeMs: 6 * 3600e3, color: '#ffc247', label: '1 à 6 h',
    blurb: 'Entre une et six heures.',
  }),
  Object.freeze({
    id: 'h12', maxAgeMs: 12 * 3600e3, color: '#e07a1f', label: '6 à 12 h',
    blurb: 'Entre six et douze heures.',
  }),
  Object.freeze({
    id: 'h24', maxAgeMs: Number.POSITIVE_INFINITY, color: '#8c4a17', label: '12 à 24 h',
    blurb: 'Le fond de la fenêtre : la secousse sort de la carte au prochain relevé. '
      + 'Le flux USGS « all_day » livre parfois quelques minutes de plus que 24 h ; '
      + 'ces événements tombent dans cette bande, ils ne sont pas écartés.',
  }),
]);

/**
 * The mark for an event whose time is not usable. Deliberately cool and
 * desaturated: off the warm ramp, so it cannot be misread as a rank on it.
 */
export const EARTHQUAKE_AGE_UNKNOWN = Object.freeze({
  id: 'unknown', color: '#7f8c99', label: 'âge non publié',
  blurb: 'Horodatage absent du flux, ou postérieur de plus de cinq minutes à l’horloge '
    + 'locale. L’âge n’est pas mesuré, donc il n’est pas peint sur l’échelle : ce gris '
    + 'bleuté n’est pas une cinquième ancienneté.',
});

/**
 * Which age band an event falls in.
 * @param {number|null|undefined} timeMs USGS event time, epoch ms.
 * @param {number} nowMs Reference instant — the poll's, not the frame's.
 * @returns {{id: string, color: string, label: string, blurb: string}} Band or unknown.
 */
export function ageBandFor(timeMs, nowMs) {
  // `typeof` again, for the third time and the same reason: `Number(null)` is
  // 0, and an epoch of 0 would have read as an event from 1970 — the OLDEST
  // band — rather than as an event whose time was never published.
  if (typeof timeMs !== 'number' || !Number.isFinite(timeMs)) return EARTHQUAKE_AGE_UNKNOWN;
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return EARTHQUAKE_AGE_UNKNOWN;
  const t = timeMs;
  const now = nowMs;
  const age = now - t;
  if (age < -EARTHQUAKE_CLOCK_SKEW_TOLERANCE_MS) return EARTHQUAKE_AGE_UNKNOWN;
  const clamped = Math.max(0, age);
  for (const band of EARTHQUAKE_AGE_BANDS) {
    if (clamped < band.maxAgeMs) return band;
  }
  return EARTHQUAKE_AGE_BANDS[EARTHQUAKE_AGE_BANDS.length - 1];
}

// ---------------------------------------------------------------------------
// Legend (D1)
// ---------------------------------------------------------------------------

const _b64 = (text) => (typeof btoa === 'function'
  ? btoa(text)
  : Buffer.from(text, 'utf8').toString('base64'));

const GLYPH_VIEW_BOX = 16;
/** @type {Map<number, string>} magnitude → data URI. */
const _discGlyphCache = new Map();

/**
 * A legend swatch shaped like the DISC the map draws for that magnitude.
 *
 * The swatch has to be the datum, so the ruler rows hand over a circle whose
 * diameter is the very pixel size the mark uses, rescaled into the 16 px
 * viewBox against the domain top. The mask keeps only the shape, so the fill
 * here is irrelevant and the caller's colour is what shows.
 * @param {number} magnitude Magnitude the tick stands for.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function magnitudeDiscGlyph(magnitude) {
  const px = magnitudePixelSize(magnitude) ?? EARTHQUAKE_MAG_BASE_PX;
  const cached = _discGlyphCache.get(px);
  if (cached) return cached;
  const maxPx = magnitudePixelSize(EARTHQUAKE_MAG_DOMAIN_MAX);
  const radius = Math.max(1, (px / maxPx) * (GLYPH_VIEW_BOX / 2 - 1));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLYPH_VIEW_BOX} ${GLYPH_VIEW_BOX}">`
    + `<circle cx="8" cy="8" r="${radius.toFixed(2)}" fill="#000"/>`
    + '</svg>';
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _discGlyphCache.set(px, uri);
  return uri;
}

/** French thousands separator, flattened so the legend wraps identically everywhere. */
function fr(value) {
  // ICU groups with U+202F or U+00A0 depending on its version; both are
  // flattened so the legend measures and wraps identically everywhere.
  return Number(value).toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g, ' ');
}

/**
 * An empty tally, so a legend built before the first poll is still shaped
 * like the one built after it.
 * @returns {object} Zeroed counters.
 */
export function emptyEarthquakeTally() {
  const byAge = {};
  for (const band of EARTHQUAKE_AGE_BANDS) byAge[band.id] = 0;
  byAge[EARTHQUAKE_AGE_UNKNOWN.id] = 0;
  return {
    drawn: 0,
    byAge,
    noDepth: 0,
    depthFloor: 0,
    labelled: 0,
    magMax: null,
    depthMaxKm: null,
  };
}

/**
 * The key, in reading order: the size ruler, then the depth ruler, then the
 * age ramp, then what is not published and what is not labelled.
 *
 * D1 in full — two channels carry values here, so the key has to state BOTH,
 * and a size or a length without numbered ticks means nothing at all. Entry
 * shape is the repo's `{label, color, count?, blurb?, glyph?}`; `color: null`
 * renders an aligned empty swatch for the rows that head a section rather than
 * key a colour.
 *
 * @param {object} tally From {@link emptyEarthquakeTally}, filled by a poll.
 * @returns {Array<object>} Legend entries.
 */
export function buildEarthquakeLegend(tally) {
  const t = tally || emptyEarthquakeTally();
  const entries = [];

  entries.push({
    label: 'Taille du point — magnitude',
    color: null,
    blurb: `Diamètre en PIXELS CONSTANTS, identique de près comme de loin : `
      + `${EARTHQUAKE_MAG_BASE_PX} px à M${fr(EARTHQUAKE_MAG_FLOOR)}, puis `
      + `+${EARTHQUAKE_MAG_PX_PER_UNIT} px par unité de magnitude, domaine gelé `
      + `M${fr(EARTHQUAKE_MAG_FLOOR)}–M${fr(EARTHQUAKE_MAG_DOMAIN_MAX)}. `
      + `Le point mesure la MAGNITUDE, pas l’énergie : un M7 fait 3,25 fois le `
      + `diamètre d’un M2,5 alors qu’il libère environ 5,6 millions de fois plus `
      + `d’énergie. Et il ne mesure aucune emprise — ni surface de rupture, ni `
      + `rayon ressenti, ni isoséiste.`,
  });
  for (const tick of EARTHQUAKE_MAG_TICKS) {
    entries.push({
      label: `M${fr(tick)}`,
      color: PRISM_HEIGHT_SWATCH_COLOR,
      glyph: magnitudeDiscGlyph(tick),
      blurb: `${fr(magnitudePixelSize(tick))} px de diamètre à l’écran.`,
    });
  }

  entries.push({
    label: 'Tige verticale — profondeur du foyer',
    color: null,
    blurb: 'ÉCHELLE DE LECTURE, PAS LA POSITION DU FOYER : la tige monte, le foyer '
      + 'descend. Sa LONGUEUR est la profondeur publiée par l’USGS, à l’échelle 1:1 — '
      + '100 km de tige valent 100 km sous le niveau de la mer. Elle est dessinée '
      + 'au-dessus de la surface parce que le globe est opaque : sous la surface, elle '
      + 'ne serait visible qu’en traversant la Terre, donc visible depuis l’autre '
      + 'hémisphère. Son pied est posé sur l’ellipsoïde (h = 0), le repère même de la '
      + 'mesure ; sur un relief marqué, ses premiers kilomètres sont donc dans la '
      + 'montagne et la partie visible sous-estime la profondeur d’autant.',
  });
  for (const tick of EARTHQUAKE_DEPTH_TICKS_KM) {
    entries.push({
      label: `${fr(tick)} km`,
      color: PRISM_HEIGHT_SWATCH_COLOR,
      glyph: prismHeightGlyph(tick / EARTHQUAKE_DEPTH_MAX_KM),
      blurb: `${fr(tick)} km de tige.`,
    });
  }

  entries.push({
    label: 'Couleur — âge dans la fenêtre de 24 h',
    color: null,
    blurb: 'La profondeur étant passée dans la géométrie, la couleur est libre et porte '
      + 'l’ancienneté de la secousse. Une seule teinte, quatre clartés décroissantes : '
      + 'l’ordre survit au niveau de gris. Les bornes sont des heures gelées, jamais '
      + 'recalculées sur le relevé en cours.',
  });
  for (const band of EARTHQUAKE_AGE_BANDS) {
    entries.push({
      label: band.label,
      color: band.color,
      count: t.byAge?.[band.id] ?? 0,
      blurb: band.blurb,
    });
  }
  if (t.byAge?.[EARTHQUAKE_AGE_UNKNOWN.id]) {
    entries.push({
      label: EARTHQUAKE_AGE_UNKNOWN.label,
      color: EARTHQUAKE_AGE_UNKNOWN.color,
      count: t.byAge[EARTHQUAKE_AGE_UNKNOWN.id],
      blurb: EARTHQUAKE_AGE_UNKNOWN.blurb,
    });
  }

  if (t.noDepth) {
    entries.push({
      label: 'profondeur non publiée — point creux, aucune tige',
      color: null,
      count: t.noDepth,
      blurb: 'Le flux ne donne pas de profondeur pour cet événement. Aucune tige n’est '
        + 'dessinée, et le point est vidé (anneau seul) : une tige absente seule se '
        + 'confondrait avec une secousse superficielle.',
    });
  }
  if (t.depthFloor) {
    entries.push({
      label: 'foyer à moins d’1 km — tige plancher',
      color: null,
      count: t.depthFloor,
      blurb: 'L’USGS publie 0,0 km, et des profondeurs négatives pour les foyers situés '
        + 'au-dessus du niveau de la mer. C’est une mesure, pas une absence : sous 1 km '
        + 'la tige est dessinée à sa longueur plancher d’1 km plutôt que supprimée. C’est '
        + 'le seul endroit où l’échelle 1:1 est rompue, et il est compté ici.',
    });
  }

  if (t.drawn > t.labelled) {
    entries.push({
      label: `étiquettes de magnitude — ${fr(t.labelled)} sur ${fr(t.drawn)}`,
      color: null,
      blurb: `Toutes les secousses M${fr(EARTHQUAKE_MAG_FLOOR)}+ du flux sont DESSINÉES ; `
        + `seules les ${fr(EARTHQUAKE_OVERLAY_COHORT_LIMIT)} plus fortes magnitudes portent `
        + `une étiquette flottante, l’identifiant USGS départageant les ex æquo. `
        + `Ce plafond est celui de l’étiquette, jamais celui de la carte.`,
    });
  }

  return entries;
}

/**
 * Build the source-owned presentation for one ambient magnitude label.
 * Magnitude formatting deliberately remains here instead of moving into the
 * shared renderer.
 * @param {object} input
 * @param {string} input.id Stable USGS or deterministic fallback id.
 * @param {Cesium.Cartesian3} input.position Ground anchor shared with the mark.
 * @param {number} input.magnitude USGS magnitude.
 * @param {string} input.accent Source-owned accent — the event's AGE colour.
 * @returns {object}
 */
export function createEarthquakeOverlayEntry({ id, position, magnitude, accent }) {
  const mag = Number(magnitude);
  return {
    id: String(id),
    position,
    variant: 'label',
    title: `M${mag.toFixed(1)}`,
    accent,
    priority: Math.round(mag * 1000),
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

/** Keep the largest events, with stable identity as the tie-break. */
export function selectEarthquakeOverlayCohort(
  entries,
  limit = EARTHQUAKE_OVERLAY_COHORT_LIMIT,
) {
  const cap = Math.max(0, Math.min(
    EARTHQUAKE_OVERLAY_COHORT_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/**
 * Map one earthquake's raw plain values to a JSON-safe analyst record
 * (analyst query engine seam). Pure — no Cesium types. Missing/unknown
 * fields are null, never NaN/undefined. Falls back to an index-based id
 * when the USGS event id is absent.
 * @param {Object|null|undefined} raw - Plain values pulled off the entity:
 *   {id, mag, place, time, depth, lat, lon}.
 * @param {number} [index=0] - Position in the snapshot (fallback id only).
 * @returns {{id: string, magnitude: number|null, depthKm: number|null,
 *   lat: number|null, lon: number|null, timeMs: number|null, place: string|null}}
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  return {
    id: text(raw?.id) || `QUAKE-${String(index).padStart(4, '0')}`,
    magnitude: num(raw?.mag),
    depthKm: num(raw?.depth),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    timeMs: num(raw?.time), // USGS epoch ms
    place: text(raw?.place),
  };
}

/** Constant ring around every mark: contrast against the globe, never a datum. */
const MARK_OUTLINE_COLOR = Cesium.Color.fromCssColorString('#0b1016').withAlpha(0.85);
/** Ring width, in pixels. Constant — it used to double the magnitude channel. */
const MARK_OUTLINE_WIDTH = 1.5;
/** Ruler width, in pixels. Constant: the ruler's datum is its LENGTH. */
const DEPTH_RULER_WIDTH_PX = 2;
/** Ruler alpha. Constant, so the line never competes with the age ramp. */
const DEPTH_RULER_ALPHA = 0.85;

export function createEarthquakesLayer({ overlayHost = DEFAULT_OVERLAY_HOST } = {}) {
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _tally = emptyEarthquakeTally();

  const layer = {
  id: 'earthquakes',
  name: 'Earthquakes (24h)',
  icon: '🌋',
  source: 'USGS',
  updateInterval: 60000,

  init(viewer) {
    _dataSource = new Cesium.CustomDataSource('earthquakes');
    _dataSource.show = false;
    viewer.dataSources.add(_dataSource);
    _count = 0;
    _lastUpdate = null;
    _lastError = null;
    _enabled = false;
    _tally = emptyEarthquakeTally();
    overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false);
    console.log('[Data:Earthquakes] Initialized');
  },

  enable(viewer) {
    _enabled = true;
    // No continuous-render hold: point and ruler are static geometry, so the
    // layer has no per-frame animator to keep the render loop alive for.
    if (_dataSource) _dataSource.show = true;
    overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, true);
  },

  disable(viewer) {
    _enabled = false;
    if (_dataSource) _dataSource.show = false;
    overlayHost.clearSource(EARTHQUAKE_OVERLAY_SOURCE_ID);
    overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false);
  },

  async update(viewer) {
    try {
      const response = await fetch(API_URL);
      if (!response.ok) {
        _lastError = `USGS HTTP ${response.status}`;
        console.warn(`[Data:Earthquakes] API returned ${response.status}`);
        return false;
      }

      const geojson = await response.json();
      if (!geojson || !Array.isArray(geojson.features)) {
        _lastError = 'Malformed USGS response';
        return false;
      }

      _dataSource.entities.removeAll();
      let count = 0;
      const overlayEntries = [];
      const tally = emptyEarthquakeTally();
      // ONE reference instant for the whole poll, so two events of identical
      // time can never land in two bands because the loop took a millisecond.
      const nowMs = Date.now();

      for (const feature of geojson.features) {
        const [lon, lat, depthKm] = feature.geometry.coordinates;
        const mag = feature.properties.mag;
        const place = feature.properties.place;
        const time = feature.properties.time;

        // `mag < 2.5` alone let a NaN magnitude through — `NaN < 2.5` is false
        // — and it would have drawn a mark of size NaN. The floor is stated
        // positively instead, on the same guard the pixel scale uses.
        if (magnitudePixelSize(mag) === null || mag < EARTHQUAKE_MAG_FLOOR) continue;

        count++;
        const pixelSize = magnitudePixelSize(mag);
        const band = ageBandFor(time, nowMs);
        const color = Cesium.Color.fromCssColorString(band.color);
        const rulerM = depthRulerMetres(depthKm);
        const hasDepth = rulerM !== null;

        tally.byAge[band.id] += 1;
        if (!hasDepth) tally.noDepth += 1;
        else if (depthKm * 1000 <= EARTHQUAKE_DEPTH_FLOOR_M) tally.depthFloor += 1;
        if (tally.magMax === null || mag > tally.magMax) tally.magMax = mag;
        if (hasDepth && (tally.depthMaxKm === null || depthKm > tally.depthMaxKm)) {
          tally.depthMaxKm = depthKm;
        }

        const position = Cesium.Cartesian3.fromDegrees(lon, lat);
        const stableId = feature.id || `event-${count}`;
        _dataSource.entities.add({
          id: `earthquake:${stableId}`,
          position,
          point: {
            // Constant screen pixels. No scaleByDistance, ever — see B2 in the
            // header: composing a thematic size with a range function inverts
            // the very hierarchy the legend promises.
            pixelSize,
            // A1: an unpublished depth empties the disc, so "shallow" and
            // "unmeasured" cannot share a mark.
            color: hasDepth ? color : Cesium.Color.TRANSPARENT,
            outlineColor: hasDepth ? MARK_OUTLINE_COLOR : color,
            outlineWidth: hasDepth ? MARK_OUTLINE_WIDTH : 2.5,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
          // The depth ruler. Static positions — a CallbackProperty here would
          // rebuild the polyline batch every frame, which is the 2026-08-20
          // cliff in another costume.
          polyline: hasDepth ? {
            positions: [
              Cesium.Cartesian3.fromDegrees(lon, lat, 0),
              Cesium.Cartesian3.fromDegrees(lon, lat, rulerM),
            ],
            width: DEPTH_RULER_WIDTH_PX,
            material: new Cesium.ColorMaterialProperty(color.withAlpha(DEPTH_RULER_ALPHA)),
            // Straight in space: a geodesic arc between two points on the same
            // vertical is a degenerate case Cesium does not need to solve.
            arcType: Cesium.ArcType.NONE,
          } : undefined,
          properties: {
            // Analyst seam (additive): the USGS event id (e.g. "us7000abcd").
            usgsId: feature.id ?? null,
            mag,
            place,
            time,
            depth: depthKm,
            ageBand: band.id,
          },
        });
        overlayEntries.push(createEarthquakeOverlayEntry({
          id: String(stableId),
          position,
          magnitude: mag,
          accent: band.color,
        }));
      }

      const cohort = selectEarthquakeOverlayCohort(overlayEntries);
      tally.drawn = count;
      tally.labelled = cohort.length;

      if (_enabled) {
        overlayHost.setEntries(
          EARTHQUAKE_OVERLAY_SOURCE_ID,
          cohort,
          {
            cohortLimit: EARTHQUAKE_OVERLAY_COHORT_LIMIT,
            collisionCapacity: EARTHQUAKE_OVERLAY_COLLISION_CAPACITY,
            moving: false,
          },
        );
      }

      _tally = tally;
      _count = count;
      _lastUpdate = Date.now();
      _lastError = null;
      console.log(`[Data:Earthquakes] Updated: ${_count} events (M2.5+)`);
      return true;

    } catch (e) {
      console.warn('[Data:Earthquakes] Fetch error:', e);
      _lastError = 'USGS network error';
      return false;
    }
  },

  destroy(viewer) {
    _enabled = false;
    overlayHost.clearSource(EARTHQUAKE_OVERLAY_SOURCE_ID);
    overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false);
    if (_dataSource) {
      viewer.dataSources.remove(_dataSource, true);
      _dataSource = null;
    }
    _count = 0;
    _lastUpdate = null;
    _lastError = null;
    _tally = emptyEarthquakeTally();
  },

  /**
   * Snapshot the layer's in-memory earthquake records as plain JSON-safe
   * objects for the analyst query engine. On-demand only (called at most
   * once per spoken query) — zero per-frame cost, no listeners, no caching.
   * Returns [] while the layer is disabled or empty.
   * @param {number} [maxCount=2000] - Maximum records to return (truncation).
   * @returns {Array<Object>} See mapAnalystRecord for the record shape.
   */
  getAnalystRecords(maxCount = 2000) {
    if (!_dataSource || !_dataSource.show) return [];
    const entities = _dataSource.entities.values;
    if (!entities.length) return [];
    const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 2000;
    const now = Cesium.JulianDate.now();
    const result = [];
    for (const entity of entities) {
      if (result.length >= limit) break;
      const cartesian = entity.position ? entity.position.getValue(now) : null;
      const carto = cartesian ? Cesium.Cartographic.fromCartesian(cartesian) : null;
      const p = entity.properties;
      result.push(mapAnalystRecord({
        id: p?.usgsId?.getValue(now) ?? null,
        mag: p?.mag?.getValue(now),
        place: p?.place?.getValue(now),
        time: p?.time?.getValue(now),
        depth: p?.depth?.getValue(now),
        lat: carto ? Cesium.Math.toDegrees(carto.latitude) : null,
        lon: carto ? Cesium.Math.toDegrees(carto.longitude) : null,
      }, result.length));
    }
    return result;
  },

  /**
   * The on-map key (D1). Both channels that carry a value are stated here —
   * pixel size for magnitude, ruler length for depth — plus the age ramp the
   * colour now carries, and the counts of every fallback.
   *
   * Read from the tally the LAST POLL left behind rather than recomputed from
   * the entity collection: the panel asks for this on every refresh, and
   * walking N entities to rebuild four counters that only change once a minute
   * would put layer work on the interaction path.
   * @returns {{chips: Array<object>, legend: Array<object>}}
   */
  getRowControls() {
    return { chips: [], legend: buildEarthquakeLegend(_tally) };
  },

  getStats() {
    return {
      count: _count,
      lastUpdate: _lastUpdate,
      error: _lastError,
      legend: buildEarthquakeLegend(_tally),
    };
  },
  };
  return layer;
}

const earthquakesLayer = createEarthquakesLayer();

export default earthquakesLayer;
