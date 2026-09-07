// The dynamic charge-point feed, read against two real captures of the
// national file taken nine minutes apart. Every trap the module header
// measures is pinned here, because a synthetic fixture would agree with
// whatever the projection assumed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  QUALICHARGE_FRESH_MS,
  parseQualichargeDynamic,
  parseQualichargeStamp,
  qualichargeEtatLabel,
  qualichargeOccupationLabel,
  qualichargeOperator,
  qualichargeSamples,
  qualichargeTransitions,
} from './qualichargeDynamic.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');

const T0 = fixture('qualicharge-dynamique-1627-sample.csv');
const T1 = fixture('qualicharge-dynamique-1637-sample.csv');
/** The instant the second capture's body arrived. */
const FETCHED_AT = Date.parse('2026-09-07T16:37:04Z');

test('the file parses to one entry per plug, with no malformed rows', () => {
  const parsed = parseQualichargeDynamic(T1);
  assert.equal(parsed.rows.size, 17);
  assert.equal(parsed.malformed, 0);
  assert.equal(parsed.columns, 8);
});

test('a missing required column yields nothing, rather than a file of zeros', () => {
  const parsed = parseQualichargeDynamic('id_pdc_itinerance,etat_pdc\nFRXXXE1,en_service\n');
  assert.equal(parsed.rows.size, 0);
  assert.ok(parsed.malformed > 0);
});

test('the four state words map to the codes the raw log is written in', () => {
  const rows = parseQualichargeDynamic(T1).rows;
  assert.deepEqual(rows.get('FRETIE49301A14'), { e: 'S', o: 'O', t: 1788798826 });
  assert.equal(rows.get('FRELCEM4L4').o, 'R');
  assert.equal(rows.get('FRDRVEABNY1').o, '?');
  assert.equal(qualichargeEtatLabel('H'), 'hors_service');
  assert.equal(qualichargeOccupationLabel('L'), 'libre');
  assert.equal(qualichargeOccupationLabel('Z'), null);
});

test('the horodatage is read despite the space and the microseconds', () => {
  assert.equal(
    parseQualichargeStamp('2026-09-07 13:01:16.040850+00:00'),
    Date.parse('2026-09-07T13:01:16.040Z'),
  );
  assert.ok(Number.isNaN(parseQualichargeStamp('')));
  assert.ok(Number.isNaN(parseQualichargeStamp(null)));
});

// --- Trap 1: the stale tail ------------------------------------------------

test('a plug nobody has spoken about for days is not counted as free', () => {
  const rows = parseQualichargeDynamic(T1).rows;
  const folded = qualichargeSamples(rows, { now: FETCHED_AT, operatorFloor: 1 });
  // FRITPEPCC00831 (4 days), FRS14EETSF1 (222 days) and FRELCEM4L4
  // (252 days) are all outside the window; the first two say `libre`.
  assert.equal(folded.pdc, 17);
  assert.equal(folded.fresh, 14);
  assert.equal(folded.samples['fr/libre'], 9);
  // The whole file, read naively, would claim eleven free plugs out of
  // seventeen — the two stale `libre` assertions above are 22 % of the answer
  // in a seventeen-row slice, and 44 % of it in the national file.
  const naive = [...rows.values()].filter((row) => row.o === 'L').length;
  assert.equal(naive, 11);
});

test('the window is a day, and a plug just outside it drops out', () => {
  const rows = parseQualichargeDynamic(T1).rows;
  const justInside = qualichargeSamples(rows, {
    now: Date.parse('2026-09-03T12:16:26Z') + QUALICHARGE_FRESH_MS,
    operatorFloor: 1,
  });
  const justOutside = qualichargeSamples(rows, {
    now: Date.parse('2026-09-03T12:16:26Z') + QUALICHARGE_FRESH_MS + 1000,
    operatorFloor: 1,
  });
  assert.equal(justInside.fresh - justOutside.fresh, 1);
});

// --- Trap 2: the freshness clock is the fetch ------------------------------

test('folding the same body later ages every row against a clock it never lived', () => {
  const rows = parseQualichargeDynamic(T1).rows;
  const atFetch = qualichargeSamples(rows, { now: FETCHED_AT, operatorFloor: 1 });
  const aDayLater = qualichargeSamples(rows, { now: FETCHED_AT + 86_400_000, operatorFloor: 1 });
  assert.equal(atFetch.fresh, 14);
  assert.equal(aDayLater.fresh, 0);
});

test('a stamp ahead of the reference is fresh, not discarded', () => {
  const rows = parseQualichargeDynamic(T1).rows;
  const ahead = qualichargeSamples(rows, { now: FETCHED_AT - 600_000, operatorFloor: 1 });
  assert.equal(ahead.fresh, 14);
});

// --- Trap 3: the operator lives in the id ---------------------------------

test('the operator is the first five characters, separator or not', () => {
  assert.equal(qualichargeOperator('FRS30E300320031'), 'FRS30');
  // The sixteen Ville de Paris rows that omit the `E`.
  assert.equal(qualichargeOperator('FRV75PPX12201'), 'FRV75');
  assert.equal(qualichargeOperator('frs30e300320031'), 'FRS30');
  assert.equal(qualichargeOperator('??'), null);
  assert.equal(qualichargeOperator(null), null);
});

test('an operator below the floor gets no share of its own', () => {
  const rows = parseQualichargeDynamic(T1).rows;
  const floored = qualichargeSamples(rows, { now: FETCHED_AT, operatorFloor: 5 });
  const keys = Object.keys(floored.samples).filter((key) => key.startsWith('op:'));
  // FRPD1 has six fresh plugs; FRTSL four; every other operator one or two.
  assert.deepEqual(keys, ['op:FRPD1/occupePct']);
  assert.equal(floored.samples['op:FRPD1/occupePct'], (100 * 2) / 6);
  assert.equal(floored.operators, 1);
});

test('every published share is over the fresh rows, never the file', () => {
  const rows = parseQualichargeDynamic(T1).rows;
  const folded = qualichargeSamples(rows, { now: FETCHED_AT, operatorFloor: 1 });
  assert.equal(folded.samples['fr/occupePct'], (100 * folded.samples['fr/occupe']) / folded.fresh);
  assert.equal(folded.samples['fr/pdc'], 17);
  assert.equal(folded.samples['fr/fresh'], 14);
});

test('an empty file publishes no share at all rather than dividing by zero', () => {
  const folded = qualichargeSamples(new Map(), { now: FETCHED_AT });
  assert.equal(folded.samples['fr/pdc'], 0);
  assert.equal('fr/occupePct' in folded.samples, false);
});

// --- The transition log ----------------------------------------------------

test('only a real state change is logged; a moved timestamp is not', () => {
  const before = parseQualichargeDynamic(T0).rows;
  const after = parseQualichargeDynamic(T1).rows;
  const rows = qualichargeTransitions(before, after);
  const ids = rows.map(([id]) => id).sort();
  // Four plugs really moved: FRETIE49301A14 libre -> occupe,
  // FRPD1EBDMCARKPC600014 libre -> occupe, FRPD1ELIDMILLTTN120021 the other
  // way, and FRPD1ECORWITBBC200011 hors_service/inconnu -> en_service/libre.
  // Three more republished an identical state under a new stamp — including
  // FRLDLE00000747, which moved its horodatage by nearly eight hours.
  assert.deepEqual(ids, [
    'FRETIE49301A14',
    'FRPD1EBDMCARKPC600014',
    'FRPD1ECORWITBBC200011',
    'FRPD1ELIDMILLTTN120021',
  ]);
  assert.deepEqual(rows.find(([id]) => id === 'FRETIE49301A14'), ['FRETIE49301A14', 'S', 'O', 1788798826]);
  assert.equal(before.get('FRLDLE00000747').t !== after.get('FRLDLE00000747').t, true);
});

test('a cold start logs the whole network it inherited', () => {
  const after = parseQualichargeDynamic(T1).rows;
  assert.equal(qualichargeTransitions(null, after).length, after.size);
  assert.equal(qualichargeTransitions(new Map(), after).length, after.size);
});

test('the transition log is capped rather than allowed to grow without bound', () => {
  const after = parseQualichargeDynamic(T1).rows;
  assert.equal(qualichargeTransitions(null, after, { maxRows: 3 }).length, 3);
});
