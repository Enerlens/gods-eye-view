/**
 * @module coverageBriefing
 *
 * The card a territorial layer shows before it starts — three lines, two
 * buttons, and no third state.
 *
 * ── Why a card rather than a tooltip ────────────────────────────────────────
 * `comptages-fr` draws a MEASURED vehicle count on 2 946 arcs of Paris street,
 * and every part of that sentence is surprising: this globe's other two road
 * layers publish a congestion RATIO and a declared STATUS, neither of which is
 * a number of vehicles, and this one stops at the périphérique. A reader who
 * presses `Comptages · Paris` from a view of Osaka is about to switch on a
 * layer that will draw nothing, for a reason no control can fit in its label.
 *
 * A tooltip cannot carry that: it is mouse-only, it is gone on the next
 * movement, and it cannot offer the flight. So the card exists, and it is
 * bounded hard — it opens ONLY when the camera is outside the layer's territory
 * (`manager._shouldBriefCoverage`), which means the reader who is already over
 * Paris and knows exactly what they want never meets it.
 *
 * ── The checkbox says what it costs ─────────────────────────────────────────
 * "Ne plus demander — aller directement" rather than "ne plus afficher", and
 * the difference is not tone. Suppressing this card cannot mean "switch the
 * layer on where it draws nothing" — that is the defect, not a preference — so
 * a suppressed card resolves `goto` and the camera moves. That is a real
 * consequence and the label states it at the moment consent is given, instead
 * of surprising the reader the next time they press the chip.
 *
 * The suppression is PER LAYER. Each card teaches one subject, and a reader who
 * has learned what a comptage is has not thereby learned what Vélo'v dock
 * occupancy is.
 *
 * ── What this module does not do ────────────────────────────────────────────
 * It does not move the camera and it does not touch a layer. It resolves a
 * word — `'goto'`, `'here'`, or `null` — and `DataLayerManager` does the rest.
 * Keeping it inert is what lets the flight reuse the app's own city-pill path
 * rather than growing a second camera verb here.
 */

/** Per-layer durable suppression, written only by the checkbox. */
export const COVERAGE_BRIEFING_STORAGE_PREFIX = 'gev:coverage-briefing:';

/** Storage key for one layer's suppression. */
export function coverageBriefingStorageKey(layerId) {
  return `${COVERAGE_BRIEFING_STORAGE_PREFIX}${layerId}:v1`;
}

/*
 * STORAGE ACCESS IS LAZY AND GUARDED — NEVER A DEFAULT PARAMETER.
 *
 * Same reasoning as `firstRunExperience.js`, and the same failure it avoids:
 * `globalThis.localStorage` is a getter that THROWS SecurityError under
 * Safari's private mode and some enterprise policies. Evaluated in a default
 * parameter it throws before the function body starts, outside every try here.
 */
function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** Read one key, treating every failure as "nothing stored". */
function readStored(injected, key) {
  try {
    return resolveStore(injected)?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
}

/** Write one key, best-effort. Reports whether the value actually landed. */
function writeStored(injected, key, value) {
  try {
    const store = resolveStore(injected);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Remove one key, best-effort. */
function removeStored(injected, key) {
  try {
    const store = resolveStore(injected);
    if (typeof store?.removeItem !== 'function') return false;
    store.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether this layer's card has been suppressed.
 * @param {string} layerId
 * @param {object} [storage] Injected store; `undefined` uses the global.
 * @returns {boolean}
 */
export function isCoverageBriefingSuppressed(layerId, storage) {
  return readStored(storage, coverageBriefingStorageKey(layerId)) === 'suppressed';
}

/**
 * Write (or clear) one layer's suppression.
 * @param {string} layerId
 * @param {boolean} suppressed
 * @param {object} [storage]
 * @returns {boolean} Whether the change actually landed.
 */
export function setCoverageBriefingSuppressed(layerId, suppressed, storage) {
  const key = coverageBriefingStorageKey(layerId);
  return suppressed ? writeStored(storage, key, 'suppressed') : removeStored(storage, key);
}

/**
 * The decision a suppressed card would have produced.
 *
 * Exported and named rather than inlined, because it is the one place the
 * checkbox's promise is kept: a reader who ticked "aller directement" gets the
 * flight, and a layer with nowhere to fly to gets switched on where we stand
 * rather than silently doing nothing.
 *
 * @param {?string} destination Preset city id, or null.
 * @returns {'goto'|'here'}
 */
export function suppressedCoverageChoice(destination) {
  return destination ? 'goto' : 'here';
}

/**
 * Mount the card.
 *
 * @param {HTMLElement|null} root The `#coverage-briefing` element.
 * @param {object} [options]
 * @param {object} [options.storage] Injected store, for tests.
 * @returns {?{ask: function(object): Promise<?string>, destroy: function(): void}}
 */
export function initCoverageBriefing(root, { storage } = {}) {
  if (!root) return null;
  const titleNode = root.querySelector('[data-coverage-title]');
  const bodyNode = root.querySelector('[data-coverage-body]');
  const scopeNode = root.querySelector('[data-coverage-scope]');
  const gotoButton = root.querySelector('[data-coverage-choice="goto"]');
  const hereButton = root.querySelector('[data-coverage-choice="here"]');
  const gotoLabel = root.querySelector('[data-coverage-goto-label]');
  const suppressBox = root.querySelector('[data-coverage-suppress]');

  /** The open card's resolver, and the layer it is about. */
  let pending = null;
  let focusReturn = null;

  const settle = (choice) => {
    if (!pending) return;
    const { resolve } = pending;
    pending = null;
    root.classList.remove('visible');
    root.hidden = true;
    // Give the keyboard back to whatever opened this. Without it, dismissing
    // the card drops focus onto <body> and the next Tab restarts at the top of
    // the document — from a chip strip six panels down.
    try { focusReturn?.focus?.({ preventScroll: true }); } catch { /* no-op */ }
    focusReturn = null;
    resolve(choice);
  };

  const onKeyDown = (event) => {
    if (!pending) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      settle(null);
    }
  };

  const onGoto = () => settle('goto');
  const onHere = () => settle('here');
  const onSuppressChange = () => {
    if (!pending) return;
    // Written immediately, like the first-run card: a reader who ticks the box
    // and then presses ESC has still expressed the preference.
    const landed = setCoverageBriefingSuppressed(
      pending.layerId,
      suppressBox.checked === true,
      storage,
    );
    // Storage refused (private mode, quota): take the promise back rather than
    // display a preference nothing stored.
    if (!landed && suppressBox.checked) suppressBox.checked = false;
  };

  gotoButton?.addEventListener('click', onGoto);
  hereButton?.addEventListener('click', onHere);
  suppressBox?.addEventListener('change', onSuppressChange);
  document.addEventListener('keydown', onKeyDown);

  /**
   * Ask the reader. Resolves `'goto'`, `'here'` or `null`.
   * @param {object} request From `DataLayerManager._runCoverageBriefing`.
   * @returns {Promise<?string>}
   */
  const ask = (request) => {
    const layerId = request?.layerId;
    const destination = request?.goto || null;
    if (!layerId) return Promise.resolve(null);
    // The reader already told us not to ask. Honour the word the checkbox used.
    if (isCoverageBriefingSuppressed(layerId, storage)) {
      return Promise.resolve(suppressedCoverageChoice(destination));
    }
    // A second chip pressed while a card is open: the first question is
    // abandoned, not answered. Resolving it `null` leaves that layer exactly as
    // the reader left it — off.
    settle(null);

    if (titleNode) titleNode.textContent = request.brief?.title || request.layerName || '';
    if (scopeNode) scopeNode.textContent = request.chip || '';
    if (bodyNode) {
      bodyNode.replaceChildren(...(request.brief?.lines || []).map((line) => {
        const p = document.createElement('p');
        p.textContent = line;
        return p;
      }));
    }
    if (gotoButton) {
      gotoButton.hidden = !destination;
      if (gotoLabel && destination) {
        gotoLabel.textContent = request.gotoName
          ? `Aller à ${request.gotoName}`
          : 'Aller à la zone couverte';
      }
    }
    if (suppressBox) suppressBox.checked = false;

    focusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.hidden = false;
    // The transition needs a starting state to animate FROM — set `hidden` and
    // `.visible` in one tick and the card paints already open. Everywhere else
    // in this app that is a `requestAnimationFrame`, and NOT here: rAF does not
    // tick reliably on a page whose WebGL loop has stalled (SwiftShader in every
    // headless harness), and a card that reveals only when the globe feels like
    // rendering is a card that sometimes never appears.
    //
    // Reading a layout property forces the style flush the frame would have
    // brought, synchronously and without a clock. It is the one deliberate
    // reflow in this module and it buys determinism plus a frame of latency.
    void root.offsetHeight;
    root.classList.add('visible');
    const first = destination ? gotoButton : hereButton;
    try { first?.focus?.({ preventScroll: true }); } catch { /* no-op */ }

    return new Promise((resolve) => {
      pending = { layerId, resolve };
    });
  };

  const destroy = () => {
    settle(null);
    gotoButton?.removeEventListener('click', onGoto);
    hereButton?.removeEventListener('click', onHere);
    suppressBox?.removeEventListener('change', onSuppressChange);
    document.removeEventListener('keydown', onKeyDown);
  };

  return { ask, destroy };
}
