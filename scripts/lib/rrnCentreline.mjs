/**
 * The centre of the carriageway, from the State's own survey of it.
 *
 * WHY THIS EXISTS. A Bison Futé counting station publishes two endpoints and
 * NOTHING between them, so every segment of the road-status layer was drawn as
 * the straight line joining them. `rrnBornage.mjs` softened that by threading
 * the surveyed kilometre posts lying between the two ends — but the posts are
 * a kilometre apart and the median segment is 948 m long, so 643 of 842
 * segments contained no post at all and stayed chords. Measured 2026-09-01,
 * the drawn line strayed a median 56 m from its own tarmac, 142 m at p90, and
 * 411 segments were off by more than 25 m. On the Bordeaux rocade that is a
 * green line cutting the inside of every curve, which is what it looked like.
 *
 * The bornage cannot fix this. Its resolution IS one kilometre; asking it for
 * the shape of a 900 m curve is asking a question its sampling cannot answer.
 *
 * SO THE SHAPE COMES FROM THE DATASET NEXT DOOR. `Liaisons du réseau routier
 * national` — same ministry, same Licence Ouverte 2.0, published in the same
 * archive as the bornage itself — carries `VSMAP_TOUT.shp`: 56 205 polylines,
 * 1.66 M vertices, one per PR interval of the network, in Lambert-93. Mean
 * vertex spacing 25.9 m, against the 1 000 m the posts offered.
 *
 * ── THE JOIN NEEDS NO GEOMETRY AT ALL ───────────────────────────────────────
 *
 * Each section NAMES the two posts it runs between — `nom_plo_in` is
 * `01PR122DC`, which {@link parsePrAddress} already reads for the referential
 * — so a section can be placed in the same cumulative-distance space the
 * bornage index is already sorted by, without comparing a single coordinate.
 * The coordinates are then free to be checked rather than trusted, and they
 * agree exactly: over 33 483 joined sections the polyline's own ends sit
 *
 *     p50 0 m   p90 0 m   p99 0 m
 *
 * from the posts they name. The two files are cut from the same survey.
 *
 * `dist_deb`/`dist_fin` are NOT used as that key, though they look like one.
 * They restart at zero in every département — the A63's right-hand carriageway
 * publishes `33:0-250`, `40:0-550` and `64:0-140` — while `cumul` runs
 * continuously over the whole route. Keying on them silently interleaves three
 * départements' worth of geometry into one line.
 *
 * ── WHAT THE SIDES ARE CALLED ───────────────────────────────────────────────
 *
 * `portee` is `D`/`G`/`U`, and the bornage's `cote` is `D`/`G`/`I`. The single
 * carriageway is `U` here and `I` there for the same road. Mapping it is the
 * whole of the carriageway half of the join; not mapping it loses every
 * undivided national road in France.
 *
 * ── WHAT IT COSTS, AND WHAT IT BUYS ─────────────────────────────────────────
 *
 * 589 of the 608 real segments (96.9 %) trace onto surveyed centreline, for
 * +4 110 vertices in the committed file — 364 KB to 485 KB, 29 KB to 52 KB
 * gzipped — after simplification at {@link CENTRELINE_SIMPLIFY_M}. The 19 that
 * do not are slip roads and unnumbered axes the PR referential does not
 * address; they keep the bornage shaping, or the chord, exactly as before.
 *
 * Source:   https://www.data.gouv.fr/datasets/liaisons-du-reseau-routier-national
 * Licence:  Licence Ouverte 2.0 — the same as the bornage and the Bison Futé
 *           publications this is joined to, so it adds no obligation the layer
 *           did not already carry.
 *
 * @module scripts/lib/rrnCentreline
 */

import { BORNE_SIDES, normaliseRouteCode, parsePrAddress } from './rrnBornage.mjs';

/** data.gouv.fr landing page, for the attribution surface. */
export const CENTRELINE_DATASET_PAGE = 'https://www.data.gouv.fr/datasets/liaisons-du-reseau-routier-national';

/**
 * The 2025 métropole edition, pinned.
 *
 * Pinned for the same reason the bornage URL is: the geometry this produces is
 * COMMITTED, and a build that silently picked up a new edition would move
 * hundreds of segments in a diff that explains none of it.
 */
export const CENTRELINE_ZIP_URL = 'https://static.data.gouv.fr/resources/liaisons-du-reseau-routier-national/20250722-132905/rrn-2025-metropole-shp.zip';

/** Edition of the referential the URL above points at. */
export const CENTRELINE_EDITION = '2025-07-22';

/** Licence of the dataset, as declared on data.gouv.fr (`fr-lo`). */
export const CENTRELINE_LICENCE = 'Licence Ouverte 2.0';

/**
 * The two members of the archive that are read.
 *
 * The archive also holds `BORNAGE_TOUT.*`, which is the same 51 874 posts
 * `rrnBornage.mjs` already reads from the bornage CSV. It is not read twice.
 */
export const CENTRELINE_MEMBERS = Object.freeze({ shp: 'VSMAP_TOUT.shp', dbf: 'VSMAP_TOUT.dbf' });

/**
 * How far a section's own ends may sit from the posts it names.
 *
 * The measured disagreement is zero to the centimetre for 99 % of sections, so
 * this is not a tolerance — it is a trap for the handful whose `nom_plo` names
 * a post that was renumbered between editions. Without it, one section of the
 * N2 joins a post 13.8 km away and drags a segment across the countryside.
 */
export const CENTRELINE_POST_MAX_M = 50;

/**
 * How far a published endpoint may sit from the centreline it is clipped onto.
 *
 * The same 150 m the bornage join uses, and for the same reason: a station
 * whose `axe` names a road its coordinates are nowhere near must be refused,
 * not dragged onto that road.
 */
export const CENTRELINE_SNAP_MAX_M = 150;

/**
 * Slack, in metres of cumulative distance, added either side of the window a
 * trace is collected from.
 *
 * A segment's two ends snap to the NEAREST post, which may be the one just
 * outside it — so the window is widened by rather more than a post interval
 * and the surplus is clipped off afterwards by proximity to the real ends.
 */
export const CENTRELINE_WINDOW_PAD_M = 1200;

/**
 * Douglas–Peucker tolerance, in metres.
 *
 * 4 m is under the width of a traffic lane, so nothing a viewer could see is
 * removed, and it takes the raw 32 755 vertices of the traced segments down to
 * 5 288. Committing the raw survey instead would be a 500 KB file describing
 * curvature no globe camera ever resolves.
 *
 * 34 traced segments come out of this with two points, and that is not a
 * failure: their raw trace is straight to within 3.9 m over a median 992 m, so
 * the chord IS the road there. Every one of them was measured — the survey
 * says those stretches are straight, and the file says the same.
 */
export const CENTRELINE_SIMPLIFY_M = 4;

/**
 * How much longer than the straight line a traced road may run.
 *
 * The ring-road guard, kept from {@link module:scripts/lib/rrnBornage}: two
 * ends either side of the A630's closing point have a short chord and 45 km of
 * tarmac between them measured the long way round.
 */
export const CENTRELINE_DETOUR_FACTOR = 3;

/** Shapefile shape types this reads. `0` is the null shape and is skipped. */
const SHAPE_NULL = 0;
const SHAPE_POLYLINE = 3;
const SHAPE_POLYLINE_Z = 13;
const SHAPE_POLYLINE_M = 23;

/** `0x0D` terminates the dBASE field-descriptor array. */
const DBF_FIELD_TERMINATOR = 0x0d;

/**
 * Read the polylines out of a `.shp` main file.
 *
 * Only the geometry is read, and only PolyLine in its three flavours: the `Z`
 * and `M` variants carry their extra arrays AFTER the points, so the prefix
 * this walks is byte-identical and the elevations are simply not read. The RRN
 * publishes plain PolyLine (type 3) today; accepting the others costs four
 * bytes of comparison and survives an edition that starts publishing heights.
 *
 * MULTI-PART SHAPES ARE FLATTENED. 6 of 56 205 sections have two parts, and
 * they are two runs of the same carriageway either side of a gap; joining them
 * end to end is what the caller wants anyway, since the parts are already in
 * order along the road.
 *
 * @param {Buffer} shp Whole `.shp` file.
 * @returns {Array<?Array<number>>} One flat `[x, y, x, y, …]` per record in
 *   file order, or null where the record was a null shape. The index is the
 *   record's, so it lines up with {@link readDbaseRecords}.
 */
export function readShapefilePolylines(shp) {
  const out = [];
  if (!Buffer.isBuffer(shp) || shp.length < 100) return out;
  let offset = 100;
  while (offset + 8 <= shp.length) {
    const contentLength = shp.readInt32BE(offset + 4) * 2;
    const next = offset + 8 + contentLength;
    if (contentLength < 4 || next > shp.length) break;
    const type = shp.readInt32LE(offset + 8);
    if (type === SHAPE_NULL) {
      out.push(null);
    } else if (type === SHAPE_POLYLINE || type === SHAPE_POLYLINE_Z || type === SHAPE_POLYLINE_M) {
      const parts = shp.readInt32LE(offset + 44);
      const points = shp.readInt32LE(offset + 48);
      const first = offset + 52 + parts * 4;
      if (points < 2 || first + points * 16 > next) {
        out.push(null);
      } else {
        const flat = new Array(points * 2);
        for (let i = 0; i < points; i += 1) {
          flat[i * 2] = shp.readDoubleLE(first + i * 16);
          flat[i * 2 + 1] = shp.readDoubleLE(first + i * 16 + 8);
        }
        out.push(flat);
      }
    } else {
      out.push(null);
    }
    offset = next;
  }
  return out;
}

/**
 * Read the attribute table of a `.dbf` sidecar.
 *
 * Every field is returned as a trimmed string, whatever its declared type: the
 * four columns this build reads (`lib_rte`, `portee`, `nom_plo_in`,
 * `nom_plo_fi`) are all character fields, and coercing the numeric ones here
 * would only invent precision the caller does not ask for.
 *
 * Latin-1 rather than UTF-8 because the file declares no code page and its
 * contents are route codes and post names — ASCII in practice, and latin-1
 * cannot throw on a byte that UTF-8 would reject.
 *
 * @param {Buffer} dbf Whole `.dbf` file.
 * @returns {{records: Array<Object<string, string>>, fields: Array<string>}}
 */
export function readDbaseRecords(dbf) {
  const empty = { records: [], fields: [] };
  if (!Buffer.isBuffer(dbf) || dbf.length < 33) return empty;
  const count = dbf.readUInt32LE(4);
  const headerLength = dbf.readUInt16LE(8);
  const recordLength = dbf.readUInt16LE(10);
  if (!recordLength || headerLength < 33) return empty;
  const fields = [];
  for (let at = 32; at < headerLength - 1 && dbf[at] !== DBF_FIELD_TERMINATOR; at += 32) {
    if (at + 32 > dbf.length) break;
    fields.push({
      name: dbf.toString('latin1', at, at + 11).replace(/\0[\s\S]*$/, '').trim(),
      length: dbf[at + 16],
    });
  }
  if (!fields.length) return empty;
  const records = [];
  for (let i = 0; i < count; i += 1) {
    const start = headerLength + i * recordLength;
    if (start + recordLength > dbf.length) break;
    // Byte 0 of a record is the deletion flag: `*` means the row was deleted
    // in place and is still in the file. Reading it as data would prepend a
    // star to every route code.
    if (dbf[start] === 0x2a) continue;
    const row = {};
    let at = start + 1;
    for (const field of fields) {
      row[field.name] = dbf.toString('latin1', at, at + field.length).trim();
      at += field.length;
    }
    records.push(row);
  }
  return { records, fields: fields.map((f) => f.name) };
}

/** `U` is the RRN's name for the single carriageway the bornage calls `I`. */
function normaliseSide(portee) {
  const side = typeof portee === 'string' ? portee.trim().toUpperCase() : '';
  if (side === 'U') return 'I';
  return BORNE_SIDES.includes(side) ? side : null;
}

/** Length of a flat `[x, y, …]` polyline, in the units it is written in. */
function polylineLength(flat) {
  let total = 0;
  for (let i = 0; i + 3 < flat.length; i += 2) {
    total += Math.hypot(flat[i + 2] - flat[i], flat[i + 3] - flat[i + 1]);
  }
  return total;
}

/**
 * Index the RRN sections in the cumulative-distance space of the bornage.
 *
 * Every section is placed by the two posts it NAMES, not by where it is drawn,
 * and the drawing is then used to check that placement rather than to make it.
 * A section whose ends disagree with its own posts by more than
 * {@link CENTRELINE_POST_MAX_M} is dropped and counted, because such a section
 * is describing an edition of the numbering this bornage is not.
 *
 * Sections are stored oriented in INCREASING cumul, so a trace can concatenate
 * consecutive ones without checking which way round each was digitised.
 *
 * @param {{shp: Buffer, dbf: Buffer}} archive The two members, already read.
 * @param {object} bornage Index from `buildBornageIndex`.
 * @returns {{lines: Map<string, Array<object>>, sections: number, joined: number,
 *   rejected: {notNumbered: number, noSide: number, noAddress: number,
 *   postUnknown: number, farFromPosts: number}}}
 */
export function buildCentrelineIndex(archive, bornage) {
  const lines = new Map();
  const rejected = {
    notNumbered: 0, noSide: 0, noAddress: 0, postUnknown: 0, farFromPosts: 0,
  };
  const result = {
    lines, sections: 0, joined: 0, rejected,
  };
  if (!archive?.shp || !archive?.dbf || !bornage) return result;
  const geometries = readShapefilePolylines(archive.shp);
  const { records } = readDbaseRecords(archive.dbf);
  result.sections = Math.min(geometries.length, records.length);

  for (let i = 0; i < result.sections; i += 1) {
    const flat = geometries[i];
    const row = records[i];
    if (!flat || !row) continue;
    // `lib_rte` names the mainline as a sign does (`A39`) and a slip road by
    // its own opaque code (`01A803903CD`); the second returns null here, which
    // is the same refusal the bornage join makes for the same strings.
    const route = normaliseRouteCode(row.lib_rte);
    if (!route) { rejected.notNumbered += 1; continue; }
    const side = normaliseSide(row.portee);
    if (!side) { rejected.noSide += 1; continue; }
    const from = parsePrAddress(row.nom_plo_in);
    const to = parsePrAddress(row.nom_plo_fi);
    if (!from || !to) { rejected.noAddress += 1; continue; }
    const startPost = bornage.exact.get(`${route}|${from.dep}|${from.pr}|${side}`);
    const endPost = bornage.exact.get(`${route}|${to.dep}|${to.pr}|${side}`);
    if (!startPost || !endPost) { rejected.postUnknown += 1; continue; }

    const last = flat.length - 2;
    const forward = Math.hypot(flat[0] - startPost.x, flat[1] - startPost.y)
      + Math.hypot(flat[last] - endPost.x, flat[last + 1] - endPost.y);
    const backward = Math.hypot(flat[0] - endPost.x, flat[1] - endPost.y)
      + Math.hypot(flat[last] - startPost.x, flat[last + 1] - startPost.y);
    if (Math.min(forward, backward) / 2 > CENTRELINE_POST_MAX_M) {
      rejected.farFromPosts += 1;
      continue;
    }
    // Two independent facts about direction: which post has the lower cumul,
    // and which end of the drawing is nearer which post. Reverse when they
    // disagree, so every stored section runs the way the road is measured.
    const ascending = startPost.cumul <= endPost.cumul;
    const drawnForward = forward <= backward;
    const points = ascending === drawnForward ? flat : reverseFlat(flat);
    const key = `${route}|${side}`;
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push({
      route,
      side,
      from: Math.min(startPost.cumul, endPost.cumul),
      to: Math.max(startPost.cumul, endPost.cumul),
      points,
    });
    result.joined += 1;
  }
  for (const sections of lines.values()) sections.sort((a, b) => a.from - b.from);
  return result;
}

/** A flat `[x, y, …]` list, point order reversed. */
function reverseFlat(flat) {
  const out = new Array(flat.length);
  for (let i = 0, j = flat.length - 2; i < flat.length; i += 2, j -= 2) {
    out[i] = flat[j];
    out[i + 1] = flat[j + 1];
  }
  return out;
}

/** The post nearest a point, on one carriageway or on any of them. */
function nearestBorne(bornage, route, side, x, y) {
  let best = Infinity;
  let hit = null;
  for (const candidate of side ? [side] : BORNE_SIDES) {
    for (const borne of bornage.lines.get(`${route}|${candidate}`) || []) {
      const distance = Math.hypot(borne.x - x, borne.y - y);
      if (distance < best) { best = distance; hit = borne; }
    }
  }
  return hit ? { distance: best, borne: hit } : null;
}

/**
 * The surveyed centre of the road between two points of it.
 *
 * Both ends are snapped to a post first — of the SAME carriageway, because the
 * two sides of a motorway are separate polylines and mixing them makes a
 * segment zigzag across the central reservation — and the posts are used only
 * to choose which sections to concatenate. The published ends are then kept
 * verbatim as the first and last vertex: this shapes a segment, it does not
 * move it, and a station's own coordinates remain the thing the layer draws it
 * at.
 *
 * @param {?object} centreline From {@link buildCentrelineIndex}.
 * @param {?object} bornage Index from `buildBornageIndex`.
 * @param {?string} route Canonical route code.
 * @param {{x: number, y: number}} start Lambert-93 metres.
 * @param {{x: number, y: number}} end Lambert-93 metres.
 * @returns {{points: ?Array<number>, reason: ?string}} Flat `[x, y, …]`.
 */
export function traceAlongRoad(centreline, bornage, route, start, end) {
  const none = (reason) => ({ points: null, reason });
  if (!centreline || !bornage || !route || !start || !end) return none('no input');
  const from = nearestBorne(bornage, route, null, start.x, start.y);
  if (!from || from.distance > CENTRELINE_SNAP_MAX_M) return none('start is not on this road');
  const side = from.borne.side;
  const sections = centreline.lines.get(`${route}|${side}`);
  if (!sections?.length) return none('that carriageway has no surveyed centreline');
  const to = nearestBorne(bornage, route, side, end.x, end.y);
  if (!to || to.distance > CENTRELINE_SNAP_MAX_M) return none('end is not on that carriageway');

  const low = Math.min(from.borne.cumul, to.borne.cumul) - CENTRELINE_WINDOW_PAD_M;
  const high = Math.max(from.borne.cumul, to.borne.cumul) + CENTRELINE_WINDOW_PAD_M;
  const path = [];
  for (const section of sections) {
    if (section.to < low || section.from > high) continue;
    for (let i = 0; i + 1 < section.points.length; i += 2) {
      // Consecutive sections share their common post, and the survey repeats
      // it in both. Emitting it twice would leave a zero-length rung that the
      // simplifier keeps and the renderer draws as a seam.
      const n = path.length;
      if (n && Math.hypot(section.points[i] - path[n - 2], section.points[i + 1] - path[n - 1]) < 0.5) continue;
      path.push(section.points[i], section.points[i + 1]);
    }
  }
  if (path.length < 4) return none('no centreline in that stretch of the road');

  const startAt = nearestVertex(path, start);
  const endAt = nearestVertex(path, end);
  if (startAt.distance > CENTRELINE_SNAP_MAX_M || endAt.distance > CENTRELINE_SNAP_MAX_M) {
    return none('an end sits off the surveyed centreline');
  }
  // A segment whose two ends clip to one vertex has no length to shape. That
  // is 234 of the 842 stored segments — stations the referential publishes
  // with `x_deb` equal to `x_fin` — and they are points, not short roads.
  if (startAt.index === endAt.index) return none('the two ends are the same place');

  const forward = startAt.index < endAt.index;
  const lowIndex = forward ? startAt.index : endAt.index;
  const highIndex = forward ? endAt.index : startAt.index;
  const middle = path.slice(lowIndex * 2 + 2, highIndex * 2);
  const points = [
    start.x, start.y,
    ...(forward ? middle : reverseFlat(middle)),
    end.x, end.y,
  ];
  const chord = Math.hypot(end.x - start.x, end.y - start.y);
  if (polylineLength(points) > CENTRELINE_DETOUR_FACTOR * chord + 500) {
    return none('the road wraps between these ends');
  }
  return { points, reason: null };
}

/** Index of the polyline vertex nearest a point, and how far it is. */
function nearestVertex(flat, point) {
  let best = Infinity;
  let index = 0;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const distance = Math.hypot(flat[i] - point.x, flat[i + 1] - point.y);
    if (distance < best) { best = distance; index = i / 2; }
  }
  return { index, distance: best };
}

/**
 * Douglas–Peucker, on a flat `[x, y, …]` list in metres.
 *
 * Iterative rather than recursive: the longest traced segment holds 1 400
 * vertices and a pathological one would recurse that deep, which is a stack
 * overflow in a build script for no gain over an explicit stack.
 *
 * @param {Array<number>} flat Flat coordinate list.
 * @param {number} toleranceM Maximum distance a dropped vertex may sit from
 *   the line that replaces it.
 * @returns {Array<number>} A new list; the ends are always kept.
 */
export function simplifyPolyline(flat, toleranceM = CENTRELINE_SIMPLIFY_M) {
  const count = flat.length / 2;
  if (count < 3 || !(toleranceM > 0)) return [...flat];
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const stack = [[0, count - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    if (last - first < 2) continue;
    const ax = flat[first * 2];
    const ay = flat[first * 2 + 1];
    const dx = flat[last * 2] - ax;
    const dy = flat[last * 2 + 1] - ay;
    const squared = dx * dx + dy * dy;
    let worst = -1;
    let at = first;
    for (let i = first + 1; i < last; i += 1) {
      const px = flat[i * 2] - ax;
      const py = flat[i * 2 + 1] - ay;
      const t = squared ? Math.max(0, Math.min(1, (px * dx + py * dy) / squared)) : 0;
      const distance = Math.hypot(px - t * dx, py - t * dy);
      if (distance > worst) { worst = distance; at = i; }
    }
    if (worst <= toleranceM) continue;
    keep[at] = 1;
    stack.push([first, at], [at, last]);
  }
  const out = [];
  for (let i = 0; i < count; i += 1) {
    if (keep[i]) out.push(flat[i * 2], flat[i * 2 + 1]);
  }
  return out;
}
