/**
 * @module aisStaticRegistry
 * @description The MMSI → declared-identity registry, and the rules that let
 * it survive a restart instead of dying with the process.
 *
 * ── The defect this module exists to end ───────────────────────────────────
 *
 * AIS splits a ship in two. The position reports the map is drawn from —
 * messages 1/2/3 and 18 — carry no identity at all: no type, no name, no IMO
 * number, no dimensions. Those travel only in message 5 (`ShipStaticData`) and
 * in message 24 part B (`StaticDataReport`), which a transponder emits roughly
 * every six minutes. (Message 19, the rare extended Class B report, does carry
 * a type and a dimension block — it is the exception, not the supply.)
 *
 * So the server has always had to LEARN what each contact is, one static
 * message at a time — and it did, into a plain `Map` held in process memory
 * that was never written anywhere. Every restart threw the lesson away: a Vite
 * config change, a deploy, a closed laptop. Measured on the live feed on
 * 2026-09-03 over the world box, 5 minutes: **18 308 distinct MMSIs published
 * a position, 5 530 published anything static**. That ~70 % is the size of the
 * map's "Type non déclaré" bucket at any instant — and with nothing on disk,
 * every session restarted at 100 % of it and climbed back from there.
 *
 * ── What is kept, and for how long ─────────────────────────────────────────
 *
 * Identity only, for 30 days — the same TTL and the same reasoning as the
 * mapped-installation disk cache: an MMSI changes its declared type on a
 * shipyard timescale, not a session one, so a three-week-old answer about what
 * a hull IS is still the right answer.
 *
 * `destination` is deliberately dropped at the door. It rides in the same
 * message 5 as the identity fields, but it is VOYAGE data: true for one
 * passage and false for the next. Replaying a three-week-old destination onto
 * a live card would print a confident lie, so it is never serialised and never
 * restored. The running session keeps its own copy in memory; nothing else.
 *
 * ── Shape ──────────────────────────────────────────────────────────────────
 *
 * One JSON document, not one file per MMSI: the registry is read once at start
 * and rewritten whole on a debounce, so tens of thousands of tiny files would
 * buy nothing and cost an inode each.
 *
 * Everything here is pure — no fs, no clock of its own, no dev server — so the
 * policy is exercisable by the offline node:test suite. `vite.config.js` owns
 * the file path, the debounce and the atomic rename.
 */

/** Serialisation version. Bump when the entry shape changes incompatibly. */
export const AIS_STATIC_REGISTRY_VERSION = 1;

/**
 * @constant {number} How long a learned identity stays trustworthy — 30 days.
 * Same value as `MILITARY_INSTALLATION_DISK_TTL_MS`, for the same reason.
 */
export const AIS_STATIC_TTL_MS = 30 * 86_400_000;

/**
 * @constant {number} Hard ceiling on retained identities.
 * Matches the live-vessel cache cap so the registry can never outgrow the feed
 * it annotates; at ~150 bytes an entry the file stays in single-digit MB even
 * on the world box.
 */
export const AIS_STATIC_MAX_ENTRIES = 50_000;

/** Fields that describe the ship itself, and so are safe to persist. */
const IDENTITY_FIELDS = Object.freeze(['name', 'type', 'imo', 'hull']);

/** Dimension fields written by `aisStaticDimensions()`. */
const HULL_FIELDS = Object.freeze(['loaM', 'beamM', 'toBowM', 'toPortM']);

/**
 * Longest string kept per text field. AIS caps names and call signs at 20
 * characters, so this is pure defence: a malformed upstream cannot make the
 * registry grow without bound one entry at a time.
 */
const MAX_TEXT_LENGTH = 64;

/** MMSI is numeric by protocol; anything else is not a key we wrote. */
const MMSI_PATTERN = /^\d{1,15}$/;

function textValue(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_TEXT_LENGTH);
}

/**
 * Keep a hull block only where the transponder actually published a number.
 *
 * Strict on type rather than coercing: `Number(null)` is 0, and an all-zero
 * dimension block is the "not available" default of an unconfigured
 * transponder — the one shape that must never be read back as a 0 m ship.
 * @param {*} hull
 * @returns {?{loaM: ?number, beamM: ?number, toBowM: ?number, toPortM: ?number}}
 */
function normalizeHull(hull) {
  if (!hull || typeof hull !== 'object') return null;
  const normalized = {};
  let measured = false;
  for (const field of HULL_FIELDS) {
    const value = hull[field];
    if (typeof value === 'number' && Number.isFinite(value)) {
      normalized[field] = value;
      measured = true;
    } else {
      normalized[field] = null;
    }
  }
  return measured ? normalized : null;
}

/**
 * Bring one entry — from memory or from the file — to the stored shape.
 *
 * @param {*} raw
 * @returns {?{name: string, type: string, imo: string, hull: ?object, updatedAt: number}}
 *   Null when the entry carries no timestamp, or declares nothing at all.
 */
export function normalizeAisStaticEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const updatedAt = Number(raw.updatedAt);
  if (!Number.isFinite(updatedAt)) return null;
  const entry = {
    name: textValue(raw.name),
    type: textValue(raw.type),
    imo: textValue(raw.imo),
    hull: normalizeHull(raw.hull),
    updatedAt,
  };
  // An entry that declares nothing is not worth a line in the file: it costs
  // bytes on every rewrite and teaches the next session nothing.
  return IDENTITY_FIELDS.some((field) => entry[field]) ? entry : null;
}

/** Whether a stored identity is still inside the registry TTL. */
export function aisStaticEntryFresh(entry, ttlMs = AIS_STATIC_TTL_MS, now = Date.now()) {
  if (!entry || !Number.isFinite(entry.updatedAt)) return false;
  return now - entry.updatedAt <= ttlMs;
}

/**
 * Sweep expired identities, then evict the oldest down to the size cap.
 *
 * Mutates in place — the live map is the one the ingest path reads on every
 * position report, so it cannot be swapped for a copy.
 *
 * @param {Map<string, object>} registry
 * @param {{now?: number, ttlMs?: number, maxEntries?: number}} [options]
 * @returns {number} How many identities were dropped.
 */
export function pruneAisStaticEntries(registry, {
  now = Date.now(),
  ttlMs = AIS_STATIC_TTL_MS,
  maxEntries = AIS_STATIC_MAX_ENTRIES,
} = {}) {
  let dropped = 0;
  for (const [mmsi, entry] of registry) {
    if (!aisStaticEntryFresh(entry, ttlMs, now)) {
      registry.delete(mmsi);
      dropped += 1;
    }
  }
  if (registry.size <= maxEntries) return dropped;
  const ordered = [...registry.entries()]
    .sort((a, b) => (a[1]?.updatedAt || 0) - (b[1]?.updatedAt || 0));
  for (const [mmsi] of ordered.slice(0, registry.size - maxEntries)) {
    registry.delete(mmsi);
    dropped += 1;
  }
  return dropped;
}

/**
 * Render the registry as the document written to disk.
 *
 * Sorted newest-first so that truncating at the cap drops the identities least
 * likely to be asked about again, rather than whichever the Map happened to
 * hold first.
 *
 * @param {Map<string, object>} registry
 * @param {{now?: number, ttlMs?: number, maxEntries?: number}} [options]
 * @returns {{version: number, savedAt: string, count: number, entries: object}}
 */
export function serializeAisStaticRegistry(registry, {
  now = Date.now(),
  ttlMs = AIS_STATIC_TTL_MS,
  maxEntries = AIS_STATIC_MAX_ENTRIES,
} = {}) {
  const rows = [];
  for (const [mmsi, entry] of registry) {
    if (!MMSI_PATTERN.test(mmsi)) continue;
    if (!aisStaticEntryFresh(entry, ttlMs, now)) continue;
    const stored = normalizeAisStaticEntry(entry);
    if (stored) rows.push([mmsi, stored]);
  }
  rows.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  const kept = rows.slice(0, maxEntries);
  const entries = {};
  for (const [mmsi, stored] of kept) entries[mmsi] = stored;
  return {
    version: AIS_STATIC_REGISTRY_VERSION,
    savedAt: new Date(now).toISOString(),
    count: kept.length,
    entries,
  };
}

/**
 * Read a registry document back, dropping anything expired or malformed.
 *
 * @param {string|object} source File text, or an already-parsed document.
 * @param {{now?: number, ttlMs?: number}} [options]
 * @returns {Map<string, object>} Empty on any unreadable input — a corrupt
 *   file costs one session's learning, never a crash at boot.
 */
export function parseAisStaticRegistry(source, { now = Date.now(), ttlMs = AIS_STATIC_TTL_MS } = {}) {
  const registry = new Map();
  let document = source;
  if (typeof source === 'string') {
    try {
      document = JSON.parse(source);
    } catch {
      return registry;
    }
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) return registry;
  // An unknown version is not a partial read: the shape is whatever some other
  // build wrote, so it is ignored wholesale rather than guessed at.
  if (document.version !== AIS_STATIC_REGISTRY_VERSION) return registry;
  const entries = document.entries;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return registry;
  for (const [mmsi, raw] of Object.entries(entries)) {
    if (!MMSI_PATTERN.test(mmsi)) continue;
    const stored = normalizeAisStaticEntry(raw);
    if (!stored || !aisStaticEntryFresh(stored, ttlMs, now)) continue;
    registry.set(mmsi, stored);
  }
  return registry;
}

/**
 * Fold a loaded registry into the live one.
 *
 * The running feed always wins a collision: anything it has heard this session
 * is newer than the file by construction. But a colliding entry can still have
 * GAPS the file fills — a `StaticDataReport` is split in two, part A carrying
 * the name and part B the dimension block, so a session that has heard only
 * one half keeps the other half from disk instead of waiting six minutes.
 *
 * @param {Map<string, object>} target Live registry, mutated in place.
 * @param {Map<string, object>} loaded Registry read from disk.
 * @returns {number} How many identities were added or completed.
 */
export function adoptAisStaticRegistry(target, loaded) {
  let adopted = 0;
  for (const [mmsi, entry] of loaded) {
    const current = target.get(mmsi);
    if (!current) {
      target.set(mmsi, entry);
      adopted += 1;
      continue;
    }
    let filled = false;
    for (const field of IDENTITY_FIELDS) {
      if (!current[field] && entry[field]) {
        current[field] = entry[field];
        filled = true;
      }
    }
    if (filled) adopted += 1;
  }
  return adopted;
}
