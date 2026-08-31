// The drawn run's presentation contract.
//
// Everything here is about what a person is entitled to read off the screen:
// the stop the vehicle is ACTUALLY heading for (the operator says so, in
// `current_stop_sequence` — not "the first one whose predicted time has not
// passed", which is a different and weaker answer), a countdown in the units a
// rider uses, and silence where the feed published nothing rather than a zero
// that reads as "on time, now".
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nextStopIndex,
  routeReadout,
  stopDelayLabel,
  stopEtaLabel,
  stopLabelPriority,
  traceColor,
  transitRouteCardLines,
} from './transitRouteView.js';

const NOW = Date.UTC(2026, 7, 31, 18, 40, 0);

/** A three-stop run: one served, one being approached, one to come. */
function run(overrides = {}) {
  return {
    route: { id: '07', shortName: '7', longName: 'Lianes 7', color: '#00b1eb', variantCount: 6 },
    trip: { id: 'b_268436334_31', headsign: 'AMBARES PARABELLE' },
    shapeMatch: { matched: true, variants: 6, maxDeviationM: 12, medianDeviationM: 1 },
    stopsReported: 3,
    stops: [
      { id: '7451', name: 'Centre Commercial du Lac', sequence: 1, arrivalMs: NOW - 300_000, delaySec: -664 },
      { id: '7441', name: 'Lavignolle', sequence: 2, arrivalMs: NOW + 180_000, delaySec: 48 },
      { id: '5650', name: 'Parabelle', sequence: 3, arrivalMs: NOW + 900_000, delaySec: 85 },
    ],
    ...overrides,
  };
}

test('the approached stop is the one the operator says, not the next unexpired time', () => {
  const stops = run().stops;
  // The vehicle reports it is at/heading for sequence 2. That is the answer,
  // and it stays the answer even when the prediction for stop 2 has slipped
  // into the past — which is exactly when a bus is late.
  assert.equal(nextStopIndex(stops, { vehicleStopSequence: 2, nowMs: NOW }), 1);
  const late = [
    { ...stops[0] },
    { ...stops[1], arrivalMs: NOW - 60_000 },
    { ...stops[2] },
  ];
  assert.equal(nextStopIndex(late, { vehicleStopSequence: 2, nowMs: NOW }), 1);
  // Without a reported sequence, the first prediction still ahead is the only
  // evidence there is.
  assert.equal(nextStopIndex(late, { nowMs: NOW }), 2);
});

test('a run with nothing ahead of it reports no next stop rather than the last one', () => {
  const finished = run().stops.map((stop) => ({ ...stop, arrivalMs: NOW - 600_000 }));
  assert.equal(nextStopIndex(finished, { nowMs: NOW }), -1);
  assert.equal(nextStopIndex([], { nowMs: NOW }), -1);
});

test('an arrival is counted down in minutes, and a passed one is due', () => {
  assert.equal(stopEtaLabel({ arrivalMs: NOW + 180_000 }, NOW), '3 min');
  assert.equal(stopEtaLabel({ arrivalMs: NOW + 61_000 }, NOW), '1 min');
  assert.equal(stopEtaLabel({ arrivalMs: NOW - 10_000 }, NOW), 'due');
  assert.equal(stopEtaLabel({ arrivalMs: NOW + 3_900_000 }, NOW), '1 h 05');
  // Departure is the fallback for a feed that publishes only one event.
  assert.equal(stopEtaLabel({ departureMs: NOW + 120_000 }, NOW), '2 min');
  // No published time is no time. Never "0 min", which reads as "now".
  assert.equal(stopEtaLabel({}, NOW), null);
});

test('a schedule deviation is printed in the operator\'s sign, and only when published', () => {
  assert.equal(stopDelayLabel({ delaySec: 85 }), '1 min late');
  assert.equal(stopDelayLabel({ delaySec: -664 }), '11 min early');
  assert.equal(stopDelayLabel({ delaySec: 12 }), 'on time');
  // Unpublished is not on time, and does not print as it.
  assert.equal(stopDelayLabel({}), null);
  assert.equal(stopDelayLabel({ delaySec: null }), null);
});

test('the label cohort keeps the approached stop, the terminus and the vehicle\'s stretch', () => {
  const count = 56;
  const next = 20;
  const priorities = Array.from({ length: count }, (_unused, i) => stopLabelPriority(i, count, next));
  const ranked = priorities
    .map((priority, index) => ({ priority, index }))
    .sort((a, b) => b.priority - a.priority)
    .map((entry) => entry.index);

  assert.equal(ranked[0], next);
  assert.equal(ranked[1], count - 1);
  assert.equal(ranked[2], 0);
  // Then outward from the vehicle, so a 56-stop run labels the part of itself
  // the bus is in.
  assert.ok(Math.abs(ranked[3] - next) <= 1);
  assert.ok(Math.abs(ranked[4] - next) <= 1);
});

test('the card names the line, where it is going next, and how far is left', () => {
  const lines = transitRouteCardLines(run(), { vehicleStopSequence: 2, nowMs: NOW });
  assert.deepEqual(lines, [
    '▸ Lavignolle · 3 min · 1 min late',
    '⇥ Parabelle · 2 stops',
  ]);
  // Nothing to say before the answer arrives — no placeholder to flicker.
  assert.deepEqual(transitRouteCardLines(null), []);
});

test('a run whose stops cannot be placed says which feed fell short', () => {
  const lines = transitRouteCardLines(
    run({ stops: [], stopsReported: 41 }),
    { nowMs: NOW },
  );
  assert.deepEqual(lines, ['⇥ 41 stops published, none in the static feed']);
});

test('a whole line drawn instead of one run says so on the card', () => {
  const lines = transitRouteCardLines(
    run({ shapeMatch: { matched: false, variants: 6, maxDeviationM: 830, medianDeviationM: 4 } }),
    { vehicleStopSequence: 2, nowMs: NOW },
  );
  assert.ok(lines.includes('⌁ whole line drawn (6 variants published)'));
  // A single-variant line has nothing to disclaim: there was no choice to make.
  const single = transitRouteCardLines(
    run({ shapeMatch: { matched: false, variants: 1, maxDeviationM: 830, medianDeviationM: 4 } }),
    { vehicleStopSequence: 2, nowMs: NOW },
  );
  assert.ok(!single.some((line) => line.startsWith('⌁')));
});

test('the line name and colour are the operator\'s, and absence is not invented', () => {
  assert.deepEqual(routeReadout(run()), { short: '7', long: 'Lianes 7', color: '#00b1eb' });
  assert.equal(traceColor(run()), '#00b1eb');
  // No published colour: the vehicle's own class tint stands rather than a
  // colour that would look as official as an operator's.
  const uncoloured = run({ route: { id: '07', shortName: null, longName: null, color: null } });
  assert.equal(traceColor(uncoloured, '#7ee787'), '#7ee787');
  // And with no static answer at all, the vehicle feed's own label stands.
  assert.deepEqual(routeReadout(null, '07'), { short: '07', long: null, color: null });
});
