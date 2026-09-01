// src/data/cadastreParcelDetail.js — what is ON a parcel, once you have the
// parcel.
//
// The cadastre says where a piece of land is and how big the tax administration
// thinks it is. It says nothing about what stands on it, who lives there, or
// what its address is — and those are the first three questions anyone asks
// after clicking. This module answers them from two other keyless French
// sources and is careful, on every line, about the fact that they are OTHER
// sources: a building is joined to a parcel by geometry here, not by a
// published relation, and the card says so rather than implying a register.
//
// Everything here is pure and node-testable. The fetching lives in
// `cadastreParcels.js`.
//
// ── The three traps ─────────────────────────────────────────────────────────
//
// 1. **A building near a tile edge is in BOTH tiles.** Measured over Paris 16e
//    on 2026-09-01: a naive join of two z15 tiles reported 25 buildings on one
//    parcel where there are 14, and `63QEQKPYJ1V3` appeared three times at
//    2 983, 13 and 5 042 m². Vector tiles carry a buffer, so the same building
//    arrives clipped differently in each tile it touches. Deduplicating on
//    `cleabs` — present on 100% of the 1 202 features in a sampled tile — is
//    not an optimisation, it is the difference between 89% built and 50%.
//
// 2. **The join is geometric, and nobody publishes it.** BD TOPO and the PCI
//    are two products with two lineages; there is no key that says "this
//    building is on that parcel". A footprint centroid inside the parcel is a
//    good rule and a stated one, and it is wrong in both directions at the
//    edges: a building straddling a boundary counts wholly on the side its
//    centre falls, and a courtyard pavilion whose centre lands in the neighbour
//    is lost. The card names the rule so the number is read as a measurement of
//    it rather than as a fact about the land registry.
//
// 3. **The address is the NEAREST one, and its distance says how near.** BAN
//    reverse geocoding answers with an address point and the metres between it
//    and the query. At 7 m that is the building's own number; at 80 m it is the
//    next street. The distance is printed with the address for that reason, and
//    an answer beyond {@link ADDRESS_MAX_DISTANCE_M} is dropped rather than
//    shown, because a wrong address is worse than none on a card whose whole
//    subject is which piece of ground you are looking at.

import { parcelAreaM2, parcelPolygons, pointInPolygons } from './cadastreFeed.js';

/** Base Adresse Nationale, keyless and CORS-open. Licence Ouverte 2.0. */
export const BAN_REVERSE_URL = 'https://api-adresse.data.gouv.fr/reverse/';

/**
 * How far the nearest address point may be before it stops describing this
 * parcel.
 *
 * 60 m is roughly a Paris block face. Beyond it the BAN point is answering
 * about a different building, and on a card whose subject is exactly which
 * piece of ground you are looking at, a confidently wrong address does more
 * damage than a missing line.
 */
export const ADDRESS_MAX_DISTANCE_M = 60;

/**
 * Ceiling on tiles fetched to answer one parcel.
 *
 * A z15 BD TOPO tile is ~1.2 km across and the median French parcel is tens of
 * metres, so one tile answers almost every parcel and two answer the ones that
 * straddle an edge. Four is the ceiling for a genuinely large rural parcel; a
 * parcel needing more is answered from what the four hold, and says so.
 */
export const BUILDING_TILE_CAP = 4;

/** @returns {?number} A usable finite number, or null — never a coerced 0. */
function finiteOrNull(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value) {
  return String(value ?? '').trim();
}

/** Centroid of a footprint's outer ring, by vertex average. */
export function footprintCentroid(polygons) {
  const ring = polygons?.[0]?.[0];
  if (!Array.isArray(ring) || ring.length < 3) return null;
  let lon = 0;
  let lat = 0;
  let n = 0;
  for (const point of ring) {
    if (!Array.isArray(point)) continue;
    lon += point[0];
    lat += point[1];
    n += 1;
  }
  if (!n) return null;
  const centre = [lon / n, lat / n];
  return centre.every(Number.isFinite) ? centre : null;
}

/**
 * Fold decoded BD TOPO buildings into what stands on one parcel.
 *
 * @param {Array<{properties:object, geometry:object}>} features Decoded tile features.
 * @param {object} parcel `{ polygons, areaM2 }`.
 * @returns {object}
 */
export function summarizeParcelBuildings(features, parcel) {
  const polygons = parcel?.polygons || [];
  const parcelArea = finiteOrNull(parcel?.areaM2);

  // TRAP 1. Keyed by `cleabs`, keeping the LARGEST piece seen for each
  // building: the tile that holds more of it holds the better single estimate
  // of its footprint. Summing the pieces instead would count the buffered
  // overlap twice, which is how one parcel came out 89% built.
  const byId = new Map();
  let anonymous = 0;
  for (const feature of features || []) {
    const props = feature?.properties || {};
    const shape = parcelPolygons(feature?.geometry);
    if (!shape.length) continue;
    const centre = footprintCentroid(shape);
    if (!centre) continue;
    // TRAP 2. The stated rule: a building belongs to the parcel its footprint
    // centre falls on.
    if (!pointInPolygons(polygons, centre[0], centre[1])) continue;
    const area = parcelAreaM2(feature.geometry) ?? 0;
    const id = text(props.cleabs) || text(props.identifiants_rnb).split('/')[0];
    if (!id) { anonymous += 1; byId.set(`anon:${anonymous}`, { props, area }); continue; }
    const seen = byId.get(id);
    if (!seen || area > seen.area) byId.set(id, { props, area });
  }

  const buildings = [...byId.values()];
  let footprintM2 = 0;
  let tallestM = null;
  let storeys = null;
  let dwellings = 0;
  let dwellingsKnown = false;
  const usages = new Map();
  let oldest = null;

  for (const { props, area } of buildings) {
    footprintM2 += area;
    const height = finiteOrNull(props.hauteur);
    if (height !== null && (tallestM === null || height > tallestM)) tallestM = height;
    const levels = finiteOrNull(props.nombre_d_etages);
    if (levels !== null && (storeys === null || levels > storeys)) storeys = levels;
    const homes = finiteOrNull(props.nombre_de_logements);
    if (homes !== null) { dwellings += homes; dwellingsKnown = true; }
    const usage = text(props.usage_1);
    if (usage && usage !== 'Indifférencié') usages.set(usage, (usages.get(usage) || 0) + 1);
    const created = text(props.date_creation).slice(0, 4);
    if (/^\d{4}$/.test(created) && (oldest === null || created < oldest)) oldest = created;
  }

  return {
    count: buildings.length,
    footprintM2: Math.round(footprintM2),
    // Capped at 1: the join is by centroid, so a building that overhangs the
    // boundary contributes its whole footprint and a dense parcel can exceed
    // its own surface. A ratio over 100% would read as an error in the data
    // when it is a property of the rule, so it is clamped and the rule named.
    coverage: parcelArea && parcelArea > 0 ? Math.min(1, footprintM2 / parcelArea) : null,
    tallestM,
    storeys,
    dwellings: dwellingsKnown ? dwellings : null,
    usages: [...usages.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, count: n })),
    oldest,
    anonymous,
  };
}

/**
 * Project one BAN reverse answer, or null when it does not describe this spot.
 * @param {object} payload BAN FeatureCollection.
 * @param {number} [maxDistanceM]
 * @returns {?{label:string, housenumber:?string, street:?string, postcode:?string, city:?string, district:?string, distanceM:?number}}
 */
export function projectBanAddress(payload, maxDistanceM = ADDRESS_MAX_DISTANCE_M) {
  const props = payload?.features?.[0]?.properties;
  if (!props) return null;
  const distanceM = finiteOrNull(props.distance);
  // TRAP 3. A distant point is answering about a different building.
  if (distanceM !== null && distanceM > maxDistanceM) return null;
  const label = text(props.label);
  if (!label) return null;
  return {
    label,
    housenumber: text(props.housenumber) || null,
    street: text(props.street) || null,
    postcode: text(props.postcode) || null,
    city: text(props.city) || null,
    district: text(props.district) || null,
    distanceM,
  };
}

/** The largest distance across a parcel, in metres — its longest dimension. */
export function parcelSpanM(polygons) {
  const points = [];
  for (const polygon of polygons || []) {
    for (const point of polygon?.[0] || []) {
      if (Array.isArray(point) && Number.isFinite(point[0])) points.push(point);
    }
  }
  if (points.length < 2) return null;
  const latRef = points[0][1];
  const kx = Math.cos((latRef * Math.PI) / 180) * 111320;
  const ky = 110540;
  let best = 0;
  // O(n²) over a ring that is 12 vertices for a city parcel and 33 for a rural
  // one. A convex-hull rotating-calliper pass is the textbook answer and buys
  // nothing measurable at this size.
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const dx = (points[i][0] - points[j][0]) * kx;
      const dy = (points[i][1] - points[j][1]) * ky;
      const d = (dx * dx) + (dy * dy);
      if (d > best) best = d;
    }
  }
  return best > 0 ? Math.sqrt(best) : null;
}

/** `24 m`, `1,2 km`. */
function formatMetres(value) {
  const m = finiteOrNull(value);
  if (m === null) return null;
  if (m >= 1000) return `${(m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;
  return `${Math.round(m).toLocaleString('fr-FR')} m`;
}

/**
 * The address line, with the distance that qualifies it.
 * @param {?object} address From {@link projectBanAddress}.
 * @returns {?string}
 */
export function addressLine(address) {
  if (!address?.label) return null;
  const distance = finiteOrNull(address.distanceM);
  // Under ten metres the point is on this building and the qualifier is noise.
  // Past that it is the reader's only clue that the address is the NEAREST one.
  if (distance === null || distance < 10) return address.label;
  return `${address.label} · point adresse à ${formatMetres(distance)}`;
}

/**
 * What is built on the parcel, as card lines.
 *
 * Two lines at most, and the second one always names the rule: the count and
 * the surface are a measurement of "footprint centres inside this polygon",
 * not a figure anyone publishes about this parcel.
 * @param {?object} summary From {@link summarizeParcelBuildings}.
 * @param {boolean} [partial] Whether the tile budget bounded the answer.
 * @returns {string[]}
 */
export function buildingLines(summary, partial = false) {
  if (!summary) return [];
  if (!summary.count) {
    return [partial
      ? 'Aucun bâti trouvé — recherche partielle (parcelle à cheval sur plusieurs tuiles)'
      : 'Aucun bâtiment BD TOPO sur cette parcelle'];
  }
  const lines = [];
  const parts = [`${summary.count.toLocaleString('fr-FR')} bâtiment${summary.count > 1 ? 's' : ''}`];
  if (summary.footprintM2 > 0) {
    parts.push(`${summary.footprintM2.toLocaleString('fr-FR')} m² au sol`);
  }
  if (summary.coverage !== null) {
    parts.push(`${Math.round(summary.coverage * 100)} % de la parcelle`);
  }
  lines.push(parts.join(' · '));

  const detail = [];
  if (summary.storeys !== null) detail.push(`R+${summary.storeys}`);
  if (summary.tallestM !== null) detail.push(`${formatMetres(summary.tallestM)} de haut`);
  if (summary.dwellings) detail.push(`${summary.dwellings.toLocaleString('fr-FR')} logements`);
  if (summary.usages.length) detail.push(summary.usages[0].name.toLowerCase());
  if (detail.length) lines.push(detail.join(' · '));

  lines.push(partial
    ? 'Bâti IGN BD TOPO, centre d\'emprise dans la parcelle — recherche partielle'
    : 'Bâti IGN BD TOPO, joint par centre d\'emprise (aucun lien publié)');
  return lines;
}

/** The parcel's own longest dimension, as a card line. */
export function dimensionLine(polygons) {
  const span = parcelSpanM(polygons);
  return span === null ? null : `Plus grande dimension ${formatMetres(span)}`;
}
