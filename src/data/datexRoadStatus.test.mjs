// The DATEX II road-status feed's parsing contract.
//
// Every fixture below is copied verbatim from the live Bison Futé server on
// 2026-08-31 — including the referential's off-by-one header, which is the
// whole reason this module parses positionally instead of zipping against the
// column names it is given.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_PAYLOAD_CHARS,
  REFERENTIAL_DECLARED_COLUMNS,
  REFERENTIAL_ROW_COLUMNS,
  ROAD_STATUS_LEGEND_ORDER,
  ROAD_STATUS_LEVELS,
  ROAD_STATUS_MAX_BOX_DEG,
  agglomerationLabel,
  formatFlow,
  formatSpeed,
  latestPublicationFile,
  parseIndexDirectories,
  parseQtvMeasurements,
  parseStationReferential,
  parseTraficolorStatuses,
  roadStatusStyle,
  segmentIntersectsBox,
  validRoadStatusBox,
  worseRoadStatus,
} from './datexRoadStatus.js';

/** Two `siteMeasurements` from ALIENOR (Bordeaux), plus one invented enum. */
const TRAFICOLOR_XML = `<?xml version="1.0" encoding="UTF-8"?><d2LogicalModel xmlns="http://datex2.eu/schema/2/2_0" modelBaseVersion="2">
  <payloadPublication lang="fr" xsi:type="MeasuredDataPublication">
    <publicationTime>2026-08-31T22:40:40</publicationTime>
    <siteMeasurements>
      <measurementSiteReference targetClass="MeasurementSiteRecord" id="M7777.B1" version="1.0"/>
      <measurementTimeDefault>2026-08-31T22:40:40+02:00</measurementTimeDefault>
      <measuredValue index="0"><measuredValue><basicData xsi:type="TrafficStatus">
        <trafficStatus numberOfInputValuesUsed="1"><trafficStatusValue>freeFlow</trafficStatusValue></trafficStatus>
      </basicData></measuredValue></measuredValue>
    </siteMeasurements>
    <siteMeasurements>
      <measurementSiteReference targetClass="MeasurementSiteRecord" id="MA279.Z1" version="1.0"/>
      <measurementTimeDefault>2026-08-31T22:40:40+02:00</measurementTimeDefault>
      <measuredValue index="0"><measuredValue><basicData xsi:type="TrafficStatus">
        <trafficStatus numberOfInputValuesUsed="108"><trafficStatusValue>congested</trafficStatusValue></trafficStatus>
      </basicData></measuredValue></measuredValue>
    </siteMeasurements>
    <siteMeasurements>
      <measurementSiteReference targetClass="MeasurementSiteRecord" id="MZZZ.Q9" version="1.0"/>
      <measuredValue index="0"><measuredValue><basicData xsi:type="TrafficStatus">
        <trafficStatus><trafficStatusValue>sideWaysWind</trafficStatusValue></trafficStatus>
      </basicData></measuredValue></measuredValue>
    </siteMeasurements>
  </payloadPublication>
</d2LogicalModel>`;

/** Two stations from `qtvDir.xml`, one of them reporting nothing at all. */
const QTV_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<d2LogicalModel modelBaseVersion="2" xmlns="http://datex2.eu/schema/2/2_0">
  <exchange><subscription>
    <subscriptionStartTime>2026-08-31T22:24:00.000+02:00</subscriptionStartTime>
    <subscriptionStopTime>2026-08-31T22:30:00.000+02:00</subscriptionStopTime>
  </subscription></exchange>
  <payloadPublication xsi:type="MeasuredDataPublication" lang="fre">
    <publicationTime>2026-08-31T22:24:00.000+02:00</publicationTime>
    <siteMeasurements>
      <measurementSiteReference targetClass="MeasurementSiteRecord" id="MUM76.h1" version="1.0"/>
      <measurementTimeDefault>2026-08-31T22:30:00.000+02:00</measurementTimeDefault>
      <measuredValue index="0"><measuredValue><basicData xsi:type="TrafficFlow">
        <vehicleFlow numberOfInputValuesUsed="14"><vehicleFlowRate>140</vehicleFlowRate></vehicleFlow>
      </basicData></measuredValue></measuredValue>
      <measuredValue index="0"><measuredValue><basicData xsi:type="TrafficSpeed">
        <averageVehicleSpeed numberOfInputValuesUsed="14"><speed>113.0</speed></averageVehicleSpeed>
      </basicData></measuredValue></measuredValue>
    </siteMeasurements>
    <siteMeasurements>
      <measurementSiteReference targetClass="MeasurementSiteRecord" id="MSILENT.1" version="1.0"/>
      <measurementTimeDefault>2026-08-31T22:30:00.000+02:00</measurementTimeDefault>
    </siteMeasurements>
  </payloadPublication>
</d2LogicalModel>`;

/** The header and two rows exactly as `refDir.csv` publishes them. */
const REFERENTIAL_CSV = [
  REFERENTIAL_DECLARED_COLUMNS.join(';'),
  'MUM76.h1;DIRNO;237676517;A28;76PR91D;800;76PR94D;840;1;NORD_SUD;Y;;3035;0;569981.6;6938140.0;568217.6;6935783.5;RO76',
  'MB631.B8;DIRSO;733131555;A620;31PR1G;751;31PR2G;604;1;SUD_NORD;W;INTERIEUR;834;0;572626.2;6284049.5;572552.9;6283075.0;TO31',
].join('\n');

const APACHE_INDEX = `<html><body><table>
<tr><td><a href="/publication/bison-fute-ouvert/publicationsDIR/">Parent Directory</a></td></tr>
<tr><td><a href="ALIENOR/">ALIENOR/</a></td></tr>
<tr><td><a href="TRAFIC_TraficStBrieuc/">TRAFIC_TraficStBrieuc/</a></td></tr>
<tr><td><a href="TraficLyon/">TraficLyon/</a></td></tr>
</table></body></html>`;

test('a TRAFICOLOR publication yields one status per site', () => {
  const { publishedAt, statuses } = parseTraficolorStatuses(TRAFICOLOR_XML);
  assert.equal(statuses.size, 3);
  assert.equal(statuses.get('M7777.B1').status, 'freeFlow');
  assert.equal(statuses.get('MA279.Z1').status, 'congested');
  assert.equal(statuses.get('M7777.B1').at, '2026-08-31T20:40:40.000Z');
  assert.ok(publishedAt?.startsWith('2026-08-31T'));
});

test('an enum value the drawing has no colour for becomes `unknown`, not itself', () => {
  // Passing an unrecognised member through would put a state on screen that
  // has no legend row and no colour — a silent grey with no explanation.
  const { statuses } = parseTraficolorStatuses(TRAFICOLOR_XML);
  assert.equal(statuses.get('MZZZ.Q9').status, 'unknown');
});

test('the QTV snapshot carries flow, speed, sample count and its own six-minute window', () => {
  const parsed = parseQtvMeasurements(QTV_XML);
  assert.equal(parsed.windowStart, '2026-08-31T20:24:00.000Z');
  assert.equal(parsed.windowEnd, '2026-08-31T20:30:00.000Z');
  const reading = parsed.measurements.get('MUM76.h1');
  assert.equal(reading.flowVehH, 140);
  assert.equal(reading.speedKph, 113);
  assert.equal(reading.samples, 14);
  // 14 vehicles in six minutes IS 140 per hour — the relationship the card
  // relies on when it calls the number a six-minute average.
  assert.equal(reading.flowVehH, reading.samples * 10);
});

test('a station that reported neither flow nor speed is absent, not stored as nulls', () => {
  const parsed = parseQtvMeasurements(QTV_XML);
  assert.equal(parsed.measurements.has('MSILENT.1'), false);
});

test('the referential is read positionally, because its header is off by one', () => {
  const parsed = parseStationReferential(REFERENTIAL_CSV);
  assert.equal(parsed.headerColumns, 20);
  assert.equal(REFERENTIAL_ROW_COLUMNS, 19);
  assert.equal(parsed.rows, 2);
  assert.equal(parsed.skipped, 0);

  const [rouen, toulouse] = parsed.stations;
  // The four values a naive header-zipped read gets wrong: the road, the two
  // coordinates, and the traficolor zone.
  assert.equal(rouen.axis, 'A28');
  assert.equal(rouen.xStart, 569981.6);
  assert.equal(rouen.yStart, 6938140.0);
  assert.equal(rouen.zone, 'RO76');
  assert.equal(rouen.dir, 'DIRNO');
  assert.equal(toulouse.axis, 'A620');
  assert.equal(toulouse.zone, 'TO31');
  assert.equal(toulouse.xEnd, 572552.9);
});

test('a row that honours the declared twenty columns still parses', () => {
  // If the publisher ever starts sending `code_insee_commune`, the reader must
  // not silently stop working — the shift is detected per row, not assumed.
  const twentyColumnRow = 'MUM76.h1;DIRNO;237676517;76540;A28;76PR91D;800;76PR94D;840;1;NORD_SUD;Y;;3035;0;569981.6;6938140.0;568217.6;6935783.5;RO76';
  const parsed = parseStationReferential(`${REFERENTIAL_DECLARED_COLUMNS.join(';')}\n${twentyColumnRow}`);
  assert.equal(parsed.skipped, 0);
  assert.equal(parsed.stations[0].axis, 'A28');
  assert.equal(parsed.stations[0].xStart, 569981.6);
  assert.equal(parsed.stations[0].zone, 'RO76');
});

test('a row of a width nobody publishes is skipped and counted, never guessed', () => {
  const parsed = parseStationReferential(`${REFERENTIAL_DECLARED_COLUMNS.join(';')}\nBROKEN;DIRNO;A28`);
  assert.equal(parsed.rows, 1);
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.stations.length, 0);
});

test('a zeroed coordinate reads as absent, not as a point off West Africa', () => {
  // The unlocated stations — all 117 of DIR Ouest's and 72 of DIR Est's —
  // publish empty fields, and some publish literal zeros.
  const row = 'MZERO.1;DIRO;1;N165;PR0;0;PR1;0;1;;;;0;0;0;0;0;0;';
  const parsed = parseStationReferential(`${REFERENTIAL_DECLARED_COLUMNS.join(';')}\n${row}`);
  assert.equal(parsed.stations[0].xStart, null);
  assert.equal(parsed.stations[0].yStart, null);
});

test('the auto-index yields directories and the newest publication file', () => {
  assert.deepEqual(parseIndexDirectories(APACHE_INDEX), ['ALIENOR', 'TRAFIC_TraficStBrieuc', 'TraficLyon']);
  const listing = `
    <a href="ALIENOR_DataTRT_20260831_224040.xml">a</a>
    <a href="ALIENOR_DataTRT_20260831_180240.xml">b</a>
    <a href="ALIENOR_DataTRT_20260831_223940.xml">c</a>`;
  // Names are timestamped, so lexical order is chronological order.
  assert.equal(latestPublicationFile(listing), 'ALIENOR_DataTRT_20260831_224040.xml');
  assert.equal(latestPublicationFile('<html>nothing here</html>'), null);
});

test('two centres reporting one site keep the worse state, and `unknown` never wins', () => {
  assert.equal(worseRoadStatus('freeFlow', 'congested'), 'congested');
  assert.equal(worseRoadStatus('congested', 'heavy'), 'congested');
  assert.equal(worseRoadStatus('impossible', 'congested'), 'impossible');
  // The point of the negative rank: a centre that cannot see a site must not
  // overwrite the reading of a centre that can.
  assert.equal(worseRoadStatus('freeFlow', 'unknown'), 'freeFlow');
  assert.equal(worseRoadStatus('unknown', 'heavy'), 'heavy');
  assert.equal(worseRoadStatus('unknown', 'unknown'), 'unknown');
});

test('every legend entry has a style and every style is in the legend', () => {
  assert.deepEqual(
    [...ROAD_STATUS_LEGEND_ORDER].sort(),
    Object.keys(ROAD_STATUS_LEVELS).sort(),
  );
  for (const id of ROAD_STATUS_LEGEND_ORDER) {
    const style = roadStatusStyle(id);
    assert.equal(style.id, id);
    assert.match(style.color, /^#[0-9a-f]{6}$/i);
    assert.ok(style.widthPx > 0);
  }
  assert.equal(roadStatusStyle('nonsense').id, 'unknown');
  assert.equal(roadStatusStyle(undefined).id, 'unknown');
});

test('the box gate accepts a country-sized request and rejects a malformed one', () => {
  const france = validRoadStatusBox({
    south: 41, west: -5.5, north: 51.5, east: 9.8,
  });
  assert.ok(france, 'all of France is inside the ceiling on purpose');
  assert.equal(validRoadStatusBox({
    south: 0, west: 0, north: 90, east: 180,
  }), null);
  assert.equal(validRoadStatusBox({
    south: 45, west: 5, north: 44, east: 6,
  }), null, 'inverted box');
  assert.equal(validRoadStatusBox({
    south: 'x', west: 5, north: 46, east: 6,
  }), null);
  assert.ok(ROAD_STATUS_MAX_BOX_DEG >= 20);
});

test('a segment is tested by its own extent, not by its midpoint', () => {
  // A 979 m median segment can cross a viewport its centre sits outside of.
  const segment = { c: [-0.63, 44.87, -0.62, 44.89] };
  const box = {
    south: 44.885, west: -0.70, north: 44.95, east: -0.60,
  };
  assert.equal(segmentIntersectsBox(segment, box), true);
  assert.equal(segmentIntersectsBox({ c: [2.35, 48.86] }, box), false);
  assert.equal(segmentIntersectsBox({ c: [] }, box), false);
  assert.equal(segmentIntersectsBox({ c: [Number.NaN, 44.9] }, box), false);
});

test('a zero-flow station prints no speed, because zero means "nothing passed"', () => {
  assert.equal(formatFlow(1350), '1 350 veh/h');
  assert.equal(formatFlow(0), '0 veh/h');
  assert.equal(formatFlow(null), null);
  assert.equal(formatSpeed(113, 140), '113 km/h');
  assert.equal(formatSpeed(0, 0), null);
  // The 114 stations at 22:30 that saw no vehicle: their zero speed is an
  // absence of traffic, and printing "0 km/h" would call it a jam.
  assert.equal(formatSpeed(0, 140), null);
  assert.equal(formatSpeed(90, 0), null);
});

test('a body larger than the scan ceiling is refused rather than scanned', () => {
  const oversized = `<siteMeasurements>${'x'.repeat(MAX_PAYLOAD_CHARS)}</siteMeasurements>`;
  assert.equal(parseTraficolorStatuses(oversized).statuses.size, 0);
  assert.equal(parseQtvMeasurements(oversized).measurements.size, 0);
  assert.equal(parseTraficolorStatuses(null).statuses.size, 0);
});

test('an unnamed publishing directory still gets a label — its own name', () => {
  assert.equal(agglomerationLabel('ALIENOR'), 'Bordeaux');
  assert.equal(agglomerationLabel('TraficMyrabel'), 'Nancy – Metz');
  // A directory added by a DIR tomorrow must not need a release to appear.
  assert.equal(agglomerationLabel('TraficNouvelle'), 'TraficNouvelle');
});
