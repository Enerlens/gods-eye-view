import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MILITARY_SHAPED_CLASSES,
  _militaryGlyphPassesForTest,
  militarySiteGlyph,
} from './militarySiteIcons.js';

/** The SVG behind a data URI. */
const decode = (uri) => Buffer.from(String(uri).split(',')[1], 'base64').toString('utf8');

const BOX = 96;

test('every published class has a shape, and only an unknown one goes without', () => {
  assert.deepEqual(
    [...MILITARY_SHAPED_CLASSES].sort(),
    ['airfield', 'military_land', 'naval_base', 'range'],
  );
  for (const klass of MILITARY_SHAPED_CLASSES) {
    assert.match(militarySiteGlyph(klass), /^data:image\/svg\+xml;base64,/, klass);
  }
  // Null, never a fallback silhouette: a class this module does not know must
  // draw the bare pastille rather than a picture of the wrong object.
  assert.equal(militarySiteGlyph('barracks_v2'), null);
  assert.equal(militarySiteGlyph(''), null);
  assert.equal(militarySiteGlyph(null), null);
});

test('the marks are solid ink, not line art at map size', () => {
  // The complaint this module answers, made testable. The address-marker pack
  // draws its bodies as a 7-unit stroke in this same 96-unit box; at 14 to 30
  // CSS px that reads as a character typed onto the photo. Every mark drawn
  // here carries a FILLED pass instead.
  for (const [name, passes] of Object.entries(_militaryGlyphPassesForTest())) {
    assert.match(passes.fill, /fill="#ffffff"/, `${name} has no filled pass`);
    assert.match(passes.halo, /rgba\(0,0,0,0\.62\)/, `${name} has no halo pass`);
  }

  // The catch-all owns nine marks in ten, so it is the one that must not
  // dissolve: a solid shape, never an outline that closes up at 12 px.
  const shield = decode(militarySiteGlyph('military_land'));
  assert.match(shield, /<g fill="#ffffff" stroke="none">/);
  assert.equal(/stroke-width="[\d.]+"[^>]*>\s*<path[^>]*\/>\s*<\/g>\s*$/.test(shield), false);
});

test('the target keeps a readable band and a transparent gap', () => {
  const target = decode(militarySiteGlyph('range'));
  const radii = [...target.matchAll(/a(\d+),\d+ 0 1,0/g)].map((match) => Number(match[1]));
  // Three circles of two arcs each, drawn twice: the halo pass and the fill
  // pass are the SAME geometry, which is what makes the dark edge grow out of
  // the white one instead of sitting beside it.
  assert.equal(radii.length, 12);
  assert.deepEqual(radii.slice(0, 6), radii.slice(6));
  const [outer, inner, bull] = [radii[0], radii[2], radii[4]];
  assert.ok(outer / (BOX / 2) > 0.7, 'the ring must fill its box');
  assert.ok(outer - inner >= 8, `ring band ${outer - inner} units is a hairline`);
  assert.ok(bull >= 10, 'the bull must survive minification');
  // Evenodd is what makes the ring a ring and leaves the gap TRANSPARENT. An
  // opaque glyph flattens the key's masked swatch into a plain disc, which is
  // the one thing the shape channel exists to prevent.
  assert.match(target, /fill-rule="evenodd"/);
});

test('this module borrows artwork and never vendors a second copy', () => {
  const source = fs.readFileSync(new URL('./militarySiteIcons.js', import.meta.url), 'utf8');
  // A vendored outline — a Material silhouette, an Inter letterform — is
  // hundreds of characters of path data. Everything here is either fetched
  // through another pack's public door or is geometry: circles, and a shield
  // that is four lines and two curves.
  const literals = [...source.matchAll(/["'`]M[\d\s,.\-A-Za-z]{60,}/g)];
  assert.deepEqual(literals.map((match) => match[0].slice(0, 40)), []);
});

test('rasters are cached per class and per size', () => {
  const first = militarySiteGlyph('range');
  assert.equal(militarySiteGlyph('range'), first, 'the same raster is rebuilt');
  const small = militarySiteGlyph('range', { px: 32 });
  assert.notEqual(small, first);
  assert.match(decode(small), /width="32" height="32"/);
  assert.match(decode(first), /width="88" height="88"/);
});
