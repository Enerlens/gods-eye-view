// src/data/aircraftClass.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAircraft, CLASS_LEGEND_LABELS, CLASS_SCALE_2D, CLASS_SCALE_3D, CLASS_MODEL_URL, CLASS_MODEL_REAL } from './aircraftClass.js';
import { VESSEL_FAMILY_LABELS } from './vesselLabels.js';

test('type-code classification (military layer path)', () => {
  assert.equal(classifyAircraft({ typeCode: 'F16' }), 'fastjet');
  assert.equal(classifyAircraft({ typeCode: 'EC35' }), 'helicopter');
  assert.equal(classifyAircraft({ typeCode: 'B744' }), 'quadjet');
  assert.equal(classifyAircraft({ typeCode: 'B77W' }), 'widebody');
  assert.equal(classifyAircraft({ typeCode: 'C17' }), 'widebody');
  assert.equal(classifyAircraft({ typeCode: 'AT76' }), 'turboprop');
  assert.equal(classifyAircraft({ typeCode: 'C172' }), 'light');
  assert.equal(classifyAircraft({ typeCode: 'b738' }), 'airliner'); // case-insensitive default-jet
});

test('bizjet + uav classes (2026-08-16 Hangar fleet)', () => {
  assert.equal(classifyAircraft({ typeCode: 'C25A' }), 'bizjet');
  assert.equal(classifyAircraft({ typeCode: 'C56X' }), 'bizjet');
  assert.equal(classifyAircraft({ typeCode: 'GLF5' }), 'bizjet');
  assert.equal(classifyAircraft({ typeCode: 'CL60' }), 'bizjet');
  // SF50 Cirrus Vision Jet is a JET — it must NOT fall back to the light/prop class.
  assert.equal(classifyAircraft({ typeCode: 'SF50' }), 'bizjet');
  assert.equal(classifyAircraft({ typeCode: 'MQ9' }), 'uav');
  assert.equal(classifyAircraft({ typeCode: 'Q4' }), 'uav');
  assert.equal(classifyAircraft({ typeCode: 'TB2' }), 'uav');
});

test('category fallback (flights layer path — OpenSky extended int)', () => {
  assert.equal(classifyAircraft({ category: 8 }), 'helicopter');
  assert.equal(classifyAircraft({ category: 6 }), 'widebody');
  assert.equal(classifyAircraft({ category: 7 }), 'fastjet');
  assert.equal(classifyAircraft({ category: 2 }), 'light');
  assert.equal(classifyAircraft({ category: 9 }), 'glider');
  assert.equal(classifyAircraft({ category: 4 }), 'airliner');
});

test('ADS-B emitter string categories', () => {
  assert.equal(classifyAircraft({ category: 'A7' }), 'helicopter');
  assert.equal(classifyAircraft({ category: 'A5' }), 'widebody');
  assert.equal(classifyAircraft({ category: 'A1' }), 'light');
  assert.equal(classifyAircraft({ category: 'B1' }), 'glider');
});

test('typeCode outranks category; nothing exploitable → unknown, never airliner', () => {
  assert.equal(classifyAircraft({ typeCode: 'F18', category: 6 }), 'fastjet');
  // CARTOGRAPHIE A1: `/states/all` carries no type code and OpenSky's live
  // category is 0/"no info" for ~94% of contacts, so this is the INITIAL state
  // of most of the fleet, not an edge case. It must not claim a narrow-body.
  assert.equal(classifyAircraft({}), 'unknown');
  assert.equal(classifyAircraft({ typeCode: null, category: 0 }), 'unknown');
  // A code we simply don't have a set for is still a MEASUREMENT — it stays
  // the default jet. Only the absence of any datum is 'unknown'.
  assert.equal(classifyAircraft({ typeCode: 'B738' }), 'airliner');
});

test('scale/url tables cover every class', () => {
  for (const kind of ['light','glider','turboprop','airliner','widebody','quadjet','helicopter','fastjet','bizjet','uav','unknown']) {
    assert.ok(Number.isFinite(CLASS_SCALE_2D[kind]), kind);
    assert.ok(CLASS_SCALE_3D[kind] >= 0.75 && CLASS_SCALE_3D[kind] <= 1.45, kind);
    assert.ok(typeof CLASS_MODEL_URL[kind] === 'string', kind);
    // A class with no caption falls back to its internal key in the legend, so
    // the reader gets 'quadjet' — a colour chart, not a legend.
    assert.ok(typeof CLASS_LEGEND_LABELS[kind] === 'string' && CLASS_LEGEND_LABELS[kind], kind);
  }
});

test('the legend is in French, and says "unknown" the way the sea layers say it', () => {
  // One phrase for one idea across the air and sea keys.
  assert.equal(CLASS_LEGEND_LABELS.unknown, VESSEL_FAMILY_LABELS.unknown);
  // Guard against a partial revert leaving half the key in English: no caption
  // may be one of the strings this phase replaced.
  const English = new Set([
    'Light aircraft', 'Glider', 'Turboprop', 'Narrow-body jet', 'Wide-body jet',
    'Four-engine heavy', 'Helicopter', 'Fast jet', 'Business jet', 'Large UAV',
    'Type not reported',
  ]);
  for (const [kind, label] of Object.entries(CLASS_LEGEND_LABELS)) {
    assert.ok(!English.has(label), `${kind} is still captioned in English`);
  }
  // fastjet is reached from OpenSky category 7 (a SPEED reading) as well as
  // from the type set, so its caption must not assert a mission.
  assert.equal(classifyAircraft({ category: 7 }), 'fastjet');
  assert.doesNotMatch(CLASS_LEGEND_LABELS.fastjet, /combat|chasse|militaire/i);
});

test('CLASS_MODEL_REAL entries carry the fields the layers consume', () => {
  for (const [kind, spec] of Object.entries(CLASS_MODEL_REAL)) {
    assert.ok(spec.url.startsWith('/models/') && spec.url.endsWith('.glb'), kind);
    assert.ok(spec.radiusM > 0 && spec.bellyM > 0, kind);
    // every real-model class must also exist in the classifier tables
    assert.ok(Number.isFinite(CLASS_SCALE_2D[kind]), kind);
  }
});

test('the unclassified contact has its own glyph and does not sit mid-ramp', async () => {
  const { aircraftIcon } = await import('./aircraftIcons.js');
  // Distinct silhouette — the shape channel, not the size channel, carries
  // "not classified".
  assert.notEqual(aircraftIcon('unknown'), aircraftIcon('airliner'));
  // An unrecognised kind falls back to the dart, not to the airliner planform.
  assert.equal(aircraftIcon('no-such-class'), aircraftIcon('unknown'));
  // Size is the weight-class channel: 1.0 means narrow-body and is not free.
  assert.notEqual(CLASS_SCALE_2D.unknown, CLASS_SCALE_2D.airliner);
});
