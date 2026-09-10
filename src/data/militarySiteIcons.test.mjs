import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MILITARY_SHAPED_CLASSES,
  _militaryGlyphPunchesForTest,
  militarySiteGlyph,
} from './militarySiteIcons.js';
import { mapIconArtwork } from './mapIcons.js';

/** The SVG behind a data URI. */
const decode = (uri) => Buffer.from(String(uri).split(',')[1], 'base64').toString('utf8');

/** The plate's radius, read off the artwork rather than restated here. */
const discRadius = (svg) => Number(svg.match(/r="([\d.]+)" fill="#ffffff" mask=/)[1]);

test('every published class has a mark, and only an unknown one goes without', () => {
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

test('the mark is a plate with an edge, not a silhouette floating on a photo', () => {
  // The complaint this rebuild answers, made testable. A bare silhouette at the
  // floor of this layer's distance ramp — 10 CSS px over a Gironde orthophoto —
  // is the same value and the same size as the field texture behind it. A plate
  // has a filled body that carries the class hue and a dark ring that is its
  // only edge, and both survive Cesium's colour multiply.
  for (const klass of MILITARY_SHAPED_CLASSES) {
    const svg = decode(militarySiteGlyph(klass));
    const ring = svg.match(/<circle cx="48" cy="48" r="([\d.]+)" fill="rgba\(0,0,0,([\d.]+)\)"\/>/);
    assert.ok(ring, `${klass} has no ring`);
    assert.ok(Number(ring[2]) >= 0.8, `${klass}: a ring at alpha ${ring[2]} is a halo, not an edge`);
    assert.ok(Number(ring[1]) > discRadius(svg), `${klass}: the ring must sit outside the plate`);
    assert.match(svg, /fill="#ffffff" mask="url\(#m\)"/, `${klass} has no tintable plate`);
    // No hue is baked in, or the multiply would tint a tint: the CCTV bug.
    const hexes = [...svg.matchAll(/#[0-9a-fA-F]{6}/g)].map((match) => match[0].toLowerCase());
    assert.deepEqual([...new Set(hexes)].sort(), ['#000000', '#ffffff'], klass);
  }
});

test('the silhouette is punched by a mask, because fill-rule cannot reach it', () => {
  // `fill-rule="evenodd"` spans the subpaths of ONE path element. Every borrowed
  // icon arrives as one or more paths inside a `<g transform>` — fitting a 15 or
  // 48-unit box into this 96-unit plate is a transform — so a hole through it
  // has to be a mask. Getting this wrong does not throw: it draws a plain disc,
  // which is exactly the mark this module exists to stop drawing.
  for (const klass of MILITARY_SHAPED_CLASSES) {
    const svg = decode(militarySiteGlyph(klass));
    assert.match(svg, /<mask id="m"[^>]*>/, klass);
    assert.match(svg, /<g fill="#000000">/, `${klass}: the punch must be painted black in the mask`);
    const punch = svg.split('<g fill="#000000">')[1].split('</g></mask>')[0];
    assert.ok(punch.includes('<path'), `${klass} punches nothing`);
  }
});

test('a punched silhouette stays inside its plate, and fills it', () => {
  // Two failure modes, one measurement. A shape that overflows the disc stops
  // being a punch and becomes a bite out of the ring — and takes the class hue
  // with it. A shape too small leaves a plate that reads as an undifferentiated
  // dot, which is the mark this rebuild replaced.
  //
  // The extent is the largest coordinate in the punch times its transform. That
  // over-estimates a path whose bounding box is off-centre, which is the safe
  // direction for the ceiling and the demanding one for the floor.
  for (const klass of MILITARY_SHAPED_CLASSES) {
    const svg = decode(militarySiteGlyph(klass));
    const scale = Number(svg.match(/scale\(([\d.]+)\)/)[1]);
    const punch = svg.split('<g fill="#000000">')[1].split('</g></mask>')[0];
    const reach = Math.max(...[...punch.matchAll(/[\d.]+/g)].map((match) => Number(match[0])));
    const span = scale * reach;
    const plate = 2 * discRadius(svg);
    assert.ok(span <= plate, `${klass} draws ${span.toFixed(1)} units into a ${plate} plate`);
    assert.ok(span >= plate / 2, `${klass} punches only ${span.toFixed(1)} units of a ${plate} plate`);
  }
});

test('the key variant is the map mark minus its ring, and nothing else', () => {
  // The on-map key masks its swatch and a CSS mask reads ALPHA, so the ring —
  // which makes the whole disc opaque — would flatten every class into the same
  // dot. Dropping it is the ONLY difference allowed: a key drawn from its own
  // geometry could show a shape the globe does not.
  for (const klass of MILITARY_SHAPED_CLASSES) {
    const map = decode(militarySiteGlyph(klass));
    const key = decode(militarySiteGlyph(klass, { key: true }));
    const ring = map.match(/<circle cx="48" cy="48" r="[\d.]+" fill="rgba\(0,0,0,[\d.]+\)"\/>/)[0];
    assert.equal(map.replace(ring, ''), key, `${klass}: the key diverged from the map`);
    assert.doesNotMatch(key, /rgba\(/, `${klass}: the key swatch must be pure alpha`);
  }
});

test('this module borrows artwork and never vendors a second copy', () => {
  const source = fs.readFileSync(new URL('./militarySiteIcons.js', import.meta.url), 'utf8');
  // A vendored outline — a Material silhouette, a Temaki jet — is hundreds of
  // characters of path data. Everything here is either fetched through the CC0
  // pack's public door or is geometry: circles, and a shield that is four lines
  // and two curves.
  const literals = [...source.matchAll(/["'`]M[\d\s,.\-A-Za-z]{60,}/g)];
  assert.deepEqual(literals.map((match) => match[0].slice(0, 40)), []);

  // And what it borrows is the vendored path itself, verbatim.
  assert.ok(decode(militarySiteGlyph('airfield'))
    .includes(mapIconArtwork('temaki', 'fighter_jet').geometry));
  assert.ok(decode(militarySiteGlyph('naval_base'))
    .includes(mapIconArtwork('maki', 'harbor').geometry));
});

test('the four punches are four different shapes', () => {
  const punches = _militaryGlyphPunchesForTest();
  assert.equal(Object.keys(punches).length, 4);
  assert.equal(new Set(Object.values(punches)).size, 4, 'two classes share one shape');
  // The target keeps a transparent band, which is what makes it a target rather
  // than a dot: its two circles live in ONE path so evenodd still applies.
  assert.match(punches.range, /fill-rule="evenodd"/);
  assert.equal((punches.range.match(/M/g) || []).length, 2, 'the bull must stay a subpath');
});

test('rasters are cached per class, per size and per variant', () => {
  const first = militarySiteGlyph('range');
  assert.equal(militarySiteGlyph('range'), first, 'the same raster is rebuilt');
  const small = militarySiteGlyph('range', { px: 32 });
  assert.notEqual(small, first);
  assert.notEqual(militarySiteGlyph('range', { px: 32, key: true }), small);
  assert.match(decode(small), /width="32" height="32"/);
  assert.match(decode(first), /width="88" height="88"/);
});
