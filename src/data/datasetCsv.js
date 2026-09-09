/*
 * A small, honest CSV reader for plugged datasets.
 *
 * French open data is `;`-separated as often as it is `,`-separated, quotes
 * fields that contain the delimiter, and frequently ships a UTF-8 BOM. There
 * is no shared parser in this repo — five proxies and two build scripts each
 * carry their own — so this one is written to be the one the dataset box
 * uses, and to be unit-tested against the shapes those files actually have.
 *
 * It is NOT a streaming parser: a plugged CSV is capped by the manifest's
 * `maxFeatures` and by the relay's byte ceiling long before memory matters.
 *
 * @module data/datasetCsv
 */

export const CSV_DELIMITER_CANDIDATES = Object.freeze([';', ',', '\t', '|']);

/**
 * Pick the delimiter the first line uses: the candidate that splits it into
 * the most cells OUTSIDE quotes. Ties go to `;`, the French default.
 * @param {string} line
 * @returns {string}
 */
export function sniffCsvDelimiter(line) {
  let best = ';';
  let bestCount = -1;
  for (const candidate of CSV_DELIMITER_CANDIDATES) {
    let count = 0;
    let quoted = false;
    for (const char of line) {
      if (char === '"') quoted = !quoted;
      else if (!quoted && char === candidate) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Split one record into cells, RFC 4180 style: quoted cells may hold the
 * delimiter and doubled quotes; whitespace is preserved.
 * @param {string} line
 * @param {string} delimiter
 * @returns {string[]}
 */
export function splitCsvLine(line, delimiter) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

/**
 * Split text into records, honouring quoted newlines.
 * @param {string} text
 * @returns {string[]}
 */
function splitCsvRecords(text) {
  const records = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      quoted = !quoted;
      current += char;
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      records.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.length) records.push(current);
  return records;
}

/**
 * Parse delimited text into a header and row objects.
 *
 * @param {string} text Raw file contents.
 * @param {{delimiter?: string|null, maxRows?: number}} [options]
 *   `delimiter` forces one; `maxRows` stops reading early and reports it.
 * @returns {{header: string[], rows: object[], delimiter: string, truncated: boolean, total: number}}
 *   `total` counts the data records seen, including those past `maxRows`.
 */
export function parseCsv(text, { delimiter = null, maxRows = Number.POSITIVE_INFINITY } = {}) {
  const source = String(text ?? '').replace(/^﻿/, '');
  const records = splitCsvRecords(source).filter((record) => record.trim().length > 0);
  if (!records.length) return { header: [], rows: [], delimiter: delimiter || ';', truncated: false, total: 0 };
  const sep = delimiter || sniffCsvDelimiter(records[0]);
  const header = splitCsvLine(records[0], sep).map((name) => name.trim());
  const rows = [];
  let truncated = false;
  for (let i = 1; i < records.length; i += 1) {
    if (rows.length >= maxRows) { truncated = true; break; }
    const cells = splitCsvLine(records[i], sep);
    const row = {};
    for (let c = 0; c < header.length; c += 1) {
      if (!header[c]) continue;
      row[header[c]] = c < cells.length ? cells[c] : '';
    }
    rows.push(row);
  }
  return { header, rows, delimiter: sep, truncated, total: records.length - 1 };
}
