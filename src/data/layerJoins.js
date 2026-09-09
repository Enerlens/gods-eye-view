/**
 * @module data/layerJoins
 *
 * **Le tableau d'affichage entre couches.** One layer offers a fact; another
 * reads it; neither imports the other.
 *
 * ── The problem this is the smallest possible answer to ─────────────────────
 *
 * The 2026-09 audit counted the joins in this repository and found three: the
 * Fiche implantation, the BD TOPO volumes' three themes, and the address
 * radiography. Outside those, **no layer read another layer's data at all** —
 * the vessels did not know the ports were drawn a row below them, the flights
 * did not know the airports were, the vigilance did not know the gauges were.
 *
 * The reason is structural rather than an oversight: a layer module is a
 * singleton with a lifecycle, and importing one from another would couple two
 * lifecycles, load a pack that may never be enabled, and make a cycle the
 * moment the second layer wanted anything back. So the joins were not written.
 *
 * ── What this is ────────────────────────────────────────────────────────────
 *
 * A string-keyed board of provider functions. A layer PUBLISHES on enable and
 * takes it down on disable; a consumer ASKS by key and gets `null` when nobody
 * is offering. That is the whole surface, and the three properties it buys are
 * the reason it is worth a file:
 *
 *   · **No import edge.** `aisLiveVessels.js` never mentions the ports layer.
 *   · **Absence is ordinary.** A consumer asking for a key nobody publishes
 *     gets `null` and says less on its card — never an error, never a blank
 *     where a sentence was promised. That is what makes it honest to join two
 *     layers a reader can switch off independently.
 *   · **A throw is contained.** `askJoin` catches, warns once per key, and
 *     answers `null`: one misbehaving provider cannot take down a card.
 *
 * ── What it deliberately is NOT ─────────────────────────────────────────────
 *
 * Not an event bus (no subscriptions, no ordering, no replay), not a cache
 * (the provider owns its own), and not a dependency graph (nothing here can
 * enable a layer — a join reads what is already loaded, and a card that needs
 * a layer switched on says so instead of switching it on).
 *
 * Module-scoped, like every layer it serves. Pure apart from that state: no
 * fetch, no DOM, no Cesium.
 */

/** @type {Map<string, Function>} */
const providers = new Map();
/** Keys whose provider has already thrown once. Warn once, not per frame. */
const warned = new Set();

/**
 * Offer a fact under a key.
 *
 * @param {string} key Stable name, `owner/what` — `ports/directory`.
 * @param {Function} provider Called by `askJoin`. Must be cheap: a card asks
 *   it on every repaint, so anything expensive belongs behind the provider's
 *   own cache rather than in the call.
 * @returns {() => void} Take it down. Idempotent, and it only removes THIS
 *   provider — a later publisher of the same key is not disturbed by an
 *   earlier one's teardown running late.
 */
export function publishJoin(key, provider) {
  if (typeof key !== 'string' || !key || typeof provider !== 'function') return () => {};
  const wasPresent = providers.has(key);
  providers.set(key, provider);
  warned.delete(key);
  if (!wasPresent) announce(key, true);
  return () => {
    if (providers.get(key) !== provider) return;
    providers.delete(key);
    announce(key, false);
  };
}

/**
 * Is anybody offering this?
 * @param {string} key
 * @returns {boolean}
 */
export function hasJoin(key) {
  return providers.has(key);
}

/** @type {Map<string, Set<(present: boolean) => void>>} */
const watchers = new Map();

/** Fire a key's watchers on a PRESENCE transition, never on a re-publish. */
function announce(key, present) {
  const listeners = watchers.get(key);
  if (!listeners) return;
  for (const listener of listeners) {
    try {
      listener(present);
    } catch (error) {
      // A broken watcher must never break a layer's enable path — the same
      // rule `askJoin` applies to a broken provider.
      if (!warned.has(`watch:${key}`)) {
        warned.add(`watch:${key}`);
        console.warn(`[Joins] watcher for ${key} threw:`, error);
      }
    }
  }
}

/**
 * Follow whether anybody is offering a key.
 *
 * `askJoin` is a PULL, which is right for a card: it asks when it draws. Some
 * consumers need a PUSH — `amenities-fr` suppresses its `medecin` family the
 * moment `medecins-fr` starts drawing the same cabinets, and waiting out a
 * poll would leave the duplicate on screen for a quarter of an hour.
 *
 * Fires on TRANSITIONS only: publishing over an existing provider is the same
 * offer from a new owner, and a consumer that re-rendered for it would repaint
 * on every viewport reconcile of the publishing layer.
 *
 * @param {string} key
 * @param {(present: boolean) => void} handler
 * @returns {() => void} Stop following. Idempotent.
 */
export function watchJoin(key, handler) {
  if (typeof key !== 'string' || !key || typeof handler !== 'function') return () => {};
  let listeners = watchers.get(key);
  if (!listeners) { listeners = new Set(); watchers.set(key, listeners); }
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
    if (!listeners.size) watchers.delete(key);
  };
}



/**
 * Ask for a fact.
 *
 * @param {string} key
 * @param {...*} args Passed to the provider.
 * @returns {*} Whatever the provider answered, or `null` when nobody publishes
 *   the key or the provider threw.
 */
export function askJoin(key, ...args) {
  const provider = providers.get(key);
  if (!provider) return null;
  try {
    return provider(...args) ?? null;
  } catch (error) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[Joins] ${key} provider error:`, error);
    }
    return null;
  }
}

/** Every key currently offered, sorted. Diagnostics and tests. */
export function joinKeys() {
  return [...providers.keys()].sort();
}

/** Drop everything. Test seam only — layers take their own offers down. */
export function _resetJoinsForTest() {
  providers.clear();
  watchers.clear();
  warned.clear();
}
