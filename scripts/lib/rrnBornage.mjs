/**
 * Point-repère addresses on the French national road network, resolved to
 * coordinates against the State's own kilometre-post referential.
 *
 * WHY THIS EXISTS. Bison Futé's counting-station referential
 * (`QTV-DIR/refDir.csv`) publishes a Lambert-93 position for only some of its
 * stations. Measured on 2026-09-01: 843 rows of 1 368 carry `x_deb/y_deb`, and
 * 525 do not. But 153 of those 525 DO carry the address the French road
 * network actually uses — a POINT REPÈRE, the kilometre post, plus an
 * abscissa in metres past it — and every point repère of the non-conceded
 * network is published, with its Lambert-93 coordinates, in a separate open
 * dataset: `Bornage du réseau routier national`. Joining the two makes a whole
 * DIR appear that is invisible today: DIR Ouest publishes 115 stations, not
 * one of them with a coordinate, every one of them with a PR.
 *
 * The same key unlocks a second, larger set. The four Breton traffic centres
 * (Nantes, Rennes, Saint-Brieuc, Lorient–Vannes) publish TRAFICOLOR status
 * under site identifiers that appear in NO referential row — which is why they
 * are dark today — but those identifiers are THEMSELVES point-repère
 * addresses: `35A0084T096_00D` is département 35, route A0084, PR 96,
 * abscissa 0, right-hand carriageway. 597 of the 619 ids those four feeds
 * published on 2026-09-01 land on a borne of the national referential.
 *
 * ── THE JOIN IS CALIBRATED, NOT ASSUMED ─────────────────────────────────────
 *
 * 829 stations publish BOTH a PR address and a coordinate, so the join can be
 * checked against the publisher's own answer rather than believed. Resolving
 * their PR to its borne and comparing (2026-09-01, bornes-2025):
 *
 *     p50 3.9 m   p90 7.4 m   p99 21.5 m   max 64.3 m
 *
 * That is not "close enough": it is the same point. The DIRs derive the
 * coordinates they publish from this very referential.
 *
 * AND THE ABSCISSA IS DELIBERATELY NOT APPLIED to referential rows. Adding it
 * — interpolating `abscisse_debut` metres past the borne toward the next one —
 * makes the SAME comparison p50 401 m, p90 851 m. The DIRs snap their own
 * published coordinate to the borne and drop the abscissa; reproducing that is
 * what keeps a station joined here indistinguishable from its neighbour that
 * came straight out of `x_deb`. See {@link locateBorne}'s `abscisseM` option:
 * the traficolor ids DO need it, because there 133 pairs of distinct sites
 * differ by nothing else.
 *
 * ── WHAT IS NOT RECOVERED, AND WHY ──────────────────────────────────────────
 *
 * DIR Nord (163 stations, Lille — the largest dark block) publishes rows with
 * every field empty but the identifier, and that identifier is NOT a PR
 * address. Two readings were tested against the bornage: taking three digits
 * as the PR matches 24 % of the ids, taking two matches 75 % — but the
 * two-digit reading places A1 stations at PR 12–30, which is département 95,
 * inside Île-de-France and 150 km outside DIR Nord's territory. A grammar that
 * has to put a sensor in the wrong region to fit is not the grammar. Lille
 * stays dark. DIR Est (Nancy–Metz) publishes opaque operator codes
 * (`MZE54.11`) and referential rows with no PR at all; nothing to join.
 *
 * Source:   https://www.data.gouv.fr/datasets/bornage-du-reseau-routier-national
 * Licence:  Licence Ouverte 2.0 — the same as the Bison Futé publications it
 *           is joined to, so the join adds no obligation the layer did not
 *           already carry.
 *
 * @module scripts/lib/rrnBornage
 */

/** data.gouv.fr landing page, for the attribution surface. */
export const BORNAGE_DATASET_PAGE = 'https://www.data.gouv.fr/datasets/bornage-du-reseau-routier-national';

/**
 * The 2025 edition, pinned.
 *
 * Pinned rather than resolved through the data.gouv.fr API on every build
 * because the geometry this feeds is COMMITTED: a build that silently picked
 * up a new edition would move stations in a diff that says nothing about why.
 * Bumping the year is a deliberate one-line change with a visible diff.
 */
export const BORNAGE_CSV_URL = 'https://static.data.gouv.fr/resources/bornage-du-reseau-routier-national/20250722-112543/bornes-2025.csv';

/** Edition of the referential the URL above points at. */
export const BORNAGE_EDITION = '2025-07-22';

/** Licence of the bornage dataset, as declared on data.gouv.fr (`fr-lo`). */
export const BORNAGE_LICENCE = 'Licence Ouverte 2.0';

/**
 * Columns of `bornes-YYYY.csv`, in order.
 *
 * Unlike `refDir.csv` this file honours its own header — 51 940 rows, all
 * eleven fields, measured 2026-09-01 — so the parser zips against this list
 * and rejects any row that does not match its length.
 */
export const BORNAGE_COLUMNS = Object.freeze([
  'dateReferentiel', 'route', 'pr', 'depPr', 'concessionPr',
  'abs', 'cumul', 'x', 'y', 'z', 'cote',
]);

/**
 * Carriageway sides a borne is published for.
 *
 * `D`/`G` are the two carriageways of a dual road, `I` the single borne of a
 * road that has only one. The two sides of a motorway are ~10 m apart — PR 91
 * of the A28 is (569 978, 6 938 140) on D and (569 985, 6 938 133) on G — so
 * picking the wrong side costs a car's length, not a position. Which is why
 * {@link locateBorne} falls back across them rather than refusing.
 */
export const BORNE_SIDES = Object.freeze(['D', 'G', 'I']);

const FIELD_COUNT = BORNAGE_COLUMNS.length;

/**
 * French decimal comma → number, or null. The file writes `874095,04`.
 *
 * An EMPTY cell is null and not zero. `Number('')` is 0, and a post at
 * easting 0 is a post in the Gulf of Guinea that the area-of-use gate would
 * later throw away — after it had already displaced the real candidate for
 * that address.
 */
function decimalComma(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/**
 * One spelling of a département code, so the two files can be compared.
 *
 * The bornage writes `depPr` UNPADDED — `1`, `2`, `9`, and `973` for Guyane —
 * while the point-repère addresses in `refDir.csv` and in the traficolor
 * identifiers are zero-padded to two (`76PR91D`). Nothing in today's data
 * exercises the difference, because no DIR that publishes an address happens
 * to sit in départements 01–09; the day one does, an unnormalised comparison
 * would drop it silently, which is the worst way for this to fail.
 *
 * Corsica keeps its letters, and has no post in this referential at all: the
 * island's roads are the collectivité's, not the State's.
 *
 * @param {?string} code
 * @returns {?string}
 */
export function normaliseDepartement(code) {
  if (typeof code !== 'string') return null;
  const text = code.trim().toUpperCase();
  if (!text) return null;
  if (/^2[AB]$/.test(text)) return text;
  return /^\d{1,3}$/.test(text) ? String(Number(text)) : null;
}

/**
 * Canonical route code, in the form the bornage uses.
 *
 * The bornage names routes `A0028`, `N0165` — a letter and four padded digits.
 * The Bison Futé referential names the same roads eight different ways
 * depending on which DIR filled the row in: `A28` (DIRNO), `A0084` (DIRO),
 * `N88` (DIRMC), `A0043` (DIRCE). Normalising is the whole of the road half of
 * the join.
 *
 * Returns null for anything that is not a plain numbered route — `A22TC`,
 * `DB1`, an empty axis — because the bornage's own codes for ramps and links
 * (`01A803903CD`, `02N900201`) are not derivable from those strings, and a
 * ramp guessed onto the wrong mainline is a segment drawn across a field.
 *
 * @param {?string} axis Route as the publisher wrote it.
 * @returns {?string} `A0028`, or null if the string is not a numbered route.
 */
export function normaliseRouteCode(axis) {
  if (typeof axis !== 'string') return null;
  const match = /^([ANDMP])\s*0*(\d{1,4})$/i.exec(axis.trim());
  if (!match) return null;
  return `${match[1].toUpperCase()}${match[2].padStart(4, '0')}`;
}

/**
 * Parse a `pr_debut` / `pr_fin` cell of `refDir.csv`.
 *
 * Four shapes are in the live file (2026-09-01), and they are not variations
 * on a theme — they are four DIRs each writing the same address in their own
 * house style:
 *
 *   `76PR91D`    département, PR, carriageway              — DIRNO, DIRMED, DIRMC, DIRCO
 *   `31PR230DC`  the same, plus a concession flag          — DIRSO
 *   `86PR50U`    the same, with an unknown side letter     — DIRCO, 2 rows
 *   `39`         the bare PR, no département, no side      — DIRO, DIRE, DIRCE
 *
 * and two shapes that are NOT addresses and must not be forced into one:
 * `DB1`/`FB2` (début/fin de bretelle) and `DRD`/`DRG`, which name a ramp, not
 * a post. Those return null and are counted by the caller as unjoinable.
 *
 * @param {?string} raw Cell contents.
 * @returns {?{dep: ?string, pr: number, side: ?string}}
 */
export function parsePrAddress(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().toUpperCase();
  if (!text) return null;
  // `2A`/`2B` are Corsica's département codes; the rest are two digits.
  const full = /^(\d{2}|2[AB])PR(\d{1,4})([A-Z])?[CN]?$/.exec(text);
  if (full) {
    const side = full[3] && BORNE_SIDES.includes(full[3]) ? full[3] : null;
    return { dep: normaliseDepartement(full[1]), pr: Number(full[2]), side };
  }
  const bare = /^(\d{1,4})$/.exec(text);
  if (bare) return { dep: null, pr: Number(bare[1]), side: null };
  return null;
}

/**
 * Parse a Breton TRAFICOLOR site identifier.
 *
 * `35A0084T096_00D` = département 35, route A0084, `T`, PR 096, `_`, abscissa
 * in HECTOMETRES, carriageway D. The abscissa is two digits and runs 00–13 in
 * the live feeds, so it is not a fraction of a PR interval but a distance:
 * 13 → 1 300 m past the post. It matters — 133 pairs of sites in those feeds
 * share a département, route, PR and side and differ ONLY in this field, so
 * dropping it would draw 266 sensors on 133 points.
 *
 * Anything else returns null: the feeds also carry their own name as an id
 * (`TraficStBrieuc`), a handful of ids with the abscissa field empty, and
 * département roads (`44D0723T036_04G`) which the national bornage does not
 * cover by definition.
 *
 * @param {?string} id Site identifier as published.
 * @returns {?{dep: string, route: string, pr: number, abscisseM: number, side: string}}
 */
export function parseTraficolorSiteId(id) {
  if (typeof id !== 'string') return null;
  const match = /^(\d{2}[AB]?)([ANDMP]\d{4})T(\d{1,4})_(\d{1,2})([DGI])$/.exec(id.trim().toUpperCase());
  if (!match) return null;
  return {
    dep: normaliseDepartement(match[1]),
    route: match[2],
    pr: Number(match[3]),
    abscisseM: Number(match[4]) * 100,
    side: match[5],
  };
}

/**
 * The département a Bison Futé station identifier names, if it names one.
 *
 * Not a documented field — a REGULARITY, measured before it was used. Station
 * identifiers are the operators' own codes (`MWO56.J1`, `MUM76.h1`,
 * `MB233.Z1`) and the last two digits before the dot are, in 799 of the 801
 * rows that also publish a full `76PR91D`-style address, exactly the
 * département that address declares (2026-09-01). The two exceptions are the
 * same sensor pair on the A47 at the Loire/Rhône boundary — a station a few
 * hundred metres from a line, filed on one side by its operator and on the
 * other by its post.
 *
 * So this is used for ONE thing and nothing else: breaking a tie between
 * bornes that a bare PR matches in several départements, in
 * {@link locateBorne}'s `depHint`. It never places a station on its own — a
 * hint naming a département the bornage does not offer for that PR is
 * discarded, not trusted.
 *
 * @param {?string} id Station or site identifier.
 * @returns {?string} Two-character département code, or null.
 */
export function departementFromSiteId(id) {
  if (typeof id !== 'string') return null;
  const stem = id.split('.')[0];
  const match = /(\d{2}|2[AaBb])$/.exec(stem);
  return match ? normaliseDepartement(match[1]) : null;
}

/**
 * Parse `bornes-YYYY.csv` into kilometre posts, in Lambert-93 metres.
 *
 * Reprojection is not done here for the same reason it is not done in
 * `datexRoadStatus.js`: this file is joined to another file of metres, and
 * comparing the two in their own projection is exact, whereas comparing them
 * in degrees is a cosine away from being exact. The build script projects once
 * at the end.
 *
 * @param {string} csv File body.
 * @returns {{bornes: Array<object>, rows: number, skipped: number, headerColumns: number}}
 */
export function parseBornage(csv) {
  const out = {
    bornes: [], rows: 0, skipped: 0, headerColumns: 0,
  };
  if (typeof csv !== 'string' || !csv) return out;
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/);
  out.headerColumns = (lines[0] || '').split(';').length;
  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    out.rows += 1;
    const fields = lines[i].split(';');
    if (fields.length !== FIELD_COUNT) { out.skipped += 1; continue; }
    const pr = Number(fields[2]);
    const x = decimalComma(fields[7]);
    const y = decimalComma(fields[8]);
    const cumul = decimalComma(fields[6]);
    const route = fields[1].trim();
    if (!route || !Number.isFinite(pr) || x === null || y === null) { out.skipped += 1; continue; }
    out.bornes.push({
      route,
      pr,
      dep: normaliseDepartement(fields[3]),
      conceded: fields[4].trim() === 'C',
      cumul: cumul ?? 0,
      x,
      y,
      side: fields[10].trim() || 'I',
    });
  }
  return out;
}

/**
 * Index bornes for the two lookups the join needs.
 *
 * `exact` answers "where is PR 91 of the A28 in 76, right-hand side", the
 * question a full address asks. `byRoutePr` answers the partial one a bare PR
 * asks, and keeps EVERY candidate rather than the first: a route's PR
 * numbering restarts at a département boundary — the A1 has a PR 12 in 93 and
 * another in 95 — so a bare PR on such a route is genuinely ambiguous and
 * {@link locateBorne} must be able to see that and refuse.
 *
 * `lines` is the route ordered by cumulative distance, which is what an
 * abscissa is measured along. It is keyed by route and side only, NOT by
 * département: `cumul` is continuous across the whole route, so partitioning
 * by département would make the last post of each département have no
 * successor and silently drop its abscissa.
 *
 * @param {Array<object>} bornes As returned by {@link parseBornage}.
 * @returns {{exact: Map, byRoutePr: Map, lines: Map, size: number}}
 */
export function buildBornageIndex(bornes) {
  const exact = new Map();
  const byRoutePr = new Map();
  const lines = new Map();
  for (const borne of bornes) {
    const key = `${borne.route}|${borne.dep}|${borne.pr}|${borne.side}`;
    if (!exact.has(key)) exact.set(key, borne);
    const partial = `${borne.route}|${borne.pr}`;
    if (!byRoutePr.has(partial)) byRoutePr.set(partial, []);
    byRoutePr.get(partial).push(borne);
    const line = `${borne.route}|${borne.side}`;
    if (!lines.has(line)) lines.set(line, []);
    lines.get(line).push(borne);
  }
  for (const arr of lines.values()) arr.sort((a, b) => a.cumul - b.cumul);
  return {
    exact, byRoutePr, lines, size: bornes.length,
  };
}

/**
 * How far from a post a point may be and still count as being on that road.
 *
 * A station's published position sits a median 4 m from its post, so 150 m is
 * two orders of magnitude of slack — it is there to reject a station whose
 * `axe` names a road its coordinates are nowhere near (one exists: `MBG33.M4`
 * calls itself N230 and publishes an end 428 m from the nearest N230 post),
 * not to tolerate ordinary error.
 */
export const ROAD_SNAP_MAX_M = 150;

/**
 * How much longer than the straight line the road may run before the two ends
 * are assumed not to be neighbours.
 *
 * A 90° curve is 1.57× its chord and a hairpin more, so three is generous. It
 * exists for the ring road: a station whose two ends sit either side of the
 * A630's closing point has a short chord and 45 km of tarmac between them
 * measured the long way round, and drawing that would wrap the whole city.
 */
export const ROAD_DETOUR_FACTOR = 3;

/** Most intermediate posts one segment may gain. */
export const ROAD_MAX_SHAPE_POINTS = 64;

/** The post nearest a point, on one carriageway or on any of them. */
function nearestBorne(index, route, side, x, y) {
  let best = Infinity;
  let hit = null;
  for (const candidate of side ? [side] : BORNE_SIDES) {
    for (const borne of index.lines.get(`${route}|${candidate}`) || []) {
      const distance = Math.hypot(borne.x - x, borne.y - y);
      if (distance < best) { best = distance; hit = borne; }
    }
  }
  return hit ? { distance: best, borne: hit } : null;
}

/**
 * The kilometre posts lying between two points of the same road, in order.
 *
 * WHY THIS EXISTS. A counting station publishes two endpoints and nothing in
 * between, so the layer drew every one of them as a STRAIGHT LINE. For four
 * segments in five that is invisible — the median station is 979 m long and
 * the road is straight over that distance. For the fifth it is not: measured
 * 2026-09-01 against the bornage, 162 of 823 segments strayed more than 25 m
 * from the tarmac they claim to be on, 86 by more than 200 m, and the worst
 * cut 1.5 km across the Massif Central because the A75 turns and the chord
 * does not. Threading the posts between the two ends drops that to five
 * segments over 25 m, for 369 extra vertices in the committed file.
 *
 * It is not interpolation and it invents nothing: every intermediate point is
 * a surveyed kilometre post of that exact road, published with its own
 * coordinates. What it adds is the ORDER they come in.
 *
 * Returns an empty list — never a guess — when the two ends are not both on
 * the road they name, when the road between them runs improbably longer than
 * the straight line (the ring-road case), or when there is simply no post in
 * between, which is the common case and the one that needs no help.
 *
 * @param {object} index From {@link buildBornageIndex}.
 * @param {?string} route Canonical route code.
 * @param {{x: number, y: number}} start Lambert-93 metres.
 * @param {{x: number, y: number}} end Lambert-93 metres.
 * @returns {{posts: Array<object>, reason: ?string}}
 */
export function bornesBetween(index, route, start, end) {
  const none = (reason) => ({ posts: [], reason });
  if (!index || !route || !start || !end) return none('no input');
  const from = nearestBorne(index, route, null, start.x, start.y);
  if (!from || from.distance > ROAD_SNAP_MAX_M) return none('start is not on this road');
  // The end is snapped to the SAME carriageway as the start: the two sides of
  // a motorway are separate polylines, and mixing them makes a segment zigzag
  // across the central reservation.
  const to = nearestBorne(index, route, from.borne.side, end.x, end.y);
  if (!to || to.distance > ROAD_SNAP_MAX_M) return none('end is not on that carriageway');
  const low = Math.min(from.borne.cumul, to.borne.cumul);
  const high = Math.max(from.borne.cumul, to.borne.cumul);
  const chord = Math.hypot(end.x - start.x, end.y - start.y);
  if (high - low > ROAD_DETOUR_FACTOR * chord + 500) return none('the road wraps between these ends');
  const line = index.lines.get(`${route}|${from.borne.side}`) || [];
  const between = line.filter((borne) => borne.cumul > low && borne.cumul < high);
  if (!between.length) return none('no post in between');
  if (between.length > ROAD_MAX_SHAPE_POINTS) return none('too many posts');
  return {
    posts: from.borne.cumul > to.borne.cumul ? between.reverse() : between,
    reason: null,
  };
}

/** The borne that follows `borne` along its own carriageway, or null. */
function nextBorne(index, borne) {
  const line = index.lines.get(`${borne.route}|${borne.side}`);
  if (!line) return null;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== borne) continue;
    for (let j = i + 1; j < line.length; j += 1) {
      if (line[j].cumul > borne.cumul) return line[j];
    }
    return null;
  }
  return null;
}

/**
 * Resolve a point-repère address to Lambert-93 metres.
 *
 * Resolution is ordered from the most specific key to the least, and every
 * relaxation is REPORTED rather than absorbed, so the build can count how many
 * of its positions rest on a full address and how many on a fallback:
 *
 *   1. route + département + PR + side — the address as written.
 *   2. the same PR on the other carriageway, ~10 m away (`sideFallback`).
 *   3. a bare PR that resolves to exactly one département (`depInferred`).
 *   4. a bare PR resolving to several, narrowed by `depHint` — the département
 *      the site's own identifier names (`depFromHint`).
 *
 * A bare PR that resolves to several départements with no usable hint returns
 * null. Guessing which end of a road a sensor is on is how a counting station
 * ends up 439 km from the traffic it counts, which is the actual spread of the
 * five posts the N12 has at PR 56.
 *
 * With `abscisseM`, the answer is interpolated that many metres along the
 * chord to the next post on the same carriageway, clamped at that post: an
 * abscissa longer than its own PR interval means the address and the
 * referential disagree about where the interval ends, and walking past the
 * next post would land the site on the wrong side of a junction.
 *
 * @param {object} index From {@link buildBornageIndex}.
 * @param {{dep: ?string, route: string, pr: number, side: ?string}} address
 * @param {{abscisseM?: number, depHint?: ?string}} [options]
 * @returns {?{x: number, y: number, side: string, dep: string, sideFallback: boolean,
 *   depInferred: boolean, depFromHint: boolean, interpolated: boolean,
 *   clamped: boolean, reason: ?string}}
 */
export function locateBorne(index, address, options = {}) {
  if (!index || !address || !address.route || !Number.isFinite(address.pr)) return null;
  const { route, pr } = address;
  const wanted = address.side && BORNE_SIDES.includes(address.side) ? address.side : null;
  let borne = null;
  let sideFallback = false;
  let depInferred = false;

  let depFromHint = false;

  const dep = normaliseDepartement(address.dep);
  if (dep) {
    const order = wanted ? [wanted, ...BORNE_SIDES.filter((s) => s !== wanted)] : BORNE_SIDES;
    for (const side of order) {
      const hit = index.exact.get(`${route}|${dep}|${pr}|${side}`);
      if (hit) { borne = hit; sideFallback = Boolean(wanted) && side !== wanted; break; }
    }
    if (!borne) return null;
  } else {
    let candidates = index.byRoutePr.get(`${route}|${pr}`) || [];
    if (!candidates.length) return null;
    if (new Set(candidates.map((c) => c.dep)).size > 1) {
      // A route's PR numbering restarts at each département, so a bare PR on
      // the N12 matches five posts 439 km apart. The identifier's own
      // département breaks that tie or nothing does.
      const hint = normaliseDepartement(options.depHint);
      if (!hint) return null;
      const narrowed = candidates.filter((c) => c.dep === hint);
      if (!narrowed.length) return null;
      candidates = narrowed;
      depFromHint = true;
    }
    depInferred = true;
    const preferred = wanted ? candidates.filter((c) => c.side === wanted) : [];
    borne = preferred[0] || candidates[0];
    sideFallback = Boolean(wanted) && borne.side !== wanted;
  }
  if (!borne) return null;

  const result = {
    x: borne.x,
    y: borne.y,
    side: borne.side,
    dep: borne.dep,
    sideFallback,
    depInferred,
    depFromHint,
    interpolated: false,
    clamped: false,
    reason: null,
  };

  const abscisseM = Number(options.abscisseM) || 0;
  if (abscisseM <= 0) return result;
  const next = nextBorne(index, borne);
  if (!next) { result.reason = 'no-next-borne'; return result; }
  const span = next.cumul - borne.cumul;
  if (!(span > 0)) { result.reason = 'no-next-borne'; return result; }
  const fraction = Math.min(1, abscisseM / span);
  result.x = borne.x + (next.x - borne.x) * fraction;
  result.y = borne.y + (next.y - borne.y) * fraction;
  result.interpolated = true;
  result.clamped = abscisseM > span;
  return result;
}
