// The MMSI identity registry: what survives a restart, what expires, and the
// one field that must never come back from disk. Pure — no fs, no clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AIS_STATIC_REGISTRY_VERSION,
  AIS_STATIC_TTL_MS,
  adoptAisStaticRegistry,
  aisStaticEntryFresh,
  normalizeAisStaticEntry,
  parseAisStaticRegistry,
  pruneAisStaticEntries,
  serializeAisStaticRegistry,
} from './aisStaticRegistry.js';

const NOW = 1_770_000_000_000;
const DAY = 86_400_000;

function entry(overrides = {}) {
  return {
    name: 'CMA CGM MARSEILLE',
    type: 'Cargo',
    destination: 'FRLEH',
    imo: '9776418',
    hull: { loaM: 300, beamM: 48, toBowM: 250, toPortM: 24 },
    updatedAt: NOW,
    ...overrides,
  };
}

function registryOf(pairs) {
  return new Map(pairs);
}

test('a learned identity round-trips through the document', () => {
  const document = serializeAisStaticRegistry(registryOf([['227123456', entry()]]), { now: NOW });
  const restored = parseAisStaticRegistry(JSON.stringify(document), { now: NOW });
  const back = restored.get('227123456');
  assert.equal(document.version, AIS_STATIC_REGISTRY_VERSION);
  assert.equal(back.name, 'CMA CGM MARSEILLE');
  assert.equal(back.type, 'Cargo');
  assert.equal(back.imo, '9776418');
  assert.deepEqual(back.hull, { loaM: 300, beamM: 48, toBowM: 250, toPortM: 24 });
  assert.equal(back.updatedAt, NOW);
});

test('destination is voyage data and never reaches disk', () => {
  const document = serializeAisStaticRegistry(registryOf([['227123456', entry()]]), { now: NOW });
  assert.equal('destination' in document.entries['227123456'], false);
  assert.equal(JSON.stringify(document).includes('FRLEH'), false);
  const restored = parseAisStaticRegistry(JSON.stringify(document), { now: NOW });
  assert.equal(restored.get('227123456').destination, undefined);
});

test('an entry older than the TTL is not written and not read back', () => {
  const stale = registryOf([['227123456', entry({ updatedAt: NOW - 31 * DAY })]]);
  assert.equal(serializeAisStaticRegistry(stale, { now: NOW }).count, 0);

  const written = serializeAisStaticRegistry(
    registryOf([['227123456', entry({ updatedAt: NOW })]]),
    { now: NOW },
  );
  const readMuchLater = parseAisStaticRegistry(JSON.stringify(written), { now: NOW + 31 * DAY });
  assert.equal(readMuchLater.size, 0);
  assert.equal(aisStaticEntryFresh(entry(), AIS_STATIC_TTL_MS, NOW + 29 * DAY), true);
});

test('an entry that declares nothing is dropped rather than stored', () => {
  const empty = { name: '', type: '', imo: '', hull: null, updatedAt: NOW };
  assert.equal(normalizeAisStaticEntry(empty), null);
  assert.equal(serializeAisStaticRegistry(registryOf([['227123456', empty]]), { now: NOW }).count, 0);
});

test('an all-null dimension block is not a hull', () => {
  const noHull = normalizeAisStaticEntry(entry({
    hull: { loaM: null, beamM: null, toBowM: null, toPortM: null },
  }));
  assert.equal(noHull.hull, null);
  // A single published dimension is still a measurement worth keeping.
  const partial = normalizeAisStaticEntry(entry({
    hull: { loaM: 22, beamM: null, toBowM: null, toPortM: null },
  }));
  assert.deepEqual(partial.hull, { loaM: 22, beamM: null, toBowM: null, toPortM: null });
});

test('a string dimension is not coerced into a measurement', () => {
  const coerced = normalizeAisStaticEntry(entry({ hull: { loaM: '0', beamM: null } }));
  assert.equal(coerced.hull, null);
});

test('truncation at the cap keeps the identities heard most recently', () => {
  const registry = registryOf([
    ['227000001', entry({ name: 'OLDEST', updatedAt: NOW - 3 * DAY })],
    ['227000002', entry({ name: 'MIDDLE', updatedAt: NOW - 2 * DAY })],
    ['227000003', entry({ name: 'NEWEST', updatedAt: NOW - DAY })],
  ]);
  const document = serializeAisStaticRegistry(registry, { now: NOW, maxEntries: 2 });
  assert.equal(document.count, 2);
  assert.deepEqual(Object.keys(document.entries).sort(), ['227000002', '227000003']);
});

test('pruning drops the expired, then evicts the oldest down to the cap', () => {
  const registry = registryOf([
    ['227000001', entry({ updatedAt: NOW - 40 * DAY })],
    ['227000002', entry({ updatedAt: NOW - 3 * DAY })],
    ['227000003', entry({ updatedAt: NOW - 2 * DAY })],
    ['227000004', entry({ updatedAt: NOW })],
  ]);
  const dropped = pruneAisStaticEntries(registry, { now: NOW, maxEntries: 2 });
  assert.equal(dropped, 2);
  assert.deepEqual([...registry.keys()], ['227000003', '227000004']);
});

test('pruning a registry inside both limits changes nothing', () => {
  const registry = registryOf([['227000001', entry()]]);
  assert.equal(pruneAisStaticEntries(registry, { now: NOW }), 0);
  assert.equal(registry.size, 1);
});

test('a corrupt, empty or foreign-version file costs one session, not a crash', () => {
  assert.equal(parseAisStaticRegistry('{ not json', { now: NOW }).size, 0);
  assert.equal(parseAisStaticRegistry('', { now: NOW }).size, 0);
  assert.equal(parseAisStaticRegistry('[]', { now: NOW }).size, 0);
  assert.equal(parseAisStaticRegistry(null, { now: NOW }).size, 0);
  const future = { version: AIS_STATIC_REGISTRY_VERSION + 1, entries: { 227000001: entry() } };
  assert.equal(parseAisStaticRegistry(JSON.stringify(future), { now: NOW }).size, 0);
});

test('a non-numeric key is not an MMSI this server wrote', () => {
  const document = {
    version: AIS_STATIC_REGISTRY_VERSION,
    entries: { '__proto__x': entry(), 'abc': entry(), '227000001': entry() },
  };
  const restored = parseAisStaticRegistry(JSON.stringify(document), { now: NOW });
  assert.deepEqual([...restored.keys()], ['227000001']);
});

test('text fields are capped so a malformed feed cannot inflate the file', () => {
  const long = normalizeAisStaticEntry(entry({ name: 'A'.repeat(500) }));
  assert.equal(long.name.length, 64);
});

test('adopting fills the gaps the running feed has, and never overwrites it', () => {
  const live = registryOf([
    // Part A of a split report: a name this session heard, no hull yet.
    ['227000001', { name: 'HEARD LIVE', type: '', imo: '', hull: null, updatedAt: NOW }],
  ]);
  const disk = registryOf([
    ['227000001', entry({ name: 'STALE NAME', type: 'Tanker', updatedAt: NOW - DAY })],
    ['227000002', entry({ name: 'ONLY ON DISK', updatedAt: NOW - DAY })],
  ]);
  const adopted = adoptAisStaticRegistry(live, disk);
  assert.equal(adopted, 2);
  const merged = live.get('227000001');
  assert.equal(merged.name, 'HEARD LIVE');
  assert.equal(merged.type, 'Tanker');
  assert.equal(merged.updatedAt, NOW);
  assert.equal(live.get('227000002').name, 'ONLY ON DISK');
});

test('adopting a registry that adds nothing reports nothing', () => {
  const live = registryOf([['227000001', entry()]]);
  assert.equal(adoptAisStaticRegistry(live, registryOf([['227000001', entry({ name: 'OTHER' })]])), 0);
  assert.equal(live.get('227000001').name, 'CMA CGM MARSEILLE');
});
