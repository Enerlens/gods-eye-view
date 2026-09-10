/**
 * The MMSI join, and the two rules that keep it honest: it may only speak into
 * a silence, and it may only speak for the four categories that were measured
 * to agree with the transponder.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  ANFR_KEPT_CATEGORIES,
  VESSEL_REGISTRY_FR_CREDIT,
  VESSEL_REGISTRY_FR_VERSION,
  aisTypeIsDeclared,
  parseVesselRegistryFr,
  resolveVesselType,
} from './vesselRegistryFr.js';
import { normalizeVesselType, vesselTypeFamily } from './vesselLabels.js';

const PACK = path.join(process.cwd(), 'src', 'data', 'local_data', 'vessels_fr', 'anfr-types.json');

const pack = (mmsi) => ({ version: VESSEL_REGISTRY_FR_VERSION, mmsi });

test('a declared type is anything the transponder actually filled in', () => {
  assert.equal(aisTypeIsDeclared('70'), true);
  assert.equal(aisTypeIsDeclared('37'), true);
  assert.equal(aisTypeIsDeclared('PLEASURE'), true);
  // The two silences. `0` is the protocol's own "not available" and arrives as
  // a number, a string or a zero-padded string depending on the message family
  // — all three are the same non-answer.
  assert.equal(aisTypeIsDeclared('0'), false);
  assert.equal(aisTypeIsDeclared(0), false);
  assert.equal(aisTypeIsDeclared('00'), false);
  assert.equal(aisTypeIsDeclared(''), false);
  assert.equal(aisTypeIsDeclared('   '), false);
  assert.equal(aisTypeIsDeclared(null), false);
  assert.equal(aisTypeIsDeclared(undefined), false);
});

test('the register never outranks the hull', () => {
  const index = parseVesselRegistryFr(pack({ PLEASURE: '227235520' }));
  // The measured case this exists for: type 0, and a register that knows.
  assert.deepEqual(
    resolveVesselType('227235520', '0', index),
    { type: 'PLEASURE', source: 'anfr' },
  );
  assert.deepEqual(
    resolveVesselType('227235520', '', index),
    { type: 'PLEASURE', source: 'anfr' },
  );
  // And the case that must never regress: the same hull, once it declares.
  // A register that overwrote a real declaration would be worse than no join.
  assert.deepEqual(
    resolveVesselType('227235520', '70', index),
    { type: '70', source: 'ais' },
  );
});

test('an unjoinable silence keeps the shape that tells the two silences apart', () => {
  const index = parseVesselRegistryFr(pack({ PLEASURE: '227235520' }));
  // 73 % of the undeclared bucket is foreign-flagged and no register covers
  // it. Those rows must come back with their raw value intact — collapsing
  // '0' to '' here would erase "declared blank" into "never heard", which is
  // the distinction the legend was split to show.
  assert.deepEqual(resolveVesselType('232006483', '0', index), { type: '0', source: '' });
  assert.deepEqual(resolveVesselType('232006483', '', index), { type: '', source: '' });
  assert.deepEqual(resolveVesselType('', '0', index), { type: '0', source: '' });
  assert.deepEqual(resolveVesselType('227235520', '0', null), { type: '0', source: '' });
});

test('the pack is refused whole rather than half-read', () => {
  assert.equal(parseVesselRegistryFr(null).size, 0);
  assert.equal(parseVesselRegistryFr({}).size, 0);
  assert.equal(parseVesselRegistryFr({ version: 99, mmsi: { PLEASURE: '227235520' } }).size, 0);
  assert.equal(parseVesselRegistryFr(pack('not an object')).size, 0);
  // A category this build refuses cannot be smuggled back in through the file.
  // CHARGE agreed with the transponder 9 % of the time and FLUVIAL 0 %; a pack
  // carrying them is a pack built by a script that lost its evidence.
  assert.equal(parseVesselRegistryFr(pack({ CHARGE: '227235520' })).size, 0);
  assert.equal(parseVesselRegistryFr(pack({ FLUVIAL: '226003280' })).size, 0);
  // Malformed keys are dropped one by one, not by throwing away the file.
  const mixed = parseVesselRegistryFr(pack({ PLEASURE: '227235520,abc,12345,227495120' }));
  assert.deepEqual([...mixed.keys()], ['227235520', '227495120']);
});

test('every kept category emits a token the palette already understands', () => {
  // The whole point of emitting AIS text rather than a private code: a joined
  // vessel travels through the hue table, the legend and the card by the same
  // path as a declared one. If these ever diverge, a joined pleasure craft
  // silently lands back in the unfamilied bucket it was meant to leave.
  const expected = { PLEASURE: 'pleasure', FISHING: 'fishing', PASSENGER: 'passenger', 'HIGH-SPEED': 'hsc' };
  for (const token of Object.values(ANFR_KEPT_CATEGORIES)) {
    assert.equal(normalizeVesselType(token), token, `${token} passes through normalisation`);
    assert.equal(vesselTypeFamily(token), expected[token], `${token} has a family`);
  }
  // The four, and only the four, that were measured to agree.
  assert.deepEqual(Object.keys(ANFR_KEPT_CATEGORIES).sort(), ['H.S.C.', 'PASSAGERS', 'PLAISANCE', 'PÊCHE']);
  assert.match(VESSEL_REGISTRY_FR_CREDIT, /ANFR/);
  assert.match(VESSEL_REGISTRY_FR_CREDIT, /Licence Ouverte/);
});

test('the shipped pack is the one this code can read', { skip: !fs.existsSync(PACK) }, () => {
  const index = parseVesselRegistryFr(JSON.parse(fs.readFileSync(PACK, 'utf8')));
  // Built 2026-09-10 from the September 2025 edition: 123 585 MMSIs across the
  // four kept categories, zero conflicting declarations in the source.
  assert.ok(index.size > 100_000, `expected a six-figure register, got ${index.size}`);
  // Spot checks from the live cross-check — three hulls that were drawing the
  // unfamilied slate in the Channel on 2026-09-10.
  assert.equal(index.get('227235520'), 'PLEASURE', 'HARMONY');
  assert.equal(index.get('227319630'), 'FISHING', 'LE YETI');
  assert.equal(index.get('227009880'), 'PASSENGER', "L'HERMINE");
  // Overseas territories ride along — 9 557 of the kept MMSIs sit outside the
  // metropolitan 226-228 range, which is why the join is worth having on a
  // world globe and not only on the France box.
  let overseas = 0;
  for (const mmsi of index.keys()) {
    const mid = `${mmsi[0]}${mmsi[1]}${mmsi[2]}`;
    if (mid === '329' || mid === '347' || mid === '540' || mid === '546' || mid === '660' || mid === '745') {
      overseas += 1;
    }
  }
  assert.ok(overseas > 5_000, `expected the outre-mer, got ${overseas}`);
});
