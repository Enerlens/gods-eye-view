// src/data/bisonFuteFeed.test.mjs
// Pins the UPSTREAM Événementiel-DIR shape against a real captured DATEX II
// document. This is the projection the dev-server proxy runs, so it is the code
// that breaks first if Tipi changes the feed — and the only part of the path a
// browser test would never see. (Tipi's OTHER publication, QTV-DIR, is pinned
// by datexRoadStatus.test.mjs for the road-status-fr layer.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BISON_FUTE_EVENT_CATEGORIES,
  classifyEventRecord,
  decodeXmlText,
  descend,
  findAll,
  parseTimestampMs,
  parseXml,
  projectRoadEvents,
  resolveEventState,
  shortenOperator,
} from './bisonFuteFeed.js';

const EVENTS_XML = readFileSync(
  new URL('./fixtures/bison-fute-evenementiel-sample.xml', import.meta.url),
  'utf8',
);

/** The captured snapshot's own publication instant, so `state` never drifts. */
const CAPTURE_MS = Date.parse('2026-08-31T21:13:26.825+02:00');

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
