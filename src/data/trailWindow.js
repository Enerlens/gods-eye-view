// src/data/trailWindow.js
/**
 * How much history a track trail shows — measured in GROUND LENGTH, not in
 * number of fixes.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 *
 * Three layers shipped the same constant, `TRAIL_MAX_POINTS = 400`:
 * `flights.js`, `militaryFlights.js` and `aisLiveVessels.js`. One number for a
 * vessel at 5 m/s and an airliner at 250 m/s — a fifty-fold difference in what
 * a fix is worth on the ground.
 *
 * The consequence is a false statement about time. At a ~15 s poll, 400
 * airliner fixes span on the order of 1 500 km and the trail crosses the whole
 * screen; 400 vessel fixes span a few kilometres and the trail fits inside the
 * chevron. A reader comparing the two sees a plane with a long past and a ship
 * that looks as though it has just appeared — when both have been tracked for
 * exactly as long (CARTOGRAPHIE E: a temporal encoding must mean the same
 * thing for every subject that carries it).
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * Every trail shows the same LENGTH OF GROUND behind its contact. That is the
 * quantity a reader actually compares on a map — screen length is ground
 * length — and it needs no speed estimate, so a contact that stops, turns, or
 * reports irregularly is handled by the same arithmetic as one in cruise.
 *
 * Two guards keep the honest cases honest:
 *
 * • A FLOOR of `minPoints` fixes. A moored ship covers no ground, and pruning
 *   purely by length would collapse its trail to a dot — erasing the fact that
 *   it has been watched for an hour. The floor keeps a short, visible history
 *   for a stationary contact.
 *
 * • A CEILING of `maxPoints` vertices, the old constant's real job: a bound on
 *   the primitive rebuilt on every poll.
 *
 * Distances are computed on the WGS84 ellipsoid chord (`Cartesian3.distance`),
 * which is what the drawn polyline's own segments measure. Over the segment
 * lengths involved, the chord and the great circle differ by parts in 10^7 —
 * far below the precision this window needs, and the polyline is the thing
 * being trimmed.
 */
import * as Cesium from 'cesium';

/**
 * Default ground length shown behind a contact.
 *
 * 260 km is roughly 17 minutes of airliner cruise and a comfortable fraction
 * of a continental view: long enough to read a turn or a hold, short enough
 * that a dense sky does not become a ball of string. The same 260 km is a
 * ship's last several hours — which is the point: the two trails now say the
 * same thing about distance instead of the same thing about fix count.
 */
export const TRAIL_GROUND_LENGTH_M = 260_000;

/** Fixes kept regardless of length, so a stationary contact keeps a history. */
export const TRAIL_MIN_POINTS = 12;

/** Hard vertex ceiling — the bound on the primitive rebuilt each poll. */
export const TRAIL_MAX_POINTS = 400;

/**
 * Trim a trail to the most recent points covering `groundLengthM` of ground.
 *
 * Walks BACKWARDS from the newest fix, accumulating segment lengths, and cuts
 * where the budget runs out. Never mutates the input.
 * @param {Array<Cesium.Cartesian3>} positions Oldest-first trail vertices.
 * @param {object} [options]
 * @param {number} [options.groundLengthM] Ground length to keep.
 * @param {number} [options.minPoints] Fixes kept whatever the length.
 * @param {number} [options.maxPoints] Hard vertex ceiling.
 * @returns {Array<Cesium.Cartesian3>} The trimmed trail, oldest-first.
 */
export function trimTrailToGroundLength(positions, {
  groundLengthM = TRAIL_GROUND_LENGTH_M,
  minPoints = TRAIL_MIN_POINTS,
  maxPoints = TRAIL_MAX_POINTS,
} = {}) {
  if (!Array.isArray(positions) || positions.length <= 1) {
    return Array.isArray(positions) ? positions.slice() : [];
  }
  const ceiling = Math.max(2, Math.floor(maxPoints));
  const floor = Math.max(2, Math.min(Math.floor(minPoints), ceiling));
  const budget = Math.max(0, Number(groundLengthM) || 0);

  // Index of the OLDEST vertex still inside the budget. Start at the newest
  // and walk back; `kept` counts vertices, which is one more than segments.
  let cut = positions.length - 1;
  let accumulated = 0;
  for (let i = positions.length - 1; i > 0; i -= 1) {
    const a = positions[i];
    const b = positions[i - 1];
    if (!a || !b) break;
    accumulated += Cesium.Cartesian3.distance(a, b);
    if (accumulated > budget) break;
    cut = i - 1;
  }
  // Apply the floor, then the ceiling. Order matters: the ceiling is a hard
  // rendering bound and must win over the floor if they ever disagree.
  cut = Math.min(cut, positions.length - floor);
  cut = Math.max(cut, positions.length - ceiling);
  cut = Math.max(0, cut);
  return cut === 0 ? positions.slice() : positions.slice(cut);
}

/**
 * Total ground length of a trail, in metres — what the window is budgeting.
 * @param {Array<Cesium.Cartesian3>} positions Oldest-first trail vertices.
 * @returns {number} Summed segment length.
 */
export function trailGroundLengthM(positions) {
  if (!Array.isArray(positions) || positions.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < positions.length; i += 1) {
    const a = positions[i - 1];
    const b = positions[i];
    if (!a || !b) continue;
    total += Cesium.Cartesian3.distance(a, b);
  }
  return total;
}
