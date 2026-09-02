// src/data/addressMarkerIcons.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  // Compare the outlines themselves. `Object.values` on the table returns eight
  // distinct OBJECTS whatever they contain, so a set of those would pass even
  // if every letter shared one path.
  assert.equal(new Set(Object.values(geometry).map((g) => g.d)).size, letters.length);
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

test('a DPE badge frames its letter, and the frame never outweighs the grade', () => {
  const svg = svgOf(addressMarkerGlyph('dpe:F'));
  assert.match(svg, /<rect x="13" y="13" width="70" height="70" rx="17"\/>/);
  // The frame is a thin STROKE and the letter is a solid FILL, which is what
  // keeps the grade the heaviest thing in the badge whatever the letter is.
  const frameWidth = Number(svg.match(/stroke="#ffffff" stroke-width="(\d+)"[^>]*><rect/)?.[1]);
  assert.ok(frameWidth > 0 && frameWidth <= 6, `frame stroke ${frameWidth} is a hairline`);
  assert.match(svg, /<g transform="translate\([^"]+\)" fill="#ffffff" stroke="none">/,
    'the letter is filled artwork, not stroked line-art');
  // No other register wears the frame; it is what says "this is a label".
  assert.ok(!svgOf(addressMarkerGlyph('euro')).includes('<rect'));
});

test("the badge letters are Inter's outlines, placed but never redrawn", () => {
  // The whole point of taking a typeface is that the letterforms stay the type
  // designer's. The stored `d` must be what the font contains — em-space
  // coordinates, in the thousands — and the box placement must happen in the
  // transform, where it can be read and checked, not baked into the path.
  const { letters } = _addressGlyphBodiesForTest();
  for (const [name, glyph] of Object.entries(letters)) {
    assert.match(glyph.d, /^M/, `${name} should start with a moveto`);
    const coords = [...glyph.d.matchAll(/-?\d*\.?\d+/g)].map((m) => Math.abs(Number(m[0])));
    assert.ok(Math.max(...coords) > 500,
      `${name} looks rescaled out of Inter's 2048-unit em space`);
    const svg = svgOf(addressMarkerGlyph(`dpe:${name}`));
    assert.ok(svg.includes(glyph.d), `${name} does not draw the vendored outline`);
  }
  // The round letters must carry quadratic curves — TrueType outlines of a bowl
  // do, and the stroked arcs this replaced did not. Not asserted for every
  // letter: Inter's E and F are rectilinear, as a grotesque E and F should be.
  for (const round of ['B', 'C', 'D', 'G', 'unknown']) {
    assert.ok(letters[round].d.includes('Q'), `${round} has no curves — still an outline?`);
  }
  for (const straight of ['E', 'F']) {
    assert.ok(!letters[straight].d.includes('Q'), `${straight} should be pure straight lines`);
  }
});

test('every letter shares one baseline and one cap height', () => {
  // Scaling each letter to fill its own box would undo the overshoot a type
  // designer builds into round letters: the C would end up shorter than the E.
  // One scale and one baseline for all eight is what makes them a family.
  const transforms = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'unknown'].map((letter) => {
    const svg = svgOf(addressMarkerGlyph(`dpe:${letter}`));
    const match = svg.match(/translate\(([-\d.]+) ([\d.]+)\) scale\(([\d.]+) (-[\d.]+)\)/);
    assert.ok(match, `${letter} has no placement transform`);
    return { tx: Number(match[1]), baseline: Number(match[2]), scale: Number(match[3]) };
  });
  assert.equal(new Set(transforms.map((t) => t.baseline)).size, 1, 'one baseline');
  assert.equal(new Set(transforms.map((t) => t.scale)).size, 1, 'one cap-height scale');
  // Each letter is centred on its own width, so the x offsets must differ —
  // a single shared tx would left-align them instead.
  assert.ok(new Set(transforms.map((t) => t.tx)).size > 1, 'each letter is centred on itself');
});

test("the letter halo is narrower than the pack's, or the counters close", () => {
  // The halo strokes the outline, so half of it falls INSIDE the letter. At the
  // pack's 12 the bowl of the A fills in and the badge reads as a triangle.
  const svg = svgOf(addressMarkerGlyph('dpe:A'));
  const haloFontUnits = Number(svg.match(/stroke-width="([\d.]+)" stroke-linejoin="round">/)?.[1]);
  const scale = Number(svg.match(/scale\(([\d.]+) -/)?.[1]);
  assert.ok(haloFontUnits > 0 && scale > 0);
  const haloBoxUnits = haloFontUnits * scale;
  assert.ok(haloBoxUnits < 12,
    `letter halo ${haloBoxUnits.toFixed(1)} must stay under the pack's 12`);
  assert.ok(haloBoxUnits >= 3, 'and wide enough to lift white art off pale ground');
});

test("Inter's licence and notice ship with the letterforms", () => {
  const licence = readFileSync(new URL('../../licenses/inter/LICENSE', import.meta.url), 'utf8');
  assert.match(licence, /SIL OPEN FONT LICENSE/i);
  const notice = readFileSync(new URL('../../licenses/inter/NOTICE', import.meta.url), 'utf8');
  assert.match(notice, /rsms\/inter|google\/fonts/);
  // The notice states which instance was extracted; a different weight would
  // be different artwork and the record would no longer describe it.
  assert.match(notice, /wght 700/);
  assert.match(notice, /opsz 14/);
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
  // The one substitution: IDFM's `cableway` is the class the transit pack keys
  // as `aerial` — which draws Maki's `aerialway`, not a Material Symbol.
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
