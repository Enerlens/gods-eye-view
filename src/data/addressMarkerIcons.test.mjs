// src/data/addressMarkerIcons.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADDRESS_GLYPH_KINDS,
  _addressGlyphBodiesForTest,
  addressMarkerGlyph,
  dpeLetterKind,
  idfmStopGlyphKind,
} from './addressMarkerIcons.js';
import { TRANSIT_GLYPH_KINDS, transitVehicleGlyph } from './transitVehicleIcons.js';

/** The SVG behind a data URI, so a test can read the artwork it asserts on. */
function svgOf(uri) {
  assert.match(uri, /^data:image\/svg\+xml;base64,/);
  return Buffer.from(uri.split(',')[1], 'base64').toString('utf8');
}

/**
 * The whole point of the pack: two registers over the same roof must not draw
 * the same picture. Colour was already spent — DVF on the price ratio, DPE on
 * the official scale — so the shape is the only channel left to say which
 * layer a marker came from.
 */
test('every register draws a different silhouette', () => {
  const perLayer = ['euro', 'dpe:C', 'hazard', 'plan'];
  const uris = perLayer.map((kind) => addressMarkerGlyph(kind));
  assert.equal(new Set(uris).size, perLayer.length);
  // And the IDFM stops, which borrow from the transit pack, must not collide
  // with any of them either.
  const withStops = new Set([...uris, transitVehicleGlyph('metro'), transitVehicleGlyph('bus')]);
  assert.equal(withStops.size, perLayer.length + 2);
});

test('the seven DPE grades are seven different pictures', () => {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'unknown'];
  const uris = letters.map((letter) => addressMarkerGlyph(`dpe:${letter}`));
  assert.equal(new Set(uris).size, letters.length);
  const { letters: geometry } = _addressGlyphBodiesForTest();
  assert.equal(new Set(Object.values(geometry)).size, letters.length);
});

test('a DPE grade is read, never guessed', () => {
  for (const letter of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
    assert.equal(dpeLetterKind(letter), letter);
    assert.equal(dpeLetterKind(letter.toLowerCase()), letter);
  }
  // Absent, blank, or a value the register invents after this ships. Each
  // draws the question mark — NOT the nearest letter, which would be the
  // layer asserting a grade nobody published.
  for (const absent of [null, undefined, '', '  ', 'H', 'N/A', 'unknown', 42]) {
    assert.equal(dpeLetterKind(absent), 'unknown');
  }
});

test('the euro sign is an open arc with two bars, not a C', () => {
  const svg = svgOf(addressMarkerGlyph('euro'));
  const { bodies } = _addressGlyphBodiesForTest();
  // `A30,30 0 1 0` — the large-arc flag is what leaves room on the left for
  // the bars to cross. Without it the glyph closes up into a plain C.
  assert.match(bodies.euro.strokes, /A30,30 0 1 0/);
  assert.equal((bodies.euro.strokes.match(/ L60,/g) || []).length, 2, 'two crossbars');
  assert.ok(svg.includes(bodies.euro.strokes));
});

/**
 * Cesium multiplies `billboard.color` into the texture. White line-art takes
 * the layer's value colour exactly; black survives the multiply (0 × c = 0)
 * and keeps the glyph off a pale orthophoto. A hue baked into the artwork
 * would fight the tint and destroy the channel each layer spends colour on.
 */
test('every glyph is tint-safe: white art over a black halo, and no other hue', () => {
  for (const kind of ADDRESS_GLYPH_KINDS) {
    const svg = svgOf(addressMarkerGlyph(kind));
    assert.ok(svg.includes('#ffffff'), `${kind} draws white art`);
    assert.ok(svg.includes('rgba(0,0,0,0.62)'), `${kind} draws a dark halo`);
    // Any colour token that is neither the white art nor the black halo.
    const colours = svg.match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)/gi) || [];
    const foreign = colours.filter((token) => token !== '#ffffff' && token !== 'rgba(0,0,0,0.62)');
    assert.deepEqual(foreign, [], `${kind} carries no hue of its own`);
  }
});

test('the halo is drawn under the art, never over it', () => {
  const svg = svgOf(addressMarkerGlyph('hazard'));
  assert.ok(svg.indexOf('rgba(0,0,0,0.62)') < svg.indexOf('#ffffff'),
    'the dark pass comes first in document order');
});

test('a DPE badge frames its letter, and the frame is thinner than the letter', () => {
  const svg = svgOf(addressMarkerGlyph('dpe:F'));
  assert.match(svg, /<rect x="13" y="13" width="70" height="70" rx="17"\/>/);
  // Both weights read off the WHITE passes — the dark halo also strokes the
  // rect, and matching that instead compares the frame against itself.
  const frameWidth = Number(svg.match(/stroke="#ffffff" stroke-width="(\d+)"[^>]*><rect/)?.[1]);
  const letterWidth = Number(svg.match(/stroke="#ffffff" stroke-width="(\d+)"[^>]*><path/)?.[1]);
  assert.ok(frameWidth > 0 && letterWidth > 0, 'both passes are drawn');
  assert.ok(frameWidth < letterWidth,
    `frame ${frameWidth} is lighter than the letter ${letterWidth}, so the grade owns the glyph`);
  // No other register wears the frame; it is what says "this is a label".
  assert.ok(!svgOf(addressMarkerGlyph('euro')).includes('<rect'));
});

test('glyphs are built once and reused', () => {
  const first = addressMarkerGlyph('euro');
  assert.equal(addressMarkerGlyph('euro'), first, 'same string, not merely equal');
  assert.notEqual(addressMarkerGlyph('euro', { px: 44 }), first, 'a new raster is a new entry');
});

test('an unknown register draws the plan sheet rather than throwing', () => {
  assert.equal(addressMarkerGlyph('no-such-register'), addressMarkerGlyph('plan'));
});

/**
 * A stop is signed in the street with its mode's pictogram, so IDFM borrows
 * the transit pack instead of inventing a second transit vocabulary for the
 * same city.
 */
test('every IDFM mode resolves to a transit pictogram', () => {
  for (const mode of ['metro', 'rail', 'tram', 'bus', 'funicular', 'cableway']) {
    const kind = idfmStopGlyphKind(mode);
    assert.ok(TRANSIT_GLYPH_KINDS.includes(kind), `${mode} → ${kind} is drawable`);
  }
  // The one substitution: IDFM's `cableway` is Material's cable car, which the
  // transit pack keys as `aerial`.
  assert.equal(idfmStopGlyphKind('cableway'), 'aerial');
  assert.equal(idfmStopGlyphKind('metro'), 'metro');
  // A mode nobody has published yet must not silently become another mode.
  assert.ok(!TRANSIT_GLYPH_KINDS.includes(idfmStopGlyphKind('teleporter')));
});

test('the raster is square and carries the authoring box', () => {
  const svg = svgOf(addressMarkerGlyph('plan', { px: 88 }));
  assert.match(svg, /width="88" height="88"/);
  assert.match(svg, /viewBox="0 0 96 96"/);
});
