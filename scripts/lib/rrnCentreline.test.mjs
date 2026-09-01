import test from 'node:test';
import assert from 'node:assert/strict';

import { BORNAGE_COLUMNS, buildBornageIndex, parseBornage } from './rrnBornage.mjs';
import {
  CENTRELINE_POST_MAX_M,
  buildCentrelineIndex,
  readDbaseRecords,
  readShapefilePolylines,
  simplifyPolyline,
  traceAlongRoad,
} from './rrnCentreline.mjs';

/**
 * Real posts of the A28 through Seine-Maritime, copied verbatim from
 * `bornes-2025.csv` — the same rows `rrnBornage.test.mjs` uses, so a section
 * placed here is placed against coordinates the road operator published.
 *
 * PR 90 → 92 on the right-hand carriageway, and PR 91 → 92 on the left, which
 * is what proves the two sides stay separate polylines.
 */
const BORNES = [
  BORNAGE_COLUMNS.join(';'),
  '01/01/2025;A0028;90;76;N;0;90034;570873,06;6938568,11;0;D',
  '01/01/2025;A0028;91;76;N;0;91034;569978,13;6938139,9;0;D',
  '01/01/2025;A0028;92;76;N;0;92034;569522,39;6937271,19;0;D',
  '01/01/2025;A0028;91;76;N;0;91087;569985,47;6938133,2;0;G',
  '01/01/2025;A0028;92;76;N;0;92093;569531,4;6937267,47;0;G',
  // A single-carriageway national road, whose side the RRN spells `U` and the
  // bornage spells `I`.
  '01/01/2025;N0012;56;53;N;0;245715;417681,28;6807557,93;0;I',
  '01/01/2025;N0012;57;53;N;0;246715;418500,28;6808100,93;0;I',
].join('\n');

const bornage = buildBornageIndex(parseBornage(BORNES).bornes);

/** Write a `.shp` main file holding one PolyLine record per input. */
function writeShapefile(polylines, shapeType = 3) {
  const records = polylines.map((flat, i) => {
    if (!flat) {
      const nul = Buffer.alloc(12);
      nul.writeInt32BE(i + 1, 0);
      nul.writeInt32BE(2, 4);
      nul.writeInt32LE(0, 8);
      return nul;
    }
    const points = flat.length / 2;
    const content = 44 + 4 + 16 * points;
    const buffer = Buffer.alloc(8 + content);
    buffer.writeInt32BE(i + 1, 0);
    buffer.writeInt32BE(content / 2, 4);
    buffer.writeInt32LE(shapeType, 8);
    // The bounding box is not read, so it is left at zero deliberately: a
    // reader that trusted it would pass this test and fail on the real file.
    buffer.writeInt32LE(1, 44);
    buffer.writeInt32LE(points, 48);
    buffer.writeInt32LE(0, 52);
    for (let k = 0; k < points; k += 1) {
      buffer.writeDoubleLE(flat[k * 2], 56 + k * 16);
      buffer.writeDoubleLE(flat[k * 2 + 1], 56 + k * 16 + 8);
    }
    return buffer;
  });
  const header = Buffer.alloc(100);
  header.writeInt32BE(9994, 0);
  header.writeInt32LE(1000, 28);
  header.writeInt32LE(shapeType, 32);
  const body = Buffer.concat(records);
  header.writeInt32BE((100 + body.length) / 2, 24);
  return Buffer.concat([header, body]);
}

/** Write a `.dbf` sidecar with character fields only, as the RRN does. */
function writeDbase(rows, columns, deleted = new Set()) {
  const fields = columns.map((name) => ({ name, length: 30 }));
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((sum, f) => sum + f.length, 0);
  const header = Buffer.alloc(headerLength);
  header[0] = 0x03;
  header.writeUInt32LE(rows.length, 4);
  header.writeUInt16LE(headerLength, 8);
  header.writeUInt16LE(recordLength, 10);
  fields.forEach((field, i) => {
    const at = 32 + i * 32;
    header.write(field.name, at, 11, 'latin1');
    header.write('C', at + 11, 1, 'latin1');
    header[at + 16] = field.length;
  });
  header[headerLength - 1] = 0x0d;
  const body = rows.map((row, i) => {
    const buffer = Buffer.alloc(recordLength, 0x20);
    buffer[0] = deleted.has(i) ? 0x2a : 0x20;
    let at = 1;
    for (const field of fields) {
      buffer.write(String(row[field.name] ?? ''), at, field.length, 'latin1');
      at += field.length;
    }
    return buffer;
  });
  return Buffer.concat([header, ...body, Buffer.from([0x1a])]);
}

const COLUMNS = ['route', 'lib_rte', 'dist_deb', 'dist_fin', 'portee', 'gestionnai', 'nom_plo_in', 'nom_plo_fi'];

/** PR 90 → 91 on the A28's right carriageway, bulging 40 m east of the chord. */
const PR90_TO_91 = [
  570873.06, 6938568.11,
  570460, 6938400,
  570100, 6938220,
  569978.13, 6938139.9,
];
/** PR 91 → 92, continuing. */
const PR91_TO_92 = [
  569978.13, 6938139.9,
  569800, 6937800,
  569650, 6937500,
  569522.39, 6937271.19,
];

function fixture({ rows, geometries, shapeType }) {
  return buildCentrelineIndex(
    { shp: writeShapefile(geometries, shapeType), dbf: writeDbase(rows, COLUMNS) },
    bornage,
  );
}

const A28_ROWS = [
  {
    route: '76 A0028', lib_rte: 'A28', dist_deb: '0', dist_fin: '1000', portee: 'D', gestionnai: 'DIRNO', nom_plo_in: '76PR90D', nom_plo_fi: '76PR91D',
  },
  {
    route: '76 A0028', lib_rte: 'A28', dist_deb: '1000', dist_fin: '2000', portee: 'D', gestionnai: 'DIRNO', nom_plo_in: '76PR91D', nom_plo_fi: '76PR92D',
  },
];

test('a shapefile gives up its polylines, and its null shapes as nothing', () => {
  const shp = writeShapefile([PR90_TO_91, null, PR91_TO_92]);
  const read = readShapefilePolylines(shp);
  assert.equal(read.length, 3, 'the null shape keeps its place in the record order');
  assert.deepEqual(read[0], PR90_TO_91);
  assert.equal(read[1], null);
  assert.deepEqual(read[2], PR91_TO_92);
});

test('a PolyLineZ is read as the polyline it is, its heights simply not read', () => {
  // The Z arrays sit after the points, so the prefix is identical and the
  // reader must not refuse an edition that starts publishing elevations.
  const read = readShapefilePolylines(writeShapefile([PR90_TO_91], 13));
  assert.deepEqual(read[0], PR90_TO_91);
});

test('the attribute table is read by field, and a deleted row is not read at all', () => {
  const dbf = writeDbase(A28_ROWS, COLUMNS, new Set([0]));
  const { records, fields } = readDbaseRecords(dbf);
  assert.deepEqual(fields, COLUMNS);
  assert.equal(records.length, 1, 'the row flagged deleted is skipped, not returned with a star');
  assert.equal(records[0].nom_plo_in, '76PR91D');
  assert.equal(records[0].lib_rte, 'A28');
});

test('a section is placed by the posts it names, not by where it is drawn', () => {
  const index = fixture({ rows: A28_ROWS, geometries: [PR90_TO_91, PR91_TO_92] });
  assert.equal(index.joined, 2);
  const line = index.lines.get('A0028|D');
  assert.equal(line.length, 2);
  assert.deepEqual(
    line.map((s) => [s.from, s.to]),
    [[90034, 91034], [91034, 92034]],
    'the cumuls come from the bornage, so the sections sort along the road',
  );
});

test('a section digitised against the direction of measurement is turned round', () => {
  const backwards = [{ ...A28_ROWS[0], nom_plo_in: '76PR91D', nom_plo_fi: '76PR90D' }];
  const reversed = [];
  for (let i = PR90_TO_91.length - 2; i >= 0; i -= 2) reversed.push(PR90_TO_91[i], PR90_TO_91[i + 1]);
  const index = fixture({ rows: backwards, geometries: [reversed] });
  assert.equal(index.joined, 1);
  const [section] = index.lines.get('A0028|D');
  assert.deepEqual([section.from, section.to], [90034, 91034]);
  assert.deepEqual(
    [section.points[0], section.points[1]],
    [570873.06, 6938568.11],
    'every stored section runs the way the road is measured',
  );
});

test('the single carriageway is `U` here and `I` there, and joins anyway', () => {
  const rows = [{
    route: '53 N0012', lib_rte: 'N12', dist_deb: '0', dist_fin: '1000', portee: 'U', gestionnai: 'DIRO', nom_plo_in: '53PR56I', nom_plo_fi: '53PR57I',
  }];
  const index = fixture({
    rows,
    geometries: [[417681.28, 6807557.93, 418100, 6807800, 418500.28, 6808100.93]],
  });
  assert.equal(index.joined, 1);
  assert.ok(index.lines.has('N0012|I'), 'the RRN `U` is stored under the bornage `I`');
});

test('a slip road is left alone rather than guessed onto its mainline', () => {
  const rows = [{
    ...A28_ROWS[0], lib_rte: '01A803903CD',
  }];
  const index = fixture({ rows, geometries: [PR90_TO_91] });
  assert.equal(index.joined, 0);
  assert.equal(index.rejected.notNumbered, 1);
});

test('a section drawn away from the posts it names is dropped, not dragged', () => {
  const far = PR90_TO_91.map((v, i) => (i % 2 === 0 ? v + 5000 : v));
  const index = fixture({ rows: [A28_ROWS[0]], geometries: [far] });
  assert.equal(index.joined, 0);
  assert.equal(index.rejected.farFromPosts, 1);
  assert.ok(CENTRELINE_POST_MAX_M < 5000);
});

test('a segment is traced along the survey, and keeps the ends its publisher gave', () => {
  const index = fixture({ rows: A28_ROWS, geometries: [PR90_TO_91, PR91_TO_92] });
  const start = { x: 570873.06, y: 6938568.11 };
  const end = { x: 569522.39, y: 6937271.19 };
  const { points, reason } = traceAlongRoad(index, bornage, 'A0028', start, end);
  assert.equal(reason, null);
  assert.ok(points.length / 2 > 2, 'the trace is not the chord it replaced');
  assert.deepEqual([points[0], points[1]], [start.x, start.y]);
  assert.deepEqual([points[points.length - 2], points[points.length - 1]], [end.x, end.y]);
  // The shared post of the two sections appears once, not twice.
  let repeats = 0;
  for (let i = 2; i + 1 < points.length; i += 2) {
    if (Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]) < 0.5) repeats += 1;
  }
  assert.equal(repeats, 0, 'consecutive sections are welded at their common post, not butted');
});

test('a trace runs the way the segment does, not the way the road is measured', () => {
  const index = fixture({ rows: A28_ROWS, geometries: [PR90_TO_91, PR91_TO_92] });
  const start = { x: 569522.39, y: 6937271.19 };
  const end = { x: 570873.06, y: 6938568.11 };
  const { points } = traceAlongRoad(index, bornage, 'A0028', start, end);
  assert.deepEqual([points[0], points[1]], [start.x, start.y]);
  assert.deepEqual([points[points.length - 2], points[points.length - 1]], [end.x, end.y]);
});

test('a station published with one place for both its ends is not a road', () => {
  const index = fixture({ rows: A28_ROWS, geometries: [PR90_TO_91, PR91_TO_92] });
  const here = { x: 570873.06, y: 6938568.11 };
  const { points, reason } = traceAlongRoad(index, bornage, 'A0028', here, here);
  assert.equal(points, null);
  assert.match(reason, /same place/);
});

test('a segment whose ends are not on the road it names is not dragged onto it', () => {
  const index = fixture({ rows: A28_ROWS, geometries: [PR90_TO_91, PR91_TO_92] });
  const { points, reason } = traceAlongRoad(
    index,
    bornage,
    'A0028',
    { x: 600000, y: 6900000 },
    { x: 569522.39, y: 6937271.19 },
  );
  assert.equal(points, null);
  assert.match(reason, /not on this road/);
});

test('the two sides of a motorway stay two roads', () => {
  const rows = [
    ...A28_ROWS,
    {
      route: '76 A0028  G', lib_rte: 'A28', dist_deb: '0', dist_fin: '1000', portee: 'G', gestionnai: 'DIRNO', nom_plo_in: '76PR91G', nom_plo_fi: '76PR92G',
    },
  ];
  const index = fixture({
    rows,
    geometries: [PR90_TO_91, PR91_TO_92, [569985.47, 6938133.2, 569700, 6937700, 569531.4, 6937267.47]],
  });
  assert.equal(index.lines.get('A0028|D').length, 2);
  assert.equal(index.lines.get('A0028|G').length, 1);
  // A segment on the left carriageway traces the left geometry only — it must
  // not pick up the right-hand section that shares the same stretch of road.
  const { points } = traceAlongRoad(
    index,
    bornage,
    'A0028',
    { x: 569985.47, y: 6938133.2 },
    { x: 569531.4, y: 6937267.47 },
  );
  assert.deepEqual([points[2], points[3]], [569700, 6937700]);
});

test('a road that runs improbably longer than the line between its ends is refused', () => {
  // The section still starts on PR 90 and ends on PR 91, a kilometre apart —
  // but the tarmac it is drawn along detours 9 km east and back. That is the
  // ring-road case: two ends either side of a closing point have a short chord
  // and the whole city between them, and drawing it would wrap the map.
  const detour = [
    570873.06, 6938568.11,
    575000, 6938500,
    575000, 6937000,
    569978.13, 6938139.9,
  ];
  const index = fixture({ rows: [A28_ROWS[0]], geometries: [detour] });
  assert.equal(index.joined, 1, 'its ends match its posts, so it joins — the guard is downstream');
  const { points, reason } = traceAlongRoad(
    index,
    bornage,
    'A0028',
    { x: 570873.06, y: 6938568.11 },
    { x: 569978.13, y: 6938139.9 },
  );
  assert.equal(points, null);
  assert.match(reason, /wraps/);
});

test('simplification keeps the ends and drops what nobody could see', () => {
  const straight = [0, 0, 100, 0.5, 200, -0.5, 300, 0, 400, 0];
  const simplified = simplifyPolyline(straight, 4);
  assert.deepEqual(simplified, [0, 0, 400, 0], 'a 0.5 m wobble under a 4 m tolerance is not a curve');

  const corner = [0, 0, 100, 0, 100, 100];
  assert.deepEqual(simplifyPolyline(corner, 4), corner, 'a right angle survives any sane tolerance');

  const bend = [0, 0, 50, 20, 100, 0];
  assert.deepEqual(simplifyPolyline(bend, 4), bend, 'a 20 m sagitta is kept at 4 m');
  assert.deepEqual(simplifyPolyline(bend, 25), [0, 0, 100, 0], 'and dropped at 25 m');
});

test('simplification never returns fewer than the two ends', () => {
  assert.deepEqual(simplifyPolyline([1, 2, 3, 4], 100), [1, 2, 3, 4]);
  assert.deepEqual(simplifyPolyline([1, 2], 100), [1, 2]);
});
