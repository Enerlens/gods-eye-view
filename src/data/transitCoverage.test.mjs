// The coverage table is a set of dated claims about French publishers, and
// claims rot. These tests do two jobs: pin the wording rules, and cross-check
// every "nobody publishes here" claim against the index actually shipped in
// `config/`, so an operator that starts publishing breaks the build instead of
// being told, forever, that it does not exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  darkAreaAt,
  darkAreaForBox,
  nearestShowcase,
  transitCoverageNotice,
  TRANSIT_COVERAGE_MEASURED_AT,
  TRANSIT_DARK_AREAS,
  TRANSIT_SHOWCASES,
} from './transitCoverage.js';
import { boxArea, boxesIntersect, boxOverlapArea } from './viewportBox.js';

const INDEX = JSON.parse(readFileSync(new URL('../../config/pan_gtfs_rt_feeds.json', import.meta.url), 'utf8'));

/** A small viewport centred on a point, in the shape the layer sends. */
function viewAt(lat, lon, span = 0.05) {
  return { south: lat - span, west: lon - span, north: lat + span, east: lon + span };
}

test('a viewport with feeds gets no coverage notice at all', () => {
  // The buses exist and are parked. That is the layer's own sentence, and this
  // module must not overwrite it with "nobody publishes here".
  assert.equal(transitCoverageNotice(viewAt(44.8378, -0.5792), { feedsMatched: 3 }), null);
});

test('a dark viewport names the publisher and what it actually withholds', () => {
  const notice = transitCoverageNotice(viewAt(48.8566, 2.3522), { feedsMatched: 0 });
  assert.equal(notice.area.id, 'idf');
  assert.match(notice.text, /Île-de-France Mobilités/);
  assert.match(notice.text, /no GTFS-Realtime resource/);
  // And it points somewhere the layer works, with the measured fleet.
  assert.match(notice.text, /try Rouen \(379 live\)/);
});

test('an empty viewport outside the known dark areas still gets a way out', () => {
  // Rural Corsica: no claim to make about a publisher, but a viewer with a
  // blank screen still needs to know the layer is not broken.
  const notice = transitCoverageNotice(viewAt(42.3, 9.1), { feedsMatched: 0 });
  assert.equal(notice.area, null);
  assert.match(notice.text, /no operator publishes live positions here/);
  assert.ok(notice.showcase.vehicles > 0);
});

test('the suggested city is the nearest one, not the biggest one', () => {
  // Bordeaux has the most vehicles; Lille is nowhere near it.
  assert.equal(nearestShowcase(viewAt(50.63, 3.07)).id, 'rouen');
  assert.equal(nearestShowcase(viewAt(45.76, 4.84)).id, 'montpellier');
  assert.equal(nearestShowcase(viewAt(44.84, -0.58)).id, 'bordeaux');
  // A missing box still answers, rather than throwing at the caller.
  assert.equal(nearestShowcase(null), TRANSIT_SHOWCASES[0]);
});

test('dark areas are found by intersection, not only by containment', () => {
  // A camera on the edge of Lyon is still over Lyon.
  assert.equal(darkAreaForBox(viewAt(45.90, 5.00, 0.02))?.id, 'lyon');
  assert.equal(darkAreaForBox(viewAt(45.60, 4.70, 0.02))?.id, 'lyon');
  assert.equal(darkAreaForBox(viewAt(44.84, -0.58))?.id, undefined);
  assert.equal(darkAreaForBox(null), null);
  assert.equal(darkAreaAt(48.8566, 2.3522)?.id, 'idf');
  assert.equal(darkAreaAt(44.8378, -0.5792), null);
});

test('every claim carries the shape a reader can check', () => {
  assert.match(TRANSIT_COVERAGE_MEASURED_AT, /^\d{4}-\d{2}-\d{2}$/);
  for (const area of TRANSIT_DARK_AREAS) {
    assert.ok(area.operator, `${area.id} must name the publisher it is accusing`);
    assert.ok(area.reason, `${area.id} must say what is missing`);
    assert.ok(area.bbox.north > area.bbox.south && area.bbox.east > area.bbox.west);
  }
  for (const showcase of TRANSIT_SHOWCASES) {
    assert.ok(showcase.vehicles > 0, `${showcase.id} is only a showcase if it has vehicles`);
    assert.ok(showcase.kinds.length > 0);
    assert.ok(Number.isFinite(showcase.lat) && Number.isFinite(showcase.lon));
  }
  // Ordered by fleet size, because that is the order the doc claims.
  const counts = TRANSIT_SHOWCASES.map((entry) => entry.vehicles);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
});

/**
 * A feed contradicts a dark-area claim when it is a CITY-SCALE publication
 * there, which is two measurable things at once:
 *
 *   - most of its own observed footprint lies inside the area, which excludes
 *     the région-wide coach networks whose loose observed rectangles clip
 *     through Lyon and Toulouse without ever serving them; and
 *   - it reported a fleet, which excludes Rosny-sous-Bois's three-bus shuttle
 *     inside the petite couronne.
 *
 * Both thresholds are the claim, not a fudge: "Lyon has no live transit" is
 * false the day TCL publishes 400 buses and stays true while a suburban
 * minibus service publishes three.
 */
const CITY_SCALE_FOOTPRINT_FRACTION = 0.5;
const CITY_SCALE_FLEET = 20;

test('no dark area has quietly acquired a city-scale feed', () => {
  // The failure this catches: Lyon starts publishing vehicle positions, and
  // the layer keeps telling everyone standing over Lyon that it does not.
  const queryable = (INDEX.feeds || []).filter((feed) => (
    feed.bbox && !feed.duplicateOf && feed.health?.quarantined !== true
  ));
  const contradictions = [];
  for (const area of TRANSIT_DARK_AREAS) {
    for (const feed of queryable) {
      if (!boxesIntersect(area.bbox, feed.bbox)) continue;
      const inside = boxOverlapArea(area.bbox, feed.bbox) / boxArea(feed.bbox);
      if (inside < CITY_SCALE_FOOTPRINT_FRACTION) continue;
      if ((feed.vehicleSample || 0) < CITY_SCALE_FLEET) continue;
      contradictions.push(`${area.name} ← ${feed.network} (${feed.id}, ${feed.vehicleSample} sampled)`);
    }
  }
  assert.deepEqual(
    contradictions,
    [],
    'a "dark" area now has a city-scale feed — re-measure and update transitCoverage.js',
  );
});

test('the contradiction rule would actually fire on a real publisher', () => {
  // A rule that can never fail is not a maintenance test. Bordeaux's TBM is
  // the shape of feed that must break the dark list, so assert it would.
  const tbm = (INDEX.feeds || []).find((feed) => feed.network?.startsWith('TBM'));
  assert.ok(tbm?.bbox, 'the shipped index must still contain TBM');
  const bordeaux = { south: 44.75, west: -0.79, north: 44.97, east: -0.46 };
  assert.ok(boxOverlapArea(bordeaux, tbm.bbox) / boxArea(tbm.bbox) >= CITY_SCALE_FOOTPRINT_FRACTION);
  assert.ok((tbm.vehicleSample || 0) >= CITY_SCALE_FLEET);
});

test('every showcase really is covered by the shipped index', () => {
  // The mirror of the test above: a showcase that lost its feed would send
  // people to an empty city.
  const queryable = (INDEX.feeds || []).filter((feed) => (
    feed.bbox && !feed.duplicateOf && feed.health?.quarantined !== true
  ));
  for (const showcase of TRANSIT_SHOWCASES) {
    const point = viewAt(showcase.lat, showcase.lon, 0.02);
    const covering = queryable.filter((feed) => boxesIntersect(feed.bbox, point));
    assert.ok(covering.length > 0, `${showcase.name} has no feed in the shipped index`);
  }
});
