// The service-day arithmetic, run against schedules built here rather than
// downloaded.
//
// This is the half of the GTFS-RT chiffrage that nothing else can catch: every
// storage figure in `docs/CHRONIQUE-GTFS-RT.md` is a measured rate multiplied
// by what this function returns, so a wrong service day is a wrong year, and it
// would be wrong quietly — the tables would still add up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeServiceDay, csvRows, seconds } from './measure-gtfs-service-day.mjs';

const buffer = (text) => Buffer.from(text, 'utf8');

/** A two-line network: a day service and one that only runs past midnight. */
function schedule({ calendar, calendarDates, trips, stopTimes }) {
  return {
    calendar: calendar == null ? null : buffer(calendar),
    calendarDates: calendarDates == null ? null : buffer(calendarDates),
    trips: buffer(trips),
    stopTimes: buffer(stopTimes),
  };
}

const MONDAY = '20260907';

test('a service declared for the weekday, inside its validity window, runs', () => {
  const day = computeServiceDay(schedule({
    calendar: 'service_id,monday,tuesday,start_date,end_date\nS1,1,1,20260101,20261231\n'
      + 'S2,0,1,20260101,20261231\n',
    trips: 'trip_id,service_id,route_id\nT1,S1,L1\nT2,S2,L1\n',
    stopTimes: 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n'
      + 'T1,17:10:00,17:10:00,A,1\nT1,17:50:00,17:50:00,B,2\n'
      + 'T2,17:10:00,17:10:00,A,1\n',
  }), { date: MONDAY, refHour: 17 });

  assert.equal(day.weekday, 'monday');
  assert.equal(day.services, 1);
  assert.equal(day.trips, 1, 'the Tuesday-only trip must not be counted');
  assert.equal(day.passages, 2);
  assert.equal(day.atRef, 1);
});

test('a window that has closed excludes the service, whatever the weekday says', () => {
  const day = computeServiceDay(schedule({
    calendar: 'service_id,monday,start_date,end_date\nS1,1,20250101,20250601\n',
    trips: 'trip_id,service_id\nT1,S1\n',
    stopTimes: 'trip_id,departure_time,stop_id\nT1,17:00:00,A\n',
  }), { date: MONDAY, refHour: 17 });
  assert.equal(day.trips, 0);
  assert.equal(day.vehicleHoursPerRefVehicle, null, 'no fleet at the reference hour, no ratio');
});

test('calendar_dates adds and removes services the calendar never mentions', () => {
  // Not an edge case: 165 of Angers Irigo's services are declared only there,
  // and a reader that skips the file sizes that network at zero.
  const day = computeServiceDay(schedule({
    calendar: 'service_id,monday,start_date,end_date\nS1,1,20260101,20261231\n',
    calendarDates: `service_id,date,exception_type\nS2,${MONDAY},1\nS1,${MONDAY},2\n`,
    trips: 'trip_id,service_id\nT1,S1\nT2,S2\n',
    stopTimes: 'trip_id,departure_time,stop_id\nT1,17:10:00,A\nT2,17:10:00,A\nT2,17:50:00,B\n',
  }), { date: MONDAY, refHour: 17 });

  assert.equal(day.services, 1);
  assert.equal(day.trips, 1);
  assert.equal(day.passages, 2, 'only the added service, and both of its stops');
});

test('an exception dated some other day changes nothing', () => {
  const day = computeServiceDay(schedule({
    calendar: 'service_id,monday,start_date,end_date\nS1,1,20260101,20261231\n',
    calendarDates: 'service_id,date,exception_type\nS1,20260908,2\n',
    trips: 'trip_id,service_id\nT1,S1\n',
    stopTimes: 'trip_id,departure_time,stop_id\nT1,17:00:00,A\n',
  }), { date: MONDAY, refHour: 17 });
  assert.equal(day.trips, 1);
});

test('a trip that runs past midnight is a vehicle after midnight, not a vehicle at zero', () => {
  // GTFS writes 25:40:00 for 01 h 40 the next morning. Folding that back into
  // hour 1 by arithmetic on 24 would put a night bus in the morning peak.
  const day = computeServiceDay(schedule({
    calendar: 'service_id,monday,start_date,end_date\nS1,1,20260101,20261231\n',
    trips: 'trip_id,service_id\nT1,S1\n',
    stopTimes: 'trip_id,departure_time,stop_id\nT1,24:10:00,A\nT1,25:40:00,B\n',
  }), { date: MONDAY, refHour: 17 });

  assert.equal(day.perHour.length, 30);
  assert.equal(day.perHour[24], 1, 'in service at 00 h 30 of the next day');
  assert.equal(day.perHour[25], 1, 'and still at 01 h 30');
  assert.equal(day.perHour[1], 0, 'but not at 01 h 30 of the SAME morning');
  assert.equal(day.vehicleHours, 2);
});

test('the two ratios are the day divided by the reference hour', () => {
  const day = computeServiceDay(schedule({
    calendar: 'service_id,monday,start_date,end_date\nS1,1,20260101,20261231\n',
    trips: 'trip_id,service_id\nT1,S1\nT2,S1\n',
    // T1 spans 07 h → 18 h (11 hourly midpoints, 07 h 30 through 17 h 30),
    // T2 covers only the 17 h 30 one.
    stopTimes: 'trip_id,departure_time,stop_id\n'
      + 'T1,07:00:00,A\nT1,18:00:00,B\nT2,17:20:00,A\nT2,17:40:00,B\n',
  }), { date: MONDAY, refHour: 17 });

  assert.equal(day.atRef, 2, 'both trips cover 17 h 30');
  assert.equal(day.passages, 4);
  assert.equal(day.vehicleHours, 12, '11 hours of T1 plus 1 of T2');
  assert.equal(day.vehicleHoursPerRefVehicle, 6);
  assert.equal(day.passagesPerRefVehicle, 2);
  assert.deepEqual(day.peak, { hour: 17, count: 2 });
});

test('a row without a usable time is skipped, not counted as midnight', () => {
  const day = computeServiceDay(schedule({
    calendar: 'service_id,monday,start_date,end_date\nS1,1,20260101,20261231\n',
    trips: 'trip_id,service_id\nT1,S1\n',
    stopTimes: 'trip_id,arrival_time,departure_time,stop_id\n'
      + 'T1,,,A\nT1,17:00:00,17:00:00,B\n',
  }), { date: MONDAY, refHour: 17 });
  assert.equal(day.passages, 1);
});

test('arrival_time carries the row when departure_time is blank', () => {
  const day = computeServiceDay(schedule({
    calendar: 'service_id,monday,start_date,end_date\nS1,1,20260101,20261231\n',
    trips: 'trip_id,service_id\nT1,S1\n',
    stopTimes: 'trip_id,arrival_time,departure_time,stop_id\n'
      + 'T1,17:10:00,,A\nT1,17:50:00,,B\n',
  }), { date: MONDAY, refHour: 17 });
  assert.equal(day.passages, 2);
  assert.equal(day.atRef, 1);
});

test('the hourly count is an instant, not an integral — and says so', () => {
  // A trip that begins and ends between two hourly midpoints is in service for
  // no hour at all. That is the intended meaning: the number compared against
  // the national index is "vehicles a probe would see at HH:30", the same thing
  // a feed reports, and not vehicle-minutes. Measured against reality it holds
  // — TBM's schedule says 530 trips at 17 h 30, the live feed reported 515.
  const day = computeServiceDay(schedule({
    calendar: 'service_id,monday,start_date,end_date\nS1,1,20260101,20261231\n',
    trips: 'trip_id,service_id\nT1,S1\n',
    stopTimes: 'trip_id,departure_time,stop_id\nT1,17:35:00,A\nT1,17:55:00,B\n',
  }), { date: MONDAY, refHour: 17 });
  assert.equal(day.trips, 1);
  assert.equal(day.passages, 2);
  assert.equal(day.vehicleHours, 0);
  assert.equal(day.atRef, 0);
});

test('a quoted comma does not shift the columns behind it', () => {
  const rows = [...csvRows(buffer('trip_id,headsign,service_id\nT1,"Gare, centre",S1\n'))];
  assert.deepEqual(rows[0], { trip_id: 'T1', headsign: 'Gare, centre', service_id: 'S1' });
});

test('a byte-order mark does not rename the first column', () => {
  const rows = [...csvRows(Buffer.from('﻿service_id,monday\nS1,1\n', 'utf8'))];
  assert.equal(rows[0].service_id, 'S1');
});

test('seconds reads past 24 h and refuses what is not a time', () => {
  assert.equal(seconds('00:00:00'), 0);
  assert.equal(seconds('25:40:00'), 25 * 3600 + 40 * 60);
  assert.equal(seconds(''), null);
  assert.equal(seconds('17:00'), null);
  assert.equal(seconds(undefined), null);
});
