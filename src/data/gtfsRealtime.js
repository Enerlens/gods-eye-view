/**
 * @module gtfsRealtime
 *
 * Pure GTFS-Realtime (`FeedMessage`) decoding for the **VehiclePosition** and
 * **TripUpdate** subsets, plus the normalization that turns one decoded entity
 * into the flat record the transit layer renders.
 *
 * The two are read by one decoder because they are one message type served
 * from two URLs, and because the second is the only keyless answer to "where
 * is this bus going next": a TripUpdate carries the ordered stops of the trip
 * a vehicle is running and the time the operator expects it at each of them.
 * The static equivalent, `stop_times.txt`, is 223 MB expanded for Bordeaux
 * alone and re-minted with every GTFS version.
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
import { boundsOfPoints } from './viewportBox.js';

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
 * `TripUpdate.StopTimeUpdate.ScheduleRelationship` (tag 5).
 *
 * `SCHEDULED` is the default and says nothing, so it normalizes to null and
 * only the three departures from the timetable are carried: a stop the
 * operator has cancelled, one it can give no prediction for, and one it has
 * added. A panel that printed "scheduled" against every stop would be
 * printing the absence of news as news.
 *
 * @see https://gtfs.org/documentation/realtime/reference/#enum-schedulerelationship-1
 */
export const STOP_TIME_SCHEDULE_RELATIONSHIP = Object.freeze({
  1: 'skipped',
  2: 'no-data',
  3: 'unscheduled',
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
 * `StopTimeEvent` — delay 1 (int32), time 2 (int64), uncertainty 3 (int32).
 *
 * `delay` is a protobuf `int32`, NOT a `sint32`: a negative one is written as
 * a ten-byte sign-extended varint rather than zigzagged, so it is read with
 * `readVarint(true)`. Read as unsigned it comes back as 9.2e18 — which is what
 * a bus running 19 seconds early looks like when the wire type is guessed.
 */
function readStopTimeEvent(tag, out, pbf) {
  if (tag === 1) out.delay = pbf.readVarint(true);
  else if (tag === 2) out.time = pbf.readVarint(true);
  else if (tag === 3) out.uncertainty = pbf.readVarint(true);
}

/**
 * `TripUpdate.StopTimeUpdate` — stop_sequence 1, arrival 2, departure 3,
 * stop_id 4, schedule_relationship 5.
 */
function readStopTimeUpdate(tag, out, pbf) {
  if (tag === 1) out.stopSequence = pbf.readVarint();
  else if (tag === 2) out.arrival = pbf.readMessage(readStopTimeEvent, {});
  else if (tag === 3) out.departure = pbf.readMessage(readStopTimeEvent, {});
  else if (tag === 4) out.stopId = pbf.readString();
  else if (tag === 5) out.scheduleRelationship = pbf.readVarint();
}

/**
 * `TripUpdate` — trip 1, stop_time_update 2 (repeated), vehicle 3,
 * timestamp 4, delay 5.
 */
function readTripUpdate(tag, out, pbf) {
  if (tag === 1) pbf.readMessage(readTripDescriptor, out);
  else if (tag === 2) out.stopTimeUpdates.push(pbf.readMessage(readStopTimeUpdate, {}));
  else if (tag === 3) pbf.readMessage(readVehicleDescriptor, out);
  else if (tag === 4) out.timestamp = pbf.readVarint();
  else if (tag === 5) out.delay = pbf.readVarint(true);
}

/**
 * `FeedEntity` — id 1, is_deleted 2, vehicle 4, for the POSITION pass.
 *
 * Trip updates (3), alerts (5) and shapes (6) are skipped rather than decoded.
 * Not only because this pass draws positions: several French publishers serve
 * both message types from one dataset, TBM's trip-update body is 1.3 MB of
 * stop-time predictions against 300 KB of positions, and decoding it on every
 * 15-second viewport poll would be work no caller asked for — done inside the
 * hot path, on bytes a malformed publisher could make throw.
 */
function readVehicleEntity(tag, out, pbf) {
  if (tag === 1) out.id = pbf.readString();
  else if (tag === 2) out.isDeleted = pbf.readBoolean();
  else if (tag === 4) {
    out.vehicle = pbf.readMessage(readVehiclePosition, {});
  }
}

/** `FeedEntity` — id 1, is_deleted 2, trip_update 3, for the TRIP pass. */
function readTripEntity(tag, out, pbf) {
  if (tag === 1) out.id = pbf.readString();
  else if (tag === 2) out.isDeleted = pbf.readBoolean();
  else if (tag === 3) {
    out.tripUpdate = pbf.readMessage(readTripUpdate, { stopTimeUpdates: [] });
  }
}

/** `FeedHeader` — gtfs_realtime_version 1, incrementality 2, timestamp 3. */
function readFeedHeader(tag, out, pbf) {
  if (tag === 1) out.version = pbf.readString();
  else if (tag === 2) out.incrementality = pbf.readVarint();
  else if (tag === 3) out.timestamp = pbf.readVarint();
}

/** `FeedMessage` — header 1, entity 2 (repeated), read by the given entity reader. */
function feedMessageReader(readEntity) {
  return (tag, out, pbf) => {
    if (tag === 1) pbf.readMessage(readFeedHeader, out.header);
    else if (tag === 2) out.entities.push(pbf.readMessage(readEntity, {}));
  };
}

const readVehicleFeedMessage = feedMessageReader(readVehicleEntity);
const readTripFeedMessage = feedMessageReader(readTripEntity);

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
  return decodeFeed(bytes, readVehicleFeedMessage);
}

/**
 * Decode a GTFS-RT `FeedMessage` for its TRIP UPDATES.
 *
 * The same bytes, read for the other half of the schema: entities carry a
 * `tripUpdate` and no `vehicle`.
 *
 * @param {Uint8Array|ArrayBuffer|Buffer} bytes Raw feed body.
 * @returns {{header: Object, entities: Array<Object>}}
 */
export function decodeTripUpdateFeed(bytes) {
  return decodeFeed(bytes, readTripFeedMessage);
}

/** Shared body of the two decoders above. */
function decodeFeed(bytes, reader) {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const message = { header: {}, entities: [] };
  new PbfReader(buffer).readFields(reader, message);
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
 * Largest schedule deviation accepted from a feed, seconds (±24 h).
 *
 * Not a style rule: a delay is an `int32` the operator computes, and a feed
 * that has lost its reference timetable publishes values in the hundreds of
 * thousands of seconds. "4 days late" is not a prediction, so it is dropped
 * rather than printed next to a stop name.
 */
export const MAX_PLAUSIBLE_DELAY_SEC = 24 * 3600;

/** A schedule deviation, or null when the feed published none that means anything. */
function normalizeDelaySec(value) {
  const delay = Number(value);
  if (!Number.isFinite(delay)) return null;
  if (Math.abs(delay) > MAX_PLAUSIBLE_DELAY_SEC) return null;
  return Math.round(delay);
}

/**
 * Flatten one decoded `StopTimeUpdate` into a stop the panel can print.
 *
 * Returns null only for an update that identifies no stop at all — neither by
 * id nor by sequence — which nothing downstream could place.
 *
 * @param {Object} update Decoded `StopTimeUpdate`.
 * @returns {?{sequence: ?number, stopId: ?string, arrivalMs: ?number,
 *             departureMs: ?number, delaySec: ?number, relationship: ?string}}
 */
export function stopTimeFromUpdate(update) {
  if (!update) return null;
  const stopId = update.stopId ? String(update.stopId).trim() : null;
  const sequence = Number.isFinite(update.stopSequence) ? update.stopSequence : null;
  if (!stopId && sequence === null) return null;
  const arrivalMs = normalizeFeedTimestampMs(update.arrival?.time);
  const departureMs = normalizeFeedTimestampMs(update.departure?.time);
  // The arrival delay is the one a rider waiting at the stop feels; the
  // departure delay is only the fallback for feeds that publish one event.
  const delaySec = normalizeDelaySec(update.arrival?.delay)
    ?? normalizeDelaySec(update.departure?.delay);
  return {
    sequence,
    stopId,
    arrivalMs,
    departureMs,
    delaySec,
    relationship: STOP_TIME_SCHEDULE_RELATIONSHIP[update.scheduleRelationship] || null,
  };
}

/**
 * Flatten one decoded `FeedEntity` carrying a `TripUpdate`.
 *
 * Returns null for entities that carry no trip update, for deletions, and for
 * updates with no `trip_id` — the key everything downstream joins on.
 *
 * @param {Object} entity Decoded `FeedEntity`.
 * @returns {?Object} Normalized trip update.
 */
export function tripUpdateFromEntity(entity) {
  if (!entity || entity.isDeleted === true) return null;
  const update = entity.tripUpdate;
  if (!update) return null;
  const tripId = update.tripId ? String(update.tripId).trim() : '';
  if (!tripId) return null;

  const stops = [];
  for (const raw of update.stopTimeUpdates || []) {
    const stop = stopTimeFromUpdate(raw);
    if (stop) stops.push(stop);
  }
  // The spec requires stop_time_updates in stop_sequence order, and most feeds
  // honour it. Sorting is applied only when EVERY entry carries a sequence:
  // partially-numbered lists sort into an order no feed published.
  if (stops.length > 1 && stops.every((stop) => stop.sequence !== null)) {
    stops.sort((a, b) => a.sequence - b.sequence);
  }

  return {
    tripId,
    routeId: update.routeId ? String(update.routeId) : null,
    directionId: Number.isFinite(update.directionId) ? update.directionId : null,
    startDate: update.startDate ? String(update.startDate) : null,
    startTime: update.startTime ? String(update.startTime) : null,
    vehicleId: update.vehicleId ? String(update.vehicleId) : null,
    vehicleLabel: update.vehicleLabel ? String(update.vehicleLabel) : null,
    timestampMs: normalizeFeedTimestampMs(update.timestamp),
    delaySec: normalizeDelaySec(update.delay),
    stops,
  };
}

/**
 * Decode a feed body straight to normalized trip updates.
 *
 * A vehicle-position body decodes to an empty list rather than raising: the
 * two message types share one `FeedMessage`, and several French publishers
 * serve both from URLs that differ only by a resource id.
 *
 * @param {Uint8Array|ArrayBuffer|Buffer} bytes Raw feed body.
 * @returns {{trips: Array<Object>, headerTimestampMs: ?number, entityCount: number}}
 */
export function tripUpdatesFromBytes(bytes) {
  const message = decodeTripUpdateFeed(bytes);
  const trips = [];
  for (const entity of message.entities) {
    const record = tripUpdateFromEntity(entity);
    if (record) trips.push(record);
  }
  return {
    trips,
    headerTimestampMs: normalizeFeedTimestampMs(message.header?.timestamp),
    entityCount: message.entities.length,
  };
}

/**
 * Axis-aligned bounds of a vehicle set, with the junk-fix fence described in
 * `viewportBox.boundsOfPoints`.
 *
 * This is how a feed's footprint is learned: the PAN catalog publishes a
 * coverage NAME ("epci: Bordeaux Métropole"), never a bbox, so the only
 * non-inventive way to know where a feed's buses actually are is to look at
 * where they are — with outliers fenced out, because three Normandy networks
 * on one platform each reported a vehicle at 27.14 N, 3.40 W (the Algerian
 * Sahara) during the 2026-08-26 index build.
 *
 * @param {Array<{lat: number, lon: number}>} vehicles
 * @param {Object} [options] Forwarded to `boundsOfPoints`.
 * @returns {?{south: number, west: number, north: number, east: number}}
 */
export function boundsOfVehicles(vehicles, options = {}) {
  return boundsOfPoints(vehicles, options);
}

export {
  BOUNDS_FENCE_K,
  BOUNDS_MIN_FENCE_DEG,
  BOUNDS_MIN_SAMPLES,
} from './viewportBox.js';
