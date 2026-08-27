/**
 * @module mobilityOperators
 *
 * WHO runs a shared vehicle, and the colour that stands for them on the globe.
 *
 * The shared-mobility layers draw two different things at once. A GBFS feed
 * says what an object physically IS (`form_factor`) and, separately, the PAN
 * catalog says who publishes it. Those are independent facts, so they get
 * independent visual channels:
 *
 *   SHAPE  = what the object is      (see `sharedMobilityIcons.js`)
 *   COLOUR = who operates it         (this module)
 *
 * Without that split a Paris viewport is one undifferentiated cloud: Lime,
 * Dott and Voi all report free-floating scooters in the same streets, and a
 * per-kind palette paints all three the same violet.
 *
 * WHAT IS PUBLISHED AND WHAT IS NOT. No French GBFS feed publishes a brand
 * colour — `system_information.json` has no such field — so the colours here
 * are a DISPLAY CONVENTION, not data. Two rules keep the convention honest:
 *
 *   1. The operators that actually run several French systems are CURATED:
 *      each is pinned to one palette slot, so Lime is the same green in Lille
 *      as in Marseille, and no two curated operators ever share a slot. Where
 *      an operator's own livery is unambiguous (Lime's lime, Voi's coral,
 *      Bird's white, Citiz's orange-red) the slot echoes it; separability wins
 *      when the two goals disagree.
 *   2. Everything else — the ~110 municipal networks, Vélam, Naolib, V'lille —
 *      is DERIVED: a brand key is read off the published title and hashed onto
 *      the same palette. That is stable across sessions and across viewports,
 *      but it is a hash: two municipal networks CAN land on the same hue. The
 *      row legend names every operator in view, and that naming, not the hue,
 *      is what settles which is which.
 *
 * The registry is shared by `bikeshare.js` and `sharedMobilityFrance.js` on
 * purpose. They draw disjoint systems (the shared-mobility index excludes the
 * four the bikeshare layer already covers), and an operator that appears in
 * both — Paris shows Vélib' docks from one layer and Dott scooters from the
 * other — has to be the same colour in both or the channel means nothing.
 */

/**
 * Operator hues, chosen for pairwise separability on a dark globe.
 *
 * Ordered around the hue circle so neighbouring indices are the CLOSEST pair
 * in the set; the curated assignments below deliberately spread across it
 * rather than taking a contiguous run.
 */
export const MOBILITY_OPERATOR_PALETTE = Object.freeze([
  '#ff4d4d', //  0 red
  '#ff8c2b', //  1 orange
  '#ffc21f', //  2 amber
  '#f2e94e', //  3 yellow
  '#b6f03c', //  4 lime
  '#4fd94f', //  5 green
  '#1fcf94', //  6 emerald
  '#1fc9c9', //  7 teal
  '#35a9f0', //  8 sky
  '#5b7cf5', //  9 blue
  '#9166f2', // 10 violet
  '#c964f0', // 11 purple
  '#f45fc4', // 12 magenta
  '#ff6f91', // 13 pink
  '#d9a066', // 14 tan
  '#9fb0c4', // 15 slate
  '#eef3f8', // 16 white
]);

/** Colour for an object whose operator could not be resolved at all. */
export const MOBILITY_OPERATOR_UNKNOWN_COLOR = '#6b7a8a';

/**
 * Operators pinned to a palette slot.
 *
 * `match` entries are whole-WORD sequences tested against the normalized
 * title. Word boundaries matter: "Vélibleu Grand Châtellerault" is a
 * Châtellerault municipal network and must not be read as Vélib' Paris, which
 * a prefix test would do.
 *
 * `slot` indexes {@link MOBILITY_OPERATOR_PALETTE}. Each is unique — a test
 * pins that.
 */
const CURATED_OPERATORS = Object.freeze([
  // ── Free-floating majors (the ones that overlap each other in one city) ──
  { id: 'lime', label: 'Lime', slot: 4, match: ['lime'] },
  { id: 'voi', label: 'Voi', slot: 0, match: ['voi'] },
  { id: 'dott', label: 'Dott', slot: 8, match: ['dott'] },
  { id: 'tier', label: 'Tier', slot: 7, match: ['tier'] },
  { id: 'bird', label: 'Bird', slot: 16, match: ['bird'] },
  { id: 'pony', label: 'Pony', slot: 11, match: ['pony'] },
  { id: 'yego', label: 'YEGO', slot: 3, match: ['yego'] },
  { id: 'cityscoot', label: 'Cityscoot', slot: 10, match: ['cityscoot'] },

  // ── Carsharing ──────────────────────────────────────────────────────────
  { id: 'citiz', label: 'Citiz', slot: 1, match: ['citiz'] },
  { id: 'clem', label: "Clem'", slot: 6, match: ['clem'] },
  { id: 'leo-and-go', label: 'Leo&Go', slot: 14, match: ['leo go', 'leoandgo', 'leogo'] },

  // ── The four docked networks the Bikeshare layer draws ──────────────────
  { id: 'velib', label: "Vélib'", slot: 5, match: ['velib', 'velib metropole'] },
  { id: 'velov', label: "Vélo'v", slot: 12, match: ['velov'] },
  { id: 'velotoulouse', label: 'VélÔToulouse', slot: 2, match: ['velotoulouse'] },
  { id: 'levelo-tbm', label: 'Le Vélo (TBM)', slot: 9, match: ['tbm', 'le velo tbm'] },
]);

/**
 * Leading words that carry no brand. A title starting with one of these is
 * read one word deeper: "Vélo Modalis Grand Angoulême" is Vélo Modalis, not a
 * fourth network called "Vélo".
 */
const GENERIC_LEAD_WORDS = new Set([
  'le', 'la', 'les', 'l', 'du', 'de', 'des', 'd', 'velo', 'velos', 'vls',
]);

/**
 * Fold a published title to comparable words: lowercase, unaccented,
 * apostrophes CLOSED rather than split (so "Vélo'v" is one word `velov` and
 * "V'lille" is `vlille`), everything else a separator.
 *
 * @param {string} text Raw title.
 * @returns {string} Space-separated normalized words (may be empty).
 */
export function normalizeOperatorText(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** FNV-1a 32-bit — a stable hash with no dependency and no `Math.random`. */
function hashKey(text) {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Longest contiguous word-sequence match, anywhere in the title.
 *
 * Longest wins so a specific token beats a generic one; position breaks ties
 * so the leading brand beats a trailing mention.
 *
 * @param {Array<string>} words Normalized title words.
 * @returns {?Object} The curated entry, or null.
 */
function matchCurated(words) {
  let best = null;
  let bestLength = 0;
  let bestIndex = Infinity;
  for (const operator of CURATED_OPERATORS) {
    for (const candidate of operator.match) {
      const tokens = candidate.split(' ');
      for (let i = 0; i + tokens.length <= words.length; i++) {
        let hit = true;
        for (let j = 0; j < tokens.length; j++) {
          if (words[i + j] !== tokens[j]) { hit = false; break; }
        }
        if (!hit) continue;
        if (tokens.length > bestLength || (tokens.length === bestLength && i < bestIndex)) {
          best = operator;
          bestLength = tokens.length;
          bestIndex = i;
        }
        break;
      }
    }
  }
  return best;
}

/**
 * Brand label derived from a title that no curated entry claims.
 *
 * Reads the leading word, stepping past articles and the generic "Vélo"
 * prefix that a third of French municipal networks share. This is a HEURISTIC
 * over a human-written catalog title, which is why it only ever produces the
 * derived half of the registry — the curated half is spelled out above.
 *
 * @param {string} name Raw title.
 * @returns {?{label:string, key:string}}
 */
function deriveBrand(name) {
  const raw = String(name ?? '').trim();
  if (!raw) return null;
  // Split the RAW title so the label keeps its accents and capitalisation,
  // while the key is compared on the folded form.
  const rawWords = raw.split(/\s+/).filter(Boolean);
  const normalized = normalizeOperatorText(raw);
  if (!normalized) return null;
  const words = normalized.split(' ');

  let take = 1;
  while (take < words.length && take < 3 && GENERIC_LEAD_WORDS.has(words[take - 1])) take += 1;

  const label = rawWords.slice(0, take).join(' ').replace(/[(),.;:]+$/, '') || raw;
  return { label, key: words.slice(0, take).join(' ') };
}

/** @type {Map<string, Object>} Resolution cache, keyed by the raw title. */
const _resolved = new Map();

/**
 * Resolve a published system/provider title to the operator it belongs to.
 *
 * @param {string} name Title as published — "Lime Paris", "Naolib Nantes
 *   Métropole", "Vélib' Métropole".
 * @returns {{id:string, label:string, color:string, curated:boolean}}
 *   `curated` is true when the operator was pinned by hand, false when the
 *   label and hue were derived from the title.
 */
export function resolveMobilityOperator(name) {
  const raw = String(name ?? '');
  const cached = _resolved.get(raw);
  if (cached) return cached;

  const normalized = normalizeOperatorText(raw);
  let operator;
  if (!normalized) {
    operator = {
      id: 'unknown',
      label: 'Unknown operator',
      color: MOBILITY_OPERATOR_UNKNOWN_COLOR,
      curated: false,
    };
  } else {
    const curated = matchCurated(normalized.split(' '));
    if (curated) {
      operator = {
        id: curated.id,
        label: curated.label,
        color: MOBILITY_OPERATOR_PALETTE[curated.slot],
        curated: true,
      };
    } else {
      const brand = deriveBrand(raw);
      const key = brand?.key || normalized;
      operator = {
        id: `derived:${key}`,
        label: brand?.label || raw,
        color: MOBILITY_OPERATOR_PALETTE[hashKey(key) % MOBILITY_OPERATOR_PALETTE.length],
        curated: false,
      };
    }
  }

  Object.freeze(operator);
  _resolved.set(raw, operator);
  return operator;
}

/**
 * Operator colour for a published title.
 * @param {string} name Title as published.
 * @returns {string} CSS hex colour.
 */
export function mobilityOperatorColor(name) {
  return resolveMobilityOperator(name).color;
}

/**
 * Short operator label, clipped for the fixed-width detection overlay.
 * @param {string} name Title as published.
 * @param {number} [maxChars=12]
 * @returns {string}
 */
export function mobilityOperatorShortLabel(name, maxChars = 12) {
  const label = resolveMobilityOperator(name).label;
  return label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label;
}

/** Curated table, for tests and for documentation surfaces. */
export function curatedMobilityOperators() {
  return CURATED_OPERATORS.map((operator) => ({
    id: operator.id,
    label: operator.label,
    color: MOBILITY_OPERATOR_PALETTE[operator.slot],
  }));
}
