import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAdsbLolAircraftState,
  normalizeAdsbLolPointResponse,
} from './adsbLolFallback.js';

test('normalizes adsb.lol units into an OpenSky-compatible state vector', () => {
  const state = normalizeAdsbLolAircraftState({
    hex: 'A1B2C3',
    flight: 'UAL123 ',
    lat: 30,
    lon: -97,
    alt_baro: 10000,
    alt_geom: 10200,
    gs: 200,
    track: 90,
    baro_rate: 600,
    seen_pos: 2,
    seen: 1,
    category: 'A3',
    t: 'B738',
    r: 'N12345',
  }, 1000);

  assert.equal(state[0], 'a1b2c3');
  assert.equal(state[1], 'UAL123');
  assert.equal(state[2], null);
  assert.equal(state[3], 998);
  assert.equal(state[5], -97);
  assert.equal(state[6], 30);
  assert.equal(state[7], 3048);
  assert.ok(Math.abs(state[9] - 102.8888) < 0.001);
  assert.equal(state[10], 90);
  assert.ok(Math.abs(state[11] - 3.048) < 0.001);
  assert.equal(state[13], 3108.96);
  assert.equal(state[17], 4);
  assert.equal(state[18], 'B738');
  assert.equal(state[19], 'N12345');
});

test('the type designator and the tail ride the vector adsb.lol already paid for', () => {
  // The whole point of phase 3a: `/states/all` has no type code, so a fallback
  // contact used to reach the classifier with nothing but an emitter category
  // it does not carry either. Both fields are right there in the payload.
  const state = normalizeAdsbLolAircraftState({
    hex: 'ABCDEF', flight: 'AFR123', lat: 48.8, lon: 2.3, t: ' EC35 ', r: ' F-HXYZ ',
  }, 1000);
  assert.equal(state[18], 'EC35', 'type designator is trimmed, not passed raw');
  assert.equal(state[19], 'F-HXYZ', 'registration is trimmed, not passed raw');
});

test('a contact with neither type nor tail leaves both slots null, never undefined', () => {
  // Undefined would survive JSON.stringify by VANISHING from the array, which
  // shortens the vector and shifts nothing — but a consumer reading [18] would
  // then see undefined where the contract says "absent". null says it out loud.
  const state = normalizeAdsbLolAircraftState({
    hex: 'abcdef', flight: 'AFR123', lat: 48.8, lon: 2.3,
  }, 1000);
  assert.equal(state.length, 20);
  assert.equal(state[18], null);
  assert.equal(state[19], null);
  assert.equal(JSON.parse(JSON.stringify(state)).length, 20, 'survives the proxy serialization');
});

test('the tail no longer masquerades as a callsign', () => {
  // It used to fill [1] when `flight` was blank, so `mapAnalystRecord`
  // published a registration as a spoken callsign. The label chain does that
  // fallback itself, one layer up, where it is honest about which is which.
  const state = normalizeAdsbLolAircraftState({
    hex: 'abcdef', lat: 48.8, lon: 2.3, r: 'F-HXYZ',
  }, 1000);
  assert.equal(state[1], null, 'no callsign was reported');
  assert.equal(state[19], 'F-HXYZ');
});

test('keeps grounded fallback contacts and rejects rows without positions', () => {
  const normalized = normalizeAdsbLolPointResponse({
    now: 1_700_000_000_000,
    ac: [
      { hex: 'abc123', lat: 0, lon: 0, alt_baro: 'ground', gs: 8 },
      { hex: 'def456', lat: null, lon: 10, alt_baro: 5000 },
    ],
  });

  assert.equal(normalized.time, 1_700_000_000);
  assert.equal(normalized.states.length, 1);
  assert.equal(normalized.states[0][7], null);
  assert.equal(normalized.states[0][8], true);
});
