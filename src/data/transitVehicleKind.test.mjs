// The join that turns an amber swarm into buses, trams and river shuttles.
// Its failure mode is confident mislabelling, so the tests that carry weight
// are the ones pinning what happens when the join does NOT resolve.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  kindFromRouteType,
  parseRouteTypes,
  resolveVehicleKind,
  uniformKindOf,
  vehicleKindColor,
  vehicleKindLabel,
  VEHICLE_KIND_COLORS,
  VEHICLE_KIND_LABELS,
} from './transitVehicleKind.js';

test('the basic route_type values map to the modes the reference names', () => {
  assert.equal(kindFromRouteType(0), 'tram');
  assert.equal(kindFromRouteType(1), 'metro');
  assert.equal(kindFromRouteType(2), 'rail');
  assert.equal(kindFromRouteType(3), 'bus');
  assert.equal(kindFromRouteType(4), 'ferry');
  assert.equal(kindFromRouteType(6), 'aerial');
  assert.equal(kindFromRouteType(7), 'funicular');
  assert.equal(kindFromRouteType(11), 'trolleybus');
  assert.equal(kindFromRouteType(12), 'monorail');
  // Strings, because CSV columns are strings.
  assert.equal(kindFromRouteType('3'), 'bus');
});

test('extended route types resolve rather than falling through as unknown', () => {
  assert.equal(kindFromRouteType(109), 'rail', 'suburban railway');
  assert.equal(kindFromRouteType(401), 'metro');
  assert.equal(kindFromRouteType(700), 'bus');
  assert.equal(kindFromRouteType(900), 'tram');
  assert.equal(kindFromRouteType(1200), 'ferry');
  assert.equal(kindFromRouteType(1400), 'funicular');
});

test('an unusable route_type resolves to nothing, never to a default mode', () => {
  for (const value of [null, undefined, '', 'bus', -1, 8, 99, 1600, 2000, 3.5, NaN]) {
    assert.equal(kindFromRouteType(value), null, `${String(value)} must not resolve`);
  }
});

test('every kind the mapper can emit has a label and a colour', () => {
  const kinds = new Set();
  for (const value of [0, 1, 2, 3, 4, 5, 6, 7, 11, 12, 150, 250, 450, 750, 850, 950, 1050, 1150, 1250, 1350, 1450, 1550, 1750]) {
    const kind = kindFromRouteType(value);
    assert.ok(kind, `${value} should resolve`);
    kinds.add(kind);
  }
  for (const kind of kinds) {
    assert.ok(VEHICLE_KIND_LABELS[kind], `${kind} needs a label`);
    assert.ok(VEHICLE_KIND_COLORS[kind], `${kind} needs a colour`);
  }
});

test('an unknown kind still renders as something neutral, not as a crash', () => {
  assert.equal(vehicleKindLabel(null), 'Vehicle');
  assert.equal(vehicleKindColor('zeppelin'), VEHICLE_KIND_COLORS.other);
});

test('a network is uniform only when every route it publishes agrees', () => {
  // TADAO: 333 routes, all buses. A vehicle there is a bus even unmatched.
  assert.equal(uniformKindOf({ a: 3, b: 3, c: 700 }), 'bus');
  // TBM: buses, trams and river shuttles. Nothing may be assumed.
  assert.equal(uniformKindOf({ a: 3, b: 0, c: 4 }), null);
  assert.equal(uniformKindOf({}), null, 'a network with no routes is not uniform');
  assert.equal(uniformKindOf(null), null);
  // One unreadable route_type poisons the claim rather than being ignored.
  assert.equal(uniformKindOf({ a: 3, b: 99 }), null);
});

test('resolution names its own provenance, and never invents one', () => {
  const tbm = { routes: { '01': 3, A: 0, Bat3: 4 }, uniformKind: null };
  assert.deepEqual(resolveVehicleKind('A', tbm), { kind: 'tram', source: 'route_type' });
  assert.deepEqual(resolveVehicleKind('Bat3', tbm), { kind: 'ferry', source: 'route_type' });
  // Unmatched on a mixed network: no guess. The layer falls back to the
  // network's SERVICE class and says so.
  assert.deepEqual(resolveVehicleKind('ZZ', tbm), { kind: null, source: 'network' });
  assert.deepEqual(resolveVehicleKind(null, tbm), { kind: null, source: 'network' });

  // Tours Fil Bleu publishes no route_id at all; its network is all buses.
  const uniform = { routes: { '1': 3, '2': 3 }, uniformKind: 'bus' };
  assert.deepEqual(resolveVehicleKind(null, uniform), { kind: 'bus', source: 'uniform' });
  assert.deepEqual(resolveVehicleKind('1', uniform), { kind: 'bus', source: 'route_type' });

  // No index entry for the feed at all.
  assert.deepEqual(resolveVehicleKind('A', null), { kind: null, source: 'network' });
});

test('routes.txt parses through a BOM, CRLF, quotes and reordered columns', () => {
  const text = '﻿route_long_name,route_id,route_type\r\n'
    + '"Lianes 1, direction Nord",01,3\r\n'
    + '"He said ""go""",A,0\r\n'
    + 'Bateau,Bat3,4\r\n';
  assert.deepEqual(parseRouteTypes(text), { '01': 3, A: 0, Bat3: 4 });
});

test('routes.txt with the wrong columns yields nothing rather than nonsense', () => {
  assert.deepEqual(parseRouteTypes('route_id,route_color\n01,00B1EB\n'), {});
  assert.deepEqual(parseRouteTypes(''), {});
  assert.deepEqual(parseRouteTypes(null), {});
  // Rows missing an id or carrying a non-integer type are skipped, not coerced.
  assert.deepEqual(parseRouteTypes('route_id,route_type\n,3\nB,\nC,bus\nD,3\n'), { D: 3 });
});
