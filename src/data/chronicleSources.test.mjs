// The recorded-source registry. This file is small on purpose: its job is to
// make it impossible to add a source without also declaring the four things a
// recorded feed must carry — a licence, an attribution, a cadence and a
// reason nobody else keeps its past.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHRONICLE_SOURCES,
  chronicleRegistryFaults,
  chronicleSourceById,
  chronicleSourceIds,
} from './chronicleSources.js';

test('every declared source is well formed', () => {
  assert.deepEqual(chronicleRegistryFaults(), []);
});

test('the five feeds the fork records are the five declared', () => {
  assert.deepEqual(chronicleSourceIds(), [
    'transit-fr', 'irve-fr', 'road-status-fr', 'ais-fr', 'vigicrues',
  ]);
});

test('an unknown id is null, never a throw and never a default source', () => {
  assert.equal(chronicleSourceById('../etc/passwd'), null);
  assert.equal(chronicleSourceById(''), null);
  assert.equal(chronicleSourceById(undefined), null);
  assert.equal(chronicleSourceById('ais-fr').id, 'ais-fr');
});

test('the registry catches a source that forgot its licence or its cadence', () => {
  const faults = chronicleRegistryFaults([
    { id: 'ok', licence: 'LO 2.0', attribution: 'x', why: 'y', minIntervalMs: 60_000, retentionDays: 30, profile: true },
    { id: 'no licence', attribution: 'x', why: 'y', minIntervalMs: 60_000, retentionDays: 30, profile: true },
    { id: 'ok', licence: 'LO 2.0', attribution: 'x', why: 'y', minIntervalMs: 1000, retentionDays: 0, profile: null },
  ]);
  assert.ok(faults.some((fault) => fault.includes('not directory-safe')));
  assert.ok(faults.some((fault) => fault.includes('duplicate id')));
  assert.ok(faults.some((fault) => fault.includes('no licence declared')));
  assert.ok(faults.some((fault) => fault.includes('minIntervalMs')));
  assert.ok(faults.some((fault) => fault.includes('retentionDays')));
  assert.ok(faults.some((fault) => fault.includes('profile must be declared')));
});

test('Vigicrues is the one source that declares no typical week', () => {
  const withoutProfile = CHRONICLE_SOURCES.filter((source) => !source.profile).map((source) => source.id);
  assert.deepEqual(withoutProfile, ['vigicrues']);
});

test('no source asks upstream more often than once a minute', () => {
  for (const source of CHRONICLE_SOURCES) {
    assert.ok(source.minIntervalMs >= 60_000, `${source.id} polls faster than a minute`);
  }
});

test('the retention window is thirty days everywhere, so one sweep rule serves all', () => {
  for (const source of CHRONICLE_SOURCES) assert.equal(source.retentionDays, 30);
});
