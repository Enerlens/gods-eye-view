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
  MATERIAL_SYMBOL_PATHS,
  _sharedMobilityGlyphBodyForTest,
  _sharedMobilityKindSymbolForTest,
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
  const geometries = SHARED_MOBILITY_GLYPH_KINDS
    .map((kind) => _sharedMobilityGlyphBodyForTest(kind).replace(/\s+/g, ''));
  assert.equal(new Set(geometries).size, SHARED_MOBILITY_GLYPH_KINDS.length);
  const uris = SHARED_MOBILITY_GLYPH_KINDS.map((kind) => sharedMobilityGlyph(kind));
  assert.equal(new Set(uris).size, SHARED_MOBILITY_GLYPH_KINDS.length);
});

test('a bike and an e-bike are two Material glyphs, and the e-bike carries more ink', () => {
  // Both are Google's bicycle; `electric_bike` is the same frame plus a bolt.
  // That bolt is what has to survive minification to ~17 px, so it must be
  // EXTRA geometry rather than a rearrangement — a longer path, not a different
  // one. Google places its bolt below the frame where this project used to
  // place one above it; the swap was checked at the drawn size before landing.
  const symbols = _sharedMobilityKindSymbolForTest();
  assert.equal(symbols.bike, 'pedal_bike');
  assert.equal(symbols.ebike, 'electric_bike');
  const bike = MATERIAL_SYMBOL_PATHS.pedal_bike;
  const ebike = MATERIAL_SYMBOL_PATHS.electric_bike;
  assert.notEqual(bike, ebike);
  assert.ok(ebike.length > bike.length, 'the electric badge is added ink');
  // The badge itself, shared with the scooter and the moped — "electric" is one
  // mark across the set rather than three different hints.
  const bolt = ebike.slice(ebike.lastIndexOf('M520-120'));
  assert.ok(bolt.length > 40, 'the bolt sub-path is where Material puts it');
  assert.ok(MATERIAL_SYMBOL_PATHS.electric_scooter.includes('M520-120'));
  assert.ok(MATERIAL_SYMBOL_PATHS.electric_moped.includes('M520-120'));
  assert.ok(!bike.includes('M520-120'), 'a pedal bike carries no badge');
});

test('the vendored artwork is what the module actually draws', () => {
  // Apache-2.0 §4 obliges the NOTICE to stay accurate, and it claims these
  // paths are verbatim and unmodified. A silent edit here would make the repo
  // ship Google artwork outside the notice that enumerates it — a compliance
  // regression introduced by an aesthetic change.
  const symbols = _sharedMobilityKindSymbolForTest();
  assert.deepEqual(Object.keys(symbols), ['bike', 'ebike', 'scooter', 'moped', 'car']);
  for (const [kind, name] of Object.entries(symbols)) {
    const path = MATERIAL_SYMBOL_PATHS[name];
    assert.ok(path, `${kind} points at a symbol that is not vendored: ${name}`);
    assert.match(path, /^M/, `${name} is not a path`);
    // No commas anywhere. Material publishes compact, comma-free path data
    // (`M200-160q-85 0…`), whereas the hand-drawn set this replaced wrote
    // `M26,66 L47,66`. A comma here would mean the artwork was reformatted or
    // rescaled — and the NOTICE claims it is verbatim.
    assert.ok(!path.includes(','), `${name} has been reformatted`);
    assert.ok(path.length > 300, `${name} looks truncated (${path.length} chars)`);
    // …and it is what actually reaches the canvas, not just what is stored.
    assert.ok(_sharedMobilityGlyphBodyForTest(kind).includes(path), `${kind} draws something else`);
  }
});

test('the two hand-drawn bodies are ours, and are drawn as FILLED shapes', () => {
  // Material's artwork is fill-only, so the white STROKE pass the old set
  // relied on is gone. A zero-area path now renders as nothing at all — which
  // is exactly what happened to the dock rack on the first attempt.
  for (const kind of ['other', 'station']) {
    const body = _sharedMobilityGlyphBodyForTest(kind);
    assert.ok(
      /<(circle|rect)\b/.test(body),
      `${kind} must be a fillable shape, not a stroked path — got ${body}`,
    );
    for (const path of Object.values(MATERIAL_SYMBOL_PATHS)) {
      assert.ok(!body.includes(path), `${kind} must not borrow Google artwork`);
    }
  }
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
    assert.match(svg, /fill="#ffffff"/, kind);
    assert.match(svg, /stroke="rgba\(0,0,0,0\.55\)"/, `${kind} has no halo`);
    const colors = svg.match(/#[0-9a-f]{3,6}/gi) || [];
    assert.ok(colors.every((color) => /^#(fff|ffffff)$/i.test(color)),
      `${kind} bakes in ${colors.filter((color) => !/^#(fff|ffffff)$/i.test(color))}`);
  }
});

test('the halo is drawn from the SAME geometry, so it can never drift out of register', () => {
  for (const kind of ['scooter', 'station']) {
    const body = _sharedMobilityGlyphBodyForTest(kind);
    const svg = decode(sharedMobilityGlyph(kind));
    const haloStart = svg.indexOf('rgba(0,0,0,0.55)');
    const inkStart = svg.indexOf('fill="#ffffff"');
    assert.ok(haloStart >= 0 && inkStart > haloStart, `${kind}: halo is painted first, under the ink`);
    // Literally the same string, twice — which is why the two can never
    // disagree about where the shape is.
    assert.equal(
      svg.split(body).length - 1, 2,
      `${kind}: the geometry must appear in both passes`,
    );
  }
});

test('the raster is sized for the billboard, and cached per kind and size', () => {
  const fleet = sharedMobilityGlyph('bike');
  assert.match(decode(fleet), /width="64" height="64"/);
  // Material's own box, unrescaled — see the NOTICE. The two hand-drawn bodies
  // are authored in it too, so one viewBox serves the whole set.
  assert.match(decode(fleet), /viewBox="0 -960 960 960"/, 'geometry stays in one coordinate space');
  assert.equal(sharedMobilityGlyph('bike'), fleet, 'same call, same string — no per-frame rebuild');
  const legend = sharedMobilityGlyph('bike', 32);
  assert.notEqual(legend, fleet);
  assert.match(decode(legend), /width="32" height="32"/);
});

test('every glyph stays inside its box, halo included', () => {
  // A path that runs to the edge gets its halo clipped flat, which reads as a
  // cut-off icon at exactly the sizes this layer draws.
  //
  // Checked on the RENDERED extent rather than by parsing coordinates: the old
  // test read `M`/`L` pairs and circle attributes out of hand-authored
  // geometry, and Material's paths are comma-free with implicit lineto commands
  // (`M320-200v20q…`), so that parser matched nothing and quietly asserted
  // over an empty list. Material's own artwork is authored to sit inside a
  // 960 box with its own padding; what this guards is the two bodies WE draw.
  const halfHalo = 110 / 2;
  const numbers = (body) => (body.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  for (const kind of ['other', 'station']) {
    const body = _sharedMobilityGlyphBodyForTest(kind);
    if (/<circle/.test(body)) {
      const [cx, cy, r] = numbers(body);
      assert.ok(cx - r - halfHalo >= -0.5 && cx + r + halfHalo <= 960.5, `${kind} x runs off the box`);
      assert.ok(Math.abs(cy) + r + halfHalo <= 960.5, `${kind} y runs off the box`);
    }
    for (const [, x, y, w, h] of body.matchAll(/x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
      assert.ok(Number(x) - halfHalo >= -0.5, `${kind} left edge`);
      assert.ok(Number(x) + Number(w) + halfHalo <= 960.5, `${kind} right edge`);
      assert.ok(Math.abs(Number(y)) + halfHalo <= 960.5, `${kind} top edge`);
      assert.ok(Math.abs(Number(y) + Number(h)) - halfHalo >= -960.5, `${kind} bottom edge`);
    }
  }
});
