import * as Cesium from 'cesium';
import { addressMarkerGlyph } from './addressMarkerIcons.js';
import { createAddressScanLayer } from './addressScanLayer.js';
import { clearBuildingTheme, registerBuildingTheme } from './buildingTheme.js';

/**
 * DVF — what the flats around this point actually sold for, on the buildings
 * they sold in.
 *
 * The register is the file a French buyer opens by hand, one commune at a time.
 * Drawn in place it answers the question that survey does not: not "what is the
 * average in the 13th" but "what did the three buildings I can see change hands
 * for, and when".
 *
 * ── WHY SO MANY DOTS ARE NEUTRAL ───────────────────────────────────────────
 *
 * A price per square metre is a comparable only when the sale bought exactly
 * one dwelling. `dvfFeed.js` carries the measurement: one captured mutation is
 * a €32,000,000 building spread over 179 rows, and the obvious arithmetic turns
 * it into €1.28 million per square metre. Those sales are still drawn — they
 * happened — but in the neutral slate, with no ratio. A colour would be a claim
 * the register does not support.
 *
 * That neutral moved from `#7c8aa0` to `#9aa7bd` on 2026-09-03, and the reason
 * is measured, not aesthetic. Since these sales now also paint BUILDING VOLUMES
 * (below), the neutral has to stay distinguishable from `buildingTheme.js`'s
 * "nobody measured this one" wash. Against the six BD TOPO usage colours washed
 * and then darkened across the layer's whole height range, `#7c8aa0` sat at
 * ΔE76 **25.0** — exactly on `BUILDING_THEME_MIN_DELTA_E`, one rounding away
 * from reading as "no data". `#9aa7bd` measures **35.6** against the same set,
 * while staying at least **45.7** from every price class of the ramp. Two
 * different admissions, two colours nobody has to squint at.
 *
 * ── THE DENOMINATOR, AND WHY IT IS NOT THE VIEWPORT ANY MORE (C1) ──────────
 *
 * Until 2026-09-03 each sale was coloured against the median of the sales
 * inside the scan radius — the median of whatever the camera was pointing at.
 * `docs/CARTOGRAPHIE.md` C1 forbids exactly that, and the fixture shows why it
 * is not a theoretical objection: inside ONE arrondissement the local median is
 * 8 857 €/m² from avenue de France and 12 406 €/m² from rue de Tolbiac 1.5 km
 * away, a 40 % swing with no row of data changed. Worse, both the cheapest
 * (6 797 €/m²) and the dearest (12 406 €/m²) sale of the captured sample came
 * out at *exactly* 1.00 × the local median when the camera sat on them — the
 * two extremes of the arrondissement, both painted "average yellow", because
 * the median of one sale is that sale.
 *
 * The ratio itself was never the problem: an absolute €/m² ramp paints all of
 * Paris one colour and stops answering "is this dear FOR HERE". So the fraction
 * stays and the denominator becomes stable and NAMED — the median of the
 * COMMUNE (the arrondissement, where one exists, because that is how DVF itself
 * publishes) over the editions in hand, computed by `dvfFeed.communeReference`
 * from the very rows the proxy already parsed. Against it the same six sales
 * spread across four classes: 6 797 → 0,76 (green), 7 182 → 0,80 (green),
 * 8 857 → 0,99 and 9 054 → 1,01 (yellow), 10 464 → 1,17 (amber), 12 406 → 1,39
 * (red). The extremes stop being average.
 *
 * The denominator is printed in the legend and on every card, because a ratio
 * whose denominator is not written down is not a measurement. It changes when
 * the reader crosses into another commune — which is a change of REFERENCE
 * TERRITORY, announced in the legend, not a phantom of the framing: widening
 * the view, zooming, or sharing the link never moves it. That is the C1
 * conformity test in the doctrine, and `dvfSales.test.mjs` runs it.
 *
 * The class breaks themselves are frozen ratios ({@link DVF_RATIO_BREAKS},
 * ±5 % and ±25 %), never quantiles of the sample, and the legend restates them
 * in €/m² at the current reference so a reader gets the bounds in the unit of
 * the phenomenon as well as in ratio.
 *
 * WHEN THERE IS NO DENOMINATOR. `basis: 'none'` is answered, never a silent
 * substitution — and it is provably unreachable while there is anything to
 * colour: the served sales are a subset of the mutations the reference is
 * computed from, so "no comparable in the commune" implies "no comparable on
 * screen". A sale that somehow arrived with a ratio and no basis is painted
 * `#c46be0` (ΔE76 63.1 from the nearest price class, 66.3 from the wash) and
 * gets its own legend row, because A1 does not admit an unmarked fallback even
 * for a state the test says cannot happen.
 *
 * ── THE VOLUMES (piste 1 de docs/REPRESENTATION.md) ────────────────────────
 *
 * The layer registers a building theme (`buildingTheme.js`, precedence 20) so
 * that when Bâti 3D is on, the BD TOPO volumes carry this same ratio and the
 * street becomes the price map instead of a field of pins above the roofs.
 *
 * • **`reduce` takes the MOST RECENT mutation of the building, not a median of
 *   them.** Several sales on one volume is the normal case, and they are not
 *   contemporaries: the editions in hand span up to five years, so a median
 *   would publish a price that was never asked, at a date that does not exist.
 *   "Worst of the block" — the right answer for a DPE label — has no meaning
 *   here either: there is no bad price, only a high one. What a buyer is handed
 *   as a comparable is the last transaction, so that is what the volume shows.
 *   Ties are broken by the larger dwelling surface, then by mutation id, so the
 *   answer never depends on the order the proxy happened to concatenate its
 *   editions in.
 *
 * • **The most recent mutation wins even when it has no €/m².** Falling back to
 *   the most recent *comparable* one would paint a 2021 price onto a building
 *   that changed hands in 2024 for an undisclosed split — presenting a stale
 *   number as current, which is the worse lie. Instead the volume takes the
 *   neutral slate and its own legend row: "the last thing that happened here
 *   cannot be priced" is information, and it is *not* the same statement as
 *   "nothing happened here", which is the wash.
 *
 * • **The marker stays, at full size.** It is the click surface and the card,
 *   it is the only thing on screen when Bâti 3D is off, and it is drawn for
 *   sales the join cannot place on any volume. It is NOT shrunk when the theme
 *   paints, for two reasons: the layer would have to import the BD TOPO module
 *   to know whether volumes are actually loaded — the one-way coupling the
 *   theme registry exists to avoid — and marker size already carries "has a
 *   comparable €/m²" (19 px) versus "does not" (15 px). Making it also carry
 *   another layer's on/off state is A3, twice over.
 *
 * • **An unpainted volume is not a building nobody bought.** The scan asks the
 *   register about a 300 m disc; BD TOPO loads volumes over a box up to 9 km
 *   wide. Most unpainted volumes were therefore never asked about, so the
 *   theme's `unknownLabel` says "hors du rayon de 300 m ou sans mutation" and
 *   never "sans mutation". Publishing the layer's own reach as a fact about the
 *   market is A1 at the scale of a district.
 *
 * • **This layer does not count the volumes it paints.** The painted /
 *   unpainted tally belongs to whoever owns the geometry, and `bdtopo` prints
 *   it on its own row from the join it actually performed. Re-running the join
 *   here to publish a second number would be 2–9 ms of duplicated work for a
 *   figure that would be WRONG whenever Bâti 3D is off or the photoreal stack
 *   is up: this layer would claim 42 painted volumes with none on screen.
 *   What it publishes is what it knows — how many sales it handed over, how
 *   many of those can carry a colour, and what they are divided by.
 *
 * @module data/dvfSales
 */

/** Layer id — also the theme id in the building-theme registry. */
export const DVF_LAYER_ID = 'dvf-sales';

/** Refresh cadence. Editions are annual; this is about camera movement. */
const UPDATE_INTERVAL_MS = 600_000;
const SCAN_RADIUS_M = 300;

/**
 * Marker size, in CSS px. A sale with a comparable ratio is the one worth
 * reading, so it gets the pixels; a neutral one still has to be visible enough
 * to click, because WHY it has no ratio is on its card.
 */
const SIZE_COMPARABLE_PX = 19;
const SIZE_NO_RATIO_PX = 15;

/**
 * The sale happened, the register cannot price it. Measured ΔE76 35.6 from the
 * nearest "no data" wash of `buildingTheme.js` and 45.7 from the nearest class
 * of the ramp below — see the header for why it is no longer `#7c8aa0`.
 */
export const COLOR_NO_RATIO = '#9aa7bd';

/**
 * The sale has a €/m² and there is no commune median to divide it by. Provably
 * unreachable with a well-formed payload (see the header); painted loudly
 * rather than folded into {@link COLOR_NO_RATIO}, because A1 does not allow one
 * sign for two different admissions.
 */
export const COLOR_NO_BASIS = '#c46be0';

/**
 * The frozen class breaks, in RATIO to the commune median — domain thresholds,
 * published, never quantiles of whatever is on screen (C1).
 *
 * ±5 % is the band inside which two flats in the same street are the same
 * price; ±25 % is where a buyer stops calling it a variation and starts asking
 * what is wrong with it. Five classes, not seven: B3 caps what a reader can
 * separate, and these five measure ΔE76 26.0 (amber/yellow) to 57.4
 * (green/teal) apart, all above the ~10 at which two colours stop sharing a
 * name.
 *
 * Diverging on purpose, and centred on the reference rather than on a range:
 * teal below, yellow at the median, red above. The lightness peak sits at the
 * centre class, which is what a diverging ramp is supposed to do — the ORDER a
 * reader has to recover here is "away from the reference, in which direction",
 * not "more of something".
 */
export const DVF_RATIO_BREAKS = Object.freeze([1.25, 1.05, 0.95, 0.75]);

/** @type {ReadonlyArray<{id: string, min: number, color: string, label: string, blurb: string}>} */
export const DVF_RATIO_CLASSES = Object.freeze([
  Object.freeze({
    id: 'very-high',
    min: 1.25,
    color: '#ff6b4a',
    label: '+25 % et plus',
    blurb: 'Au moins un quart au-dessus du médian de la commune.',
  }),
  Object.freeze({
    id: 'high',
    min: 1.05,
    color: '#ffb03d',
    label: '+5 à +25 %',
    blurb: 'Au-dessus du médian de la commune, hors de la bande d’équivalence.',
  }),
  Object.freeze({
    id: 'at-median',
    min: 0.95,
    color: '#ffe066',
    label: '−5 à +5 % — au médian',
    blurb: 'Dans les 5 % du médian de la commune : le prix courant du territoire.',
  }),
  Object.freeze({
    id: 'low',
    min: 0.75,
    color: '#7ed957',
    label: '−25 à −5 %',
    blurb: 'Sous le médian de la commune, hors de la bande d’équivalence.',
  }),
  Object.freeze({
    id: 'very-low',
    min: -Infinity,
    color: '#3dd6c4',
    label: 'moins de −25 %',
    blurb: 'Au moins un quart sous le médian de la commune.',
  }),
]);

/**
 * The €/m² a colour may be computed from, or null.
 *
 * `prixM2` is already null for everything `dvfFeed.js` refuses to price. The
 * one thing left to refuse here is a ratio of zero: a mutation declared at
 * €0 divides to 0 €/m², which is a finite number the ramp would happily paint
 * as "75 % below the commune" — the same shape of error as the €2,295 swap the
 * feed already rejects. No captured row shows it; the guard is one comparison.
 * @param {?object} sale
 * @returns {?number}
 */
export function saleRatioPrice(sale) {
  const value = sale?.prixM2;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The class a price falls in, against a NAMED reference median.
 * @param {?number} prixM2
 * @param {?number} referenceMedian The commune median. Never a viewport median.
 * @returns {?object} One of {@link DVF_RATIO_CLASSES}, or null.
 */
export function saleRatioClass(prixM2, referenceMedian) {
  if (!(typeof prixM2 === 'number' && Number.isFinite(prixM2) && prixM2 > 0)) return null;
  if (!(typeof referenceMedian === 'number' && Number.isFinite(referenceMedian)
    && referenceMedian > 0)) return null;
  const ratio = prixM2 / referenceMedian;
  return DVF_RATIO_CLASSES.find((entry) => ratio >= entry.min) || null;
}

/**
 * The CSS colour of a sale.
 *
 * THREE outcomes, three signs (A1): a price class, "sold but not priceable",
 * and "priced but nothing named to divide by".
 * @param {?number} prixM2
 * @param {?number} referenceMedian Commune median, from `summary.reference`.
 * @returns {string} `#rrggbb`
 */
export function saleColorCss(prixM2, referenceMedian) {
  if (!(typeof prixM2 === 'number' && Number.isFinite(prixM2) && prixM2 > 0)) return COLOR_NO_RATIO;
  const klass = saleRatioClass(prixM2, referenceMedian);
  return klass ? klass.color : COLOR_NO_BASIS;
}

/**
 * The Cesium colour of a sale marker.
 * @param {?number} prixM2
 * @param {?number} referenceMedian Commune median. NOT the median on screen.
 * @returns {object} Cesium colour.
 */
export function saleColor(prixM2, referenceMedian) {
  return Cesium.Color.fromCssColorString(saleColorCss(prixM2, referenceMedian));
}

/** Format a euro amount the way a French reader expects to see it. */
function euros(value) {
  return Number.isFinite(value) ? `${value.toLocaleString('fr-FR')} €` : '—';
}

/** Format a €/m² the way a French reader expects to see it. */
function eurosPerM2(value) {
  return Number.isFinite(value) ? `${Math.round(value).toLocaleString('fr-FR')} €/m²` : '—';
}

/** `1,39` — two decimals, French separator. */
function ratioText(ratio) {
  return ratio.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Name the editions the reference was computed over.
 * @param {Array<number>} years
 * @returns {?string}
 */
export function dvfYearsLabel(years) {
  const list = [...new Set((Array.isArray(years) ? years : [])
    .map((year) => Number.parseInt(year, 10))
    .filter((year) => Number.isFinite(year)))].sort((a, b) => a - b);
  if (!list.length) return null;
  if (list.length === 1) return `édition ${list[0]}`;
  const contiguous = list[list.length - 1] - list[0] === list.length - 1;
  return contiguous
    ? `éditions ${list[0]} à ${list[list.length - 1]}`
    : `éditions ${list.join(', ')}`;
}

/**
 * The denominator, resolved and named, from the payload the proxy served.
 *
 * `basis` is one of `'commune'` (a median exists), `'none'` (the editions hold
 * no comparable at all) or `'absent'` (the payload carries no reference block —
 * an older cached answer). None of the three is allowed to fall back to the
 * median of what is on screen; the last two colour nothing and say so.
 * @param {?object} payload
 * @returns {object}
 */
export function dvfReference(payload) {
  const raw = payload?.summary?.reference || null;
  const median = typeof raw?.medianPrixM2 === 'number' && Number.isFinite(raw.medianPrixM2)
    && raw.medianPrixM2 > 0
    ? raw.medianPrixM2
    : null;
  const name = raw?.name || payload?.commune?.name || null;
  const code = raw?.code || payload?.commune?.code || null;
  const territory = name || (code ? `commune ${code}` : null);
  const yearsLabel = dvfYearsLabel(payload?.years);
  return {
    basis: raw ? (median === null ? 'none' : 'commune') : 'absent',
    medianPrixM2: median,
    name,
    code,
    territory,
    yearsLabel,
    comparableCount: Number.isFinite(raw?.comparableCount) ? raw.comparableCount : 0,
    count: Number.isFinite(raw?.count) ? raw.count : 0,
    unplacedCount: Number.isFinite(raw?.unplacedCount) ? raw.unplacedCount : 0,
    p25PrixM2: Number.isFinite(raw?.p25PrixM2) ? raw.p25PrixM2 : null,
    p75PrixM2: Number.isFinite(raw?.p75PrixM2) ? raw.p75PrixM2 : null,
    /** The sentence that has to travel with every colour this layer draws. */
    label: median === null
      ? (raw
        ? `Aucun médian pour ${territory || 'cette commune'} : rien à rapporter`
        : 'Dénominateur indisponible : rien à rapporter')
      : `Médian de ${territory || 'la commune'} ${eurosPerM2(median)}`,
  };
}

/**
 * The class breaks restated in €/m² at the current reference.
 *
 * D2 asks for bounds a reader can hold. `≥ 1,25 ×` is the frozen rule; `≥
 * 11 195 €/m²` is what the rule means here, and only the second one can be
 * compared to a listing.
 * @param {?number} referenceMedian
 * @param {object} klass One of {@link DVF_RATIO_CLASSES}.
 * @returns {?string}
 */
function classBoundsText(referenceMedian, klass) {
  if (!(typeof referenceMedian === 'number' && referenceMedian > 0)) return null;
  const index = DVF_RATIO_CLASSES.indexOf(klass);
  const upper = index > 0 ? DVF_RATIO_CLASSES[index - 1].min : null;
  const lower = Number.isFinite(klass.min) ? klass.min : null;
  const lo = lower === null ? null : Math.round(referenceMedian * lower);
  const hi = upper === null ? null : Math.round(referenceMedian * upper);
  if (lo === null) return `moins de ${eurosPerM2(hi)}`;
  if (hi === null) return `${eurosPerM2(lo)} et plus`;
  return `${lo.toLocaleString('fr-FR')} à ${eurosPerM2(hi)}`;
}

/**
 * The key to the ramp (D1).
 *
 * The reference line comes FIRST and carries a count of its own — the number of
 * comparable mutations the median was computed from — because the panel prints
 * a count beside every entry and an entry with none renders `undefined`. It is
 * also the honest thing to show: a median over 6 mutations and a median over
 * 1 700 are not the same promise.
 *
 * `counts` is supplied when the caller knows what was drawn (the layer's own
 * row, counting SALES) and omitted when `buildingTheme.js` will fill it in by
 * matching swatch to painted colour (the Bâti 3D row, counting VOLUMES). Same
 * ramp, two populations, and neither of them invented.
 * @param {object} reference From {@link dvfReference}.
 * @param {?Map<string, number>} counts class id → count, or null.
 * @returns {Array<object>}
 */
export function dvfLegendEntries(reference, counts = null) {
  const entries = [];
  entries.push({
    label: `${reference.label} — mutations comparables`,
    color: null,
    count: reference.comparableCount,
    blurb: [
      'Le dénominateur de toutes les couleurs de cette couche : le médian de la commune',
      reference.yearsLabel ? `sur les ${reference.yearsLabel}` : null,
      '— pas le médian de ce qui est à l’écran. Élargir la vue, zoomer ou partager le lien',
      'ne change aucune couleur (règle C1) ; franchir une limite communale change le',
      'territoire de référence, et cette ligne le dit. Les ventes dessinées, elles, sont',
      `celles des ${SCAN_RADIUS_M} m autour du point scruté : un volume non peint est le plus`,
      'souvent un volume hors de ce rayon, pas un bâtiment sans mutation.',
    ].filter(Boolean).join(' '),
  });
  for (const klass of DVF_RATIO_CLASSES) {
    const bounds = classBoundsText(reference.medianPrixM2, klass);
    const entry = {
      label: bounds ? `${klass.label} · ${bounds}` : klass.label,
      color: klass.color,
      blurb: klass.blurb,
    };
    if (counts) entry.count = counts.get(klass.id) || 0;
    entries.push(entry);
  }
  const neutral = {
    label: 'vente sans €/m² comparable',
    color: COLOR_NO_RATIO,
    blurb: 'Mutation qui a acheté autre chose qu’un seul logement — un immeuble de 179 lots, '
      + 'un appartement avec un commerce — ou un échange. Le registre ne dit pas comment le '
      + 'prix se répartit, donc rien n’est peint : la vente est dessinée, pas évaluée.',
  };
  if (counts) neutral.count = counts.get('no-ratio') || 0;
  entries.push(neutral);
  if (counts && (counts.get('no-basis') || 0) > 0) {
    entries.push({
      label: 'sans médian de référence',
      color: COLOR_NO_BASIS,
      count: counts.get('no-basis') || 0,
      blurb: 'Un prix au m² sans commune à le rapporter. Cet état ne devrait pas exister — '
        + 'les ventes servies sont un sous-ensemble des mutations dont le médian est calculé — '
        + 'et il est peint plutôt que masqué pour qu’il ne passe jamais pour une classe de prix.',
    });
  }
  return entries;
}

/**
 * Compare two mutations by how recent they are. See the header for why recency
 * is the reduction and not the median.
 * @returns {number} > 0 when `a` is the more recent.
 */
function byRecency(a, b) {
  const dateA = String(a?.date || '');
  const dateB = String(b?.date || '');
  // ISO `YYYY-MM-DD`, so a string compare IS a date compare. An empty date
  // sorts below every real one rather than throwing the sale away.
  if (dateA !== dateB) return dateA < dateB ? -1 : 1;
  const surfaceA = Number.isFinite(a?.dwellingSurface) ? a.dwellingSurface : 0;
  const surfaceB = Number.isFinite(b?.dwellingSurface) ? b.dwellingSurface : 0;
  if (surfaceA !== surfaceB) return surfaceA - surfaceB;
  const idA = String(a?.id || '');
  const idB = String(b?.id || '');
  return idA === idB ? 0 : (idA < idB ? -1 : 1);
}

/**
 * N sales on one building → the one the volume speaks for.
 * @param {Array<object>} sales
 * @returns {?object}
 */
export function dvfMostRecentSale(sales) {
  let best = null;
  for (const sale of Array.isArray(sales) ? sales : []) {
    if (!sale) continue;
    if (!best || byRecency(sale, best) > 0) best = sale;
  }
  return best;
}

/* ── the building theme ────────────────────────────────────────────────── */

/**
 * Lower than the default 100 and lower than the permit registers, higher than
 * DPE: when a reader turns on both the energy label and the price, the label is
 * the rarer, more legally loaded reading and keeps the volumes. The number is
 * the layer's claim on the geometry, not a ranking of the datasets.
 */
export const DVF_THEME_PRECEDENCE = 20;

/** The payload the theme currently speaks for, so `enable()` can republish. */
let _themePayload = null;
let _themeEnabled = false;

/**
 * Publish (or withdraw) the theme for the payload in hand.
 *
 * Withdrawing rather than publishing an empty theme is deliberate: a registered
 * theme with no points washes the WHOLE city to near-grey and labels it "sans
 * mutation", which is a statement about the register. When this layer is off,
 * or dormant above its altitude ceiling, it has nothing to say and must hand
 * the volumes back.
 *
 * Nothing here imports the BD TOPO layer. `registerBuildingTheme` notifies it,
 * it repaints itself, and it stops when the theme is cleared — one direction,
 * so a theme can never leave the city painted after its layer is switched off.
 */
function publishTheme() {
  if (!_themeEnabled || !_themePayload) {
    clearBuildingTheme(DVF_LAYER_ID);
    return false;
  }
  const reference = dvfReference(_themePayload);
  const sales = _themePayload.sales || [];
  registerBuildingTheme({
    id: DVF_LAYER_ID,
    label: 'Ventes DVF (€/m²)',
    precedence: DVF_THEME_PRECEDENCE,
    points: sales,
    reduce: dvfMostRecentSale,
    colorFor: (sale) => saleColorCss(saleRatioPrice(sale), reference.medianPrixM2),
    legend: dvfLegendEntries(reference),
    // NOT "sans mutation". The scan asks the register about a 300 m disc while
    // BD TOPO loads volumes over a box up to 9 km wide, so most unpainted
    // volumes were never asked about at all. Labelling them "no sale recorded"
    // would turn the layer's own reach into a statement about the market —
    // the exact shape of A1, applied to a whole city block.
    unknownLabel: `hors du rayon de ${SCAN_RADIUS_M} m ou sans mutation`,
  });
  return true;
}

/** Count the drawn sales by the class they were painted in. */
function countByClass(sales, referenceMedian) {
  const counts = new Map();
  for (const sale of sales || []) {
    const price = saleRatioPrice(sale);
    if (price === null) {
      counts.set('no-ratio', (counts.get('no-ratio') || 0) + 1);
      continue;
    }
    const klass = saleRatioClass(price, referenceMedian);
    const key = klass ? klass.id : 'no-basis';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

const baseLayer = createAddressScanLayer({
  id: DVF_LAYER_ID,
  name: 'Ventes immobilières (DVF)',
  icon: '€',
  source: 'DVF — Etalab / DGFiP',
  endpoint: '/api/dvf',
  updateInterval: UPDATE_INTERVAL_MS,
  params: () => ({ radius: String(SCAN_RADIUS_M) }),

  render({ payload, dataSource }) {
    const reference = dvfReference(payload);
    let drawn = 0;
    for (const sale of payload.sales || []) {
      if (!Number.isFinite(sale.lon) || !Number.isFinite(sale.lat)) continue;
      const price = saleRatioPrice(sale);
      const comparable = price !== null;
      const klass = saleRatioClass(price, reference.medianPrixM2);
      const ratio = comparable && reference.medianPrixM2
        ? price / reference.medianPrixM2
        : null;
      dataSource.entities.add({
        id: `dvf:${sale.id}`,
        position: Cesium.Cartesian3.fromDegrees(sale.lon, sale.lat),
        billboard: {
          // A EURO SIGN, not a disc. Turn this layer on with the DPE layer and
          // both used to draw coloured dots over the same roofs, with nothing
          // to say which register a dot came from — colour was already spent
          // on the price ratio here and on the A–G scale there, so the shape
          // is what carries the source. See `addressMarkerIcons.js`.
          image: addressMarkerGlyph('euro'),
          // Not reduced when the volumes are painted: the marker is the click
          // surface, it is all there is when Bâti 3D is off, and its size
          // already carries "has a comparable €/m²" (A3). See the header.
          width: comparable ? SIZE_COMPARABLE_PX : SIZE_NO_RATIO_PX,
          height: comparable ? SIZE_COMPARABLE_PX : SIZE_NO_RATIO_PX,
          // The glyph is white line-art; this tint IS the price channel, and
          // the same tint the building volume takes.
          color: saleColor(price, reference.medianPrixM2),
          // POSITIVE_INFINITY, not a distance. With a finite value the marker is
          // depth-tested as soon as the camera is further away than that, and
          // the terrain then eats the bottom half of every glyph — the reported
          // symptom was "the dots don't display properly", and at city zoom
          // they were rendering clipped by the ground under them. These are
          // annotations ON the world, not objects IN it.
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: {
          kind: 'dvf-sale',
          prixM2: sale.prixM2,
          comparable,
          ratioClass: klass ? klass.id : null,
          referenceMedianPrixM2: reference.medianPrixM2,
          date: sale.date,
          nature: sale.nature,
          rowCount: sale.rowCount,
        },
        name: sale.address || sale.commune || 'Mutation',
        description: [
          sale.date,
          sale.nature,
          euros(sale.valeur),
          comparable ? eurosPerM2(price)
            // Saying WHY there is no ratio is the point of drawing it neutral.
            : sale.dwellingCount > 1 ? `${sale.dwellingCount} logements — pas de €/m² comparable`
              : 'pas de €/m² comparable',
          // The denominator travels with every single card, never only with
          // the legend: a ratio a reader cannot trace back to a named
          // territory is a decoration.
          ratio === null
            ? (comparable ? reference.label : null)
            : `${ratioText(ratio)} × le médian de ${reference.territory || 'la commune'} `
              + `(${eurosPerM2(reference.medianPrixM2)})`,
          sale.dwellingSurface ? `${sale.dwellingSurface} m²` : null,
          `${sale.distanceM} m`,
        ].filter(Boolean).join(' · '),
      });
      drawn += 1;
    }
    // The theme speaks for the answer that was just drawn, so it is published
    // here rather than from `update()`: `render` is also what a map-stack
    // redraw calls, and the points must never outlive the payload.
    _themePayload = payload;
    publishTheme();
    return drawn;
  },

  /**
   * The key to the ramp, plus the two admissions A5 asks for: what was clipped
   * and what could not be placed.
   */
  rowControls(payload) {
    const reference = dvfReference(payload);
    const sales = payload.sales || [];
    const legend = dvfLegendEntries(reference, countByClass(sales, reference.medianPrixM2));
    const summary = payload.summary || {};
    if (summary.truncated) {
      legend.push({
        label: `écrêté à ${sales.length} sur ${summary.count} — les plus proches`,
        color: null,
        count: Math.max(0, (summary.count || 0) - sales.length),
        blurb: 'Les mutations sont triées par distance au point scruté et la réponse s’arrête '
          + 'au plafond ; celles qui manquent sont les plus lointaines du rayon, jamais les '
          + 'moins chères ni les plus anciennes.',
      });
    }
    if (reference.unplacedCount > 0) {
      legend.push({
        label: 'mutations de la commune sans coordonnée publiée',
        color: null,
        count: reference.unplacedCount,
        blurb: 'Elles ont un prix et pas de position : le registre les publie sans longitude ni '
          + 'latitude. Elles comptent dans le médian de référence et ne peuvent pas être '
          + 'dessinées — un vide de la carte qui n’est pas un vide du marché.',
      });
    }
    return { legend };
  },

  summarize(payload) {
    const summary = payload.summary || {};
    const reference = dvfReference(payload);
    return {
      commune: payload.commune?.name ?? null,
      communeCode: payload.commune?.code ?? null,
      years: payload.years ?? null,
      salesFound: summary.count ?? 0,
      salesServed: summary.served ?? null,
      truncated: summary.truncated === true,
      // The gap between these two is the honesty of the medians below them.
      comparableCount: summary.comparableCount ?? 0,
      // NAMED, both of them. The block statistic and the denominator are two
      // different numbers and neither is allowed to answer to `medianPrixM2`.
      localMedianPrixM2: summary.medianPrixM2 ?? null,
      referenceBasis: reference.basis,
      referenceLabel: reference.label,
      referenceTerritory: reference.territory,
      referenceMedianPrixM2: reference.medianPrixM2,
      referenceComparableCount: reference.comparableCount,
      referenceCount: reference.count,
      referenceUnplacedCount: reference.unplacedCount,
      p25PrixM2: summary.p25PrixM2 ?? null,
      p75PrixM2: summary.p75PrixM2 ?? null,
      perYear: summary.perYear ?? null,
      themeId: DVF_LAYER_ID,
      themePrecedence: DVF_THEME_PRECEDENCE,
      themePoints: (payload.sales || []).length,
      // D1 in the stats as well as in the panel: a caller reading this layer
      // programmatically gets the ramp and its denominator, not just a count.
      legend: dvfLegendEntries(reference, countByClass(payload.sales || [], reference.medianPrixM2)),
    };
  },
});

/**
 * Above `ADDRESS_SCAN_MAX_ALTITUDE_M` the shell clears the draw WITHOUT calling
 * `render`, so nothing in this module would otherwise learn that the answer on
 * screen has been retracted — and a theme built from a block in Paris would go
 * on telling the volumes of whatever city the reader lands in next that no sale
 * was ever recorded there.
 *
 * The reconciliation hangs off `getStats()` because that is the only method the
 * shell exposes that runs after an internal scan (the camera-settled path calls
 * `runScan` directly, never `update`). It is idempotent, it touches nothing
 * unless the layer has gone dormant with a theme still published, and in that
 * exact case `getStats()` is at its cheapest — the shell skips `summarize()`
 * when there is no payload.
 * @param {object} stats
 * @returns {object} the same stats
 */
function withdrawIfDormant(stats) {
  if (stats?.dormant && _themePayload) {
    _themePayload = null;
    publishTheme();
  }
  return stats;
}

/**
 * The layer, wrapped so that switching it off also hands the volumes back.
 *
 * `createAddressScanLayer` has no lifecycle hook for this, and it is a shared
 * file this module does not own — so the composition happens here, where the
 * theme is. Every method of the base layer closes over its own state rather
 * than `this`, so spreading it is safe.
 */
const dvfSalesLayer = {
  ...baseLayer,

  init(viewer) {
    _themePayload = null;
    _themeEnabled = false;
    clearBuildingTheme(DVF_LAYER_ID);
    baseLayer.init(viewer);
  },

  getStats() {
    return withdrawIfDormant(baseLayer.getStats());
  },

  enable(viewer) {
    _themeEnabled = true;
    baseLayer.enable(viewer);
    // Republish what is already in hand: a layer switched off and on again
    // repaints immediately instead of waiting for the next scan.
    publishTheme();
  },

  disable() {
    _themeEnabled = false;
    _themePayload = null;
    publishTheme();
    baseLayer.disable();
  },

  destroy(viewer) {
    _themeEnabled = false;
    _themePayload = null;
    publishTheme();
    baseLayer.destroy(viewer);
  },

  async update(viewer, options) {
    const result = await baseLayer.update(viewer, options);
    // The authoritative moment, and the one that still runs when the panel is
    // hidden and `getStats()` is not being polled.
    withdrawIfDormant(baseLayer.getStats());
    return result;
  },
};

/** Test seam: the dormancy reconciliation, without a camera. */
export function _dvfWithdrawIfDormantForTest(stats) {
  return withdrawIfDormant(stats);
}

/** Test seam: drive the theme without a viewer. */
export function _dvfSetThemePayloadForTest(payload, enabled = true) {
  _themeEnabled = enabled;
  _themePayload = payload;
  return publishTheme();
}

export default dvfSalesLayer;
