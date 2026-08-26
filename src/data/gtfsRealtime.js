/**
 * @module gtfsRealtime
 *
 * Pure GTFS-Realtime (`FeedMessage`) decoding for the **VehiclePosition**
 * subset, plus the normalization that turns one decoded entity into the flat
 * record the transit layer renders.
 *
 * WHY A HAND-ROLLED DECODER: GTFS-RT is Protocol Buffers, and the canonical
 * `gtfs-realtime-bindings` package ships the full generated schema (trip
 * updates, alerts, shapes, trip modifications) on top of `protobufjs`. This
 * project already depends on `pbf@5` for TomTom vector tiles, and the slice of
 * the schema a moving-vehicle layer needs is small and frozen: the wire tags
 * below are the ones in the GTFS-RT v2.0 spec and have never been renumbered.
 * Reading them directly keeps the dependency count flat and keeps decoding
 * unit-testable without a network or a code-generation step.
 *
 * The field numbers are the contract. They are transcribed from
 * https://gtfs.org/documentation/realtime/proto/ and are commented per message
 * so a future reader can check them against the spec without reverse
 * engineering this file.
 *
 * Dependency-light and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
 */
import { PbfReader } from 'pbf';

/** Largest surface speed accepted from a feed, m/s (~324 km/h — TGV headroom). */
export const MAX_PLAUSIBLE_SPEED_MPS = 90;

/**
 * `VehiclePosition.VehicleStopStatus` (tag 4).
 * @see https://gtfs.org/documentation/realtime/reference/#enum-vehiclestopstatus
 */
export const VEHICLE_STOP_STATUS = Object.freeze({
  0: 'incoming',
  1: 'stopped',
  2: 'in-transit',
});

/**
 * `VehiclePosition.OccupancyStatus` (tag 9). Values 7/8 are "we do not know",
 * so they normalize to null rather than to a fake load figure.
 * @see https://gtfs.org/documentation/realtime/reference/#enum-occupancystatus
 */
export const OCCUPANCY_STATUS = Object.freeze({
  0: 'empty',
  1: 'many-seats',
  2: 'few-seats',
  3: 'standing-room',
  4: 'crushed',
  5: 'full',
  6: 'not-accepting',
});

/** `VehiclePosition.CongestionLevel` (tag 6); 0 is UNKNOWN_CONGESTION_LEVEL. */
export const CONGESTION_LEVEL = Object.freeze({
  1: 'smooth',
  2: 'stop-and-go',
  3: 'congestion',
  4: 'severe',
});

/**
 * NeTEx/Transmodel id parts that are structural, never the line's public name.
 * French networks publish `route_id`s like `ATOUMOD003:Line:6xC5:LOC`, where
 * only `6xC5` is the thing printed on the front of the bus.
 */
const NETEX_STRUCTURAL_TOKENS = new Set([
  'line', 'flexibleline', 'route', 'servicejourney', 'vehiclejourney',
  'datedservicejourney', 'loc', 'default',
]);

// --- FeedMessage wire readers (GTFS-RT v2.0 field numbers) -----------------

/** `Position` — latitude 1 (float), longitude 2, bearing 3, odometer 4 (double), speed 5. */
function readPosition(tag, out, pbf) {
  if (tag === 1) out.lat = pbf.readFloat();
  else if (tag === 2) out.lon = pbf.readFloat();
  else if (tag === 3) out.bearing = pbf.readFloat();
  else if (tag === 4) out.odometer = pbf.readDouble();
  else if (tag === 5) out.speed = pbf.readFloat();
}

/** `TripDescriptor` — trip_id 1, start_time 2, start_date 3, route_id 5, direction_id 6. */
function readTripDescriptor(tag, out, pbf) {
  if (tag === 1) out.tripId = pbf.readString();
  else if (tag === 2) out.startTime = pbf.readString();
  else if (tag === 3) out.startDate = pbf.readString();
  else if (tag === 5) out.routeId = pbf.readString();
  else if (tag === 6) out.directionId = pbf.readVarint();
}

/** `VehicleDescriptor` — id 1, label 2, license_plate 3. */
function readVehicleDescriptor(tag, out, pbf) {
  if (tag === 1) out.vehicleId = pbf.readString();
  else if (tag === 2) out.vehicleLabel = pbf.readString();
  else if (tag === 3) out.licensePlate = pbf.readString();
}

/**
 * `VehiclePosition` — trip 1, position 2, current_stop_sequence 3,
 * current_status 4, timestamp 5, congestion_level 6, stop_id 7, vehicle 8,
 * occupancy_status 9, occupancy_percentage 10.
 */
function readVehiclePosition(tag, out, pbf) {
  if (tag === 1) pbf.readMessage(readTripDescriptor, out);
  else if (tag === 2) pbf.readMessage(readPosition, out);
  else if (tag === 3) out.stopSequence = pbf.readVarint();
  else if (tag === 4) out.currentStatus = pbf.readVarint();
  else if (tag === 5) out.timestamp = pbf.readVarint();
  else if (tag === 6) out.congestionLevel = pbf.readVarint();
  else if (tag === 7) out.stopId = pbf.readString();
  else if (tag === 8) pbf.readMessage(readVehicleDescriptor, out);
  else if (tag === 9) out.occupancyStatus = pbf.readVarint();
  else if (tag === 10) out.occupancyPercentage = pbf.readVarint();
}

/**
 * `FeedEntity` — id 1, is_deleted 2, vehicle 4. Trip updates (3), alerts (5)
 * and shapes (6) are deliberately skipped: this layer draws positions.
 */
function readFeedEntity(tag, out, pbf) {
  if (tag === 1) out.id = pbf.readString();
  else if (tag === 2) out.isDeleted = pbf.readBoolean();
  else if (tag === 4) {
    out.vehicle = pbf.readMessage(readVehiclePosition, {});
  }
}

/** `FeedHeader` — gtfs_realtime_version 1, incrementality 2, timestamp 3. */
function readFeedHeader(tag, out, pbf) {
  if (tag === 1) out.version = pbf.readString();
  else if (tag === 2) out.incrementality = pbf.readVarint();
  else if (tag === 3) out.timestamp = pbf.readVarint();
}

/** `FeedMessage` — header 1, entity 2 (repeated). */
function readFeedMessage(tag, out, pbf) {
  if (tag === 1) pbf.readMessage(readFeedHeader, out.header);
  else if (tag === 2) out.entities.push(pbf.readMessage(readFeedEntity, {}));
}

/**
 * Decode a GTFS-RT `FeedMessage` down to its header and entity list.
 *
 * Throws on bytes that are not a protobuf message at all; a well-formed
 * message carrying only trip updates decodes to entities with no `vehicle`.
 *
 * @param {Uint8Array|ArrayBuffer|Buffer} bytes Raw feed body.
 * @returns {{header: {version?: string, incrementality?: number, timestamp?: number},
 *            entities: Array<Object>}}
 */
export function decodeFeedMessage(bytes) {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const message = { header: {}, entities: [] };
  new PbfReader(buffer).readFields(readFeedMessage, message);
  return message;
}

/** Normalize any bearing (including the negatives some feeds publish) to [0, 360). */
export function normalizeBearing(value) {
  const bearing = Number(value);
  if (!Number.isFinite(bearing)) return null;
  return ((bearing % 360) + 360) % 360;
}

/**
 * POSIX seconds, tolerating the millisecond timestamps a few feeds publish.
 * Anything outside 2001–2100 is treated as unusable rather than plotted as a
 * fresh fix.
 *
 * @param {*} value Raw `timestamp` field.
 * @returns {?number} Epoch milliseconds, or null.
 */
export function normalizeFeedTimestampMs(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const ms = raw > 1e12 ? raw : raw * 1000;
  if (ms < 978_307_200_000 || ms > 4_102_444_800_000) return null;
  return Math.round(ms);
}

/**
 * Best public-facing name for a line, given only a `route_id`.
 *
 * Feeds fall in three families: the short name is already the id ("07", "C3"),
 * the id is a NeTEx URN whose payload segment is the short name, or the id is
 * an opaque internal key ("1003354") with nothing better inside it. The first
 * two are unwrapped; the third is returned verbatim, because inventing a
 * prettier label for an opaque key would be inventing data. Resolving opaque
 * keys to real line names needs the matching GTFS *static* `routes.txt`, which
 * this layer does not load.
 *
 * @param {*} routeId Raw `trip.route_id`.
 * @returns {?string} Display label, or null when there is no route at all.
 */
export function routeLabelFromId(routeId) {
  const raw = String(routeId ?? '').trim();
  if (!raw) return null;
  if (!raw.includes(':')) return raw;
  const parts = raw.split(':').map((part) => part.trim()).filter(Boolean);
  // Drop the publisher prefix (first part) and every structural token; what is
  // left is the payload segment, e.g. `6xC5` in `ATOUMOD003:Line:6xC5:LOC`.
  const payload = parts
    .slice(1)
    .filter((part) => !NETEX_STRUCTURAL_TOKENS.has(part.toLowerCase()));
  return payload[0] || parts[parts.length - 1] || raw;
}

/**
 * Flatten one decoded `FeedEntity` into the record the layer renders.
 *
 * Returns null for anything without a usable fix: trip-update-only entities,
 * deletions, out-of-range coordinates, and the Null-Island `0,0` that some
 * feeds emit for a vehicle whose GPS has not acquired.
 *
 * @param {Object} entity Decoded `FeedEntity`.
 * @param {Object} [context]
 * @param {string} [context.feedId] Feed key, prefixed onto the vehicle id so
 *   two networks can never collide on a bare vehicle number.
 * @returns {?Object} Normalized vehicle record.
 */
export function vehicleFromEntity(entity, { feedId = '' } = {}) {
  if (!entity || entity.isDeleted === true) return null;
  const vehicle = entity.vehicle;
  if (!vehicle) return null;

  const lat = Number(vehicle.lat);
  const lon = Number(vehicle.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (lat === 0 && lon === 0) return null;

  const localId = String(
    vehicle.vehicleId || vehicle.vehicleLabel || entity.id || vehicle.tripId || '',
  ).trim();
  if (!localId) return null;

  const speed = Number(vehicle.speed);
  const speedMps = Number.isFinite(speed) && speed >= 0 && speed <= MAX_PLAUSIBLE_SPEED_MPS
    ? speed
    : null;

  const record = {
    id: feedId ? `${feedId}:${localId}` : localId,
    feedId: feedId || null,
    lat,
    lon,
    bearing: normalizeBearing(vehicle.bearing),
    speedMps,
    route: routeLabelFromId(vehicle.routeId),
    routeId: vehicle.routeId ? String(vehicle.routeId) : null,
    tripId: vehicle.tripId ? String(vehicle.tripId) : null,
    label: vehicle.vehicleLabel ? String(vehicle.vehicleLabel) : null,
    stopId: vehicle.stopId ? String(vehicle.stopId) : null,
    stopSequence: Number.isFinite(vehicle.stopSequence) ? vehicle.stopSequence : null,
    status: VEHICLE_STOP_STATUS[vehicle.currentStatus] || null,
    occupancy: OCCUPANCY_STATUS[vehicle.occupancyStatus] || null,
    congestion: CONGESTION_LEVEL[vehicle.congestionLevel] || null,
    timestampMs: normalizeFeedTimestampMs(vehicle.timestamp),
  };
  return record;
}

/**
 * Decode a feed body straight to normalized vehicle records.
 *
 * @param {Uint8Array|ArrayBuffer|Buffer} bytes Raw feed body.
 * @param {Object} [context] Forwarded to {@link vehicleFromEntity}.
 * @returns {{vehicles: Array<Object>, headerTimestampMs: ?number, entityCount: number}}
 */
export function vehiclePositionsFromBytes(bytes, context = {}) {
  const message = decodeFeedMessage(bytes);
  const vehicles = [];
  for (const entity of message.entities) {
    const record = vehicleFromEntity(entity, context);
    if (record) vehicles.push(record);
  }
  return {
    vehicles,
    headerTimestampMs: normalizeFeedTimestampMs(message.header?.timestamp),
    entityCount: message.entities.length,
  };
}

/**
 * Linear-interpolated quantile of a pre-sorted numeric array.
 * @param {number[]} sorted Ascending values (non-empty).
 * @param {number} p Quantile in [0, 1].
 * @returns {number}
 */
function quantile(sorted, p) {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** Default Tukey multiplier for the far-out fence used by observed bounds. */
export const BOUNDS_FENCE_K = 3;
/**
 * Floor on the fence half-width, in degrees (~22 km). A compact urban network
 * has a near-zero interquartile range, and a pure IQR fence would then reject
 * its own outer suburbs as outliers.
 */
export const BOUNDS_MIN_FENCE_DEG = 0.2;
/** Below this many fixes there is no distribution to reason about — keep all. */
export const BOUNDS_MIN_SAMPLES = 8;

/**
 * Axis-aligned bounds of a vehicle set, rounded to ~10 m.
 *
 * This is how a feed's footprint is learned: the PAN catalog publishes a
 * coverage NAME ("epci: Bordeaux Métropole"), never a bbox, so the only
 * non-inventive way to know where a feed's buses actually are is to look at
 * where they are.
 *
 * `rejectOutliers` matters for exactly that use. Real feeds emit occasional
 * junk fixes — three Normandy networks on one platform each reported a vehicle
 * at 27.14 N, 3.40 W (the Algerian Sahara) during the 2026-08-26 index build —
 * and one such fix inflates a 40 km city box into a 2500 km one, which then
 * matches every viewport in western Europe. The filter is a Tukey far-out
 * fence per axis with a floor, so a genuinely spread-out interurban network
 * (liO covers 5 degrees of Occitanie) keeps its real extent. It is off by
 * default: measuring a footprint wants it, drawing what a feed said does not.
 *
 * @param {Array<{lat: number, lon: number}>} vehicles
 * @param {Object} [options]
 * @param {boolean} [options.rejectOutliers=false] Apply the fence.
 * @param {number} [options.fenceK]
 * @param {number} [options.minFenceDeg]
 * @param {number} [options.minSamples]
 * @returns {?{south: number, west: number, north: number, east: number}}
 */
export function boundsOfVehicles(vehicles, options = {}) {
  const {
    rejectOutliers = false,
    fenceK = BOUNDS_FENCE_K,
    minFenceDeg = BOUNDS_MIN_FENCE_DEG,
    minSamples = BOUNDS_MIN_SAMPLES,
  } = options;

  const lats = [];
  const lons = [];
  for (const vehicle of vehicles || []) {
    const lat = Number(vehicle?.lat);
    const lon = Number(vehicle?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    lats.push(lat);
    lons.push(lon);
  }
  if (!lats.length) return null;

  let keep = null;
  if (rejectOutliers && lats.length >= minSamples) {
    const fence = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      const q1 = quantile(sorted, 0.25);
      const q3 = quantile(sorted, 0.75);
      const span = Math.max(fenceK * (q3 - q1), minFenceDeg);
      return { low: q1 - span, high: q3 + span };
    };
    const latFence = fence(lats);
    const lonFence = fence(lons);
    keep = [];
    for (let i = 0; i < lats.length; i++) {
      if (lats[i] < latFence.low || lats[i] > latFence.high) continue;
      if (lons[i] < lonFence.low || lons[i] > lonFence.high) continue;
      keep.push(i);
    }
    if (!keep.length) keep = null;
  }

  const indices = keep || lats.map((_, i) => i);
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const i of indices) {
    if (lats[i] < south) south = lats[i];
    if (lats[i] > north) north = lats[i];
    if (lons[i] < west) west = lons[i];
    if (lons[i] > east) east = lons[i];
  }
  const round = (value) => Number(value.toFixed(4));
  return { south: round(south), west: round(west), north: round(north), east: round(east) };
}
