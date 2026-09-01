/**
 * Read ONE small member out of a large remote ZIP without downloading it.
 *
 * WHY THIS EXISTS. Joining a GTFS-Realtime vehicle to its `route_type` needs
 * exactly one file from each network's static GTFS: `routes.txt`. Measured
 * 2026-08-31, Bordeaux TBM's archive is 26.7 MB zipped and 250 MB expanded —
 * `stop_times.txt` alone is 223 MB, `shapes.txt` 20 MB — and `routes.txt` is
 * 8.7 KB. Across ~140 French networks, downloading whole archives to read the
 * smallest file in each is well over a gigabyte of transfer for a few hundred
 * kilobytes of answer, which is what turns "refresh the route-type index" from
 * a routine build step into something nobody runs.
 *
 * HOW IT WORKS. Three HTTP range requests, following the ZIP layout backwards:
 *
 *   1. the last 64 KB, to find the End Of Central Directory record;
 *   2. the central directory it points at, to find the member's local header
 *      offset, compressed size and compression method;
 *   3. the member itself, inflated with `zlib.inflateRaw`.
 *
 * ZIP64. Three French networks — Nice, Angers Irigo and TADAO — publish
 * archives whose writer always emits ZIP64 extended-information fields, so the
 * 32-bit sizes and offsets in the ordinary headers are sentinels and the real
 * values live in an extra field. Refusing those cost ~460 live vehicles their
 * vehicle type, so they are parsed rather than skipped.
 *
 * WHEN IT GIVES UP. A server that ignores `Range` (no `206`), or a member that
 * is neither stored nor DEFLATEd, raises; the caller is expected to fall back
 * to a whole-body read. Giving up loudly matters more than covering every
 * case: a silent wrong answer here becomes a bus labelled as a ferry.
 *
 * The parsing half is pure and takes buffers, so `node --test` exercises the
 * ZIP arithmetic against archives it builds in memory, with no network.
 *
 * @module scripts/lib/remoteZip
 */
import { inflateRawSync } from 'node:zlib';

/** `PK\x05\x06` — End Of Central Directory record. */
const EOCD_SIGNATURE = 0x06054b50;
/** `PK\x01\x02` — one central-directory file header. */
const CENTRAL_SIGNATURE = 0x02014b50;
/** `PK\x03\x04` — one local file header. */
const LOCAL_SIGNATURE = 0x04034b50;
/** EOCD is 22 bytes plus a comment of at most 65 535. */
const EOCD_MAX_SEARCH = 22 + 0xffff;
/** Sentinel a ZIP64 archive writes where a 32-bit field would overflow. */
const ZIP64_SENTINEL = 0xffffffff;
/** `PK\x06\x07` — ZIP64 end-of-central-directory locator. */
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
/** `PK\x06\x06` — ZIP64 end-of-central-directory record. */
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
/** Header id of the ZIP64 extended-information extra field. */
const ZIP64_EXTRA_ID = 0x0001;

/**
 * Read a 64-bit little-endian value as a Number.
 *
 * A ZIP64 field is `uint64`, and `readBigUInt64LE` returns a BigInt that would
 * poison every offset arithmetic downstream. Values above `Number.MAX_SAFE_INTEGER`
 * cannot describe an archive anyone is going to range-read, so they raise.
 */
function readUInt64LE(buffer, offset) {
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ZIP64 value beyond safe integer range');
  return Number(value);
}

/**
 * Pull the real sizes and offset out of a central-directory entry's ZIP64
 * extended-information extra field.
 *
 * The field packs only the values whose 32-bit slot held the sentinel, in the
 * fixed order the spec gives (uncompressed, compressed, local offset, disk).
 * Reading them positionally is therefore only correct if the caller says which
 * slots were sentinels — which is what `wanted` is.
 *
 * @param {Buffer} extra The entry's extra-field block.
 * @param {{uncompressed: boolean, compressed: boolean, localOffset: boolean}} wanted
 * @returns {{uncompressedSize?: number, compressedSize?: number, localOffset?: number}}
 */
export function readZip64Extra(extra, wanted) {
  let cursor = 0;
  while (cursor + 4 <= extra.length) {
    const id = extra.readUInt16LE(cursor);
    const size = extra.readUInt16LE(cursor + 2);
    const body = extra.subarray(cursor + 4, cursor + 4 + size);
    if (id === ZIP64_EXTRA_ID) {
      const out = {};
      let at = 0;
      if (wanted.uncompressed && at + 8 <= body.length) { out.uncompressedSize = readUInt64LE(body, at); at += 8; }
      if (wanted.compressed && at + 8 <= body.length) { out.compressedSize = readUInt64LE(body, at); at += 8; }
      if (wanted.localOffset && at + 8 <= body.length) { out.localOffset = readUInt64LE(body, at); at += 8; }
      return out;
    }
    cursor += 4 + size;
  }
  return {};
}

/**
 * Locate the End Of Central Directory record inside the archive's tail.
 *
 * Scanned backwards because the record sits at the very end unless the archive
 * carries a comment, and the first signature found from the end is the real
 * one — a comment containing the signature bytes cannot appear after it.
 *
 * @param {Buffer} tail Final bytes of the archive.
 * @returns {{entries: number, size: number, offset: number}} Central-directory
 *   entry count, byte size, and absolute offset in the archive.
 */
export function findEndOfCentralDirectory(tail, tailStart = 0) {
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== EOCD_SIGNATURE) continue;
    const entries = tail.readUInt16LE(i + 10);
    const size = tail.readUInt32LE(i + 12);
    const offset = tail.readUInt32LE(i + 16);
    if (offset !== ZIP64_SENTINEL && size !== ZIP64_SENTINEL && entries !== 0xffff) {
      return { entries, size, offset };
    }
    // ZIP64: the true values live in a record the locator just before this
    // one points at. `tailStart` converts that absolute offset back into an
    // index in the tail we hold.
    const locator = i - 20;
    if (locator < 0 || tail.readUInt32LE(locator) !== ZIP64_LOCATOR_SIGNATURE) {
      throw new Error('ZIP64 archive with no locator in tail');
    }
    const recordAt = readUInt64LE(tail, locator + 8) - tailStart;
    if (recordAt < 0 || recordAt + 56 > tail.length) {
      throw new Error('ZIP64 end-of-central-directory record outside the fetched tail');
    }
    if (tail.readUInt32LE(recordAt) !== ZIP64_EOCD_SIGNATURE) {
      throw new Error('ZIP64 locator does not point at a ZIP64 record');
    }
    return {
      entries: readUInt64LE(tail, recordAt + 32),
      size: readUInt64LE(tail, recordAt + 40),
      offset: readUInt64LE(tail, recordAt + 48),
    };
  }
  throw new Error('no end-of-central-directory record in tail');
}

/**
 * Find one named member in a central directory.
 *
 * The name is matched on the BASENAME so an archive that nests its feed in a
 * folder (`gtfs/routes.txt`) still resolves — which several French publishers
 * do — while `stop_routes.txt` does not accidentally match `routes.txt`.
 *
 * @param {Buffer} directory Raw central directory.
 * @param {string} name Member basename, e.g. `routes.txt`.
 * @returns {?{name: string, method: number, compressedSize: number,
 *             uncompressedSize: number, localOffset: number}}
 */
export function findCentralEntry(directory, name) {
  const wanted = String(name).toLowerCase();
  let cursor = 0;
  while (cursor + 46 <= directory.length) {
    if (directory.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) break;
    const method = directory.readUInt16LE(cursor + 10);
    const compressedSize = directory.readUInt32LE(cursor + 20);
    const uncompressedSize = directory.readUInt32LE(cursor + 24);
    const nameLength = directory.readUInt16LE(cursor + 28);
    const extraLength = directory.readUInt16LE(cursor + 30);
    const commentLength = directory.readUInt16LE(cursor + 32);
    const localOffset = directory.readUInt32LE(cursor + 42);
    const entryName = directory.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const basename = entryName.split('/').pop().toLowerCase();
    if (basename === wanted) {
      const extra = directory.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength);
      const zip64 = readZip64Extra(extra, {
        uncompressed: uncompressedSize === ZIP64_SENTINEL,
        compressed: compressedSize === ZIP64_SENTINEL,
        localOffset: localOffset === ZIP64_SENTINEL,
      });
      return {
        name: entryName,
        method,
        compressedSize: zip64.compressedSize ?? compressedSize,
        uncompressedSize: zip64.uncompressedSize ?? uncompressedSize,
        localOffset: zip64.localOffset ?? localOffset,
      };
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/**
 * Decode one member from a buffer that starts at its LOCAL header.
 *
 * The local header repeats the name and extra-field lengths, and they need not
 * match the central directory's — the extra field routinely differs — so the
 * payload offset is read here rather than assumed.
 *
 * @param {Buffer} chunk Bytes from the member's local header onward.
 * @param {{method: number, compressedSize: number}} entry Central-directory record.
 * @returns {Buffer} The member's decompressed bytes.
 */
export function readLocalMember(chunk, entry) {
  if (chunk.length < 30 || chunk.readUInt32LE(0) !== LOCAL_SIGNATURE) {
    throw new Error('member does not start with a local file header');
  }
  const nameLength = chunk.readUInt16LE(26);
  const extraLength = chunk.readUInt16LE(28);
  const start = 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > chunk.length) throw new Error('member payload truncated');
  const payload = chunk.subarray(start, end);
  if (entry.method === 0) return Buffer.from(payload);
  if (entry.method === 8) return inflateRawSync(payload);
  throw new Error(`unsupported compression method ${entry.method}`);
}

/**
 * Read a member out of an archive already held in memory.
 *
 * The fallback path for servers that will not serve ranges, and the path the
 * tests use.
 *
 * @param {Buffer} archive Whole ZIP.
 * @param {string} name Member basename.
 * @returns {?Buffer} Decompressed bytes, or null when the member is absent.
 */
export function readZipMember(archive, name) {
  const tailStart = Math.max(0, archive.length - EOCD_MAX_SEARCH);
  const eocd = findEndOfCentralDirectory(archive.subarray(tailStart), tailStart);
  const directory = archive.subarray(eocd.offset, eocd.offset + eocd.size);
  const entry = findCentralEntry(directory, name);
  if (!entry) return null;
  return readLocalMember(archive.subarray(entry.localOffset), entry);
}

/**
 * Fetch a byte range, insisting the server actually honoured it.
 *
 * A server that ignores `Range` answers `200` with the WHOLE body, which for a
 * 26 MB archive is precisely what this module exists to avoid — so a `200` is
 * treated as a refusal, not as a generous success.
 *
 * @param {string} url
 * @param {number} start Inclusive first byte.
 * @param {number} end Inclusive last byte.
 * @param {Object} [options]
 * @param {string} [options.userAgent]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<Buffer>}
 */
async function fetchRange(url, start, end, { userAgent, timeoutMs = 30000 } = {}) {
  const headers = { Range: `bytes=${start}-${end}` };
  if (userAgent) headers['User-Agent'] = userAgent;
  const response = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status !== 206) {
    // Drain so the socket can be reused rather than left hanging.
    await response.arrayBuffer().catch(() => {});
    throw new Error(`range request refused (HTTP ${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Total size of a remote body, from a ranged probe of its first byte.
 *
 * `HEAD` is not used: several data.gouv.fr resources are redirects to storage
 * that answers `HEAD` differently from `GET`, and the `Content-Range` of a
 * one-byte request is authoritative for the URL actually served.
 *
 * @param {string} url
 * @param {Object} [options] Forwarded to {@link fetchRange}.
 * @returns {Promise<number>} Size in bytes.
 */
export async function remoteSize(url, options = {}) {
  const headers = { Range: 'bytes=0-0' };
  if (options.userAgent) headers['User-Agent'] = options.userAgent;
  const response = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(options.timeoutMs ?? 30000),
  });
  await response.arrayBuffer().catch(() => {});
  if (response.status !== 206) throw new Error(`range request refused (HTTP ${response.status})`);
  const total = Number(String(response.headers.get('content-range') || '').split('/')[1]);
  if (!Number.isFinite(total) || total <= 0) throw new Error('no usable content-range');
  return total;
}

/**
 * Read one member from a remote archive using three range requests.
 *
 * @param {string} url Archive URL.
 * @param {string} name Member basename, e.g. `routes.txt`.
 * @param {Object} [options]
 * @param {string} [options.userAgent]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{buffer: ?Buffer, archiveBytes: number, fetchedBytes: number}>}
 *   `buffer` is null when the archive has no such member.
 */
export async function fetchZipMemberRanged(url, name, options = {}) {
  const total = await remoteSize(url, options);
  const tailStart = Math.max(0, total - EOCD_MAX_SEARCH);
  const tail = await fetchRange(url, tailStart, total - 1, options);
  const eocd = findEndOfCentralDirectory(tail, tailStart);

  // The central directory usually lies inside the tail already; only reach for
  // it again when the archive is big enough that it does not.
  let directory;
  if (eocd.offset >= tailStart) {
    directory = tail.subarray(eocd.offset - tailStart, eocd.offset - tailStart + eocd.size);
  } else {
    directory = await fetchRange(url, eocd.offset, eocd.offset + eocd.size - 1, options);
  }

  const entry = findCentralEntry(directory, name);
  if (!entry) return { buffer: null, archiveBytes: total, fetchedBytes: tail.length };

  // The local header's own name/extra lengths are unknown until it is read, so
  // ask for the payload plus a generous header allowance in one request.
  const headerAllowance = 30 + entry.name.length + 4096;
  const memberEnd = Math.min(total - 1, entry.localOffset + headerAllowance + entry.compressedSize);
  const chunk = await fetchRange(url, entry.localOffset, memberEnd, options);
  return {
    buffer: readLocalMember(chunk, entry),
    archiveBytes: total,
    fetchedBytes: tail.length + chunk.length + (eocd.offset >= tailStart ? 0 : directory.length),
  };
}
