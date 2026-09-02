/**
 * @module data/cadastreLineage
 *
 * Where a permit's parcel went after the surveyor split it.
 *
 * Sitadel carries no coordinate (`adsFeed.js`, TRAP 4) but it does carry up to
 * three cadastral references, and the cadastre is open. Placing a permit on
 * the plot it names is therefore free — for the 58.1% of rows whose parcel
 * still exists. Measured over the 543 Sitadel rows of Ustaritz (64547) since
 * 2013:
 *
 *   parcelle citée toujours vivante                        315   58.1%
 *   parcelle disparue du cadastre courant                  202   37.3%
 *   référence provisoire, suffixe lettre («255P»)           25    4.6%
 *   … et 298 rows (55.0%) carry no house number at all.
 *
 * THE 37% IS THE INTERESTING PART, and it is not a data error. A parcel
 * disappears because it was DIVIDED, and a permit is very often the reason it
 * was: file on a field, split the field, build on a lot. So the reference is
 * dead precisely BECAUSE the permit did what it asked to do. Dropping those
 * rows to a street-level geocode — which is what the layer did before this
 * module — throws away the one register that knows where the building went.
 *
 * ── The chain, and the case it was written from ─────────────────────────────
 * Permit `06454721B0009`: parcelle `AN 221`, no house number, 1 317 m² of
 * declared land, 1 dwelling of 94 m², chantier open 2022-04-15, finished
 * 2023-04-15.
 *
 *   1. AN 221 is absent from the 8 072 parcels of today's Ustaritz.
 *   2. Etalab publishes DATED snapshots of the whole cadastre. AN 221 is
 *      present at 2021-04-01 and gone at 2021-07-01 — divided three months
 *      before the permit was granted. Its outline measures 1 372 m² against
 *      the 1 317 declared, a 4% disagreement.
 *   3. Three of today's parcels have their anchor inside that outline:
 *      AN 511 (811 m²), AN 512 (527) and AN 513 (34). They sum to 1 372 m²,
 *      to the square metre — which is what a division looks like and what
 *      {@link childrenOf}'s area guard tests for.
 *   4. Buildings, on the same two snapshots: AN 511 already carried 188 + 12 m²
 *      in 2021 and gained nothing; AN 513 — 34 m², the lotissement's access
 *      strip — never carried anything; AN 512 went from ZERO to one building
 *      of 76 m². Against 94 m² of declared floor area over two levels, that is
 *      the house.
 *   5. The commune's BAL names it: `64547000AN0512` is **18 Impasse de
 *      Haroztegia**.
 *
 * The number 18 never appears in the permit. It falls out of the chain.
 *
 * ── Why it stops at the parent when it cannot pick a child ──────────────────
 * Measured over the 125 ambiguous divisions of Ustaritz authorised since 2018,
 * the building diff alone names exactly one child in **29.6%** of cases. In
 * 45.6% several children built — usually because several permits name the same
 * parent, a lotissement being a lotissement — and in 24.8% nothing was built
 * at all. So two thirds of the time there is no child to pick, and this module
 * hands back the PARENT outline rather than a guess. A 1 372 m² polygon that
 * certainly contains the site beats a confident dot in the middle of the road,
 * and {@link ADS_LINEAGE_BASIS} makes the difference legible on the card.
 *
 * ── The archive floor is 2017, and the loss profile says so ─────────────────
 * Etalab's oldest snapshot is 2017-07-06. Of the 227 unusable references,
 * 67.4% are recoverable overall — but that average hides the shape. Per year of
 * authorisation, permits that could not be placed at all:
 *
 *   2013–2016   61 of 161      (no snapshot exists that far back)
 *   2018–2021    5 of 227
 *   2022–2026    2 of 115
 *
 * Nothing can be done about the first line, and this module does not pretend
 * otherwise — {@link LINEAGE_ARCHIVE_FLOOR} is the honest edge of the method.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM, no fetch): URL
 * construction, geometry and decision logic only. The `/api/ads-fr` proxy
 * imports it; nothing in the browser bundle does.
 */

import {
  CADASTRE_ETALAB_BASE,
  parcelAreaM2,
  parcelParts,
  pointOnParcel,
} from './sitadelFeed.js';
import { polygonsBounds, ringLabelAnchor } from './ringGeometry.js';

/**
 * The oldest dated snapshot Etalab publishes.
 *
 * A permit authorised before this cannot have its parent recovered, and the
 * layer reports that as a stated limit rather than as an empty answer.
 */
export const LINEAGE_ARCHIVE_FLOOR = '2017-07-06';

/**
 * The snapshot list, pinned, as the fallback for live discovery.
 *
 * Etalab's cadence is NOT regular and cannot be computed: quarterly from 2019
 * but with 2020-04-01 never published and 2021 starting on 02-01, and the 2017
 * and 2018 editions landing on 07-06, 10-12, 01-02, 04-03, 06-29 and 10-01.
 * Any rule that generates these dates would generate 404s alongside them, so
 * the list is measured (2026-09-02) and {@link parseCadastreMillesimes} reads
 * the live index over it when the index answers.
 */
export const LINEAGE_MILLESIMES = Object.freeze([
  '2017-07-06', '2017-10-12', '2018-01-02', '2018-04-03', '2018-06-29',
  '2018-10-01', '2019-01-01', '2019-04-01', '2019-07-01', '2019-10-01',
  '2020-01-01', '2020-07-01', '2020-10-01', '2021-02-01', '2021-04-01',
  '2021-07-01', '2021-10-01', '2022-01-01', '2022-04-01', '2022-07-01',
  '2022-10-01', '2023-01-01', '2023-04-01', '2023-07-01', '2023-10-01',
  '2024-01-01', '2024-04-01', '2024-07-01', '2024-10-01', '2025-01-01',
]);

/**
 * How a child was chosen, worst to best, and what each licenses a reader to
 * believe. Carried to the card so an INFERENCE never reads like a record.
 */
export const ADS_LINEAGE_BASIS = Object.freeze({
  parent: { rank: 0, label: 'emprise divisée depuis' },
  sole: { rank: 1, label: 'lot unique après division' },
  built: { rank: 2, label: 'seul lot construit depuis' },
  numbered: { rank: 3, label: 'lot identifié par son numéro' },
});

/**
 * How much the children may disagree with the parent before the match is
 * refused, as a fraction of the parent's area.
 *
 * A division conserves ground: the children of AN 221 sum to 1 372 m² against
 * the parent's 1 372, exactly. The tolerance is not there for the division —
 * it is there for the REDRAW. Etalab republishes the whole cadastre each
 * quarter and vertices move by centimetres between editions, so an exact test
 * would refuse a correct lineage over rounding. 12% is wide enough for the
 * drift and narrow enough that a parent whose anchor test caught a neighbour's
 * plot, or missed a child entirely, fails instead of being drawn.
 */
export const LINEAGE_AREA_TOLERANCE = 0.12;

/**
 * A cadastral reference as Sitadel writes it, and whether it can be resolved.
 *
 * `NUM_CADASTRE` is USUALLY a number and sometimes a number with a letter
 * glued to it — `255P`, `223P`, `171P`, 25 of Ustaritz's 543 rows. The suffix
 * is the surveyor's mark for *partie de parcelle*: the lot did not exist yet
 * when the file was opened. Padding that to four characters yields `255P`,
 * which is not a cadastral number and silently misses the index — so the
 * digits are taken and the row is FLAGGED, because a provisional reference is
 * the register announcing its own division and is worth saying out loud.
 *
 * @param {object} row A Sitadel row.
 * @param {string} insee The commune the cadastre is keyed by.
 * @returns {Array<{idu: string, provisional: boolean, label: string}>}
 */
export function sitadelParcelRefs(row, insee) {
  const commune = String(insee ?? '').trim();
  if (!/^[0-9][0-9AB][0-9]{3}$/.test(commune.toUpperCase())) return [];
  const out = [];
  for (const slot of [1, 2, 3]) {
    const section = String(row?.[`SEC_CADASTRE${slot}`] ?? '').trim().toUpperCase();
    const numero = String(row?.[`NUM_CADASTRE${slot}`] ?? '').trim().toUpperCase();
    if (!section || !numero) continue;
    const digits = numero.replace(/[^0-9]/g, '');
    if (!digits) continue;
    const idu = `${commune}000${section.padStart(2, '0')}${digits.padStart(4, '0')}`;
    if (out.some((ref) => ref.idu === idu)) continue;
    out.push({
      idu,
      provisional: /[A-Z]$/.test(numero),
      label: `${section}${digits}`,
    });
  }
  return out;
}

/**
 * Index one Etalab parcel collection by its published `id`.
 *
 * Keyed on the file's OWN id rather than on a key rebuilt from its columns:
 * `sitadelFeed.js` builds its key from `commune + section + numero` because it
 * has to match Sitadel's spelling, and inherits an ambiguity from the missing
 * `prefixe`. Here both sides are the cadastre, so the published 14-character
 * IDU is available on both and there is nothing to reconstruct.
 *
 * @param {object} collection A GeoJSON FeatureCollection.
 * @returns {Map<string, object>} IDU → feature.
 */
export function indexByIdu(collection) {
  const index = new Map();
  for (const feature of collection?.features || []) {
    const id = feature?.properties?.id;
    if (typeof id === 'string' && id && !index.has(id)) index.set(id, feature);
  }
  return index;
}

/**
 * A point guaranteed to sit inside a parcel.
 *
 * NOT the centroid. `parcelAnchor` next door returns the area centroid of the
 * widest ring, which is the right answer for hanging a label and the wrong one
 * for a containment test: an L-shaped lot — a house plus its driveway strip,
 * which is most of what a lotissement produces — has its centroid on the
 * neighbour's ground. `ringLabelAnchor` scans for a point strictly inside, so
 * a child is tested by something that is actually on it.
 *
 * @param {Array} parts GeoJSON polygon parts.
 * @returns {?{lon: number, lat: number}}
 */
export function insidePoint(parts) {
  let best = null;
  for (const part of Array.isArray(parts) ? parts : []) {
    const anchor = ringLabelAnchor(part);
    if (anchor && (!best || anchor.widthDeg > best.widthDeg)) best = anchor;
  }
  return best ? { lon: best.lon, lat: best.lat } : null;
}

/**
 * Anchor and measure a whole commune's parcels, once.
 *
 * THE COST OF THIS MODULE LIVES HERE, and the shape of it is why the function
 * exists at all. Finding a parent's children means testing every parcel in the
 * commune against it, and Ustaritz has 8 072 of them; a commune's register can
 * carry two hundred dead references. Anchoring inside the search would run
 * `ringLabelAnchor`'s scanlines 1.6 million times per scan and turn a lineage
 * pass into a stall. The anchor of a parcel does not depend on which parent is
 * being asked about, so it is computed once and the search becomes a ray cast
 * against one small ring.
 *
 * @param {object} collection A GeoJSON FeatureCollection of parcels.
 * @returns {Array<{feature: object, parts: Array, point: {lon: number, lat: number}, areaM2: number}>}
 */
export function anchorParcels(collection) {
  const out = [];
  for (const feature of collection?.features || []) {
    const parts = parcelParts(feature?.geometry);
    const point = insidePoint(parts);
    if (!point) continue;
    out.push({ feature, parts, point, areaM2: parcelAreaM2(parts) ?? 0 });
  }
  return out;
}

/**
 * The parcels of today that came out of one parcel of the past.
 *
 * ANCHOR-IN-PARENT, not polygon intersection, and the difference matters. The
 * parent comes from an archived edition and the children from the current one,
 * and Etalab redraws the whole country every quarter — so the two outlines do
 * not share vertices and every child overlaps its neighbours' old boundaries
 * by a sliver. An intersection test would collect the whole block; an anchor
 * test collects exactly the lots that stand on the parent's ground.
 *
 * The area guard is what makes the result trustworthy. Children that sum to
 * the parent are a division; children that sum to a third of it mean the
 * anchor test lost lots to a boundary that moved, and the honest answer is
 * then that this parent has no usable lineage.
 *
 * @param {object} parent Archived parcel feature.
 * @param {Array<object>} anchored Today's parcels, from {@link anchorParcels}.
 * @returns {{children: Array<object>, parentAreaM2: ?number,
 *   childAreaM2: number, agrees: boolean}}
 */
export function childrenOf(parent, anchored) {
  const parentParts = parcelParts(parent?.geometry);
  const parentAreaM2 = parcelAreaM2(parentParts);
  // A parcel is a few tens of metres across and a commune is kilometres, so
  // the bounds reject all but a handful before any ray is cast.
  const bounds = polygonsBounds(parentParts);
  const children = [];
  let childAreaM2 = 0;
  for (const candidate of anchored || []) {
    const { lon, lat } = candidate.point;
    if (bounds && (lon < bounds.west || lon > bounds.east
      || lat < bounds.south || lat > bounds.north)) continue;
    if (!pointOnParcel(parentParts, lon, lat)) continue;
    children.push(candidate.feature);
    childAreaM2 += candidate.areaM2;
  }
  const agrees = Number.isFinite(parentAreaM2) && parentAreaM2 > 0
    && Math.abs(childAreaM2 - parentAreaM2) / parentAreaM2 <= LINEAGE_AREA_TOLERANCE;
  return { children, parentAreaM2, childAreaM2: Math.round(childAreaM2), agrees };
}

/**
 * How many buildings stand on a parcel, in one edition of the cadastre.
 *
 * @param {Array} parts The parcel's polygon parts.
 * @param {Iterable<object>} buildings Building features from one edition.
 * @returns {number}
 */
export function buildingsOn(parts, buildings) {
  const bounds = polygonsBounds(parts);
  let count = 0;
  for (const entry of buildings || []) {
    // Takes either raw features or the anchored form, so a caller with one
    // parcel to check pays nothing to set up and a caller with a commune's
    // worth of them anchors once — see {@link anchorParcels}.
    const point = entry?.point ?? insidePoint(parcelParts(entry?.geometry));
    if (!point) continue;
    if (bounds && (point.lon < bounds.west || point.lon > bounds.east
      || point.lat < bounds.south || point.lat > bounds.north)) continue;
    if (pointOnParcel(parts, point.lon, point.lat)) count += 1;
  }
  return count;
}

/**
 * The children that gained a building between two editions.
 *
 * This is the signal that separates the lot that was built from the lot that
 * was merely created — and on the case this module was written from it is the
 * whole answer: of AN 221's three children, one went from zero buildings to
 * one and the other two did not move.
 *
 * A COUNT and not an area: the cadastre's building outlines are redrawn along
 * with everything else, so the same house measures slightly differently in two
 * editions, while "there was nothing here and now there is something" survives
 * any redraw.
 *
 * @param {Array<object>} children
 * @param {Array<object>} before Buildings, edition near the authorisation.
 *   Raw features, or the anchored form when the caller has a commune's worth
 *   of them and a list of parents to run against — see {@link anchorParcels}.
 * @param {Array<object>} after Buildings, current edition, same two forms.
 * @returns {Array<object>} The subset that gained at least one building.
 */
export function childrenThatBuilt(children, before, after) {
  const out = [];
  for (const child of children || []) {
    const parts = parcelParts(child?.geometry);
    if (buildingsOn(parts, after) > buildingsOn(parts, before)) out.push(child);
  }
  return out;
}

/**
 * The parcel a BAL house number stands on.
 *
 * The commune's *Base Adresse Locale* publishes, per numbered address, the
 * cadastral parcels it sits on — which is the only published join between a
 * street number and a lot. On the impasse this module was written from:
 *
 *   18 → AN 0512    42 → AN 0511    63 → AN 0515    67 → AN 0514    68 → AN 0222
 *
 * AND IT CONTRADICTS THE PERMITS, usefully. Two Ustaritz dossiers are filed at
 * "67 IMPASSE D'HAROZTEGIA" and name parcel AN 515, which the BAL numbers 63;
 * the real 67 is AN 514, one lot further. The counter's address text and the
 * official address disagree, so a number written on a permit is a hint and the
 * parcel is the fact — which is why this function is a tie-breaker among
 * children and never a placement of its own.
 *
 * @param {object} bal A BAL voie payload, `{numeros: [{numero, parcelles}]}`.
 * @param {?string|number} houseNumber The number written on the permit.
 * @returns {Array<string>} Candidate IDUs, empty when the number is unknown.
 */
export function balParcelsForNumber(bal, houseNumber) {
  const wanted = String(houseNumber ?? '').trim().replace(/^0+(?=\d)/, '').toUpperCase();
  if (!wanted) return [];
  const out = [];
  for (const entry of bal?.numeros || []) {
    const numero = String(entry?.numero ?? '').trim();
    const suffix = String(entry?.suffixe ?? '').trim().toUpperCase();
    if (`${numero}${suffix}` !== wanted && numero !== wanted) continue;
    for (const idu of entry?.parcelles || []) {
      if (typeof idu === 'string' && idu && !out.includes(idu)) out.push(idu);
    }
  }
  return out;
}

/**
 * Choose which child of a divided parcel a permit belongs to.
 *
 * The order is by how much the evidence proves, not by how often it fires:
 * a BAL number is a published statement about that address, a lone new
 * building is a strong inference, a single child is arithmetic, and anything
 * else is not an answer — the caller gets the parent back and says so.
 *
 * @param {object} input
 * @param {Array<object>} input.children Today's parcels on the parent's ground.
 * @param {Array<object>} [input.built] Those that gained a building.
 * @param {Array<string>} [input.numbered] IDUs the BAL ties to the permit's number.
 * @returns {{feature: ?object, basis: string}}
 */
export function pickChild({ children, built = [], numbered = [] }) {
  const list = Array.isArray(children) ? children : [];
  if (!list.length) return { feature: null, basis: 'parent' };
  const byNumber = list.filter((child) => numbered.includes(child?.properties?.id));
  if (byNumber.length === 1) return { feature: byNumber[0], basis: 'numbered' };
  if (Array.isArray(built) && built.length === 1) return { feature: built[0], basis: 'built' };
  if (list.length === 1) return { feature: list[0], basis: 'sole' };
  return { feature: null, basis: 'parent' };
}

/**
 * Share one division between every permit that names its parent.
 *
 * {@link pickChild} answers for a single dossier; this answers for the FILE, and
 * the difference is a bug found in the browser rather than in a unit test. The
 * permis d'aménager that split AN 221 and the permis de construire that built
 * on it name the same parent, so resolving them one at a time put BOTH on the
 * lot that gained a house — and the drawing then claimed a subdivision of three
 * lots had happened inside one of them.
 *
 * Two rules, and neither is a heuristic:
 *
 * - **A permis d'aménager stays on the parent.** It is not a project on a lot,
 *   it is the act of DRAWING the lots; its perimeter is the parent by
 *   definition. Ustaritz's `06454720B0003` is exactly that — it created the
 *   very children this function is choosing between.
 * - **"The only lot that has been built on" is only an answer for one
 *   dossier.** When two dossiers on the same parent both want it, it identifies
 *   neither, and both fall back to the parent. Their own BAL numbers can still
 *   separate them, because that evidence is per-address rather than per-plot.
 *
 * @param {Array<{id: string, kind: ?string, numbered: Array<string>}>} entries
 *   The permits standing on one parent.
 * @param {{children: Array<object>, built?: Array<object>}} division
 * @returns {Map<string, {feature: ?object, basis: string}>} Keyed by permit id.
 */
export function assignDivision(entries, { children, built = [] }) {
  const out = new Map();
  const rows = Array.isArray(entries) ? entries : [];
  // A permis d'aménager never competes for a lot, so it is not counted when
  // deciding whether the building evidence identifies anybody.
  const claimants = rows.filter((row) => row.kind !== 'PA');
  for (const row of rows) {
    if (row.kind === 'PA') { out.set(row.id, { feature: null, basis: 'parent' }); continue; }
    out.set(row.id, pickChild({
      children,
      built: claimants.length === 1 ? built : [],
      numbered: row.numbered || [],
    }));
  }
  return out;
}

/**
 * Build one archived-snapshot URL.
 *
 * `latest` is a symlink and a dated edition is IMMUTABLE — which is the whole
 * caching argument for this module. The ADS commune editions next door expire
 * after a week because Sitadel republishes monthly; a snapshot named
 * `2021-04-01` is the same bytes forever and can be held indefinitely.
 *
 * @param {string} insee Commune code.
 * @param {string} millesime A date from {@link LINEAGE_MILLESIMES}, or `latest`.
 * @param {'parcelles'|'batiments'} [kind]
 * @returns {string}
 */
export function cadastreArchiveUrl(insee, millesime, kind = 'parcelles') {
  const code = String(insee).trim();
  const edition = String(millesime ?? 'latest').trim() || 'latest';
  return `${CADASTRE_ETALAB_BASE}/${edition}/geojson/communes/${code.slice(0, 2)}/${code}`
    + `/cadastre-${code}-${kind}.json.gz`;
}

/**
 * Read the dated editions out of Etalab's directory index.
 *
 * The index is HTML and this only ever takes `YYYY-MM-DD` out of it, so a
 * redesign of the page costs the discovery and not the module: an unparseable
 * index yields an empty list and the caller falls back to
 * {@link LINEAGE_MILLESIMES}.
 *
 * @param {string} html
 * @param {string} [floor] Editions at or after this date only.
 * @returns {Array<string>} Ascending, deduplicated.
 */
export function parseCadastreMillesimes(html, floor = LINEAGE_ARCHIVE_FLOOR) {
  const found = new Set();
  for (const match of String(html ?? '').matchAll(/(\d{4}-\d{2}-\d{2})/g)) {
    if (match[1] >= String(floor)) found.add(match[1]);
  }
  return [...found].sort();
}

/**
 * The snapshots to try for a permit, best first.
 *
 * The best snapshot is the newest one that still PRE-DATES the division, and
 * the division is not dated anywhere — so the ladder starts just before the
 * authorisation and walks backwards. On the case this was written from, the
 * permit was authorised 2021-07-20 and AN 221 survives in 2021-04-01 and not
 * in 2021-07-01: the first rung is the answer.
 *
 * Bounded, and the bound is a real cost. Each rung is a 676 KB download for
 * parcels and 239 KB for buildings, measured on Ustaritz; a permit from 2013
 * would otherwise walk all thirty editions to prove that its parcel died
 * before the archive began.
 *
 * @param {Array<string>} millesimes Available editions, ascending.
 * @param {?string} authorisedOn `YYYY-MM-DD`, the permit's decision date.
 * @param {number} [max] How many rungs to hand back.
 * @returns {Array<string>} Newest-first, at most `max`.
 */
export function millesimeLadder(millesimes, authorisedOn, max = 3) {
  const list = [...(millesimes || [])].sort();
  if (!list.length) return [];
  const date = String(authorisedOn ?? '').slice(0, 10);
  // No date is not a reason to guess an old edition: the newest snapshot has
  // the most parcels alive in it, so it is the likeliest to hold the parent.
  if (!date) return list.slice().reverse().slice(0, Math.max(1, max));
  const before = list.filter((edition) => edition <= date);
  // THE PERMIT PRE-DATES THE WHOLE ARCHIVE — 2013 to 2016, which is 161 of
  // Ustaritz's rows. The parcel was alive when the file was opened and died at
  // some later, unpublished date, so the only editions that can still hold it
  // are the OLDEST ones and the ladder climbs the other way. It recovers 6 of
  // those 161; the remaining 61 unplaceable rows are the archive floor being
  // the archive floor, and no ordering rescues them.
  if (!before.length) return list.slice(0, Math.max(1, max));
  return before.slice().reverse().slice(0, Math.max(1, max));
}
