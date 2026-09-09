/**
 * @module data/vesselStandoff
 * @description How far the camera stands off a clicked vessel — the one number
 * that decides whether the reader sees a ship, or a ship somewhere.
 *
 * ── Why this is not a constant ──────────────────────────────────────────────
 *
 * The shipped framing was a 1 200 m standoff. At that range a 200 m hull fills
 * the frame and the remaining ~1.4 km of ground is open water in every
 * direction: the contact is identified in a void. Nothing on screen separates a
 * ferry in the Dover strait from a trawler off Sète, because neither the strait
 * nor Sète is in the picture. A ship is read by the coast it is working, the
 * same way `worldFocus.js` already frames a fire wider than a vessel because a
 * fire is read by its surroundings.
 *
 * So the standoff is derived from the distance to the nearest land. The
 * bundled IGN département outlines are the only land polygons this app ships,
 * and inside the AIS subscription box (metropolitan France and its approaches,
 * `aisSubscription.js`) their seaward edge IS the coastline — including
 * Corsica, which is two départements.
 *
 * NOT the departure port. AIS gives a position, not a track: a vessel first
 * heard ten minutes ago has ten minutes of history, and where it sailed from
 * is not knowable from this feed. Framing the coast is the honest version of
 * the same want — it puts the ship somewhere nameable.
 *
 * ── Where the 2.2 comes from ───────────────────────────────────────────────
 *
 * `flyToBoundingSphere` places the camera at `range` from the target, pitched
 * down by {@link VESSEL_STANDOFF.pitchDeg}, on the operator's current heading.
 * The ground the frame is GUARANTEED to hold around the target is a good deal
 * less than `range`. With Cesium's default 60° horizontal field of view at
 * 16:9 (θh = 30°, θv ≈ 18°) and a −38° pitch:
 *
 *   · camera height          h = range·sin38 = 0.616·range
 *   · near edge, astern      0.373·range  ← the binding one
 *   · flanks, abeam          0.577·range
 *   · far edge, ahead        0.904·range
 *
 * A coast at distance D is therefore inside the frame from EVERY bearing at
 * range ≈ 2.68·D. The factor below is deliberately under that. The worst case
 * it gives up on is a coast lying exactly behind the camera — and buying that
 * one case costs every ordinary click (coast ahead or abeam) a range that
 * reads as a map instead of a scene. The floor and the ceiling matter more
 * than the factor: they are what keep a ferry alongside its berth and a
 * freighter in mid-Channel in the same visual register.
 *
 * PURE — no Cesium, no DOM, no fetch. The caller measures the coast distance
 * (`franceDepartements.nearestDepartementWithin`) and this decides the framing.
 */

/**
 * The vessel-focus standoff policy, in metres and kilometres.
 *
 * `minRangeM` is the floor a click can produce even alongside a quay: below it
 * the shot stops reading as "a ship in a place" and goes back to being a hull
 * portrait. `maxRangeM` is the ceiling for a vessel with no land within reach —
 * far enough that the coast shows up near the horizon, close enough that the
 * chevron is still the subject of the frame.
 */
export const VESSEL_STANDOFF = Object.freeze({
  /** Closest the camera ever settles on a clicked vessel, metres. */
  minRangeM: 8_000,
  /** Furthest, metres — used as-is when no coast is within `scanKm`. */
  maxRangeM: 45_000,
  /** Used when the coast distance is UNKNOWN (outlines not loaded yet), metres. */
  defaultRangeM: 20_000,
  /** Range per metre of coast distance — see the file header. */
  coastFactor: 2.2,
  /** Down-pitch of the transfer, degrees. Oblique: a nadir drop reads as a map. */
  pitchDeg: -38,
});

/**
 * How far out the caller needs to look for land, kilometres.
 *
 * Derived, not chosen: any coast further than this maps to `maxRangeM` anyway,
 * so scanning past it buys nothing and costs the outline sweep its bounding-box
 * shortcut. Rounded up so the boundary case lands inside the scan.
 */
export const VESSEL_STANDOFF_SCAN_KM = Math.ceil(
  VESSEL_STANDOFF.maxRangeM / VESSEL_STANDOFF.coastFactor / 1000,
);

/**
 * The camera standoff for a vessel whose nearest coast is `coastKm` away.
 *
 * @param {?number} coastKm Distance to the nearest land outline, kilometres, or
 *   `null` when the caller SCANNED and found none within
 *   {@link VESSEL_STANDOFF_SCAN_KM}. Those two cases are the same answer — the
 *   ceiling — and both are distinct from "not scanned at all", which is the
 *   caller's business: it should pass no range and let
 *   {@link VESSEL_STANDOFF}`.defaultRangeM` stand.
 * @returns {number} Range in metres, inside `[minRangeM, maxRangeM]`.
 */
export function vesselStandoffRangeM(coastKm) {
  if (!Number.isFinite(coastKm) || coastKm < 0) return VESSEL_STANDOFF.maxRangeM;
  const range = coastKm * 1000 * VESSEL_STANDOFF.coastFactor;
  return Math.min(VESSEL_STANDOFF.maxRangeM, Math.max(VESSEL_STANDOFF.minRangeM, range));
}
