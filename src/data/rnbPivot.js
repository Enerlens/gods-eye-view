// src/data/rnbPivot.js — the Référentiel National des Bâtiments as the pivot
// of the address lot.
//
// WHAT THIS SOURCE IS. The RNB is the state's building identity register: one
// stable twelve-character identifier per building in France, published with the
// BAN addresses that building answers to, the cadastral parcels it stands on,
// and the identifiers the other registers know it by. It is keyless, CORS-open,
// Licence Ouverte 2.0, and it answers in ~170 ms.
//
// WHY IT MATTERS HERE, AND IT IS NOT ABOUT DRAWING ANYTHING. Every layer in the
// address lot answers a question about a BUILDING and is joined to one by a
// GEOCODED DOT — a DPE, a sale, a permit lands on whichever footprint its
// coordinate happens to fall inside. `buildingTheme.js` says so in its own
// header: the point-in-polygon grid, the smaller-footprint rule, the half-open
// edge. All of that is careful arithmetic on a guess. The RNB replaces the
// guess with a published key, and the BD TOPO tiles this repository already
// draws CARRY THAT KEY: `identifiants_rnb`, slash-separated, on 95.5 % to
// 99.2 % of the footprints measured below.
//
// ── The pivot is calibrated, not trusted ───────────────────────────────────
//
// The RNB names BD TOPO back. Measured 2026-09-07 over the Lyon 2e box
// (4.8200,45.7530 → 4.8320,45.7610), 600 RNB buildings against the four z15
// BD TOPO tiles the layer would load for the same view:
//
//   RNB buildings carrying a `bdtopo` ext_id      574 of 600   (95.7 %)
//   … whose cleabs matches the tile that carries
//     the same RNB id under `identifiants_rnb`    573 of 573  (100.00 %)
//   … RNB id absent from the drawn tiles            1
//
// Zero disagreements. The two registers name each other, which is what makes
// this an identity join and not a heuristic — and it is re-measured by
// `scripts/qa-rnb-pivot.mjs` rather than asserted here, because an edition that
// stopped agreeing has to move a number in a harness before it moves a colour
// on screen.
//
// ── What the pivot buys, measured on the first consumer ────────────────────
//
// The ADEME DPE register publishes `id_rnb` (provenance `Reprise RNB`, or
// `Logiciel` when the diagnostician's software declared it). Joining
// diagnostics to volumes by that identifier instead of by their BAN geocode,
// over four boxes on 2026-09-07 — every diagnostic the box holds, against every
// footprint the layer would draw:
//
//                 footprints   DPE rows   with       joined by    joined by
//                 with RNB     in box     id_rnb     the dot      the id first
//   Paris 13e       95.5 %       2 509     73.7 %     81.8 %        96.3 %
//   Lyon 2e         99.2 %       4 701     60.8 %     40.4 %        75.7 %
//   Marseille       99.2 %       5 000     58.8 %     78.8 %        88.9 %
//   Ustaritz        97.1 %         357     34.5 %     14.0 %        41.5 %
//
// The gain is not marginal and it is not uniform: Lyon nearly doubles because
// its BAN geocodes land in the street, Ustaritz stays low because a rural
// register is thin on both sides. Of the diagnostics the two methods BOTH
// place, they disagree on 2 (Paris), 4 (Lyon), 83 (Marseille) and 4 (Ustaritz)
// — buildings painted with a neighbour's letter today.
//
// ── The three shapes that break a naive index ──────────────────────────────
//
// 1. **One footprint, several RNB ids.** `identifiants_rnb` is a SLASH-joined
//    list: 65 of 2 395 Paris polygons carry 2, 3 or 5. A BD TOPO polygon that
//    merges what the RNB splits must answer to every one of them, so the index
//    maps id → footprints and any of a polygon's ids claims it.
//
// 2. **One RNB id, several footprints.** A building cut across two tiles is
//    drawn twice — `bdtopoBuildingsFeed.js` trap 4 — and both halves carry the
//    same `cleabs` AND the same RNB id: 239 of the 2 062 distinct Paris ids
//    name more than one drawn polygon. A point joined by identity must colour
//    ALL of them, or a building is painted down the middle. It is still ONE
//    matched point, which is why the counter increments once and the bucket is
//    appended to several times.
//
// 3. **An identifier that names nothing on screen.** A diagnostic can carry an
//    RNB id for a building outside the loaded viewport, or one BD TOPO has not
//    picked up: 26 of 1 849 in Paris, 2 of 2 858 in Lyon, 0 elsewhere. That is
//    not a match and not a failure — it is counted separately (`idOffScreen`)
//    and then offered to the geometric join like any other point.
//
// ── What this module does NOT do ───────────────────────────────────────────
//
// It does not fetch in bulk. The identity join needs no network at all: the key
// is already on the tile and already on the register's row. The only call this
// module builds is the ONE lookup a selected building makes to learn its own
// addresses and parcels — `rnbBuildingUrl` — and `bdtopoBuildings.js` makes it
// straight from the browser, with no proxy, for the same reason it reads the
// tiles that way: keyless, CORS-open, one request per click, and a proxy would
// add a cache in front of an answer that changes on the register's cadence and
// not on the operator's.
//
// It also does not yet own the parcel join. `cadastreParcelDetail.js` trap 2
// says "the join is geometric, and nobody publishes it" — the RNB now does,
// through `plots`, and that module is the named next consumer of this one.
//
// And it does NOT bring DVF or the permits along, which is a property of those
// sources and not an omission here. The geolocated DVF file publishes 40
// columns and none of them is an RNB identifier (checked on the 2024 edition of
// 75113): its key to the ground is `id_parcelle`, so a sale reaches a building
// only through `plots`, and there is no bulk endpoint for that — one call per
// parcel, at 50 to 150 parcels per 300 m scan. That makes the DVF pivot a
// per-SELECTION operation like the card below, not a per-viewport theme, and
// wiring it as the latter would trade a wrong colour for a rate limit.
//
// Dependency-free and side-effect-free: no Cesium, no DOM, no fetch.

/** RNB API root. Keyless, CORS-open (`access-control-allow-origin: *`). */
export const RNB_API_BASE = 'https://rnb-api.beta.gouv.fr/api/alpha';

/**
 * Ceiling the `closest` endpoint enforces itself, in metres.
 *
 * Asking for more is HTTP 400 `{"radius":["Le rayon doit être inférieur à 1000
 * mètres"]}`, so the clamp is here rather than discovered in production.
 */
export const RNB_CLOSEST_MAX_RADIUS_M = 1000;

/**
 * Radius the selection card asks for when a footprint carries no identifier.
 *
 * 25 m, not 1 000: this is a fallback for a polygon BD TOPO published without
 * `identifiants_rnb` (4.5 % of Paris, 0.8 % of Lyon), and the honest answer at
 * that point is "the building whose own point is inside or beside this one".
 * A wide search would return a confident neighbour, which on a card whose
 * subject IS the identity of one building is worse than no line at all.
 */
export const RNB_CLOSEST_FALLBACK_RADIUS_M = 25;

/** The separator BD TOPO joins several identifiers with. */
const RNB_ID_SEPARATOR = '/';

/**
 * The identifiers a BD TOPO `identifiants_rnb` value carries.
 *
 * Returns an ARRAY, always, including for the single-identifier case that is
 * 92.8 % of Paris. The alternative — a string that is sometimes a list — is how
 * `bdtopoBuildings.js` came to print `String(props.identifiants_rnb).split('/')
 * [0]` on the card and silently drop the other four ids of a merged polygon.
 *
 * BD TOPO emits empty strings for absent identifier columns
 * (`bdtopoBuildingsFeed.js`, `finiteOrNull`), so the empty and whitespace cases
 * are the normal ones and not a defensive flourish.
 *
 * @param {unknown} value Raw `identifiants_rnb`.
 * @returns {Array<string>} Zero or more identifiers, in published order.
 */
export function parseRnbIds(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return [];
  return String(value)
    .split(RNB_ID_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * The identifier a card prints when it has to print one.
 * @param {unknown} value Raw `identifiants_rnb`, or an array of ids.
 * @returns {?string}
 */
export function primaryRnbId(value) {
  const ids = Array.isArray(value) ? value.filter(Boolean).map(String) : parseRnbIds(value);
  return ids.length ? ids[0] : null;
}

/**
 * One building's full record: addresses, parcels and the identifiers the other
 * registers know it by.
 *
 * `withPlots` is not free on the server side and is not always wanted — the
 * selection card asks for it, a bare identity check does not.
 *
 * @param {string} rnbId
 * @param {{withPlots?: boolean}} [options]
 * @returns {string}
 */
export function rnbBuildingUrl(rnbId, { withPlots = true } = {}) {
  const id = encodeURIComponent(String(rnbId || '').trim());
  return `${RNB_API_BASE}/buildings/${id}/${withPlots ? '?withPlots=1' : ''}`;
}

/**
 * The buildings nearest a point.
 *
 * THE POINT IS `lat,lon`. The bbox filter on the same API is
 * `min_lon,min_lat,max_lon,max_lat` — the opposite order, in the same query
 * string family. Both are built here so the inversion is handled once, the way
 * `dpeFeed.js` handles ADEME's `geo_distance`/`_geopoint` inversion.
 *
 * `withPlots` is NOT honoured by this endpoint — measured: the parameter is
 * accepted and no `plots` key comes back — so a caller that needs parcels
 * resolves the identifier first and then asks {@link rnbBuildingUrl}.
 *
 * @param {{lat: number, lon: number, radiusM?: number}} query
 * @returns {?string} null when the coordinate is not usable.
 */
export function rnbClosestUrl({ lat, lon, radiusM = RNB_CLOSEST_FALLBACK_RADIUS_M } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const radius = Math.min(RNB_CLOSEST_MAX_RADIUS_M, Math.max(1, Math.round(radiusM)));
  return `${RNB_API_BASE}/buildings/closest/?point=${lat},${lon}&radius=${radius}`;
}

/**
 * Every building the RNB knows at one BAN address key (`cle_interop`).
 *
 * The direction the address lot will need when the pivot runs the other way —
 * from a typed address to the volumes that answer to it.
 * @param {string} cleInterop
 * @returns {?string}
 */
export function rnbAddressUrl(cleInterop) {
  const key = String(cleInterop || '').trim();
  if (!key) return null;
  return `${RNB_API_BASE}/buildings/?cle_interop_ban=${encodeURIComponent(key)}`;
}

/**
 * Every building standing on one cadastral parcel.
 * @param {string} plotId A 14-character parcel id, e.g. `69385000AK0022`.
 * @returns {?string}
 */
export function rnbPlotUrl(plotId) {
  const id = String(plotId || '').trim();
  if (!id) return null;
  return `${RNB_API_BASE}/buildings/plot/${encodeURIComponent(id)}/`;
}

/**
 * The statuses the register publishes, and whether the building is standing.
 *
 * `constructed` is the whole of the Lyon sample; the others exist and a card
 * that met one and printed nothing would be claiming the building is ordinary.
 */
export const RNB_STATUS_LABELS = Object.freeze({
  constructed: 'construit',
  notUsable: 'non exploitable',
  demolished: 'démoli',
  constructionProject: 'projet de construction',
  canceledConstructionProject: 'projet de construction annulé',
  ongoingConstruction: 'construction en cours',
  ongoingChange: 'modification en cours',
  demolitionProject: 'projet de démolition',
});

/**
 * One address as the register publishes it, and as a card reads it.
 * @param {object} raw An entry of `addresses[]`.
 * @returns {?object}
 */
export function projectRnbAddress(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const number = String(raw.street_number ?? '').trim();
  const rep = String(raw.street_rep ?? '').trim();
  const street = String(raw.street ?? '').trim();
  const zip = String(raw.city_zipcode ?? '').trim();
  const city = String(raw.city_name ?? '').trim();
  const label = [
    [number, rep].filter(Boolean).join(' '),
    street,
    [zip, city].filter(Boolean).join(' '),
  ].filter(Boolean).join(' ');
  if (!label) return null;
  return {
    // `id` is the BAN `cle_interop`; `ban_id` is the BAN's own UUID and is
    // frequently null, so the interop key is what a join may be built on.
    cleInterop: String(raw.id ?? '').trim() || null,
    banId: String(raw.ban_id ?? '').trim() || null,
    source: String(raw.source ?? '').trim() || null,
    number: number || null,
    street: street || null,
    city: city || null,
    postcode: zip || null,
    insee: String(raw.city_insee_code ?? '').trim() || null,
    label,
  };
}

/**
 * A parcel the building stands on, with how much of the FOOTPRINT it covers.
 *
 * `bdg_cover_ratio` is the share of the building on that parcel, not the share
 * of the parcel under the building — measured on `A9WW4M44SF9W`, which straddles
 * two Lyon parcels at 0.990 and 0.0099, summing to one. A card that read it the
 * other way would report a 4 000 m² parcel as 1 % built.
 *
 * @param {object} raw An entry of `plots[]`.
 * @returns {?object}
 */
export function projectRnbPlot(raw) {
  const id = String(raw?.id ?? '').trim();
  if (!id) return null;
  const ratio = Number(raw?.bdg_cover_ratio);
  return { id, coverRatio: Number.isFinite(ratio) ? ratio : null };
}

/**
 * The register's answer for one building, in this repository's vocabulary.
 *
 * @param {object} body A `/buildings/{id}/` response, or one `results[]` entry.
 * @returns {?object} null when the body carries no identifier.
 */
export function projectRnbBuilding(body) {
  const rnbId = String(body?.rnb_id ?? '').trim();
  if (!rnbId) return null;

  const addresses = (Array.isArray(body.addresses) ? body.addresses : [])
    .map(projectRnbAddress).filter(Boolean);
  const plots = (Array.isArray(body.plots) ? body.plots : [])
    .map(projectRnbPlot).filter(Boolean)
    // Largest share of the building first: the parcel a card names when it has
    // room for one is the one the building is actually on.
    .sort((a, b) => (b.coverRatio ?? 0) - (a.coverRatio ?? 0));
  const extIds = (Array.isArray(body.ext_ids) ? body.ext_ids : [])
    .map((entry) => ({
      source: String(entry?.source ?? '').trim() || null,
      id: String(entry?.id ?? '').trim() || null,
      version: String(entry?.source_version ?? '').trim() || null,
    }))
    .filter((entry) => entry.source && entry.id);

  const status = String(body.status ?? '').trim() || null;
  const point = Array.isArray(body.point?.coordinates) ? body.point.coordinates : null;
  return {
    rnbId,
    status,
    statusLabel: status ? (RNB_STATUS_LABELS[status] || status) : null,
    // `is_active` is absent from the `closest` and bbox shapes and present on
    // the single-building one. Absent is not "inactive".
    isActive: typeof body.is_active === 'boolean' ? body.is_active : null,
    lon: Number.isFinite(point?.[0]) ? point[0] : null,
    lat: Number.isFinite(point?.[1]) ? point[1] : null,
    // Metres, and only on the `closest` shape. It is what tells a card whether
    // the building it found is the one under the cursor.
    distanceM: Number.isFinite(Number(body.distance)) ? Number(body.distance) : null,
    addresses,
    plots,
    extIds,
    // The identifier the drawn tile knows this building by. 95.7 % of the Lyon
    // sample carry one, and it is what closes the loop back to `cleabs`.
    bdtopoCleabs: extIds.find((entry) => entry.source === 'bdtopo')?.id ?? null,
  };
}

/**
 * The first usable building of a list answer (`closest`, bbox, address).
 * @param {object} body
 * @returns {?object}
 */
export function projectRnbFirst(body) {
  const results = Array.isArray(body?.results) ? body.results : [];
  for (const entry of results) {
    const projected = projectRnbBuilding(entry);
    if (projected) return projected;
  }
  return null;
}

/**
 * RNB identifier → the drawn footprints that answer to it.
 *
 * Both multiplicities are real and both are in the map: a polygon contributes
 * every one of its ids, and an id collects every polygon that carries it. See
 * shapes 1 and 2 in the header.
 *
 * @param {Array<object>} footprints `{id, rnb}` — `rnb` an array of identifiers.
 * @returns {Map<string, Array<string>>}
 */
export function indexFootprintsByRnb(footprints) {
  const index = new Map();
  for (const footprint of footprints || []) {
    const buildingId = footprint?.id;
    if (!buildingId) continue;
    const ids = Array.isArray(footprint.rnb) ? footprint.rnb : parseRnbIds(footprint.rnb);
    for (const rnbId of ids) {
      const key = String(rnbId).trim();
      if (!key) continue;
      const bucket = index.get(key);
      if (bucket) {
        // A polygon listing the same id twice would otherwise paint itself
        // twice and inflate nothing visible but the counters.
        if (!bucket.includes(buildingId)) bucket.push(buildingId);
      } else index.set(key, [buildingId]);
    }
  }
  return index;
}

/**
 * How much of a drawn payload the pivot can speak for.
 *
 * Reported rather than assumed: the share is 95.5 % over Paris 13e and 99.2 %
 * over Lyon, and a viewport where it collapses is a viewport where the identity
 * join quietly degrades to the geometric one.
 *
 * @param {Array<object>} footprints
 * @returns {{footprints: number, withId: number, coverage: number,
 *   distinctIds: number, multiId: number, splitIds: number}}
 */
export function rnbFootprintCoverage(footprints) {
  const list = Array.isArray(footprints) ? footprints : [];
  let withId = 0;
  let multiId = 0;
  for (const footprint of list) {
    const ids = Array.isArray(footprint?.rnb) ? footprint.rnb : parseRnbIds(footprint?.rnb);
    if (ids.length) withId += 1;
    if (ids.length > 1) multiId += 1;
  }
  const index = indexFootprintsByRnb(list);
  let splitIds = 0;
  for (const bucket of index.values()) if (bucket.length > 1) splitIds += 1;
  return {
    footprints: list.length,
    withId,
    coverage: list.length ? withId / list.length : 0,
    distinctIds: index.size,
    multiId,
    splitIds,
  };
}
