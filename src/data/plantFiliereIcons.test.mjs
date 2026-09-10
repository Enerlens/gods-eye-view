// The three filière marks. The artwork is someone else's, taken because it
// reads better at map size than anything this project would draw, so three
// things have to stay true and none is checkable by looking at the globe: the
// vendored geometry is still the geometry that was judged, every mark is a
// PLATE rather than a bare silhouette (a shape over an orthophoto disappears
// below 18 px, and half this fleet draws under that), and every mark is
// tint-safe — because a hue baked into a marker pack has already been a visible
// bug in this codebase once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PLANT_GLYPH_RASTER_PX,
  PLANT_SHAPED_FILIERES,
  _plantPunchesForTest,
  _plantSymbolPathsForTest,
  plantFiliereGlyph,
  plantUnknownGlyph,
} from './plantFiliereIcons.js';
import { mapIconGeometry } from './mapIcons.js';
import { FILIERE_ORDER, FILIERE_STYLES, PLANT_PIXEL_MIN } from './edfPowerPlants.js';

/** Decode a data URI back to its SVG source. */
function decode(uri) {
  assert.match(uri, /^data:image\/svg\+xml;base64,/);
  return Buffer.from(uri.split(',')[1], 'base64').toString('utf8');
}

/** The plate's own radius, read off the masked disc. */
const discRadius = (svg) => Number(svg.match(/r="([\d.]+)" fill="#ffffff" mask=/)[1]);

test('every filière EDF publishes has a mark, and they are all different', () => {
  // The list is closed against the LAYER's own order rather than against a copy
  // of it: a fourth filière appearing in a future republication has to fail
  // here, where the answer is "draw it", rather than silently on the globe,
  // where the answer is a bare pastille nobody notices is bare.
  assert.deepEqual([...PLANT_SHAPED_FILIERES].sort(), [...FILIERE_ORDER].sort());
  const drawn = FILIERE_ORDER.map((key) => plantFiliereGlyph(key));
  for (const uri of drawn) assert.ok(uri, 'every filière needs artwork');
  assert.equal(new Set(drawn).size, FILIERE_ORDER.length, 'two filières share a silhouette');
  const punches = _plantPunchesForTest();
  assert.equal(new Set(Object.values(punches)).size, FILIERE_ORDER.length, 'two punches are one shape');
});

test('the mark is a plate with an edge, not a silhouette floating on a photo', () => {
  // The finding this pack was rebuilt on, made testable, and it is not this
  // layer's own: `militarySiteIcons.js` measured bare shapes over three crops of
  // a real Gironde capture — forest, urban, water — and they were unfindable
  // below 18 px. This layer's FLOOR is 13 px and its smallest site draws at
  // 15.6, so more than half the hydro fleet sits inside that failure band.
  assert.ok(PLANT_PIXEL_MIN < 18, 'the floor is inside the band a plate exists for');
  for (const key of PLANT_SHAPED_FILIERES) {
    const svg = decode(plantFiliereGlyph(key));
    const ring = svg.match(/<circle cx="48" cy="48" r="([\d.]+)" fill="rgba\(0,0,0,([\d.]+)\)"\/>/);
    assert.ok(ring, `${key} has no ring`);
    assert.ok(Number(ring[2]) >= 0.8, `${key}: a ring at alpha ${ring[2]} is a halo, not an edge`);
    assert.ok(Number(ring[1]) > discRadius(svg), `${key}: the ring must sit outside the plate`);
    assert.match(svg, /fill="#ffffff" mask="url\(#m\)"/, `${key} has no tintable plate`);
    // No hue is baked in, or Cesium's multiply would tint a tint: the CCTV bug.
    const hexes = [...svg.matchAll(/#[0-9a-fA-F]{6}/g)].map((match) => match[0].toLowerCase());
    assert.deepEqual([...new Set(hexes)].sort(), ['#000000', '#ffffff'], key);
  }
});

test('the silhouette is punched by a mask, because fill-rule cannot reach it', () => {
  // `fill-rule="evenodd"` spans the subpaths of ONE path element, and every
  // glyph here arrives inside a `<g transform>` — fitting a 15- or 960-unit box
  // into this 96-unit plate is a transform. Getting this wrong does not throw:
  // it draws a plain disc, which is the mark this module exists to stop drawing.
  for (const key of PLANT_SHAPED_FILIERES) {
    const svg = decode(plantFiliereGlyph(key));
    assert.match(svg, /<mask id="m"[^>]*>/, key);
    assert.match(svg, /<g fill="#000000">/, `${key}: the punch must be painted black in the mask`);
    const punch = svg.split('<g fill="#000000">')[1].split('</g></mask>')[0];
    assert.ok(punch.includes('<path'), `${key} punches nothing`);
  }
});

test('a punched silhouette stays inside its plate, and fills it', () => {
  // Two failure modes, one measurement. A shape that overflows the disc stops
  // being a punch and becomes a bite out of the ring — measured on the cooling
  // tower at fraction 0.66, which clipped its own flared base. A shape too small
  // leaves a plate that reads as an undifferentiated dot.
  for (const key of PLANT_SHAPED_FILIERES) {
    const svg = decode(plantFiliereGlyph(key));
    const scale = Number(svg.match(/scale\(([\d.]+)\)/)[1]);
    const punch = svg.split('<g fill="#000000">')[1].split('</g></mask>')[0];
    const reach = Math.max(...[...punch.matchAll(/[\d.]+/g)].map((match) => Number(match[0])));
    const span = scale * reach;
    const plate = 2 * discRadius(svg);
    assert.ok(span <= plate, `${key} draws ${span.toFixed(1)} units into a ${plate} plate`);
    assert.ok(span >= plate / 2, `${key} punches only ${span.toFixed(1)} units of a ${plate} plate`);
  }
});

test('Material’s box hangs BELOW the origin, and the fit has to know it', () => {
  // Every other box in this fleet spans `0 → box` on both axes; Material's spans
  // `-960 → 0` in y. A transform that ignores that draws the glyph one whole box
  // under the plate — an empty pastille, which renders as a design choice rather
  // than as an error. The y offset therefore has to be POSITIVE and about one
  // box-height of scale larger than the x offset.
  for (const key of ['hydraulique', 'thermique']) {
    const svg = decode(plantFiliereGlyph(key));
    const [, x, y] = svg.match(/translate\((-?[\d.]+) (-?[\d.]+)\)/).map(Number);
    const scale = Number(svg.match(/scale\(([\d.]+)\)/)[1]);
    assert.ok(y > x, `${key}: the Material box was fitted as if its origin were zero`);
    assert.ok(Math.abs((y - x) - 960 * scale) < 0.01, `${key}: the y origin is not 960 units up`);
  }
  // The Temaki tower is authored `0 0 15 15`, so its two offsets are equal.
  const tower = decode(plantFiliereGlyph('nucleaire'));
  const [, tx, ty] = tower.match(/translate\((-?[\d.]+) (-?[\d.]+)\)/).map(Number);
  assert.equal(tx, ty);
});

test('the nuclear mark is a cooling tower WITH its trefoil', () => {
  // A plain cooling tower is what a coal plant has. The trefoil is the whole of
  // what makes this glyph say "nuclear", and it is four counter-wound subpaths
  // inside one path: that is what survives the punch, as a hole in the hole —
  // the trefoil comes back in the plate's colour inside the dark tower. Merged
  // or split, it fills in and the mark becomes a different, wrong claim.
  const d = decode(plantFiliereGlyph('nucleaire')).match(/<path d="([^"]+)"/)[1];
  assert.equal((d.match(/M/g) || []).length, 5, 'the trefoil must stay inside the tower path');
  const signedArea = (sub) => {
    const nums = [...`M${sub}`.matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0]));
    const points = [];
    for (let i = 0; i + 1 < nums.length; i += 2) points.push([nums[i], nums[i + 1]]);
    let area = 0;
    for (let i = 0; i < points.length; i += 1) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      area += x1 * y2 - x2 * y1;
    }
    return area / 2;
  };
  const subpaths = d.split('M').filter(Boolean);
  assert.ok(signedArea(subpaths[0]) > 0, 'the tower should wind positive');
  for (const sub of subpaths.slice(1)) {
    assert.ok(signedArea(sub) < 0, 'a trefoil subpath that winds with the tower is not a hole');
  }
});

test('the hydro mark is a drop and NOT a dam', () => {
  // `edfPowerPlants.js` spends a paragraph of its header refusing to conflate a
  // barrage with the usine it feeds — 37 of its 51 hydro plants have a mapped
  // dam vertex within 3 km, and this project draws those structures as their own
  // layer. A mark that pictured a dam would assert what that paragraph denies.
  // Pinned on the vendored path so a future "nicer" icon argues with this first.
  const paths = _plantSymbolPathsForTest();
  assert.ok(paths.water_drop.startsWith('M480-80q-137 0-228.5-94T160-408'));
  assert.ok(paths.local_fire_department.startsWith('M160-400q0-113 67-217t184-182'));
});

test('every Material path is vendored in its own 960 box, unrescaled', () => {
  // A coordinate inside the 15-unit range the map sets use would be the
  // signature of artwork rescaled into the wrong space — the one modification
  // the NOTICE promises did not happen.
  for (const [name, d] of Object.entries(_plantSymbolPathsForTest())) {
    assert.match(d, /^M/, `${name} should start with a moveto`);
    const coords = [...d.matchAll(/-?\d*\.?\d+/g)].map((m) => Math.abs(Number(m[0])));
    assert.ok(coords.length > 20, `${name} looks truncated`);
    assert.ok(Math.max(...coords) > 100, `${name} is not in Material's 960 box`);
    assert.ok(Math.max(...coords) <= 960, `${name} escapes the 960 box`);
  }
});

test('this module borrows the tower and never vendors a second copy', () => {
  // One copy of a vendored path in the repository, reached through the door
  // `mapIcons.js` publishes. A second copy is a second thing to keep in step
  // with the NOTICE that describes it.
  const punch = _plantPunchesForTest().nucleaire;
  const artwork = mapIconGeometry('temaki', 'cooling_tower_radiation');
  assert.ok(artwork, 'the vendored tower disappeared from mapIcons');
  assert.ok(punch.includes(artwork), 'the nuclear punch is not the vendored artwork');
  const source = readFileSync(new URL('./plantFiliereIcons.js', import.meta.url), 'utf8');
  assert.ok(!source.includes('M12 1C10 6 14 12'), 'the tower path is vendored twice');
});

test('the key variant is the map mark minus its ring, and nothing else', () => {
  // The on-map key masks its swatch and a CSS mask reads ALPHA, so the ring —
  // which makes the whole disc opaque — would flatten all three filières into
  // the same dot. Dropping it is the ONLY difference allowed: a key drawn from
  // its own geometry could show a shape the globe does not.
  for (const key of [...PLANT_SHAPED_FILIERES, null]) {
    const map = decode(key ? plantFiliereGlyph(key) : plantUnknownGlyph());
    const swatch = decode(key
      ? plantFiliereGlyph(key, { key: true })
      : plantUnknownGlyph(PLANT_GLYPH_RASTER_PX, { key: true }));
    const ring = map.match(/<circle cx="48" cy="48" r="[\d.]+" fill="rgba\(0,0,0,[\d.]+\)"\/>/)[0];
    assert.equal(map.replace(ring, ''), swatch, `${key}: the key diverged from the map`);
    assert.doesNotMatch(swatch, /rgba\(/, `${key}: the key swatch must be pure alpha`);
  }
});

test('a filière this build has never seen gets a bare plate, not a neighbour’s shape', () => {
  // Borrowing one of the three would assert something the file never said.
  assert.equal(plantFiliereGlyph('géothermie'), null);
  assert.equal(plantFiliereGlyph(null), null);
  assert.equal(plantFiliereGlyph(''), null);
  const plate = plantUnknownGlyph();
  assert.match(plate, /^data:image\/svg\+xml;base64,/);
  // Same plate and same ring as the three that carry a shape — it is the mark
  // with nothing punched into it, not a different idiom.
  const svg = decode(plate);
  assert.match(svg, /fill="#ffffff" mask="url\(#m\)"/);
  assert.equal(svg.split('<g fill="#000000">')[1].split('</g></mask>')[0], '');
  for (const key of FILIERE_ORDER) assert.notEqual(plantFiliereGlyph(key), plate);
});

test('rasters are cached per filière, per size and per variant', () => {
  // Cesium's billboard atlas keys on the image URI. Returning a fresh string per
  // call would put one entry per SITE into the atlas — the failure mode
  // `cesium-particules-et-billboards` records — instead of one per filière.
  for (const key of FILIERE_ORDER) {
    assert.equal(plantFiliereGlyph(key), plantFiliereGlyph(key));
    assert.notEqual(plantFiliereGlyph(key), plantFiliereGlyph(key, { px: 32 }));
    assert.notEqual(plantFiliereGlyph(key), plantFiliereGlyph(key, { key: true }));
  }
  assert.equal(plantUnknownGlyph(), plantUnknownGlyph());
  assert.ok(decode(plantFiliereGlyph('thermique', { px: 32 })).includes('width="32"'));
  assert.ok(decode(plantFiliereGlyph('thermique')).includes(`width="${PLANT_GLYPH_RASTER_PX}"`));
});

test('both notices name every glyph that ships', () => {
  // Apache-2.0 §4 obliges the Material notice; CC0 obliges nothing and the
  // Temaki one ships anyway, because recording where vendored artwork came from
  // is this project's own discipline.
  const material = readFileSync(new URL('../../licenses/material-symbols/NOTICE', import.meta.url), 'utf8');
  for (const name of Object.keys(_plantSymbolPathsForTest())) {
    assert.ok(material.includes(name), `${name} is not named in the Material NOTICE`);
  }
  assert.ok(material.includes('plantFiliereIcons.js'), 'the Material NOTICE names no module');
  const temaki = readFileSync(new URL('../../licenses/temaki/NOTICE', import.meta.url), 'utf8');
  assert.ok(temaki.includes('cooling_tower_radiation'), 'the Temaki NOTICE omits the tower');
});

test('every shaped filière is a filière the layer actually styles', () => {
  // A cheap guard against the two tables drifting apart: the pack is keyed on
  // the same strings `FILIERE_STYLES` is.
  for (const key of PLANT_SHAPED_FILIERES) {
    assert.ok(FILIERE_STYLES[key], `${key} has a mark but no style`);
  }
});
