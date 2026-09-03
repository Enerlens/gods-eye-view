/**
 * @module openSkyFreshness
 * @description How old an OpenSky snapshot has to be before it counts as old —
 * decided in ONE place, for the proxy and the browser both.
 *
 * ── The bug this module exists to end ───────────────────────────────────────
 * There were two constants, 120 s each, written independently: one in the
 * proxy, deciding when to abandon OpenSky for the 250 nm adsb.lol circle, and
 * one in the flights layer, deciding when to light the orange STALE badge.
 * Neither knew about the credit governor sitting between them.
 *
 * That governor stretches the response cache to 30 s, 90 s and then 300 s as
 * the daily OpenSky budget thins — which on an anonymous key it does within
 * the hour. A body served from a 300 s cache is, mechanically, more than 120 s
 * old. So the two hard-coded thresholds did not measure staleness at all: past
 * the first tier they were a guarantee of it. The layer sat in FALLBACK and
 * wore an orange badge while behaving exactly as designed, which is the field
 * report that opened this file ("it drops into fallback very quickly").
 *
 * The rule here is the one the governor implies: a snapshot is stale when it
 * is older than the TTL THE GOVERNOR ITSELF CHOSE, plus a fixed tolerance for
 * the age the upstream snapshot already had when it was fetched. Cache for
 * 300 s deliberately and 300 s of age is not a surprise; 420 s is. Because the
 * TTL is bounded at 300 s, the threshold is bounded at 420 s — this can never
 * become a licence to serve genuinely ancient positions.
 *
 * Both ends read the same function, and the proxy publishes the TTL it used on
 * `X-OpenSky-Ttl-Seconds` so the browser is judging the same number rather than
 * a second copy of it.
 */

/** @constant {number} Base TTL for the OpenSky response cache. */
export const OPENSKY_BASE_CACHE_MS = 9_000;
/** @constant {number} Longest TTL the credit governor will stretch to. */
export const OPENSKY_MAX_TTL_MS = 300_000;
/**
 * @constant {number} Tolerance on top of the TTL in force.
 *
 * This is the age the snapshot already had upstream, plus the client's 30 s
 * poll interval, plus room for a slow fetch — historically the whole of the
 * 120 s threshold, which is why it keeps that value: at the base 9 s TTL the
 * behaviour is what it always was.
 */
export const OPENSKY_STALE_MARGIN_MS = 120_000;

/**
 * Cache TTL for the remaining daily credit budget.
 *
 * The global `/states/all` costs 4 credits per call against a ~4000/day
 * authenticated budget. The client polls every 30 s, so tiers at or below 30 s
 * cost the same 480 credits/h; the later tiers are what stretch the day:
 * >2400 → ~3 h at full freshness, then 30 s (~2.5 h), 90 s (~5 h), 300 s
 * (~8 h) ≈ 18+ h of continuous use.
 * @param {number} remaining `X-Rate-Limit-Remaining` from OpenSky.
 * @returns {number} TTL in ms.
 */
export function openSkyAdaptiveTtlMs(remaining) {
  if (!Number.isFinite(remaining)) return OPENSKY_BASE_CACHE_MS;
  if (remaining > 2400) return OPENSKY_BASE_CACHE_MS;
  if (remaining > 1200) return 30_000;
  if (remaining > 400) return 90_000;
  return OPENSKY_MAX_TTL_MS;
}

/**
 * The age past which a snapshot is stale, given the TTL currently in force.
 * @param {number|null|undefined} ttlMs TTL the governor chose; base TTL if unknown.
 * @returns {number} Threshold in ms.
 */
export function openSkyStaleThresholdMs(ttlMs) {
  const ttl = Number.isFinite(ttlMs) && ttlMs > 0
    ? Math.min(ttlMs, OPENSKY_MAX_TTL_MS)
    : OPENSKY_BASE_CACHE_MS;
  return ttl + OPENSKY_STALE_MARGIN_MS;
}

/**
 * Is this snapshot older than the TTL in force allows for?
 *
 * An unknown epoch is NOT stale: the layer cannot judge what it was not told,
 * and asserting staleness from missing evidence is the same class of mistake
 * as the two hard-coded constants this module replaced.
 * @param {number|null|undefined} sourceEpochMs Snapshot time, epoch ms.
 * @param {{nowMs?:number, ttlMs?:number}} [options]
 * @returns {boolean}
 */
export function openSkySnapshotIsStale(sourceEpochMs, { nowMs = Date.now(), ttlMs } = {}) {
  return Number.isFinite(sourceEpochMs)
    && nowMs - sourceEpochMs > openSkyStaleThresholdMs(ttlMs);
}
