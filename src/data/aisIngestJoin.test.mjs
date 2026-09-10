/**
 * The ingest path, end to end: what a row carries after a real AIS envelope
 * goes through `ingestAisStreamEnvelope` and comes back out of the same
 * `aisStreamRows()` the `/api/ais-live` route serves.
 *
 * The pure decisions are covered in `vesselRegistryFr.test.mjs`. What is
 * covered HERE is the wiring the pure tests cannot see: that the register is
 * actually consulted, that the transponder class survives the row build, and —
 * the one that would be invisible until a boat was mislabelled in production —
 * that a hull declaring itself six minutes late still takes its type back from
 * the register.
 *
 * Each case uses MMSIs of its own, so no cache reset is needed and the module
 * state these functions own is never reached into.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { aisStreamRows, ingestAisStreamEnvelope } from '../../vite.config.js';

const PACK = path.join(process.cwd(), 'src', 'data', 'local_data', 'vessels_fr', 'anfr-types.json');
const hasPack = fs.existsSync(PACK);

/** A position report, the message family the map is actually drawn from. */
function positionEnvelope(mmsi, { type = 'PositionReport', lat = 48.5, lon = -4.2 } = {}) {
  return {
    MessageType: type,
    MetaData: { MMSI: mmsi, ShipName: 'TEST HULL', latitude: lat, longitude: lon, time_utc: '2026-09-10 08:16:36 +0000 UTC' },
    Message: { [type]: { UserID: Number(mmsi), Latitude: lat, Longitude: lon, Sog: 6.2, Cog: 187.1 } },
  };
}

/** Message 5 — the only carrier of ship type, name and IMO for a Class A hull. */
function staticEnvelope(mmsi, shipType) {
  return {
    MessageType: 'ShipStaticData',
    MetaData: { MMSI: mmsi, ShipName: 'TEST HULL', time_utc: '2026-09-10 08:16:40 +0000 UTC' },
    Message: { ShipStaticData: { UserID: Number(mmsi), Type: shipType, Name: 'TEST HULL' } },
  };
}

const rowFor = (mmsi) => aisStreamRows(50_000).find((row) => row.mmsi === String(mmsi));

test('a position report carries the transponder class the ingest used to drop', () => {
  assert.equal(ingestAisStreamEnvelope(positionEnvelope('227900001')), true);
  assert.equal(rowFor('227900001').ais_class, 'A', 'message 1/2/3 is a SOLAS ship');

  ingestAisStreamEnvelope(positionEnvelope('227900002', { type: 'StandardClassBPositionReport' }));
  assert.equal(rowFor('227900002').ais_class, 'B', 'message 18 is voluntary equipment');

  ingestAisStreamEnvelope(positionEnvelope('227900003', { type: 'ExtendedClassBPositionReport' }));
  assert.equal(rowFor('227900003').ais_class, 'B', 'message 19 is Class B too');
});

test('the register fills a hull that declared nothing', { skip: !hasPack }, () => {
  // HARMONY, 227235520 — a real contact that was drawing the unfamilied slate
  // in the Channel on 2026-09-10, and is PLAISANCE in the ANFR register.
  ingestAisStreamEnvelope(positionEnvelope('227235520', { type: 'StandardClassBPositionReport' }));
  const row = rowFor('227235520');
  assert.equal(row.type, 'PLEASURE');
  assert.equal(row.type_source, 'anfr', 'and the row says who answered');
  assert.equal(row.ais_class, 'B');
});

test('a hull that declares itself takes its type back from the register', { skip: !hasPack }, () => {
  // THE REGRESSION THIS EXISTS FOR. The register writes a non-empty type into
  // the row, and the static-merge guard used to be `!existing.type` — which
  // would then refuse the transponder's own declaration when message 5 finally
  // arrived, six minutes later. A join that outranks the ship is worse than no
  // join, and nothing else in the suite would have caught it.
  ingestAisStreamEnvelope(positionEnvelope('227495120', { type: 'StandardClassBPositionReport' }));
  assert.equal(rowFor('227495120').type_source, 'anfr', 'the register answered first');

  ingestAisStreamEnvelope(staticEnvelope('227495120', 52));
  const row = rowFor('227495120');
  assert.equal(row.type, '52', 'the hull says it is a tug, and the hull wins');
  assert.equal(row.type_source, 'ais');

  // And a hull that declares 0 does NOT count as declaring: `0` is the
  // protocol's "not available", so the register keeps the floor.
  ingestAisStreamEnvelope(staticEnvelope('227495120', 0));
  assert.equal(rowFor('227495120').type, '52', 'a later 0 never erases a real declaration');
});

test('an unjoinable hull keeps the shape that tells the two silences apart', () => {
  // A British MMSI: no register covers it, and the row must come back with its
  // raw value so the legend can still separate "declared 0" from "never heard".
  ingestAisStreamEnvelope(positionEnvelope('232900004', { type: 'StandardClassBPositionReport' }));
  const silent = rowFor('232900004');
  assert.equal(silent.type, '');
  assert.equal(silent.type_source, '');

  ingestAisStreamEnvelope(staticEnvelope('232900004', 0));
  const blank = rowFor('232900004');
  assert.equal(blank.type, '0', 'the 0 is preserved, not collapsed to empty');
  assert.equal(blank.type_source, '');
});
