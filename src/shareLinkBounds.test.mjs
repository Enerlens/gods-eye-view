// The geographic bounds a share link is allowed to carry.
//
// Found by QA on 2026-09-03 and pinned here because the failure was SILENT.
// `parseInitialHash` validated `Number.isFinite(lat)` and stopped there, so a
// finite latitude outside [-90, 90] reached `Cesium.Cartesian3.fromDegrees`,
// which does the trigonometry without validating its range: the position is
// reflected through the pole and the longitude flips by 180°.
//
// Measured before the fix: `#lat=123.456&lon=2.35` restored the camera to
// 56.544° / -177.65° — the far side of the planet — with no console entry, no
// `pageerror`, and nothing to tell a reader the link was corrupt. A share link
// has exactly one promise, reproducing a view, so this is the failure mode it
// must not have.
//
// The asymmetry between latitude and longitude is the point of these tests:
// an out-of-range latitude is meaningless and is rejected, while an
// out-of-range longitude names a real meridian by wrapping and is kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ShareLinkManager,
  isShareLatitudeInRange,
  normalizeShareLongitude,
  parseShareAltitude,
  peekShareMapStack,
} from './sharelink.js';

function makeManager(hash = '') {
  globalThis.window = { location: { hash, href: `http://localhost/${hash}` } };
  globalThis.history = {
    replaceState(_state, _title, nextHash) {
      window.location.hash = nextHash;
    },
  };
  const viewer = {
    camera: {
      changed: { addEventListener() {} },
      positionCartographic: { latitude: 0, longitude: 0, height: 1000 },
      heading: 0,
      pitch: -Math.PI / 2,
      roll: 0,
    },
  };
  return new ShareLinkManager(viewer);
}

// ── Latitude ───────────────────────────────────────────────────────────────

test('latitude inside the range is accepted, including both poles', () => {
  for (const lat of [-90, -48.85, 0, 48.85, 90]) {
    assert.equal(isShareLatitudeInRange(lat), true, `${lat} is a real latitude`);
  }
});

test('a finite latitude outside the range is refused', () => {
  // 123.456 is the value measured reflecting to 56.544°; 145 and -145 were the
  // two the QA pass replayed through a real share hash.
  for (const lat of [90.0001, 123.456, 145, -145, 180, 1e9]) {
    assert.equal(isShareLatitudeInRange(lat), false, `${lat} is not a latitude`);
  }
});

test('non-finite latitudes stay refused', () => {
  for (const lat of [NaN, Infinity, -Infinity]) {
    assert.equal(isShareLatitudeInRange(lat), false);
  }
});

test('an out-of-range latitude discards the whole share state', () => {
  // Same contract the non-finite case already had: an unusable coordinate
  // means there is no restoration pending, so the app opens on its default
  // view instead of somewhere the link never named.
  assert.equal(makeManager('#lat=123.456&lon=2.35&alt=400000').parseInitialHash(), null);
  assert.equal(makeManager('#lat=145&lon=2.35').parseInitialHash(), null);
  assert.equal(makeManager('#lat=-145&lon=2.35').parseInitialHash(), null);
});

test('a well-formed hash still restores', () => {
  const state = makeManager('#lat=48.85&lon=2.35&alt=400000').parseInitialHash();
  assert.equal(state.lat, 48.85);
  assert.equal(state.lon, 2.35);
  assert.equal(state.alt, 400000);
});

// ── Longitude ──────────────────────────────────────────────────────────────

test('longitude wraps instead of being refused', () => {
  // 190°E and -170°E are the same meridian, so the link is honest and only
  // needs normalising.
  assert.equal(normalizeShareLongitude(190), -170);
  assert.equal(normalizeShareLongitude(-190), 170);
  assert.equal(normalizeShareLongitude(540), -180);
  assert.equal(normalizeShareLongitude(2.35), 2.35);
});

test('longitude normalisation never returns a signed zero', () => {
  assert.equal(Object.is(normalizeShareLongitude(-360), 0), true);
  assert.equal(Object.is(normalizeShareLongitude(0), 0), true);
});

test('a non-finite longitude is still refused', () => {
  assert.equal(normalizeShareLongitude(NaN), null);
  assert.equal(normalizeShareLongitude(Infinity), null);
  assert.equal(makeManager('#lat=48.85&lon=notanumber').parseInitialHash(), null);
});

test('a wrapped longitude survives into the parsed state', () => {
  const state = makeManager('#lat=48.85&lon=190').parseInitialHash();
  assert.equal(state.lon, -170);
});

// ── Altitude ───────────────────────────────────────────────────────────────

test('a negative altitude falls back rather than going below the ellipsoid', () => {
  // Measured before the fix: `alt=-999999` parked the camera ~995 km under the
  // surface. An altitude this format cannot use is treated like an absent one.
  assert.equal(parseShareAltitude('-999999'), 800);
  assert.equal(parseShareAltitude('-1'), 800);
  assert.equal(parseShareAltitude(null), 800);
  assert.equal(parseShareAltitude('nonsense'), 800);
});

test('ground level and ordinary altitudes are kept', () => {
  assert.equal(parseShareAltitude('0'), 0);
  assert.equal(parseShareAltitude('800'), 800);
  assert.equal(parseShareAltitude('400000'), 400000);
});

test('a negative altitude does not discard the rest of the link', () => {
  // Unlike a bad latitude, a bad altitude is recoverable: the position the
  // link names is still meaningful, so only the height is replaced.
  const state = makeManager('#lat=48.85&lon=2.35&alt=-999999').parseInitialHash();
  assert.equal(state.lat, 48.85);
  assert.equal(state.lon, 2.35);
  assert.equal(state.alt, 800);
});

// ── peekShareMapStack: the basemap, read before the globe exists ────────────
//
// Boot used to activate the build's default and let the hash restore switch to
// the real stack 1.5 s later — two full imagery constructions per page load,
// and a visible OSM → Plan IGN flip on every reload of a `#map=ign-plan` link.
// This helper is what makes it one construction, so its guards have to match
// `parseInitialHash` exactly: a hash that restores nothing must not be allowed
// to choose a basemap either.

test('a valid share link hands over the stack it names', () => {
  assert.equal(peekShareMapStack('#lat=48.85&lon=2.35&map=ign-plan'), 'ign-plan');
  assert.equal(peekShareMapStack('lat=48.85&lon=2.35&map=osm'), 'osm', 'the leading # is optional');
});

test('a share link with no map= leaves the build default alone', () => {
  assert.equal(peekShareMapStack('#lat=48.85&lon=2.35'), null);
  assert.equal(peekShareMapStack(''), null);
  assert.equal(peekShareMapStack('#'), null);
});

test('a hash that would restore nothing chooses no basemap either', () => {
  // Same rejections parseInitialHash makes. Honouring `map=` from a link whose
  // camera is unusable would open on a source no later step justifies.
  assert.equal(peekShareMapStack('#map=ign-plan'), null, 'no coordinates at all');
  assert.equal(peekShareMapStack('#lat=123.456&lon=2.35&map=ign-plan'), null, 'latitude off the planet');
  assert.equal(peekShareMapStack('#lat=48.85&lon=NaN&map=ign-plan'), null, 'unusable longitude');
});

test('an unknown stack id is passed through for the controller to judge', () => {
  // Availability belongs to MapStackController — the one place that knows
  // whether this build has a Google key or an ion token. This helper only reads.
  assert.equal(peekShareMapStack('#lat=48.85&lon=2.35&map=retired-stack'), 'retired-stack');
});
