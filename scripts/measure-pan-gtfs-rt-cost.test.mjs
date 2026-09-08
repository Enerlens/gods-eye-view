// The projection that turns one measured sweep into a year.
//
// The measurement half needs 150 live feeds and cannot be tested offline; this
// half is the arithmetic every figure in `docs/CHRONIQUE-GTFS-RT.md` is quoted
// from, and it has exactly the failure mode the unit-test roots exist for — a
// wrong number that reads perfectly well.
import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetFromReport } from './measure-pan-gtfs-rt-cost.mjs';

const GB = 1024 ** 3;

/**
 * A report shaped like the real one: two feeds, one of them asleep.
 *
 * The numbers are round rather than realistic — the point is which term moves
 * when an input moves, not whether the total matches Monday night.
 */
function report({
  interval = 30, vehicles = 100, alerts = 0, gzBytes = 10_000,
  rounds = [{ round: 0, vehicles: 100, moved: 100 }, { round: 1, vehicles: 100, moved: 50 }],
  companions = [],
  companionWeight = null,
} = {}) {
  return {
    measuredAt: '2026-09-07T20:09:46.479Z',
    args: { interval },
    inventory: [
      { ok: true, gzBytes, read: { vehicleCount: vehicles, alertCount: alerts, stopTimeUpdates: 0 } },
      // A feed that failed carries no body and must not enter any total.
      { ok: false, gzBytes: 0, read: null },
    ],
    positionWeight: { records: 1000, ndjson: 150_000, gz: 25_000 },
    companionWeight,
    companions,
    rounds,
  };
}

test('only feeds that answered are counted, in both the fleet and the bytes', () => {
  const budget = budgetFromReport(report({ vehicles: 100, gzBytes: 10_000 }));
  assert.equal(budget.feeds, 1);
  assert.equal(budget.fleet, 100);
  assert.equal(budget.sweepGz, 10_000);
});

test('halving the cadence doubles everything that is paid per sweep', () => {
  const budget = budgetFromReport(report(), { cadences: [30, 60] });
  const [fast, slow] = budget.rows;
  assert.equal(fast.requestsPerDay, 2 * slow.requestsPerDay);
  assert.equal(fast.positionsPerYear, 2 * slow.positionsPerYear);
  assert.ok(Math.abs(fast.ingressPerYear - 2 * slow.ingressPerYear) < 1);
});

test('an empty fleet still costs a full night of framing and headers', () => {
  // The half of the model that does not follow the fleet. A France asleep is
  // not a France free: 15-byte bodies, and an HTTP header on each of them.
  const budget = budgetFromReport(report({ vehicles: 0, gzBytes: 35 }), { cadences: [60] });
  assert.equal(budget.variableGz, 0);
  const [row] = budget.rows;
  assert.equal(Math.round(row.bodiesPerYear), Math.round(1440 * 35 * 365));
  assert.ok(row.ingressPerYear > 20 * row.bodiesPerYear,
    'the header dwarfs an empty protobuf body');
});

test('the alerts are the part of a night sweep that the hour does not thin out', () => {
  const quiet = budgetFromReport(report({ alerts: 0, gzBytes: 10_000 }));
  const noisy = budgetFromReport(report({ alerts: 10, gzBytes: 10_000 }));
  assert.equal(quiet.fixedGz, 35);
  assert.equal(noisy.fixedGz, 35 + 10 * 812);
  assert.ok(noisy.variableGz < quiet.variableGz, 'the same body, less of it attributed to the fleet');
});

test('two reports at two hours fit the line; one report can only guess', () => {
  // The correction that a second measurement forced. A single sweep has to
  // charge everything but framing and alerts to the fleet; measured at 22 h and
  // again at 09 h, the real line came out at 157 Ko + 59 o per vehicle, and the
  // guess had overstated the year's ingress by 40 %.
  const evening = report({ vehicles: 1000, gzBytes: 200_000 });
  const morning = report({ vehicles: 5000, gzBytes: 400_000 });

  const alone = budgetFromReport(morning, { cadences: [30] });
  assert.equal(alone.fitted, false);
  assert.equal(alone.fixedGz, 35, 'one feed of framing, no alerts');

  const fitted = budgetFromReport(morning, { reference: evening, cadences: [30] });
  assert.equal(fitted.fitted, true);
  assert.equal(fitted.slopeGz, 50);
  assert.equal(fitted.fixedGz, 150_000);

  // The property that matters: the fitted line reproduces the OTHER hour it was
  // never told about, and the single-sweep split does not come close.
  const predict = (budget, fleet) => budget.fixedGz + (budget.fitted
    ? budget.slopeGz * fleet
    : budget.variableGz * (fleet / budget.fleet));
  assert.equal(predict(fitted, 1000), 200_000, 'exactly the evening sweep');
  assert.ok(predict(alone, 1000) < 100_000, 'the guess loses half the evening sweep');
});

test('a reference taken at the same fleet is refused rather than divided by', () => {
  const twin = report({ vehicles: 100, gzBytes: 11_000 });
  const budget = budgetFromReport(report({ vehicles: 100, gzBytes: 10_000 }), { reference: twin });
  assert.equal(budget.fitted, false);
  assert.equal(budget.slopeGz, null);
});

test('the deduplicated column is filled only for the cadence actually polled', () => {
  const budget = budgetFromReport(report({ interval: 30 }), { cadences: [30, 60] });
  const [fast, slow] = budget.rows;
  assert.ok(fast.dedupedPerYear != null, 'the report polled at 30 s, so 30 s is measured');
  assert.equal(slow.dedupedPerYear, null, 'and 60 s would be modelled, so it stays empty');
  // Round 0 has nothing to compare against and would claim 100 % moved.
  assert.equal(budget.movedFraction, 0.5);
  assert.ok(Math.abs(fast.dedupedPerYear - fast.positionsPerYear * 0.5) < 1);
});

test('a stop passage costs the same whether it is polled once or twenty times', () => {
  const passages = { records: 1000, ndjson: 100_000, gz: 10_000 };
  const budget = budgetFromReport(report({ companionWeight: passages }), { passageFactor: 100 });
  assert.equal(budget.perPassageGz, 10);
  // 7212 vehicles at 17 h × 100 passages each × 10 bytes.
  assert.equal(Math.round(budget.passages.perDay), 7_212_000);
  assert.equal(Math.round(budget.passages.perYear), 365 * 7_212_000);
});

test('no companion sweep, no companion table — rather than a table of zeros', () => {
  const budget = budgetFromReport(report());
  assert.equal(budget.companions.count, 0);
  assert.deepEqual(budget.companions.rows, []);
  assert.equal(budget.passages, null, 'and no passage line without a measured passage weight');
});

test('the day factor is the only thing that turns an hour into a year', () => {
  const base = budgetFromReport(report(), { dayFactor: 10, cadences: [30] });
  const twice = budgetFromReport(report(), { dayFactor: 20, cadences: [30] });
  assert.equal(twice.vehicleHours, 2 * base.vehicleHours);
  assert.equal(twice.rows[0].positionsPerYear, 2 * base.rows[0].positionsPerYear);
  // Doubling the day does not double the per-sweep framing.
  assert.ok(twice.rows[0].ingressPerYear < 2 * base.rows[0].ingressPerYear);
});

test('the profile layer does not grow with the year, only with the series count', () => {
  const budget = budgetFromReport(report());
  assert.equal(budget.profiles.feedSeriesBytes, 3 * 5341);
  assert.equal(budget.profiles.routeSeriesBytes, 6895 * 2 * 5341);
  assert.ok(budget.profiles.routeSeriesBytes < 0.1 * GB, 'every French line, still under 100 Mo');
});

test('an empty report projects nothing rather than dividing by zero', () => {
  const budget = budgetFromReport({
    measuredAt: '2026-09-07T00:00:00.000Z',
    args: { interval: 30 },
    inventory: [],
    positionWeight: { records: 0, ndjson: 0, gz: 0 },
    companionWeight: null,
    companions: [],
    rounds: [],
  });
  assert.equal(budget.fleet, 0);
  assert.equal(budget.movedFraction, null);
  assert.equal(budget.rows[0].positionsPerYear, 0);
  assert.ok(Number.isFinite(budget.rows[0].ingressPerYear));
});
