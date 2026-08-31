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
  alertIsActive,
  alertsFromBytes,
  boundsOfVehicles,
  decodeFeedMessage,
  normalizeBearing,
  normalizeFeedTimestampMs,
  routeLabelFromId,
  translatedText,
  tripUpdatesFromBytes,
  vehicleFromEntity,
  vehiclePositionsFromBytes,
  MAX_PLAUSIBLE_DELAY_SEC,
  MAX_PLAUSIBLE_SPEED_MPS,
} from './gtfsRealtime.js';

/** `TripDescriptor` — the one message shared by positions, updates and alerts. */
function writeTripDescriptor(field, writer, trip) {
  writer.writeMessage(field, (value, tw) => {
    if (value.tripId) tw.writeStringField(1, value.tripId);
    if (value.startTime) tw.writeStringField(2, value.startTime);
    if (value.startDate) tw.writeStringField(3, value.startDate);
    if (value.scheduleRelationship !== undefined) tw.writeVarintField(4, value.scheduleRelationship);
    if (value.routeId) tw.writeStringField(5, value.routeId);
    if (value.directionId !== undefined) tw.writeVarintField(6, value.directionId);
  }, trip);
}

/** `StopTimeEvent` — delay 1, time 2, uncertainty 3. */
function writeStopTimeEvent(field, writer, event) {
  writer.writeMessage(field, (value, ew) => {
    // `delay` is a plain int32, so a negative one is written sign-extended
    // rather than zigzagged. Encoding it any other way would test the test.
    if (value.delay !== undefined) ew.writeVarintField(1, value.delay);
    if (value.time !== undefined) ew.writeVarintField(2, value.time);
    if (value.uncertainty !== undefined) ew.writeVarintField(3, value.uncertainty);
  }, event);
}

/** `TranslatedString` — translation 1 (repeated), each text 1 / language 2. */
function writeTranslatedString(field, writer, translations) {
  writer.writeMessage(field, (value, sw) => {
    for (const translation of value) {
      sw.writeMessage(1, (item, tw) => {
        tw.writeStringField(1, item.text);
        if (item.language) tw.writeStringField(2, item.language);
      }, translation);
    }
  }, translations);
}

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
        // TripUpdate is tag 3 — a positions pass must skip it, not mistake it
        // for a position. The body is deliberately NOT a valid TripUpdate:
        // skipping happens by wire type, so it must not depend on the content.
        writer.writeMessage(3, (_unused, w) => w.writeStringField(1, 'trip-1'), {});
        return;
      }
      if (item.tripUpdate) {
        writer.writeMessage(3, (update, w) => {
          if (update.trip) writeTripDescriptor(1, w, update.trip);
          for (const stop of update.stops || []) {
            w.writeMessage(2, (value, sw) => {
              if (value.sequence !== undefined) sw.writeVarintField(1, value.sequence);
              if (value.arrival) writeStopTimeEvent(2, sw, value.arrival);
              if (value.departure) writeStopTimeEvent(3, sw, value.departure);
              if (value.stopId) sw.writeStringField(4, value.stopId);
              if (value.scheduleRelationship !== undefined) {
                sw.writeVarintField(5, value.scheduleRelationship);
              }
            }, stop);
          }
          if (update.descriptor) {
            w.writeMessage(3, (descriptor, dw) => {
              if (descriptor.id) dw.writeStringField(1, descriptor.id);
              if (descriptor.label) dw.writeStringField(2, descriptor.label);
            }, update.descriptor);
          }
          if (update.timestamp !== undefined) w.writeVarintField(4, update.timestamp);
          if (update.delay !== undefined) w.writeVarintField(5, update.delay);
        }, item.tripUpdate);
        return;
      }
      if (item.alert) {
        writer.writeMessage(5, (alert, w) => {
          for (const period of alert.activePeriods || []) {
            w.writeMessage(1, (value, pw) => {
              if (value.start !== undefined) pw.writeVarintField(1, value.start);
              if (value.end !== undefined) pw.writeVarintField(2, value.end);
            }, period);
          }
          for (const informed of alert.informed || []) {
            w.writeMessage(5, (value, iw) => {
              if (value.agencyId) iw.writeStringField(1, value.agencyId);
              if (value.routeId) iw.writeStringField(2, value.routeId);
              if (value.routeType !== undefined) iw.writeVarintField(3, value.routeType);
              if (value.trip) writeTripDescriptor(4, iw, value.trip);
              if (value.stopId) iw.writeStringField(5, value.stopId);
              if (value.directionId !== undefined) iw.writeVarintField(6, value.directionId);
            }, informed);
          }
          if (alert.cause !== undefined) w.writeVarintField(6, alert.cause);
          if (alert.effect !== undefined) w.writeVarintField(7, alert.effect);
          if (alert.url) writeTranslatedString(8, w, alert.url);
          if (alert.header) writeTranslatedString(10, w, alert.header);
          if (alert.description) writeTranslatedString(11, w, alert.description);
          if (alert.severity !== undefined) w.writeVarintField(14, alert.severity);
        }, item.alert);
        return;
      }
      if (!item.vehicle) return;
      writer.writeMessage(4, (vehicle, w) => {
        if (vehicle.trip) writeTripDescriptor(1, w, vehicle.trip);
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

// --- TripUpdate -------------------------------------------------------------
// The second message these same 150 networks publish, and the only keyless
// answer to "how late is this bus". Its field numbers matter as much as the
// position's, and one of them — `delay` — is the single easiest thing in the
// whole schema to decode into nonsense.

test('a trip update decodes into ordered stops with their own deviations', () => {
  const bytes = encodeFeed({
    entities: [{
      id: 'tu-1',
      tripUpdate: {
        trip: { tripId: 'b_268436222_26', routeId: '07', startDate: '20260831', directionId: 1 },
        descriptor: { id: '2481', label: 'TBM 2481' },
        timestamp: 1787765200,
        stops: [
          { sequence: 6, stopId: '3790', arrival: { delay: 245, time: 1787765400 } },
          { sequence: 7, stopId: '3791', departure: { delay: 260, time: 1787765600 } },
          { sequence: 8, stopId: '3792', scheduleRelationship: 1 },
        ],
      },
    }],
  });

  const { trips, entityCount } = tripUpdatesFromBytes(bytes);
  assert.equal(entityCount, 1);
  assert.equal(trips.length, 1);
  const [trip] = trips;
  assert.equal(trip.tripId, 'b_268436222_26');
  assert.equal(trip.routeId, '07');
  assert.equal(trip.directionId, 1);
  assert.equal(trip.vehicleId, '2481');
  assert.equal(trip.timestampMs, 1787765200000);
  assert.equal(trip.stops.length, 3);
  // The ARRIVAL deviation is the one a rider waiting at the stop feels, and it
  // wins over the departure when a feed publishes both.
  assert.equal(trip.stops[0].delaySec, 245);
  assert.equal(trip.stops[0].arrivalMs, 1787765400000);
  assert.equal(trip.stops[1].delaySec, 260, 'departure is the fallback, not the default');
  assert.equal(trip.stops[2].relationship, 'skipped');
  assert.equal(trip.stops[0].relationship, null, 'SCHEDULED is not news and stays null');
});

test('a bus running EARLY decodes as early, not as 9.2 quintillion seconds late', () => {
  // `delay` is a protobuf int32, so -19 is written as a ten-byte sign-extended
  // varint. Read unsigned it comes back as 1.8e19. This is the bug the whole
  // signed read exists to prevent, so it is pinned with a real encoded body.
  const bytes = encodeFeed({
    entities: [{
      id: 'tu-early',
      tripUpdate: {
        trip: { tripId: 'trip-early' },
        stops: [{ sequence: 3, arrival: { delay: -19, time: 1787765400 } }],
      },
    }],
  });
  const [trip] = tripUpdatesFromBytes(bytes).trips;
  assert.equal(trip.stops[0].delaySec, -19);
});

test('a deviation past the plausible fence is dropped rather than printed', () => {
  const bytes = encodeFeed({
    entities: [{
      id: 'tu-junk',
      tripUpdate: {
        trip: { tripId: 'trip-junk' },
        stops: [
          { sequence: 1, arrival: { delay: MAX_PLAUSIBLE_DELAY_SEC + 1 } },
          { sequence: 2, arrival: { delay: MAX_PLAUSIBLE_DELAY_SEC } },
        ],
      },
    }],
  });
  const [trip] = tripUpdatesFromBytes(bytes).trips;
  assert.equal(trip.stops[0].delaySec, null, 'four days late is not a prediction');
  assert.equal(trip.stops[1].delaySec, MAX_PLAUSIBLE_DELAY_SEC, 'the fence itself is inclusive');
});

test('a cancelled run is read off the trip descriptor, on the update and on the position', () => {
  const fromUpdate = tripUpdatesFromBytes(encodeFeed({
    entities: [{
      id: 'tu-cancel',
      tripUpdate: { trip: { tripId: 'trip-x', scheduleRelationship: 3 }, stops: [] },
    }],
  })).trips[0];
  assert.equal(fromUpdate.relationship, 'canceled');

  const fromPosition = vehiclePositionsFromBytes(encodeFeed({
    entities: [tbmVehicle({ trip: { tripId: 'trip-x', routeId: '07', scheduleRelationship: 3 } })],
  }), { feedId: 'f' }).vehicles[0];
  // Free: no join, no second request — the position feed said it itself.
  assert.equal(fromPosition.tripRelationship, 'canceled');
});

test('a trip update with no trip id joins to nothing and is dropped', () => {
  const bytes = encodeFeed({
    entities: [{ id: 'tu-anon', tripUpdate: { trip: { routeId: '07' }, stops: [{ sequence: 1 }] } }],
  });
  assert.deepEqual(tripUpdatesFromBytes(bytes).trips, []);
});

test('stops are sorted only when EVERY entry carries a sequence', () => {
  const numbered = tripUpdatesFromBytes(encodeFeed({
    entities: [{
      id: 'tu-order',
      tripUpdate: {
        trip: { tripId: 't' },
        stops: [{ sequence: 9, stopId: 'c' }, { sequence: 2, stopId: 'a' }, { sequence: 5, stopId: 'b' }],
      },
    }],
  })).trips[0];
  assert.deepEqual(numbered.stops.map((stop) => stop.stopId), ['a', 'b', 'c']);

  const partial = tripUpdatesFromBytes(encodeFeed({
    entities: [{
      id: 'tu-partial',
      tripUpdate: {
        trip: { tripId: 't' },
        stops: [{ sequence: 9, stopId: 'c' }, { stopId: 'unnumbered' }, { sequence: 2, stopId: 'a' }],
      },
    }],
  })).trips[0];
  assert.deepEqual(
    partial.stops.map((stop) => stop.stopId),
    ['c', 'unnumbered', 'a'],
    'a partially-numbered list keeps the order the feed published',
  );
});

// --- Alert ------------------------------------------------------------------

test('an alert decodes with its French text, its scope and its effect', () => {
  const bytes = encodeFeed({
    entities: [{
      id: 'alert-1',
      alert: {
        activePeriods: [{ start: 1787700000, end: 1787800000 }],
        informed: [{ agencyId: 'BMA', routeId: '07' }, { stopId: '3790' }],
        cause: 10,
        effect: 4,
        severity: 3,
        url: [{ text: 'https://infotbm.com/perturbations', language: 'fr' }],
        header: [
          { text: 'Bordeaux : travaux quai de Paludate', language: 'fr' },
          { text: 'Bordeaux: Paludate quay works', language: 'en' },
        ],
        description: [{ text: 'Déviation par le cours Barbey.', language: 'fr' }],
      },
    }],
  });

  const { alerts } = alertsFromBytes(bytes);
  assert.equal(alerts.length, 1);
  const [alert] = alerts;
  assert.equal(alert.header, 'Bordeaux : travaux quai de Paludate', 'French wins over English');
  assert.equal(alert.description, 'Déviation par le cours Barbey.');
  assert.equal(alert.cause, 'construction');
  assert.equal(alert.effect, 'detour');
  assert.equal(alert.severity, 'warning');
  assert.equal(alert.url, 'https://infotbm.com/perturbations');
  assert.deepEqual(alert.informed[0], {
    agencyId: 'BMA', routeId: '07', routeType: null, tripId: null, stopId: null, directionId: null,
  });
  assert.equal(alert.activePeriods[0].startMs, 1787700000000);
});

test('an untagged translation is used before an arbitrary one', () => {
  assert.equal(translatedText({ translations: [{ text: 'sans langue' }] }), 'sans langue');
  assert.equal(
    translatedText({ translations: [{ text: 'de', language: 'de' }, { text: 'brut' }] }),
    'brut',
  );
  assert.equal(translatedText({ translations: [] }), null);
  assert.equal(translatedText(null), null);
});

test('an alert that informs nothing, or says nothing, is not an alert', () => {
  const { alerts } = alertsFromBytes(encodeFeed({
    entities: [
      { id: 'a-noentity', alert: { header: [{ text: 'about what?' }], informed: [] } },
      { id: 'a-notext', alert: { informed: [{ routeId: '07' }] } },
    ],
  }));
  assert.deepEqual(alerts, []);
});

test('an alert with no active period is in force; one with a window is not always', () => {
  const always = { activePeriods: [] };
  assert.equal(alertIsActive(always, 1787765165000), true);
  const windowed = { activePeriods: [{ startMs: 1787700000000, endMs: 1787800000000 }] };
  assert.equal(alertIsActive(windowed, 1787765165000), true);
  assert.equal(alertIsActive(windowed, 1787600000000), false);
  assert.equal(alertIsActive(windowed, 1787900000000), false);
  // Half-open in the direction it names.
  assert.equal(alertIsActive({ activePeriods: [{ startMs: null, endMs: 1787800000000 }] }, 1000), true);
});

// --- One entity type per pass ----------------------------------------------

test('each decoder reads only its own entity type out of a shared body', () => {
  // 63 French feeds publish all three types under one resource id. Reading one
  // must not depend on — or be broken by — the other two.
  const bytes = encodeFeed({
    entities: [
      tbmVehicle(),
      {
        id: 'tu-1',
        tripUpdate: {
          trip: { tripId: 'b_268436222_26' },
          stops: [{ sequence: 6, arrival: { delay: 120 } }],
        },
      },
      {
        id: 'alert-1',
        alert: { informed: [{ routeId: '07' }], header: [{ text: 'Grève' }], cause: 4 },
      },
    ],
  });

  assert.deepEqual(
    vehiclePositionsFromBytes(bytes, { feedId: 'f' }).vehicles.map((v) => v.id),
    ['f:2481'],
  );
  assert.deepEqual(tripUpdatesFromBytes(bytes).trips.map((t) => t.tripId), ['b_268436222_26']);
  assert.deepEqual(alertsFromBytes(bytes).alerts.map((a) => a.cause), ['strike']);

  // And the pass that was not asked for never even builds the member.
  const positionsOnly = decodeFeedMessage(bytes, { want: 'vehicle' });
  assert.equal(positionsOnly.entities[1].tripUpdate, undefined);
  assert.equal(positionsOnly.entities[2].alert, undefined);
  assert.equal(decodeFeedMessage(bytes).entities[1].tripUpdate.tripId, 'b_268436222_26');
});
