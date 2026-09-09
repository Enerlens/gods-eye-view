// Where an aircraft GLB is FETCHED from, as opposed to what it is CALLED.
//
// Every model in this app has one logical name — `/models/airplane.glb` — and
// that string is an identity, not just a URL: it keys the per-class model
// specs (aircraftClass.js), the visual-anchor and trail-anchor tables
// (modelVisualAnchor.js), the `${url}@${scale}` model cache and the
// load-failure log. Renaming it would mean renaming all of that.
//
// The deployed bytes, meanwhile, need a content-addressed path or no edge
// cache will hold them (see MODELS_BASE_DIR in vite.config.js for the two
// measured costs of `no-cache` here). So the identity stays put and only the
// fetch is redirected, at the handful of places that hand a URL to Cesium.
//
// `__GEV_MODELS_BASE__` is a build-time define, not an import: the unit suite
// loads flights.js under plain `node --test`, where an import of a `.glb`
// throws before a single test runs. An undefined identifier under `typeof` is
// safe in both runtimes, and Node lands on the same `/models` the dev server
// serves.

/* global __GEV_MODELS_BASE__ */
/** Directory the built GLBs are served from. `/models` outside a build. */
export const MODELS_BASE = typeof __GEV_MODELS_BASE__ === 'string' ? __GEV_MODELS_BASE__ : '/models';

/** The logical prefix every model name in this codebase starts with. */
const LOGICAL_PREFIX = '/models/';

/**
 * Resolve a logical model name to the URL this build actually serves.
 *
 * Anything that is not a logical model name is returned untouched, so an
 * absolute URL or an already-resolved path passes through rather than being
 * mangled — this sits directly in front of `Model.fromGltfAsync`, and a
 * silently rewritten URL there fails as a missing aircraft, not as an error.
 *
 * @param {string} logicalUrl - e.g. `/models/c172.glb`.
 * @returns {string} The URL to fetch.
 */
export function modelAssetUrl(logicalUrl) {
  const name = String(logicalUrl || '');
  if (!name.startsWith(LOGICAL_PREFIX)) return name;
  return `${MODELS_BASE}/${name.slice(LOGICAL_PREFIX.length)}`;
}
