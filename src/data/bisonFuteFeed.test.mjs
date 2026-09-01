// src/data/bisonFuteFeed.test.mjs
// Pins the UPSTREAM Bison Futé shapes against real captured DATEX II documents.
// These are the projections the dev-server proxy runs, so they are the code
// that breaks first if Tipi changes a feed — and the only part of the Bison
// Futé path a browser test would never see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BISON_FUTE_EVENT_CATEGORIES,
  QTV_MISSING_COLUMN,
  QTV_REFERENTIAL_COLUMNS,
  QTV_SPEED_CEILING_KMH,
  classifyEventRecord,
  decodeXmlText,
  descend,
  findAll,
  l93ToWgs84,
  parseQtvReferential,
  parseTimestampMs,
  parseXml,
  projectRoadEvents,
  projectRoadSensors,
  resolveEventState,
  shortenOperator,
} from './bisonFuteFeed.js';

const read = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const EVENTS_XML = read('bison-fute-evenementiel-sample.xml');
const QTV_XML = read('bison-fute-qtv-sample.xml');
const QTV_CSV = read('bison-fute-qtv-referentiel-sample.csv');

/** The captured snapshot's own publication instant, so `state` never drifts. */
const CAPTURE_MS = Date.parse('2026-08-31T21:13:26.825+02:00');
/** When the QTV file was actually written, 11 minutes after it says it was. */
const QTV_CAPTURE_MS = Date.parse('2026-08-31T22:11:52+02:00');

// ---------------------------------------------------------------------------
// The XML reader
// ---------------------------------------------------------------------------

test('the reader strips namespace prefixes, so one schema needs one code path', () => {
  const root = parseXml('<a:root xmlns:a="urn:x"><a:child b:id="7" xmlns:b="urn:y">go</a:child></a:root>');
  assert.equal(root.name, 'root');
  assert.equal(root.children[0].name, 'child');
  assert.equal(root.children[0].attrs.id, '7');
  assert.equal(root.children[0].text, 'go');
});

test('the reader handles self-closing tags, comments, CDATA and entities', () => {
  const root = parseXml(
    '<?xml version="1.0"?><!DOCTYPE r><r><empty/><!-- skip me -->'
    + '<t>caf&#233; &amp; d&#xE9;viation</t><c><![CDATA[<not a tag>]]></c></r>',
  );
  assert.equal(root.children.length, 3);
  assert.equal(root.children[0].name, 'empty');
  assert.equal(root.children[0].children.length, 0);
  assert.equal(root.children[1].text, 'café & déviation');
  assert.equal(root.children[2].text, '<not a tag>');
});

test('an unknown entity survives intact rather than becoming a silent hole', () => {
  assert.equal(decodeXmlText('A &nbsp; B'), 'A &nbsp; B');
  assert.equal(decodeXmlText('&lt;&gt;&quot;&apos;&amp;'), '<>"\'&');
});

test('a document with no element at all throws instead of reading as empty', () => {
  // The failure this prevents: an HTML error page from the origin projecting to
  // `{events: []}` and reaching the globe as "France has no incidents today".
  assert.throws(() => parseXml('<!-- nothing here -->'), /no root element/);
  assert.throws(() => parseXml(''), /no root element/);
});

test('a mismatched close tag unwinds to its own element, not to the document', () => {
  const root = parseXml('<r><a><b>x</a><c>y</c></r>');
  assert.equal(findAll(root, 'c').length, 1);
  assert.equal(findAll(root, 'c')[0].text, 'y');
});

test('timestamps parse to epoch ms or to null — never to NaN', () => {
  assert.equal(parseTimestampMs('2026-08-31T21:13:26.825+02:00'), 1788203606825);
  for (const bad of [null, undefined, '', '   ', 'jeudi', {}]) {
    assert.equal(parseTimestampMs(bad), null, `${JSON.stringify(bad)} must parse to null`);
  }
});

// ---------------------------------------------------------------------------
// Lambert-93
// ---------------------------------------------------------------------------

test('the Lambert-93 inverse lands the referential where France is', () => {
  // The projection's own definition point: false easting/northing sit at
  // 46.5 N, 3 E exactly.
  const [lon, lat] = l93ToWgs84(700_000, 6_600_000);
  assert.ok(Math.abs(lon - 3) < 1e-9, `lon ${lon}`);
  assert.ok(Math.abs(lat - 46.5) < 1e-9, `lat ${lat}`);
  // A real referential row: station MUM76.h1 on the A28 north of Rouen.
  const [x, y] = l93ToWgs84(569_981.6, 6_938_140.0);
  assert.ok(Math.abs(x - 1.20466) < 1e-4, `lon ${x}`);
  assert.ok(Math.abs(y - 49.52927) < 1e-4, `lat ${y}`);
});

test('an out-of-domain ordinate returns null rather than a plausible wrong place', () => {
  // 0/0 is the referential's own "no value", and it converts to a coordinate in
  // the Atlantic off Africa if the bounds check is skipped.
  assert.equal(l93ToWgs84(0, 0), null);
  assert.equal(l93ToWgs84('', ''), null);
  assert.equal(l93ToWgs84(569_981.6, 12_000_000), null);
  assert.equal(l93ToWgs84(Number.NaN, 6_600_000), null);
});

// ---------------------------------------------------------------------------
// Événementiel-DIR
// ---------------------------------------------------------------------------

test('the captured events document still carries every field the projection reads', () => {
  const root = parseXml(EVENTS_XML);
  const publication = findAll(root, 'payloadPublication')[0];
  assert.ok(publication, 'payloadPublication must still be published');
  assert.equal(descend(publication, 'publicationTime').text, '2026-08-31T21:13:26.825+02:00');
  const situations = findAll(publication, 'situation');
  assert.equal(situations.length, 9);
  for (const situation of situations) {
    assert.match(situation.attrs.id, /^\d{6}-\d{6}$/);
    assert.ok(descend(situation, 'overallSeverity').text);
    const records = situation.children.filter((node) => node.name === 'situationRecord');
    assert.ok(records.length >= 1);
    for (const record of records) {
      assert.ok(record.attrs.type, 'every record must still declare an xsi:type');
      assert.ok(descend(record, 'groupOfLocations'), 'every record must still carry a location');
    }
  }
});

test('one situation projects to exactly one drawn event', () => {
  const projected = projectRoadEvents(EVENTS_XML, { nowMs: CAPTURE_MS });
  assert.equal(projected.counts.situations, 9);
  assert.equal(projected.counts.records, 16);
  assert.equal(projected.events.length, 9);
  assert.equal(projected.counts.undrawable, 0);
  assert.equal(projected.publishedAt, '2026-08-31T21:13:26.825+02:00');
  assert.equal(projected.publishedAtMs, CAPTURE_MS);
  assert.equal(projected.supplier, 'Tipi');
});

test('the CAUSE wins the situation, and its consequences are counted beside it', () => {
  const projected = projectRoadEvents(EVENTS_XML, { nowMs: CAPTURE_MS });
  // 260830-002035 is an Accident plus the lane management it caused. Drawing
  // both would put one crash on the map twice.
  const accident = projected.events.find((event) => event.id === '260830-002035');
  assert.equal(accident.category, 'accident');
  assert.equal(accident.type, 'Accident');
  assert.deepEqual(accident.also, { restriction: 1 });
  // 260122-001698 is roadworks that close a road and post a diversion. The
  // works are the event; the closure and the diversion are what it does.
  const works = projected.events.find((event) => event.id === '260122-001698');
  assert.equal(works.category, 'travaux');
  assert.deepEqual(works.also, { fermeture: 1, deviation: 1 });
  // 260113-001342 is nothing but diversions, so a diversion is allowed to win.
  const detour = projected.events.find((event) => event.id === '260113-001342');
  assert.equal(detour.category, 'deviation');
  assert.deepEqual(detour.also, {});
});

test('a closure is told apart from a restriction by its subtype, not its class', () => {
  assert.equal(classifyEventRecord('RoadOrCarriagewayOrLaneManagement', 'roadClosed'), 'fermeture');
  assert.equal(classifyEventRecord('RoadOrCarriagewayOrLaneManagement', 'narrowLanes'), 'restriction');
  assert.equal(classifyEventRecord('RoadOrCarriagewayOrLaneManagement', null), 'restriction');
  assert.equal(classifyEventRecord('Accident', 'accident'), 'accident');
  assert.equal(classifyEventRecord('MaintenanceWorks', 'grassCuttingWork'), 'travaux');
  // A class DATEX II adds after this ships must still land somewhere drawable.
  assert.equal(classifyEventRecord('SomethingInventedIn2030', null), 'restriction');
  const projected = projectRoadEvents(EVENTS_XML, { nowMs: CAPTURE_MS });
  for (const event of projected.events) {
    assert.ok(
      BISON_FUTE_EVENT_CATEGORIES.includes(event.category),
      `${event.id} projected an undrawable category: ${event.category}`,
    );
  }
});

test('the operator declaring an event over outranks its still-open window', () => {
  const projected = projectRoadEvents(EVENTS_XML, { nowMs: CAPTURE_MS });
  // 260131-000090 is the case that decides the rule: a rockfall opened on
  // 31 January whose validity window has NO end time at all, and which the DIR
  // has since closed with `lifeCycleManagement/end`. Read on its window alone
  // it is a landslide that has been blocking the N20 for seven months.
  const cleared = projected.events.find((event) => event.id === '260131-000090');
  assert.equal(cleared.state, 'ended');
  assert.equal(cleared.end, null);
  assert.equal(cleared.start, Date.parse('2026-01-31T02:22:31.507+01:00'));

  assert.equal(resolveEventState({ ended: true, start: null, end: null, nowMs: 10 }), 'ended');
  assert.equal(resolveEventState({ ended: false, start: 5, end: 8, nowMs: 10 }), 'ended');
  assert.equal(resolveEventState({ ended: false, start: 20, end: null, nowMs: 10 }), 'planned');
  assert.equal(resolveEventState({ ended: false, start: 5, end: 20, nowMs: 10 }), 'active');
  assert.equal(resolveEventState({ ended: false, start: null, end: null, nowMs: 10 }), 'active');
});

test('roadworks ordered for October are planned, not happening now', () => {
  const projected = projectRoadEvents(EVENTS_XML, { nowMs: CAPTURE_MS });
  const october = projected.events.find((event) => event.id === '260122-001698');
  assert.equal(october.state, 'planned');
  assert.equal(october.start, Date.parse('2026-10-01T08:30:00.000+02:00'));
  assert.deepEqual(projected.counts, {
    situations: 9, records: 16, undrawable: 0, points: 6, segments: 3,
    active: 4, planned: 2, ended: 3, safety: 4,
  });
});

test('a segment carries both published endpoints; a point carries one', () => {
  const projected = projectRoadEvents(EVENTS_XML, { nowMs: CAPTURE_MS });
  const segment = projected.events.find((event) => event.geometry.kind === 'segment');
  assert.equal(segment.geometry.coordinates.length, 4);
  const point = projected.events.find((event) => event.geometry.kind === 'point');
  assert.equal(point.geometry.coordinates.length, 2);
  for (const event of projected.events) {
    for (let i = 0; i < event.geometry.coordinates.length; i += 2) {
      const [lon, lat] = event.geometry.coordinates.slice(i, i + 2);
      assert.ok(lon > -6 && lon < 10, `${event.id} lon ${lon} is outside France`);
      assert.ok(lat > 41 && lat < 52, `${event.id} lat ${lat} is outside France`);
      // 5 dp, so the served payload cannot carry the feed's false precision.
      assert.equal(Math.round(lon * 1e5) / 1e5, lon);
    }
  }
});

test('the internal note stays internal', () => {
  // 260113-001342 publishes an internalNote comment in the open feed. It is the
  // operator talking to their own district, not to a map.
  assert.ok(EVENTS_XML.includes('internalNote'), 'the fixture must still hold one');
  const projected = projectRoadEvents(EVENTS_XML, { nowMs: CAPTURE_MS });
  const notes = parseXml(EVENTS_XML);
  const internal = findAll(notes, 'generalPublicComment')
    .filter((comment) => descend(comment, 'commentType')?.text === 'internalNote')
    .map((comment) => descend(comment, 'comment', 'values', 'value').text.trim());
  assert.ok(internal.length >= 1);
  const serialized = JSON.stringify(projected.events);
  for (const note of internal) assert.ok(!serialized.includes(note), `internal note leaked: ${note}`);
});

test('the first location descriptor is the one a reader can use', () => {
  const projected = projectRoadEvents(EVENTS_XML, { nowMs: CAPTURE_MS });
  const accident = projected.events.find((event) => event.id === '260830-002035');
  assert.equal(accident.location, "situé 6920 m à l'ouest de Le Sauze");
  // Not "DIR Méditerranée/District…", which the same record also publishes as a
  // locationDescriptor and which is an org chart, not a place.
  assert.ok(!accident.location.includes('District'));
  assert.equal(accident.marker, '05PR91U + 941 m');
  assert.equal(accident.road, 'N94');
  assert.equal(accident.town, 'Prunières');
  assert.equal(accident.operator, 'DIR Méditerranée');
  assert.deepEqual(accident.lanes, { restricted: 2, total: 2 });
  assert.equal(accident.safety, true);
});

test('the supplier string is shortened to the operator, never emptied', () => {
  assert.equal(shortenOperator('Direction interdépartementale des routes/DIR Sud-Ouest'), 'DIR Sud-Ouest');
  assert.equal(shortenOperator('Gendarmerie/CORG'), 'CORG');
  assert.equal(shortenOperator('Direction interdépartementale des routes'), 'Direction interdépartementale des routes');
  assert.equal(shortenOperator('  '), null);
  assert.equal(shortenOperator(null), null);
});

test('events are ordered newest first, and the order is stable', () => {
  const projected = projectRoadEvents(EVENTS_XML, { nowMs: CAPTURE_MS });
  for (let i = 1; i < projected.events.length; i++) {
    assert.ok(
      (projected.events[i - 1].updated ?? 0) >= (projected.events[i].updated ?? 0),
      'events must be ordered newest first',
    );
  }
  const again = projectRoadEvents(EVENTS_XML, { nowMs: CAPTURE_MS });
  assert.equal(JSON.stringify(projected.events), JSON.stringify(again.events));
});

// ---------------------------------------------------------------------------
// QTV-DIR
// ---------------------------------------------------------------------------

test('the referential still publishes 20 headers over 19-column rows', () => {
  // This is the defect the parser exists for, and it must be OBSERVED, not
  // assumed: if Tipi ever repairs the file, this test fails and the repair
  // path below is what keeps working.
  const lines = QTV_CSV.split(/\r?\n/).filter(Boolean);
  assert.deepEqual(lines[0].split(';'), [...QTV_REFERENTIAL_COLUMNS]);
  assert.equal(QTV_REFERENTIAL_COLUMNS.length, 20);
  for (const line of lines.slice(1)) assert.equal(line.split(';').length, 19);
});

test('the repaired header puts Lambert-93 metres in the coordinate columns', () => {
  const { stations, counts } = parseQtvReferential(QTV_CSV);
  assert.equal(counts.rows, 8);
  assert.equal(counts.malformed, 0);
  const rouen = stations.get('MUM76.h1');
  // The proof the dropped column is `code_insee_commune` and not another: with
  // any other choice `axe` would hold an INSEE code or a PR, and `from` would
  // be null because a road name does not convert to metres.
  assert.equal(rouen.road, 'A28');
  assert.equal(rouen.dir, 'DIRNO');
  assert.equal(rouen.direction, 'NORD_SUD');
  assert.equal(rouen.marker, '76PR91D');
  assert.equal(rouen.length, 3035);
  assert.ok(Math.abs(rouen.from[0] - 1.20466) < 1e-4);
  assert.ok(Math.abs(rouen.from[1] - 49.52927) < 1e-4);
  assert.equal(QTV_MISSING_COLUMN, 'code_insee_commune');
});

test('a row of the width the header promises is read on the header', () => {
  // Both widths have to work, because the day Tipi fixes the file must not be
  // the day the layer breaks.
  const repaired = QTV_CSV.split(/\r?\n/).filter(Boolean);
  const widened = [repaired[0], ...repaired.slice(1).map((line) => {
    const fields = line.split(';');
    return [...fields.slice(0, 3), '76540', ...fields.slice(3)].join(';');
  })].join('\n');
  const { stations, counts } = parseQtvReferential(widened);
  assert.equal(counts.malformed, 0);
  assert.equal(stations.get('MUM76.h1').road, 'A28');
  assert.equal(stations.get('MUM76.h1').dir, 'DIRNO');
});

test('a row of any other width is refused, never guessed at', () => {
  const lines = QTV_CSV.split(/\r?\n/).filter(Boolean);
  const truncated = [lines[0], lines[1].split(';').slice(0, 12).join(';')].join('\n');
  const { stations, counts } = parseQtvReferential(truncated);
  assert.equal(counts.malformed, 1);
  assert.equal(counts.rows, 0);
  assert.equal(stations.size, 0);
});

test('the referential reports "not stated" as null, not as zero lanes', () => {
  const { stations } = parseQtvReferential(QTV_CSV);
  // 922 of the live file's 1,206 rows publish `nb_voies` 0. Reading that as a
  // count would report three quarters of the national network as laneless.
  assert.equal(stations.get('MUM76.h1').lanes, null);
  const laned = [...stations.values()].filter((station) => station.lanes !== null);
  for (const station of laned) assert.ok(station.lanes > 0);
});

test('a value computed from zero samples is not a measurement', () => {
  const projected = projectRoadSensors(QTV_XML, QTV_CSV, { nowMs: QTV_CAPTURE_MS });
  const byId = new Map(projected.stations.map((station) => [station.id, station]));
  // MYK69.K1 is the whole reason this rule exists: 7,114 vehicles an hour
  // really were counted, and the 0.0 km/h beside them was computed from NO
  // samples. Published as-is it is a stationary motorway that is not there.
  const trap = byId.get('MYK69.K1');
  assert.equal(trap.flow, 7114);
  assert.equal(trap.flowSamples, 420);
  assert.equal(trap.speed, null);
  assert.equal(trap.speedSamples, 0);
  // MM713.O1 published both values from zero samples: an empty station, not an
  // empty road.
  const empty = byId.get('MM713.O1');
  assert.equal(empty.speed, null);
  assert.equal(empty.flow, null);
});

test('a measured zero is kept, because a stopped road is real data', () => {
  const projected = projectRoadSensors(QTV_XML, QTV_CSV, { nowMs: QTV_CAPTURE_MS });
  const byId = new Map(projected.stations.map((station) => [station.id, station]));
  // 600 vehicles an hour at 0 km/h, from 60 samples. That is a jam.
  const stopped = byId.get('MYL42.U2');
  assert.equal(stopped.speed, 0);
  assert.equal(stopped.flow, 600);
  assert.equal(projected.counts.stopped, 1);
  // 0 and 0 from 420 samples on the A42 at 22:00. That is an empty road.
  const silent = byId.get('MY269.C4');
  assert.equal(silent.speed, 0);
  assert.equal(silent.flow, 0);
  assert.equal(projected.counts.silent, 1);
});

test('the documented speed sentinel cannot reach a colour scale', () => {
  const spiked = QTV_XML.replace('<speed>108.0</speed>', '<speed>9999999</speed>');
  const projected = projectRoadSensors(spiked, QTV_CSV, { nowMs: QTV_CAPTURE_MS });
  const station = projected.stations.find((entry) => entry.id === 'MUM76.h1');
  assert.equal(station.speed, null);
  assert.equal(station.flow, 110, 'the flow beside a bad speed is still a measurement');
  assert.ok(QTV_SPEED_CEILING_KMH > 200 && QTV_SPEED_CEILING_KMH < 1000);
});

test('a station the referential cannot place is counted, not shipped', () => {
  const projected = projectRoadSensors(QTV_XML, QTV_CSV, { nowMs: QTV_CAPTURE_MS });
  assert.equal(projected.counts.published, 9);
  assert.equal(projected.counts.positioned, 7);
  assert.equal(projected.stations.length, 7);
  // `#MZo57.2` is measured every six minutes and has no referential row at all.
  assert.equal(projected.counts.unmatched, 1);
  assert.ok(!projected.stations.some((station) => station.id === '#MZo57.2'));
  // MWO56.J1 has a row, but it publishes no coordinates in it.
  assert.ok(!projected.stations.some((station) => station.id === 'MWO56.J1'));
  assert.equal(projected.counts.referential.unpositioned, 1);
});

test('a half-placed station is drawn at the end that is published', () => {
  const projected = projectRoadSensors(QTV_XML, QTV_CSV, { nowMs: QTV_CAPTURE_MS });
  const half = projected.stations.find((station) => station.id === 'MB333.O1');
  assert.ok(half.from);
  assert.equal(half.to, null);
  assert.equal(projected.counts.referential.halfPositioned, 1);
});

test('the age of a reading is published, because the value alone is not the truth', () => {
  const projected = projectRoadSensors(QTV_XML, QTV_CSV, { nowMs: QTV_CAPTURE_MS });
  assert.equal(projected.publishedAt, '2026-08-31T21:54:00.000+02:00');
  assert.equal(projected.measuredAtMs, Date.parse('2026-08-31T22:00:00.000+02:00'));
  // Measured: the file carrying this reading was written at 22:11:52, so it is
  // already ~12 minutes old before any browser can ask for it.
  assert.equal(projected.ageMs, 11 * 60_000 + 52_000);
  const later = projectRoadSensors(QTV_XML, QTV_CSV, { nowMs: QTV_CAPTURE_MS - 3_600_000 });
  assert.equal(later.ageMs, 0, 'a clock behind the feed reports zero age, never negative');
});

test('stations are ordered by id, so two identical snapshots serialize identically', () => {
  const first = projectRoadSensors(QTV_XML, QTV_CSV, { nowMs: QTV_CAPTURE_MS });
  const second = projectRoadSensors(QTV_XML, QTV_CSV, { nowMs: QTV_CAPTURE_MS });
  assert.equal(JSON.stringify(first.stations), JSON.stringify(second.stations));
  const ids = first.stations.map((station) => station.id);
  assert.deepEqual(ids, [...ids].sort());
});
