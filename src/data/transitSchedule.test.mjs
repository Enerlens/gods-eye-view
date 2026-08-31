// The rules that turn two more GTFS-Realtime messages into a sentence about a
// bus already on screen. Three of them are load-bearing and easy to get
// subtly wrong, so they are pinned here with the shapes the French feeds
// actually publish:
//
//   - WHICH stop a deviation is read at, because the trip carries dozens and
//     only one of them describes where this vehicle is.
//   - The LAYOVER rule, without which a bus parked at its terminus waiting for
//     a departure an hour away is reported as an hour early.
//   - The alert SCOPE, because "your bus is diverted" and "this line is
//     diverted somewhere today" are different claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alertForVehicle,
  alertRank,
  alertWireRecord,
  awaitingDeparture,
  formatDelay,
  indexAlerts,
  indexTripUpdates,
  matchTripUpdate,
  nextStop,
  punctuality,
  scheduleForVehicle,
  skippedStops,
  summarizeSchedule,
  tripDelay,
  vehicleLocalId,
  EARLY_THRESHOLD_SEC,
  LATE_THRESHOLD_SEC,
} from './transitSchedule.js';

const NOW = 1787765165000;

/** A trip update shaped like the ones `tripUpdateFromEntity` returns. */
function trip(overrides = {}) {
  return {
    tripId: 'b_268436222_26',
    relationship: null,
    routeId: '07',
    directionId: 0,
    startDate: '20260831',
    startTime: null,
    vehicleId: '2481',
    vehicleLabel: null,
    timestampMs: NOW - 20_000,
    delaySec: null,
    stops: [],
    ...overrides,
  };
}

function stop(sequence, { delay = null, at = null, relationship = null, id = null } = {}) {
  return {
    sequence,
    stopId: id ?? `stop-${sequence}`,
    arrivalMs: at,
    departureMs: null,
    delaySec: delay,
    relationship,
  };
}

/** A vehicle shaped like the ones `vehicleFromEntity` returns. */
function vehicle(overrides = {}) {
  return {
    id: 'pan-83026:2481',
    feedId: 'pan-83026',
    lat: 44.8378,
    lon: -0.5792,
    routeId: '07',
    tripId: 'b_268436222_26',
    stopSequence: 6,
    status: 'in-transit',
    tripRelationship: null,
    ...overrides,
  };
}

// --- Punctuality bands ------------------------------------------------------

test('the bands are the operators\' own, and the printed text never contradicts them', () => {
  assert.equal(punctuality(null), null);
  assert.equal(punctuality(0), 'on-time');
  assert.equal(punctuality(EARLY_THRESHOLD_SEC), 'early');
  assert.equal(punctuality(EARLY_THRESHOLD_SEC + 1), 'on-time');
  assert.equal(punctuality(LATE_THRESHOLD_SEC), 'late');
  assert.equal(punctuality(LATE_THRESHOLD_SEC - 1), 'on-time');

  // 90 seconds rounds to "2 min", which would read as lateness beside a
  // summary counting it as on time. The band decides the sentence.
  assert.equal(formatDelay(90), 'on time');
  assert.equal(formatDelay(245), '4 min late');
  assert.equal(formatDelay(-125), '2 min early');
  assert.equal(formatDelay(-61), '1 min early', 'never rounds a real deviation down to zero');
  assert.equal(formatDelay(null), null);
});

// --- Joining a vehicle to its run -------------------------------------------

test('the join is by trip id, and falls back to the vehicle id the operator published', () => {
  const index = indexTripUpdates([
    trip({ tripId: 'other-run', vehicleId: '9999' }),
    trip(),
  ]);
  assert.equal(matchTripUpdate(vehicle(), index).matchedBy, 'trip');

  // TANGO publishes 23 vehicles whose trip ids appear in none of its own trip
  // updates; every one of them matches on the vehicle id instead.
  const strayTrip = vehicle({ tripId: 'a-trip-nobody-published' });
  const fallback = matchTripUpdate(strayTrip, index);
  assert.equal(fallback.matchedBy, 'vehicle');
  assert.equal(fallback.trip.tripId, 'b_268436222_26');

  assert.equal(matchTripUpdate(vehicle({ tripId: null, id: 'pan-83026:nope' }), index), null);
});

test('the vehicle id is joined bare, without the feed prefix the decoder adds', () => {
  assert.equal(vehicleLocalId(vehicle()), '2481');
  assert.equal(vehicleLocalId({ id: '2481', feedId: null }), '2481');
  // A colon inside the operator's own id is not a prefix boundary.
  assert.equal(vehicleLocalId({ id: 'pan-83026:ineo-bus:1419', feedId: 'pan-83026' }), 'ineo-bus:1419');
});

test('a repeated trip id keeps the first entity, which the spec makes canonical', () => {
  const index = indexTripUpdates([
    trip({ stops: [stop(1, { delay: 10 })] }),
    trip({ stops: [stop(1, { delay: 900 })] }),
  ]);
  assert.equal(index.byTrip.get('b_268436222_26').stops[0].delaySec, 10);
});

// --- Which stop the deviation is read at ------------------------------------

test('the deviation is read at the stop the vehicle is heading for', () => {
  const run = trip({
    stops: [
      stop(3, { delay: 30, at: NOW - 600_000 }),
      stop(6, { delay: 245, at: NOW + 120_000 }),
      stop(9, { delay: 300, at: NOW + 400_000 }),
    ],
  });
  assert.deepEqual(
    tripDelay(run, { stopSequence: 6, nowMs: NOW }),
    { delaySec: 245, from: 'current-stop' },
  );
  // Half the fleet publishes no `current_stop_sequence`; the first stop still
  // in the future is the next best statement about where it is.
  assert.deepEqual(tripDelay(run, { nowMs: NOW }), { delaySec: 245, from: 'ahead' });
});

test('a run whose every prediction is in the past reports its last measurement, and says so', () => {
  const run = trip({
    stops: [stop(1, { delay: 60, at: NOW - 900_000 }), stop(2, { delay: 190, at: NOW - 300_000 })],
  });
  assert.deepEqual(tripDelay(run, { nowMs: NOW }), { delaySec: 190, from: 'behind' });
});

test('the trip-level delay is the last resort, not the first', () => {
  const both = trip({ delaySec: 600, stops: [stop(6, { delay: 120, at: NOW + 60_000 })] });
  assert.equal(tripDelay(both, { stopSequence: 6, nowMs: NOW }).delaySec, 120);
  const only = trip({ delaySec: 600, stops: [stop(6)] });
  assert.deepEqual(tripDelay(only, { nowMs: NOW }), { delaySec: 600, from: 'trip' });
  assert.equal(tripDelay(trip(), { nowMs: NOW }), null);
});

// --- Layover ----------------------------------------------------------------

test('a bus parked at its terminus is waiting, not fifty-six minutes early', () => {
  const run = trip({ stops: [stop(1, { delay: -3361, at: NOW - 23_000 }), stop(2)] });
  const parked = vehicle({ stopSequence: 1, status: 'stopped' });
  assert.equal(awaitingDeparture(parked, run, -3361), true);

  const state = scheduleForVehicle(parked, indexTripUpdates([run]), { nowMs: NOW });
  assert.equal(state.awaitingDeparture, true);
  assert.equal(state.delaySec, undefined, 'no punctuality claim is made about a layover');
  // Predicted time at the stop, less the deviation, is the departure it waits for.
  assert.equal(state.scheduledDepartureMs, NOW - 23_000 + 3361 * 1000);
});

test('the layover rule is one-sided: an overdue departure is real lateness', () => {
  const run = trip({ stops: [stop(1, { delay: 240, at: NOW + 10_000 })] });
  const atFirstStop = vehicle({ stopSequence: 1, status: 'stopped' });
  assert.equal(awaitingDeparture(atFirstStop, run, 240), false);
  const state = scheduleForVehicle(atFirstStop, indexTripUpdates([run]), { nowMs: NOW });
  assert.equal(state.delaySec, 240);
  assert.equal(state.awaitingDeparture, undefined);
});

test('a vehicle already moving through its run is never on layover', () => {
  const run = trip({ stops: [stop(1, { delay: -3361 }), stop(8, { delay: -3361 })] });
  assert.equal(awaitingDeparture(vehicle({ stopSequence: 8, status: 'in-transit' }), run, -3361), false);
  assert.equal(awaitingDeparture(vehicle({ stopSequence: 1, status: 'in-transit' }), run, -3361), false);
  // And a deviation inside the on-time band is not reclassified either.
  assert.equal(awaitingDeparture(vehicle({ stopSequence: 1, status: 'stopped' }), run, -30), false);
});

// --- Skipped stops ----------------------------------------------------------

test('skipped stops are only called "ahead" when both sides numbered their stops', () => {
  const run = trip({
    stops: [stop(2, { relationship: 'skipped' }), stop(7, { relationship: 'skipped' }), stop(9)],
  });
  assert.deepEqual(skippedStops(run, 6), { count: 1, ahead: true });
  assert.deepEqual(skippedStops(run, null), { count: 2, ahead: false });
  assert.deepEqual(skippedStops(trip(), 6), { count: 0, ahead: false });

  const unnumbered = trip({ stops: [{ ...stop(0, { relationship: 'skipped' }), sequence: null }] });
  assert.deepEqual(skippedStops(unnumbered, 6), { count: 1, ahead: false });
});

// --- The whole record -------------------------------------------------------

test('one vehicle, everything its operator said about the run it is on', () => {
  const run = trip({
    relationship: null,
    stops: [
      stop(3, { delay: 30, at: NOW - 300_000 }),
      stop(6, { delay: 245, at: NOW + 120_000 }),
      stop(8, { relationship: 'skipped' }),
    ],
  });
  const state = scheduleForVehicle(vehicle(), indexTripUpdates([run]), { nowMs: NOW });
  assert.deepEqual(state, {
    matchedBy: 'trip',
    delaySec: 245,
    delayFrom: 'current-stop',
    skippedStops: 1,
    skippedAhead: true,
    nextStopEtaMs: NOW + 120_000,
    nextStopId: 'stop-6',
    predictedAtMs: NOW - 20_000,
  });
  assert.equal(nextStop(run, { stopSequence: 6, nowMs: NOW }).stopId, 'stop-6');
});

test('a cancellation on the position alone is still a cancellation', () => {
  // No trip update joined, no second request made: the position feed's own
  // TripDescriptor said it.
  const state = scheduleForVehicle(
    vehicle({ tripRelationship: 'canceled', tripId: 'unjoinable' }),
    indexTripUpdates([]),
    { nowMs: NOW },
  );
  assert.deepEqual(state, { tripState: 'canceled', matchedBy: null });
  assert.equal(scheduleForVehicle(vehicle({ tripId: 'unjoinable' }), indexTripUpdates([])), null);
});

test('the trip update outranks the position when both name a state', () => {
  const run = trip({ relationship: 'canceled' });
  const state = scheduleForVehicle(
    vehicle({ tripRelationship: 'added' }),
    indexTripUpdates([run]),
    { nowMs: NOW },
  );
  assert.equal(state.tripState, 'canceled');
});

// --- Alerts -----------------------------------------------------------------

function alert(overrides = {}) {
  return {
    id: 'a1',
    header: 'Travaux quai de Paludate',
    description: null,
    url: null,
    cause: 'construction',
    effect: 'detour',
    severity: null,
    activePeriods: [],
    informed: [{ agencyId: null, routeId: '07', routeType: null, tripId: null, stopId: null, directionId: null }],
    ...overrides,
  };
}

test('an alert is indexed by everything it informs, and network-wide ones stay apart', () => {
  const networkWide = alert({
    id: 'a-net',
    header: 'Grève nationale',
    informed: [{ agencyId: 'BMA', routeId: null, routeType: null, tripId: null, stopId: null, directionId: null }],
  });
  const index = indexAlerts([alert(), networkWide]);
  assert.deepEqual([...index.byRoute.keys()], ['07']);
  assert.equal(index.network.length, 1);
  assert.equal(index.count, 2);
});

test('alerts outside their active window are not in force', () => {
  const expired = alert({ id: 'a-old', activePeriods: [{ startMs: 1, endMs: 2 }] });
  const isActive = (entry, nowMs) => entry.activePeriods.every(
    (period) => nowMs >= (period.startMs ?? -Infinity) && nowMs <= (period.endMs ?? Infinity),
  );
  const index = indexAlerts([alert(), expired], { nowMs: NOW, isActive });
  assert.equal(index.count, 1);
});

test('the most specific scope wins, and the worst alert inside it', () => {
  const mild = alert({ id: 'mild', effect: 'accessibility issue', header: 'Ascenseur en panne' });
  const severe = alert({ id: 'severe', effect: 'no service', header: 'Ligne interrompue' });
  const thisRun = alert({
    id: 'run',
    header: 'Ce service est dévié',
    effect: 'detour',
    informed: [{ agencyId: null, routeId: null, routeType: null, tripId: 'b_268436222_26', stopId: null, directionId: null }],
  });

  const routeOnly = alertForVehicle(vehicle(), indexAlerts([mild, severe]));
  assert.equal(routeOnly.scope, 'route');
  assert.equal(routeOnly.alert.id, 'severe');
  assert.equal(routeOnly.count, 2, 'the card names one and says how many more there are');

  const withRun = alertForVehicle(vehicle(), indexAlerts([mild, severe, thisRun]));
  assert.equal(withRun.scope, 'trip', 'a notice about THIS run beats one about its line');
  assert.equal(withRun.alert.id, 'run');
  assert.equal(withRun.count, 3);

  assert.equal(alertForVehicle(vehicle({ routeId: 'X', tripId: 'Y' }), indexAlerts([mild])), null);
});

test('severity outranks effect, because a publisher that set one meant it', () => {
  assert.ok(alertRank({ severity: 'severe', effect: 'no effect' }) > alertRank({ severity: null, effect: 'no service' }));
  assert.ok(alertRank({ effect: 'no service' }) > alertRank({ effect: 'detour' }));
  assert.equal(alertRank({}), 0);
});

test('the wire record carries the scope and drops the essay', () => {
  const record = alertWireRecord(
    alert({ description: 'Trois paragraphes de consignes voyageurs.', url: 'https://x', severity: 'warning' }),
    'route',
  );
  assert.deepEqual(record, {
    scope: 'route',
    text: 'Travaux quai de Paludate',
    effect: 'detour',
    cause: 'construction',
    severity: 'warning',
    url: 'https://x',
  });
});

// --- Fleet summary ----------------------------------------------------------

test('the summary names what nobody published instead of counting it as on time', () => {
  const tally = summarizeSchedule([
    { delaySec: 245 },
    { delaySec: 600, tripState: 'canceled' },
    { delaySec: -120 },
    { delaySec: 30 },
    { awaitingDeparture: true },
    { skippedStops: 2 },
    { alert: { scope: 'route', text: 'x' } },
    {},
  ]);
  assert.deepEqual(tally, {
    late: 2, early: 1, onTime: 1, unknown: 4, waiting: 1, canceled: 1, skipped: 1, alerted: 1,
  });
  assert.deepEqual(summarizeSchedule(null), {
    late: 0, early: 0, onTime: 0, unknown: 0, waiting: 0, canceled: 0, skipped: 0, alerted: 0,
  });
});
