/**
 * @module vesselRegistryFr
 * @description The MMSI → ship-type join that fills what AIS declares empty,
 * and the rule that decides when the register is allowed to speak.
 *
 * ── THE BUCKET THIS CLOSES ──────────────────────────────────────────────────
 *
 * `aisStaticRegistry.js` solved half of "Type non déclaré": the half where the
 * server had simply not heard the identity message yet, and threw away what it
 * had learned at every restart. Measured on the live feed on 2026-09-10 over
 * 5 749 contacts in the Channel / North Sea box, that half is 543 contacts —
 * 9.4 %. Uptime fixes it.
 *
 * The other half does not fix itself. 1 934 contacts (33.6 %) broadcast ship
 * type **0, "not available"**: the transponder is speaking, the field was never
 * configured, and it will say 0 for as long as the boat floats. Listening
 * longer buys nothing. 100 % of them publish a NAME, 0.8 % publish an IMO
 * number, and the 40 % that publish a hull are 7 to 25 m long — they are
 * pleasure craft and small workboats whose owners never filled the field in.
 *
 * So the type has to come from somewhere that is not the transponder, keyed on
 * the one identifier the transponder does publish: the MMSI.
 *
 * ── THE SOURCE, AND WHY IT IS THE ONLY ONE ──────────────────────────────────
 *
 * ANFR, « Données radiomaritimes » — the French maritime radio licence
 * register. 133 506 MMSIs carrying a category, Licence Ouverte v2.0, free,
 * republished monthly. Measured against the live feed the same day: **93.1 %
 * of French-flagged undeclared contacts are found**, filling 618 of 2 477
 * (24.9 % of the bucket).
 *
 * There is no second one. The undeclared bucket is 26.7 % French, 23.4 %
 * British, 11.5 % Dutch, 9.8 % Belgian, 5.7 % German — and both of the next
 * two registers are dead ends, checked on 2026-09-10: the MCA's UK MMSI
 * register is listed on data.gov.uk but is not downloadable (it carries owner
 * addresses), and the Dutch "Maritieme roepletters" is under a closed licence
 * AND carries no type field at all. France is the join that exists.
 *
 * ── WHY FOUR CATEGORIES AND NOT ELEVEN ──────────────────────────────────────
 *
 * The ANFR field is a RADIO LICENCE category, not a ship type. Cross-checked
 * over the 431 contacts where the transponder AND the register both declared
 * something:
 *
 *   PLAISANCE 100 % · H.S.C. 100 % · PASSAGERS 97 % · PÊCHE 95 %   → trusted
 *   CHARGE 9 % · FLUVIAL 0 % · N.U.C. 0 % · SPÉCIAL 0 % · AUTRE 0 % → refused
 *
 * `CHARGE` is "commercial, not passengers": it calls tugs (AIS 52), dredgers
 * (33) and pilot boats (50) cargo ships. `FLUVIAL` is "river licence" and
 * describes no ship at all. Keeping them would have repainted 242 correctly
 * typed vessels with a wrong family — a worse answer than the slate.
 *
 * Restricted to the four, the join fills 508 contacts at ~98 % accuracy.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * The register NEVER outranks the transponder. It is consulted only where the
 * ship declared nothing — empty, or the protocol's own "not available" 0 — and
 * a later real declaration takes the type straight back. What the hull says
 * about itself wins, always; the register only speaks into a silence.
 *
 * Everything here is pure — no fs, no fetch, no clock. `vite.config.js` owns
 * the file read, `scripts/build-anfr-vessel-types.mjs` owns the extraction.
 */

/** Serialisation version of `local_data/vessels_fr/anfr-types.json`. */
export const VESSEL_REGISTRY_FR_VERSION = 1;

/**
 * ANFR licence category → the AIS type token it may stand in for.
 *
 * The values are exactly the strings {@link normalizeVesselType} produces for
 * the equivalent numeric code — PLEASURE is what code 37 becomes, FISHING what
 * 30 becomes, PASSENGER what 6x becomes, HIGH-SPEED what 4x becomes. Emitting
 * the same token means a joined vessel travels through the hue table, the
 * legend and the card by the same path as a declared one, with no branch that
 * could let the two drift apart.
 *
 * The categories NOT here are refused on measured evidence; see the module
 * header. Adding one back is a data decision, not a code decision: re-run the
 * cross-check first.
 */
export const ANFR_KEPT_CATEGORIES = Object.freeze({
  PLAISANCE: 'PLEASURE',
  'PÊCHE': 'FISHING',
  PASSAGERS: 'PASSENGER',
  'H.S.C.': 'HIGH-SPEED',
});

/** The type tokens a pack is allowed to contain, derived from the table above. */
const KEPT_TYPE_TOKENS = Object.freeze(new Set(Object.values(ANFR_KEPT_CATEGORIES)));

/** Credit line for the layer's source row. Attribution is a licence condition. */
export const VESSEL_REGISTRY_FR_CREDIT = 'ANFR — Données radiomaritimes (Licence Ouverte v2.0)';

/** MMSI is numeric by protocol; nine digits in this register. */
const MMSI_PATTERN = /^\d{9}$/;

/**
 * The whole list at once — nine digits, comma-separated, nothing else.
 *
 * Tested before the split for a reason that is pure V8: `split(',')` hands
 * back 112 000 SLICED strings that point into the 1.1 MB parent, and running a
 * regex on a sliced string flattens it. Validating each MMSI separately made
 * the load cost 860 ms of blocked main thread; validating the list in one pass
 * and splitting a string already known to be clean costs 199 ms cold and 67 ms
 * warm, measured 2026-09-10. Same strictness, a quarter of the boot cost.
 */
const MMSI_LIST_PATTERN = /^\d{9}(?:,\d{9})*$/;

/**
 * Did the transponder actually declare a type?
 *
 * Two shapes mean "no", and they are NOT the same thing to a reader — one is
 * silence, the other is a filled-in nothing — but both are a licence for the
 * register to speak:
 *
 *   ''   no static message has been heard for this MMSI yet;
 *   '0'  a static message arrived and carried ship type 0, "not available".
 *
 * Written against all-zeros rather than the literal '0' because the field
 * arrives from JSON as a number, a string, or a zero-padded string depending
 * on the message family.
 *
 * @param {*} type Raw AIS type as carried on the row.
 * @returns {boolean}
 */
export function aisTypeIsDeclared(type) {
  const text = String(type ?? '').trim();
  if (!text) return false;
  return !/^0+$/.test(text);
}

/**
 * Read the built pack into the lookup the server holds for its lifetime.
 *
 * Strict on version: a pack written by a future build is ignored whole rather
 * than half-read, because a silently mis-parsed index would label boats wrong
 * and look exactly like a working one.
 *
 * @param {*} document Parsed `anfr-types.json`.
 * @returns {Map<string, string>} MMSI → AIS type token. Empty when unusable.
 */
export function parseVesselRegistryFr(document) {
  const index = new Map();
  if (!document || typeof document !== 'object') return index;
  if (document.version !== VESSEL_REGISTRY_FR_VERSION) return index;
  const lists = document.mmsi;
  if (!lists || typeof lists !== 'object') return index;
  for (const [token, joined] of Object.entries(lists)) {
    if (!KEPT_TYPE_TOKENS.has(token)) continue;
    if (typeof joined !== 'string' || !joined) continue;
    const entries = joined.split(',');
    if (MMSI_LIST_PATTERN.test(joined)) {
      for (const mmsi of entries) index.set(mmsi, token);
    } else {
      // A hand-edited or truncated list: keep what is well formed rather than
      // dropping a family whole over one bad entry.
      for (const mmsi of entries) {
        if (MMSI_PATTERN.test(mmsi)) index.set(mmsi, token);
      }
    }
  }
  return index;
}

/**
 * The type a row should carry, and who said so.
 *
 * @param {string} mmsi Contact MMSI.
 * @param {*} aisType Raw type as broadcast, if any.
 * @param {?Map<string, string>} index Parsed register, or null when absent.
 * @returns {{type: string, source: 'ais'|'anfr'|''}} `source` is `''` when
 *   nobody could answer — the row keeps its raw AIS value so the layer can
 *   still tell "declared 0" from "never heard", which are different states.
 */
export function resolveVesselType(mmsi, aisType, index) {
  const raw = String(aisType ?? '').trim();
  if (aisTypeIsDeclared(raw)) return { type: raw, source: 'ais' };
  const key = String(mmsi ?? '').trim();
  const filled = key && index ? index.get(key) : undefined;
  if (filled) return { type: filled, source: 'anfr' };
  return { type: raw, source: '' };
}
