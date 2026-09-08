/**
 * Avis de valeur — the one piece of Cityscan that is not a data licence.
 *
 * WHAT THIS IS. Given a point, a dwelling type and a surface, this module reads
 * the DVF editions already in hand and answers what that dwelling is worth,
 * with the interval it is worth it inside. `docs/CITYSCAN.md` puts the
 * estimator at the top of palier 2 and says why: of the eleven data routes
 * behind `app.cityscan.fr`, not one carries a source we do not already have —
 * their own translation file credits *« Source : Algorithme »* for exactly one
 * module, the estimate. The register is public, the arithmetic is not. This
 * file is the arithmetic, written down.
 *
 * ── THE RULE THIS FILE IS ORGANISED AROUND ──────────────────────────────────
 *
 * **A price is never published without the interval it sits in, and the
 * interval is never published without saying which uncertainty it measures.**
 * Two different ones are computed here and they are never merged:
 *
 *  · `prixM2.p25`–`prixM2.p75` — WHERE COMPARABLE GOODS ACTUALLY TRADED, per
 *    square metre. Half the retained sales landed inside it. It does not shrink
 *    with more data, because it is not an error bar: it is the market's own
 *    spread. It is also NOT a bound on the subject — a central 50 % band of
 *    comparable sales says nothing about where one particular flat's floor,
 *    state, view and orientation put it, and claiming it does would be the
 *    quiet way of turning a description into a promise. This is the band a
 *    seller reads; it is not a range this dwelling is guaranteed to sell in.
 *
 *  · `prixM2.ci90` — HOW WELL THE CENTRE ITSELF IS KNOWN. A distribution-free
 *    interval for the median, taken from the order statistics of the retained
 *    sample (below). It shrinks as comparables accumulate. It is an interval
 *    about the LOCAL MARKET'S MEDIAN, not about the subject: it says how firm
 *    the middle of the band is, not where in the band this particular flat is.
 *
 * A product that prints one number and calls it an estimate has collapsed both
 * of these into a decoration.
 *
 * ── THE THREE ANSWERS, AND WHY THE FLOOR IS FIVE ────────────────────────────
 *
 * `basis` is `'comparables'`, `'range'` or `'none'`, and the three are three
 * different sentences, never one dressed as another (A1):
 *
 *  · `'comparables'` — a centre and a band.
 *  · `'range'` — the band, and NO centre, because the centre is not known well
 *    enough to print as a number. Said out loud, with the reason.
 *  · `'none'` — nothing. Not "0 €", not the commune median borrowed silently.
 *
 * The floor of five is DERIVED, not chosen. The interval on the median is the
 * classical distribution-free one: for a sample of `n`, `[x(k), x(n+1-k)]`
 * covers the population median with probability `1 - 2·P(Bin(n, ½) < k)`. At
 * n = 4 the widest such interval — the whole sample, min to max — covers only
 * 87.5 %, so **no 90 % interval exists at all**; at n = 5 it is 93.8 %. Five is
 * where the arithmetic starts, so five is where the answer starts. The rank
 * table this produces, for α = 0.10:
 *
 *   n     4  →  no interval        n   12  →  [x₂, x₉]     96.1 %
 *   n     5  →  [x₀, x₄]   93.8 %  n   20  →  [x₅, x₁₄]    95.9 %
 *   n     6  →  [x₀, x₅]   96.9 %  n   30  →  [x₁₀, x₁₉]   90.1 %
 *   n     8  →  [x₁, x₆]   93.0 %  n   50  →  [x₁₈, x₃₁]   93.5 %
 *
 * Those are nominal coverages, and nominal coverage is a promise a fixture can
 * call. Resampled 3 000 times from the 4 192 Paris 13e flat sales of editions
 * 2023–2025, the interval covered the true median **93.6 % of the time at
 * n = 5, 93.0 % at n = 8, 96.9 % at n = 12, 90.8 % at n = 30** — every one of
 * them within a point of what the binomial says. Measured over Rodez's 1 214
 * sales as well: 94.2 / 92.9 / 95.9 / 89.8. The interval is calibrated on the
 * actual shape of French price data, not merely asserted.
 *
 * Its WIDTH at that floor is the reason the floor alone is not enough: at
 * n = 5 the interval spans **±26 % of the median in Paris and ±33 % in Rodez**,
 * and that is the symmetric reading — the further of its two ends is worse
 * still. Which is why a second gate decides whether the centre is printed.
 *
 * ── THE GATE ON THE CENTRE, IN TWO CLAUSES ──────────────────────────────────
 *
 * A centre is printed only when both hold:
 *
 *  1. **The centre is known STRICTLY better than the market's own spread** —
 *     the 90 % interval on the median is narrower than `p75 - p25`. If we know
 *     the middle no more precisely than the market is dispersed, the middle
 *     adds nothing the band was not already saying. This clause has no constant
 *     in it; it compares the two intervals the answer already carries.
 *
 *     Strictly, because the equality case is the degenerate one: a sample with
 *     no spread has `p75 - p25 = 0` and an interval of width 0, and a `>`
 *     comparison published « 1 000 €/m², ±0 % » from twelve identical prices
 *     with 96 % confidence attached. Measured on the two-atom law below,
 *     tightening `>` to `>=` lifted coverage across all rungs from 82.3 % to
 *     89.8 % and halved the number of centres published, while moving the
 *     measured coverage on real French price laws by at most 0.5 point.
 *  2. **±20 % of the median, at most — measured at the FURTHER endpoint.** A
 *     reader's floor, not a statistician's: a number that could be a fifth out
 *     is not a number. It is the clause that fires where clause 1 passes on a
 *     market so wide that both intervals are useless together.
 *
 *     Gating on HALF THE WIDTH, which is what this did first, is wrong on an
 *     interval built from order statistics: twenty comparables at 600 × 6,
 *     1 000 × 10 and 1 400 × 4 give a median of 1 000 and an interval of
 *     [600, 1 000] — half-width 20 %, lower endpoint **40 % below the median**
 *     — and the card then printed « ±20 % » over it. Both ends are published
 *     separately ({@link ciDeviationPct}) for the same reason.
 *
 * Measured on real ground, the two clauses catch different things. Around
 * Aurillac at 300 m, 43 sales give a median of 973 €/m² at ±22.6 % — clause 1
 * passes, clause 2 rejects, the ladder widens to 600 m and answers 1 333 €/m²
 * at ±8.2 %. The 300 m answer was not merely imprecise: it was 37 % away from
 * the one 159 sales agree on. At Biarritz (64547) 1 500 m gives 7 sales, ±33 %,
 * an interval WIDER than the interquartile range — clause 1 rejects, the
 * commune rung answers 4 127 €/m² at ±6.9 %.
 *
 * ── WHAT THE INTERVAL ASSUMES, AND WHAT SELECTING A RUNG COSTS IT ───────────
 *
 * Two disclosures the arithmetic does not make on its own.
 *
 * **"Distribution-free" removes an assumption about SHAPE, not about SAMPLING.**
 * The interval is exact for `n` INDEPENDENT draws from a population. The
 * comparables are not that: they are a near-census of the transactions that
 * happened to occur in one pocket over three editions. So the honest reading is
 * a model — *the sales observed behave as an independent draw from the price
 * law of this pocket* — and the interval is exact under it, not under the world.
 * What the interval is emphatically NOT is a statement about the subject: it
 * bounds the MEDIAN of a local market, and the individual dwelling's floor,
 * state, view and orientation are not in it. That is what the p25–p75 band is
 * for, and even that is a description of where comparable goods traded, never a
 * bound on this one.
 *
 * **The rung is chosen with the same prices that then set the interval's
 * width**, which is a selection effect and can only lower the real coverage.
 * Measured, by resampling each commune's OWN price law onto its OWN geography,
 * 4 000 draws each: post-selection coverage **92.5 % (Paris 13e, flat 60 m²),
 * 91.9 % (Rodez, flat 65 m²), 92.0 % (Rodez, house 110 m²), 92.8 % (Biarritz,
 * house 110 m²)** against nominals of 90.1 to 96.9 %. On real French price laws
 * the ladder costs a point or two, no more.
 *
 * On a law built to break it, it costs everything. Two atoms — 49.5 % at
 * 1 000 €/m², 49.5 % at 10 000, population median 5 500 with almost no
 * observation near it — and the same procedure over 10 000 draws covers 89.8 %
 * across all rungs and **0 % across the 931 centres it agrees to publish**: the
 * gate keeps exactly the samples that landed wholly on one atom. No in-sample
 * test can catch it, and that is the point worth writing down rather than
 * patching — those samples are not internally suspicious, they are simply
 * unrepresentative draws. The shape that produces it is a commune whose two
 * halves are two markets (a seafront and a back country, a resort and its
 * valley), and it is the shape to distrust this number on.
 *
 * ── THE LADDER, AND WHY DISTANCE WIDENS BEFORE SURFACE ──────────────────────
 *
 * {@link AVIS_RUNGS} walks from "this block" to "this commune", and the order
 * is a measured decision rather than a taste. Widening the SURFACE BAND is the
 * expensive move, because price per square metre falls with size and the bias
 * lands inside the median without ever showing:
 *
 *   flats near 60 m², median €/m² below 60 m² against at or above it,
 *   editions 2023–2025 —
 *     band ±20 %   Paris 13e −3.0 %   Lille −4.0 %   Ajaccio −13.3 %
 *     band ±35 %   Paris 13e −3.6 %   Lille −10.7 %  Ajaccio −20.4 %
 *
 * Widening the RADIUS costs the "is this dear for HERE" premise, which is a
 * real cost — but it is a cost the answer DECLARES: the radius is printed, the
 * comparables are drawn, and the reader sees the reach that produced the
 * number. A surface bias is invisible. So the ladder spends distance first and
 * only reaches for ±35 % when the whole commune at ±20 % has not delivered.
 *
 * ── WHAT IS EXCLUDED, AND COUNTED ───────────────────────────────────────────
 *
 * `dvfFeed.js` already refuses a price per square metre for anything that did
 * not buy exactly one dwelling — the 179-lot block sale, the flat sold with a
 * shop, the €2,295 swap. Two exclusions are added here:
 *
 *  · **VEFA.** A *vente en l'état futur d'achèvement* is a sale of a dwelling
 *    that does not exist yet: it carries a delivery delay, a builder's
 *    warranty and reduced transfer duties, and it is not the market a standing
 *    flat trades in. Measured on Paris 13e over editions 2021–2025, 225 VEFA
 *    mutations, of which **9 carry a €/m² at all** — and those nine price at
 *    **13 077 €/m² against 9 150 for ordinary resale, +43 %**. Excluding them
 *    costs nine comparables out of 7 468 and removes a systematic bias. They
 *    are counted in `excluded.vefa` and named, because a count nobody sees is
 *    an exclusion nobody can argue with.
 *
 *  · **The other dwelling type.** A house and a flat do not share a €/m². The
 *    house's price also carries its plot, which is why {@link projectAvisValeur}
 *    reports the retained sample's median `terrain` for `Maison` rather than
 *    pretending the plot was normalised: it was not.
 *
 *  · **The one-euro flat.** `valeur_fonciere` is sometimes 1, and `round(1/40)`
 *    is **0, not null** — so the ratio survives every guard `dvfFeed.js` has
 *    and arrives here as a number. Measured over editions 2023–2025: **7 such
 *    mutations in Paris 13e, 6 in Bordeaux, 6 in Lille, 1 in Aurillac**, among
 *    them a 166 m² flat on place Pinel declared at one euro. They are excluded
 *    and counted in `excluded.zeroPrice`.
 *
 * WHAT IS **NOT** EXCLUDED, and this is a decision rather than an oversight:
 * the low tail above zero. Across 31 609 priced resales in nine communes, the
 * declared values run 1 € → 160 € → 400 € → 1 800 € → 3 000 € → 4 950 € →
 * 20 000 € with **no break anywhere** — 0.06 % at or below 1 €, 0.16 % at or
 * below 1 000 €, 0.44 % at or below 10 000 €. Any cut drawn in that continuum
 * would be a plausibility model wearing a constant's clothes, and it would
 * delete real sales: a 132 m² house at 38 €/m² in the Pyrénées-Atlantiques and
 * a 417 €/m² house in the Lozère are both in the register and both are
 * somebody's actual transaction. The median and the quartiles absorb a 0.4 %
 * contamination on their own, and the answer REPORTS what it kept —
 * `symbolicCount` counts the retained comparables declared under
 * {@link AVIS_SYMBOLIC_VALUE_EUR} — so a thin sample carrying one is visible
 * rather than quietly averaged.
 *
 * ── THE INDEX THAT IS NOT HERE, AND THE MEASUREMENT THAT KILLED IT ──────────
 *
 * The obvious next move is to restate every comparable in the money of the most
 * recent edition, through a commune-year index. It was measured, and it is not
 * worth its own noise over a three-edition window.
 *
 * The drift to correct, commune median €/m² 2023 → 2025: **Paris 13e −4.3 %,
 * Bordeaux −9.2 %, Lille −3.6 %, Rodez −0.5 %, Ajaccio +1.6 %.** A median
 * comparable in a three-edition window is about eighteen months old, so the
 * residual bias of not correcting is roughly half of that — **2 to 5 %.**
 *
 * The noise the correction would add: a commune-year median is itself a median
 * of a sample, and the same interval computed above puts it at **±7 to ±11 % at
 * 30 sales in the year, ±6 to ±10 % at 50.** Dividing one noisy median by
 * another to fix a 4 % drift injects more error than it removes everywhere
 * except in the handful of communes with four-figure yearly volumes.
 *
 * So the drift is **measured and printed instead of applied** ({@link
 * communeDrift}): the card carries the commune's own per-edition medians, and
 * when the window has moved by {@link AVIS_DRIFT_LOUD_PCT} or more the answer
 * says so in its own field rather than burying it. A reader who can see
 * −9.2 % over three years knows what an eighteen-month-old comparable is worth;
 * a reader handed a silently "corrected" number knows nothing at all.
 *
 * ── THE HOLE IN THE REGISTER NOBODY ANNOUNCES ───────────────────────────────
 *
 * DVF does not cover the Bas-Rhin, the Haut-Rhin, the Moselle or Mayotte — the
 * *livre foncier* départements, whose transfers are recorded by a different
 * administration. Measured 2026-09-08 on the 2024 edition: `67482` (Strasbourg),
 * `57463` (Metz), `68224` (Mulhouse) and `97611` (Mamoudzou) all answer **404**,
 * while `97411` (Saint-Denis de La Réunion) answers 200 with 647 KB. That is
 * three million people for whom the honest answer is "the register does not
 * reach here", and it is emphatically NOT the same sentence as "no comparable
 * sale was found". {@link dvfCoverage} separates them, and `basis: 'none'`
 * carries the reason.
 *
 * Dependency-free and side-effect-free. The `/api/avis-valeur` proxy imports
 * this; nothing in the browser bundle does.
 *
 * @module data/avisValeurFeed
 */

import { dvfCoverage, haversineM, percentile } from './dvfFeed.js';

/** The two local types the register prices as a dwelling, as a subject. */
export const AVIS_TYPES = Object.freeze(['Appartement', 'Maison']);

/**
 * The subject surfaces the layer offers, in m².
 *
 * ENUMERATED because everything reachable from a chip is also reachable from a
 * share link, and `addressScanLayer.js` takes closed sets only. Four anchors
 * rather than a slider: the surface does not merely multiply the answer, it
 * CHOOSES THE COMPARABLE BAND — 30 m² and 150 m² are two different markets in
 * the same street, measured at up to a 62 % gap in €/m² in Ajaccio — so an
 * anchor has to be a size class a reader recognises, not an arbitrary number.
 */
export const AVIS_SUBJECT_SURFACES = Object.freeze([30, 60, 100, 150]);

/** The subject the layer asks about until the reader says otherwise. */
export const AVIS_DEFAULT_TYPE = 'Appartement';
export const AVIS_DEFAULT_SURFACE = 60;

/**
 * The widening ladder. Distance first, surface band last — see the header for
 * the measurement behind that order.
 *
 * `radiusM: null` means "the whole commune", which is the widest question these
 * editions can answer: the proxy holds commune-year files, so there is no rung
 * past the commune boundary that would not cost another download and another
 * territory's name.
 */
export const AVIS_RUNGS = Object.freeze([
  Object.freeze({ id: 'block', radiusM: 300, band: 0.20, label: '300 m, ±20 % de surface' }),
  Object.freeze({ id: 'quarter', radiusM: 600, band: 0.20, label: '600 m, ±20 % de surface' }),
  Object.freeze({ id: 'district', radiusM: 1500, band: 0.20, label: '1,5 km, ±20 % de surface' }),
  Object.freeze({ id: 'commune', radiusM: null, band: 0.20, label: 'toute la commune, ±20 % de surface' }),
  Object.freeze({ id: 'commune-wide-band', radiusM: null, band: 0.35, label: 'toute la commune, ±35 % de surface' }),
]);

/** Confidence level of the interval on the median. */
export const AVIS_CI_ALPHA = 0.10;

/**
 * The smallest sample a 90 % distribution-free interval exists for. DERIVED:
 * at n = 4 the whole sample covers the median with probability 0.875 only.
 */
export const AVIS_MIN_COMPARABLES = 5;

/**
 * The reader's floor on the interval about the median, as a fraction of it.
 * Clause 2 of the gate; clause 1 has no constant. See the header.
 *
 * Measured against the FURTHER ENDPOINT, not against half the width. The
 * interval is built from order statistics and is asymmetric whenever the
 * sample is — twenty comparables at 600 × 6, 1 000 × 10, 1 400 × 4 give a
 * median of 1 000 and an interval of [600, 1 000], whose half-width is 20 % of
 * the median and whose lower bound is **40 % below it**. Gating on the
 * half-width let that through and then printed « ±20 % » over it.
 */
export const AVIS_MAX_CI_DEVIATION = 0.20;

/**
 * Comparables in one commune-edition below which its median is too soft to
 * quote as a drift reading. At 30 the interval on a commune-year median
 * measures ±7 % (Paris) to ±11 % (Rodez); below it the number is a rumour.
 */
export const AVIS_DRIFT_MIN_PER_YEAR = 30;

/** Drift across the window past which the answer says so unprompted. */
export const AVIS_DRIFT_LOUD_PCT = 10;

/**
 * Declared value under which a retained comparable is COUNTED as symbolic —
 * never dropped. See the header for why the tail is reported and not trimmed.
 */
export const AVIS_SYMBOLIC_VALUE_EUR = 10_000;

/**
 * Ceiling on comparables SERVED. The statistics are computed over every
 * retained sale; this bounds only what travels and what is drawn, nearest
 * first, and the gap is reported (A5).
 */
export const AVIS_MAX_SERVED = 200;

/**
 * The rank `k` of the order statistics bounding the median, and the coverage
 * that rank actually buys.
 *
 * `[x(k), x(n+1-k)]` — one-indexed, so `[sorted[k-1], sorted[n-k]]` here —
 * covers the population median with probability `1 - 2·P(Bin(n, ½) ≤ k-1)`.
 * The largest admissible `k` gives the TIGHTEST interval still meeting the
 * level, so the search walks down from the middle.
 *
 * The binomial tail is accumulated in LOG SPACE, and that is not fastidiousness:
 * `2 ** n` overflows to `Infinity` at n = 1024, and the naive form then returns
 * either a comically narrow interval or the whole sample depending on which of
 * `Infinity / Infinity` or `x / Infinity` it hits first. A Paris commune rung
 * reaches 1 802 comparables, which is well past that.
 *
 * @param {number} n Sample size.
 * @param {number} [alpha] Two-sided miss probability.
 * @returns {?{k: number, coverage: number}} Null when no such interval exists.
 */
export function medianCiRank(n, alpha = AVIS_CI_ALPHA) {
  const size = Number.isInteger(n) ? n : Math.floor(n);
  if (!Number.isFinite(size) || size < 1) return null;
  const target = Math.log(alpha / 2);
  const logHalf = Math.log(0.5);
  // log P(X = 0) = n·log(½); then log P(X = i) = log P(X = i-1) + log((n-i+1)/i).
  let logPmf = size * logHalf;
  let logCdf = logPmf;
  let best = null;
  const limit = Math.floor(size / 2);
  for (let i = 0; i <= limit; i += 1) {
    if (i > 0) {
      logPmf += Math.log((size - i + 1) / i);
      // log(a + b) = log a + log1p(exp(log b - log a)), taking the larger first.
      const [hi, lo] = logCdf > logPmf ? [logCdf, logPmf] : [logPmf, logCdf];
      logCdf = hi + Math.log1p(Math.exp(lo - hi));
    }
    if (logCdf > target) break;
    best = { k: i + 1, coverage: 1 - 2 * Math.exp(logCdf) };
  }
  return best;
}

/**
 * The distribution-free interval on the median of a sorted sample.
 *
 * @param {number[]} sorted Ascending, finite.
 * @param {number} [alpha]
 * @returns {?{lo: number, hi: number, coverage: number, k: number}}
 */
export function medianCi(sorted, alpha = AVIS_CI_ALPHA) {
  if (!Array.isArray(sorted) || sorted.length < AVIS_MIN_COMPARABLES) return null;
  const rank = medianCiRank(sorted.length, alpha);
  if (!rank) return null;
  return {
    lo: sorted[rank.k - 1],
    hi: sorted[sorted.length - rank.k],
    coverage: rank.coverage,
    k: rank.k,
  };
}

/**
 * Does this sample's centre deserve to be printed as a number?
 *
 * Both clauses of the gate, in one place so that neither can be applied without
 * the other. Returns the verdict AND the clause that decided it, because the
 * card has to name the reason a centre was withheld.
 *
 * @param {{median: ?number, p25: ?number, p75: ?number, ci90: ?object}} stats
 * @returns {{publish: boolean, reason: ?string}}
 */
export function centreVerdict({ median, p25, p75, ci90 }) {
  if (!Number.isFinite(median) || median <= 0 || !ci90) {
    return { publish: false, reason: 'sample-too-small' };
  }
  const width = ci90.hi - ci90.lo;
  const iqr = Number.isFinite(p25) && Number.isFinite(p75) ? p75 - p25 : null;
  // `>=`, not `>`, and the equality is the whole point: a sample with no spread
  // has `iqr === 0` AND `width === 0`, so a strict comparison let a DEGENERATE
  // interval through — twelve sales all at 1 000 €/m² published « 1 000 €/m²,
  // ±0 % » with 96 % confidence. Requiring the interval to be strictly narrower
  // than the market's own spread refuses that, and refuses its near neighbour
  // (eleven at one price, one somewhere else) for the same reason.
  if (iqr !== null && width >= iqr) return { publish: false, reason: 'centre-softer-than-market' };
  // The FURTHER endpoint, never half the width — see the constant.
  const deviation = Math.max(median - ci90.lo, ci90.hi - median) / median;
  if (deviation > AVIS_MAX_CI_DEVIATION) return { publish: false, reason: 'interval-too-wide' };
  return { publish: true, reason: null };
}

/**
 * How far each end of the interval sits from the median, in per cent.
 *
 * Two numbers rather than one, because the interval is asymmetric whenever the
 * sample is and a single `±` over an asymmetric interval understates one side.
 * `max` is the quantity {@link centreVerdict} gates on.
 *
 * @param {?number} median @param {?object} ci90
 * @returns {?{low: number, high: number, max: number}} Percentages, one decimal.
 */
export function ciDeviationPct(median, ci90) {
  if (!Number.isFinite(median) || median <= 0 || !ci90) return null;
  const round = (value) => Math.round(value * 1000) / 10;
  const low = round((median - ci90.lo) / median);
  const high = round((ci90.hi - median) / median);
  return { low, high, max: Math.max(low, high) };
}

/** Ascending copy of the finite, positive €/m² of a set of mutations. */
function pricesOf(mutations) {
  const prices = [];
  for (const mutation of mutations) {
    const price = mutation?.prixM2;
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) prices.push(price);
  }
  return prices.sort((a, b) => a - b);
}

/**
 * The commune's own per-edition median €/m², and how far the window moved.
 *
 * Computed for ONE dwelling type, because flats and houses do not drift
 * together, and over `Vente` only, for the same reason VEFA is excluded from
 * the comparables. An edition with fewer than {@link AVIS_DRIFT_MIN_PER_YEAR}
 * comparables is reported with its count and NO median: a reading that thin is
 * refused rather than averaged into a trend line.
 *
 * This is a measurement, never a correction — see the header for the numbers
 * that decided that.
 *
 * @param {Array<object>} mutations Whole editions in hand.
 * @param {string} type One of {@link AVIS_TYPES}.
 * @returns {{basis: string, perYear: Array<object>, pct: ?number, loud: boolean,
 *   fromYear: ?string, toYear: ?string}}
 */
export function communeDrift(mutations, type) {
  const byYear = new Map();
  for (const mutation of Array.isArray(mutations) ? mutations : []) {
    if (mutation?.nature !== 'Vente') continue;
    if (!Array.isArray(mutation?.types) || !mutation.types.includes(type)) continue;
    const year = String(mutation.date || '').slice(0, 4);
    if (!/^\d{4}$/.test(year)) continue;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(mutation);
  }
  const perYear = [...byYear.entries()]
    .map(([year, list]) => {
      const prices = pricesOf(list);
      const enough = prices.length >= AVIS_DRIFT_MIN_PER_YEAR;
      return {
        year,
        count: list.length,
        comparableCount: prices.length,
        medianPrixM2: enough ? percentile(prices, 0.5) : null,
      };
    })
    .sort((a, b) => (a.year < b.year ? -1 : 1));
  const solid = perYear.filter((entry) => entry.medianPrixM2 !== null);
  if (solid.length < 2) {
    return { basis: 'none', perYear, pct: null, loud: false, fromYear: null, toYear: null };
  }
  const first = solid[0];
  const last = solid[solid.length - 1];
  const pct = Math.round((last.medianPrixM2 / first.medianPrixM2 - 1) * 1000) / 10;
  return {
    basis: 'commune-year',
    perYear,
    pct,
    loud: Math.abs(pct) >= AVIS_DRIFT_LOUD_PCT,
    fromYear: first.year,
    toYear: last.year,
  };
}

/**
 * The mutations that could ever be a comparable for this subject, and a tally
 * of everything the filter threw away.
 *
 * Split out from the ladder so the exclusions are counted ONCE, over the whole
 * commune, rather than re-counted per rung with a different denominator each
 * time — a count that changes when the radius does is not an exclusion, it is
 * a side effect.
 *
 * @param {Array<object>} mutations
 * @param {{type: string}} subject
 * @returns {{pool: Array<object>, excluded: object}}
 */
export function comparablePool(mutations, subject) {
  const pool = [];
  const excluded = {
    notPriceable: 0, vefa: 0, otherType: 0, unplaced: 0, zeroPrice: 0, duplicate: 0,
  };
  // ONE MUTATION, ONE COMPARABLE. The proxy concatenates editions, so a
  // repeated `years=` value used to hand the same sale in twice and buy a
  // narrower interval with it. The route now deduplicates the years; this is
  // the guard that makes the arithmetic true whatever the route hands over,
  // because sample size is the one input this module cannot sanity-check from
  // the inside.
  const seen = new Set();
  for (const mutation of Array.isArray(mutations) ? mutations : []) {
    if (!mutation) continue;
    const id = mutation.id ? String(mutation.id) : null;
    if (id) {
      if (seen.has(id)) { excluded.duplicate += 1; continue; }
      seen.add(id);
    }
    const price = mutation.prixM2;
    const priceable = typeof price === 'number' && Number.isFinite(price);
    if (!priceable) {
      // A block sale, a flat sold with a shop, a swap, an auction. The reason
      // lives in `dvfFeed.js`; the count lives here.
      excluded.notPriceable += 1;
      continue;
    }
    // `round(1 / 40)` is 0, and 0 is a number: the one-euro flat clears every
    // guard upstream and would sit in the sample as a free apartment.
    if (price <= 0) { excluded.zeroPrice += 1; continue; }
    // `!== 'Vente'` IS "is a VEFA" here, and the counter may say so: only
    // `dvfFeed.PRICED_NATURES` carries a non-null ratio, and it holds exactly
    // `Vente` and the VEFA. An auction or a swap has already been counted as
    // `notPriceable` two lines up.
    if (mutation.nature !== 'Vente') { excluded.vefa += 1; continue; }
    if (!Array.isArray(mutation.types) || !mutation.types.includes(subject.type)) {
      excluded.otherType += 1;
      continue;
    }
    if (!Number.isFinite(mutation.lon) || !Number.isFinite(mutation.lat)) {
      // It has a price and no position: it can never be tested against a
      // radius, and pretending it was inside one would put a sale on a street
      // the register never named.
      excluded.unplaced += 1;
      continue;
    }
    pool.push(mutation);
  }
  return { pool, excluded };
}

/**
 * Summarise a retained set into the two intervals and the verdict on its centre.
 * @param {Array<object>} kept
 * @returns {object}
 */
function summariseKept(kept) {
  const prices = pricesOf(kept);
  const median = percentile(prices, 0.5);
  const p25 = percentile(prices, 0.25);
  const p75 = percentile(prices, 0.75);
  const ci90 = medianCi(prices);
  const verdict = centreVerdict({ median, p25, p75, ci90 });
  const surfaces = kept.map((sale) => sale.dwellingSurface)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  return {
    count: prices.length,
    median,
    p25,
    p75,
    min: prices.length ? prices[0] : null,
    max: prices.length ? prices[prices.length - 1] : null,
    ci90,
    verdict,
    surfaceMedian: percentile(surfaces, 0.5),
    // Kept, and said. Not a filter — see the header on the low tail.
    symbolicCount: kept.filter((sale) => Number.isFinite(sale?.valeur)
      && sale.valeur <= AVIS_SYMBOLIC_VALUE_EUR).length,
  };
}

/**
 * Walk the ladder and stop at the first rung whose centre may be printed.
 *
 * Every rung tried is REPORTED, with its count and the clause that rejected it,
 * because "we had to go out to the whole commune to answer this" is part of the
 * answer. When no rung passes the gate, the widest rung that reached the floor
 * is returned with `basis: 'range'` — the widest rather than the first, because
 * once we are admitting we cannot name a centre, the band with the most sales
 * behind it is the one that describes the market rather than an accident of a
 * thin circle.
 *
 * @param {Array<object>} pool From {@link comparablePool}.
 * @param {{lon: number, lat: number, type: string, surfaceM2: number}} subject
 * @returns {{basis: string, rung: ?object, kept: Array<object>, stats: ?object,
 *   tried: Array<object>}}
 */
export function walkLadder(pool, subject) {
  const tried = [];
  let widestWithFloor = null;
  for (const rung of AVIS_RUNGS) {
    const lo = subject.surfaceM2 * (1 - rung.band);
    const hi = subject.surfaceM2 * (1 + rung.band);
    const kept = [];
    for (const mutation of pool) {
      const surface = mutation.dwellingSurface;
      if (!(surface >= lo && surface <= hi)) continue;
      const distanceM = Math.round(haversineM(subject.lat, subject.lon, mutation.lat, mutation.lon));
      if (rung.radiusM !== null && distanceM > rung.radiusM) continue;
      kept.push({ ...mutation, distanceM });
    }
    kept.sort((a, b) => a.distanceM - b.distanceM);
    const stats = summariseKept(kept);
    tried.push({
      id: rung.id,
      radiusM: rung.radiusM,
      band: rung.band,
      label: rung.label,
      count: stats.count,
      reason: stats.count < AVIS_MIN_COMPARABLES ? 'below-floor' : stats.verdict.reason,
    });
    if (stats.count >= AVIS_MIN_COMPARABLES) widestWithFloor = { rung, kept, stats };
    if (stats.count >= AVIS_MIN_COMPARABLES && stats.verdict.publish) {
      return { basis: 'comparables', rung, kept, stats, tried };
    }
  }
  if (widestWithFloor) {
    return {
      basis: 'range',
      rung: widestWithFloor.rung,
      kept: widestWithFloor.kept,
      stats: widestWithFloor.stats,
      tried,
    };
  }
  return { basis: 'none', rung: null, kept: [], stats: null, tried };
}

/**
 * Round a euro amount to a precision the interval can actually support.
 *
 * A median of 8 682 €/m² over 60 m² is 520 920 €, and printing it to the euro
 * claims six significant figures out of a sample of sixty. Three is what a
 * ±4 % interval can carry, so three is what is kept.
 *
 * THE STEP IS DERIVED FROM THE MAGNITUDE, not written as a ladder of
 * thresholds, and that is the fix rather than the style. A flat 1 000 € step
 * below a million rounded every positive total under 500 € to **zero**: twenty
 * retained sales at 1 €/m² over a 60 m² subject published a median, two
 * quartiles and both interval bounds all reading « 0 € » beside a card saying
 * 1 €/m². Those prices are real — the low tail is deliberately kept and counted
 * rather than trimmed (see the header) — so the rounding, not the data, had to
 * change. `Math.max(magnitude, …)` closes the last hole: a positive amount
 * never rounds to nothing.
 * @param {?number} value
 * @returns {?number}
 */
export function roundValeur(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(value)) - 2);
  return Math.max(magnitude, Math.round(value / magnitude) * magnitude);
}

/** The €-total block that mirrors a €/m² block, at the subject's surface. */
function valeurBlock(prixM2, surfaceM2) {
  const at = (value) => (Number.isFinite(value) ? roundValeur(value * surfaceM2) : null);
  return {
    median: at(prixM2.median),
    p25: at(prixM2.p25),
    p75: at(prixM2.p75),
    ci90: prixM2.ci90 ? { lo: at(prixM2.ci90.lo), hi: at(prixM2.ci90.hi) } : null,
  };
}

/**
 * Validate a requested subject, rejecting rather than clamping.
 *
 * Everything here arrives from a query string that a share link can carry, so
 * an out-of-enum value is a stranger choosing what this browser asks for. It is
 * REFUSED — the same rule `addressScanLayer.js` states for runtime params — and
 * never snapped to the nearest plausible neighbour, because a subject silently
 * moved from 47 m² to 60 m² would publish an answer to a question nobody asked.
 *
 * @param {{type: unknown, surface: unknown}} query
 * @returns {{type: string, surfaceM2: number}}
 * @throws {Error} When either field is outside its closed set.
 */
export function parseAvisSubject({ type, surface }) {
  const requestedType = type === undefined || type === null || String(type).trim() === ''
    ? AVIS_DEFAULT_TYPE
    : String(type).trim();
  if (!AVIS_TYPES.includes(requestedType)) {
    throw new Error(`avis-valeur: type ${requestedType} is not one of ${AVIS_TYPES.join(', ')}`);
  }
  const rawSurface = surface === undefined || surface === null ? '' : String(surface).trim();
  // DIGITS ONLY, tested before parsing. `Number.parseInt('60; DROP', 10)` is
  // 60: it stops at the first character it does not like and hands back a
  // value from the closed set, so a hostile string would have been ACCEPTED by
  // an enum check placed after the parse. Found by the test that asserts this
  // very string is refused.
  const requestedSurface = rawSurface === '' ? AVIS_DEFAULT_SURFACE
    : (/^\d{1,4}$/.test(rawSurface) ? Number.parseInt(rawSurface, 10) : Number.NaN);
  if (!AVIS_SUBJECT_SURFACES.includes(requestedSurface)) {
    throw new Error(`avis-valeur: surface ${surface} is not one of ${AVIS_SUBJECT_SURFACES.join(', ')}`);
  }
  return { type: requestedType, surfaceM2: requestedSurface };
}

/**
 * The whole answer, from the editions in hand.
 *
 * @param {object} input
 * @param {Array<object>} input.mutations Whole commune-year editions, from
 *   `groupMutations`. NOT a radius selection: the exclusions, the drift and the
 *   commune rung all need the territory, not the circle.
 * @param {{lon: number, lat: number, type: string, surfaceM2: number}} input.subject
 * @param {?{code: string, name: string}} [input.commune]
 * @param {Array<number>} [input.years] The editions the caller loaded.
 * @returns {object} The `/api/avis-valeur` payload.
 */
export function projectAvisValeur({ mutations, subject, commune = null, years = [] }) {
  const coverage = dvfCoverage(commune?.code ?? null);
  const { pool, excluded } = comparablePool(mutations, subject);
  const { basis, rung, kept, stats, tried } = walkLadder(pool, subject);
  const drift = communeDrift(mutations, subject.type);

  const served = kept.slice(0, AVIS_MAX_SERVED);
  const comparables = served.map((sale) => ({
    id: sale.id,
    lon: sale.lon,
    lat: sale.lat,
    date: sale.date,
    prixM2: sale.prixM2,
    valeur: sale.valeur,
    surface: sale.dwellingSurface,
    rooms: sale.rooms,
    terrain: sale.terrain || 0,
    address: sale.address,
    distanceM: sale.distanceM,
  }));

  const terrains = kept.map((sale) => sale.terrain)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  const prixM2 = stats
    ? {
      // NULL when the gate withheld it. Not "the median anyway, quietly" —
      // the whole point of `basis: 'range'` is that this field is empty.
      median: basis === 'comparables' ? stats.median : null,
      p25: stats.p25,
      p75: stats.p75,
      min: stats.min,
      max: stats.max,
      ci90: stats.ci90,
      // Both ends, because the interval is asymmetric whenever the sample is.
      ciDeviationPct: ciDeviationPct(stats.median, stats.ci90),
      // The centre the gate refused, carried under its own name so a caller can
      // say "we can see a middle, we will not print it as a price" without
      // reaching back into the sample.
      withheldMedian: basis === 'comparables' ? null : stats.median,
    }
    : null;

  return {
    subject: { ...subject },
    commune,
    years: [...years],
    coverage,
    estimate: {
      basis,
      // Why there is no centre, in the caller's words rather than a code.
      reason: basis === 'comparables' ? null
        : basis === 'range' ? (stats?.verdict?.reason ?? null)
          : (coverage.basis === 'livre-foncier' ? 'register-does-not-cover' : 'no-comparable'),
      count: stats?.count ?? 0,
      rung: rung ? { id: rung.id, radiusM: rung.radiusM, band: rung.band, label: rung.label } : null,
      tried,
      prixM2,
      valeur: prixM2 ? valeurBlock(prixM2, subject.surfaceM2) : null,
      // Is the sample actually centred on the subject? A band is symmetric in
      // metres and the market inside it is not, so a 60 m² subject can end up
      // with comparables whose median is 52 m². Printed, not corrected.
      surfaceMedian: stats?.surfaceMedian ?? null,
      symbolicCount: stats?.symbolicCount ?? 0,
      // Only for a house, and only ever as a caveat: the plot is inside the
      // price and nothing here normalises it.
      terrainMedian: subject.type === 'Maison' ? percentile(terrains, 0.5) : null,
    },
    drift,
    excluded,
    poolCount: pool.length,
    comparables,
    served: comparables.length,
    truncated: kept.length > comparables.length,
  };
}
