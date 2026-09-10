// The road-event marks: whose artwork it is, that the nine really differ, and
// that the same geometry reaches both the globe and the key.
//
// The property that matters most here is the LICENCE one. Only each Material
// Symbols `d` string is vendored, verbatim, in Google's own `0 -960 960 960`
// box — `licenses/material-symbols/NOTICE` claims exactly that, in writing, and
// a silent redraw would make the notice false rather than merely stale.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ROAD_EVENT_CATEGORY_SYMBOLS,
  ROAD_EVENT_GLYPH_PX,
  ROAD_EVENT_SYMBOL_PATHS,
  _roadEventGlyphBodyForTest,
  roadEventGlyph,
  roadEventMaskGlyph,
} from './roadEventGlyphs.js';
import { ROAD_EVENT_CATEGORIES, ROAD_EVENT_UNKNOWN_CATEGORY } from './roadEventsFrance.js';

const decode = (uri) => Buffer.from(uri.split('base64,')[1], 'base64').toString('utf8');
const CATEGORY_IDS = [
  ...Object.keys(ROAD_EVENT_CATEGORIES), ROAD_EVENT_UNKNOWN_CATEGORY.id,
];

test('every category the layer can draw has its own symbol, and no two share one', () => {
  for (const id of CATEGORY_IDS) {
    const symbol = ROAD_EVENT_CATEGORY_SYMBOLS[id];
    assert.ok(symbol, `no symbol for ${id}`);
    assert.ok(ROAD_EVENT_SYMBOL_PATHS[symbol], `no artwork for ${symbol}`);
  }
  assert.equal(Object.keys(ROAD_EVENT_CATEGORY_SYMBOLS).length, CATEGORY_IDS.length);
  const symbols = Object.values(ROAD_EVENT_CATEGORY_SYMBOLS);
  assert.equal(new Set(symbols).size, symbols.length, 'two categories cannot draw one shape');
  const bodies = CATEGORY_IDS.map(_roadEventGlyphBodyForTest);
  assert.equal(new Set(bodies).size, bodies.length);
});

test('the artwork is Google\'s, verbatim, in Google\'s own coordinate box', () => {
  // What the NOTICE promises: the path data is unmodified and NOT rescaled.
  // A `d` string outside the `0 -960 960 960` box would mean somebody redrew
  // it, which is the claim this test exists to keep honest.
  for (const [name, d] of Object.entries(ROAD_EVENT_SYMBOL_PATHS)) {
    assert.match(d, /^M/, `${name} is not a path`);
    assert.ok(d.length > 250, `${name} looks truncated`);
    // Material's box puts y in [-960, 0]: every vertical coordinate is
    // negative or zero, which a rescale into a 0..24 or 0..96 box would break.
    // `M680-640` has no separator: the minus sign is the separator.
    const ys = [...d.matchAll(/[ML]\s*(-?\d*\.?\d+)[\s,]*(-?\d*\.?\d+)/g)]
      .map((match) => Number(match[2]));
    assert.ok(ys.length > 0, `${name} has no absolute vertices to check`);
    for (const y of ys) assert.ok(y <= 0 && y >= -960, `${name} has a vertex at y=${y}`);
  }
  // And the notice itself has to name this module and its glyphs, or the
  // Apache-2.0 §4 attribution does not travel with the artwork.
  const notice = readFileSync(new URL('../../licenses/material-symbols/NOTICE', import.meta.url), 'utf8');
  assert.match(notice, /roadEventGlyphs\.js/);
  for (const symbol of Object.values(ROAD_EVENT_CATEGORY_SYMBOLS)) {
    assert.ok(notice.includes(symbol), `the notice does not list ${symbol}`);
  }
});

test('a mark is tint-safe: dark halo under white fill, one shared texture per category', () => {
  const svg = decode(roadEventGlyph('travaux'));
  // Cesium multiplies `billboard.color` into the texture. White artwork takes
  // the tint; a black halo stays black under any multiply, which is what keeps
  // the shape readable over pale terrain.
  assert.match(svg, /fill="#ffffff"/);
  assert.match(svg, /stroke="rgba\(0,0,0,0\.55\)"/);
  assert.match(svg, /viewBox="0 -960 960 960"/);
  assert.match(svg, new RegExp(`width="${ROAD_EVENT_GLYPH_PX}"`));
  // The SAME string comes back every time, so the atlas holds one entry per
  // category and not one per event.
  assert.equal(roadEventGlyph('travaux'), roadEventGlyph('travaux'));
  assert.notEqual(roadEventGlyph('travaux'), roadEventGlyph('accident'));
});

test('the legend mask is the same geometry, with no halo and no colour of its own', () => {
  // The panel paints the ROW's ink through the mask, so the pastille IS the
  // mark at the key's size. A mask carrying a halo would print a shape the map
  // does not draw; a mask carrying a fill colour would fight the row's ink.
  const mask = decode(roadEventMaskGlyph('fermeture'));
  assert.equal(/stroke=/.test(mask), false);
  assert.equal(/#ffffff/.test(mask), false);
  assert.ok(mask.includes(ROAD_EVENT_SYMBOL_PATHS[ROAD_EVENT_CATEGORY_SYMBOLS.fermeture]));
  assert.ok(decode(roadEventGlyph('fermeture'))
    .includes(ROAD_EVENT_SYMBOL_PATHS[ROAD_EVENT_CATEGORY_SYMBOLS.fermeture]));
});

test('an unknown category falls to the question mark, never to a real one', () => {
  const stranger = decode(roadEventMaskGlyph('quelque-chose-de-2030'));
  assert.ok(stranger.includes(ROAD_EVENT_SYMBOL_PATHS.question_mark));
  for (const id of Object.keys(ROAD_EVENT_CATEGORIES)) {
    assert.notEqual(_roadEventGlyphBodyForTest('quelque-chose-de-2030'),
      _roadEventGlyphBodyForTest(id));
  }
});
