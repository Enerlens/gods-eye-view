import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, sniffCsvDelimiter, splitCsvLine } from './datasetCsv.js';

test('sniffs the French semicolon, the comma, the tab and the pipe', () => {
  assert.equal(sniffCsvDelimiter('a;b;c'), ';');
  assert.equal(sniffCsvDelimiter('a,b,c'), ',');
  assert.equal(sniffCsvDelimiter('a\tb\tc'), '\t');
  assert.equal(sniffCsvDelimiter('a|b|c'), '|');
  assert.equal(sniffCsvDelimiter('"x;y",b,c'), ',', 'a delimiter inside quotes does not count');
});

test('splits quoted cells with embedded delimiters and doubled quotes', () => {
  assert.deepEqual(splitCsvLine('a;"b;c";"d ""e"" f";', ';'), ['a', 'b;c', 'd "e" f', '']);
});

test('parses a BOM-prefixed French file with a quoted newline and a decimal comma', () => {
  const text = '﻿nom;longitude;latitude;note\n"Gare, Nord";2,3594;48,8809;"deux\nlignes"\nAutre;2.35;48.86;\n';
  const parsed = parseCsv(text);
  assert.equal(parsed.delimiter, ';');
  assert.deepEqual(parsed.header, ['nom', 'longitude', 'latitude', 'note']);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].nom, 'Gare, Nord');
  assert.equal(parsed.rows[0].note, 'deux\nlignes');
  assert.equal(parsed.rows[1].latitude, '48.86');
  assert.equal(parsed.total, 2);
  assert.equal(parsed.truncated, false);
});

test('maxRows stops early and says so, keeping the true total', () => {
  const text = 'a,b\n1,2\n3,4\n5,6\n';
  const parsed = parseCsv(text, { maxRows: 2 });
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.total, 3);
});

test('an empty file is empty, not an error', () => {
  assert.deepEqual(parseCsv('').rows, []);
  assert.deepEqual(parseCsv('\n\n').header, []);
});
