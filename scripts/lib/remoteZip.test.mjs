// ZIP arithmetic, checked against archives built in memory. The stakes are
// silent wrongness: a member read from the wrong offset still inflates to
// something, and that something would become a route type on a moving bus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  findCentralEntry,
  findEndOfCentralDirectory,
  readLocalMember,
  readZipMember,
} from './remoteZip.mjs';

/**
 * Build a minimal but spec-shaped ZIP.
 * @param {Array<{name: string, body: string, store?: boolean}>} members
 * @param {string} [comment] Archive comment, which pushes the EOCD off the end.
 */
function buildZip(members, comment = '') {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const member of members) {
    const name = Buffer.from(member.name, 'utf8');
    const raw = Buffer.from(member.body, 'utf8');
    const stored = member.store === true;
    const payload = stored ? raw : deflateRawSync(raw);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    const dir = Buffer.alloc(46 + name.length);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(stored ? 0 : 8, 10);
    dir.writeUInt32LE(payload.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    name.copy(dir, 46);

    locals.push(local, payload);
    central.push(dir);
    offset += local.length + payload.length;
  }

  const body = Buffer.concat(locals);
  const directory = Buffer.concat(central);
  const tail = Buffer.from(comment, 'utf8');
  const eocd = Buffer.alloc(22 + tail.length);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(members.length, 8);
  eocd.writeUInt16LE(members.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(body.length, 16);
  eocd.writeUInt16LE(tail.length, 20);
  tail.copy(eocd, 22);
  return Buffer.concat([body, directory, eocd]);
}

const GTFS = [
  { name: 'agency.txt', body: 'agency_id,agency_name\n1,TBM\n' },
  { name: 'stop_times.txt', body: 'x'.repeat(20000) },
  { name: 'routes.txt', body: 'route_id,route_type\n01,3\nA,0\n' },
];

test('a deflated member is found and inflated whatever its position', () => {
  const zip = buildZip(GTFS);
  assert.equal(String(readZipMember(zip, 'routes.txt')), 'route_id,route_type\n01,3\nA,0\n');
  assert.equal(String(readZipMember(zip, 'agency.txt')), 'agency_id,agency_name\n1,TBM\n');
});

test('a stored (uncompressed) member reads back byte-identical', () => {
  const zip = buildZip([{ name: 'routes.txt', body: 'route_id\n1\n', store: true }]);
  assert.equal(String(readZipMember(zip, 'routes.txt')), 'route_id\n1\n');
});

test('a nested member matches on its basename, and a near-miss does not', () => {
  const zip = buildZip([
    { name: 'gtfs/routes.txt', body: 'nested\n' },
    { name: 'stop_routes.txt', body: 'decoy\n' },
  ]);
  assert.equal(String(readZipMember(zip, 'routes.txt')), 'nested\n');
});

test('an absent member is null, not an exception and not another member', () => {
  assert.equal(readZipMember(buildZip(GTFS), 'shapes.txt'), null);
});

test('an archive comment does not hide the end-of-central-directory record', () => {
  const zip = buildZip(GTFS, 'built by a publisher that likes comments');
  assert.equal(String(readZipMember(zip, 'routes.txt')), 'route_id,route_type\n01,3\nA,0\n');
});

/**
 * Build a ZIP whose central directory carries ZIP64 sentinels and an extended
 * information extra field — the shape Nice, Angers Irigo and TADAO publish.
 */
function buildZip64(members) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const member of members) {
    const name = Buffer.from(member.name, 'utf8');
    const raw = Buffer.from(member.body, 'utf8');
    const payload = deflateRawSync(raw);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);

    // Extra field: header id 1, then uncompressed, compressed, local offset.
    const extra = Buffer.alloc(4 + 24);
    extra.writeUInt16LE(0x0001, 0);
    extra.writeUInt16LE(24, 2);
    extra.writeBigUInt64LE(BigInt(raw.length), 4);
    extra.writeBigUInt64LE(BigInt(payload.length), 12);
    extra.writeBigUInt64LE(BigInt(offset), 20);

    const dir = Buffer.alloc(46 + name.length + extra.length);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(0xffffffff, 20);
    dir.writeUInt32LE(0xffffffff, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(extra.length, 30);
    dir.writeUInt32LE(0xffffffff, 42);
    name.copy(dir, 46);
    extra.copy(dir, 46 + name.length);

    locals.push(local, payload);
    central.push(dir);
    offset += local.length + payload.length;
  }

  const body = Buffer.concat(locals);
  const directory = Buffer.concat(central);
  const cdOffset = body.length;

  const zip64Eocd = Buffer.alloc(56);
  zip64Eocd.writeUInt32LE(0x06064b50, 0);
  zip64Eocd.writeBigUInt64LE(44n, 4);
  zip64Eocd.writeBigUInt64LE(BigInt(members.length), 24);
  zip64Eocd.writeBigUInt64LE(BigInt(members.length), 32);
  zip64Eocd.writeBigUInt64LE(BigInt(directory.length), 40);
  zip64Eocd.writeBigUInt64LE(BigInt(cdOffset), 48);

  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(cdOffset + directory.length), 8);
  locator.writeUInt32LE(1, 16);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0xffff, 8);
  eocd.writeUInt16LE(0xffff, 10);
  eocd.writeUInt32LE(0xffffffff, 12);
  eocd.writeUInt32LE(0xffffffff, 16);

  return Buffer.concat([body, directory, zip64Eocd, locator, eocd]);
}

test('a ZIP64 archive reads through its locator and extra fields', () => {
  // Nice, Angers Irigo and TADAO all publish this shape; refusing it cost
  // ~460 live vehicles their vehicle type.
  const zip = buildZip64(GTFS);
  assert.equal(String(readZipMember(zip, 'routes.txt')), 'route_id,route_type\n01,3\nA,0\n');
  assert.equal(String(readZipMember(zip, 'agency.txt')), 'agency_id,agency_name\n1,TBM\n');
  assert.equal(readZipMember(zip, 'shapes.txt'), null);
});

test('a ZIP64 EOCD with no locator is refused rather than read from garbage', () => {
  const zip = buildZip(GTFS);
  // Sentinel in the EOCD, but the bytes before it are a central-directory
  // entry, not a locator.
  zip.writeUInt32LE(0xffffffff, zip.length - 22 + 16);
  assert.throws(() => readZipMember(zip, 'routes.txt'), /ZIP64 archive with no locator/);
});

test('a locator pointing somewhere that is not a ZIP64 record is refused', () => {
  const zip = buildZip64(GTFS);
  // Corrupt the ZIP64 record's signature; the locator still points at it.
  const recordAt = zip.length - 22 - 20 - 56;
  zip.writeUInt32LE(0xdeadbeef, recordAt);
  assert.throws(() => readZipMember(zip, 'routes.txt'), /does not point at a ZIP64 record/);
});

test('a chunk that is not a local header is refused', () => {
  assert.throws(
    () => readLocalMember(Buffer.alloc(64), { method: 8, compressedSize: 4 }),
    /local file header/,
  );
});

test('a truncated payload is refused rather than half-inflated', () => {
  const zip = buildZip([{ name: 'routes.txt', body: 'route_id\n1\n' }]);
  const directory = zip.subarray(findEndOfCentralDirectory(zip).offset);
  const entry = findCentralEntry(directory, 'routes.txt');
  assert.throws(() => readLocalMember(zip.subarray(0, 34), entry), /truncated/);
});

test('a buffer with no EOCD at all is refused', () => {
  assert.throws(() => findEndOfCentralDirectory(Buffer.alloc(512)), /no end-of-central-directory/);
});
