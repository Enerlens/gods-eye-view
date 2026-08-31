/**
 * @module gtfsRealtime
 *
 * Pure GTFS-Realtime (`FeedMessage`) decoding for the **VehiclePosition**,
 * **TripUpdate** and **Alert** subsets, plus the normalization that turns one
 * decoded entity into the flat record the transit layer renders.
 *
 * The three are read by one decoder because they are one message type, often
 * served from one URL — 63 of the 150 French position feeds publish all three
 * under a single resource id (measured 2026-08-31). Each has its own pass and
 * its own entity reader, so a body read for positions never walks the others.
 *
 * They answer three different questions about the same bus. WHERE IT IS is the
 * position. WHERE IT IS GOING NEXT, and how far off the timetable it is, is the
 * TripUpdate: the ordered stops of the trip it is running and the time the
 * operator expects it at each of them — the static equivalent, `stop_times.txt`,
 * is 223 MB expanded for Bordeaux alone and re-minted with every GTFS version.
 * WHAT HAS BEEN SAID ABOUT ITS LINE is the Alert, which is the only place in
 * the schema an operator writes a sentence for riders.
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
 * `TripDescriptor.ScheduleRelationship` (tag 4).
 *
 * `SCHEDULED` (0) is the default and normalizes to null for the same reason
 * the stop-level default does: a trip running as timetabled is not news. The
 * four that ARE news are kept, and `canceled` is the one this layer treats as
 * a disruption in its own right — a vehicle still reporting its position on a
 * trip the operator has cancelled is a thing riders can see happening.
 *
 * @see https://gtfs.org/documentation/realtime/reference/#enum-schedulerelationship
 */
export const TRIP_SCHEDULE_RELATIONSHIP = Object.freeze({
  1: 'added',
  2: 'unscheduled',
  3: 'canceled',
  5: 'replacement',
  6: 'duplicated',
  7: 'deleted',
});

/**
 * `Alert.Cause` (tag 6). `UNKNOWN_CAUSE` (1) is absent on purpose: it is the
 * proto default and normalizes to null, so a card never prints "cause:
 * unknown" as though the operator had said something.
 *
 * @see https://gtfs.org/documentation/realtime/reference/#enum-cause
 */
export const ALERT_CAUSE = Object.freeze({
  2: 'other',
  3: 'technical problem',
  4: 'strike',
  5: 'demonstration',
  6: 'accident',
  7: 'holiday',
  8: 'weather',
  9: 'maintenance',
  10: 'construction',
  11: 'police activity',
  12: 'medical emergency',
});

/**
 * `Alert.Effect` (tag 7) — what the alert DOES to service, which is the part
 * a map can rank by. `UNKNOWN_EFFECT` (8) normalizes to null.
 *
 * @see https://gtfs.org/documentation/realtime/reference/#enum-effect
 */
export const ALERT_EFFECT = Object.freeze({
  1: 'no service',
  2: 'reduced service',
  3: 'significant delays',
  4: 'detour',
  5: 'additional service',
  6: 'modified service',
  7: 'other effect',
  9: 'stop moved',
  10: 'no effect',
  11: 'accessibility issue',
});

/** `Alert.SeverityLevel` (tag 14); `UNKNOWN_SEVERITY` (1) normalizes to null. */
export const ALERT_SEVERITY = Object.freeze({
  2: 'info',
  3: 'warning',
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

/**
 * `TripDescriptor` — trip_id 1, start_time 2, start_date 3,
 * schedule_relationship 4, route_id 5, direction_id 6.
 */
function readTripDescriptor(tag, out, pbf) {
  if (tag === 1) out.tripId = pbf.readString();
  else if (tag === 2) out.startTime = pbf.readString();
  else if (tag === 3) out.startDate = pbf.readString();
  else if (tag === 4) out.tripScheduleRelationship = pbf.readVarint();
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

/** `Translation` — text 1, language 2. */
function readTranslation(tag, out, pbf) {
  if (tag === 1) out.text = pbf.readString();
  else if (tag === 2) out.language = pbf.readString();
}

/** `TranslatedString` — translation 1 (repeated). */
function readTranslatedString(tag, out, pbf) {
  if (tag === 1) out.translations.push(pbf.readMessage(readTranslation, {}));
}

/** `TimeRange` — start 1, end 2 (both POSIX seconds, both optional). */
function readTimeRange(tag, out, pbf) {
  if (tag === 1) out.start = pbf.readVarint();
  else if (tag === 2) out.end = pbf.readVarint();
}

/**
 * `EntitySelector` — agency_id 1, route_id 2, route_type 3, trip 4, stop_id 5,
 * direction_id 6.
 *
 * This is WHAT an alert is about, and it is the only reason alerts can be
 * attached to a moving vehicle at all: a selector naming a `route_id` names
 * the same key the vehicle's own `TripDescriptor` publishes.
 */
function readEntitySelector(tag, out, pbf) {
  if (tag === 1) out.agencyId = pbf.readString();
  else if (tag === 2) out.routeId = pbf.readString();
  else if (tag === 3) out.routeType = pbf.readVarint();
  else if (tag === 4) pbf.readMessage(readTripDescriptor, out);
  else if (tag === 5) out.stopId = pbf.readString();
  else if (tag === 6) out.selectorDirectionId = pbf.readVarint();
}

/**
 * `Alert` — active_period 1, informed_entity 5, cause 6, effect 7, url 8,
 * header_text 10, description_text 11, severity_level 14.
 *
 * The TTS variants (12, 13) and the image members (15, 16) are skipped: they
 * restate text this already carries, for surfaces this project does not have.
 */
function readAlert(tag, out, pbf) {
  if (tag === 1) out.activePeriods.push(pbf.readMessage(readTimeRange, {}));
  else if (tag === 5) out.informedEntities.push(pbf.readMessage(readEntitySelector, {}));
  else if (tag === 6) out.cause = pbf.readVarint();
  else if (tag === 7) out.effect = pbf.readVarint();
  else if (tag === 8) out.url = pbf.readMessage(readTranslatedString, { translations: [] });
  else if (tag === 10) out.headerText = pbf.readMessage(readTranslatedString, { translations: [] });
  else if (tag === 11) out.descriptionText = pbf.readMessage(readTranslatedString, { translations: [] });
  else if (tag === 14) out.severityLevel = pbf.readVarint();
}

/**
 * `FeedEntity` — id 1, is_deleted 2, vehicle 4, for the POSITION pass.
 *
 * Trip updates (3), alerts (5) and shapes (6) are skipped rather than decoded.
 * Not only because this pass draws positions: several French publishers serve
 * all three message types from one dataset, TBM's trip-update body is 1.3 MB of
 * stop-time predictions against 300 KB of positions, and decoding it on every
 * 15-second viewport poll would be work no caller asked for — done inside the
 * hot path, on bytes a malformed publisher could make throw. Each of the other
 * two has a pass of its own below, run only when something asks for it.
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

/** `FeedEntity` — id 1, is_deleted 2, alert 5, for the ALERT pass. */
function readAlertEntity(tag, out, pbf) {
  if (tag === 1) out.id = pbf.readString();
  else if (tag === 2) out.isDeleted = pbf.readBoolean();
  else if (tag === 5) {
    out.alert = pbf.readMessage(readAlert, { activePeriods: [], informedEntities: [] });
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
const readAlertFeedMessage = feedMessageReader(readAlertEntity);

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

/**
 * Decode a GTFS-RT `FeedMessage` for its ALERTS.
 *
 * The third pass over the same shape: entities carry an `alert` and nothing
 * else. 63 of the 150 French position feeds publish all three entity types
 * under ONE resource id (measured 2026-08-31), so these bytes are frequently
 * bytes already fetched.
 *
 * @param {Uint8Array|ArrayBuffer|Buffer} bytes Raw feed body.
 * @returns {{header: Object, entities: Array<Object>}}
 */
export function decodeAlertFeed(bytes) {
  return decodeFeed(bytes, readAlertFeedMessage);
}

/** Shared body of the three decoders above. */
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
    // Carried from the vehicle's OWN `TripDescriptor`, so a cancelled run is
    // known from the position feed alone — no second request, no join.
    tripRelationship: TRIP_SCHEDULE_RELATIONSHIP[vehicle.tripScheduleRelationship] || null,
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
    relationship: TRIP_SCHEDULE_RELATIONSHIP[update.tripScheduleRelationship] || null,
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
 * Pick one language out of a `TranslatedString`.
 *
 * French first, because these are French operators writing for French riders
 * and several publish an English translation that is a machine rendering of
 * the French one. Then an UNTAGGED translation — the spec allows exactly one,
 * and a feed that publishes a single string with no language tag is the common
 * French case. Then whatever came first, because one language is better than
 * printing nothing.
 *
 * @param {Object} translated Decoded `TranslatedString`.
 * @param {string[]} [preferred] Language codes, most wanted first.
 * @returns {?string}
 */
export function translatedText(translated, preferred = ['fr']) {
  const translations = Array.isArray(translated?.translations) ? translated.translations : [];
  const usable = translations.filter((entry) => String(entry?.text ?? '').trim());
  if (!usable.length) return null;
  for (const want of preferred) {
    const match = usable.find(
      (entry) => String(entry.language ?? '').toLowerCase().split('-')[0] === want,
    );
    if (match) return String(match.text).trim();
  }
  const untagged = usable.find((entry) => !String(entry.language ?? '').trim());
  return String((untagged || usable[0]).text).trim();
}

/**
 * Flatten one decoded `FeedEntity` carrying an `Alert`.
 *
 * Returns null for entities that carry no alert, for deletions, and for alerts
 * that inform NO entity — an alert with an empty `informed_entity` list is
 * about nothing this layer can attach it to, and attaching it to everything
 * would put a random disruption on every vehicle in the network.
 *
 * @param {Object} entity Decoded `FeedEntity`.
 * @param {Object} [options]
 * @param {string[]} [options.languages] Forwarded to {@link translatedText}.
 * @returns {?Object} Normalized alert.
 */
export function alertFromEntity(entity, { languages = ['fr'] } = {}) {
  if (!entity || entity.isDeleted === true) return null;
  const alert = entity.alert;
  if (!alert) return null;

  const informed = [];
  for (const selector of alert.informedEntities || []) {
    const entry = {
      agencyId: selector.agencyId ? String(selector.agencyId) : null,
      routeId: selector.routeId ? String(selector.routeId) : null,
      routeType: Number.isFinite(selector.routeType) ? selector.routeType : null,
      tripId: selector.tripId ? String(selector.tripId) : null,
      stopId: selector.stopId ? String(selector.stopId) : null,
      directionId: Number.isFinite(selector.selectorDirectionId) ? selector.selectorDirectionId : null,
    };
    if (Object.values(entry).some((value) => value !== null)) informed.push(entry);
  }
  if (!informed.length) return null;

  const header = translatedText(alert.headerText, languages);
  const description = translatedText(alert.descriptionText, languages);
  if (!header && !description) return null;

  return {
    id: entity.id ? String(entity.id) : null,
    header,
    description,
    url: translatedText(alert.url, languages),
    cause: ALERT_CAUSE[alert.cause] || null,
    effect: ALERT_EFFECT[alert.effect] || null,
    severity: ALERT_SEVERITY[alert.severityLevel] || null,
    activePeriods: (alert.activePeriods || []).map((period) => ({
      startMs: normalizeFeedTimestampMs(period.start),
      endMs: normalizeFeedTimestampMs(period.end),
    })),
    informed,
  };
}

/**
 * Whether an alert is in force at `nowMs`.
 *
 * An alert with NO active period is active — that is the spec's own reading
 * ("if missing, the alert will be shown as long as it appears in the feed"),
 * and it is what most French publishers rely on. A period with only a start or
 * only an end is half-open in the direction it names.
 *
 * @param {Object} alert Normalized alert.
 * @param {number} [nowMs]
 * @returns {boolean}
 */
export function alertIsActive(alert, nowMs = Date.now()) {
  const periods = Array.isArray(alert?.activePeriods) ? alert.activePeriods : [];
  if (!periods.length) return true;
  return periods.some((period) => {
    if (period.startMs !== null && nowMs < period.startMs) return false;
    if (period.endMs !== null && nowMs > period.endMs) return false;
    return true;
  });
}

/**
 * Decode a feed body straight to normalized alerts.
 *
 * Like {@link tripUpdatesFromBytes}, a body of another entity type decodes to
 * an empty list rather than raising: 63 of the 150 French position feeds serve
 * all three entity types from ONE resource id, so the same bytes are read
 * three ways (measured 2026-08-31).
 *
 * @param {Uint8Array|ArrayBuffer|Buffer} bytes Raw feed body.
 * @param {Object} [options] Forwarded to {@link alertFromEntity}.
 * @returns {{alerts: Array<Object>, headerTimestampMs: ?number, entityCount: number}}
 */
export function alertsFromBytes(bytes, options = {}) {
  const message = decodeAlertFeed(bytes);
  const alerts = [];
  for (const entity of message.entities) {
    const record = alertFromEntity(entity, options);
    if (record) alerts.push(record);
  }
  return {
    alerts,
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
