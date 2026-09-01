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
  assert.match(notice.text, /neither a referential row nor an address/);
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

test('every "state published, position withheld" area still has the geometry it claims', () => {
  // The claim that would age first, and the one worth failing on: the day a
  // DIR starts publishing Lille's coordinates — or the day someone reads its
  // site ids as the addresses the Breton ones turned out to be — this city
  // stops being dark and this table has to say so. Exact equality, because
  // "still zero" and "now four" are the whole content of the entry.
  const byLabel = new Map((SITES.coverage || []).map((row) => [row.label, row]));
  for (const area of ROAD_STATUS_DARK_AREAS) {
    if (area.kind !== 'no-geometry') continue;
    const row = byLabel.get(area.name);
    if (!row) continue;
    assert.equal(
      row.located,
      area.located,
      `${area.name} now has ${row.located} locatable sites, not ${area.located}`
      + ' — re-measure it, and move it out of ROAD_STATUS_DARK_AREAS if it is lit',
    );
  }
});

test('the four cities the point-repère join lit are drawn from the bornage, not from a DIR', () => {
  // The regression that would silently undo this work: a build that stops
  // joining the kilometre-post referential still produces a valid file, with
  // Brittany dark again and no error anywhere.
  assert.ok(SITES.bornage, 'the committed index records the bornage it was joined to');
  assert.ok(SITES.bornage.calibration.n > 500, 'the join is calibrated on the stations that answer both ways');
  assert.ok(
    SITES.bornage.calibration.p50 < 25,
    `the join disagrees with the DIRs' own coordinates by ${SITES.bornage.calibration.p50} m at the median`,
  );
  const byLabel = new Map((SITES.coverage || []).map((row) => [row.label, row]));
  for (const id of ['nantes', 'rennes', 'saint-brieuc', 'lorient-vannes']) {
    const showcase = ROAD_STATUS_SHOWCASES.find((s) => s.id === id);
    assert.ok(showcase, `${id} is a showcase`);
    const row = byLabel.get(showcase.name);
    assert.ok(row, `${showcase.name} is in the built coverage table`);
    assert.ok(
      row.fromPointRepere > 0,
      `${showcase.name} is only drawable because its site ids are point-repère addresses`,
    );
    // Nothing here came from a DIR-published coordinate: every one of these
    // sites carries `g: 'pr'`. A city shows fewer than its total only where
    // the identifier is not an address the bornage holds.
    assert.ok(
      row.fromPointRepere <= row.located,
      `${showcase.name}: ${row.fromPointRepere} placed from a PR but only ${row.located} drawable`,
    );
  }
});

test('the committed segments follow the road, and no segment is a point in disguise', () => {
  // The regression this catches: a build that loses the RRN centreline still
  // writes a valid file — every segment reverts to the chord between its ends
  // and the layer goes back to cutting the inside of every curve, with nothing
  // in the output saying so.
  assert.ok(SITES.centreline, 'the committed file records the survey it was shaped from');
  assert.equal(SITES.centreline.licence, 'Licence Ouverte 2.0');
  assert.ok(
    SITES.centreline.sections > 30000,
    `only ${SITES.centreline.sections} sections joined the bornage — the centreline key has moved`,
  );

  const segments = Object.values(SITES.sites).filter((s) => Array.isArray(s.c) && s.c.length >= 4);
  const shaped = segments.filter((s) => s.c.length > 4);
  assert.ok(
    shaped.length / segments.length > 0.9,
    `only ${shaped.length} of ${segments.length} segments carry a shape between their ends`,
  );
  assert.equal(SITES.stats.shapedFromCentreline, SITES.centreline.shaped);

  // A start equal to its end is a position, not a road. Writing it as a
  // four-number segment asks Cesium to stroke a zero-length ground polyline.
  const degenerate = segments.filter((s) => s.c.length === 4 && s.c[0] === s.c[2] && s.c[1] === s.c[3]);
  assert.equal(degenerate.length, 0, `${degenerate.length} segments start where they end`);
});

test('a shaped segment bends further than the straight line between its ends', () => {
  // The number that made this work worth doing: how far the drawn line sits
  // from the tarmac. Measured here the other way round — a shaped segment must
  // be measurably LONGER than its chord, because the road is.
  const shaped = Object.values(SITES.sites)
    .filter((s) => Array.isArray(s.c) && s.c.length > 4);
  const metres = (aLon, aLat, bLon, bLat) => {
    const meanLat = ((aLat + bLat) / 2) * (Math.PI / 180);
    return Math.hypot((bLon - aLon) * 111320 * Math.cos(meanLat), (bLat - aLat) * 110570);
  };
  let bent = 0;
  for (const site of shaped) {
    const { c } = site;
    let along = 0;
    for (let i = 0; i + 3 < c.length; i += 2) along += metres(c[i], c[i + 1], c[i + 2], c[i + 3]);
    const chord = metres(c[0], c[1], c[c.length - 2], c[c.length - 1]);
    // The ring-road guard is the other side of this: a segment may not run
    // more than three times its chord either.
    assert.ok(along <= 3 * chord + 500, 'a segment wraps the long way round the road');
    if (along > chord * 1.001) bent += 1;
  }
  assert.ok(
    bent / shaped.length > 0.8,
    `only ${bent} of ${shaped.length} shaped segments are longer than their own chord`,
  );
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
