// src/data/isochroneFeed.test.mjs
// Pins the UPSTREAM IGN isochrone shape against two real captured rings — one
// walking, one driving, same point, same 600 seconds. The pair is the fixture:
// the projection's only job is to make those two comparable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BIKE_ENVELOPE_BEARINGS,
  BIKE_ENVELOPE_SAMPLES,
  CENTRE_ADDRESS_MAX_M,
  ISOCHRONE_MAX_RINGS,
  ISOCHRONE_MAX_SECONDS,
  ISOCHRONE_MIN_SECONDS,
  ISOCHRONE_PROFILES,
  ISOCHRONE_STEPS,
  OSRM_TABLE_MAX_POINTS,
  bearingReachKm,
  bikeFanPoints,
  buildBikeTableUrl,
  buildIsochroneUrl,
  centreTitle,
  clampSeconds,
  destinationPoint,
  equivalentRadiusM,
  formatCoordinates,
  parseSteps,
  projectBikeEnvelope,
  projectCentreAddress,
  projectIsochrone,
  rawRingAreaKm2,
  resolveProfile,
  ringAreaKm2,
  ringExpansion,
} from './isochroneFeed.js';

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const WALK = read('ign-isochrone-pedestrian-sample.json');
const DRIVE = read('ign-isochrone-car-sample.json');

test('the captured rings still carry every field the projection reads', () => {
  for (const sample of [WALK, DRIVE]) {
    for (const key of ['profile', 'costValue', 'costType', 'resourceVersion', 'geometry']) {
      assert.ok(Object.hasOwn(sample, key), `${key} must still be published`);
    }
    assert.equal(sample.geometry.type, 'Polygon');
    assert.equal(sample.costType, 'time');
  }
  assert.equal(WALK.profile, 'pedestrian');
  assert.equal(DRIVE.profile, 'car');
});

test('cycling never reaches the IGN service, because it has no such profile', () => {
  // Re-probed 2026-09-02: `bicycle`, `bike`, `cycle` and `cycling` are all
  // HTTP 400 with `value should be one of car,pedestrian`, on `bdtopo-valhalla`
  // and on `bdtopo-pgr` alike. Cycling is answered by the OSRM envelope below,
  // and this gate is what stops it being answered by a relabelled walking ring.
  assert.equal(resolveProfile('bike'), null);
  assert.equal(resolveProfile('bicycle'), null);
  assert.throws(() => buildIsochroneUrl({ lon: 2.4, lat: 48.8, profile: 'bike', seconds: 600 }),
    /unsupported profile/);
  assert.deepEqual(Object.keys(ISOCHRONE_PROFILES), ['foot', 'car']);
});

// ── The cycling envelope, which is a different kind of answer ───────────────

test('the fan fits one OSRM table request, origin first', () => {
  const fan = bikeFanPoints({ lon: 4.8357, lat: 45.764, seconds: 900 });
  assert.equal(fan.bearings, BIKE_ENVELOPE_BEARINGS);
  assert.equal(fan.radiiKm.length, BIKE_ENVELOPE_SAMPLES);
  assert.equal(fan.points.length, BIKE_ENVELOPE_BEARINGS * BIKE_ENVELOPE_SAMPLES + 1);
  assert.ok(fan.points.length <= OSRM_TABLE_MAX_POINTS, 'above 400 the URL is a 414 upstream');
  assert.deepEqual(fan.points[0], fan.origin, 'the table takes the origin as its only source');
  // Ascending, so a spoke can be walked outward without sorting it first.
  for (let i = 1; i < fan.radiiKm.length; i += 1) {
    assert.ok(fan.radiiKm[i] > fan.radiiKm[i - 1]);
  }
  // The ladder has to OVER-reach, or the fifteen-minute crossing is clipped
  // rather than bracketed. 22 km/h for 900 s is 5.5 km; nobody rides that.
  assert.ok(fan.radiiKm.at(-1) >= 5, `outermost sample ${fan.radiiKm.at(-1)} km must clear a real ride`);
});

test('the ladder is sized from the LONGEST ring asked for, not from a constant', () => {
  const short = bikeFanPoints({ lon: 4.8357, lat: 45.764, seconds: 300 });
  const long = bikeFanPoints({ lon: 4.8357, lat: 45.764, seconds: 900 });
  assert.ok(long.radiiKm.at(-1) > short.radiiKm.at(-1) * 2.5,
    'a five-minute fan read at fifteen minutes would be one big clipped ring');
  // And a fan that cannot fit is refused rather than silently truncated.
  assert.throws(() => bikeFanPoints({ lon: 4.8357, lat: 45.764, seconds: 900, bearings: 90 }),
    /exceeds/);
  assert.throws(() => bikeFanPoints({ lon: NaN, lat: 45.764, seconds: 900 }), /finite/);
});

test('a fan point is spherical, so an envelope is not stretched by latitude', () => {
  // 1 km due east at 45° and at 60° differ by the cosine of the latitude. The
  // flat `dlon = km / 111.32` shortcut gets that wrong by 40 % over Dunkerque,
  // which draws an oval and looks exactly like a finding.
  const [lonMid] = destinationPoint(0, 45, 90, 1);
  const [lonHigh] = destinationPoint(0, 60, 90, 1);
  assert.ok(lonHigh > lonMid * 1.3, 'the same kilometre is more degrees further north');
  const [, latNorth] = destinationPoint(0, 45, 0, 111.32);
  assert.ok(Math.abs(latNorth - 46) < 0.02, 'and due north a degree is still a degree');
});

test('the table URL asks for one row, not the whole matrix', () => {
  const fan = bikeFanPoints({ lon: 4.8357, lat: 45.764, seconds: 900 });
  const url = new URL(buildBikeTableUrl(fan.points));
  assert.equal(url.searchParams.get('sources'), '0', '397² durations is not a request to send anyone');
  assert.match(url.pathname, /routed-bike/);
  assert.match(url.pathname, /^\/routed-bike\/table\/v1\/driving\//);
  assert.equal(url.pathname.split('/').at(-1).split(';').length, fan.points.length);
  assert.throws(() => buildBikeTableUrl([[1, 2]]), /at least one destination/);
  assert.throws(() => buildBikeTableUrl(new Array(500).fill([1, 2])), /capped/);
  assert.throws(() => buildBikeTableUrl([[1, 2], [NaN, 2]]), /finite/);
});

test('a spoke reaches the FURTHEST sample under budget, not the first one over', () => {
  // OSRM is not monotonic along a ray: a sample 200 m further out can snap onto
  // a cycle track and come back quicker. Cutting at the first crossing would
  // report a catchment smaller than the one measured.
  const dip = [{ km: 1, sec: 200 }, { km: 2, sec: 700 }, { km: 3, sec: 500 }, { km: 4, sec: 900 }];
  // The anchor is 3 km at 500 s — past the 2 km dip, not stopped by it — and
  // the crossing is then interpolated on toward 4 km at 900 s.
  assert.equal(bearingReachKm(dip, 600).reachKm, 3.25);
  // The crossing is interpolated in DURATION, so the answer is not quantised
  // to the ladder: half way in time between 200 s at 1 km and 600 s at 2 km.
  assert.deepEqual(bearingReachKm([{ km: 1, sec: 200 }, { km: 2, sec: 600 }], 400),
    { reachKm: 1.5, clipped: false });
  // A ladder that ran out while still inside the budget is a FLOOR and says so.
  assert.deepEqual(bearingReachKm([{ km: 1, sec: 100 }, { km: 2, sec: 200 }], 900),
    { reachKm: 2, clipped: true });
  // Unroutable beyond a point is a real edge, not a clip.
  assert.deepEqual(bearingReachKm([{ km: 1, sec: 100 }, { km: 2, sec: null }], 900),
    { reachKm: 1, clipped: false });
  // Nothing routable at all.
  assert.deepEqual(bearingReachKm([{ km: 1, sec: null }], 900), { reachKm: 0, clipped: false });
  assert.deepEqual(bearingReachKm([], 900), { reachKm: 0, clipped: false });
});

test('the envelope is shaped like an IGN ring, and flagged so it is not read as one', () => {
  const fan = bikeFanPoints({ lon: 4.8357, lat: 45.764, seconds: 900 });
  // A perfectly even network: every sample reachable at 4 minutes per km.
  const durations = [];
  for (let b = 0; b < fan.bearings; b += 1) {
    for (const km of fan.radiiKm) durations.push(km * 240);
  }
  const rings = projectBikeEnvelope({
    durations, fan, steps: [300, 600, 900], snapM: 12.4,
  });
  assert.equal(rings.length, 3);
  for (const ring of rings) {
    // The shape a renderer and the fiche already know how to read.
    assert.ok(Array.isArray(ring.ring) && ring.ring.length === fan.bearings);
    assert.deepEqual(ring.holes, []);
    assert.equal(ring.parts.length, 1);
    assert.ok(ring.areaKm2 > 0);
    // And the four fields that stop it being read as an IGN polygon.
    assert.equal(ring.envelope, true);
    assert.equal(ring.profile, 'bike');
    assert.equal(ring.resourceVersion, null, 'OSRM publishes no data version on /table');
    assert.equal(ring.bearings, fan.bearings);
    assert.equal(ring.snapM, 12);
  }
  // Even ground grows with the square of time, and this synthetic network is
  // exactly even — so the areas must land near the free-space 4× and 2.25×.
  const [five, ten, fifteen] = rings.map((ring) => ring.areaKm2);
  assert.ok(Math.abs(ten / five - 4) < 0.1, `${ten}/${five}`);
  assert.ok(Math.abs(fifteen / ten - 2.25) < 0.1, `${fifteen}/${ten}`);
});

test('an envelope with nothing reachable is dropped, not drawn as a dot', () => {
  const fan = bikeFanPoints({ lon: 4.8357, lat: 45.764, seconds: 900 });
  const dead = new Array(fan.bearings * fan.radiiKm.length).fill(null);
  assert.deepEqual(projectBikeEnvelope({ durations: dead, fan, steps: [300, 600, 900] }), []);
  // A row that does not match the fan is refused outright: reading it
  // bearing-major would rotate the envelope against the ground.
  assert.deepEqual(projectBikeEnvelope({ durations: [1, 2, 3], fan, steps: [900] }), []);
  assert.deepEqual(projectBikeEnvelope({ durations: dead, fan: null, steps: [900] }), []);
});

test('a clipped spoke is counted, because the drawn edge is then a floor', () => {
  const fan = bikeFanPoints({ lon: 4.8357, lat: 45.764, seconds: 900 });
  // Everything reachable in a second: every spoke runs off the end of the ladder.
  const instant = new Array(fan.bearings * fan.radiiKm.length).fill(1);
  const [ring] = projectBikeEnvelope({ durations: instant, fan, steps: [900] });
  assert.equal(ring.clippedBearings, fan.bearings);
  assert.equal(ring.reachKm.min, fan.radiiKm.at(-1));
});

test('both the app spelling and the IGN spelling resolve', () => {
  assert.equal(resolveProfile('foot'), 'pedestrian');
  assert.equal(resolveProfile('pedestrian'), 'pedestrian');
  assert.equal(resolveProfile('CAR'), 'car');
});

test('the URL carries the resource, the cost type and a clamped duration', () => {
  const url = new URL(buildIsochroneUrl({ lon: 2.3760, lat: 48.8300, profile: 'foot', seconds: 99_999 }));
  assert.equal(url.searchParams.get('point'), '2.376,48.83');
  assert.equal(url.searchParams.get('resource'), 'bdtopo-valhalla');
  assert.equal(url.searchParams.get('costType'), 'time');
  assert.equal(url.searchParams.get('profile'), 'pedestrian');
  assert.equal(url.searchParams.get('costValue'), String(ISOCHRONE_MAX_SECONDS));
  assert.equal(clampSeconds(1), ISOCHRONE_MIN_SECONDS);
  assert.equal(clampSeconds('x'), 600);
});

test('ten minutes on foot and ten minutes by car are not the same place', () => {
  const walk = projectIsochrone(WALK);
  const drive = projectIsochrone(DRIVE);
  assert.equal(walk.seconds, 600);
  assert.equal(drive.seconds, 600);
  // 0.97 km² against 16 km²: the same duration, sixteen times the reach. This
  // ratio is the whole argument for drawing reachability instead of circles.
  assert.equal(walk.areaKm2, 0.97);
  assert.equal(drive.areaKm2, 16);
  assert.ok(drive.ring.length > walk.ring.length * 10);
});

test('the resource version is relayed, never pinned', () => {
  // It moved between two probes on the same day (2026-08-26, then 2026-08-25),
  // so asserting a value would fail on a Tuesday for no reason. What must hold
  // is that the field arrives: it is the only evidence of which BD TOPO
  // edition the ring was cut from.
  const walk = projectIsochrone(WALK);
  assert.equal(typeof walk.resourceVersion, 'string');
  assert.match(walk.resourceVersion, /^\d{4}-\d{2}-\d{2}$/);
});

test('a non-polygon or degenerate answer projects to null, never to a stray ring', () => {
  assert.equal(projectIsochrone(null), null);
  assert.equal(projectIsochrone({ geometry: { type: 'LineString', coordinates: [] } }), null);
  assert.equal(projectIsochrone({ geometry: { type: 'Polygon', coordinates: [[[1, 2]]] } }), null);
});

test('area is spherical, signed-independent, and zero for a degenerate ring', () => {
  assert.equal(ringAreaKm2([]), 0);
  assert.equal(ringAreaKm2([[0, 0], [1, 0]]), 0);
  const square = [[0, 0], [0, 1], [1, 1], [1, 0]];
  const reversed = [...square].reverse();
  // Winding order must not change the magnitude — the upstream does not
  // promise one, and a negative area would render as an empty ring.
  assert.equal(ringAreaKm2(square), ringAreaKm2(reversed));
  assert.ok(ringAreaKm2(square) > 12_000);
});

test('an absent parameter takes the default, not the minimum', () => {
  // FOUND LIVE. `URLSearchParams.get()` returns `null` when a parameter is
  // absent, `Number(null)` is `0`, and `Number.isFinite(0)` is true — so the
  // clamp read "the caller said nothing" as "the caller said zero" and returned
  // its MINIMUM. `GET /api/dpe` with no radius scanned 50 m instead of 200 m and
  // reported `total: 0` for an address with 2,805 diagnostics around it.
  const absent = new URL('http://x/?other=1').searchParams.get('seconds');
  assert.equal(absent, null);
  assert.equal(clampSeconds(absent), 600);
  assert.equal(clampSeconds(''), 600);
  assert.equal(clampSeconds(undefined), 600);
  // An EXPLICIT zero is still a request, and is still clamped to the floor.
  assert.equal(clampSeconds('0'), 120);
});

// ── The ring LIST, added when the service got a layer ───────────────────────

test('an absent seconds parameter means the three rings a brief asks for', () => {
  assert.deepEqual(parseSteps(undefined), [...ISOCHRONE_STEPS]);
  assert.deepEqual(parseSteps(null), [...ISOCHRONE_STEPS]);
  assert.deepEqual(parseSteps(''), [...ISOCHRONE_STEPS]);
  assert.deepEqual(parseSteps('   '), [...ISOCHRONE_STEPS]);
});

test('a single value still answers a single ring, because that is what shipped first', () => {
  // The route was a one-ring service before it had a layer, and a caller
  // reading the old docs must not silently get three requests' worth.
  assert.deepEqual(parseSteps('600'), [600]);
  assert.deepEqual(parseSteps(900), [900]);
});

test('the list is sorted, de-duplicated, clamped and bounded', () => {
  assert.deepEqual(parseSteps('900,300,600'), [300, 600, 900]);
  assert.deepEqual(parseSteps('600,600,600'), [600]);
  // Each ring is an upstream round trip against a service published at 5 req/s
  // with an explicit right to cut a client off, so the ceiling is a real limit
  // rather than a defensive one.
  assert.equal(parseSteps('120,180,240,300,360,420,480').length, ISOCHRONE_MAX_RINGS);
  // Out-of-range values are clamped rather than rejected, matching clampSeconds.
  assert.deepEqual(parseSteps('1,999999'), [ISOCHRONE_MIN_SECONDS, ISOCHRONE_MAX_SECONDS]);
  // Garbage clamps to the same default a bare `seconds=` would.
  assert.deepEqual(parseSteps('abc'), [600]);
  assert.deepEqual(parseSteps(',,,'), [...ISOCHRONE_STEPS]);
});

test('the expansion is measured area against measured area — no speed, no model', () => {
  // Free space: area grows with the square of time, so 300 → 600 quadruples.
  const free = ringExpansion([
    { seconds: 300, areaKm2: 1 },
    { seconds: 600, areaKm2: 4 },
    { seconds: 900, areaKm2: 9 },
  ]);
  assert.equal(free.length, 2);
  assert.equal(free[0].ratio, 4);
  assert.equal(free[0].freeSpaceRatio, 4);
  assert.equal(free[0].share, 100);
  assert.equal(free[1].share, 100);
});

test('the two real Lyon rings report the obstruction they actually have', () => {
  // Measured live over the Presqu'île, 2026-09-02: 0.28 / 0.94 / 2.16 km².
  const lyon = ringExpansion([
    { seconds: 300, areaKm2: 0.28 },
    { seconds: 600, areaKm2: 0.94 },
    { seconds: 900, areaKm2: 2.16 },
  ]);
  assert.equal(lyon[0].fromSeconds, 300);
  assert.equal(lyon[0].toSeconds, 600);
  assert.equal(lyon[0].share, 83.9, 'the first band frays — 84 % of free-space growth');
  // Above 100 is a real and meaningful state: the network OPENS UP past the
  // first block. It must not be clamped to 100, which would hide it.
  assert.ok(lyon[1].share > 100, `expected the outer band to open up, got ${lyon[1].share}`);
});

test('the expansion refuses rings it cannot compare, rather than dividing by zero', () => {
  assert.deepEqual(ringExpansion([]), []);
  assert.deepEqual(ringExpansion(null), []);
  assert.deepEqual(ringExpansion([{ seconds: 300, areaKm2: 1 }]), [], 'one ring is not a pair');
  assert.deepEqual(ringExpansion([
    { seconds: 300, areaKm2: 0 },
    { seconds: 600, areaKm2: 4 },
  ]), [], 'a zero-area ring is dropped, never used as a denominator');
  assert.deepEqual(ringExpansion([
    { seconds: null, areaKm2: 1 },
    { seconds: 600, areaKm2: 4 },
  ]), [], 'a ring with no duration cannot be placed in the sequence');
});

test('the expansion sorts what it is given, so a caller cannot invert it', () => {
  const out = ringExpansion([
    { seconds: 900, areaKm2: 9 },
    { seconds: 300, areaKm2: 1 },
    { seconds: 600, areaKm2: 4 },
  ]);
  assert.deepEqual(out.map((step) => step.fromSeconds), [300, 600]);
});

test('the equivalent radius is the circle this layer exists to refuse', () => {
  // A circle of 1 km² has a radius of 564 m; rounded to ten, 560.
  assert.equal(equivalentRadiusM(1), 560);
  // The measured Lyon 15-minute walk, 2.16 km² → 829 m, rounded to 830.
  assert.equal(equivalentRadiusM(2.16), 830);
  assert.equal(equivalentRadiusM(0), 0);
  assert.equal(equivalentRadiusM(-1), 0);
  assert.equal(equivalentRadiusM(null), 0);
});

test('the captured rings project and then compare as a set', () => {
  // The two fixtures are the SAME point and the SAME 600 s in two profiles, so
  // they are not a nested pair — but they still have to survive the pipeline
  // the layer runs them through.
  const walk = projectIsochrone(WALK);
  const drive = projectIsochrone(DRIVE);
  assert.ok(walk.areaKm2 > 0 && drive.areaKm2 > 0);
  assert.ok(drive.areaKm2 > walk.areaKm2, 'a car reaches further than a walk in the same time');
  assert.ok(equivalentRadiusM(drive.areaKm2) > equivalentRadiusM(walk.areaKm2));
});

// ── The rings the service can send that the projection used to mishandle ─────

/** A closed square ring in degrees. */
const square = (lon, lat, half) => [
  [lon - half, lat - half], [lon + half, lat - half],
  [lon + half, lat + half], [lon - half, lat + half],
];

test('a hole is kept, and taken off the area rather than sold as catchment', () => {
  // THE BUG THIS TEST EXISTS FOR. The projection read `coordinates[0]` and
  // dropped every interior ring, so a fenced railway yard or a courtyard with
  // no way in was counted as ground you can walk to — in the area printed on
  // the card, and in the population the fiche joins against it.
  const donut = {
    costValue: 900,
    geometry: { type: 'Polygon', coordinates: [square(4.85, 45.75, 0.05), square(4.85, 45.75, 0.02)] },
  };
  const projected = projectIsochrone(donut);
  assert.equal(projected.holes.length, 1, 'the hole survives the projection');
  assert.equal(projected.ring.length, 4);
  const outer = rawRingAreaKm2(square(4.85, 45.75, 0.05));
  const inner = rawRingAreaKm2(square(4.85, 45.75, 0.02));
  assert.equal(projected.areaKm2, Math.round((outer - inner) * 100) / 100);
  assert.ok(projected.areaKm2 < ringAreaKm2(square(4.85, 45.75, 0.05)), 'strictly less than the exterior');
});

test('a hole too small to round to a hundredth is still subtracted', () => {
  // Rounding each ring before subtracting would make every small courtyard
  // vanish: `ringAreaKm2` rounds to 0,00 well before a hole stops mattering.
  const tiny = square(4.85, 45.75, 0.0001);
  assert.equal(ringAreaKm2(tiny), 0, 'rounds away on its own');
  assert.ok(rawRingAreaKm2(tiny) > 0, 'but it is not zero');
});

test('one bad vertex refuses the ring instead of bridging across it', () => {
  // THE OTHER HALF OF THE BUG. The old loop `continue`d past unusable vertices
  // and joined their neighbours, redrawing the shape across whatever was
  // wrong. Worse, it parsed with `Number()`: `Number(null)` is 0 and passes
  // `Number.isFinite`, so a null longitude planted a vertex at 0°E and the ring
  // was drawn out into the Atlantic and back.
  const withNull = {
    costValue: 900,
    geometry: {
      type: 'Polygon',
      coordinates: [[[4.8, 45.7], [4.9, 45.7], [null, 45.75], [4.9, 45.8], [4.8, 45.8]]],
    },
  };
  assert.equal(projectIsochrone(withNull), null, 'a ring with a hole in its data is not a ring');
  for (const bad of [[undefined, 45.7], ['4.8', 45.7], [4.8, NaN], [200, 45.7], [4.8, 95]]) {
    assert.equal(
      projectIsochrone({
        costValue: 900,
        geometry: { type: 'Polygon', coordinates: [[[4.8, 45.7], [4.9, 45.7], bad, [4.8, 45.8]]] },
      }),
      null,
      JSON.stringify(bad),
    );
  }
});

test('a catchment in two pieces is two pieces, not a refusal', () => {
  // The old code answered null for a MultiPolygon and the layer reported a
  // missing ring. Refusing is safe; it is not an answer.
  const islands = {
    costValue: 900,
    geometry: {
      type: 'MultiPolygon',
      coordinates: [[square(4.85, 45.75, 0.01)], [square(4.95, 45.75, 0.03)]],
    },
  };
  const projected = projectIsochrone(islands);
  assert.equal(projected.parts.length, 2);
  assert.equal(projected.ring[0][0], 4.92, 'the largest piece leads, whatever order it arrived in');
  const total = rawRingAreaKm2(square(4.85, 45.75, 0.01)) + rawRingAreaKm2(square(4.95, 45.75, 0.03));
  assert.equal(projected.areaKm2, Math.round(total * 100) / 100, 'the area is the sum');
  // A geometry that is not an area at all is still refused.
  assert.equal(projectIsochrone({ costValue: 900, geometry: { type: 'LineString', coordinates: [[4.8, 45.7]] } }), null);
});

test('an ordinary polygon still projects to one part with no holes', () => {
  const walk = projectIsochrone(WALK);
  assert.equal(walk.holes.length, 0);
  assert.equal(walk.parts.length, 1);
  assert.equal(walk.parts[0].ring, walk.ring);
});

// ── What the centre is called ───────────────────────────────────────────────

/** A BAN reverse answer, shaped as the service actually returns one. */
function banAnswer({ label, city, distance, citycode = '40088' }) {
  return {
    type: 'FeatureCollection',
    features: [{
      properties: {
        label, city, distance, citycode, postcode: '40100', street: 'Rue Gambetta', housenumber: '8',
      },
    }],
  };
}

test('the projection keeps the distance instead of using it to reject', () => {
  const far = projectCentreAddress(banAnswer({
    label: 'Route de la Parcelle 40990 Saint-Paul-lès-Dax', city: 'Saint-Paul-lès-Dax', distance: 412.6,
  }));
  assert.equal(far.distanceM, 413, 'rounded to the metre and carried, not dropped');
  assert.equal(far.city, 'Saint-Paul-lès-Dax');
  // The cadastre's own projection drops this answer outright; a catchment card
  // still has to be titled, so the decision is made where the title is written.
  assert.ok(far.label);
});

test('an answer with neither a label nor a commune is no answer', () => {
  assert.equal(projectCentreAddress(null), null);
  assert.equal(projectCentreAddress({ features: [] }), null);
  assert.equal(projectCentreAddress({ features: [{ properties: { distance: 4 } }] }), null);
});

test('a near address titles the card; a far one only names the commune', () => {
  const near = projectCentreAddress(banAnswer({
    label: '8 Rue Gambetta 40100 Dax', city: 'Dax', distance: 11,
  }));
  assert.equal(centreTitle(near, { lon: -1.05, lat: 43.7 }), '8 Rue Gambetta 40100 Dax');
  const far = projectCentreAddress(banAnswer({
    label: '8 Rue Gambetta 40100 Dax', city: 'Dax', distance: CENTRE_ADDRESS_MAX_M + 1,
  }));
  assert.equal(centreTitle(far, { lon: -1.05, lat: 43.7 }), 'Dax',
    'a street number a block and a half away is a confident lie');
  // Exactly at the threshold is still the address.
  const edge = projectCentreAddress(banAnswer({
    label: '8 Rue Gambetta 40100 Dax', city: 'Dax', distance: CENTRE_ADDRESS_MAX_M,
  }));
  assert.equal(centreTitle(edge, { lon: -1.05, lat: 43.7 }), '8 Rue Gambetta 40100 Dax');
});

test('with no address at all the coordinate is the title, written in French', () => {
  const title = centreTitle(null, { lon: -1.0522, lat: 43.7069 });
  assert.equal(title, '43,7069 N · 1,0522 O');
  assert.equal(centreTitle(null, { lon: 7.2661, lat: -21.2 }), '21,2000 S · 7,2661 E');
  assert.equal(formatCoordinates(0, 0), '0,0000 N · 0,0000 E');
});

test('a BAN answer the geocoder gave no distance for is still trusted', () => {
  // The service always sends one; if it stops, the nearest address is still the
  // nearest address, and refusing it would blank every title at once.
  const noDistance = projectCentreAddress(banAnswer({
    label: '8 Rue Gambetta 40100 Dax', city: 'Dax', distance: undefined,
  }));
  assert.equal(noDistance.distanceM, null);
  assert.equal(centreTitle(noDistance, { lon: -1.05, lat: 43.7 }), '8 Rue Gambetta 40100 Dax');
});
