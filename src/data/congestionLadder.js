/*
 * CONGESTION LADDER — the four rungs that say how well traffic moves, and the
 * one place the two layers that measure it read their words from.
 *
 * WHY THIS FILE EXISTS. `traffic` models congestion from TomTom flow tiles;
 * `road-status-fr` reads the state the operating DIRs declare in DATEX II.
 * They are the same question asked two ways, over the same roads, and
 * `datexRoadStatus.js` already said so in prose: the palette there is
 * "deliberately the traffic layer's own green/amber/red … so a segment
 * coloured by a measured French sensor and a road tinted by a TomTom flow tile
 * mean the same thing on screen".
 *
 * The palette was shared. The WORDS were not, and both layers ship on one
 * fused row, so the key printed them together:
 *
 *   ▸ Trafic routier          ● rgba(46,204,113,.9)  Circulation fluide  1,0 k
 *   ▸ État du réseau routier  ● rgb(46,204,113)      Fluide                27
 *
 * Measured at Rouen, 2026-09-10, in one block, at one instant: one colour, two
 * names — and below it `Circulation ralentie` against `Dense`, `Circulation
 * bloquée` against `Congestionné`. A reader cannot tell that these are one
 * scale read twice, which is the whole reason the two layers share a row.
 *
 * WHAT THE RUNGS NAME, AND WHAT THEY DO NOT. They name HOW WELL TRAFFIC MOVES,
 * which is what both sources measure. They deliberately do NOT name the
 * method: `Dense` described a density and `Circulation ralentie` a speed
 * deficit, and picking either would have made one layer speak the other's
 * physics. `Fluide · Ralenti · Bloqué` is an ordered ladder of movement that
 * both a speed ratio and a declared enumeration can climb.
 *
 * THE CUTS ARE NOT SHARED, AND THAT IS ON PURPOSE. TomTom's rungs are ratios
 * to free-flow speed; DATEX's are an enumeration a human operator picks. Rule
 * C1 forbids pretending two discretisations are one, so this table holds no
 * thresholds — each layer keeps its own, and the two-tier key names the source
 * above each block. What is shared is the vocabulary and the ink, which is
 * exactly what a reader needs to see that the two blocks answer one question.
 *
 * `impassable` has no TomTom equivalent — DATEX's `impossible` is a road that
 * cannot be driven at all — so it is on the ladder and only one layer reaches
 * it. That is a rung nobody climbs, not a rung that is missing.
 */

/**
 * The ladder, in the order traffic degrades.
 *
 * `rank` is the reading order and the tie-break when two publishers disagree
 * about one segment: the worse rung wins, because a road one centre calls
 * congested and another calls free is not a road anyone should be told is
 * free.
 */
export const CONGESTION_RUNGS = Object.freeze({
  free: Object.freeze({ id: 'free', rank: 0, label: 'Fluide', color: '#2ecc71' }),
  slow: Object.freeze({ id: 'slow', rank: 1, label: 'Ralenti', color: '#f0b23e' }),
  jam: Object.freeze({ id: 'jam', rank: 2, label: 'Bloqué', color: '#e05252' }),
  impassable: Object.freeze({
    id: 'impassable', rank: 3, label: 'Impraticable', color: '#8e2b2b',
  }),
});

/** Reading order, best first. `impassable` last because it is the worst. */
export const CONGESTION_RUNG_ORDER = Object.freeze(['free', 'slow', 'jam', 'impassable']);

/**
 * The word for a rung.
 * @param {string} rung Key of {@link CONGESTION_RUNGS}.
 * @returns {?string} The label, or null for a key that is not on the ladder.
 */
export function congestionLabel(rung) {
  return CONGESTION_RUNGS[rung]?.label ?? null;
}

/**
 * The ink for a rung.
 * @param {string} rung Key of {@link CONGESTION_RUNGS}.
 * @returns {?string} CSS hex, or null for a key that is not on the ladder.
 */
export function congestionColor(rung) {
  return CONGESTION_RUNGS[rung]?.color ?? null;
}
