// The ceiling that decides whether this origin can be made public.
//
// Every `/api/openai/*`, `/api/google/*` and `/api/voice/brain` request bills
// somebody's card, so a reachable origin is a spendable wallet — that is the
// sentence the Basic gate exists for. Taking the gate off replaces it with
// these numbers, and only these: per-IP for fairness, global for the bill.
//
// The distinction is not decorative. Before the global knob existed, the
// staging deployment's `GEV_RATELIMIT_OPENAI_PER_MIN=20` carried an implied
// global backstop of 20 × 20 = 400 OpenAI calls a minute, and nothing said so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeOptInRateLimiter } from '../vite.config.js';

/** Spend `n` requests from one address, return how many were allowed. */
function allowed(limiter, key, n) {
  let ok = 0;
  for (let i = 0; i < n; i += 1) if (limiter(key)) ok += 1;
  return ok;
}

test('unset stays unlimited — the local default is untouched', () => {
  for (const [perIp, global] of [[undefined, undefined], ['', ''], ['0', '0'], ['abc', 'abc'], ['-5', '-5']]) {
    assert.equal(makeOptInRateLimiter(perIp, global), null, `${perIp}/${global}`);
  }
});

test('a per-IP cap bounds one address', () => {
  const limiter = makeOptInRateLimiter('20', undefined);
  assert.equal(allowed(limiter, '1.1.1.1', 30), 20);
});

test('per-IP alone does not bound the bill — that is why the global cap exists', () => {
  // The measured shape of the problem: 20/min/IP reads as prudent, and a
  // caller with fresh addresses walks straight past it up to the implied
  // 20× backstop.
  const limiter = makeOptInRateLimiter('20', undefined);
  let total = 0;
  for (let host = 0; host < 40; host += 1) total += allowed(limiter, `10.0.0.${host}`, 20);
  assert.equal(total, 400, 'implied backstop is 20x the per-IP cap');
});

test('a global cap holds no matter how many addresses ask', () => {
  const limiter = makeOptInRateLimiter('20', '50');
  let total = 0;
  for (let host = 0; host < 40; host += 1) total += allowed(limiter, `10.0.0.${host}`, 20);
  assert.equal(total, 50);
});

test('the global cap is a ceiling, not a floor — per-IP still bites under it', () => {
  const limiter = makeOptInRateLimiter('5', '50');
  assert.equal(allowed(limiter, '1.1.1.1', 20), 5);
  assert.equal(allowed(limiter, '2.2.2.2', 20), 5);
});

test('a global cap alone means one bucket for everybody', () => {
  // Configuring only the bill's ceiling is a legitimate posture: bound the
  // spend, do not pretend to be fair about who spends it.
  const limiter = makeOptInRateLimiter(undefined, '30');
  assert.notEqual(limiter, null);
  let total = 0;
  for (let host = 0; host < 10; host += 1) total += allowed(limiter, `10.0.0.${host}`, 10);
  assert.equal(total, 30);
});

test('fractional and oversized values are floored, never rounded up', () => {
  assert.equal(allowed(makeOptInRateLimiter('2.9', undefined), 'a', 10), 2);
  assert.equal(allowed(makeOptInRateLimiter(undefined, '3.9'), 'a', 10), 3);
});
