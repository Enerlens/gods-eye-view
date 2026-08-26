// GTFS-Realtime decoding — the wire contract this layer stands on.
//
// The field NUMBERS are the thing worth pinning: a GTFS-RT body carries no
// field names, so transposing `speed` (5) and `timestamp` (5 on a different
// message) or reading `route_id` at the wrong tag produces plausible garbage
// rather than an error. Every test here therefore encodes a real FeedMessage
// with the spec's own tags and asserts what comes back out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PbfWriter } from 'pbf';
import {
  boundsOfVehicles,
  decodeFeedMessage,
  normalizeBearing,
  normalizeFeedTimestampMs,
  routeLabelFromId,
  vehicleFromEntity,
  vehiclePositionsFromBytes,
  MAX_PLAUSIBLE_SPEED_MPS,
} from './gtfsRealtime.js';

/** Encode a FeedMessage using the GTFS-RT v2.0 field numbers, verbatim. */
function encodeFeed({ timestamp = 1787765165, entities = [] } = {}) {
  const pbf = new PbfWriter();
  pbf.writeMessage(1, (header, writer) => {
    writer.writeStringField(1, '2.0');
    writer.writeVarintField(2, 0);
    if (header.timestamp) writer.writeVarintField(3, header.timestamp);
  }, { timestamp });
  for (const entity of entities) {
    pbf.writeMessage(2, (item, writer) => {
      writer.writeStringField(1, item.id);
      if (item.isDeleted) writer.writeBooleanField(2, true);
      if (item.tripUpdateOnly) {
        // TripUpdate is tag 3 — decoded feeds must skip it, not mistake it for
        // a position.
        writer.writeMessage(3, (_unused, w) => w.writeStringField(1, 'trip-1'), {});
        return;
      }
      if (!item.vehicle) return;
      writer.writeMessage(4, (vehicle, w) => {
        if (vehicle.trip) {
          w.writeMessage(1, (trip, tw) => {
            if (trip.tripId) tw.writeStringField(1, trip.tripId);
            if (trip.startTime) tw.writeStringField(2, trip.startTime);
            if (trip.startDate) tw.writeStringField(3, trip.startDate);
            if (trip.routeId) tw.writeStringField(5, trip.routeId);
            if (trip.directionId !== undefined) tw.writeVarintField(6, trip.directionId);
          }, vehicle.trip);
        }
        if (vehicle.position) {
          w.writeMessage(2, (position, pw) => {
            pw.writeFloatField(1, position.lat);
            pw.writeFloatField(2, position.lon);
            if (position.bearing !== undefined) pw.writeFloatField(3, position.bearing);
            if (position.odometer !== undefined) pw.writeDoubleField(4, position.odometer);
            if (position.speed !== undefined) pw.writeFloatField(5, position.speed);
          }, vehicle.position);
        }
        if (vehicle.stopSequence !== undefined) w.writeVarintField(3, vehicle.stopSequence);
        if (vehicle.currentStatus !== undefined) w.writeVarintField(4, vehicle.currentStatus);
        if (vehicle.timestamp !== undefined) w.writeVarintField(5, vehicle.timestamp);
        if (vehicle.congestionLevel !== undefined) w.writeVarintField(6, vehicle.congestionLevel);
        if (vehicle.stopId) w.writeStringField(7, vehicle.stopId);
        if (vehicle.descriptor) {
          w.writeMessage(8, (descriptor, dw) => {
            if (descriptor.id) dw.writeStringField(1, descriptor.id);
            if (descriptor.label) dw.writeStringField(2, descriptor.label);
            if (descriptor.plate) dw.writeStringField(3, descriptor.plate);
          }, vehicle.descriptor);
        }
        if (vehicle.occupancyStatus !== undefined) w.writeVarintField(9, vehicle.occupancyStatus);
        if (vehicle.occupancyPercentage !== undefined) w.writeVarintField(10, vehicle.occupancyPercentage);
      }, item.vehicle);
    }, entity);
  }
  return pbf.finish();
}

/** One fully-populated Bordeaux-shaped vehicle. */
function tbmVehicle(overrides = {}) {
  return {
    id: 'entity-1',
    vehicle: {
      trip: { tripId: 'b_268436222_26', routeId: '07', directionId: 0, startDate: '20260826' },
      position: { lat: 44.8755, lon: -0.5691, bearing: 146, speed: 5.833, odometer: 1461 },
      stopSequence: 6,
      currentStatus: 2,
      timestamp: 1787765215,
      stopId: '3790',
      descriptor: { id: '2481', label: 'TBM 2481', plate: 'FV-635-TZ' },
      occupancyStatus: 2,
      ...overrides,
    },
  };
}

test('a real FeedMessage round-trips through every field number in the spec', () => {
  const bytes = encodeFeed({ entities: [tbmVehicle()] });
  const message = decodeFeedMessage(bytes);

  assert.equal(message.header.version, '2.0');
  assert.equal(message.header.timestamp, 1787765165);
  assert.equal(message.entities.length, 1);

  const vehicle = message.entities[0].vehicle;
  assert.equal(vehicle.tripId, 'b_268436222_26');
  assert.equal(vehicle.routeId, '07');
  assert.equal(vehicle.directionId, 0);
  assert.equal(vehicle.startDate, '20260826');
  assert.ok(Math.abs(vehicle.lat - 44.8755) < 1e-4);
  assert.ok(Math.abs(vehicle.lon + 0.5691) < 1e-4);
  assert.ok(Math.abs(vehicle.bearing - 146) < 1e-4);
  assert.ok(Math.abs(vehicle.speed - 5.833) < 1e-3);
  assert.equal(vehicle.odometer, 1461);
  assert.equal(vehicle.stopSequence, 6);
  assert.equal(vehicle.currentStatus, 2);
  assert.equal(vehicle.timestamp, 1787765215);
  assert.equal(vehicle.stopId, '3790');
  assert.equal(vehicle.vehicleId, '2481');
  assert.equal(vehicle.vehicleLabel, 'TBM 2481');
  assert.equal(vehicle.licensePlate, 'FV-635-TZ');
  assert.equal(vehicle.occupancyStatus, 2);
});

test('normalization flattens one entity into the record the layer renders', () => {
  const message = decodeFeedMessage(encodeFeed({ entities: [tbmVehicle()] }));
  const record = vehicleFromEntity(message.entities[0], { feedId: 'pan-84094' });

  // The feed id prefix is what keeps two networks from colliding on a bare
  // vehicle number — "2481" is not unique across 150 operators.
  assert.equal(record.id, 'pan-84094:2481');
  assert.equal(record.feedId, 'pan-84094');
  assert.equal(record.route, '07');
  assert.equal(record.label, 'TBM 2481');
  assert.equal(record.status, 'in-transit');
  assert.equal(record.occupancy, 'few-seats');
  assert.equal(record.timestampMs, 1787765215000);
  assert.ok(Math.abs(record.speedMps - 5.833) < 1e-3);
});

test('entities without a usable fix are dropped, not drawn somewhere plausible', () => {
  const bytes = encodeFeed({
    entities: [
      tbmVehicle(),
      // Trip updates share the feed. They are not positions.
      { id: 'entity-tu', tripUpdateOnly: true },
      // A deletion is an instruction to remove, never a contact.
      { id: 'entity-del', isDeleted: true, vehicle: { position: { lat: 44.8, lon: -0.5 } } },
      // Null Island: the shape a GPS that has not acquired reports.
      { id: 'entity-null', vehicle: { position: { lat: 0, lon: 0 }, descriptor: { id: 'x' } } },
      // Out of range entirely.
      { id: 'entity-bad', vehicle: { position: { lat: 191, lon: 12 }, descriptor: { id: 'y' } } },
    ],
  });
  const { vehicles, entityCount } = vehiclePositionsFromBytes(bytes, { feedId: 'f' });
  assert.equal(entityCount, 5);
  assert.deepEqual(vehicles.map((vehicle) => vehicle.id), ['f:2481']);
});

test('an entity with no vehicle descriptor still gets a stable id from the entity', () => {
  const bytes = encodeFeed({
    entities: [{ id: 'ATOUMOD:VJ:1234', vehicle: { position: { lat: 49.51, lon: 0.09 } } }],
  });
  const { vehicles } = vehiclePositionsFromBytes(bytes, { feedId: 'f' });
  assert.equal(vehicles[0].id, 'f:ATOUMOD:VJ:1234');
  assert.equal(vehicles[0].bearing, null);
  assert.equal(vehicles[0].speedMps, null);
});

test('bearing is normalized to [0,360) — real feeds publish negatives', () => {
  assert.equal(normalizeBearing(-173.5), 186.5);
  assert.equal(normalizeBearing(0), 0);
  assert.equal(normalizeBearing(360), 0);
  assert.equal(normalizeBearing(451), 91);
  assert.equal(normalizeBearing(undefined), null);
  assert.equal(normalizeBearing(Number.NaN), null);
});

test('implausible speeds are reported as unknown rather than rendered', () => {
  const fast = decodeFeedMessage(encodeFeed({
    entities: [tbmVehicle({ position: { lat: 44.8, lon: -0.5, speed: MAX_PLAUSIBLE_SPEED_MPS + 50 } })],
  }));
  assert.equal(vehicleFromEntity(fast.entities[0], { feedId: 'f' }).speedMps, null);

  const negative = decodeFeedMessage(encodeFeed({
    entities: [tbmVehicle({ position: { lat: 44.8, lon: -0.5, speed: -3 } })],
  }));
  assert.equal(vehicleFromEntity(negative.entities[0], { feedId: 'f' }).speedMps, null);
});

test('timestamps tolerate the millisecond feeds and reject the impossible ones', () => {
  assert.equal(normalizeFeedTimestampMs(1787765165), 1787765165000);
  assert.equal(normalizeFeedTimestampMs(1787765165000), 1787765165000);
  assert.equal(normalizeFeedTimestampMs(0), null);
  assert.equal(normalizeFeedTimestampMs(-5), null);
  assert.equal(normalizeFeedTimestampMs(1), null); // 1970 — a reset clock, not a fix
});

test('route labels unwrap NeTEx envelopes and leave opaque keys alone', () => {
  // The short name is already the id.
  assert.equal(routeLabelFromId('07'), '07');
  assert.equal(routeLabelFromId('C3'), 'C3');
  // NeTEx URN: publisher prefix + structural tokens + the real payload.
  assert.equal(routeLabelFromId('ATOUMOD003:Line:6xC5:LOC'), '6xC5');
  assert.equal(routeLabelFromId('REMI28:FlexibleLine:161'), '161');
  // An opaque internal key stays verbatim — inventing a prettier label would
  // be inventing data; the real name lives in the GTFS static routes.txt.
  assert.equal(routeLabelFromId('1003354'), '1003354');
  assert.equal(routeLabelFromId(''), null);
  assert.equal(routeLabelFromId(null), null);
});

test('observed bounds fence out the junk fix that would swallow a continent', () => {
  const rouen = [];
  for (let i = 0; i < 40; i++) {
    rouen.push({ lat: 49.40 + (i % 8) * 0.02, lon: 1.00 + (i % 5) * 0.03 });
  }
  const sahara = { lat: 27.141, lon: -3.4046 };

  const raw = boundsOfVehicles([...rouen, sahara]);
  assert.equal(raw.south, 27.141, 'unfenced bounds report exactly what arrived');

  const fenced = boundsOfVehicles([...rouen, sahara], { rejectOutliers: true });
  assert.ok(fenced.south > 49, 'the Sahara fix is outside the far-out fence');
  assert.ok(fenced.north < 49.6);
  assert.ok(fenced.west > 0.9 && fenced.east < 1.2);
});

test('a genuinely wide interurban network keeps its real extent', () => {
  // liO covers ~2.4 by 5.2 degrees of Occitanie. A fence tuned only for city
  // networks would clip its coaches as outliers.
  const coaches = [];
  for (let i = 0; i < 130; i++) {
    coaches.push({ lat: 42.5 + (i % 13) * 0.18, lon: -0.3 + (i % 27) * 0.19 });
  }
  const fenced = boundsOfVehicles(coaches, { rejectOutliers: true });
  const plain = boundsOfVehicles(coaches);
  assert.deepEqual(fenced, plain);
});

test('a handful of fixes is never fenced — there is no distribution to reason about', () => {
  const sparse = [{ lat: 48.85, lon: 2.35 }, { lat: 43.6, lon: 1.44 }, { lat: 45.76, lon: 4.83 }];
  assert.deepEqual(
    boundsOfVehicles(sparse, { rejectOutliers: true }),
    boundsOfVehicles(sparse),
  );
  assert.equal(boundsOfVehicles([]), null);
});
