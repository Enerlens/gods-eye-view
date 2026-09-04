import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { parseDepartements } from './meteoFranceVigilance.js';
import { ARC_SAMPLES, greatCircleArc } from './greatCircleArc.js';
import {
  PRISM_BASE_HEIGHT_M,
  PRISM_BODY_ALPHA,
  PRISM_HEIGHT_SWATCH_COLOR,
  PRISM_NO_RATIO_COLOR,
  PRISM_NO_RATIO_GLYPH,
  PRISM_TOP_ALPHA,
  createPrismScale,
  prismHeightGlyph,
  prismHeightM,
  prismRow,
  prismTally,
} from './choroplethPrism.js';

/**
 * éCO2mix — where French electricity actually comes from, right now.
 *
 * RTE publishes the national grid's state every 15 minutes: how much the
 * country is consuming, how much each generation filière is producing, the
 * carbon content of the kWh, and the commercial balance with each of the five
 * neighbouring markets. ODRÉ republishes it keyless under Licence Ouverte 2.0.
 *
 * ── Where the data comes from ───────────────────────────────────────────────
 * Through the `/api/energy-fr` proxy, which merges `eco2mix-national-tr` and
 * `eco2mix-regional-tr` into one ~4 KB document. RTE's own API carries the
 * same figures behind an OAuth2 account; ODRÉ needs no credential, so this
 * layer works on `git clone`. The upstream's sign conventions and type traps
 * are absorbed in `eco2mixFeed.js`, under test against captured payloads.
 *
 * ── What is drawn, and why THAT ─────────────────────────────────────────────
 * The national figures are a scalar time series with no geometry — a gauge,
 * not a map. So the globe shows the two things in this dataset that ARE
 * spatial:
 *
 * 1. **Which regions power France, and which draw on it**, as a PRISM per
 *    région: HEIGHT is |MW| of physical exchange, HUE is the SIGN of it.
 *    Each region's `ech_physiques` is its consumption minus its generation, so
 *    its sign says whether it is a net exporter or a net importer. Measured
 *    2026-08-27 07:45Z: Auvergne-Rhône-Alpes −7 781 MW and Normandie −6 712 MW
 *    against Île-de-France +6 478 MW. That asymmetry — the capital importing
 *    almost its entire load from the nuclear and hydro regions — is the
 *    structural fact about the French grid, and the prism is what makes it one
 *    image instead of a table.
 *
 * 2. **The five border flows**, as arcs whose direction is the direction the
 *    power is going. Unchanged by the prism: they are a flow map, they already
 *    carry magnitude in stroke width and direction in an arrow head, and they
 *    are drawn between country reference points, not on the régions.
 *
 * ── Why the flat fill had to go, and what replaced which channel ────────────
 *
 * This layer used to paint the régions in two flat colours whose ALPHA ramped
 * with |balance| / load. That is the fault CARTOGRAPHIE B1 names in capitals:
 * `ech_physiques` is an ABSOLUTE quantity in megawatts, and « Représentation
 * d'une variable quantitative absolue en aplats de couleur — NOP !!!! ». A
 * colour fill can carry a rate; it cannot carry 7 781 MW.
 *
 * A3 — what each channel carried, and what it carries now:
 *
 *   HEIGHT  before: nothing. On a 3D globe, the axis was empty.
 *           now:    |MW|, linearly, from a common datum. The absolute
 *                   quantity finally sits on the one channel B1 allows it.
 *   HUE     before: the sign, plus (through alpha) a smear of the magnitude.
 *           now:    the SIGN ALONE — two franc hues, no gradient. The sign is
 *                   a BINARY QUALITATIVE fact, and B4 is explicit that colour
 *                   « est uniquement différenciatrice […] L'œil ne peut pas
 *                   établir d'ordre ». A diverging ramp would have invited the
 *                   eye to rank −7 781 against +6 478 by shade; the height
 *                   ranks them, and it ranks them correctly.
 *   ALPHA   before: |balance| / load, ramped 0.12 → 0.52 against a saturation
 *                   of 1.5. A second magnitude encoding on top of the hue —
 *                   A3 twice over, and unreadable on a translucent volume seen
 *                   through another translucent volume.
 *           now:    CONSTANT (`PRISM_BODY_ALPHA` / `PRISM_TOP_ALPHA`). The
 *                   ratio it carried is not lost: it is published in the
 *                   analyst record as `exchangeRatio`, where a number belongs.
 *
 * ── The arbitration: both prisms go UP ──────────────────────────────────────
 *
 * A signed quantity invites the obvious figure — export UP, import DOWN, the
 * globe's surface as the zero line. It is semiologically stronger on paper and
 * it is not drawable here. Three reasons, in order of weight:
 *
 * 1. It would be INVISIBLE, not merely awkward. `Globe.translucency.enabled`
 *    is false by default (`Build/CesiumUnminified/index.js:208871`) and it is
 *    a scene-wide property no layer owns; with an opaque globe, a prism under
 *    the ellipsoid is occluded ENTIRELY, not partially. Terrain makes it
 *    worse: the ground sits above the ellipsoid nearly everywhere on land, so
 *    an Île-de-France prism going down would be buried before it started. And
 *    on the photorealistic stack the globe is hidden and the 3D tileset is the
 *    surface (`main.js:237`), which occludes just the same.
 * 2. Even if it rendered, the two halves would not be COMPARABLE. A signed bar
 *    chart works because its zero line is straight; here the datum is a
 *    sphere. Reading 7 781 MW up in Auvergne against 6 478 MW down in
 *    Île-de-France means comparing two lengths on opposite sides of a curved,
 *    foreshortened limb — the exact measurement the prism exists to make easy.
 * 3. The direction is already carried, losslessly, by the one variable
 *    perspective does not distort (F4): the hue. Spending geometry on a fact
 *    the colour states exactly, in order to lose the magnitude comparison, is
 *    a bad trade. The height ruler stays single and shared: every prism starts
 *    at `PRISM_BASE_HEIGHT_M` = 0 and grows the same way, so the tops are
 *    comparable across all twelve régions, and the pair of hues says which way
 *    the power flows.
 *
 * What this costs, plainly: the picture no longer looks like a balance sheet,
 * and a reader who ignores colour sees only "who moves the most power". The
 * label at the top of every prism spells the verb (EXPORTE / IMPORTE) and the
 * megawatts, so colour is never the sole carrier.
 *
 * ── Calibration, frozen (C1) ────────────────────────────────────────────────
 *
 * `ENERGY_PRISM_DOMAIN_MAX_MW` = 12 000 MW ↔ 120 km, a literal measured once
 * and published here, never re-derived from the poll in hand. On the captured
 * snapshot the twelve régions run 7 781 → 1 544 MW, i.e. a dynamic range of
 * 1 : 5.0 — far under the 1 : 30 where `choroplethPrism` says a square-root
 * ruler starts earning its keep — and the smallest of them stands at 15.4 km,
 * 3.9× the 4 km floor. So `'linear'` here is not a default taken on trust: no
 * région is floored, and « deux fois plus haut vaut deux fois plus » is true
 * of every pair on the map.
 *
 * At the ~1 500 km national altitude (`prismApparentPx`, 1600 × 1000):
 *
 *     Auvergne-Rhône-Alpes  7 781 MW → 77.8 km →  74.9 px
 *     Normandie             6 712 MW → 67.1 km →  64.6 px
 *     Île-de-France         6 478 MW → 64.8 km →  62.3 px
 *     Bretagne              1 544 MW → 15.4 km →  14.9 px
 *
 * The headroom is deliberate. Setting the domain at the observed maximum would
 * clip the leader on the first cold day: Auvergne-Rhône-Alpes alone carries
 * ~13.5 GW of nuclear plus the Rhône hydro chain against a ~6.5 GW load, and
 * Normandie ~10.4 GW against ~2.6 GW. 12 000 MW sits above the largest balance
 * that fleet can produce while still spending 65 % of the ruler on the régions
 * that exist. A value above it is CLIPPED, counted, and declared in the legend
 * (A5) rather than silently rescaling the whole country.
 *
 * ── Honesty rules this layer is built around ────────────────────────────────
 *
 * • **The régions are painted, but the DÉPARTEMENTS are the geometry.** There
 *   are no bundled region polygons; the 96 département shapes already carried
 *   for Vigilance are grouped by region and every département in a region is
 *   EXTRUDED TO ITS REGION'S HEIGHT. That is a presentational grouping, not a
 *   departmental measurement, so no label ever names a département — and the
 *   legend says it in French, because a prism looks far more like a measured
 *   unit than a flat fill ever did. The twelve départements of
 *   Auvergne-Rhône-Alpes form ONE plateau at one altitude; the seams between
 *   them are visible and they are the truth of the geometry, not twelve
 *   readings.
 *
 * • **Corse gets a sign of its own, and it is not a short prism.** éCO2mix
 *   régional covers 12 metropolitan regions; Corsica runs on its own system
 *   and is absent upstream. 2A and 2B are therefore drawn FLAT AND STRIPED —
 *   a motif, not a tint, because on a photorealistic globe no hue is neutral
 *   and a pattern is what survives the NVG and FLIR passes (D3). Under the old
 *   flat regime they were simply hidden, which made "not published" look
 *   exactly like "nothing here"; a prism regime cannot afford that, because a
 *   missing prism and a zero-height prism are one pixel apart. The three
 *   states are now distinct marks (A1): striped flat footprint = unmeasured,
 *   opaque flat footprint = measured at zero, prism ≥ 4 km = measured.
 *
 * • **Only the flat footprints are ground-classified.** An extruded polygon
 *   does not classify: `GroundGeometryUpdater._isOnTerrain` returns false as
 *   soon as `extrudedHeight` is defined (`index.js:148334-148336`), so
 *   `polygon.classificationType` would be read and then ignored in silence.
 *   The map-stack listener therefore still runs — the striped and the flat
 *   footprints ARE clamped, and they still have to drape on whichever surface
 *   is active — but it skips every prism instead of pretending. Two things
 *   come free with the change: the batched-`GroundPrimitive` bug that colours
 *   an instance by its bounding rectangle cannot apply to a geometry that
 *   classifies nothing; and the outline Cesium force-disables on terrain
 *   (`index.js:61110-61113`) becomes legal, which is what draws the top edge
 *   the height is read against. `surfaceFill` is consequently false: no
 *   thematic hue climbs a façade here any more (F4).
 *
 * • **A zero flow is drawn as nothing.** A border at 0 MW is not a thin arc,
 *   it is no arc — the same "absence is not a colour" rule the Vigilance layer
 *   established for level vert.
 *
 * • **The arcs are country-to-country balances, not cables.** `ech_comm_*` is
 *   a commercial nomination between two market areas, so the endpoints here
 *   are COUNTRY REFERENCE POINTS, deliberately not interconnection sites.
 *   Drawing them at Calais or Baixas would claim a precision about physical
 *   routing that this field does not carry. `ech_comm_allemagne_belgique` is
 *   one field for two countries and stays one arc, labelled with both.
 *
 * • **Commercial ≠ physical.** The five commercial balances do not sum to
 *   `ech_physiques` (measured: −2 893 against −3 633 MW). The arcs show the
 *   commercial figures and say so; the national net shown in `getStats()` is
 *   the physical one and is labelled separately.
 *
 * • **Carbon intensity is national only.** RTE publishes no regional CO₂
 *   content, so none is painted per region — only reported for France.
 */

const API_URL = '/api/energy-fr';
const DEPARTEMENTS_URL = new URL(
  './local_data/france_departements/departements.geojson',
  import.meta.url,
).href;

/** Shared world-overlay source id (matches the layer id). */
export const ENERGY_OVERLAY_SOURCE_ID = 'france-energy';
/** Bounded label cohort offered to the shared overlay host: 12 regions + 5 borders. */
export const ENERGY_OVERLAY_COHORT_LIMIT = 20;
/** Shared ambient-label paint budget, matching the sibling French sources. */
export const ENERGY_OVERLAY_COLLISION_CAPACITY = 18;

/**
 * Idle refresh cadence. The proxy holds a 4-minute cache in front of ODRÉ and
 * the product itself steps every 15 minutes, so polling faster than this buys
 * nothing; polling slower would let a cached document age past its own step.
 */
const UPDATE_INTERVAL_MS = 180_000;

/**
 * Région INSEE code → the département codes it contains (2016 boundaries,
 * which are the ones `code_insee_region` uses).
 *
 * Corse (94, départements 2A/2B) is present so the join can state that it is
 * KNOWN and deliberately unpainted, rather than silently missing — éCO2mix
 * régional publishes no Corsican row. The DOM regions are absent because the
 * bundled polygons are metropolitan only.
 */
export const REGION_DEPARTEMENTS = Object.freeze({
  11: Object.freeze(['75', '77', '78', '91', '92', '93', '94', '95']),
  24: Object.freeze(['18', '28', '36', '37', '41', '45']),
  27: Object.freeze(['21', '25', '39', '58', '70', '71', '89', '90']),
  28: Object.freeze(['14', '27', '50', '61', '76']),
  32: Object.freeze(['02', '59', '60', '62', '80']),
  44: Object.freeze(['08', '10', '51', '52', '54', '55', '57', '67', '68', '88']),
  52: Object.freeze(['44', '49', '53', '72', '85']),
  53: Object.freeze(['22', '29', '35', '56']),
  75: Object.freeze(['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87']),
  76: Object.freeze(['09', '11', '12', '30', '31', '32', '34', '46', '48', '65', '66', '81', '82']),
  84: Object.freeze(['01', '03', '07', '15', '26', '38', '42', '43', '63', '69', '73', '74']),
  93: Object.freeze(['04', '05', '06', '13', '83', '84']),
  94: Object.freeze(['2A', '2B']),
});

/** Régions the upstream dataset does not cover — never given a prism. See header. */
export const UNCOVERED_REGIONS = Object.freeze(['94']);

/**
 * The balance palette — three NOMINAL classes, no ramp between them.
 *
 * Teal for surplus and amber for deficit, chosen to survive the deuteranopia
 * collision that a red/green pair would walk straight into. Colour is never
 * the only carrier: every label states the verb (EXPORTE / IMPORTE) and the
 * megawatts in words.
 *
 * `balanced` exists so that a measured near-zero has a colour of its own. The
 * sign of a 0.3 MW balance is rounding, not a direction, and painting it teal
 * or amber would assert a flow nobody measured. It is drawn slate, and on the
 * captured snapshot it never fires — the smallest real balance is 1 544 MW.
 */
export const BALANCE_STYLES = Object.freeze({
  exporter: Object.freeze({
    key: 'exporter', verb: 'EXPORTE', color: '#2ee6a8', label: 'Excédentaire',
    blurb: 'Produit plus qu’elle ne consomme',
  }),
  balanced: Object.freeze({
    key: 'balanced', verb: 'ÉQUILIBRÉE', color: '#8fa3b8', label: 'Équilibrée',
    blurb: 'Produit ce qu’elle consomme, à moins d’un mégawatt près',
  }),
  importer: Object.freeze({
    key: 'importer', verb: 'IMPORTE', color: '#ff9b3d', label: 'Déficitaire',
    blurb: 'Consomme plus qu’elle ne produit',
  }),
});

/**
 * Below this many megawatts a balance has no direction worth painting.
 *
 * It no longer means "drawn as nothing": that conflated a measured zero with
 * an unpublished région, which is the A1 fault this layer used to carry. Under
 * the deadband the prism keeps its measured height (the 4 km floor at least)
 * and takes the slate `balanced` colour; only an EXACT zero collapses to a
 * flat footprint. A border arc still disappears below the deadband — an arc is
 * a direction, and a direction of nothing is nothing.
 */
export const BALANCE_DEADBAND_MW = 1;

/**
 * Top of the frozen height domain, in megawatts. See the calibration section
 * of the header: 12 000 MW ↔ `PRISM_MAX_HEIGHT_M`, measured once, published
 * here, and never re-derived from a poll (C1).
 */
export const ENERGY_PRISM_DOMAIN_MAX_MW = 12_000;

/**
 * The layer's frozen prism scale.
 *
 * `ratio` here is the SIGNED balance in MW and the two breaks are the deadband
 * edges, so the three colour classes are exporter / balanced / importer. That
 * is a nominal ladder riding on `choroplethPrism`'s numeric binning, and it is
 * the honest use of the machinery: the colour answers "which way", never "how
 * much". "How much" is the height, and it is |MW|.
 */
export const ENERGY_PRISM_SCALE = createPrismScale({
  id: 'france-energy',
  domainMax: ENERGY_PRISM_DOMAIN_MAX_MW,
  heightLabel: 'solde d’échange physique',
  heightUnit: 'MW',
  mode: 'linear',
  heightTicks: [10_000, 5_000, 1_000],
  ratioLabel: 'sens de l’échange',
  ratioBreaks: [-BALANCE_DEADBAND_MW, BALANCE_DEADBAND_MW],
  ratioColors: [
    BALANCE_STYLES.exporter.color,
    BALANCE_STYLES.balanced.color,
    BALANCE_STYLES.importer.color,
  ],
  ratioClassLabels: [
    `${BALANCE_STYLES.exporter.label} — exporte`,
    `${BALANCE_STYLES.balanced.label} — sous ${BALANCE_DEADBAND_MW} MW`,
    `${BALANCE_STYLES.importer.label} — importe`,
  ],
});

/**
 * Country reference points for the border arcs — NOT interconnection sites.
 * See the header: `ech_comm_*` is a market-area balance, and anchoring it at a
 * converter station would claim a routing precision the field does not carry.
 */
export const BORDER_ANCHORS = Object.freeze({
  france: Object.freeze([2.60, 46.60]),
  angleterre: Object.freeze([-1.55, 52.60]),
  espagne: Object.freeze([-3.70, 40.42]),
  italie: Object.freeze([12.50, 42.80]),
  suisse: Object.freeze([8.23, 46.80]),
  // One point standing in for the field's two countries, placed between the
  // Belgian border and western Germany so it favours neither.
  allemagne_belgique: Object.freeze([7.20, 50.40]),
});

/** Arc stroke width in pixels, ramped by |MW| up to the saturation flow. */
const ARC_WIDTH_MIN_PX = 3;
const ARC_WIDTH_MAX_PX = 15;
const ARC_SATURATION_MW = 3000;

/**
 * Invert `REGION_DEPARTEMENTS` into a département → région lookup.
 * @returns {Map<string, string>}
 */
export function departementRegionIndex() {
  const index = new Map();
  for (const [region, departements] of Object.entries(REGION_DEPARTEMENTS)) {
    for (const code of departements) index.set(code, region);
  }
  return index;
}

/**
 * Format megawatts the way a French control-room readout would: thin-space
 * grouping, no decimals, sign carried by the verb rather than a minus.
 * @param {number|null|undefined} mw
 * @returns {string}
 */
export function formatMegawatts(mw) {
  if (!Number.isFinite(mw)) return '— MW';
  // `toLocaleString('fr-FR')` groups with U+202F on modern ICU and U+00A0 on
  // older ones. Both are normalised to a plain space so the label measures
  // and wraps predictably in the overlay's text layout.
  return `${Math.round(Math.abs(mw)).toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g, ' ')} MW`;
}

/**
 * Classify one balance into its paint style.
 *
 * `netPhysical` is published as consumption minus generation, so POSITIVE is a
 * net importer — the inverse of the intuition that a positive number means a
 * surplus. That inversion is handled here, once.
 *
 * NULL means UNMEASURED and nothing else. It used to be returned inside the
 * deadband too, which put "éCO2mix published no figure" and "éCO2mix published
 * zero" behind the same absence — A1, and much more dangerous under a height
 * channel than under a flat fill. A measured near-zero now returns the
 * `balanced` style.
 *
 * The `ratio` is kept even though nothing paints with it any more: it is the
 * variable the fill alpha used to carry, and it now travels to the analyst
 * record instead of to a visual channel (A3).
 *
 * @param {number|null|undefined} netPhysical Megawatts, upstream sign.
 * @param {number|null|undefined} load Regional consumption, for the ratio.
 * @returns {{style:object, ratio:number}|null} Null only when unmeasured.
 */
export function balanceStyle(netPhysical, load) {
  if (!Number.isFinite(netPhysical)) return null;
  let style = BALANCE_STYLES.balanced;
  // SYMMETRIC and closed on both sides: ±deadband belongs to the direction,
  // and only strictly inside it is the exchange "balanced". This is the
  // convention the layer states everywhere else, and it is the one the prism
  // has to follow — not the reverse. See `energySignSentinel`.
  if (netPhysical >= BALANCE_DEADBAND_MW) style = BALANCE_STYLES.importer;
  else if (netPhysical <= -BALANCE_DEADBAND_MW) style = BALANCE_STYLES.exporter;
  // Ratio against the region's own load, so the picture is comparable across
  // regions AND across time — normalising against the current maximum would
  // restate the whole country every time one region moved.
  const ratio = Number.isFinite(load) && load > 0 ? Math.abs(netPhysical) / load : 0;
  return { style, ratio };
}

/**
 * One région as the prism grammar's `(value, ratio)` pair.
 *
 * HEIGHT takes |MW| — a magnitude, which is what `createPrismScale` demands,
 * since it refuses a negative `domainMin` precisely so that `heightM === 0`
 * can keep meaning "measured zero". COLOUR takes the SIGNED value, where the
 * frozen breaks are the deadband edges.
 *
 * The absolute value is computed only for a finite reading: `Math.abs(null)`
 * is 0, and handing that to the scale would manufacture a measured zero out of
 * a région the upstream did not publish — the one thing this grammar exists to
 * prevent.
 *
 * @param {object|null|undefined} record From {@link buildRegionRecords}.
 * @returns {object} A `prismRow` result against {@link ENERGY_PRISM_SCALE}.
 */
export function energyPrismRow(record) {
  const net = Number.isFinite(record?.netPhysical) ? record.netPhysical : null;
  return prismRow({
    code: record?.code ?? null,
    value: net === null ? null : Math.abs(net),
    // The colour channel of this layer is a SIGN CLASS, not a magnitude — the
    // legend says so, `ratioLabel` is "sens de l'échange". So the binner is
    // handed the class, decided by `balanceStyle`, rather than the raw MW.
    //
    // It has to be, because the two disagree on the boundary. `balanceStyle`
    // is symmetric and closed (±1 MW belongs to the direction); `prismRatioBin`
    // is half-open (`v <= breaks[i]`), so it put exactly +1 MW in "équilibrée"
    // while the label floating on top of the same prism said "IMPORTE 1 MW" —
    // two signs, one object, opposite claims. A symmetric closed band cannot
    // be expressed with two half-open breaks, so the layer decides and the
    // generic binner follows.
    ratio: net === null ? null : energySignSentinel(net),
  }, ENERGY_PRISM_SCALE);
}

/**
 * The value handed to `prismRatioBin` so its class matches `balanceStyle`.
 *
 * Not a measurement and never displayed: a sentinel that lands unambiguously
 * inside the intended class of the frozen breaks `[-deadband, +deadband]`.
 * @param {number} netPhysical Megawatts, upstream sign.
 * @returns {number}
 */
function energySignSentinel(netPhysical) {
  const key = balanceStyle(netPhysical, null)?.style?.key;
  if (key === 'importer') return BALANCE_DEADBAND_MW * 2;
  if (key === 'exporter') return -BALANCE_DEADBAND_MW;
  return 0;
}

/**
 * Join a `/api/energy-fr` payload to the known régions.
 *
 * The région code set is the whitelist: a `code_insee_region` the département
 * grouping does not know is not a metropolitan région and is discarded, which
 * is what keeps a future DOM row off a metropolitan map.
 *
 * @param {object|null|undefined} payload `/api/energy-fr` body.
 * @param {Map<string, object>} departements From `parseDepartements`.
 * @returns {Array<object>} One record per KNOWN, COVERED région present upstream.
 */
export function buildRegionRecords(payload, departements) {
  const regions = Array.isArray(payload?.regions) ? payload.regions : [];
  const uncovered = new Set(UNCOVERED_REGIONS);
  const records = [];
  for (const region of regions) {
    const code = String(region?.code ?? '').trim();
    const codes = REGION_DEPARTEMENTS[code];
    if (!codes || uncovered.has(code)) continue;
    const balance = balanceStyle(region.netPhysical, region.load);
    records.push({
      code,
      name: String(region?.name ?? '').trim() || code,
      at: String(region?.at ?? '').trim() || null,
      load: Number.isFinite(region?.load) ? region.load : null,
      generation: Number.isFinite(region?.generation) ? region.generation : null,
      lowCarbon: Number.isFinite(region?.lowCarbon) ? region.lowCarbon : null,
      netPhysical: Number.isFinite(region?.netPhysical) ? region.netPhysical : null,
      mix: Array.isArray(region?.mix) ? region.mix : [],
      departements: codes,
      anchor: regionAnchor(codes, departements),
      balance,
    });
  }
  // Weakest first, strongest last. Translucent volumes are depth-sorted by the
  // renderer, so this no longer decides who paints over whom — it is kept
  // because it makes the label cohort, the analyst snapshot and the legend
  // counts deterministic from one poll to the next.
  return records.sort((a, b) => Math.abs(a.netPhysical ?? 0) - Math.abs(b.netPhysical ?? 0)
    || a.code.localeCompare(b.code));
}

/**
 * Label anchor for a région: the unweighted mean of its départements' anchors.
 *
 * This is a LABEL ANCHOR, not a centre of mass — the départements of a région
 * are not equal in area, so the mean sits wherever the small ones pull it. It
 * only has to land inside the right région, which it does for all twelve.
 *
 * @param {ReadonlyArray<string>} codes
 * @param {Map<string, object>} departements
 * @returns {number[]|null}
 */
export function regionAnchor(codes, departements) {
  let lon = 0;
  let lat = 0;
  let count = 0;
  for (const code of codes || []) {
    const anchor = departements?.get?.(code)?.anchor;
    if (!Array.isArray(anchor) || !Number.isFinite(anchor[0]) || !Number.isFinite(anchor[1])) continue;
    lon += anchor[0];
    lat += anchor[1];
    count += 1;
  }
  if (!count) return null;
  return [lon / count, lat / count];
}

/**
 * Turn the national exchange list into drawable arcs.
 *
 * Direction is the direction the electricity travels: a POSITIVE `mw` is an
 * import into France, so the arc starts abroad and ends in France, and the
 * arrow head lands on France. Zero flows produce no arc at all.
 *
 * @param {Array<object>|null|undefined} exchanges From `/api/energy-fr`.
 * @returns {Array<object>}
 */
export function buildBorderArcs(exchanges) {
  const arcs = [];
  for (const exchange of Array.isArray(exchanges) ? exchanges : []) {
    const key = String(exchange?.key ?? '').trim();
    const anchor = BORDER_ANCHORS[key];
    const mw = Number(exchange?.mw);
    if (!anchor || !Number.isFinite(mw)) continue;
    if (Math.abs(mw) < BALANCE_DEADBAND_MW) continue;
    const importing = mw > 0;
    const style = importing ? BALANCE_STYLES.importer : BALANCE_STYLES.exporter;
    const from = importing ? anchor : BORDER_ANCHORS.france;
    const to = importing ? BORDER_ANCHORS.france : anchor;
    const magnitude = Math.min(Math.abs(mw), ARC_SATURATION_MW) / ARC_SATURATION_MW;
    arcs.push({
      key,
      label: String(exchange?.label ?? '').trim() || key,
      mw,
      importing,
      style,
      width: ARC_WIDTH_MIN_PX + (ARC_WIDTH_MAX_PX - ARC_WIDTH_MIN_PX) * magnitude,
      positions: greatCircleArc(from, to),
      // Midpoint of the sampled arc, which is also its apex — where a label
      // sits clear of both countries.
      anchorIndex: Math.floor(ARC_SAMPLES / 2),
    });
  }
  return arcs;
}

/**
 * Label text for a région. The verb and the megawatts carry the meaning; the
 * prism's colour only reinforces it, and its height is exactly this number.
 *
 * A région with no published balance says so. It used to say « ÉQUILIBRÉE »,
 * which was an assertion about a measurement nobody made.
 * @param {object} record
 * @returns {string}
 */
export function regionLabelText(record) {
  if (!record?.balance) return `${record?.name ?? ''} · SOLDE NON PUBLIÉ`;
  return `${record.name} · ${record.balance.style.verb} ${formatMegawatts(record.netPhysical)}`;
}

/**
 * Label text for a border arc. "vers"/"depuis" states the direction in words,
 * because an arrow head is the first thing lost at a shallow camera angle.
 * @param {object} arc
 * @returns {string}
 */
export function borderLabelText(arc) {
  const direction = arc?.importing ? 'depuis' : 'vers';
  return `${formatMegawatts(arc?.mw)} ${direction} ${arc?.label}`;
}

/**
 * Height, in metres, at which a région's label rides.
 *
 * The TOP of its prism, not the ground. B2 asks for a height read « contre un
 * guide vertical »; here the guide is the label itself, which states the exact
 * megawatts the length encodes, at the exact altitude the length reaches. A
 * label left on the ground would sit behind 78 km of translucent volume and
 * annotate nothing.
 * @param {object|null|undefined} record
 * @returns {number} Metres above the ellipsoid, 0 when there is no prism.
 */
export function regionLabelHeightM(record) {
  const heightM = energyPrismRow(record).heightM;
  return Number.isFinite(heightM) ? heightM : 0;
}

/**
 * Build the source-owned presentation for one région label.
 * @param {object} record
 * @param {Cesium.Cartesian3} position
 * @returns {object}
 */
export function createRegionOverlayEntry(record, position) {
  return {
    id: `energy-fr:region:${record.code}`,
    position,
    variant: 'label',
    title: regionLabelText(record),
    accent: record.balance ? record.balance.style.color : PRISM_NO_RATIO_COLOR,
    priority: Math.round(Math.abs(record.netPhysical ?? 0)),
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/**
 * Build the source-owned presentation for one border-flow label.
 *
 * Border flows outrank régions in the collision cohort: there are only five of
 * them, they carry the headline "France is exporting tonight", and they sit
 * out over water or abroad where nothing else competes.
 * @param {object} arc
 * @param {Cesium.Cartesian3} position
 * @returns {object}
 */
export function createBorderOverlayEntry(arc, position) {
  return {
    id: `energy-fr:border:${arc.key}`,
    position,
    variant: 'label',
    title: borderLabelText(arc),
    accent: arc.style.color,
    priority: 1_000_000 + Math.round(Math.abs(arc.mw)),
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Keep the strongest flows, with stable identity as tie-break. */
export function selectEnergyOverlayCohort(entries, limit = ENERGY_OVERLAY_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(
    ENERGY_OVERLAY_COHORT_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/**
 * Roll the national block up into the figures the HUD and the analyst read.
 *
 * `lowCarbonShare` is computed against GENERATION, not consumption: the
 * denominator has to be what France produced, or a heavy export hour reports a
 * share above 100%.
 *
 * @param {object|null|undefined} national
 * @returns {object}
 */
export function summarizeNational(national) {
  const generation = Number.isFinite(national?.generation) ? national.generation : null;
  const lowCarbon = Number.isFinite(national?.lowCarbon) ? national.lowCarbon : null;
  return {
    at: national?.at || null,
    load: Number.isFinite(national?.load) ? national.load : null,
    co2: Number.isFinite(national?.co2) ? national.co2 : null,
    generation,
    lowCarbonShare: generation && generation > 0 && lowCarbon !== null
      ? Math.round((lowCarbon / generation) * 1000) / 10
      : null,
    netPhysical: Number.isFinite(national?.netPhysical) ? national.netPhysical : null,
    netCommercial: Number.isFinite(national?.netCommercial) ? national.netCommercial : null,
    topFiliere: Array.isArray(national?.mix) && national.mix.length ? national.mix[0] : null,
  };
}

/** French grouping for a plain integer, via the platform's own fr-FR rules. */
function fr(value) {
  // Same normalisation as `formatMegawatts`: ICU groups with U+202F or U+00A0
  // depending on its version, and both are flattened so the legend measures and
  // wraps identically everywhere.
  return Number(value).toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g, ' ');
}

/**
 * The two-part legend: the height ruler, then the colour key (D1).
 *
 * Written here rather than taken from `choroplethPrism.prismLegend()`, and the
 * reason is not convenience. That helper publishes, verbatim, « Un rapport,
 * donc une variation de valeur : c'est ce que la couleur a le droit de dire »
 * — true of the three count layers it was written for, and FALSE here, where
 * the colour is a nominal sign and its licence comes from B4, not B1. Its
 * height blurb likewise promises that the colour answers « rapporté à quoi ? »,
 * which this layer's colour cannot do. A legend that misdescribes its own
 * channel is worse than no legend, so the entries are composed from the same
 * primitives (`prismHeightM`, `prismHeightGlyph`, `prismTally`, the frozen
 * scale) with sentences that are true of this map.
 *
 * Entry shape is the repo's: `{ label, color, count?, blurb?, glyph? }`.
 * `color: null` renders an aligned empty swatch and marks a row that is not a
 * colour key; `glyph` is masked with `color`, so the height ticks hand over a
 * BAR whose height is the datum while all three share one constant colour —
 * any variation there would be a second, false encoding.
 *
 * @param {Array<object>} records From {@link buildRegionRecords}.
 * @returns {Array<{label:string,color:?string,blurb?:string,count?:number,glyph?:string}>}
 */
export function energyPrismLegend(records) {
  const list = Array.isArray(records) ? records : [];
  if (!list.length) return [];
  const scale = ENERGY_PRISM_SCALE;
  const tally = prismTally(list.map((record) => ({
    code: record?.code,
    value: Number.isFinite(record?.netPhysical) ? Math.abs(record.netPhysical) : null,
    ratio: Number.isFinite(record?.netPhysical) ? record.netPhysical : null,
  })), scale);
  // Corse is not in `records` at all — it is filtered out of the join — so its
  // deliberate absence has to be added back here, or the legend would count
  // twelve régions and quietly forget the thirteenth. `noValue` and `noRatio`
  // are the same régions in this layer (both halves come from the one
  // `ech_physiques` field), so the row is labelled after the height, which is
  // the variable a reader misses first.
  const unpublished = tally.noValue + UNCOVERED_REGIONS.length;

  const entries = [{
    label: `Hauteur — ${scale.heightLabel}`,
    color: null,
    blurb: `Échelle linéaire : deux fois plus haut vaut deux fois plus. Le plus haut prisme fait `
      + `${Math.round(scale.maxHeightM / 1000)} km pour ${fr(scale.domainMax)} ${scale.heightUnit}, `
      + `borne gelée et jamais recalculée sur le relevé en cours. La hauteur est la VALEUR ABSOLUE `
      + `du solde : un exportateur et un importateur de même puissance montent pareil, et c’est la `
      + `couleur qui dit lequel est lequel. Le socle du prisme est la RÉGION, dessinée par ses `
      + `départements : aucun département n’est mesuré séparément.`,
  }];

  for (const tick of scale.heightTicks) {
    const heightM = prismHeightM(tick, scale);
    entries.push({
      label: `${fr(tick)} ${scale.heightUnit}`,
      color: PRISM_HEIGHT_SWATCH_COLOR,
      glyph: prismHeightGlyph((heightM ?? 0) / scale.maxHeightM),
      blurb: `${Math.round((heightM ?? 0) / 1000)} km de haut.`,
    });
  }

  if (tally.clipped) {
    // A5 — above the frozen domain the mark stops measuring. Say how many.
    entries.push({
      label: `au-dessus de ${fr(scale.domainMax)} ${scale.heightUnit}`,
      color: null,
      count: tally.clipped,
      blurb: 'Prisme dessiné à la hauteur maximale : il ne dit plus combien. Le domaine reste '
        + 'gelé pour que la même donnée fasse la même hauteur d’une session à l’autre.',
    });
  }

  if (tally.zero) {
    entries.push({
      label: 'mesuré à zéro',
      color: BALANCE_STYLES.balanced.color,
      count: tally.zero,
      blurb: 'Emprise à plat, remplie et opaque, sans prisme. Zéro est une mesure : elle ne se '
        + 'dessine pas comme une absence de mesure.',
    });
  }

  entries.push({
    label: `Couleur — ${scale.ratioLabel}`,
    color: null,
    blurb: 'Le sens est binaire, donc deux couleurs franches et aucun dégradé : une variation de '
      + 'teinte différencie, elle n’ordonne pas. C’est la hauteur qui classe les régions entre '
      + 'elles. Teal et ambre plutôt que vert et rouge, pour survivre à une deutéranopie, et '
      + 'chaque étiquette répète le verbe : la couleur n’est jamais seule à porter le sens.',
  });

  scale.ratioColors.forEach((color, index) => {
    const count = tally.ratioCounts[index] || 0;
    if (!count) return;
    const spec = [BALANCE_STYLES.exporter, BALANCE_STYLES.balanced, BALANCE_STYLES.importer][index];
    entries.push({
      label: scale.ratioClassLabels[index],
      color,
      count,
      blurb: spec.blurb,
    });
  });

  entries.push({
    label: `${scale.heightLabel} — non publié`,
    color: PRISM_NO_RATIO_COLOR,
    glyph: PRISM_NO_RATIO_GLYPH,
    count: unpublished,
    blurb: 'Emprise à plat et hachurée, jamais un prisme court : éCO2mix régional ne publie pas '
      + 'la Corse, qui tient son propre réseau. Un motif et non une teinte, parce que sur un '
      + 'globe photoréaliste il n’existe aucune couleur neutre.',
  });

  return entries;
}

/**
 * Map one région to a JSON-safe analyst record (analyst query engine seam).
 * Pure — no Cesium types. Missing fields are null, never NaN.
 * @param {object|null|undefined} record
 * @param {number} [index=0]
 * @returns {object}
 */
export function mapAnalystRecord(record, index = 0) {
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  const num = (v) => (Number.isFinite(v) ? v : null);
  return {
    id: text(record?.code) || `REGION-${String(index).padStart(4, '0')}`,
    name: text(record?.name),
    loadMw: num(record?.load),
    generationMw: num(record?.generation),
    // Restated in the direction a human asks the question in: positive means
    // this région sent power to the rest of France.
    netExportMw: Number.isFinite(record?.netPhysical) ? -record.netPhysical : null,
    // |balance| / load — the variable the fill alpha used to carry. It left a
    // visual channel (A3) and landed here, where it is a number rather than a
    // shade nobody could decode through a translucent volume.
    exchangeRatio: num(record?.balance?.ratio),
    // Metres of extrusion, so an analyst can check what the map claims to show
    // against the figure it was built from.
    prismHeightM: num(energyPrismRow(record).heightM),
    balance: text(record?.balance?.style?.key),
    topFiliere: record?.mix?.length ? text(record.mix[0].label) : null,
    observedAt: text(record?.at),
    lat: record?.anchor ? record.anchor[1] : null,
    lon: record?.anchor ? record.anchor[0] : null,
  };
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  clearSource: clearOverlaySource,
  setVisible: setOverlaySourceVisible,
});

/**
 * Which Cesium classification surface a clamped région footprint should target.
 * Same rule the Vigicrues and Vigilance layers established: classify against
 * ONLY the active surface, and fall back to BOTH for an unknown stack rather
 * than risk drawing nothing.
 *
 * Still live, but its audience has shrunk to the two FLAT states — the striped
 * "not published" footprint and the opaque "measured zero" one. A prism is not
 * classified at all and must not be handed a `classificationType`: the value
 * would be read and ignored (`index.js:148334-148336`), which is worse than
 * not setting it, because the next reader would believe it did something.
 * @param {string|null|undefined} activeId Active map-stack id.
 * @returns {Cesium.ClassificationType}
 */
export function energyClassificationTypeForStack(activeId) {
  const id = String(activeId || '').toLowerCase();
  if (!id) return Cesium.ClassificationType.BOTH;
  if (id.includes('photo') || id.includes('google') || id.includes('3d')) {
    return Cesium.ClassificationType.CESIUM_3D_TILE;
  }
  return Cesium.ClassificationType.TERRAIN;
}

/**
 * @param {object} [options]
 * @returns {object} Data-manager layer module.
 */
export function createFranceEnergyLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  apiUrl = API_URL,
  departementsUrl = DEPARTEMENTS_URL,
  departementsGeoJson = null,
  mapStackEventTarget = typeof window === 'undefined' ? null : window,
} = {}) {
  let _viewer = null;
  let _dataSource = null;
  /** @type {Map<string, object>} INSEE code → bundled polygon metadata. */
  let _departements = new Map();
  /**
   * Département code → EVERY entity Cesium made for it. A `MultiPolygon`
   * département becomes one entity PER PART — see the Vigilance layer's note
   * on the ten départements that carry islands.
   * @type {Map<string, Cesium.Entity[]>}
   */
  let _entities = new Map();
  /** @type {Map<string, Cesium.Entity>} border key → arc polyline entity. */
  let _arcEntities = new Map();
  let _shapesPromise = null;
  let _records = [];
  let _arcs = [];
  let _national = summarizeNational(null);
  let _signature = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;
  let _feedSource = null;
  let _classificationType = Cesium.ClassificationType.BOTH;
  let _mapStackListener = null;

  /**
   * Retarget the classification of the FLAT footprints when the map stack
   * changes.
   *
   * A prism is skipped, deliberately and by test: an extruded polygon is built
   * as an ordinary primitive and reads `classificationType` into a field it
   * never uses. Writing it there would cost a geometry rebuild of 96 polygons
   * to change nothing at all.
   */
  function applyClassification(next) {
    if (next === undefined || next === _classificationType) return;
    _classificationType = next;
    for (const parts of _entities.values()) {
      for (const entity of parts) {
        if (!entity.polygon || isExtruded(entity)) continue;
        entity.polygon.classificationType = next;
      }
    }
    _viewer?.scene?.requestRender?.();
  }

  /** True while this entity is drawn as a prism rather than as a footprint. */
  function isExtruded(entity) {
    return entity?.polygon?.extrudedHeight !== undefined;
  }

  /**
   * Load the bundled polygons ONCE, hidden. Every département gets an entity up
   * front so a refresh only flips `show` and swaps a material.
   */
  async function ensureShapes() {
    if (_shapesPromise) return _shapesPromise;
    _shapesPromise = (async () => {
      const geojson = departementsGeoJson
        || await (await fetch(departementsUrl)).json();
      _departements = parseDepartements(geojson);
      const source = await Cesium.GeoJsonDataSource.load(geojson, {
        clampToGround: true,
        fill: Cesium.Color.TRANSPARENT,
        stroke: Cesium.Color.TRANSPARENT,
        strokeWidth: 0,
      });
      source.name = 'éCO2mix — mix électrique français';
      source.show = _enabled;
      for (const entity of source.entities.values) {
        const code = String(entity.properties?.code?.getValue?.() ?? '').trim();
        if (!entity.polygon || !code) {
          entity.show = false;
          continue;
        }
        entity.polygon.outline = false;
        entity.polygon.classificationType = _classificationType;
        entity.polygon.material = new Cesium.ColorMaterialProperty(Cesium.Color.TRANSPARENT);
        entity.show = false;
        const parts = _entities.get(code);
        if (parts) parts.push(entity);
        else _entities.set(code, [entity]);
      }
      if (_viewer) await _viewer.dataSources.add(source);
      _dataSource = source;
      return source;
    })().catch((error) => {
      // A failed shape load must be retryable, not a permanently poisoned
      // promise that leaves the layer silently empty for the session.
      _shapesPromise = null;
      throw error;
    });
    return _shapesPromise;
  }

  /**
   * Raise the current régions on the pre-built département entities.
   *
   * Three marks, and they are the three states of A1:
   *
   *   measured, non-zero → PRISM. Base on the ellipsoid, top at |MW|, body
   *     translucent, silhouette and top edge near-opaque. The top edge is the
   *     reading instrument, which is why it gets the outline Cesium only
   *     allows off terrain.
   *   measured at zero   → FLAT, filled, opaque, ground-clamped, slate.
   *   not measured       → FLAT, STRIPED, ground-clamped. Corse lives here,
   *     permanently, and so does any région the upstream drops mid-session.
   *
   * Only reached when the poll signature moved, i.e. at most once per upstream
   * 15-minute step, so rebuilding the extruded geometry costs one frame per
   * step rather than one per poll.
   */
  function repaint() {
    const painted = new Set();
    for (const record of _records) {
      const row = energyPrismRow(record);
      // One material instance per région, shared across all its départements:
      // they are one measurement, not eight, and the shared instance is what
      // makes that visible as a single plateau.
      const material = prismMaterial(row);
      const outlineColor = Cesium.Color
        .fromCssColorString(row.color || PRISM_NO_RATIO_COLOR)
        .withAlpha(PRISM_TOP_ALPHA);
      for (const code of record.departements) {
        const parts = _entities.get(code);
        if (!parts) continue;
        painted.add(code);
        for (const entity of parts) applyPrism(entity, row, material, outlineColor);
      }
    }
    // Everything else — Corse, and any région the upstream dropped this
    // refresh — is drawn as a DECLARED absence rather than as a hole. Under the
    // flat regime these were hidden, which made "not published" and "nothing
    // here" the same pixel; a height channel cannot afford that (A1).
    const stripe = unpublishedMaterial();
    for (const [code, parts] of _entities) {
      if (painted.has(code)) continue;
      for (const entity of parts) applyUnpublished(entity, stripe);
    }
    repaintArcs();
    _viewer?.scene?.requestRender?.();
  }

  /** Body material for one prism row: the sign's colour, or the stripe. */
  function prismMaterial(row) {
    if (!row.hasValue || !row.color) return unpublishedMaterial();
    return new Cesium.ColorMaterialProperty(
      Cesium.Color.fromCssColorString(row.color)
        // A flat footprint is composited over imagery and needs to stay
        // legible; a prism body is composited over the sky and over other
        // prisms, and its top edge is what carries the reading.
        .withAlpha(row.extruded ? PRISM_BODY_ALPHA : PRISM_TOP_ALPHA),
    );
  }

  /**
   * The stripe that says "nobody published this".
   *
   * A MOTIF, not a tint (D3): a photorealistic globe has no neutral colour, and
   * a pattern is the encoding that survives the NVG and FLIR passes. Cesium's
   * stripe runs along the polygon's texture axes, so these are bands rather
   * than diagonals — the legend swatch hatches, the map bands, and both read as
   * "pattern, therefore not a measurement".
   *
   * Known degradation, stated rather than hidden: a non-colour material on a
   * clamped polygon needs `GroundPrimitive.supportsMaterials`, which wants the
   * depth-texture extension. Where that is missing, Cesium builds the footprint
   * as an ordinary primitive at height 0 and Corsican terrain hides it — i.e.
   * the layer falls back to exactly the behaviour it had before this change,
   * on the machines that could not have done better anyway.
   */
  function unpublishedMaterial() {
    const slate = Cesium.Color.fromCssColorString(PRISM_NO_RATIO_COLOR);
    return new Cesium.StripeMaterialProperty({
      orientation: Cesium.StripeOrientation.VERTICAL,
      evenColor: slate.withAlpha(0.55),
      oddColor: slate.withAlpha(0.05),
      repeat: 18,
    });
  }

  /** Apply one prism row to one Cesium polygon entity. */
  function applyPrism(entity, row, material, outlineColor) {
    const polygon = entity.polygon;
    if (!polygon) return;
    polygon.material = material;
    if (row.extruded) {
      polygon.height = PRISM_BASE_HEIGHT_M;
      polygon.extrudedHeight = row.heightM;
      // Both must stay put: a base clamped to terrain would start the Savoie
      // prism 2 km above the Landes one, so its TOP would sit 2 km higher at
      // equal megawatts — a bias correlated with relief, on the one channel
      // that now carries the measurement.
      polygon.perPositionHeight = false;
      polygon.classificationType = undefined;
      polygon.outline = true;
      polygon.outlineColor = outlineColor;
      polygon.outlineWidth = 1;
    } else {
      // A measured zero has no prism, so it goes back on the ground where the
      // terrain cannot swallow it, and it takes the classification with it.
      polygon.height = undefined;
      polygon.extrudedHeight = undefined;
      polygon.classificationType = _classificationType;
      polygon.outline = false;
    }
    entity.show = true;
  }

  /** Draw one département of an unmeasured région as a striped footprint. */
  function applyUnpublished(entity, material) {
    const polygon = entity.polygon;
    if (!polygon) return;
    polygon.height = undefined;
    polygon.extrudedHeight = undefined;
    polygon.classificationType = _classificationType;
    polygon.outline = false;
    polygon.material = material;
    entity.show = true;
  }

  /** Rebuild the border arcs. Five entities at most, so they are recreated whole. */
  function repaintArcs() {
    if (!_dataSource) return;
    const live = new Set();
    for (const arc of _arcs) {
      live.add(arc.key);
      let entity = _arcEntities.get(arc.key);
      const positions = Cesium.Cartesian3.fromDegreesArrayHeights(arc.positions);
      const color = Cesium.Color.fromCssColorString(arc.style.color);
      if (!entity) {
        entity = _dataSource.entities.add({
          id: `energy-fr:arc:${arc.key}`,
          polyline: {
            positions,
            width: arc.width,
            // The arrow head is the direction of travel; `borderLabelText`
            // repeats it in words for the angles where the head is not legible.
            material: new Cesium.PolylineArrowMaterialProperty(color),
            arcType: Cesium.ArcType.NONE,
          },
        });
        _arcEntities.set(arc.key, entity);
      } else {
        entity.polyline.positions = positions;
        entity.polyline.width = arc.width;
        entity.polyline.material = new Cesium.PolylineArrowMaterialProperty(color);
      }
      entity.show = true;
    }
    for (const [key, entity] of _arcEntities) {
      if (!live.has(key)) entity.show = false;
    }
  }

  function publishOverlay() {
    if (!_enabled) return;
    const entries = [];
    for (const record of _records) {
      // No anchor means no shape to hang the label off. A missing BALANCE is
      // no longer a reason to skip: the label is the only place a reader can
      // learn that éCO2mix published nothing for this région, and it says so
      // in words rather than by not being there.
      if (!record.anchor) continue;
      entries.push(createRegionOverlayEntry(
        record,
        // At the TOP of the prism: the label is the numeric readout of the
        // length, so it belongs at the end of the length.
        Cesium.Cartesian3.fromDegrees(
          record.anchor[0],
          record.anchor[1],
          regionLabelHeightM(record),
        ),
      ));
    }
    for (const arc of _arcs) {
      const i = arc.anchorIndex * 3;
      if (!Number.isFinite(arc.positions[i])) continue;
      entries.push(createBorderOverlayEntry(
        arc,
        Cesium.Cartesian3.fromDegrees(arc.positions[i], arc.positions[i + 1], arc.positions[i + 2]),
      ));
    }
    overlayHost.setEntries(
      ENERGY_OVERLAY_SOURCE_ID,
      selectEnergyOverlayCohort(entries),
      {
        cohortLimit: ENERGY_OVERLAY_COHORT_LIMIT,
        collisionCapacity: ENERGY_OVERLAY_COLLISION_CAPACITY,
        moving: false,
      },
    );
  }

  /** Fingerprint of the painted state, so an unchanged snapshot repaints nothing. */
  function signatureOf(records, arcs) {
    return [
      records.map((r) => `${r.code}:${Math.round(r.netPhysical ?? 0)}`).join(','),
      arcs.map((a) => `${a.key}:${Math.round(a.mw)}`).join(','),
    ].join('|');
  }

  const layer = {
    id: 'france-energy',
    name: 'Mix élec (FR)',
    icon: '⚡',
    source: 'RTE / ODRÉ',
    updateInterval: UPDATE_INTERVAL_MS,

    init(viewer) {
      _viewer = viewer;
      _records = [];
      _arcs = [];
      _national = summarizeNational(null);
      _signature = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      _feedSource = null;
      _classificationType = energyClassificationTypeForStack(null);
      if (mapStackEventTarget && !_mapStackListener) {
        _mapStackListener = (event) => {
          applyClassification(energyClassificationTypeForStack(event?.detail?.activeId));
        };
        mapStackEventTarget.addEventListener('gev:map-stack-changed', _mapStackListener);
      }
      overlayHost.setVisible(ENERGY_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Energy FR] Initialized');
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(ENERGY_OVERLAY_SOURCE_ID, true);
      publishOverlay();
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(ENERGY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(ENERGY_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      try {
        await ensureShapes();
      } catch (error) {
        console.warn('[Data:Energy FR] Département polygons unavailable:', error);
        _lastError = 'Département polygons unavailable';
        return false;
      }
      try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
          _lastError = `éCO2mix HTTP ${response.status}`;
          console.warn(`[Data:Energy FR] API returned ${response.status}`);
          return false;
        }
        const payload = await response.json();
        if (!payload?.national && !Array.isArray(payload?.regions)) {
          _lastError = 'Malformed éCO2mix response';
          return false;
        }

        const records = buildRegionRecords(payload, _departements);
        const arcs = buildBorderArcs(payload?.national?.exchanges);
        const signature = signatureOf(records, arcs);
        _records = records;
        _arcs = arcs;
        _national = summarizeNational(payload.national);
        _feedSource = String(payload.source ?? '').trim() || null;
        _stale = payload.stale === true;
        _lastUpdate = Date.now();
        _lastError = null;

        if (signature !== _signature) {
          _signature = signature;
          repaint();
          publishOverlay();
        }

        const share = _national.lowCarbonShare;
        console.log(
          `[Data:Energy FR] Updated: ${_records.length} régions,`
          + ` ${formatMegawatts(_national.load)} appelés,`
          + ` ${share === null ? '—' : `${share}%`} bas-carbone,`
          + ` ${_national.co2 ?? '—'} gCO₂/kWh`,
        );
        return true;
      } catch (error) {
        console.warn('[Data:Energy FR] Fetch error:', error);
        _lastError = 'éCO2mix network error';
        return false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      overlayHost.clearSource(ENERGY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(ENERGY_OVERLAY_SOURCE_ID, false);
      if (mapStackEventTarget && _mapStackListener) {
        mapStackEventTarget.removeEventListener('gev:map-stack-changed', _mapStackListener);
        _mapStackListener = null;
      }
      if (_dataSource) {
        viewer?.dataSources?.remove?.(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      _departements = new Map();
      _entities = new Map();
      _arcEntities = new Map();
      _shapesPromise = null;
      _records = [];
      _arcs = [];
      _national = summarizeNational(null);
      _signature = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _feedSource = null;
    },

    /**
     * Snapshot the régions as plain JSON-safe objects for the analyst query
     * engine. On-demand only. Returns [] while the layer is off.
     * @param {number} [maxCount=200]
     * @returns {Array<Object>}
     */
    getAnalystRecords(maxCount = 200) {
      if (!_enabled) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 200;
      const result = [];
      for (const record of _records) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(record, result.length));
      }
      return result;
    },

    /**
     * The prism legend, for the toggle row AND the on-map block. No chips: the
     * layer has no options.
     *
     * D1 is not optional here — the height means nothing without its ruler, and
     * a ruler that lives behind a panel is not a legend. `surfaceFill` is
     * false: the only ground-classified surfaces left are the two flat marks,
     * whose colour carries no value for a façade's shading to corrupt.
     * @returns {{chips: Array<object>, legend: Array<object>, surfaceFill: boolean}}
     */
    getRowControls() {
      return { chips: [], legend: energyPrismLegend(_records), surfaceFill: false };
    },

    getStats() {
      const rows = _records.map(energyPrismRow);
      return {
        // Régions actually drawn as prisms. Corse is excluded upstream, so 12
        // is a full house and reporting 13 would imply a coverage that is not
        // there — it gets its striped footprint and its legend row instead.
        count: _records.length,
        // A5, in the HUD as well as in the legend: how many prisms are stuck
        // at the top of the frozen domain and have stopped saying how much.
        clippedRegions: rows.filter((row) => row.clipped).length,
        // Régions the upstream skipped this refresh, Corse aside. Zero on every
        // captured snapshot; not zero is the interesting case.
        unpublishedRegions: rows.filter((row) => !row.hasValue).length,
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
        loadMw: _national.load,
        co2gPerKwh: _national.co2,
        lowCarbonShare: _national.lowCarbonShare,
        // Restated as "France sent this much abroad" — the upstream sign is
        // consumption-minus-generation, which reads backwards in a HUD.
        netExportMw: Number.isFinite(_national.netPhysical) ? -_national.netPhysical : null,
        // Kept separate and separately named: the five commercial balances do
        // not sum to the physical one. See the module header.
        netCommercialExportMw: Number.isFinite(_national.netCommercial)
          ? -_national.netCommercial
          : null,
        topFiliere: _national.topFiliere ? _national.topFiliere.label : null,
        borders: _arcs.length,
        // Licence Ouverte 2.0 obliges the producer AND the last-update date.
        updateTime: _national.at,
        feedSource: _feedSource,
      };
    },
  };

  return layer;
}

const franceEnergyLayer = createFranceEnergyLayer();

export default franceEnergyLayer;
