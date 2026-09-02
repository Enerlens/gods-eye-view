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
 * WHY PLANAR RAY CASTING IS ENOUGH. The rings this joins against are at most a
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

/** A ring's bounding box, so a cell far away is rejected without five tests. */
export function ringBounds(ring) {
  if (!Array.isArray(ring) || !ring.length) return null;
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const point of ring) {
    if (!Array.isArray(point)) continue;
    const [lon, lat] = point;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
  }
  return Number.isFinite(south) && Number.isFinite(west)
    ? { south, west, north, east }
    : null;
}

/** How a cell sits relative to a ring. */
export const CELL_POSITIONS = Object.freeze({
  inside: 'inside',
  straddling: 'straddling',
  outside: 'outside',
});

/**
 * Classify one cell against one ring, using its four real corners AND its
 * centroid.
 *
 * Five tests rather than four, because four corners outside does NOT mean the
 * cell is outside: a ring narrower than 200 m can pass through the middle of a
 * square without containing any of its corners. That case is rare at 200 m and
 * routine at 1 km, and it is the difference between a straddle counted and a
 * straddle silently dropped.
 *
 * @param {{n: number, e: number}} cell
 * @param {Array<number[]>} ring
 * @param {number} resolution Cell side, metres.
 * @returns {{position: string, centroidInside: boolean, cornersInside: number}}
 */
export function classifyCell(cell, ring, resolution) {
  const corners = cellCorners({ res: resolution, n: cell.n, e: cell.e });
  const [lon, lat] = cellCentre({ res: resolution, n: cell.n, e: cell.e });
  const centroidInside = pointInRing(ring, lon, lat);
  let cornersInside = 0;
  for (const [cornerLon, cornerLat] of corners) {
    if (pointInRing(ring, cornerLon, cornerLat)) cornersInside += 1;
  }
  if (cornersInside === 4 && centroidInside) {
    return { position: CELL_POSITIONS.inside, centroidInside, cornersInside };
  }
  if (cornersInside === 0 && !centroidInside) {
    return { position: CELL_POSITIONS.outside, centroidInside, cornersInside };
  }
  return { position: CELL_POSITIONS.straddling, centroidInside, cornersInside };
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
 * @param {Array<object>} cells Projected carroyage cells.
 * @param {Array<number[]>} ring
 * @param {number} resolution
 * @returns {object|null} Null when there is nothing to join.
 */
export function aggregateInRing(cells, ring, resolution) {
  const bounds = ringBounds(ring);
  if (!Array.isArray(cells) || !cells.length || !bounds) return null;

  const inside = [];
  const straddling = [];
  // A degree of latitude is about 111 km; 200 m is 0.0018°, 1 km is 0.009°. One
  // cell of slack around the ring's own box is enough to catch every square
  // that could possibly touch it, and rejects the rest with two comparisons.
  const padDeg = (resolution / 111_320) * 1.5;
  for (const cell of cells) {
    const [lon, lat] = cellCentre({ res: resolution, n: cell.n, e: cell.e });
    if (lat < bounds.south - padDeg || lat > bounds.north + padDeg
      || lon < bounds.west - padDeg || lon > bounds.east + padDeg) continue;
    const { position } = classifyCell(cell, ring, resolution);
    if (position === CELL_POSITIONS.inside) inside.push(cell);
    else if (position === CELL_POSITIONS.straddling) straddling.push(cell);
  }

  const centroidSet = [
    ...inside,
    ...straddling.filter((cell) => classifyCell(cell, ring, resolution).centroidInside),
  ];
  const touching = [...inside, ...straddling];
  if (!touching.length) {
    return {
      cells: { inside: 0, straddling: 0, counted: 0, touched: 0 },
      people: { low: 0, count: 0, high: 0 },
      households: { low: 0, count: 0, high: 0 },
      imputedCells: 0,
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
