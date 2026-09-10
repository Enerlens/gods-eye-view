/**
 * @module militaryFrancePack
 *
 * The French half of "Sites militaires", extracted once and shipped with the
 * app, so the layer has something to draw at an altitude where Overpass has
 * nothing to say in time.
 *
 * ── WHY, IN ONE MEASUREMENT ─────────────────────────────────────────────────
 *
 * The live proxy asks Overpass for the current viewport. Measured 2026-09-10
 * against overpass-api.de with this layer's own filters: a 1.5° box answers in
 * 4 s, a 5° box in 41 s, a 7.5° box in 50 s even with the geometry dropped, and
 * a 10° box in 84 s. The client gate was 10°, so every view between roughly a
 * région and a country was a promise the upstream could not keep — the layer
 * spent forty seconds loading, or failed outright, which is what a probe
 * measured at 7.7°.
 *
 * France extracted whole is 7 530 features. Fetched once, it answers instantly
 * at every altitude, and it is why "zoom in to load" is no longer the answer to
 * pulling back over your own country.
 *
 * ── WHAT IT IS AND IS NOT ───────────────────────────────────────────────────
 *
 * It is one POINT per mapped feature, with its class and its name. It is not:
 *
 *   - a footprint. `out center tags` returns centres; the polygon is worth
 *     having at 5 km and sub-pixel at 500, so it stays with the live query.
 *   - live. The pack carries the date it was extracted and the layer says it.
 *   - the world. Outside France the live query is still the only source, and
 *     the layer's own gate still applies there.
 *
 * The two sets merge by OSM ID and the LIVE record always wins, so a base
 * re-mapped this morning is drawn as this morning's record with its footprint,
 * not as last month's point.
 *
 * ── WHY THE FILE IS OVERPASS-SHAPED ─────────────────────────────────────────
 *
 * Each line is an Overpass element, not a bespoke record, so the pack is parsed
 * by `normalizeMilitaryInstallations` — the SAME function the live payload goes
 * through. A second parser would be a second definition of what a class is, and
 * the two would drift on the first tag added upstream.
 *
 * Rebuild with `node scripts/build-osm-military-fr.mjs`.
 */
import { normalizeMilitaryInstallations } from './militaryInstallationData.js';

/**
 * Where the pack file is served from.
 *
 * Two deliberate choices in one line. `?url` hands back an asset URL instead of
 * inlining ~470 kB into a JavaScript chunk, and the import is DYNAMIC so even
 * that URL is only resolved when somebody switches the layer on — which is also
 * what lets `node --test` import this module at all, since plain node cannot
 * resolve a Vite asset specifier and a static import is resolved before any
 * test-side stub could be installed.
 *
 * @returns {Promise<string>} The packed file's URL.
 */
async function packUrl() {
  return (await import('./local_data/military/military-fr.jsonl?url')).default;
}

// NO FRANCE BOUNDING BOX ANYWHERE IN THIS FILE. A box around the French
// Republic including its overseas territories is most of the planet — Polynésie
// sits at 149°W and Nouvelle-Calédonie at 167°E — so "is the camera over
// France?" is not a question a rectangle can answer. `recordsInBox` walks the
// pack instead: one pass over 7 530 points per camera settle, and it stays
// correct the day OSM maps a territory nobody listed here.

/** @type {?Promise<{records: Array<object>, retrievedAt: string, count: number}>} */
let _load = null;

/**
 * Parse the pack file.
 *
 * The first line is metadata, the rest are Overpass elements. A file whose
 * first line is not the metadata is REFUSED rather than parsed as a feature:
 * silently treating a header as data would put a mark at latitude undefined,
 * and the layer would show it as a site.
 *
 * @param {string} text The file's contents.
 * @returns {{records: Array<object>, retrievedAt: string, count: number}}
 */
export function parseMilitaryFrancePack(text) {
  const lines = String(text || '').split('\n').filter((line) => line.trim());
  if (!lines.length) throw new Error('military-fr pack is empty');
  const meta = JSON.parse(lines[0]);
  if (meta?.pack !== 'military-fr') throw new Error('military-fr pack has no metadata line');
  const elements = lines.slice(1).map((line) => JSON.parse(line));
  const { records } = normalizeMilitaryInstallations(
    { elements },
    // Not "now": these features were surveyed on the day the pack was built,
    // and a fresher timestamp than the data is exactly the lie A2 forbids.
    meta.retrievedAt,
  );
  return {
    // `pack: true` is what lets the layer prefer a live record for the same
    // OSM id, and what lets the key say how many of the marks on screen come
    // from a file rather than from a request.
    records: records.map((record) => ({ ...record, pack: true })),
    retrievedAt: String(meta.retrievedAt || ''),
    count: Number(meta.count) || records.length,
  };
}

/**
 * The pack, fetched and parsed at most once per session.
 *
 * A failed fetch is not fatal and is not retried: the layer keeps working from
 * the live query alone, which is what it did before this file existed. It
 * resolves to an empty pack so no caller has to branch on null.
 *
 * @param {Function} [fetchImpl] Injectable for tests.
 * @returns {Promise<{records: Array<object>, retrievedAt: string, count: number}>}
 */
export function loadMilitaryFrancePack(fetchImpl = (typeof fetch === 'function' ? fetch : null)) {
  if (_load) return _load;
  _load = (async () => {
    try {
      if (!fetchImpl) throw new Error('no fetch available');
      const response = await fetchImpl(await packUrl());
      if (!response.ok) throw new Error(`pack HTTP ${response.status}`);
      return parseMilitaryFrancePack(await response.text());
    } catch (error) {
      console.warn(`[Military pack] ${error?.message || error}`);
      return { records: [], retrievedAt: '', count: 0 };
    }
  })();
  return _load;
}

/** Drop the memoised pack. Tests only. */
export function _resetMilitaryFrancePackForTest() {
  _load = null;
}

/**
 * Prime the memo so nothing is ever fetched. Tests only.
 *
 * The layer calls `loadMilitaryFrancePack()` from `enable()`, and a unit test
 * has no server to answer it: without this, every enable in the suite would go
 * out to a stubbed URL, fail, and print a warning that says nothing.
 *
 * @param {Array<object>} records @param {string} [retrievedAt]
 */
export function _setMilitaryFrancePackForTest(records, retrievedAt = '2026-01-01') {
  _load = Promise.resolve({
    records: records.map((record) => ({ ...record, pack: true })),
    retrievedAt,
    count: records.length,
  });
}

/**
 * The pack records whose point falls inside a box.
 *
 * Centre containment and nothing cleverer: the pack holds no footprints, so a
 * point IS the whole geometry and there is no large base whose centre sits
 * outside the view. That is the live query's problem, and it solves it
 * separately.
 *
 * @param {Array<object>} records Pack records.
 * @param {?{south:number, west:number, north:number, east:number}} box
 * @returns {Array<object>} The subset inside the box, or all of them for a null box.
 */
export function recordsInBox(records, box) {
  const all = Array.isArray(records) ? records : [];
  if (!box) return all;
  return all.filter((record) => record.latitude >= box.south && record.latitude <= box.north
    && record.longitude >= box.west && record.longitude <= box.east);
}
