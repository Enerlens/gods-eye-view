import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseMilitaryFrancePack,
  recordsInBox,
} from './militaryFrancePack.js';
import { MILITARY_TAG_FILTERS } from './militaryInstallationData.js';

const PACK_PATH = new URL('./local_data/military/military-fr.jsonl', import.meta.url);
const packText = fs.readFileSync(PACK_PATH, 'utf8');
const packLines = packText.split('\n').filter((line) => line.trim());
const meta = JSON.parse(packLines[0]);

test('the committed pack carries its own provenance', () => {
  // Not decoration: the layer prints this date in its key, because a mark drawn
  // from a file is a claim about the day the file was made and not about now.
  assert.equal(meta.pack, 'military-fr');
  assert.match(meta.retrievedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(meta.source, 'OpenStreetMap');
  assert.equal(meta.licence, 'ODbL 1.0');
  assert.match(meta.scope, /ISO3166-1=FR/);
  assert.equal(meta.count, packLines.length - 1);
});

test('the pack and the live proxy select the same features', () => {
  // The two sources hand over to each other as the camera moves. A feature one
  // selects and the other does not would appear and disappear at the altitude
  // of the handover, which reads as a bug in the data rather than in the query.
  assert.deepEqual(meta.filters, [...MILITARY_TAG_FILTERS]);
  const viteConfig = fs.readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  for (const filter of MILITARY_TAG_FILTERS) {
    // The proxy writes them into a query string; the shape differs, the
    // selector must not.
    const selector = filter.replaceAll('"', '\\"').slice(1, -1);
    assert.ok(
      viteConfig.includes(filter) || viteConfig.includes(selector.replaceAll('\\"', '"')),
      `the live proxy no longer selects ${filter}`,
    );
  }
});

test('the pack parses into the same records the live payload does', () => {
  const { records, retrievedAt, count } = parseMilitaryFrancePack(packText);
  assert.equal(retrievedAt, meta.retrievedAt);
  assert.equal(count, meta.count);
  assert.ok(records.length > 3000, `only ${records.length} records — the pack looks truncated`);

  for (const record of records) {
    assert.equal(record.kind, 'installation');
    assert.ok(record.pack, 'a pack record must say so, or the live answer cannot win the merge');
    assert.match(record.id, /^osm:(node|way|relation):\d+$/);
    assert.ok(Number.isFinite(record.latitude) && Number.isFinite(record.longitude));
    // The timestamp is the DAY OF THE SURVEY, never the day of the render.
    assert.equal(record.retrievedAt, meta.retrievedAt);
  }
  // Every class the key publishes, and no class it does not.
  const classes = new Set(records.map((record) => record.class));
  assert.deepEqual([...classes].sort(), ['airfield', 'military_land', 'naval_base', 'range']);
  // No footprints: `out center tags` returns centres, and the key says so.
  assert.equal(records.filter((record) => record.footprint).length, 0);
});

test('the pack is deterministic, and small enough to ship', () => {
  // Committed file: two machines must produce the same bytes, so the diff of a
  // rebuild shows what OSM changed and nothing else.
  const ids = packLines.slice(1).map((line) => {
    const element = JSON.parse(line);
    return `${element.type[0]}${element.id}`;
  });
  assert.deepEqual(ids, [...ids].sort(), 'elements must be in code-point id order');
  assert.equal(new Set(ids).size, ids.length, 'an element is in the pack twice');

  // Coordinates are rounded at build time; a full float would inflate the file
  // by a third for a precision a locator mark cannot use.
  for (const line of packLines.slice(1, 200)) {
    const { center } = JSON.parse(line);
    assert.equal(String(center.lat).replace(/^-?\d+\.?/, '').length <= 5, true, line);
  }
  const bytes = fs.statSync(PACK_PATH).size;
  assert.ok(bytes < 1_500_000, `${bytes} bytes is past what a layer should fetch on enable`);
});

test('a pack file with no metadata line is refused, never read as data', () => {
  // A header parsed as a feature puts a mark at latitude undefined, and the
  // layer draws it as a site.
  assert.throws(() => parseMilitaryFrancePack('{"type":"node","id":1}\n'), /metadata/);
  assert.throws(() => parseMilitaryFrancePack(''), /empty/);
});

test('the box filter takes a point in and leaves the neighbours out', () => {
  const records = [
    { id: 'a', latitude: 48.85, longitude: 2.35 },
    { id: 'b', latitude: 43.12, longitude: 5.93 },
    { id: 'c', latitude: -20.88, longitude: 55.45 },
  ];
  const paris = { south: 48.5, west: 2.0, north: 49.2, east: 2.8 };
  assert.deepEqual(recordsInBox(records, paris).map((one) => one.id), ['a']);
  // A null box is "no rectangle to test against", which is every record — the
  // pack is local, so a wide camera is not a reason to hide it.
  assert.equal(recordsInBox(records, null).length, 3);
  assert.equal(recordsInBox(null, paris).length, 0);
});
