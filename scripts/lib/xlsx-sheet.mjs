/**
 * @module xlsx-sheet
 *
 * Read one sheet out of an `.xlsx` as rows of strings. Nothing else.
 *
 * WHY THIS EXISTS: the DREES publishes the **APL** — the official
 * *accessibilité potentielle localisée*, the indicator behind every "désert
 * médical" map in France — as `.xlsx` and only as `.xlsx`. Its own Opendatasoft
 * portal exposes the dataset with `records_count: 0`: the tables are file
 * attachments, not records, so there is no API to ask instead. Every other
 * route checked on 2026-09-01 was worse — the second data.gouv APL dataset
 * offers an `ivt, xls, csv` blob last touched in 2014, and the Observatoire des
 * territoires answers HTML to its own API path.
 *
 * So one file has to be unzipped and its XML read, and this does exactly that
 * with `node:zlib` and no new dependency. `yauzl` and `@zip.js` are both
 * present in `node_modules`, and both are transitive dependencies of puppeteer
 * — reaching into them would make a data build fail the day a dev dependency
 * reshuffles.
 *
 * What it does NOT do, deliberately: styles, number formats, dates, formulas,
 * merged cells. A cell comes back as the string the file stores. Dates would
 * come back as Excel serial numbers, and the caller has to know that — no
 * caller here needs one.
 */

import zlib from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/**
 * Read a ZIP central directory into `name → Buffer`.
 *
 * The central directory is read rather than the local headers, because a local
 * header is allowed to carry zero sizes and defer them to a data descriptor
 * after the payload — which is exactly what a streaming writer emits, and it
 * cannot be parsed forwards. The central directory always has the true sizes.
 */
function unzip(buffer) {
  let eocd = -1;
  // The EOCD sits at the very end unless a ZIP comment follows it; 64 KB is the
  // maximum a comment can be, so scanning back that far always finds it.
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP archive: no end-of-central-directory record');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const files = new Map();

  for (let entry = 0; entry < entryCount; entry += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error(`corrupt ZIP: central directory entry ${entry} has no signature`);
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error(`corrupt ZIP: ${name} has no local header`);
    }
    // The local header's own name/extra lengths, NOT the central ones — a
    // writer may pad the local extra field differently, and using the central
    // length here lands the read in the middle of the payload.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const payload = buffer.subarray(start, start + compressedSize);

    if (method === 0) files.set(name, payload);
    else if (method === 8) files.set(name, zlib.inflateRawSync(payload));
    else throw new Error(`unsupported ZIP compression method ${method} for ${name}`);

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const XML_ENTITIES = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
});

function decodeXml(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return XML_ENTITIES[entity] ?? match;
  });
}

/** `A` → 0, `Z` → 25, `AA` → 26. Column letters are base-26 with no zero. */
function columnIndex(reference) {
  let index = 0;
  for (const char of reference) {
    if (char < 'A' || char > 'Z') break;
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

/**
 * Shared strings are the string table an xlsx uses instead of repeating text.
 * An `<si>` can hold several `<t>` runs (mixed formatting inside one cell), so
 * the runs are concatenated — taking only the first would silently truncate
 * every styled commune name.
 */
function readSharedStrings(files) {
  const xml = files.get('xl/sharedStrings.xml');
  if (!xml) return [];
  const text = xml.toString('utf8');
  const strings = [];
  for (const [, item] of text.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let value = '';
    for (const [, run] of item.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) value += run;
    strings.push(decodeXml(value));
  }
  return strings;
}

function sheetPathByName(files) {
  const workbook = files.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const rels = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const targetById = new Map();
  for (const [, id, target] of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    targetById.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  }
  const byName = new Map();
  for (const [, name, id] of workbook.matchAll(/<sheet\s[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const target = targetById.get(id);
    if (target) byName.set(decodeXml(name), target);
  }
  return byName;
}

/**
 * Sheet names in workbook order.
 *
 * Exported so a caller can pick the newest `APL <year>` tab instead of naming
 * one: the DREES adds a tab per millésime and drops the oldest, so any literal
 * sheet name is a build that breaks silently next July.
 *
 * @param {Buffer} buffer  the `.xlsx` file
 * @returns {string[]}
 */
export function listXlsxSheets(buffer) {
  return [...sheetPathByName(unzip(buffer)).keys()];
}

/**
 * @param {Buffer} buffer  the `.xlsx` file
 * @param {string} sheetName  exact sheet name, as the tab shows it
 * @returns {string[][]}  rows of cells, `''` for empty, ragged rows padded
 */
export function readXlsxSheet(buffer, sheetName) {
  const files = unzip(buffer);
  const path = sheetPathByName(files).get(sheetName);
  if (!path) {
    throw new Error(`sheet "${sheetName}" not found — have: ${[...sheetPathByName(files).keys()].join(', ')}`);
  }
  const strings = readSharedStrings(files);
  const xml = files.get(path)?.toString('utf8');
  if (!xml) throw new Error(`sheet "${sheetName}" resolves to ${path}, which is not in the archive`);

  const rows = [];
  for (const [, row] of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cell of row.matchAll(/<c\s([^>]*?)\/?>(?:([\s\S]*?)<\/c>)?/g)) {
      const attributes = cell[1];
      const body = cell[2] ?? '';
      const reference = /r="([A-Z]+)\d+"/.exec(attributes)?.[1];
      const type = /t="(\w+)"/.exec(attributes)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];

      let value = '';
      if (type === 's' && raw !== undefined) value = strings[Number.parseInt(raw, 10)] ?? '';
      else if (type === 'inlineStr') {
        for (const [, run] of body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) value += run;
        value = decodeXml(value);
      } else if (raw !== undefined) value = decodeXml(raw);

      // Honour `r=` rather than appending in document order: a sheet omits
      // empty cells entirely, so column C of a row whose A and B are blank
      // arrives first and would land in column A without this.
      const index = reference ? columnIndex(reference) : cells.length;
      while (cells.length < index) cells.push('');
      cells[index] = value;
    }
    rows.push(cells);
  }
  return rows;
}
