// The artwork here is someone else's, taken because it reads better at map
// size than anything this project would draw. Two things therefore have to
// stay true, and neither is checkable by looking at the globe: the vendored
// geometry is still the geometry that was judged, and every glyph is tint-safe
// — because the pack it replaced was NOT, and that was a visible bug.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mapIconGeometry,
  mapIconGlyph,
  MAKI_PATHS,
  MAP_ICON_HALO_COLOR,
  MAP_ICON_HALO_STROKE,
  MAP_ICON_VIEW_BOX,
  TEMAKI_PATHS,
} from './mapIcons.js';

/** Decode a data URI back to its SVG source. */
function svgOf(uri) {
  assert.match(uri, /^data:image\/svg\+xml;base64,/);
  return Buffer.from(uri.split(',')[1], 'base64').toString('utf8');
}

/** Every vendored icon, as [set, name, paths]. */
function everyIcon() {
  return [
    ...Object.entries(MAKI_PATHS).map(([name, d]) => ['maki', name, [d]]),
    ...Object.entries(TEMAKI_PATHS).map(([name, d]) => ['temaki', name, d]),
  ];
}

test('every vendored path is intact and authored in its own 15-unit box', () => {
  // Both sets author to `0 0 15 15`. Material Symbols authors to 960. A
  // coordinate above 15 here would be the signature of artwork rescaled into
  // the wrong space — the one modification both NOTICE files promise did not
  // happen, and the reason the artwork is still the artwork that was evaluated.
  for (const [set, name, paths] of everyIcon()) {
    assert.ok(paths.length > 0, `${set}/${name} has no paths`);
    for (const d of paths) {
      assert.match(d, /^M/, `${set}/${name} should start with a moveto`);
      const coords = [...d.matchAll(/-?\d*\.?\d+/g)].map((m) => Math.abs(Number(m[0])));
      assert.ok(coords.length > 20, `${set}/${name} looks truncated`);
      assert.ok(Math.max(...coords) <= 15, `${set}/${name} escapes the 15-unit box`);
    }
  }
});

test("Temaki's camera keeps its paths separate, or the lens fills in", () => {
  // The lens is a subpath that winds against its parent inside the third path.
  // Merging the three into one `d`, or reordering them, closes that hole and
  // the camera becomes a featureless wedge.
  const paths = TEMAKI_PATHS.security_camera;
  assert.equal(paths.length, 3);
  assert.ok(paths[2].includes('z'), 'the hood path must close before its lens subpath');
  assert.equal((paths[2].match(/M/g) || []).length, 2, 'the lens must stay a subpath of the hood');
  const markup = mapIconGeometry('temaki', 'security_camera');
  assert.equal((markup.match(/<path /g) || []).length, 3);
});

test('the canvas is padded, so the halo is not clipped at the box edge', () => {
  // Temaki's camera spans the full published box, x=0 to x=15. Drawn at that
  // viewBox, half the halo would fall outside the canvas and the glyph would
  // have a dark outline on three sides and a bare white edge on the fourth.
  assert.equal(MAP_ICON_VIEW_BOX, '-1 -1 17 17');
  const pad = 1;
  assert.ok(MAP_ICON_HALO_STROKE / 2 <= pad, 'the padding must cover half the stroke');
  for (const [set, name] of everyIcon()) {
    assert.match(svgOf(mapIconGlyph(set, name)), /viewBox="-1 -1 17 17"/);
  }
});

test('the halo matches Material by ratio, so the two sets read as one renderer', () => {
  // `transitVehicleIcons.js` strokes 110 units in a 960 box. A téléphérique and
  // a bus sit on the same screen in that layer, and a halo that differed
  // between them would read as two different renderers rather than one map.
  const materialRatio = 110 / 960;
  const ourRatio = MAP_ICON_HALO_STROKE / 15;
  assert.ok(Math.abs(ourRatio - materialRatio) < 0.005,
    `halo ratio ${ourRatio} drifted from Material's ${materialRatio}`);
});

test('every glyph is tint-safe: white artwork, dark halo, no baked hue', () => {
  // This is the property the CCTV camera used to violate. Cesium multiplies
  // `billboard.color` into the texture, so a hue in the artwork multiplies with
  // the layer's colour instead of taking it: #75e7ff x #ffd97a = #75c57a, an
  // amber "selected" state that rendered green.
  for (const [set, name] of everyIcon()) {
    const svg = svgOf(mapIconGlyph(set, name));
    assert.ok(svg.includes('fill="#ffffff"'), `${set}/${name} has no white pass`);
    assert.ok(svg.includes(MAP_ICON_HALO_COLOR), `${set}/${name} needs a dark halo`);
    const hexes = [...svg.matchAll(/#[0-9a-fA-F]{3,6}/g)].map((m) => m[0].toLowerCase());
    assert.deepEqual([...new Set(hexes)], ['#ffffff'], `${set}/${name} bakes in a hue`);
    // No gradient, no opacity: both survive the multiply as their own thing and
    // would reintroduce exactly the bug above by a different route.
    assert.ok(!/Gradient|fill-opacity|stop-color/.test(svg), `${set}/${name} is not flat`);
  }
});

test('the halo is drawn from the SAME geometry as the fill', () => {
  // One geometry, two passes, which is what makes it impossible for the halo to
  // drift out of register with the shape it outlines.
  for (const [set, name] of everyIcon()) {
    const svg = svgOf(mapIconGlyph(set, name));
    const geometry = mapIconGeometry(set, name);
    assert.equal(svg.split(geometry).length - 1, 2, `${set}/${name} draws its geometry twice`);
  }
});

test('an icon this module does not carry returns null, never a stand-in', () => {
  // A layer asking for a glyph that is not vendored has a bug in it. Drawing
  // some other object would hide that behind a picture of the wrong thing.
  assert.equal(mapIconGlyph('maki', 'no-such-icon'), null);
  assert.equal(mapIconGlyph('temaki', 'no-such-icon'), null);
  assert.equal(mapIconGlyph('nonexistent-set', 'aerialway'), null);
  assert.equal(mapIconGeometry('maki', 'no-such-icon'), null);
});

test('glyphs are cached per set, icon and size', () => {
  assert.equal(mapIconGlyph('maki', 'aerialway'), mapIconGlyph('maki', 'aerialway'));
  assert.notEqual(mapIconGlyph('maki', 'aerialway'), mapIconGlyph('maki', 'aerialway', { px: 32 }));
  assert.notEqual(mapIconGlyph('maki', 'aerialway'), mapIconGlyph('temaki', 'security_camera'));
  assert.ok(svgOf(mapIconGlyph('maki', 'aerialway', { px: 32 })).includes('width="32"'));
});

test('both CC0 dedications and both notices ship with the artwork', () => {
  // CC0 requires none of this. It ships because recording where vendored
  // artwork came from is this project's own discipline, and because a reader
  // should be able to audit the "verbatim, not rescaled" claim without cloning
  // two repositories.
  const sets = {
    maki: { table: MAKI_PATHS, source: /mapbox\/maki/ },
    temaki: { table: TEMAKI_PATHS, source: /rapideditor\/temaki/ },
  };
  for (const [set, { table, source }] of Object.entries(sets)) {
    const licence = readFileSync(new URL(`../../licenses/${set}/LICENSE`, import.meta.url), 'utf8');
    assert.match(licence, /CC0 1\.0 Universal/, `${set} is missing its dedication`);
    const notice = readFileSync(new URL(`../../licenses/${set}/NOTICE`, import.meta.url), 'utf8');
    assert.match(notice, source, `${set} NOTICE does not name its upstream`);
    // The notice names every glyph taken. One added without updating it would
    // leave the provenance record incomplete.
    for (const name of Object.keys(table)) {
      assert.ok(notice.includes(name), `${name} is not named in the ${set} NOTICE`);
    }
  }
});
