import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BORNAGE_COLUMNS,
  ROAD_DETOUR_FACTOR,
  bornesBetween,
  normaliseDepartement,
  buildBornageIndex,
  departementFromSiteId,
  locateBorne,
  normaliseRouteCode,
  parseBornage,
  parsePrAddress,
  parseTraficolorSiteId,
} from './rrnBornage.mjs';

/**
 * Real rows of `bornes-2025.csv`, copied verbatim.
 *
 * Two situations that the join actually has to survive, and no invented data:
 * the A28 through Seine-Maritime, whose PR 91 is what the DIRNO station
 * `MUM76.h1` publishes as its own position — so the expected answer here is a
 * number the road operator published independently — and the N12, which has a
 * PR 56 in FIVE départements spread over 439 km, one of them signed on a
 * single carriageway.
 */
const FIXTURE = [
  BORNAGE_COLUMNS.join(';'),
  '01/01/2025;A0028;90;76;N;0;90034;570873,06;6938568,11;0;D',
  '01/01/2025;A0028;91;76;N;0;91034;569978,13;6938139,9;0;D',
  '01/01/2025;A0028;92;76;N;0;92034;569522,39;6937271,19;0;D',
  '01/01/2025;A0028;91;76;N;0;91087;569985,47;6938133,2;0;G',
  '01/01/2025;A0028;92;76;N;0;92093;569531,4;6937267,47;0;G',
  '01/01/2025;N0012;56;78;N;0;38392;602089,06;6855805,41;0;D',
  '01/01/2025;N0012;56;61;N;0;162594;492162,82;6823072,27;0;D',
  '01/01/2025;N0012;56;53;N;0;245715;417681,28;6807557,93;0;I',
  '01/01/2025;N0012;56;22;N;0;378722;276672,59;6838417,44;0;D',
  '01/01/2025;N0012;57;22;N;0;380024;276109,86;6839558,07;0;D',
  '01/01/2025;N0012;56;29;N;0;503283;163069,42;6845436,09;0;D',
  '',
].join('\n');

const index = buildBornageIndex(parseBornage(FIXTURE).bornes);

test('the bornage parses its own header and its decimal commas', () => {
  const parsed = parseBornage(FIXTURE);
  assert.equal(parsed.headerColumns, 11);
  assert.equal(parsed.rows, 11);
  assert.equal(parsed.skipped, 0);
  assert.equal(parsed.bornes.length, 11);
  const a28 = parsed.bornes.find((b) => b.route === 'A0028' && b.pr === 91 && b.side === 'D');
  // `569978,04` is not 569978 and is not 56997804: the comma is a decimal
  // point, and reading it as anything else puts the post in low Earth orbit.
  assert.equal(a28.x, 569978.13);
  assert.equal(a28.y, 6938139.9);
  assert.equal(a28.dep, '76');
  assert.equal(a28.conceded, false);
});

test('rows of the wrong width and rows with no position are skipped, not guessed', () => {
  const parsed = parseBornage([
    BORNAGE_COLUMNS.join(';'),
    '01/01/2025;A0028;91;76;N;0;91034;569978,13;6938139,9;0;D',
    '01/01/2025;A0028;92;76;N;0;92034;569522,39',
    '01/01/2025;A0028;93;76;N;0;93054;;;0;D',
    '01/01/2025;;94;76;N;0;94054;568000,0;6936000,0;0;D',
  ].join('\n'));
  assert.equal(parsed.rows, 4);
  assert.equal(parsed.bornes.length, 1);
  assert.equal(parsed.skipped, 3);
});

test('route codes are normalised to the bornage form, and nothing else is', () => {
  assert.equal(normaliseRouteCode('A28'), 'A0028');
  assert.equal(normaliseRouteCode('A0084'), 'A0084');
  assert.equal(normaliseRouteCode('N88'), 'N0088');
  assert.equal(normaliseRouteCode('n165'), 'N0165');
  // Ramp and link codes the bornage names differently (`01A803903CD`): there
  // is no derivation from these strings, so there is no answer.
  assert.equal(normaliseRouteCode('A22TC'), null);
  assert.equal(normaliseRouteCode('DB1'), null);
  assert.equal(normaliseRouteCode(''), null);
  assert.equal(normaliseRouteCode(null), null);
});

test('every point-repère shape the ten DIRs write is read as the same address', () => {
  assert.deepEqual(parsePrAddress('76PR91D'), { dep: '76', pr: 91, side: 'D' });
  assert.deepEqual(parsePrAddress('31PR230DC'), { dep: '31', pr: 230, side: 'D' });
  assert.deepEqual(parsePrAddress('31PR230GC'), { dep: '31', pr: 230, side: 'G' });
  assert.deepEqual(parsePrAddress('2APR7D'), { dep: '2A', pr: 7, side: 'D' });
  // `U` is not a carriageway; the post is still the post.
  assert.deepEqual(parsePrAddress('86PR50U'), { dep: '86', pr: 50, side: null });
  assert.deepEqual(parsePrAddress('39'), { dep: null, pr: 39, side: null });
  // `DB1`/`FB2`/`DRD` name the start and end of a ramp, not a post.
  for (const notAnAddress of ['DB1', 'FB2', 'DRD', 'DRG', '', null]) {
    assert.equal(parsePrAddress(notAnAddress), null, String(notAnAddress));
  }
});

test('a Breton status identifier is itself an address, abscissa in hectometres', () => {
  assert.deepEqual(parseTraficolorSiteId('35A0084T096_00D'), {
    dep: '35', route: 'A0084', pr: 96, abscisseM: 0, side: 'D',
  });
  assert.deepEqual(parseTraficolorSiteId('22N0012T045_09G'), {
    dep: '22', route: 'N0012', pr: 45, abscisseM: 900, side: 'G',
  });
  // Two digits, so 13 is 1 300 m and not a fraction of anything.
  assert.equal(parseTraficolorSiteId('56N0165T056_13D').abscisseM, 1300);
  // A département road parses — the grammar is the publisher's, not ours —
  // and simply has no post in a NATIONAL referential.
  assert.equal(parseTraficolorSiteId('44D0723T036_04G').route, 'D0723');
  for (const notAnId of ['TraficStBrieuc', '29N0165T052_G', 'MZE54.11', '0001T0100', null]) {
    assert.equal(parseTraficolorSiteId(notAnId), null, String(notAnId));
  }
});

test('the identifier gives up its département, and only its département', () => {
  assert.equal(departementFromSiteId('MWO56.J1'), '56');
  assert.equal(departementFromSiteId('MUM76.h1'), '76');
  assert.equal(departementFromSiteId('MB233.Z1'), '33');
  assert.equal(departementFromSiteId('A0001011200'), '0');
  assert.equal(departementFromSiteId('MZE54.11'), '54');
  assert.equal(departementFromSiteId('35A0084T096_00D'), null);
  assert.equal(departementFromSiteId(null), null);
});

test('a full address lands on the post the road operator published', () => {
  // `MUM76.h1` publishes `76PR91D` AND `x_deb = 569981.6`. This is the whole
  // premise of the join: resolving the address reaches the same tarmac.
  const hit = locateBorne(index, {
    route: 'A0028', dep: '76', pr: 91, side: 'D',
  });
  assert.equal(hit.x, 569978.13);
  assert.equal(hit.y, 6938139.9);
  assert.equal(hit.side, 'D');
  assert.equal(hit.sideFallback, false);
  assert.equal(hit.depInferred, false);
  assert.equal(hit.interpolated, false);
  assert.ok(Math.hypot(hit.x - 569981.6, hit.y - 6938140.0) < 5);
});

test('a missing carriageway falls back across the road and says so', () => {
  // The N12 at PR 56 in Mayenne is signed on one carriageway only.
  const hit = locateBorne(index, {
    route: 'N0012', dep: '53', pr: 56, side: 'G',
  });
  assert.equal(hit.side, 'I');
  assert.equal(hit.sideFallback, true);
  const exact = locateBorne(index, {
    route: 'A0028', dep: '76', pr: 91, side: 'G',
  });
  assert.equal(exact.side, 'G');
  assert.equal(exact.sideFallback, false);
  // The two sides of a dual carriageway are a car's length apart, which is
  // why falling back is allowed at all.
  assert.ok(Math.hypot(exact.x - 569978.13, exact.y - 6938139.9) < 15);
});

test('a bare PR resolves only when the road leaves no choice', () => {
  // The A28 has exactly one PR 91 in this fixture.
  const unique = locateBorne(index, { route: 'A0028', dep: null, pr: 91, side: null });
  assert.equal(unique.depInferred, true);
  assert.equal(unique.depFromHint, false);
  assert.equal(unique.dep, '76');

  // The N12 has five, 439 km apart. Without a hint this is not a position.
  assert.equal(locateBorne(index, { route: 'N0012', dep: null, pr: 56, side: null }), null);
});

test('the identifier breaks the tie, and is discarded when it cannot', () => {
  const hinted = locateBorne(
    index,
    { route: 'N0012', dep: null, pr: 56, side: null },
    { depHint: '22' },
  );
  assert.equal(hinted.dep, '22');
  assert.equal(hinted.depFromHint, true);
  assert.equal(hinted.x, 276672.59);

  // A hint naming a département the bornage does not offer for this post is
  // not a reason to fall back on an arbitrary one.
  assert.equal(
    locateBorne(index, { route: 'N0012', dep: null, pr: 56, side: null }, { depHint: '75' }),
    null,
  );
});

test('an abscissa walks along the road and stops at the next post', () => {
  // N12, Côtes-d'Armor: PR 56 at cumul 378 722, PR 57 at 380 024 — 1 302 m.
  const half = locateBorne(
    index,
    { route: 'N0012', dep: '22', pr: 56, side: 'D' },
    { abscisseM: 651 },
  );
  assert.equal(half.interpolated, true);
  assert.equal(half.clamped, false);
  assert.ok(Math.abs(half.x - (276672.59 + (276109.86 - 276672.59) / 2)) < 1e-6);
  assert.ok(Math.abs(half.y - (6838417.44 + (6839558.07 - 6838417.44) / 2)) < 1e-6);

  // An abscissa longer than its own interval means the two publications
  // disagree about where the interval ends; walking past the next post would
  // put the sensor beyond a junction it never crossed.
  const clamped = locateBorne(
    index,
    { route: 'N0012', dep: '22', pr: 56, side: 'D' },
    { abscisseM: 5000 },
  );
  assert.equal(clamped.clamped, true);
  assert.equal(clamped.x, 276109.86);
  assert.equal(clamped.y, 6839558.07);
});

test('the last post of a road keeps its own position rather than inventing one', () => {
  const last = locateBorne(
    index,
    { route: 'N0012', dep: '29', pr: 56, side: 'D' },
    { abscisseM: 400 },
  );
  assert.equal(last.interpolated, false);
  assert.equal(last.reason, 'no-next-borne');
  assert.equal(last.x, 163069.42);
});

test('an address the referential does not hold resolves to nothing at all', () => {
  assert.equal(locateBorne(index, { route: 'A0028', dep: '76', pr: 999, side: 'D' }), null);
  assert.equal(locateBorne(index, { route: 'A9999', dep: '76', pr: 91, side: 'D' }), null);
  assert.equal(locateBorne(index, { route: 'A0028', dep: '99', pr: 91, side: 'D' }), null);
  assert.equal(locateBorne(index, null), null);
  assert.equal(locateBorne(null, { route: 'A0028', dep: '76', pr: 91 }), null);
  assert.equal(locateBorne(index, { route: 'A0028', dep: '76', pr: Number.NaN }), null);
});

test('département codes are compared in one spelling, not two', () => {
  // The bornage writes them unpadded, the addresses write them padded.
  assert.equal(normaliseDepartement('01'), '1');
  assert.equal(normaliseDepartement('1'), '1');
  assert.equal(normaliseDepartement('76'), '76');
  assert.equal(normaliseDepartement('973'), '973');
  assert.equal(normaliseDepartement('2a'), '2A');
  assert.equal(normaliseDepartement('  22 '), '22');
  assert.equal(normaliseDepartement('XX'), null);
  assert.equal(normaliseDepartement(''), null);

  // Which means a padded address finds an unpadded post, in both directions.
  const padded = buildBornageIndex(parseBornage([
    BORNAGE_COLUMNS.join(';'),
    '01/01/2025;A0040;12;1;N;0;12000;860000,0;6560000,0;0;D',
  ].join('\n')).bornes);
  const hit = locateBorne(padded, { route: 'A0040', dep: '01', pr: 12, side: 'D' });
  assert.equal(hit.x, 860000);
  assert.equal(hit.dep, '1');
});

test('a segment is threaded through the posts between its two ends', () => {
  // A28 southbound: the station ends at PR 90 and PR 92, and PR 91 is the
  // tarmac in between. Drawing the chord instead is what put segments up to
  // 1.5 km off their own road.
  const { posts, reason } = bornesBetween(
    index,
    'A0028',
    { x: 570873.06, y: 6938568.11 },
    { x: 569522.39, y: 6937271.19 },
  );
  assert.equal(reason, null);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].pr, 91);
  assert.equal(posts[0].side, 'D');
});

test('the posts come out in the direction the segment runs', () => {
  const forward = bornesBetween(index, 'A0028', { x: 570873.06, y: 6938568.11 }, { x: 569522.39, y: 6937271.19 });
  const backward = bornesBetween(index, 'A0028', { x: 569522.39, y: 6937271.19 }, { x: 570873.06, y: 6938568.11 });
  assert.deepEqual(forward.posts.map((p) => p.pr), [91]);
  assert.deepEqual(backward.posts.map((p) => p.pr), [91]);
  // With three posts between, order is what distinguishes a road from a zigzag.
  const long = buildBornageIndex(parseBornage([
    BORNAGE_COLUMNS.join(';'),
    '01/01/2025;A0028;90;76;N;0;90034;570873,06;6938568,11;0;D',
    '01/01/2025;A0028;91;76;N;0;91034;569978,13;6938139,9;0;D',
    '01/01/2025;A0028;92;76;N;0;92034;569522,39;6937271,19;0;D',
    '01/01/2025;A0028;93;76;N;0;93054;568960,43;6936443,28;0;D',
  ].join('\n')).bornes);
  assert.deepEqual(
    bornesBetween(long, 'A0028', { x: 568960.43, y: 6936443.28 }, { x: 570873.06, y: 6938568.11 })
      .posts.map((p) => p.pr),
    [92, 91],
  );
});

test('adjacent posts need no shaping, and say so rather than returning nothing quietly', () => {
  const { posts, reason } = bornesBetween(
    index,
    'N0012',
    { x: 276672.59, y: 6838417.44 },
    { x: 276109.86, y: 6839558.07 },
  );
  assert.equal(posts.length, 0);
  assert.equal(reason, 'no post in between');
});

test('a station whose ends are not on the road it names is not dragged onto it', () => {
  const far = bornesBetween(index, 'A0028', { x: 300000, y: 6500000 }, { x: 569522.39, y: 6937271.19 });
  assert.equal(far.posts.length, 0);
  assert.equal(far.reason, 'start is not on this road');

  // The end more than 150 m from any post of the start's carriageway: the two
  // ends are not the two ends of one stretch of that road.
  const strayEnd = bornesBetween(index, 'A0028', { x: 570873.06, y: 6938568.11 }, { x: 575000, y: 6940000 });
  assert.equal(strayEnd.reason, 'end is not on that carriageway');

  assert.equal(bornesBetween(index, null, { x: 0, y: 0 }, { x: 1, y: 1 }).reason, 'no input');
  assert.equal(bornesBetween(null, 'A0028', { x: 0, y: 0 }, { x: 1, y: 1 }).reason, 'no input');
});

test('a ring road is not wrapped the long way round', () => {
  // Constructed, not observed: a route whose PR 0 and PR 3 sit 200 m apart on
  // the ground with three kilometres of tarmac between them. This is the shape
  // the Bordeaux ring has at its closing point, and threading it would draw a
  // segment around the whole city.
  const ring = buildBornageIndex(parseBornage([
    BORNAGE_COLUMNS.join(';'),
    '01/01/2025;A9999;0;33;N;0;0;417000,0;6420000,0;0;D',
    '01/01/2025;A9999;1;33;N;0;1000;418000,0;6420000,0;0;D',
    '01/01/2025;A9999;2;33;N;0;2000;418000,0;6421000,0;0;D',
    '01/01/2025;A9999;3;33;N;0;3000;417000,2;6420200,0;0;D',
  ].join('\n')).bornes);
  const wrapped = bornesBetween(ring, 'A9999', { x: 417000, y: 6420000 }, { x: 417000.2, y: 6420200 });
  assert.equal(wrapped.posts.length, 0);
  assert.equal(wrapped.reason, 'the road wraps between these ends');
  assert.ok(ROAD_DETOUR_FACTOR >= 2, 'a 90° curve is 1.57x its chord, so the factor must clear it');

  // And the same road, asked for two ends that ARE neighbours, still shapes.
  const ok = bornesBetween(ring, 'A9999', { x: 417000, y: 6420000 }, { x: 418000, y: 6421000 });
  assert.deepEqual(ok.posts.map((p) => p.pr), [1]);
});
