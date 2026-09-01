/**
 * @module panFeedHealth
 *
 * Two measured facts about the PAN GTFS-Realtime index that the catalog itself
 * does not carry: which resources are the SAME feed published twice, and which
 * ones have stopped answering.
 *
 * WHY THIS EXISTS. `config/pan_gtfs_rt_feeds.json` is built from
 * `transport.data.gouv.fr/api/datasets`, and the catalog is a list of
 * RESOURCES, not of networks. Two things follow, both observed rather than
 * assumed:
 *
 *   1. DUPLICATES. 151 resources carry 139 distinct network names. Most of
 *      those repeats are complementary — Rouen's "Astuce" publishes TCAR and
 *      TNI separately, Montpellier's TaM splits bus and tram — and collapsing
 *      them on the name would silently drop half a city. But some are the same
 *      body behind two resource ids: measured 2026-08-31, Kicéo's two
 *      resources returned the same 62 vehicles at the same 62 coordinates, and
 *      Lila presqu'île's returned the same 14. Those are drawn twice today.
 *      The GBFS index already resolves its own version of this problem by
 *      measurement (165 resources → 135 distinct systems); this is the same
 *      rule for a different catalog.
 *
 *   2. ROT. The index is a snapshot. Between the 2026-08-26 build and
 *      2026-08-31, seven resources began answering HTTP 403 with a Cloudflare
 *      HTML page (Astuce, Lia, Ficibus, Filibus, DK'BUS, LINEAD, TANGO) and
 *      one answered HTTP 500 (TUM Mende) — about 5% of the catalog in five
 *      days. The proxy already survives that (`!response.ok` → backoff and
 *      serve-stale), but nothing stopped it from spending one of its 16
 *      per-viewport feed slots on a resource that has failed every probe for a
 *      week.
 *
 * WHAT IS MEASURED AND WHAT IS INFERRED. A duplicate verdict needs two
 * agreements, and they deliberately ask different questions:
 *
 *   - The CANDIDATE test is positional — same vehicle ids at the same
 *     coordinates to five decimals. Two networks momentarily agreeing on that
 *     is not a thing that happens.
 *   - The CONFIRMATION test, minutes later, is the ROSTER only — the same set
 *     of vehicle ids, wherever they now are. It has to be, because the fleet
 *     moved in between: the first build to run this rule rejected Kicéo's real
 *     twin because 62 buses had driven on between the two probes. Requiring
 *     positions twice does not test "is this the same feed", it tests "did the
 *     upstream refresh between my two requests".
 *
 * A quarantine verdict comes from a run of consecutive failed probes, and any
 * single success clears it — a feed is never permanently written off, because
 * a 403 is usually a WAF mood rather than a decommission. Measured on the
 * 2026-08-31 rebuild: TANGO's second resource, one of the seven feeds serving
 * 403 that afternoon, answered normally hours later.
 *
 * Dependency-free and side-effect-free, like `panFeeds.js`: the build script
 * and the dev-server proxy both read these rules, and `node --test` exercises
 * them without a network.
 */

/**
 * Consecutive failed probes before a feed stops being offered to viewports.
 *
 * Two is deliberately low. A quarantined feed is not deleted and costs one
 * probe per build to revive, so the price of being wrong is one build cycle;
 * the price of being too slow is a dead resource holding a feed slot in front
 * of a live one for weeks.
 */
export const PAN_QUARANTINE_AFTER_FAILURES = 2;

/**
 * Strip the feed-id prefix `vehicleFromEntity` puts on every vehicle id.
 *
 * The prefix exists so two networks cannot collide on a bare vehicle number —
 * which is exactly what has to be undone to ask whether two feeds are carrying
 * the same vehicles.
 *
 * @param {string} id Prefixed render id, e.g. `pan-82095:VM:1234`.
 * @param {string} feedId Feed key, e.g. `pan-82095`.
 * @returns {string} Local id, e.g. `VM:1234`.
 */
export function localVehicleId(id, feedId) {
  const raw = String(id ?? '');
  const prefix = `${String(feedId ?? '')}:`;
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
}

/**
 * Order-independent fingerprint of what one probe saw.
 *
 * The unit is `localId@lat,lon` at five decimals (~1 m), which is the same
 * precision the proxy puts on the wire. Sorting makes the fingerprint
 * independent of entity order, which two mirrors of one feed need not share.
 *
 * @param {Array<{id: string, lat: number, lon: number}>} vehicles Probe result.
 * @param {string} feedId Feed key the vehicles were decoded with.
 * @returns {?{key: string, size: number}} Null for an empty fleet — an empty
 *   feed is not evidence of anything, least of all of being a duplicate.
 */
export function fleetFingerprint(vehicles, feedId) {
  const list = Array.isArray(vehicles) ? vehicles : [];
  const parts = [];
  for (const vehicle of list) {
    if (!vehicle || !Number.isFinite(vehicle.lat) || !Number.isFinite(vehicle.lon)) continue;
    const local = localVehicleId(vehicle.id, feedId);
    if (!local) continue;
    parts.push(`${local}@${vehicle.lat.toFixed(5)},${vehicle.lon.toFixed(5)}`);
  }
  if (!parts.length) return null;
  parts.sort();
  return { key: parts.join('|'), size: parts.length };
}

/**
 * Order-independent digest of WHICH VEHICLES a feed carries, ignoring where
 * they are.
 *
 * This is the confirmation-pass counterpart to {@link fleetFingerprint}: a
 * roster survives the fleet moving between two probes, which a positional
 * fingerprint cannot. It is deliberately never used to FIND candidates — on
 * its own, two one-bus networks that both number their bus `1` would match.
 *
 * @param {Array<{id: string}>} vehicles Probe result.
 * @param {string} feedId Feed key the vehicles were decoded with.
 * @returns {?{key: string, size: number}} Null for an empty fleet.
 */
export function fleetRoster(vehicles, feedId) {
  const list = Array.isArray(vehicles) ? vehicles : [];
  const parts = [];
  for (const vehicle of list) {
    const local = localVehicleId(vehicle?.id, feedId);
    if (local) parts.push(local);
  }
  if (!parts.length) return null;
  parts.sort();
  return { key: parts.join('|'), size: parts.length };
}

/**
 * Whether two fingerprints describe the same fleet.
 *
 * Compares whatever digest it is given — positional fingerprints against
 * positional fingerprints, rosters against rosters. Kept as its own predicate
 * so the build script and the tests agree on one definition of agreement, and
 * so neither can accidentally treat a missing digest as a match.
 *
 * @param {?{key: string, size: number}} a
 * @param {?{key: string, size: number}} b
 * @returns {boolean}
 */
export function sameFleet(a, b) {
  if (!a?.key || !b?.key) return false;
  return a.key === b.key;
}

/**
 * Group feeds whose probes produced identical fingerprints.
 *
 * The KEEPER of each group is the lowest resource id: resource ids increase
 * over time on the PAN, so the lowest is the longest-lived publication of that
 * body and the one most likely to outlive its own re-publication. Every other
 * member is reported as a duplicate OF that keeper.
 *
 * A group is only formed when at least two feeds agree; a fingerprint seen
 * once is not a group, and feeds that reported nothing are never grouped.
 *
 * @param {Array<{id: string, resourceId: number, fingerprint: ?{key: string, size: number}}>} entries
 * @returns {Array<{key: string, keeper: string, duplicates: string[], fleet: number}>}
 */
export function duplicateFeedGroups(entries) {
  const byKey = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const key = entry?.fingerprint?.key;
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(entry);
  }

  const groups = [];
  for (const [key, members] of byKey) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => (
      (Number(a.resourceId) || 0) - (Number(b.resourceId) || 0)
      || String(a.id).localeCompare(String(b.id))
    ));
    groups.push({
      key,
      keeper: sorted[0].id,
      duplicates: sorted.slice(1).map((entry) => entry.id),
      fleet: sorted[0].fingerprint?.size ?? 0,
    });
  }
  groups.sort((a, b) => a.keeper.localeCompare(b.keeper));
  return groups;
}

/**
 * Fold one probe outcome into a feed's health record.
 *
 * Pure: returns the next health object, never mutates the input. A success
 * always clears the failure run and the quarantine — a feed that answers is
 * healthy, whatever it did last week.
 *
 * @param {?Object} previous Health record from the shipped index, if any.
 * @param {{ok: boolean, error?: ?string}} probe Probe outcome.
 * @param {string} at ISO timestamp of this probe.
 * @param {Object} [options]
 * @param {number} [options.quarantineAfter]
 * @returns {{consecutiveFailures: number, quarantined: boolean,
 *            quarantinedSince: ?string, lastError: ?string, lastOkAt: ?string}}
 */
export function applyProbeHealth(previous, probe, at, options = {}) {
  const quarantineAfter = Number.isFinite(options.quarantineAfter)
    ? Math.max(1, Math.floor(options.quarantineAfter))
    : PAN_QUARANTINE_AFTER_FAILURES;

  if (probe?.ok) {
    return {
      consecutiveFailures: 0,
      quarantined: false,
      quarantinedSince: null,
      lastError: null,
      lastOkAt: at,
    };
  }

  const failures = (Number(previous?.consecutiveFailures) || 0) + 1;
  const quarantined = failures >= quarantineAfter;
  return {
    consecutiveFailures: failures,
    quarantined,
    quarantinedSince: quarantined ? (previous?.quarantinedSince || at) : null,
    lastError: probe?.error ? String(probe.error) : 'probe failed',
    lastOkAt: previous?.lastOkAt || null,
  };
}

/**
 * Whether a viewport query should spend one of its feed slots on this feed.
 *
 * Two exclusions, both recorded in the index by the build script rather than
 * guessed here: a feed superseded by an identical twin, and a feed that has
 * failed every probe for {@link PAN_QUARANTINE_AFTER_FAILURES} builds running.
 *
 * @param {Object} feed Index entry.
 * @returns {boolean}
 */
export function feedIsSelectable(feed) {
  if (!feed?.url) return false;
  if (feed.duplicateOf) return false;
  if (feed.health?.quarantined === true) return false;
  return true;
}

/**
 * Split an index into the feeds a viewport may use and the ones it may not.
 *
 * Returned as a summary rather than a filtered array so callers can report
 * WHY the shipped feed count and the queryable feed count differ — the
 * `/feeds` endpoint prints both, and "151 feeds" alongside "143 queryable" is
 * a more honest header than either number alone.
 *
 * @param {Array<Object>} feeds Index entries.
 * @returns {{selectable: Array<Object>, duplicates: number, quarantined: number}}
 */
export function partitionFeedsByHealth(feeds) {
  const selectable = [];
  let duplicates = 0;
  let quarantined = 0;
  for (const feed of Array.isArray(feeds) ? feeds : []) {
    if (feed?.duplicateOf) { duplicates += 1; continue; }
    if (feed?.health?.quarantined === true) { quarantined += 1; continue; }
    if (!feed?.url) continue;
    selectable.push(feed);
  }
  return { selectable, duplicates, quarantined };
}
