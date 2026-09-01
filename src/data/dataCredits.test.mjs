// The attribution list's structure — not its wording.
//
// This file exists because one specific merge accident has now happened TWICE
// in this list, and nothing caught it either time. Two branches each append a
// credit at the same point; the three-way merge keeps both bodies but loses the
// `},\n  {` between them; and the result is ONE object literal with two `key`
// properties and two `html` properties. JavaScript takes the last of each, the
// first credit vanishes, and every runtime check still passes — the array is
// well formed, every entry has a key, no key is duplicated. It is simply one
// shorter, and a layer that legally requires attribution has none.
//
// It cost `power-grid-osm` its ODbL notice (found 2026-08-31, by accident,
// while adding an unrelated credit) and then `bison-fute-events` its Licence
// Ouverte notice (found 2026-09-01, the same way). `registerDataCredits`
// de-duplicates BY KEY across entries, which does not help: there is only one
// entry to see.
//
// The guard has to read the SOURCE, because by the time the module is imported
// the evidence has already been discarded by the parser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DATA_CREDITS,
  NATURAL_EARTH_CREDIT,
  OSM_CAMERA_CREDIT,
  TOMTOM_CREDIT,
} from './dataCredits.js';

const SOURCE = readFileSync(fileURLToPath(new URL('./dataCredits.js', import.meta.url)), 'utf8');

/** The `export const DATA_CREDITS = [ ... ];` body, as text. */
function creditsArraySource() {
  const start = SOURCE.indexOf('export const DATA_CREDITS = [');
  assert.notEqual(start, -1, 'DATA_CREDITS declaration not found');
  const end = SOURCE.indexOf('\n];', start);
  assert.notEqual(end, -1, 'DATA_CREDITS array is not terminated');
  return SOURCE.slice(start, end);
}

test('no credit object declares `key` or `html` twice', () => {
  const body = creditsArraySource();
  // Every entry is written as `  {\n    key: ...,\n    html: ...\n  },` — one
  // property per line at four spaces. A merged pair puts two of each inside one
  // literal, so the source count exceeds the array length while every runtime
  // invariant still holds.
  const keys = body.match(/^ {4}key: /gm) || [];
  const htmls = body.match(/^ {4}html:/gm) || [];
  assert.equal(
    keys.length,
    DATA_CREDITS.length,
    `${keys.length} \`key:\` properties in source for ${DATA_CREDITS.length} entries — `
    + 'an object literal is carrying two credits and JavaScript kept only the last',
  );
  assert.equal(
    htmls.length,
    DATA_CREDITS.length,
    `${htmls.length} \`html:\` properties in source for ${DATA_CREDITS.length} entries`,
  );
});

test('every entry has a non-empty key and body, and no key repeats', () => {
  assert.ok(DATA_CREDITS.length > 0);
  const seen = new Set();
  for (const credit of DATA_CREDITS) {
    assert.equal(typeof credit.key, 'string', `${JSON.stringify(credit)} has no key`);
    assert.ok(credit.key.trim(), 'a credit has an empty key');
    assert.equal(typeof credit.html, 'string', `${credit.key} has no html`);
    assert.ok(credit.html.trim(), `${credit.key} has an empty body`);
    assert.ok(!seen.has(credit.key), `duplicate credit key: ${credit.key}`);
    seen.add(credit.key);
  }
  for (const dynamic of [TOMTOM_CREDIT, OSM_CAMERA_CREDIT, NATURAL_EARTH_CREDIT]) {
    assert.ok(dynamic.key && dynamic.html, `${dynamic.key} is malformed`);
    // The conditional credits are registered only when their source activates,
    // so they must NOT also be in the always-on list.
    assert.ok(!seen.has(dynamic.key), `${dynamic.key} is both static and dynamic`);
  }
});

test('the credits lost to this merge shape are present', () => {
  // Named individually rather than counted. A count says "something moved"; a
  // name says which layer is drawing data with no attribution, which is the
  // thing the licence actually turns on.
  const keys = new Set(DATA_CREDITS.map((credit) => credit.key));
  for (const key of ['power-grid-osm', 'bison-fute-events', 'irve-charge-points', 'cadastre-pci']) {
    assert.ok(keys.has(key), `${key} has no attribution entry`);
  }
});
