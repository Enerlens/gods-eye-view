import test from 'node:test';
import assert from 'node:assert/strict';

import {
  _resetJoinsForTest,
  askJoin,
  hasJoin,
  joinKeys,
  publishJoin,
} from './layerJoins.js';

test('a key nobody publishes answers null, and that is the ordinary case', () => {
  // The whole point of the board: a consumer asking for a layer that is
  // switched off gets a quiet null and says less, never an error and never a
  // blank where a sentence was promised.
  _resetJoinsForTest();
  assert.equal(askJoin('ports/directory'), null);
  assert.equal(hasJoin('ports/directory'), false);
  assert.deepEqual(joinKeys(), []);
});

test('a publisher is asked with the caller s arguments and its answer comes back', () => {
  _resetJoinsForTest();
  const release = publishJoin('buoys/nearest', (lat, lon) => ({ lat, lon }));
  assert.equal(hasJoin('buoys/nearest'), true);
  assert.deepEqual(askJoin('buoys/nearest', 51, 2), { lat: 51, lon: 2 });
  release();
  assert.equal(askJoin('buoys/nearest', 51, 2), null, 'the offer came down with the layer');
});

test('a teardown only removes its OWN offer', () => {
  // A layer disabled and re-enabled fast enough publishes again before its
  // first teardown runs. Without the identity check, the late teardown would
  // silently unpublish the live offer.
  _resetJoinsForTest();
  const stale = publishJoin('ports/directory', () => 'first');
  publishJoin('ports/directory', () => 'second');
  stale();
  assert.equal(askJoin('ports/directory'), 'second');
});

test('a provider that throws is contained, warned once, and answers null', () => {
  _resetJoinsForTest();
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args[0]);
  try {
    publishJoin('bad/provider', () => { throw new Error('boom'); });
    assert.equal(askJoin('bad/provider'), null);
    assert.equal(askJoin('bad/provider'), null);
    assert.equal(warnings.length, 1, 'a card repaints constantly; the warning does not');
  } finally {
    console.warn = original;
  }
});

test('undefined is normalised to null, so a consumer has one absence to test', () => {
  _resetJoinsForTest();
  publishJoin('quiet/one', () => undefined);
  assert.equal(askJoin('quiet/one'), null);
});

test('a malformed publication is inert rather than a crash at boot', () => {
  _resetJoinsForTest();
  assert.equal(typeof publishJoin('', () => 1), 'function');
  assert.equal(typeof publishJoin('ok/key', null), 'function');
  assert.deepEqual(joinKeys(), []);
});
