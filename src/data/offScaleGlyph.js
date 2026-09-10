/*
 * OFF-SCALE GLYPH — one sign for "this mark carries no value on the scale
 * above it", so a reader learns it once instead of once per layer.
 *
 * WHY A SHAPE AND NOT A COLOUR. Rule D3 asks for a motif: "l'absence de donnée
 * se code par un motif, pas par une teinte". On a photoreal globe there is no
 * neutral background to reserve, and a grey is just another class — which is
 * exactly what happened on the road subject. Three layers on one fused row each
 * invented their own desaturated grey for their own refusal:
 *
 *   #9b9187  Rythme indéterminé   comptages — the week cannot be classified
 *   #8a93a6  Non classé           événements — the category code is unknown
 *   #7c8794  Non communiqué       état du réseau — nobody publishes a state
 *
 * ΔE 16 to 18 apart, on an 8 px disc, over orthophoto. Three signs for one
 * idea, none of them legible as a group. D3 also gives the second reason to
 * prefer a motif here, and it is the one that decides it: a pattern survives
 * NVG and FLIR, a hue is destroyed by them (F5).
 *
 * WHAT IS SHARED AND WHAT IS NOT. The SHAPE is shared; the INK is not. Each
 * layer keeps its own grey, because `comptagesRhythm.test.mjs` holds a standing
 * invariant that no rhythm colour may equal a road-status colour — two layers
 * drawing over central Paris must not share a vocabulary — and unifying the
 * greys would have broken it to fix a smaller problem. The panel masks this
 * glyph and paints the row's own colour through it, so one shape carries three
 * inks and nothing collides.
 *
 * WHAT IT MUST NOT BE. Never a smaller or fainter version of a measured
 * swatch: A1 forbids the same sign for a measured value and a default, and a
 * small disc is a LOW VALUE, not the absence of one. The hatch belongs to no
 * scale — that is the whole message.
 */

const _b64 = (value) => (typeof btoa === 'function'
  ? btoa(value)
  : Buffer.from(value, 'utf8').toString('base64'));

/** Swatch box side, in the SVG's own user units. Matches `sizeLegendGlyphs`. */
export const OFF_SCALE_BOX = 18;

/** @type {?string} Built at most once — the shape takes no parameter. */
let _cached = null;

/**
 * The hatched swatch a row draws when its mark carries no value on the scale.
 *
 * Diagonal rule, drawn edge to edge so it reads as a texture rather than as a
 * mark with a size. `stroke-width` is chosen so the hatch survives the 8 px the
 * panel scales it to: below ~1.4 user units the strokes merge into a flat fill
 * at that size, which would put the row back on the colour channel.
 *
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function offScaleGlyph() {
  if (_cached) return _cached;
  const B = OFF_SCALE_BOX;
  const strokes = [-B / 2, 0, B / 2, B]
    .map((offset) => `<path d="M${offset} ${B} L${offset + B} 0"/>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${B} ${B}">`
    + `<g stroke="#000" stroke-width="2.6" fill="none">${strokes}</g></svg>`;
  _cached = `data:image/svg+xml;base64,${_b64(svg)}`;
  return _cached;
}
