/**
 * Fiche implantation — how many people are inside the shape, and how wrong that
 * number can be.
 *
 * WHAT THIS MODULE IS FOR. Two layers already exist that each answer half a
 * question: `isochrone-fr` draws the ground reachable from an address, and
 * `filosofi-fr` draws who lives in every 200 m square of the country. Nobody
 * has ever put them together, and the join is the entire product a geomarketing
 * SaaS sells: *how many people, and with what money, live within ten minutes'
 * walk of this door*. That is one spatial operation — which squares fall inside
 * which polygon — and everything else here is about being honest about it.
 *
 * THE HARD PART IS NOT THE JOIN, IT IS THE EDGE. A 200 m square either sits
 * inside the ring, sits outside it, or STRADDLES the boundary. Every commercial
 * tool picks one convention and prints a single number:
 *
 *   - counting a square when its CENTROID is inside is the usual choice, and it
 *     is wrong by up to half a square in each direction along the whole
 *     perimeter;
 *   - counting every square that TOUCHES the ring overstates;
 *   - counting only squares FULLY inside understates.
 *
 * So this module reports all three. The headline is the centroid count, the
 * bracket is [fully-inside, touching], and the card prints the bracket rather
 * than hiding it. Measured over a ten-minute walk from place Bellecour, the two
 * bounds differ by roughly a third of the population — which is exactly the
 * error bar a single printed number pretends does not exist.
 *
 * AND THE BOUND HAS TO ACTUALLY BOUND. The first version of this decided
 * "touching" by sampling five points — four corners and the centroid — which is
 * not a containment test and produced an upper bound that could be too LOW: a
 * corridor narrower than 200 m crosses a square without covering any of the
 * five, and the square was dropped. `classifyCell()` now tests the cell's four
 * edges against the polygon's edges, which is exact, and the cheap sampling
 * survives only as the centroid convention for the headline.
 *
 * WHY PLANAR GEOMETRY IS ENOUGH. The rings this joins against are at most a
 * few kilometres across. Over that span a degree of longitude is a straight
 * line to well under a metre, and the squares being tested are 200 m wide, so
 * the great-circle correction is four orders of magnitude below the quantity it
 * would correct. What is NOT negligible is the cell's own tilt — a LAEA square
 * is not axis-aligned in WGS84 — which is why every test uses the cell's four
 * real corners from `filosofiFeed.js` rather than a bounding box.
 *
 * WHAT THIS MODULE REFUSES TO DO. It never scales a square's population by the
 * fraction of it that is inside. That is areal interpolation, it assumes people
 * are spread evenly across a square, and INSEE's own imputation flag exists
 * precisely because they are not. A bracket made of two countable facts beats a
 * point estimate made of an assumption.
 *
 * Dependency-free and side-effect-free apart from importing the cell geometry.
 * The `/api/implantation` proxy imports it, and so does the layer.
 *
 * @module data/implantationFeed
 */

import { cellCentre, cellCorners } from './filosofiFeed.js';

/**
 * A polygon, as this module wants it: a flat list of rings.
 *
 * A ring arrives here alone in the common case, and as `[exterior, ...holes]`
 * when the isochrone service answers a shape with a hole in it — a fenced
 * railway yard, a block with no through-street — or as several polygons' rings
 * concatenated when the reachable ground comes in disconnected pieces. Every
 * containment test below uses the EVEN-ODD rule over that flat list, which
 * gives the same answer as "exterior minus holes" for well-formed GeoJSON
 * without needing to know which ring is which.
 *
 * A bare ring is accepted unchanged, so every existing caller keeps working.
 *
 * @param {Array<number[]>|Array<Array<number[]>>} input
 * @returns {Array<Array<number[]>>}
 */
export function asRings(input) {
  if (!Array.isArray(input) || !input.length) return [];
  const first = input[0];
  if (Array.isArray(first) && Array.isArray(first[0])) {
    return input.filter((ring) => Array.isArray(ring) && ring.length >= 3);
  }
  return [input];
}

/**
 * Is a point inside a ring? Ray casting, planar in degrees.
 *
 * The half-open convention on the vertical test (`>` on one end, `<=` on the
 * other) is what keeps a point exactly level with a vertex from being counted
 * twice — the classic failure of a naive implementation, and one that produces
 * a plausible wrong answer rather than a crash.
 *
 * @param {Array<number[]>} ring `[lon, lat]` pairs, not necessarily closed.
 * @param {number} lon
 * @param {number} lat
 * @returns {boolean}
 */
export function pointInRing(ring, lon, lat) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (!Array.isArray(a) || !Array.isArray(b)) continue;
    const [ax, ay] = a;
    const [bx, by] = b;
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
      continue;
    }
    if ((ay > lat) !== (by > lat)) {
      const x = ((bx - ax) * (lat - ay)) / (by - ay) + ax;
      if (lon < x) inside = !inside;
    }
  }
  return inside;
}

/**
 * Is a point inside a polygon? Even-odd across every ring, so a point in a
 * hole is outside.
 *
 * @param {Array<number[]>|Array<Array<number[]>>} rings
 * @param {number} lon
 * @param {number} lat
 * @returns {boolean}
 */
export function pointInPolygon(rings, lon, lat) {
  let inside = false;
  for (const ring of asRings(rings)) {
    if (pointInRing(ring, lon, lat)) inside = !inside;
  }
  return inside;
}

/** A polygon's bounding box, so a cell far away is rejected without any test. */
export function ringBounds(rings) {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const ring of asRings(rings)) {
    for (const point of ring) {
      if (!Array.isArray(point)) continue;
      const [lon, lat] = point;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      if (lon < west) west = lon;
      if (lon > east) east = lon;
    }
  }
  return Number.isFinite(south) && Number.isFinite(west)
    ? { south, west, north, east }
    : null;
}

// ---------------------------------------------------------------------------
// Segment geometry
// ---------------------------------------------------------------------------
/** Twice the signed area of triangle abc. Positive when abc turns left. */
function turn(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Is a point known to be COLLINEAR with ab actually on the segment ab? */
function onSpan(ax, ay, bx, by, px, py) {
  return px >= Math.min(ax, bx) && px <= Math.max(ax, bx)
    && py >= Math.min(ay, by) && py <= Math.max(ay, by);
}

/**
 * Do segments ab and cd meet? Touching counts as meeting.
 *
 * The four orientation tests are the standard exact-in-principle predicate; the
 * collinear branches matter here because an isochrone vertex landing exactly on
 * a grid line is not a freak event — the ring is rounded to five decimals and
 * the cells come off a metric grid, so ties happen. Counting a touch as a cross
 * is the conservative direction: it moves a cell into the bracket rather than
 * out of it.
 *
 * Coordinates are degrees; the products are around 1e-6 and stay far inside
 * double precision.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @param {number[]} c
 * @param {number[]} d
 * @returns {boolean}
 */
export function segmentsIntersect(a, b, c, d) {
  const [ax, ay] = a;
  const [bx, by] = b;
  const [cx, cy] = c;
  const [dx, dy] = d;
  const d1 = turn(cx, cy, dx, dy, ax, ay);
  const d2 = turn(cx, cy, dx, dy, bx, by);
  const d3 = turn(ax, ay, bx, by, cx, cy);
  const d4 = turn(ax, ay, bx, by, dx, dy);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
    && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSpan(cx, cy, dx, dy, ax, ay)) return true;
  if (d2 === 0 && onSpan(cx, cy, dx, dy, bx, by)) return true;
  if (d3 === 0 && onSpan(ax, ay, bx, by, cx, cy)) return true;
  if (d4 === 0 && onSpan(ax, ay, bx, by, dx, dy)) return true;
  return false;
}

/**
 * Every polygon edge, filed by the latitude bands it spans.
 *
 * Without this the join is every cell against every ring segment: a quarter of
 * an hour by car around Lyon is a ring of some 1 500 vertices and a box of some
 * 3 000 cells, which is 4.5 million segment pairs before the first population
 * is added up. Banding on latitude at the cell's own height leaves each cell
 * testing the handful of edges that could possibly reach it.
 *
 * Bands are deliberately allowed to hold the same edge twice rather than being
 * de-duplicated on read: a redundant intersection test is cheaper than the Set
 * that would prevent it, and the caller stops at the first hit anyway.
 *
 * @param {Array<number[]>|Array<Array<number[]>>} rings
 * @param {number} [bandDeg] Band height in degrees; defaults to a 64-band split.
 * @returns {object|null} Null when there is no usable edge.
 */
export function buildEdgeIndex(rings, bandDeg) {
  const edges = [];
  let south = Infinity;
  let north = -Infinity;
  for (const ring of asRings(rings)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[j];
      const b = ring[i];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      const [ax, ay] = a;
      const [bx, by] = b;
      if (!Number.isFinite(ax) || !Number.isFinite(ay)
        || !Number.isFinite(bx) || !Number.isFinite(by)) continue;
      const edge = {
        ax,
        ay,
        bx,
        by,
        south: Math.min(ay, by),
        north: Math.max(ay, by),
        west: Math.min(ax, bx),
        east: Math.max(ax, bx),
      };
      if (edge.south < south) south = edge.south;
      if (edge.north > north) north = edge.north;
      edges.push(edge);
    }
  }
  if (!edges.length) return null;
  const span = north - south;
  const step = Number.isFinite(bandDeg) && bandDeg > 0
    ? bandDeg
    : Math.max(span / 64, 1e-9);
  // Capped, so a degenerate `bandDeg` cannot ask for a million empty arrays.
  const count = Math.max(1, Math.min(8192, Math.floor(span / step) + 1));
  const height = span > 0 ? span / count : 1;
  const bands = Array.from({ length: count }, () => []);
  const bandOf = (lat) => Math.min(count - 1, Math.max(0, Math.floor((lat - south) / height)));
  for (const edge of edges) {
    const lo = bandOf(edge.south);
    const hi = bandOf(edge.north);
    for (let k = lo; k <= hi; k += 1) bands[k].push(edge);
  }
  return { south, north, height, count, bands, edges };
}

/** The edges that could reach a latitude span. */
function edgesNear(index, south, north) {
  if (!index) return [];
  if (north < index.south || south > index.north) return [];
  const lo = Math.min(index.count - 1, Math.max(0, Math.floor((south - index.south) / index.height)));
  const hi = Math.min(index.count - 1, Math.max(0, Math.floor((north - index.south) / index.height)));
  if (lo === hi) return index.bands[lo];
  const out = [];
  for (let k = lo; k <= hi; k += 1) out.push(...index.bands[k]);
  return out;
}

/** How a cell sits relative to a polygon. */
export const CELL_POSITIONS = Object.freeze({
  inside: 'inside',
  straddling: 'straddling',
  outside: 'outside',
});

/**
 * Classify one cell against one polygon — exactly, not by sampling it.
 *
 * THIS USED TO SAMPLE FIVE POINTS AND IT WAS WRONG. Four corners plus the
 * centroid sounds thorough and is not a containment test: a corridor narrower
 * than the cell — a street between two railway embankments, a bridge approach —
 * crosses a 200 m square without covering any of those five points, and the
 * cell was then declared OUTSIDE. Reproduced on a band 28 m tall crossing a
 * real cell: the "upper bound" returned zero people for ground the ring
 * physically covers. An upper bound that can be too low is not a bound.
 *
 * So the boundary is tested against the boundary. A cell straddles when any of
 * its four edges meets any polygon edge, OR when it swallows a whole ring — the
 * case where the polygon is smaller than the cell, or where a HOLE sits
 * entirely inside it, which is a cell whose population is partly unreachable
 * and therefore not "fully inside" either.
 *
 * With no crossing and no swallowed ring, the four corners settle it: all in is
 * `inside`, all out is `outside`. A mixed count cannot happen for a simple
 * polygon and is reported as straddling rather than trusted.
 *
 * @param {{n: number, e: number}} cell
 * @param {Array<number[]>|Array<Array<number[]>>} rings
 * @param {number} resolution Cell side, metres.
 * @param {object|null} [index] A `buildEdgeIndex()` over the same polygon.
 * @returns {{position: string, centroidInside: boolean, cornersInside: number,
 *   crossed: boolean}}
 */
export function classifyCell(cell, rings, resolution, index = null) {
  const polygon = asRings(rings);
  const corners = cellCorners({ res: resolution, n: cell.n, e: cell.e });
  const [lon, lat] = cellCentre({ res: resolution, n: cell.n, e: cell.e });
  if (!polygon.length) {
    return {
      position: CELL_POSITIONS.outside, centroidInside: false, cornersInside: 0, crossed: false,
    };
  }
  const centroidInside = pointInPolygon(polygon, lon, lat);
  let cornersInside = 0;
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const [cornerLon, cornerLat] of corners) {
    if (pointInPolygon(polygon, cornerLon, cornerLat)) cornersInside += 1;
    if (cornerLat < south) south = cornerLat;
    if (cornerLat > north) north = cornerLat;
    if (cornerLon < west) west = cornerLon;
    if (cornerLon > east) east = cornerLon;
  }

  const candidates = index ? edgesNear(index, south, north) : (buildEdgeIndex(polygon)?.edges ?? []);
  let crossed = false;
  let swallowed = false;
  for (const edge of candidates) {
    if (edge.north < south || edge.south > north || edge.east < west || edge.west > east) continue;
    if (!swallowed && edge.ax >= west && edge.ax <= east && edge.ay >= south && edge.ay <= north
      && pointInRing(corners, edge.ax, edge.ay)) swallowed = true;
    for (let i = 0; i < 4; i += 1) {
      if (segmentsIntersect(corners[i], corners[(i + 1) % 4], [edge.ax, edge.ay], [edge.bx, edge.by])) {
        crossed = true;
        break;
      }
    }
    if (crossed) break;
  }

  if (crossed || swallowed) {
    return { position: CELL_POSITIONS.straddling, centroidInside, cornersInside, crossed };
  }
  if (cornersInside === 4) {
    return { position: CELL_POSITIONS.inside, centroidInside, cornersInside, crossed };
  }
  if (cornersInside === 0) {
    return { position: CELL_POSITIONS.outside, centroidInside, cornersInside, crossed };
  }
  return { position: CELL_POSITIONS.straddling, centroidInside, cornersInside, crossed };
}

/** Sum a field over cells, ignoring the ones that do not publish it. */
function sum(cells, field) {
  let total = 0;
  for (const cell of cells) {
    const value = cell?.[field];
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

/** Population-weighted mean, so a viewport of squares is not a population. */
function weighted(cells, field, weightField) {
  let total = 0;
  let weight = 0;
  for (const cell of cells) {
    const value = cell?.[field];
    const w = cell?.[weightField];
    if (!Number.isFinite(value) || !Number.isFinite(w) || w <= 0) continue;
    total += value * w;
    weight += w;
  }
  return weight > 0 ? total / weight : null;
}

const round1 = (value) => (value === null ? null : Math.round(value * 10) / 10);

/**
 * Aggregate the carroyage inside one isochrone ring.
 *
 * Returns a BRACKET, not a number. `people.low` counts only squares entirely
 * inside the ring, `people.high` counts every square the ring touches, and
 * `people.count` is the usual centroid convention that sits between them. The
 * indicators are computed on the centroid set, because that is the set the
 * headline number describes and mixing conventions between a total and its
 * composition would be worse than either.
 *
 * Holes are honoured: a square containing a hole is a straddler, not a square
 * fully inside, because part of its population sits on ground the ring does
 * not reach.
 *
 * @param {Array<object>} cells Projected carroyage cells.
 * @param {Array<number[]>|Array<Array<number[]>>} ring A ring, or a polygon's
 *   rings as `[exterior, ...holes]`.
 * @param {number} resolution
 * @returns {object|null} Null when there is nothing to join.
 */
export function aggregateInRing(cells, ring, resolution) {
  const polygon = asRings(ring);
  const bounds = ringBounds(polygon);
  if (!Array.isArray(cells) || !cells.length || !bounds) return null;

  const inside = [];
  const straddling = [];
  const centroidSet = [];
  // A degree of latitude is about 111 km; 200 m is 0.0018°, 1 km is 0.009°. One
  // cell of slack around the ring's own box is enough to catch every square
  // that could possibly touch it, and rejects the rest with two comparisons.
  const cellDeg = resolution / 111_320;
  const padDeg = cellDeg * 1.5;
  // One index for the whole join, banded at the cell's own height, and each
  // cell classified ONCE: the old code classified every straddler twice, which
  // doubled the most expensive half of the work to re-read one boolean.
  const index = buildEdgeIndex(polygon, cellDeg);
  for (const cell of cells) {
    const [lon, lat] = cellCentre({ res: resolution, n: cell.n, e: cell.e });
    if (lat < bounds.south - padDeg || lat > bounds.north + padDeg
      || lon < bounds.west - padDeg || lon > bounds.east + padDeg) continue;
    const { position, centroidInside } = classifyCell(cell, polygon, resolution, index);
    if (position === CELL_POSITIONS.inside) inside.push(cell);
    else if (position === CELL_POSITIONS.straddling) straddling.push(cell);
    else continue;
    if (position === CELL_POSITIONS.inside || centroidInside) centroidSet.push(cell);
  }

  const touching = [...inside, ...straddling];
  if (!touching.length) {
    return {
      cells: { inside: 0, straddling: 0, counted: 0, touched: 0 },
      people: { low: 0, count: 0, high: 0 },
      households: { low: 0, count: 0, high: 0 },
      imputedCells: 0,
      imputedUnknown: 0,
      imputedShare: null,
      niveau: null,
      pauvrete: null,
      jeunes: null,
      aines: null,
      social: null,
      solo: null,
      proprietaires: null,
      resolution,
    };
  }

  const imputed = centroidSet.filter((cell) => cell.est === 1).length;
  // Cells whose imputation flag the service did not answer. Kept apart from the
  // imputed count, because "modelled" and "we were not told" are two different
  // things and only the second forbids the card from claiming "none imputed".
  const imputedUnknown = centroidSet.filter((cell) => cell.est !== 0 && cell.est !== 1).length;
  return {
    cells: {
      // `inside` and `straddling` PARTITION `touched`; `counted` is the
      // centroid set and overlaps both. Reported as four numbers rather than
      // three, because "24 carreaux dont 24 à cheval" reads as "all of them
      // straddle" when the two counts are drawn from different sets — and a
      // reader who cannot add the numbers up stops trusting them.
      inside: inside.length,
      straddling: straddling.length,
      counted: centroidSet.length,
      touched: touching.length,
    },
    people: {
      low: Math.round(sum(inside, 'ind')),
      count: Math.round(sum(centroidSet, 'ind')),
      high: Math.round(sum(touching, 'ind')),
    },
    households: {
      low: Math.round(sum(inside, 'men')),
      count: Math.round(sum(centroidSet, 'men')),
      high: Math.round(sum(touching, 'men')),
    },
    imputedCells: imputed,
    imputedUnknown,
    imputedShare: centroidSet.length
      ? Math.round((imputed / centroidSet.length) * 1000) / 10
      : null,
    niveau: (() => {
      const value = weighted(centroidSet, 'niveau', 'ind');
      return value === null ? null : Math.round(value);
    })(),
    pauvrete: round1(weighted(centroidSet, 'pauvrete', 'men')),
    jeunes: round1(weighted(centroidSet, 'jeunes', 'ind')),
    aines: round1(weighted(centroidSet, 'aines', 'ind')),
    social: round1(weighted(centroidSet, 'social', 'men')),
    solo: round1(weighted(centroidSet, 'solo', 'men')),
    proprietaires: round1(weighted(centroidSet, 'proprietaires', 'men')),
    resolution,
  };
}

/**
 * How wide the bracket is, as a share of the headline.
 *
 * The single number that says whether the headline can be trusted: 12 % is a
 * ring whose edge barely matters, 60 % is a ring so small relative to the grid
 * that the answer is mostly boundary. Reported so a reader does not have to
 * subtract two figures to find out.
 *
 * @param {{low: number, count: number, high: number}} bracket
 * @returns {number|null} Percent, or null when there is no headline to divide by.
 */
export function bracketWidthPercent(bracket) {
  if (!bracket || !Number.isFinite(bracket.count) || bracket.count <= 0) return null;
  const span = bracket.high - bracket.low;
  return Math.round((span / bracket.count) * 1000) / 10;
}

/**
 * The BAN address label, folded to the one line a card can carry.
 * @param {object|null} feature A `api-adresse.data.gouv.fr` feature.
 * @returns {{label: string|null, commune: string|null, insee: string|null,
 *   postcode: string|null, distanceM: number|null}}
 */
export function projectAddress(feature) {
  const props = feature?.properties || null;
  if (!props) {
    return { label: null, commune: null, insee: null, postcode: null, distanceM: null };
  }
  const distance = Number(props.distance);
  return {
    label: props.label ?? null,
    commune: props.city ?? null,
    insee: props.citycode ?? null,
    postcode: props.postcode ?? null,
    distanceM: Number.isFinite(distance) ? Math.round(distance) : null,
  };
}

/**
 * The zoning line, from the GPU payload the address layer already parses.
 *
 * Only the zone the point is ACTUALLY IN — `atPoint` — is reported. A fiche
 * that named the nearest zone instead would be describing the plot next door,
 * and a reader has no way to tell.
 *
 * @param {object|null} gpu
 * @returns {{code: string|null, label: string|null, kind: string|null,
 *   approvedOn: string|null, overlapping: number, servitudes: number,
 *   servitudeLabels: string[]}|null}
 */
export function projectZoning(gpu) {
  if (!gpu) return null;
  const zones = Array.isArray(gpu.zones) ? gpu.zones : [];
  const here = zones.filter((zone) => zone.atPoint);
  const zone = here[0] || null;
  const servitudes = Array.isArray(gpu.servitudes) ? gpu.servitudes : [];
  return {
    code: zone?.code ?? null,
    label: zone?.label ?? null,
    kind: zone?.kind ?? null,
    approvedOn: zone?.approvedOn ?? null,
    // Two communes digitising their shared limit independently leave a strip
    // carrying two zonings. The urbanism layer measured it; a fiche that
    // printed one of the two would be picking a winner at random.
    overlapping: here.length,
    servitudes: servitudes.length,
    servitudeLabels: [...new Set(servitudes.map((entry) => entry.label).filter(Boolean))].slice(0, 4),
  };
}

/**
 * The market line, from the DVF payload the address layer already parses.
 * @param {object|null} dvf
 * @returns {object|null}
 */
export function projectMarket(dvf) {
  if (!dvf) return null;
  const summary = dvf.summary || {};
  return {
    sales: summary.count ?? 0,
    // The gap between these two is the honesty of the median beside them: a
    // €/m² is only a comparable when the sale bought exactly one dwelling.
    comparable: summary.comparableCount ?? 0,
    medianPrixM2: summary.medianPrixM2 ?? null,
    p25PrixM2: summary.p25PrixM2 ?? null,
    p75PrixM2: summary.p75PrixM2 ?? null,
    years: dvf.years ?? null,
    commune: dvf.commune?.name ?? null,
  };
}

/**
 * Everything the fiche states, as one object.
 *
 * Assembled here rather than in the proxy so the composition is testable
 * without a server, and so every "this half did not answer" case is decided in
 * one place: a fiche with no zoning is still a fiche, and it says the zoning is
 * missing rather than omitting the line.
 *
 * @param {object} parts
 * @returns {object}
 */
export function composeFiche({
  point, address = null, isochrone = null, demand = null,
  zoning = null, market = null, missing = [],
}) {
  return {
    point,
    address: address ?? { label: null, commune: null, insee: null, postcode: null, distanceM: null },
    isochrone,
    demand,
    zoning,
    market,
    // Named, never silent. Each entry is a half of the fiche that did not
    // answer, and the card prints them: "no zoning" and "the zoning service
    // was down" are different sentences and a reader deserves the second.
    missing,
  };
}
