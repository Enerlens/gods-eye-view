/**
 * Moving a floating panel, and the three rules every panel here already obeys.
 *
 * The app has had draggable panels since long before this module: `ui.js` wires
 * five of them by hand (`_makePanelDraggable`), each with its own after-drag
 * hook — the display tray re-pins to the right rail, the CCTV panel recomputes
 * its scroll height. What it does NOT have is a way for a panel that `ui.js`
 * does not know about to be moved: the layer-owned panels mount themselves into
 * the viewer container at runtime, and `ui.js` has no reference to them.
 *
 * This module is the three things all of them must agree on, in one place:
 *
 *   · **The 6-pixel inset.** A panel dragged to an edge stays fully on screen,
 *     and stays there when the window is resized under it — a panel whose
 *     header has fallen off the top of the viewport cannot be dragged back.
 *   · **The storage key.** `godsEyeView.<version>.panelPos.<id>`, versioned, so
 *     a layout change invalidates every saved position at once rather than
 *     restoring half a stale arrangement.
 *   · **What is NOT a drag handle.** A panel full of controls cannot be grabbed
 *     anywhere: a slider that moves the panel instead of scrubbing is worse
 *     than a panel that does not move. The default ignore list is every
 *     interactive element, and callers add their own.
 *
 * The geometry is pure and exported on its own, because the clamp is the part
 * that has to be right on a viewport nobody chose and it is the part a test can
 * hold. `attachPanelDrag` is the thin DOM wiring around it.
 *
 * @module panelDrag
 */

/** Kept in lockstep with `PANEL_POSITION_STORAGE_VERSION` in `ui.js`. */
export const PANEL_POSITION_STORAGE_VERSION = 'v8';

/**
 * How much of the panel must stay inside the viewport, in pixels.
 *
 * Six, matching the drag clamp `ui.js` has used since the layout audit. It is
 * an INSET and not a margin: the panel may not be dragged closer than this to
 * any edge, so its header — the only surface that can drag it back — is always
 * reachable.
 */
export const PANEL_DRAG_INSET_PX = 6;

/** Controls that must never start a drag when the pointer lands on them. */
const DEFAULT_IGNORE_SELECTOR = 'input, select, option, textarea, button, a, [role="slider"]';

/**
 * The versioned localStorage key holding one panel's position.
 * @param {string} panelId DOM id of the panel.
 * @returns {string}
 */
export function panelPositionStorageKey(panelId) {
  return `godsEyeView.${PANEL_POSITION_STORAGE_VERSION}.panelPos.${panelId}`;
}

/**
 * Clamp a desired position so the panel stays fully on screen.
 *
 * `Math.max(inset, …)` on the upper bound as well as the lower one is what
 * keeps a panel LARGER than the viewport reachable: on a short window the
 * available room goes negative, and without the guard the clamp would pin the
 * panel off the top of the screen where nothing can grab it.
 *
 * @param {object} input
 * @param {number} input.left Desired left, in px.
 * @param {number} input.top Desired top, in px.
 * @param {number} input.width Panel width, in px.
 * @param {number} input.height Panel height, in px.
 * @param {number} input.viewportWidth
 * @param {number} input.viewportHeight
 * @param {number} [input.inset]
 * @returns {{left: number, top: number}}
 */
export function clampPanelPosition({
  left,
  top,
  width,
  height,
  viewportWidth,
  viewportHeight,
  inset = PANEL_DRAG_INSET_PX,
}) {
  const safe = (value) => (Number.isFinite(value) ? value : 0);
  const maxLeft = Math.max(inset, safe(viewportWidth) - safe(width) - inset);
  const maxTop = Math.max(inset, safe(viewportHeight) - safe(height) - inset);
  return {
    left: Math.max(inset, Math.min(maxLeft, safe(left))),
    top: Math.max(inset, Math.min(maxTop, safe(top))),
  };
}

/**
 * Read a saved position, or null when there is none worth restoring.
 *
 * A malformed or partial record is null rather than a half-applied position:
 * the panel falls back to its stylesheet anchor, which is always somewhere a
 * reader can see.
 *
 * @param {string} panelId
 * @param {Storage} [storage]
 * @returns {{left: number, top: number}|null}
 */
export function readPanelPosition(panelId, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(panelPositionStorageKey(panelId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const left = Number(parsed?.left);
    const top = Number(parsed?.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
    return { left: Math.round(left), top: Math.round(top) };
  } catch {
    return null;
  }
}

/**
 * Persist a position. Storage being unavailable is not an error worth throwing
 * over — a private-mode reader simply gets no memory of where they left it.
 * @param {string} panelId
 * @param {{left: number, top: number}} position
 * @param {Storage} [storage]
 * @returns {boolean} Whether it was written.
 */
export function writePanelPosition(panelId, position, storage = globalThis.localStorage) {
  try {
    storage?.setItem(panelPositionStorageKey(panelId), JSON.stringify({
      left: Math.round(position.left),
      top: Math.round(position.top),
    }));
    return true;
  } catch {
    return false;
  }
}

/** Forget a saved position — the reader asked for the default anchor back. */
export function clearPanelPosition(panelId, storage = globalThis.localStorage) {
  try {
    storage?.removeItem(panelPositionStorageKey(panelId));
    return true;
  } catch {
    return false;
  }
}

/**
 * Make a panel draggable, and remember where it was left.
 *
 * The panel is positioned in `left`/`top` for the whole drag — whatever anchor
 * the stylesheet used (`bottom`, a centring `transform`) is neutralised on the
 * first grab, because a panel anchored to two opposite edges cannot be moved by
 * writing one of them.
 *
 * @param {HTMLElement} panelEl
 * @param {object} [options]
 * @param {string} [options.panelId] Storage key; omit to disable persistence.
 * @param {HTMLElement} [options.handle] Grab surface. Defaults to the panel.
 * @param {string} [options.ignoreSelector] Extra controls that never drag.
 * @param {() => void} [options.onMove] Called on every clamped move.
 * @param {() => void} [options.onEnd] Called once the pointer is released.
 * @param {Storage} [options.storage]
 * @returns {() => void} Disposer: removes every listener it installed.
 */
export function attachPanelDrag(panelEl, {
  panelId = null,
  handle = null,
  ignoreSelector = '',
  onMove = null,
  onEnd = null,
  storage = globalThis.localStorage,
} = {}) {
  if (!panelEl?.addEventListener || typeof window === 'undefined') return () => {};
  const grip = handle || panelEl;
  const ignore = ignoreSelector
    ? `${DEFAULT_IGNORE_SELECTOR}, ${ignoreSelector}`
    : DEFAULT_IGNORE_SELECTOR;

  /** Apply a position in the coordinate system the drag owns. */
  const place = (left, top) => {
    panelEl.style.left = `${Math.round(left)}px`;
    panelEl.style.top = `${Math.round(top)}px`;
    panelEl.style.right = 'auto';
    panelEl.style.bottom = 'auto';
    panelEl.style.transform = 'none';
  };

  const clampToViewport = (left, top) => {
    const rect = panelEl.getBoundingClientRect();
    return clampPanelPosition({
      left,
      top,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
  };

  /**
   * The teardown for the drag currently in flight, or null.
   *
   * ONE reference, and the handlers themselves are per-drag consts — the shape
   * `ui.js` has always used. The first version of this module hoisted
   * `pointerMove`/`pointerUp` into this closure so the disposer could reach
   * them, and that is a listener leak with teeth: a second `pointerdown` while
   * one drag is live (two fingers on a touchscreen — a touch pointer reports
   * `button === 0` — or a re-grab after a `pointerup` was swallowed by an
   * alt-tab) reassigns both variables, so the first release removes the SECOND
   * drag's handlers and strands its own on `window` with nothing left pointing
   * at them. They then keep dragging a panel nobody is holding, `dispose()`
   * cannot detach them, and the next click writes the detached node's rect —
   * (0, 0) — into storage, so the panel comes back in the top-left corner on
   * the following session.
   */
  let activeDrag = null;

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    if (typeof event.target?.closest === 'function' && event.target.closest(ignore)) return;
    // A drag already in flight is ENDED, not refused: refusing would brick the
    // panel for the rest of the session the one time a `pointerup` goes
    // missing, which is exactly when a reader needs to grab it again.
    activeDrag?.();
    event.preventDefault();
    const rect = panelEl.getBoundingClientRect();
    const grabX = event.clientX - rect.left;
    const grabY = event.clientY - rect.top;
    place(rect.left, rect.top);
    panelEl.classList.add('panel-dragging');

    const onPointerMove = (moveEvent) => {
      const next = clampToViewport(moveEvent.clientX - grabX, moveEvent.clientY - grabY);
      place(next.left, next.top);
      onMove?.(next);
    };
    const onPointerUp = () => finish();
    function finish({ persist = true } = {}) {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      if (activeDrag === finish) activeDrag = null;
      panelEl.classList.remove('panel-dragging');
      if (!persist) return;
      const box = panelEl.getBoundingClientRect();
      // A detached panel measures (0, 0), and writing that would move it to the
      // corner on the next session. Nothing to persist is better than a lie.
      if (box.width === 0 && box.height === 0) return;
      if (panelId) writePanelPosition(panelId, { left: box.left, top: box.top }, storage);
      onEnd?.({ left: box.left, top: box.top });
    }
    activeDrag = finish;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  // A resized window can leave a panel half off screen, and a header off the
  // top of the viewport is a panel nobody can drag back.
  const onResize = () => {
    if (!panelEl.style.left || panelEl.style.left === 'auto') return;
    const rect = panelEl.getBoundingClientRect();
    const next = clampToViewport(rect.left, rect.top);
    place(next.left, next.top);
  };

  grip.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('resize', onResize);

  return () => {
    grip.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('resize', onResize);
    // A layer switched off mid-drag: drop the handlers without saving a
    // position measured on a panel that is about to be removed.
    activeDrag?.({ persist: false });
  };
}

/**
 * Restore a saved position onto a freshly mounted panel.
 *
 * Clamped on the way in, because the window it was saved from is not
 * necessarily the window it is being restored into.
 *
 * @param {HTMLElement} panelEl
 * @param {string} panelId
 * @param {Storage} [storage]
 * @returns {boolean} Whether a position was applied.
 */
export function restorePanelPosition(panelEl, panelId, storage = globalThis.localStorage) {
  if (!panelEl || typeof window === 'undefined') return false;
  const saved = readPanelPosition(panelId, storage);
  if (!saved) return false;
  const rect = panelEl.getBoundingClientRect();
  const next = clampPanelPosition({
    left: saved.left,
    top: saved.top,
    width: rect.width,
    height: rect.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  });
  panelEl.style.left = `${next.left}px`;
  panelEl.style.top = `${next.top}px`;
  panelEl.style.right = 'auto';
  panelEl.style.bottom = 'auto';
  panelEl.style.transform = 'none';
  return true;
}
