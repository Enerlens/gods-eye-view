// src/data/buildingTheme.js
/**
 * The building volumes as a thematic surface — the join, the registry, and the
 * colour of "nobody measured this one".
 *
 * `bdtopoBuildings.js` is the only real 3D geometry in this codebase: 14 000
 * BD TOPO footprints extruded to their surveyed height, batched into a single
 * `Cesium.Primitive` whose per-instance colour can be rewritten at any time
 * (`releaseGeometryInstances: false`). Five layers — DPE, DVF, autorisations
 * d'urbanisme, Sitadel, GPU — currently draw a pin ABOVE the roof they are
 * talking about. This module is the seam that lets them paint the roof instead.
 *
 * It holds no viewer, imports no Cesium and touches no DOM: a theme is data
 * plus three functions, and the join is arithmetic on flat coordinate arrays.
 * That is deliberate — the expensive part (point-in-polygon over a whole
 * viewport) has to be provable in `node --test` without a GPU.
 *
 * ── What it draws, and what it refuses to say ──────────────────────────────
 *
 * • **One theme paints, ever.** Two thematic layers on at once do not blend:
 *   `getActiveBuildingTheme()` returns the lowest `precedence`, ties broken by
 *   registration order, and the loser is not mixed in at half strength. A
 *   volume coloured half by DPE and half by €/m² is a sentence with two verbs.
 *   The winner's `label` travels with the paint so the legend can name it — a
 *   ramp on screen whose owner is not written down is a D1 violation, and with
 *   two candidate owners it is also a lie half the time.
 *
 * • **A building nobody measured must not look measured (A1).** This is the
 *   whole reason the module exists rather than being three lines inside the
 *   BD TOPO layer. When a theme is active, an unjoined volume keeps its usage
 *   hue but is washed to `s × 0.15, l × 0.42` in HSL. Over the six BD TOPO usage
 *   colours and the whole height range the layer draws, that is CIE L* 14.9–33.9
 *   at HSL saturation ≤ 0.113: dark AND grey, both at once.
 *
 *   Measured against the three palettes the first themes will bring — the
 *   official DPE labels, a divergent €/m² ramp, the permit states — the CLOSEST
 *   any class comes to any wash is ΔE76 36.5 (DVF's dark blue `#2166ac` against
 *   a washed tall `Sportif` volume), on a scale where 2.3 is a just-noticeable
 *   difference and 10 is where two colours stop sharing a name. Lightness alone
 *   would not have proved it: that same `#2166ac` is only 8.5 L* above the
 *   brightest wash, and it is the CHROMA that separates them.
 *   `buildingThemeConflicts()` re-runs the check on a theme's own legend at
 *   registration time, so a future theme that ships a dark grey class gets a
 *   console warning instead of quietly colliding with "no data".
 *
 * • **The height channel is re-assigned, and only where it has to be.** Today
 *   a volume's brightness carries its HEIGHT (see `volumeColor`), because 83–87 %
 *   of buildings on a French urban tile share the `Résidentiel`/`Indifférencié`
 *   hue and nothing else separates neighbours. Under a theme the brightness of a
 *   PAINTED volume carries the theme's class instead — one channel, one meaning
 *   (A3) — while UNPAINTED volumes keep the height shading, because they are no
 *   longer in the theme's language at all and the street front still has to be
 *   legible. That is the trade, stated: the theme buys the brightness of the
 *   buildings it can speak about, and pays for it nowhere else.
 *
 * • **Points that land on no building are counted, not swallowed (A5).** Every
 *   join returns `unmatchedPoints` (fell inside the viewport's footprints but in
 *   none of them) and `unplacedPoints` (no finite coordinate at all). A DPE
 *   diagnostic whose address geocoded to the middle of the street is a real
 *   diagnostic that this map does not show, and the layer publishing the theme
 *   is expected to print both numbers.
 *
 * ── The join, and why it is indexed ────────────────────────────────────────
 *
 * A viewport at `BDTOPO_MAX_BOX_DEG` (0.08° ≈ 9 km) holds up to the 14 000-volume
 * cap; a DPE or DVF payload over the same box is a few hundred points. The naive
 * nested loop is O(buildings × points) polygon tests — at 3 000 footprints × 200
 * points that is 600 000 ray casts over ~10-vertex rings, measured on this
 * machine at 35–176 ms depending on how warm the JIT is, i.e. two to ten dropped
 * frames every time a theme refreshes its points. At the cap, 14 000 × 2 000, the
 * same loop takes 3.0–16.7 s and there is no version of that which ships.
 *
 * Instead the footprints go into a uniform lon/lat grid sized `span / √n`: 30 m
 * cells for a dense payload, 75 m at the cap, against footprints 15–30 m wide, so
 * a footprint lands in one or two cells and the fullest bucket measured over
 * 14 000 synthetic buildings held 4. A point then tests only its own bucket.
 * Measured, best of nine runs, index build included:
 *
 *     3 000 × 200      2.2 ms  and    200 polygon tests   (naive:  34.9 ms / 600 000)
 *     14 000 × 2 000   8.7 ms  and  2 000 polygon tests   (naive: 2 967 ms / 28 M)
 *
 * The test file re-measures the polygon-test count — the one figure that is not
 * machine-dependent — and fails if it drifts back towards the product of the two
 * populations.
 *
 * Two rules the grid does not decide, and that the tests pin down:
 *
 * • **A point in two footprints goes to the SMALLER one.** BD TOPO polygons do
 *   not overlap in theory; in practice an annexe drawn inside a courtyard, and a
 *   building cut across two tiles and drawn twice, both produce genuine double
 *   hits. The smaller footprint is the more specific claim, and the rule is
 *   deterministic (ties broken by id) so the same point never migrates between
 *   two volumes because the tile order changed.
 *
 * • **The edge belongs to one side only.** The crossing test is half-open in
 *   latitude, which makes the west and south edges part of the polygon and the
 *   east and north edges not. Two buildings sharing a party wall therefore never
 *   both claim a diagnostic that geocoded exactly onto it.
 *
 * Holes are subtracted: a point inside a courtyard ring is outside the building.
 * The BD TOPO layer keeps interior rings precisely because dropping them welds
 * a street front into one block, and a join that ignored them would hand the
 * courtyard's own point to the building around it.
 *
 * ── What it does NOT do ────────────────────────────────────────────────────
 *
 * Aggregation is not decided here. One building = several DPE diagnostics and
 * several sales is the NORMAL case, not the edge case, and "worst grade of the
 * block" and "median €/m² of the block" are different questions with different
 * right answers. The theme brings its own `reduce(points)`; this module only
 * guarantees it is called once per building with every point that landed on it,
 * in the order the caller supplied them.
 */

/** Default precedence for a theme that does not state one. */
export const BUILDING_THEME_DEFAULT_PRECEDENCE = 100;

/**
 * The "no data" wash, in HSL multipliers on the BD TOPO usage colour.
 *
 * Not a fixed grey: keeping a trace of the usage hue means the unpainted part of
 * the city still reads as a city rather than as a hole in the layer, and at
 * saturation at most 0.113 the trace cannot be read as a class. See the header
 * for the measured separation from every class of every intended theme.
 */
export const BUILDING_THEME_UNKNOWN_SATURATION = 0.15;
export const BUILDING_THEME_UNKNOWN_LIGHTNESS = 0.42;

/**
 * The envelope a theme colour may not enter: anything this desaturated AND this
 * dark is indistinguishable from an unjoined volume.
 */
export const BUILDING_THEME_UNKNOWN_MAX_SATURATION = 0.20;
export const BUILDING_THEME_UNKNOWN_MAX_LIGHTNESS = 40;

/* ── colour arithmetic ─────────────────────────────────────────────────── */

/**
 * Parse the CSS colours this codebase actually writes: `#rgb`, `#rrggbb`,
 * `#rrggbbaa` (alpha ignored — these volumes are opaque on purpose) and
 * `rgb()`/`rgba()`.
 * @param {?string} css
 * @returns {?Array<number>} [r, g, b] bytes, or null when unparseable.
 */
export function parseCssRgb(css) {
  if (typeof css !== 'string') return null;
  const text = css.trim();
  if (text.startsWith('#')) {
    const hex = text.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const parts = [0, 1, 2].map((i) => Number.parseInt(hex[i] + hex[i], 16));
      return parts.some((v) => Number.isNaN(v)) ? null : parts;
    }
    if (hex.length === 6 || hex.length === 8) {
      const parts = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
      return parts.some((v) => Number.isNaN(v)) ? null : parts;
    }
    return null;
  }
  const match = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (!match) return null;
  const parts = match[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3)
    .map((token) => (token.endsWith('%')
      ? (Number.parseFloat(token) / 100) * 255
      : Number.parseFloat(token)));
  if (parts.length !== 3 || parts.some((v) => !Number.isFinite(v))) return null;
  return parts.map((v) => Math.min(255, Math.max(0, Math.round(v))));
}

/** @param {Array<number>} rgb @returns {string} `#rrggbb`. */
export function rgbToCss(rgb) {
  return `#${rgb.map((v) => Math.min(255, Math.max(0, Math.round(v)))
    .toString(16).padStart(2, '0')).join('')}`;
}

/** @param {Array<number>} rgb bytes @returns {Array<number>} [h, s, l] in 0..1. */
export function rgbToHsl([r8, g8, b8]) {
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

/** @param {Array<number>} hsl in 0..1 @returns {Array<number>} rgb bytes. */
export function hslToRgb([h, s, l]) {
  if (!s) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t0) => {
    const t = ((t0 % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)]
    .map((v) => Math.round(v * 255));
}

/**
 * CIE L* of an sRGB byte triple — sRGB → linear light → relative luminance →
 * L*. The same chain `choroplethAlpha.test.mjs` uses, kept here rather than in
 * the test because the registration-time guard needs it at runtime too.
 * @param {Array<number>} rgb
 * @returns {number} 0..100
 */
export function cieLightness(rgb) {
  const linear = rgb.map((byte) => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const y = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return y > 0.008856 ? 116 * y ** (1 / 3) - 16 : 903.3 * y;
}

/**
 * The A1 wash: what a volume looks like when a theme is painting and this
 * building is not in the data.
 * @param {string} css A BD TOPO usage colour.
 * @returns {string} `#rrggbb`, or the input unchanged when it cannot be parsed.
 */
export function unknownBuildingCss(css) {
  const rgb = parseCssRgb(css);
  if (!rgb) return css;
  const [h, s, l] = rgbToHsl(rgb);
  return rgbToCss(hslToRgb([
    h,
    s * BUILDING_THEME_UNKNOWN_SATURATION,
    l * BUILDING_THEME_UNKNOWN_LIGHTNESS,
  ]));
}

/**
 * CIELAB (D65) of an sRGB byte triple.
 * @param {Array<number>} rgb
 * @returns {Array<number>} [L*, a*, b*]
 */
export function rgbToLab(rgb) {
  const linear = rgb.map((byte) => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = linear;
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * Euclidean CIE76 distance. Coarse next to ΔE2000 and entirely sufficient here:
 * the question is not "are these two greens the same green", it is "can a class
 * be mistaken for the absence of a class", and the answer wanted is tens of
 * units, not units.
 * @param {Array<number>} rgbA
 * @param {Array<number>} rgbB
 * @returns {number}
 */
export function deltaE76(rgbA, rgbB) {
  const a = rgbToLab(rgbA);
  const b = rgbToLab(rgbB);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * How far a theme class must sit from every colour an unjoined volume can take.
 * A just-noticeable difference is ~2.3; ~10 is where two colours stop sharing a
 * name. 25 is "nobody squints".
 */
export const BUILDING_THEME_MIN_DELTA_E = 25;

/**
 * Theme colours that fall inside the "no data" envelope.
 *
 * A theme is free to use any palette it likes, except one that reads as the
 * absence of itself. Called at registration so the warning names the theme.
 *
 * Given the colours an unjoined volume can actually take, the test is ΔE76 —
 * the honest one, and the one `buildingTheme.test.mjs` runs against the real
 * BD TOPO usage palette. Registration does not know that palette (the wash
 * depends on which buildings are loaded), so with no reference it falls back to
 * a cheap SUFFICIENT condition: dark AND grey. That misses nothing the wash can
 * produce — every wash is dark and grey by construction — and it lets through a
 * dark saturated class such as DVF's `#2166ac`, which is 8.5 L* from the wash
 * but 36.5 ΔE away and in no danger of being confused with it.
 * @param {Array<string>} colors
 * @param {?Array<string>} [unknownColors] The wash colours, when the caller knows them.
 * @returns {Array<{color: string, lightness: number, saturation: number, deltaE: ?number}>}
 */
export function buildingThemeConflicts(colors, unknownColors = null) {
  const references = (unknownColors || []).map(parseCssRgb).filter(Boolean);
  const conflicts = [];
  for (const color of colors || []) {
    const rgb = parseCssRgb(color);
    if (!rgb) continue;
    const saturation = rgbToHsl(rgb)[1];
    const lightness = cieLightness(rgb);
    if (references.length) {
      const distance = Math.min(...references.map((reference) => deltaE76(rgb, reference)));
      if (distance < BUILDING_THEME_MIN_DELTA_E) {
        conflicts.push({
          color, lightness, saturation, deltaE: distance,
        });
      }
      continue;
    }
    if (saturation <= BUILDING_THEME_UNKNOWN_MAX_SATURATION
      && lightness <= BUILDING_THEME_UNKNOWN_MAX_LIGHTNESS) {
      conflicts.push({
        color, lightness, saturation, deltaE: null,
      });
    }
  }
  return conflicts;
}

/* ── the registry ──────────────────────────────────────────────────────── */

/** @type {Map<string, object>} */
const _themes = new Map();
/** @type {Set<Function>} */
const _listeners = new Set();
let _seq = 0;

function notify(reason) {
  for (const listener of [..._listeners]) {
    try {
      listener(reason);
    } catch (error) {
      console.warn('[buildingTheme] listener failed:', error);
    }
  }
}

/**
 * Publish a theme. Re-registering an id REPLACES the theme and keeps its
 * original sequence number, so a feed refreshing its points every five minutes
 * never takes the map away from a theme that was already painting.
 * @param {object} theme
 * @param {string} theme.id
 * @param {string} theme.label Shown to the reader; French.
 * @param {number} [theme.precedence] Lower wins. Default 100.
 * @param {Array<object>} theme.points `{lon, lat, ...}`
 * @param {(points: Array<object>) => *} theme.reduce N points on one building → one value.
 * @param {(value: *) => ?string} theme.colorFor Value → CSS colour, or null to leave unpainted.
 * @param {Array<object>} [theme.legend] `[{label, color, count?, blurb?}]` (D1).
 * @param {string} [theme.unknownLabel] French, for the "no data" legend row and
 *   the row count — 'sans diagnostic', 'sans mutation depuis 2019'. Default
 *   'sans donnée'.
 * @param {(values: Array<*>) => Array<object>} [theme.legendFor] Legend rebuilt from
 *   the painted values, for a theme whose swatches are not its own output. A
 *   static `legend` is counted automatically by matching swatch to colour.
 * @returns {object} The stored theme record.
 */
export function registerBuildingTheme(theme) {
  const id = typeof theme?.id === 'string' ? theme.id.trim() : '';
  if (!id) throw new TypeError('registerBuildingTheme: id is required');
  if (typeof theme.reduce !== 'function') {
    throw new TypeError(`registerBuildingTheme(${id}): reduce(points) is required`);
  }
  if (typeof theme.colorFor !== 'function') {
    throw new TypeError(`registerBuildingTheme(${id}): colorFor(value) is required`);
  }

  const legend = Array.isArray(theme.legend) ? theme.legend : [];
  const conflicts = buildingThemeConflicts(legend.map((entry) => entry?.color));
  if (conflicts.length) {
    // Not fatal: a theme that ships one dark neutral is still better than no
    // theme. But it is exactly the A1 collision this module is built to avoid,
    // so it is named, with the numbers, rather than left to be noticed on screen.
    console.warn(`[buildingTheme] ${id}: ${conflicts.length} legend colour(s) are as dark and `
      + 'as grey as an unjoined volume — a reader cannot tell them from "no data": '
      + conflicts.map((c) => `${c.color} (L* ${c.lightness.toFixed(1)}, S ${c.saturation.toFixed(2)}`
        + `${c.deltaE === null ? '' : `, ΔE ${c.deltaE.toFixed(1)}`})`).join(', '));
  }

  const previous = _themes.get(id);
  const record = {
    id,
    label: typeof theme.label === 'string' && theme.label ? theme.label : id,
    precedence: Number.isFinite(theme.precedence)
      ? theme.precedence
      : BUILDING_THEME_DEFAULT_PRECEDENCE,
    points: Array.isArray(theme.points) ? theme.points : [],
    reduce: theme.reduce,
    colorFor: theme.colorFor,
    legend,
    legendFor: typeof theme.legendFor === 'function' ? theme.legendFor : null,
    unknownLabel: typeof theme.unknownLabel === 'string' && theme.unknownLabel
      ? theme.unknownLabel
      : 'sans donnée',
    seq: previous ? previous.seq : (_seq += 1),
  };
  _themes.set(id, record);
  notify(previous ? 'update' : 'register');
  return record;
}

/**
 * Withdraw a theme — a layer being switched off.
 * @param {string} id
 * @returns {boolean} whether anything was registered under that id.
 */
export function clearBuildingTheme(id) {
  const had = _themes.delete(id);
  if (had) notify('clear');
  return had;
}

/** Drop every theme. Test teardown and viewer destruction. */
export function clearAllBuildingThemes() {
  if (!_themes.size) return;
  _themes.clear();
  notify('clear');
}

/**
 * The one theme allowed to paint: lowest `precedence`, then oldest
 * registration. Never a blend of two.
 * @returns {?object}
 */
export function getActiveBuildingTheme() {
  let best = null;
  for (const theme of _themes.values()) {
    if (!best
      || theme.precedence < best.precedence
      || (theme.precedence === best.precedence && theme.seq < best.seq)) {
      best = theme;
    }
  }
  return best;
}

/** @returns {Array<object>} Every registered theme, in painting order. */
export function listBuildingThemes() {
  return [..._themes.values()].sort((a, b) => (a.precedence - b.precedence) || (a.seq - b.seq));
}

/**
 * Subscribe to registration changes, so the layer that owns the volumes can
 * repaint without the theme layers having to import it.
 * @param {Function} listener
 * @returns {Function} unsubscribe
 */
export function onBuildingThemeChange(listener) {
  if (typeof listener !== 'function') return () => {};
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

/* ── the join ──────────────────────────────────────────────────────────── */

/**
 * Cell keys are numbers, not `"x/y"` strings: indexing 14 000 footprints cost
 * 130–554 ms with strings and 5–15 ms without, and the garbage was the whole
 * difference. 2^21 columns is far past any viewport this layer loads, and a
 * coordinate outside the grid is rejected before the lookup.
 */
const CELL_KEY_STRIDE = 2 ** 21;

/**
 * A coordinate, or NaN.
 *
 * `Number(null)` is 0 and `Number('')` is 0, which would place a row with an
 * empty longitude column off the coast of Ghana and count it as a point that
 * merely missed every building. A DPE with no coordinate and a DPE that landed
 * in the street are two different admissions (A5) and this is where they part.
 * @param {*} value
 * @returns {number}
 */
function finiteCoord(value) {
  if (value === null || value === undefined || value === '') return Number.NaN;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Shoelace area of a flat `[lon, lat, ...]` ring, in square degrees. */
function ringArea(degrees) {
  let sum = 0;
  const n = degrees.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    sum += (degrees[j * 2] * degrees[i * 2 + 1]) - (degrees[i * 2] * degrees[j * 2 + 1]);
  }
  return Math.abs(sum) / 2;
}

/**
 * Crossing-number point-in-ring on a flat `[lon, lat, ...]` array.
 *
 * Half-open in latitude on purpose: a point exactly on a horizontal edge, or on
 * a shared party wall, belongs to exactly one of the two polygons that meet
 * there. West and south edges are inside, east and north edges are outside.
 * @param {ArrayLike<number>} degrees
 * @param {number} lon
 * @param {number} lat
 * @returns {boolean}
 */
export function pointInRing(degrees, lon, lat) {
  let inside = false;
  const n = degrees.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = degrees[i * 2];
    const yi = degrees[i * 2 + 1];
    const xj = degrees[j * 2];
    const yj = degrees[j * 2 + 1];
    if ((yi > lat) !== (yj > lat)
      && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * A point is in a footprint when it is inside the outer ring and inside none of
 * the courtyards.
 * @param {object} footprint `{degrees, holes}`
 * @param {number} lon
 * @param {number} lat
 * @returns {boolean}
 */
export function pointInFootprint(footprint, lon, lat) {
  if (!pointInRing(footprint.degrees, lon, lat)) return false;
  for (const hole of footprint.holes || []) {
    if (hole && hole.length >= 6 && pointInRing(hole, lon, lat)) return false;
  }
  return true;
}

/**
 * A uniform lon/lat grid over the footprints, sized so a cell holds about one
 * building. See the header for what the alternative costs.
 *
 * Stored as parallel typed arrays with numeric cell keys rather than one object
 * per footprint: at the 14 000-volume cap the object-and-string version spent
 * 130–554 ms in the index alone, almost all of it minting 14 000 records and
 * 14 000 `"x/y"` strings for the GC to collect. The flat form builds the same
 * index in 5–15 ms.
 * @param {Array<object>} footprints `{id, degrees, holes}`
 * @param {{cellDeg?: number}} [options]
 * @returns {object} index, consumed by {@link locateBuilding}.
 */
export function buildFootprintIndex(footprints, { cellDeg: forcedCellDeg } = {}) {
  const list = Array.isArray(footprints) ? footprints : [];
  const kept = [];
  const bounds = new Float64Array(list.length * 4);
  const areas = new Float64Array(list.length);
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const footprint of list) {
    const degrees = footprint?.degrees;
    if (!degrees || degrees.length < 6 || !footprint.id) continue;
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    let usable = true;
    for (let i = 0; i < degrees.length; i += 2) {
      const lon = degrees[i];
      const lat = degrees[i + 1];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) { usable = false; break; }
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    if (!usable) continue;
    const slot = kept.length;
    kept.push(footprint);
    bounds[slot * 4] = minLon;
    bounds[slot * 4 + 1] = minLat;
    bounds[slot * 4 + 2] = maxLon;
    bounds[slot * 4 + 3] = maxLat;
    areas[slot] = ringArea(degrees);
    if (minLon < west) west = minLon;
    if (maxLon > east) east = maxLon;
    if (minLat < south) south = minLat;
    if (maxLat > north) north = maxLat;
  }

  const empty = {
    footprints: kept, bounds, areas, cells: new Map(), cellDeg: 0, west: 0, south: 0, count: 0,
  };
  if (!kept.length) return empty;

  // √n cells across the widest side: ~1 building per cell for the square-ish
  // viewports this layer loads, and never fewer than 8 or more than 256 columns
  // so a single outlier footprint cannot mint a million empty buckets.
  const span = Math.max(east - west, north - south, 1e-9);
  const dim = Math.min(256, Math.max(8, Math.round(Math.sqrt(kept.length))));
  const cellDeg = Number.isFinite(forcedCellDeg) && forcedCellDeg > 0
    ? forcedCellDeg
    : Math.max(span / dim, 1e-7);

  const cells = new Map();
  for (let slot = 0; slot < kept.length; slot += 1) {
    const x0 = Math.floor((bounds[slot * 4] - west) / cellDeg);
    const x1 = Math.floor((bounds[slot * 4 + 2] - west) / cellDeg);
    const y0 = Math.floor((bounds[slot * 4 + 1] - south) / cellDeg);
    const y1 = Math.floor((bounds[slot * 4 + 3] - south) / cellDeg);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        const key = x * CELL_KEY_STRIDE + y;
        const bucket = cells.get(key);
        if (bucket) bucket.push(slot);
        else cells.set(key, [slot]);
      }
    }
  }
  return {
    footprints: kept, bounds, areas, cells, cellDeg, west, south, count: kept.length,
  };
}

/**
 * The building a coordinate falls in, or null.
 *
 * On a double hit the SMALLER footprint wins — an annexe inside a courtyard, or
 * a building drawn twice because it straddles two vector tiles, are the two ways
 * this happens for real — with the id as a deterministic tie-break.
 * @param {object} index From {@link buildFootprintIndex}.
 * @param {number} lon
 * @param {number} lat
 * @param {?{tests: number}} [counter] Instrumentation for the cost test.
 * @returns {?string} building id
 */
export function locateBuilding(index, lon, lat, counter = null) {
  if (!index?.cells?.size || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const x = Math.floor((lon - index.west) / index.cellDeg);
  const y = Math.floor((lat - index.south) / index.cellDeg);
  if (x < 0 || y < 0 || x >= CELL_KEY_STRIDE || y >= CELL_KEY_STRIDE) return null;
  const bucket = index.cells.get(x * CELL_KEY_STRIDE + y);
  if (!bucket) return null;

  const { bounds, areas, footprints } = index;
  let bestId = null;
  let bestArea = Infinity;
  for (const slot of bucket) {
    if (lon < bounds[slot * 4] || lon > bounds[slot * 4 + 2]
      || lat < bounds[slot * 4 + 1] || lat > bounds[slot * 4 + 3]) continue;
    if (counter) counter.tests += 1;
    const footprint = footprints[slot];
    if (!pointInFootprint(footprint, lon, lat)) continue;
    const area = areas[slot];
    if (area < bestArea || (area === bestArea && bestId !== null && footprint.id < bestId)) {
      bestArea = area;
      bestId = footprint.id;
    }
  }
  return bestId;
}

/**
 * Join thematic points onto footprints.
 *
 * Pure: same inputs, same Map, no globals read. The two honesty counters are
 * returned rather than logged, because the layer publishing the theme is the one
 * that has to print them (A5).
 * @param {Array<object>} footprints `{id, degrees, holes}` — the loaded volumes.
 * @param {Array<object>} points `{lon, lat, ...}`
 * @param {{cellDeg?: number}} [options]
 * @returns {{byBuilding: Map<string, Array<object>>, matchedPoints: number,
 *   unmatchedPoints: number, unplacedPoints: number, buildings: number,
 *   matchedBuildings: number, tests: number, cellDeg: number}}
 */
export function joinPointsToBuildings(footprints, points, options = {}) {
  const index = buildFootprintIndex(footprints, options);
  const byBuilding = new Map();
  const counter = { tests: 0 };
  let matchedPoints = 0;
  let unmatchedPoints = 0;
  let unplacedPoints = 0;

  for (const point of points || []) {
    const lon = finiteCoord(point?.lon);
    const lat = finiteCoord(point?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) { unplacedPoints += 1; continue; }
    const id = locateBuilding(index, lon, lat, counter);
    if (!id) { unmatchedPoints += 1; continue; }
    matchedPoints += 1;
    const bucket = byBuilding.get(id);
    if (bucket) bucket.push(point);
    else byBuilding.set(id, [point]);
  }

  return {
    byBuilding,
    matchedPoints,
    unmatchedPoints,
    unplacedPoints,
    buildings: index.count,
    matchedBuildings: byBuilding.size,
    tests: counter.tests,
    cellDeg: index.cellDeg,
  };
}

/**
 * Everything the BD TOPO layer needs to repaint: a colour per building id, the
 * two counts that go on the row, and the legend of whoever is painting.
 *
 * A building whose `reduce` returns `null`/`undefined`, or whose `colorFor`
 * refuses the value, is left UNPAINTED — it goes back into the "no data" wash
 * rather than being given a default colour. That is A1 again: a theme declining
 * to grade a building must not be drawn as a grade.
 * @param {Array<object>} footprints
 * @param {?object} theme From {@link getActiveBuildingTheme}.
 * @param {object} [options]
 * @returns {?object}
 */
export function resolveBuildingThemePaint(footprints, theme, options = {}) {
  if (!theme) return null;
  const join = joinPointsToBuildings(footprints, theme.points, options);
  const colorById = new Map();
  const valueById = new Map();
  const values = [];

  for (const [id, bucket] of join.byBuilding) {
    let value;
    try {
      value = theme.reduce(bucket);
    } catch (error) {
      console.warn(`[buildingTheme] ${theme.id}: reduce failed on ${id}:`, error);
      continue;
    }
    if (value === null || value === undefined) continue;
    let css;
    try {
      css = theme.colorFor(value);
    } catch (error) {
      console.warn(`[buildingTheme] ${theme.id}: colorFor failed on ${id}:`, error);
      continue;
    }
    if (!parseCssRgb(css)) continue;
    colorById.set(id, css);
    valueById.set(id, value);
    values.push(value);
  }

  let legend = theme.legend;
  if (theme.legendFor) {
    try {
      legend = theme.legendFor(values);
    } catch (error) {
      console.warn(`[buildingTheme] ${theme.id}: legendFor failed:`, error);
    }
  }
  // Counts for free, by matching each legend swatch against the colours the
  // theme actually produced. The panel prints a count next to every legend
  // entry whether or not the layer supplied one, so an uncounted legend reads
  // "G 0" — a class that IS on screen claiming to be empty, which is exactly
  // the kind of confident wrong number this doctrine is about. A theme whose
  // swatches are not its own output (a continuous ramp shown as five stops)
  // states its counts itself through `legendFor`.
  const countByColor = new Map();
  for (const css of colorById.values()) {
    const key = css.trim().toLowerCase();
    countByColor.set(key, (countByColor.get(key) || 0) + 1);
  }
  legend = (Array.isArray(legend) ? legend : []).map((entry) => ({
    ...entry,
    count: Number.isFinite(entry?.count)
      ? entry.count
      : (countByColor.get(String(entry?.color).trim().toLowerCase()) || 0),
  }));

  return {
    themeId: theme.id,
    label: theme.label,
    unknownLabel: theme.unknownLabel || 'sans donnée',
    colorById,
    valueById,
    legend,
    painted: colorById.size,
    unpainted: Math.max(0, join.buildings - colorById.size),
    buildings: join.buildings,
    matchedPoints: join.matchedPoints,
    unmatchedPoints: join.unmatchedPoints,
    unplacedPoints: join.unplacedPoints,
    tests: join.tests,
  };
}
