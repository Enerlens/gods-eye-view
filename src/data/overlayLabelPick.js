import { hitTestWorldOverlay } from '../overlays/worldOverlay.js';

/**
 * The name on the globe is a click surface, not a caption.
 *
 * Every layer here draws two things per record: a native Cesium primitive (a
 * point, a billboard, a clamped stroke) and — for the few records that win a
 * collision slot — an ambient label carrying the record's NAME, painted by the
 * shared world overlay a dozen pixels above it. Only the first of those was
 * ever clickable. The label is the part that says what the object *is*, it is
 * five to twenty times the target area of the dot it belongs to, and it reads
 * like a button, so it was the part people aimed at — and every one of those
 * clicks landed on empty terrain and DISMISSED the selection instead.
 *
 * The reason is mechanical, not a policy: the overlay paints onto a
 * `pointer-events: none` canvas stacked over the Cesium viewport, so
 * `scene.pick()` under a label returns whatever is behind it (usually the
 * globe, i.e. nothing). The host already publishes a screen-space hit
 * rectangle for every entry flagged `interactive`, and
 * `hitTestWorldOverlay()` already resolves the topmost one. What was missing
 * was the two lines in each layer's click handler that consult it, and this
 * module is those two lines written once.
 *
 * ── The ordering rule ───────────────────────────────────────────────────────
 * A layer's LEFT_CLICK handler must resolve in this order, and the order is
 * not cosmetic:
 *
 *   1. `scene.pick()` — a native primitive under the cursor wins. Labels float
 *      ABOVE their anchor, so a dot and a label rarely overlap; when they do,
 *      the thing the depth buffer says you are pointing at is the honest
 *      answer, and it is also the one the pick registry can arbitrate between
 *      layers.
 *   2. this module — the label plane, which the depth buffer knows nothing
 *      about.
 *   3. only then, empty space → clear the selection.
 *
 * Putting the label test first would let a label drawn over a NEIGHBOURING
 * station's dot steal that station's click.
 *
 * ── Why `has` is not optional in practice ───────────────────────────────────
 * Hit rectangles are published per painted frame and pooled, so a rect for a
 * record that has since left the viewport can outlive the record by a frame.
 * Resolving that id against the layer's live record map is what keeps a click
 * from selecting a station that is no longer on screen — and a miss there is
 * NOT the same as empty space, so callers get `null` and fall through to their
 * own "nothing here" branch exactly once.
 *
 * ── The id convention ───────────────────────────────────────────────────────
 * Ambient labels are published under `<layer>-label:<recordId>` (powerGrid,
 * gasFrance, rteGeneration, frHydroPlants, roadEventsFrance) or under the bare
 * record id (hubeauHydrometry, satellites, telegeographySubmarineCables).
 * `prefix` spans both: pass the prefix the layer uses, or `''` when the entry
 * id IS the record id.
 */

/**
 * Strip an ambient-label entry id down to the record id it names.
 *
 * Returns null rather than a partial match when the prefix does not fit, so a
 * layer that publishes several entry families under one source (a per-record
 * label and a per-département label, say) can tell them apart by asking twice.
 *
 * @param {string|null|undefined} entryId Overlay entry id.
 * @param {string} [prefix=''] Entry-id prefix this family uses.
 * @returns {?string} Record id, or null when the entry belongs to another family.
 */
export function overlayLabelRecordId(entryId, prefix = '') {
  const text = typeof entryId === 'string' ? entryId : '';
  if (!text) return null;
  const head = String(prefix ?? '');
  if (head && !text.startsWith(head)) return null;
  const recordId = head ? text.slice(head.length) : text;
  return recordId || null;
}

/**
 * Resolve a click position against one source's ambient labels.
 *
 * @param {{x:number,y:number}|null|undefined} position CSS-pixel click position
 *   (a Cesium `LEFT_CLICK` movement's `position`).
 * @param {object} options
 * @param {string} options.sourceId World-overlay source id to restrict the hit
 *   test to — a layer must never resolve a sibling's label as its own.
 * @param {string} [options.prefix=''] Entry-id prefix, per the convention above.
 * @param {(recordId:string)=>boolean} [options.has] Liveness guard against the
 *   layer's current record map.
 * @param {Function} [options.hitTest=hitTestWorldOverlay] Host seam, injected
 *   by tests.
 * @returns {?string} Record id under the cursor, or null.
 */
export function pickOverlayLabelId(position, {
  sourceId,
  prefix = '',
  has = null,
  hitTest = hitTestWorldOverlay,
} = {}) {
  if (typeof hitTest !== 'function' || !sourceId) return null;
  const x = Number(position?.x);
  const y = Number(position?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  let hit;
  try {
    hit = hitTest(x, y, { sourceId: String(sourceId) });
  } catch {
    // A host mid-teardown must never break click handling for the layer.
    return null;
  }
  if (!hit || hit.sourceId !== String(sourceId)) return null;
  const recordId = overlayLabelRecordId(hit.entryId, prefix);
  if (!recordId) return null;
  if (typeof has === 'function' && !has(recordId)) return null;
  return recordId;
}
