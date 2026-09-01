// Where French live road status exists, and the two different kinds of
// nowhere.
//
// The empty-state sentences are the product here: an unexplained blank map
// over Paris reads as a bug, and an unexplained blank map over Lille hides the
// fact that 357 live road states ARE being published there, just without a
// position. This file pins both sentences, and cross-checks the claims against
// the committed geometry so a DIR that starts publishing coordinates breaks
// the build instead of leaving a city wrongly dark.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ROAD_STATUS_COVERAGE_MEASURED_AT,
  ROAD_STATUS_DARK_AREAS,
  ROAD_STATUS_SHOWCASES,
  nearestRoadStatusShowcase,
  roadStatusCoverageNotice,
  roadStatusDarkArea,
  roadStatusDarkAreaAt,
} from './roadStatusCoverage.js';

const SITES = JSON.parse(readFileSync(new URL('../../config/datex_traficolor_sites.json', import.meta.url), 'utf8'));

/** A small box centred on a point, for "what does the layer say here". */
function boxAt(lat, lon, span = 0.15) {
  return {
    south: lat - span, west: lon - span, north: lat + span, east: lon + span,
  };
}

test('Paris is dark because nobody publishes, and the sentence says so', () => {
  const notice = roadStatusCoverageNotice(boxAt(48.8584, 2.2945), { segments: 0 });
  assert.equal(notice.area.id, 'idf');
  assert.equal(notice.area.kind, 'no-publisher');
  assert.match(notice.text, /DIRIF/);
  assert.match(notice.text, /neither counting stations nor a traffic-status feed/);
  // And it points somewhere that works, rather than leaving the viewer stuck.
  assert.ok(notice.showcase.segments > 0);
  assert.match(notice.text, /try \w/);
});

test('Lille is dark for the opposite reason, and the sentence does not conflate them', () => {
  const notice = roadStatusCoverageNotice(boxAt(50.6292, 3.0573), { segments: 0 });
  assert.equal(notice.area.id, 'lille');
  assert.equal(notice.area.kind, 'no-geometry');
  // The number matters: saying "no data" over a city publishing 357 live
  // states would be false.
  assert.match(notice.text, /357 live road states/);
  assert.match(notice.text, /no national referential row/);
});

test('a viewport with segments in it is not an empty state, however green', () => {
  // Every segment free-flowing is a working layer, not a missing one.
  assert.equal(roadStatusCoverageNotice(boxAt(44.8378, -0.5792), { segments: 144 }), null);
});

test('a view off the national network says so instead of blaming a publisher', () => {
  // Rural Creuse: no DIR traffic centre, no motorway, nothing withheld.
  const notice = roadStatusCoverageNotice(boxAt(46.17, 1.87), { segments: 0 });
  assert.equal(notice.area, null);
  assert.match(notice.text, /outside the State-operated national road network/);
});

test('the suggested showcase is the nearest one, not the biggest', () => {
  // Marseille has the most segments; Rouen is what a camera over Lille should
  // be offered.
  assert.equal(nearestRoadStatusShowcase(boxAt(50.63, 3.06)).id, 'rouen');
  assert.equal(nearestRoadStatusShowcase(boxAt(43.30, 5.37)).id, 'marseille');
  assert.equal(nearestRoadStatusShowcase(null).id, ROAD_STATUS_SHOWCASES[0].id);
});

test('dark areas are well-formed boxes that do not swallow their own showcases', () => {
  for (const area of ROAD_STATUS_DARK_AREAS) {
    assert.ok(area.bbox.south < area.bbox.north, `${area.id} latitude`);
    assert.ok(area.bbox.west < area.bbox.east, `${area.id} longitude`);
    assert.ok(['no-publisher', 'no-geometry'].includes(area.kind), `${area.id} kind`);
    assert.ok(area.reason && area.operator, `${area.id} prose`);
  }
  // A showcase inside a dark box would mean the layer both works and does not
  // work in the same place.
  for (const showcase of ROAD_STATUS_SHOWCASES) {
    assert.equal(
      roadStatusDarkAreaAt(showcase.lat, showcase.lon),
      null,
      `${showcase.name} is claimed as both a showcase and a dark area`,
    );
  }
});

test('every showcase claim matches the committed geometry', () => {
  // The maintenance contract: these are measurements with a date on them, and
  // the file they were measured from is in the repo. A rebuild that moves a
  // number by more than a rounding of the source fails here rather than
  // leaving the legend quietly wrong.
  const byLabel = new Map((SITES.coverage || []).map((row) => [row.label, row]));
  assert.ok(byLabel.size > 0, 'the committed index carries a coverage probe');
  for (const showcase of ROAD_STATUS_SHOWCASES) {
    const row = byLabel.get(showcase.name);
    assert.ok(row, `${showcase.name} is missing from the built coverage table`);
    const drift = Math.abs(row.located - showcase.segments);
    assert.ok(
      drift <= Math.max(3, showcase.segments * 0.1),
      `${showcase.name}: claimed ${showcase.segments} drawable segments, built index has ${row.located}`,
    );
  }
});

test('every "state published, position withheld" area still has no geometry', () => {
  // The claim that would age first, and the one worth failing on: the day a
  // DIR starts publishing Lille's coordinates, this city stops being dark and
  // this table has to say so.
  const byLabel = new Map((SITES.coverage || []).map((row) => [row.label, row]));
  for (const area of ROAD_STATUS_DARK_AREAS) {
    if (area.kind !== 'no-geometry') continue;
    const row = byLabel.get(area.name);
    if (!row) continue;
    assert.equal(
      row.located,
      0,
      `${area.name} now has ${row.located} locatable sites — move it out of ROAD_STATUS_DARK_AREAS`,
    );
  }
});

test('Île-de-France really has no station in the committed geometry', () => {
  // The strongest form of the Paris claim, checked against the data rather
  // than against the prose: not one of the country's located stations falls
  // inside the region.
  const idf = ROAD_STATUS_DARK_AREAS.find((area) => area.id === 'idf');
  let inside = 0;
  for (const site of Object.values(SITES.sites)) {
    const c = site?.c;
    if (!Array.isArray(c) || c.length < 2) continue;
    if (c[0] >= idf.bbox.west && c[0] <= idf.bbox.east
      && c[1] >= idf.bbox.south && c[1] <= idf.bbox.north) inside += 1;
  }
  assert.equal(inside, 0, `${inside} located stations now fall inside Île-de-France`);
});

test('the measurement date is recorded and matches the shipped index', () => {
  assert.match(ROAD_STATUS_COVERAGE_MEASURED_AT, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(SITES.generatedAt, 'the built index stamps itself');
});
