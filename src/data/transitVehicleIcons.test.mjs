// The icons exist so a viewer can tell a tram from a river shuttle without
// reading a card, and the artwork is Google's, vendored under Apache-2.0. So
// two things are pinned: every class the kind mapper can emit draws as its own
// real vehicle, and the vendored geometry is intact and unmodified.
//
// A third mark shares that geometry: the STOP BADGE, which knocks a pictogram
// into a filled disc and is the one thing here whose colours are baked. Its
// contract is the opposite of the vehicles' and is pinned separately — the ink
// must flip with the fill's luminance, because a tint cannot do that and this
// fill is a lightness ramp.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  badgeInk,
  transitHeadingPointer,
  transitStopBadge,
  transitSymbolName,
  transitSymbolSet,
  transitVehicleGlyph,
  TRANSIT_GLYPH_KINDS,
  TRANSIT_GLYPH_RASTER_PX,
  _transitSymbolPathsForTest,
} from './transitVehicleIcons.js';
import { MAKI_PATHS, MAP_ICON_HALO_RATIO, mapIconArtwork } from './mapIcons.js';
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

test('a symbol name with no artwork behind it draws the disc, not an empty box', () => {
  // `transitVehicleGlyph` keys the fallback on the ARTWORK, not on the name.
  // Keying it on the name rendered `<path d="undefined"/>` for any class mapped
  // to a symbol that was not vendored — a blank billboard, which reads as a
  // vehicle that vanished rather than as a class the feed never resolved.
  const disc = transitVehicleGlyph(null);
  const svg = svgOf(disc);
  assert.ok(!svg.includes('undefined'), 'the disc must not carry a broken path');
  for (const kind of TRANSIT_GLYPH_KINDS) {
    assert.ok(!svgOf(transitVehicleGlyph(kind)).includes('undefined'), `${kind} draws a broken path`);
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
  // Each class maps to a symbol that is actually vendored, in ITS OWN set.
  for (const kind of TRANSIT_GLYPH_KINDS) {
    const symbol = transitSymbolName(kind);
    const set = transitSymbolSet(symbol);
    assert.ok(set, `${kind} maps to a symbol from no vendored set`);
    if (set === 'material-symbols') {
      assert.ok(paths[symbol], `${kind} maps to a symbol with no path data`);
    } else {
      assert.ok(MAKI_PATHS[symbol], `${kind} maps to a Maki symbol with no path data`);
      // A Maki path must NOT be in Material's table: a name in both would make
      // `transitSymbolSet` a coin toss and the notices unauditable.
      assert.ok(!paths[symbol], `${symbol} is claimed by both vendored sets`);
    }
  }
});

test('the Maki glyph is intact, and is drawn in Maki\'s own 15-unit box', () => {
  // CC0 imposes no "state your changes" clause, but the whole reason to vendor
  // artwork rather than redraw it is that it stays the artwork that was judged.
  const d = MAKI_PATHS.aerialway;
  assert.match(d, /^M/);
  assert.ok(d.length > 100, 'aerialway looks truncated');
  // Maki authors in a 15-unit box. Material authors in a 960-unit one, so a
  // coordinate above 15 here is the signature of artwork rescaled into the
  // wrong space — the exact modification both notices promise did not happen.
  const coords = [...d.matchAll(/-?\d*\.?\d+/g)].map((m) => Math.abs(Number(m[0])));
  assert.ok(coords.length > 40, 'no coordinates parsed');
  assert.ok(Math.max(...coords) <= 15, 'a coordinate escapes Maki\'s 15-unit box');
  const svg = svgOf(transitVehicleGlyph('aerial'));
  assert.ok(svg.includes(d), 'the drawn path is not the vendored path');
  assert.match(svg, /viewBox="-1 -1 17 17"/, 'the halo needs a padded canvas');
  // The class it replaced must not still be shipping.
  assert.ok(!Object.keys(_transitSymbolPathsForTest()).includes('cable_car'),
    'cable_car is no longer drawn and must no longer be vendored');
});

test('each glyph ships under the licence of the set it actually came from', () => {
  const apache = readFileSync(new URL('../../licenses/material-symbols/LICENSE', import.meta.url), 'utf8');
  assert.match(apache, /Apache License/);
  assert.match(apache, /Version 2\.0/);
  const cc0 = readFileSync(new URL('../../licenses/maki/LICENSE', import.meta.url), 'utf8');
  assert.match(cc0, /CC0 1\.0 Universal/);

  const notices = {
    'material-symbols': readFileSync(new URL('../../licenses/material-symbols/NOTICE', import.meta.url), 'utf8'),
    maki: readFileSync(new URL('../../licenses/maki/NOTICE', import.meta.url), 'utf8'),
  };
  assert.match(notices['material-symbols'], /material-design-icons/);
  assert.match(notices.maki, /mapbox\/maki/);

  // Each notice names the glyphs ITS set supplies. A class added without
  // updating the right notice would make the attribution incomplete — and a
  // class named in the WRONG notice would attribute artwork to the wrong author,
  // which is the failure that matters.
  for (const kind of TRANSIT_GLYPH_KINDS) {
    const symbol = transitSymbolName(kind);
    const set = transitSymbolSet(symbol);
    assert.ok(notices[set].includes(symbol), `${symbol} is not named in the ${set} NOTICE`);
  }
  // Material's notice must no longer claim the glyph that was dropped.
  assert.match(notices['material-symbols'], /cable_car` was taken on the same date and has since been REMOVED/);
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

test('a stop badge keeps a legible pictogram at BOTH ends of a lightness ramp', () => {
  // The failure this prevents is the one the naked glyph had, inverted: a
  // white pictogram on `#fff0c4` and a dark one on `#43587a` are both
  // invisible, and `billboard.color` cannot flip between them — a tint
  // multiplies, so it can only ever darken. So the ink is chosen here.
  const dark = badgeInk('#43587a');
  const light = badgeInk('#fff0c4');
  assert.notEqual(dark.ink, light.ink);
  assert.notEqual(dark.contrast, light.contrast);
  // Both ends of the caller's ramp, and its silent colour, resolve.
  for (const css of ['#43587a', '#63809f', '#94a8b8', '#cbc6b4', '#e8d5a0', '#fff0c4', '#2b3444']) {
    const { ink } = badgeInk(css);
    assert.ok(ink.startsWith('#'), css);
  }
  // A colour this pack cannot read must not throw mid-render, and must fall to
  // the ink that works on the darker half of any ramp.
  assert.deepEqual(badgeInk('rebeccapurple'), badgeInk('#000000'));
  assert.deepEqual(badgeInk('#fff'), badgeInk('#ffffff'));
});

test('a badge fill goes into an SVG attribute, so it is normalised first', () => {
  const svgFor = (fill) => svgOf(transitStopBadge('bus', { fill }));
  // Case and whitespace are the same entry, not three.
  assert.equal(transitStopBadge('bus', { fill: ' #FFF0C4 ' }),
    transitStopBadge('bus', { fill: '#fff0c4' }));
  // Anything this pack cannot weigh becomes the repo's "not measured" grey:
  // visibly wrong beats a broken document, and beats an injected attribute.
  for (const hostile of ['rebeccapurple', '#12', 'red" onload="x', '#fff0c4;fill:red']) {
    const svg = svgFor(hostile);
    assert.ok(svg.includes('fill="#8a93a6"'), hostile);
    assert.equal(svg.includes('onload'), false, hostile);
    assert.equal((svg.match(/"/g) || []).length % 2, 0, hostile);
  }
  // A shorthand hex is honoured rather than greyed out.
  assert.ok(svgFor('#abc').includes('fill="#abc"'));
});

test('a stop badge is one atlas entry per (kind, fill), and no more', () => {
  assert.equal(transitStopBadge('bus', { fill: '#fff0c4' }),
    transitStopBadge('bus', { fill: '#FFF0C4' }), 'case is not a second entry');
  assert.notEqual(transitStopBadge('bus', { fill: '#fff0c4' }),
    transitStopBadge('bus', { fill: '#43587a' }));
  assert.notEqual(transitStopBadge('bus', { fill: '#fff0c4' }),
    transitStopBadge('metro', { fill: '#fff0c4' }));
  assert.notEqual(transitStopBadge('bus', { fill: '#fff0c4' }),
    transitStopBadge('bus', { fill: '#fff0c4', px: 32 }));
  // And it is never the naked glyph: the badge brings its own ground, which is
  // the whole reason it exists.
  for (const kind of TRANSIT_GLYPH_KINDS) {
    assert.notEqual(transitStopBadge(kind, { fill: '#fff0c4' }), transitVehicleGlyph(kind));
  }
});

test('a stop badge draws the vendored geometry verbatim, placed by a transform', () => {
  // The licence notices claim the `d` strings are byte-for-byte upstream. A
  // badge scales them into a smaller box, and it must do that with an SVG
  // transform rather than by rewriting coordinates.
  const bus = svgOf(transitStopBadge('bus', { fill: '#94a8b8' }));
  assert.ok(bus.includes(_transitSymbolPathsForTest().directions_bus), 'Material path is verbatim');
  assert.match(bus, /viewBox="0 0 96 96"/);
  assert.match(bus, /<g transform="translate\(21 75\) scale\(0\.05625\)">/);
  // A borrowed glyph is fitted from the box `mapIconArtwork` declares for it,
  // not from a box this module assumed — Maki and Temaki are not uniform.
  const aerial = svgOf(transitStopBadge('aerial', { fill: '#94a8b8' }));
  assert.ok(aerial.includes(MAKI_PATHS.aerialway), 'Maki path is verbatim');
  const box = mapIconArtwork('maki', 'aerialway').box;
  const scale = 54 / box;
  const offset = ((96 - box * scale) / 2).toFixed(3);
  assert.ok(aerial.includes(`translate(${offset} ${offset}) scale(${scale.toFixed(5)})`), aerial);
  // And its halo is a RATIO of that same box, so a 15-unit glyph and a 960-unit
  // one land at the same optical weight inside the badge.
  assert.ok(aerial.includes(`stroke-width="${box * MAP_ICON_HALO_RATIO}"`), aerial);
  // Two edges, so one of them always contrasts with whatever is underneath.
  assert.equal((bus.match(/<circle /g) || []).length, 2);
  assert.ok(bus.includes('fill="#94a8b8"'));
});
