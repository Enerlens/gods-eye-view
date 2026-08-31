// The icons exist so a viewer can tell a tram from a river shuttle without
// reading a card, and the artwork is Google's, vendored under Apache-2.0. So
// two things are pinned: every class the kind mapper can emit draws as its own
// real vehicle, and the vendored geometry is intact and unmodified.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  transitHeadingPointer,
  transitSymbolName,
  transitVehicleGlyph,
  TRANSIT_GLYPH_KINDS,
  TRANSIT_GLYPH_RASTER_PX,
  _transitSymbolPathsForTest,
} from './transitVehicleIcons.js';
import { GTFS_ROUTE_TYPE_KINDS, kindFromRouteType } from './transitVehicleKind.js';

/** Decode a data URI back to its SVG source. */
function svgOf(uri) {
  assert.match(uri, /^data:image\/svg\+xml;base64,/);
  return Buffer.from(uri.split(',')[1], 'base64').toString('utf8');
}

test('every class the kind mapper can emit draws as a real vehicle', () => {
  // A class with no symbol falls to a disc, which silently loses the very
  // distinction the static GTFS join was built to recover.
  const emitted = new Set();
  const probes = [...Object.keys(GTFS_ROUTE_TYPE_KINDS).map(Number),
    150, 250, 450, 750, 850, 950, 1050, 1150, 1250, 1350, 1450, 1550];
  for (const routeType of probes) {
    const kind = kindFromRouteType(routeType);
    if (kind) emitted.add(kind);
  }
  for (const kind of emitted) {
    assert.ok(transitSymbolName(kind), `${kind} has no vehicle icon`);
    assert.ok(TRANSIT_GLYPH_KINDS.includes(kind), `${kind} is missing from the pack`);
  }
});

test('the classes that actually run in France are four different pictures', () => {
  // Bordeaux alone puts buses, trams and river shuttles on one screen, and
  // Rouen adds a metro-classed line. Those four must never collide.
  const drawn = ['bus', 'tram', 'metro', 'ferry'].map((kind) => transitVehicleGlyph(kind));
  assert.equal(new Set(drawn).size, 4);
});

test('an unresolved class draws a disc, never another class\'s vehicle', () => {
  const disc = transitVehicleGlyph(null);
  assert.equal(transitVehicleGlyph('zeppelin'), disc);
  assert.equal(transitSymbolName('zeppelin'), null);
  assert.match(svgOf(disc), /<circle cx="480" cy="-480" r="230"\/>/);
  for (const kind of TRANSIT_GLYPH_KINDS) {
    assert.notEqual(transitVehicleGlyph(kind), disc, `${kind} must not fall through to the disc`);
  }
});

test('the vendored Material Symbols geometry is intact and unmodified', () => {
  // Apache-2.0 asks that changes be stated. This project changes NOTHING about
  // the path data — it only draws each path twice, as a halo and as a fill —
  // and this is the check that keeps that claim true.
  const paths = _transitSymbolPathsForTest();
  for (const [name, d] of Object.entries(paths)) {
    assert.match(d, /^M/, `${name} should start with a moveto`);
    assert.ok(d.length > 100, `${name} looks truncated`);
    // Material authors in a 960 box with y running -960 → 0. A path rewritten
    // into some other space would be a modification of the artwork.
    assert.match(d, /-\d/, `${name} should carry Material's negative y space`);
  }
  // Each class maps to a symbol that is actually vendored.
  for (const kind of TRANSIT_GLYPH_KINDS) {
    assert.ok(paths[transitSymbolName(kind)], `${kind} maps to a symbol with no path data`);
  }
});

test('the Apache-2.0 licence and notice ship with the artwork', () => {
  const licence = readFileSync(new URL('../../licenses/material-symbols/LICENSE', import.meta.url), 'utf8');
  assert.match(licence, /Apache License/);
  assert.match(licence, /Version 2\.0/);
  const notice = readFileSync(new URL('../../licenses/material-symbols/NOTICE', import.meta.url), 'utf8');
  assert.match(notice, /material-design-icons/);
  // The notice names the glyphs used; a class added without updating it would
  // make the attribution incomplete.
  for (const kind of TRANSIT_GLYPH_KINDS) {
    assert.ok(notice.includes(transitSymbolName(kind)), `${transitSymbolName(kind)} is not named in NOTICE`);
  }
});

test('icons are tint-safe: white fill, dark halo, no baked hue', () => {
  // Cesium multiplies `billboard.color` into the texture. A glyph with its own
  // hue would fight the class colour; black survives the multiply and keeps
  // the icon readable over pale terrain.
  for (const kind of [...TRANSIT_GLYPH_KINDS, null]) {
    const svg = svgOf(transitVehicleGlyph(kind));
    assert.ok(svg.includes('fill="#ffffff"'), String(kind));
    assert.ok(svg.includes('rgba(0,0,0,0.62)'), `${kind} needs a dark halo`);
    const hexes = [...svg.matchAll(/#[0-9a-fA-F]{3,6}/g)].map((match) => match[0].toLowerCase());
    assert.deepEqual([...new Set(hexes)], ['#ffffff'], `${kind} bakes in a hue`);
  }
});

test('the heading pointer is an edge wedge, so rotating it makes it orbit', () => {
  // The whole design rests on this: the wedge sits at the TOP of an otherwise
  // empty box, and the box turns about its centre. A wedge drawn at the centre
  // would spin in place and point at nothing.
  const svg = svgOf(transitHeadingPointer());
  assert.match(svg, /viewBox="0 0 96 96"/);
  const ys = [...svg.matchAll(/[ML]\d+,(\d+)/g)].map((match) => Number(match[1]));
  assert.ok(ys.length > 0);
  assert.ok(Math.max(...ys) < 48, 'the wedge must sit entirely above the box centre');
  // It is not a vehicle and must never be mistaken for one.
  for (const kind of TRANSIT_GLYPH_KINDS) {
    assert.notEqual(transitHeadingPointer(), transitVehicleGlyph(kind));
  }
});

test('glyphs are cached per symbol and size', () => {
  assert.equal(transitVehicleGlyph('bus'), transitVehicleGlyph('bus'));
  assert.notEqual(transitVehicleGlyph('bus'), transitVehicleGlyph('bus', { px: 32 }));
  // Two classes that share a symbol share the texture — one atlas entry, not
  // two identical ones.
  assert.equal(transitVehicleGlyph('bus'), transitVehicleGlyph('trolleybus'));
  const svg = svgOf(transitVehicleGlyph('bus'));
  assert.ok(svg.includes(`width="${TRANSIT_GLYPH_RASTER_PX}"`));
  assert.ok(svg.includes('viewBox="0 -960 960 960"'));
});
