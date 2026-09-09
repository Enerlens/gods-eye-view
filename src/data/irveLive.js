/**
 * @module data/irveLive
 *
 * **Ce qui est libre, ici, maintenant** — the join between the register of
 * where the plugs are and the feed that says what they are doing.
 *
 * ── The gap this closes, and why it was open ────────────────────────────────
 *
 * `qualichargeDynamic.js` has decoded the live state of **75 584 points de
 * charge** since 2026-09-07, with its three measured traps — including the one
 * that inflates France's free capacity by 44.4 % if the stale rows are counted.
 * It fed the chronicle and nothing else. `irveFrance.js` draws the sites and
 * says out loud, three times over, that it is not an availability feed.
 *
 * The two could not meet, and `docs/PLAN-CROISEMENTS.md` recorded exactly why:
 * QualiCharge is keyed on `id_pdc_itinerance` and publishes **no coordinate at
 * all** (its file is four state columns and a timestamp), while the IRVE
 * layer's viewport query GROUPS its rows to be affordable — 4 017 charge points
 * in central Paris collapse to 469 grouped rows — and `IRVE_GROUP_FIELDS`
 * excludes every per-plug identifier because including one undoes the grouping.
 * So neither side had the other's key.
 *
 * ── The missing table, and what it cost to build ────────────────────────────
 *
 * The consolidated register DOES publish both: one flat export of three columns
 * — `id_pdc_itinerance`, `consolidated_latitude`, `consolidated_longitude` —
 * is **227 007 rows, 8.4 MB, 17 s** against ODRÉ's export endpoint, measured
 * 2026-09-09. That is a national pass, so it is built once on the server, kept
 * on disk and refreshed daily like the register it reads.
 *
 * Joined against the live feed on the same afternoon: **75 311 of 75 584
 * (99.6 %)** of QualiCharge's plugs appear in it. The key works.
 *
 * ── Trap: 9.3 % of plug ids name more than one place ────────────────────────
 *
 * The 227 007 rows carry only **166 908 distinct plug ids**, and **15 594 of
 * them (9.34 %) are published at more than one coordinate**. Measured spread
 * between the coordinates of one id:
 *
 *   under 50 m       9 040 + 5 619 within 500 m
 *   500 m – 5 km       464
 *   5 – 50 km          123
 *   50 – 500 km        210
 *   over 500 km        138   — headed by the literal id `Non concerné`,
 *                              117 coordinates spanning 7 302 km
 *
 * `Non concerné` is the same sentinel `irveFeed.js` documents in its own trap 2
 * for the STATION id; it turns out the plug id has it too. So a plug whose
 * coordinates disagree by more than {@link IRVE_PLACEMENT_TOLERANCE_M} is
 * **refused rather than placed at one of them**: the layer's render unit is the
 * coordinate rounded to five decimals, two coordinates 200 m apart are two
 * marks on the map, and putting a plug's state on one of them is a coin toss
 * printed as a fact.
 *
 * The tolerance costs coverage and the cost is measured, not assumed:
 *
 *   tolerance   plugs placed   QualiCharge joined
 *      20 m       156 484        66 290   87.7 %
 *      50 m       160 339        69 870   92.4 %
 *     100 m       163 900        73 104   96.7 %
 *     200 m       165 380        74 407   98.4 %
 *
 * 50 m is the cut: it is GPS scatter over one car park, and it is under the
 * distance at which the layer would draw two separate sites. The 7.6 % it
 * gives up are plugs whose own register cannot say where they are.
 *
 * ── What this does NOT change ───────────────────────────────────────────────
 *
 * The map still draws INSTALLED CAPACITY and is still not coloured by
 * availability. That contract is in `irveFeed.js`'s header and it stands: a
 * site's colour is its power band, unchanged. What this adds is a LINE ON THE
 * CARD, where a claim can carry its own freshness and its own denominator —
 * which is the only honest place for a number that is true for ten minutes.
 *
 * Pure: no fetch, no DOM, no Cesium, no clock of its own. `vite.config.js`
 * fetches; `irveFrance.js` prints.
 */

import { irveSiteKey } from './irveFeed.js';
import { QUALICHARGE_FRESH_MS } from './qualichargeDynamic.js';

/**
 * How far apart two published coordinates of ONE plug may be before the plug
 * is refused a placement. See the trap above for the measurement.
 */
export const IRVE_PLACEMENT_TOLERANCE_M = 50;

/** Great-circle metres. Local, so this runs under `node --test` with nothing loaded. */
export function irveDistanceM(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every((value) => Number.isFinite(value))) return Infinity;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 6_371_008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Build `id_pdc_itinerance → site key` from the register's flat export.
 *
 * Three columns, one pass, and the ONLY judgement it makes is the one the trap
 * above describes: an id whose coordinates disagree by more than the tolerance
 * gets no placement at all.
 *
 * The value is the SITE KEY rather than the coordinate, because that is what
 * both sides of the join actually compare — `irveFeed.projectIrveSites` keys
 * its sites the same way, so a plug and the site it belongs to meet on a
 * string rather than on a float comparison.
 *
 * @param {string} csv Raw CSV, header included.
 * @returns {{placements: Map<string, string>, ambiguous: number, rows: number,
 *   ids: number}}
 */
export function buildIrvePlacements(csv) {
  const seen = new Map();
  let rows = 0;
  if (typeof csv !== 'string' || !csv) {
    return { placements: new Map(), ambiguous: 0, rows: 0, ids: 0 };
  }
  const lines = csv.split('\n');
  // The export ships a UTF-8 BOM, which would make the first column name
  // `﻿id_pdc_itinerance` and the header lookup miss on row one.
  const header = (lines[0] || '').replace(/^﻿/, '').replace(/\r$/, '').split(',')
    .map((name) => name.trim());
  const idAt = header.indexOf('id_pdc_itinerance');
  const latAt = header.indexOf('consolidated_latitude');
  const lonAt = header.indexOf('consolidated_longitude');
  // A missing column is not a partial read: every plug would silently go
  // unplaced and the card would quietly stop saying anything.
  if (idAt < 0 || latAt < 0 || lonAt < 0) {
    return { placements: new Map(), ambiguous: 0, rows: 0, ids: 0 };
  }
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    // Deliberately a plain split: these three columns are an identifier and
    // two numbers, none of which can contain a comma or a quote. A CSV parser
    // here would be 227 007 rows of work to answer a question that cannot arise.
    const fields = line.replace(/\r$/, '').split(',');
    const id = (fields[idAt] || '').trim();
    if (!id) continue;
    const lat = Number(fields[latAt]);
    const lon = Number(fields[lonAt]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    rows += 1;
    const entry = seen.get(id);
    if (!entry) { seen.set(id, { lat, lon, ambiguous: false }); continue; }
    if (entry.ambiguous) continue;
    if (irveDistanceM(entry.lat, entry.lon, lat, lon) > IRVE_PLACEMENT_TOLERANCE_M) {
      entry.ambiguous = true;
    }
  }
  const placements = new Map();
  let ambiguous = 0;
  for (const [id, entry] of seen) {
    if (entry.ambiguous) { ambiguous += 1; continue; }
    placements.set(id, irveSiteKey(entry.lat, entry.lon));
  }
  return { placements, ambiguous, rows, ids: seen.size };
}

/**
 * Fold the live feed onto the sites the map draws.
 *
 * FRESHNESS IS THE WHOLE POINT, and it is trap 1 of `qualichargeDynamic.js`
 * applied per site instead of nationally: a row whose operator last spoke more
 * than {@link QUALICHARGE_FRESH_MS} ago is counted as MUTE, never as free. The
 * national reading of that same rule is a 44.4 % difference; on one car park it
 * is the difference between driving there and not.
 *
 * `now` is the instant the BODY ARRIVED, never the caller's wall clock — trap 2
 * of the same module, and folding from a cache minutes later would age every
 * row by time it did not live.
 *
 * @param {Map<string, {e: string, o: string, t: number}>} rows From
 *   `parseQualichargeDynamic`.
 * @param {Map<string, string>} placements From {@link buildIrvePlacements}.
 * @param {{now?: number, freshMs?: number}} [options]
 * @returns {{sites: Map<string, {free:number, busy:number, other:number,
 *   down:number, mute:number}>, joined: number, unplaced: number}}
 */
export function foldIrveLiveBySite(rows, placements, { now = Date.now(), freshMs = QUALICHARGE_FRESH_MS } = {}) {
  const sites = new Map();
  let joined = 0;
  let unplaced = 0;
  if (!(rows instanceof Map) || !(placements instanceof Map)) {
    return { sites, joined, unplaced };
  }
  for (const [id, row] of rows) {
    const key = placements.get(id);
    if (!key) { unplaced += 1; continue; }
    joined += 1;
    let site = sites.get(key);
    if (!site) { site = { free: 0, busy: 0, other: 0, down: 0, mute: 0 }; sites.set(key, site); }
    // `|now - stamp|` and not `now - stamp`: a publisher whose clock genuinely
    // runs ahead must not have its rows counted as infinitely fresh.
    const age = Math.abs(now - (Number(row?.t) || 0) * 1000);
    if (!row?.t || age > freshMs) { site.mute += 1; continue; }
    // Out of service is a MEASURED state and not an unknown one: a plug the
    // operator says is broken is not free, and saying so is more useful than
    // dropping it out of the denominator.
    if (row.e === 'H') { site.down += 1; continue; }
    if (row.o === 'L') site.free += 1;
    else if (row.o === 'O') site.busy += 1;
    else site.other += 1;
  }
  return { sites, joined, unplaced };
}

/**
 * The live state of the plugs at one site, ready for the wire.
 *
 * A compact tuple rather than an object per site: a viewport can hold a few
 * hundred sites and the field names would be most of the payload.
 *
 * @param {string} key Site key.
 * @param {{free:number, busy:number, other:number, down:number, mute:number}} site
 * @returns {[string, number, number, number, number, number]}
 */
export function irveLiveTuple(key, site) {
  return [key, site.free, site.busy, site.other, site.down, site.mute];
}

/** The inverse of {@link irveLiveTuple}. */
export function irveLiveFromTuple(tuple) {
  if (!Array.isArray(tuple) || typeof tuple[0] !== 'string') return null;
  const [key, free, busy, other, down, mute] = tuple;
  return {
    key,
    free: Number(free) || 0,
    busy: Number(busy) || 0,
    other: Number(other) || 0,
    down: Number(down) || 0,
    mute: Number(mute) || 0,
  };
}

/**
 * The sentence the site card prints, or `null`.
 *
 * THE DENOMINATOR IS WHAT THE FEED SPOKE FOR, NOT WHAT IS INSTALLED. A site
 * with nine plugs where QualiCharge answered for four says "sur 4", because
 * "3 libres sur 9" would report five plugs as busy that nobody asked about.
 * The installed count is already on the card, one line up, and the difference
 * between the two is the reader's to see.
 *
 * A site whose every joined plug is mute gets a sentence about the SILENCE
 * rather than nothing: "nobody has said anything about this car park since
 * yesterday" is an answer, and a blank line reads as "the feature is broken".
 *
 * @param {?{free:number, busy:number, other:number, down:number, mute:number}} site
 * @param {{at?: ?number, now?: number}} [options] `at` is when the body arrived.
 * @returns {?string}
 */
export function irveLiveLine(site, { at = null, now = Date.now() } = {}) {
  if (!site) return null;
  const answered = site.free + site.busy + site.other + site.down;
  const age = Number.isFinite(at) ? Math.max(0, now - at) : null;
  const when = age === null ? '' : ` · relevé ${irveLiveAgeLabel(age)}`;
  if (!answered) {
    if (!site.mute) return null;
    return `${site.mute} borne${site.mute > 1 ? 's' : ''} sans état publié depuis plus de 24 h`;
  }
  const parts = [`${site.free} libre${site.free > 1 ? 's' : ''} sur ${answered}`];
  if (site.down) parts.push(`${site.down} hors service`);
  if (site.mute) parts.push(`${site.mute} muette${site.mute > 1 ? 's' : ''}`);
  return `${parts.join(' · ')}${when}`;
}

/**
 * How long ago, in the words a card uses.
 *
 * Never a clock time: the feed is polled and cached, so "16:42" would claim a
 * precision the pipeline does not have, and an age is what a reader deciding
 * whether to drive there actually needs.
 *
 * @param {number} ms
 * @returns {string}
 */
export function irveLiveAgeLabel(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.round(hours / 24)} j`;
}
