// The shape channel.
//
// Shape on the shared-mobility layer means exactly one thing: WHAT this object
// is. Colour is spent on the operator, so a bike and a scooter that share a
// silhouette are simply merged — nothing else on screen would tell them apart.
// These tests pin the three properties that keeps true: every kind draws its
// own geometry, an unknown kind is never given someone else's, and the glyph
// stays tint-safe so `billboard.color` can carry the operator.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sharedMobilityGlyph,
  sharedMobilityGlyphKind,
  SHARED_MOBILITY_GLYPH_KINDS,
  _sharedMobilityGlyphBodyForTest,
} from './sharedMobilityIcons.js';
import { VEHICLE_KIND_LABELS } from './gbfsFeeds.js';

const decode = (uri) => Buffer.from(uri.split('base64,')[1], 'base64').toString('utf8');

test('every kind the feeds can report has a glyph of its own', () => {
  // The layer folds `form_factor` + `propulsion_type` onto these six; a kind
  // with no drawing would silently inherit whatever `other` looks like.
  for (const kind of Object.keys(VEHICLE_KIND_LABELS)) {
    assert.ok(SHARED_MOBILITY_GLYPH_KINDS.includes(kind), `no glyph for ${kind}`);
  }
  assert.ok(SHARED_MOBILITY_GLYPH_KINDS.includes('station'), 'a dock is drawn as a place, not a vehicle');
});

test('no two kinds share geometry', () => {
  const geometries = SHARED_MOBILITY_GLYPH_KINDS.map((kind) => {
    const body = _sharedMobilityGlyphBodyForTest(kind);
    return `${body.strokes}|${body.fills}`.replace(/\s+/g, '');
  });
  assert.equal(new Set(geometries).size, SHARED_MOBILITY_GLYPH_KINDS.length);
  const uris = SHARED_MOBILITY_GLYPH_KINDS.map((kind) => sharedMobilityGlyph(kind));
  assert.equal(new Set(uris).size, SHARED_MOBILITY_GLYPH_KINDS.length);
});

test('a bike and an e-bike differ by INK, not only by line placement', () => {
  // They are deliberately the same bicycle. The e-bike's bolt is what has to
  // survive minification to ~16 px, so it must be extra geometry rather than a
  // rearrangement of the frame.
  const bike = _sharedMobilityGlyphBodyForTest('bike');
  const ebike = _sharedMobilityGlyphBodyForTest('ebike');
  assert.equal(bike.strokes, ebike.strokes, 'same bicycle — they belong to one family');
  assert.equal(bike.fills.trim(), '');
  assert.match(ebike.fills, /<path/);
});

test('an unmapped kind falls to the disc, never to another kind\'s silhouette', () => {
  // The feed did not say what this is, and drawing a scooter would assert
  // something it never published.
  for (const unknown of ['funicular', '', null, undefined, 'BIKE']) {
    assert.equal(sharedMobilityGlyphKind(unknown), 'other');
  }
  assert.equal(sharedMobilityGlyph('funicular'), sharedMobilityGlyph('other'));
  assert.notEqual(sharedMobilityGlyph('other'), sharedMobilityGlyph('bike'));
});

test('glyphs are tint-safe: white ink over a black halo, and no hue of their own', () => {
  for (const kind of SHARED_MOBILITY_GLYPH_KINDS) {
    const svg = decode(sharedMobilityGlyph(kind));
    // Cesium multiplies `billboard.color` into the texture. White takes the
    // operator colour exactly; a baked hue would multiply into something else
    // and destroy the channel.
    assert.match(svg, /stroke="#ffffff"/, kind);
    assert.match(svg, /stroke="rgba\(0,0,0,0\.55\)"/, `${kind} has no halo`);
    const colors = svg.match(/#[0-9a-f]{3,6}/gi) || [];
    assert.ok(colors.every((color) => /^#(fff|ffffff)$/i.test(color)),
      `${kind} bakes in ${colors.filter((color) => !/^#(fff|ffffff)$/i.test(color))}`);
  }
});

test('the halo is drawn from the SAME geometry, so it can never drift out of register', () => {
  const body = _sharedMobilityGlyphBodyForTest('scooter');
  const svg = decode(sharedMobilityGlyph('scooter'));
  const haloStart = svg.indexOf('rgba(0,0,0,0.55)');
  const inkStart = svg.indexOf('stroke="#ffffff"');
  assert.ok(haloStart >= 0 && inkStart > haloStart, 'halo is painted first, under the ink');
  const strokeGeometry = body.strokes.replace(/\s+/g, '');
  assert.ok(svg.replace(/\s+/g, '').split(strokeGeometry).length - 1 >= 2,
    'the same path string appears in both passes');
});

test('the raster is sized for the billboard, and cached per kind and size', () => {
  const fleet = sharedMobilityGlyph('bike');
  assert.match(decode(fleet), /width="64" height="64"/);
  assert.match(decode(fleet), /viewBox="0 0 96 96"/, 'geometry stays in one coordinate space');
  assert.equal(sharedMobilityGlyph('bike'), fleet, 'same call, same string — no per-frame rebuild');
  const legend = sharedMobilityGlyph('bike', 32);
  assert.notEqual(legend, fleet);
  assert.match(decode(legend), /width="32" height="32"/);
});

test('every glyph stays inside its box, halo included', () => {
  // A path that runs to the edge gets its halo clipped flat, which reads as a
  // cut-off icon at exactly the sizes this layer draws.
  const halfHalo = 13 / 2;
  for (const kind of SHARED_MOBILITY_GLYPH_KINDS) {
    const body = _sharedMobilityGlyphBodyForTest(kind);
    const geometry = `${body.strokes}${body.fills}`;
    const bounds = [];
    for (const [, x, y] of geometry.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)) {
      bounds.push([Number(x), Number(y)]);
    }
    for (const [, cx, cy, r] of geometry.matchAll(/cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)) {
      bounds.push([Number(cx) - Number(r), Number(cy) - Number(r)]);
      bounds.push([Number(cx) + Number(r), Number(cy) + Number(r)]);
    }
    assert.ok(bounds.length, `${kind} exposed no coordinates to check`);
    for (const [x, y] of bounds) {
      assert.ok(x - halfHalo >= -0.5 && x + halfHalo <= 96.5, `${kind} x=${x} runs off the box`);
      assert.ok(y - halfHalo >= -0.5 && y + halfHalo <= 96.5, `${kind} y=${y} runs off the box`);
    }
  }
});
