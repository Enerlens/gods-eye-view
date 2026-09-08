import { greatCircleKm } from './trafficBounds.js';

/**
 * Le dossier de comparables — ce que le conseiller a choisi, et rien d'autre.
 *
 * WHAT THIS IS, AND WHY IT IS NOT A FEED. Every other layer in this repository
 * asks a public service a question. This one asks the reader. It holds one
 * property under study and the comparables retained against it, half of them
 * picked out of DVF and half of them keyed in from listings the advisor is
 * looking at — and it computes what a valuation note computes: a price per
 * square metre per comparable, a median, a spread, and the gap between what is
 * asked and what is paid.
 *
 * WHY A HUMAN SELECTION IS THE PRODUCT AND NOT A SHORTCUT. `docs/CITYSCAN.md`
 * records the finding this module is built on: Cityscan's own public
 * translation file names the source of its comparables, and it is
 * « Sélection de votre conseiller(ère) parmi les portails d'annonces ». Their
 * comparables module holds no listing database. It holds a screen where the
 * advisor chooses. The state of the art of the competitor is a selection
 * interface, so a selection interface is what this is.
 *
 * THE ROUTE THIS MODULE REFUSES TO TAKE. Building a national listing base by
 * extraction is the one thing in that triage that is genuinely closed, and the
 * price of forcing it is published: Cass. 1re civ., 5 oct. 2022 n° 21-16.307
 * (leboncoin's listings are a protected sub-base in their own right),
 * Cass. 1re civ., 15 oct. 2025 n° 23-23.167 (verification investments count),
 * CA Versailles, 14 avr. 2026 n° 24/05370 (200 000 €, plus 500 € per listing
 * under penalty). The text-and-data-mining exception does not cover it either:
 * L122-5-3 and L342-3 CPI permit copies made FOR mining, subject to the
 * rightsholder's opt-out, and never the reuse of a substantial part.
 *
 * The consequence is written into the code and not only into a document:
 * {@link safeListingUrl} keeps a listing's address as a LINK, and nothing in
 * this repository ever requests it. The URL is there so a reader can open the
 * page they already had open; it is never a fetch target, and the panel says so
 * out loud.
 *
 * ── THE ONE THING THIS DOES THAT THE COMPETITOR DOES NOT ───────────────────
 *
 * A listing price and a transaction price are not the same measurement, and a
 * valuation note that medians them together says so nowhere. Doctrine A1 —
 * never the same sign for a measured value and a default — extends to this
 * cleanly: an asking price is an INTENTION and a mutation is an OBSERVATION,
 * so they are counted apart, drawn apart, and the difference between the two
 * medians is printed as its own line — with both sample sizes beside it, and
 * with the sentence that refuses the words a reader would otherwise supply:
 * it is not a negotiation margin. It is the distance between what is being
 * asked for one set of properties and what was paid for another, at another
 * time, with no temporal adjustment applied to either.
 *
 * WHAT IS REFUSED, AND COUNTED WHILE BEING REFUSED (A5). No ratio without a
 * surface. No ratio recomputed for a DVF mutation that bought more than one
 * dwelling — `dvfFeed.js` already measured what that arithmetic produces
 * (€1.28 million per square metre for a 179-lot building), so the register's
 * own null is carried through rather than second-guessed. No ratio outside
 * {@link PRIX_M2_BOUNDS}, because the failure mode of typing is a keystroke,
 * and one 20 000 000 €/m² typo moves a median more than every honest entry in
 * the dossier. Every one of those exclusions is counted and printed.
 *
 * WHAT LEAVES THE BROWSER, EXACTLY. The dossier does not: it lives in
 * `localStorage`, moves by file, and there is no account, no backend and no
 * upload — which is why the share link carries the layer's on/off state and
 * nothing else (see `layerState.js`). But « rien ne quitte le navigateur » was
 * too round a sentence to be true, and an adversarial pass said so: THREE
 * things do go out, and each is named on screen rather than in a comment.
 * The ADDRESS a reader types goes to `/api/geocode` and to the BAN reverse
 * endpoint, because turning an address into a coordinate is what those are
 * for. The SCAN POINT goes to `/api/dvf`. No price, no surface, no listing
 * link and no dossier ever does. The distinction matters: an address is the
 * one field a client would recognise, and a reader deserves the precise
 * sentence rather than the flattering one.
 *
 * @module data/comparablesDossier
 */

/** localStorage key. Versioned, so a schema change cannot half-read an old one. */
export const COMPARABLES_STORAGE_KEY = 'godsEyeView.comparables.v1';

/** Schema version written into every export. */
export const COMPARABLES_SCHEMA_VERSION = 1;

/** The two things a comparable can be, and they are not the same measurement. */
export const COMPARABLE_KINDS = Object.freeze(['vente', 'annonce']);

/**
 * Plausibility bounds on a price per square metre, in €/m².
 *
 * NOT a market judgement — a filter on typing. The cheapest communes of France
 * trade under 500 €/m² and the most expensive Paris addresses over 30 000, so
 * the bounds are set wide enough that no real address in the country is caught
 * by them. What they catch is the missing zero and the extra one: a price typed
 * into the surface field, a surface typed in hectares, a listing at 320 000 €
 * entered as 320 000 000. Anything outside is excluded from every statistic AND
 * counted in {@link dossierSummary}, because a silent exclusion is the failure
 * this repository refuses everywhere else.
 */
export const PRIX_M2_BOUNDS = Object.freeze({ min: 300, max: 50_000 });

/**
 * Below this many ratio-bearing comparables there is no range to print.
 *
 * Three, and not one, because the product of this module is a BRACKET. With one
 * comparable the quartiles are that comparable, and a range whose two ends are
 * the same number reads as a precision nobody measured.
 */
export const MIN_RATIO_SAMPLE = 3;

/** Under this count the range is printed, and told it is short. */
export const SHORT_RATIO_SAMPLE = 5;

/** Days after which a keyed-in listing is called old on the card. */
export const STALE_LISTING_DAYS = 180;

/**
 * Largest subject surface the estimate will multiply, in m².
 *
 * A guard against arithmetic, not against architecture: `1e308` typed into the
 * surface field produced an estimate of `Infinity` and a badge reading
 * « Infinity k€ ». Ten hectares of floor area is past any dwelling and past
 * most buildings, so anything above it is a keystroke.
 */
export const MAX_SURFACE_M2 = 100_000;

/** Cap on the candidate sales the panel offers. Declared, per A5. */
export const CANDIDATE_LIMIT = 24;

const _fr = new Intl.NumberFormat('fr-FR');

/** @param {?number} value */
function money(value) {
  return Number.isFinite(value) ? `${_fr.format(Math.round(value))} €` : '—';
}

/** @param {?number} value A whole quantity — people, rows, metres. */
function count(value) {
  return Number.isFinite(value) ? _fr.format(Math.round(value)) : '—';
}

/**
 * A measured quantity, keeping the decimal the reader typed.
 *
 * Surfaces go through here and counts do not: a 70,4 m² flat was printed
 * « 70,4 m² » in the panel row and « 70 m² » on the card, from the same field,
 * while the arithmetic used 70,4. Two numbers on screen for one measurement is
 * a reader wondering which one the estimate used.
 *
 * @param {?number} value
 * @returns {string}
 */
function amount(value) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
    : '—';
}

/**
 * Agree a word with its count, in French.
 *
 * Not decoration. This card is what an advisor puts in front of a client, and
 * « 1 annonces saisies » is the sentence that tells them the tool was written
 * by nobody in particular. Zero takes the singular, which is the French rule
 * and not the English one.
 *
 * @param {number} n
 * @param {string} one Singular form.
 * @param {string} [many] Plural, when it is not the singular plus an s.
 * @returns {string}
 */
export function agree(n, one, many = `${one}s`) {
  return Math.abs(Number(n) || 0) >= 2 ? many : one;
}

/**
 * A number as the reader typed it, or null.
 *
 * Accepts what a French keyboard produces — thin spaces, non-breaking spaces,
 * a comma for the decimal separator — because refusing "320 000,50" and
 * calling it "not a number" would be blaming the reader for the locale.
 *
 * @param {unknown} value
 * @returns {?number}
 */
export function parseNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let cleaned = String(value)
    .replace(/[\s  ]/g, '')
    .replace(/[€]/g, '')
    .trim();
  // « 1.234,56 » is how a French export writes a number, and it used to parse
  // as nothing at all: the comma became a dot, `1.234.56` is not a number, and
  // a real price arrived on the card as « sans prix ». When BOTH separators are
  // present the dot is the thousands mark and the comma is the decimal.
  if (cleaned.includes(',') && cleaned.includes('.')) cleaned = cleaned.replace(/\./g, '');
  cleaned = cleaned.replace(',', '.');
  if (cleaned === '') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A listing URL, kept as a REFERENCE and never as a fetch target.
 *
 * Only `http` and `https` survive. A `javascript:` or `data:` string in a field
 * that ends up in an anchor is the oldest injection there is, and this one is
 * typed by a user and rendered by us. The link is opened by the reader's own
 * click, in their own browser, on a page they already have open — that is the
 * whole extent of what this application does with a portal.
 *
 * @param {unknown} raw
 * @returns {?string}
 */
export function safeListingUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * The portal a listing was read on, as free text.
 *
 * Derived from the URL's host when the reader gave one and said nothing else,
 * because "seloger.com" is what they would have typed anyway. Never used to
 * fetch anything; it is a label on a row.
 *
 * @param {?string} url
 * @returns {?string}
 */
export function portalFromUrl(url) {
  const safe = safeListingUrl(url);
  if (!safe) return null;
  try {
    return new URL(safe).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** Metres between two positioned things, or null when either has no position. */
export function distanceMetres(from, to) {
  if (!Number.isFinite(from?.lat) || !Number.isFinite(from?.lon)) return null;
  if (!Number.isFinite(to?.lat) || !Number.isFinite(to?.lon)) return null;
  return Math.round(greatCircleKm(from.lat, from.lon, to.lat, to.lon) * 1000);
}

/** Whole days between an ISO date and `now`, or null. */
export function ageDays(isoDate, now = Date.now()) {
  const text = String(isoDate ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const stamp = Date.parse(`${text}T00:00:00Z`);
  if (!Number.isFinite(stamp)) return null;
  return Math.floor((now - stamp) / 86_400_000);
}

/** A date as a French reader writes it. */
export function frenchDate(isoDate) {
  const text = String(isoDate ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Identifier for a row that arrived without one.
 *
 * DERIVED FROM THE CONTENT, not from a clock and a random number, and that is a
 * deduplication rule rather than a naming preference: an agency export carries
 * no id of ours, so importing the same file twice produced two comparables —
 * and three imports of a one-row file unlocked a three-sample bracket built
 * from one listing. Same kind, same address, same price, same surface, same
 * date is the same listing; {@link mergeComparables} then refuses it by id.
 *
 * A genuine second sale at the same address on the same day for the same price
 * is the collision this accepts, and it is the right trade: the reader sees the
 * row in the panel and can add the second by hand, whereas a silently doubled
 * sample is invisible.
 *
 * @param {object} parts
 * @returns {string}
 */
function derivedId({ kind, label, price, surface, date }) {
  const seed = [kind, label, price, surface, date].join('|');
  let hash = 5381;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (((hash << 5) + hash) ^ seed.charCodeAt(index)) >>> 0;
  }
  return `saisie-${hash.toString(36)}`;
}

/** An empty dossier — the state the layer starts in and returns to. */
export function emptyDossier() {
  return {
    version: COMPARABLES_SCHEMA_VERSION,
    subject: null,
    comparables: [],
  };
}

/**
 * Decide a comparable's price per square metre, or the reason it has none.
 *
 * `given` is the register's own answer and is NEVER recomputed when it is
 * present: DVF publishes null for a mutation that bought more than one
 * dwelling, and dividing anyway is the arithmetic `dvfFeed.js` measured at
 * €1.28 million per square metre.
 *
 * @param {{price: ?number, surface: ?number, kind: string, given: ?number,
 *   lots: ?number}} input
 * @returns {{prixM2: ?number, refused: ?string}}
 */
export function ratioFor({
  price, surface, kind, given = null, lots = null, refused = null,
}) {
  const inBounds = (value) => value >= PRIX_M2_BOUNDS.min && value <= PRIX_M2_BOUNDS.max;
  if (kind === 'vente') {
    // THE LOT COUNT IS CHECKED BEFORE THE RATIO, not after. A supplied ratio
    // used to win outright, which is right for a payload DVF built — the
    // register only publishes one when the mutation bought exactly one
    // dwelling — and wrong for anything else that can reach this function.
    // A file claiming `kind: 'vente'`, `dwellingCount: 2`, `prixM2: 10000`
    // entered the SALE median at 10 000 €/m² with no exclusion counted. The
    // register's rule is now enforced here rather than assumed upstream.
    if (Number.isFinite(lots) && lots !== 1) return { prixM2: null, refused: 'lots' };
    if (Number.isFinite(given) && Number.isFinite(price) && price <= 0) {
      return { prixM2: null, refused: 'prix' };
    }
    if (Number.isFinite(given)) {
      // Bounds BEFORE rounding: 299,6 €/m² rounded to 300 used to slip past
      // its own floor.
      return inBounds(given)
        ? { prixM2: Math.round(given), refused: null }
        : { prixM2: null, refused: 'bornes' };
    }
    // WHY A CARRIED REASON WINS HERE. Normalising is not idempotent without
    // it: a sale refused for `bornes` has a null ratio, so a second pass —
    // which is exactly what retaining a candidate does — re-derived the reason
    // from what was left and printed « 1 sans surface » beside a row showing
    // 100 m². The reason belongs to the row, not to the pass.
    if (refused) return { prixM2: null, refused };
    return { prixM2: null, refused: Number.isFinite(surface) && surface > 0 ? 'lots' : 'surface' };
  }
  if (!Number.isFinite(price) || price <= 0) return { prixM2: null, refused: 'prix' };
  if (!Number.isFinite(surface) || surface <= 0) return { prixM2: null, refused: 'surface' };
  const ratio = price / surface;
  if (!inBounds(ratio)) return { prixM2: null, refused: 'bornes' };
  return { prixM2: Math.round(ratio), refused: null };
}

/**
 * Normalise anything claiming to be a comparable into the one shape drawn,
 * counted and stored.
 *
 * Returns null only for a row that carries no usable identity at all. A row
 * with no position is KEPT — it still bears a price and a surface, so it still
 * belongs in the median, and the summary says how many of those there are
 * rather than dropping them where nobody can see the drop.
 *
 * @param {object} raw
 * @returns {?object}
 */
export function normaliseComparable(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = COMPARABLE_KINDS.includes(raw.kind) ? raw.kind : 'annonce';
  const label = String(raw.label ?? raw.adresse ?? raw.address ?? '').trim().slice(0, 160);
  const price = parseNumber(raw.price ?? raw.prix ?? raw.valeur);
  const surface = parseNumber(raw.surface ?? raw.surfaceM2 ?? raw.surface_reelle_bati);
  const lat = parseNumber(raw.lat ?? raw.latitude);
  const lon = parseNumber(raw.lon ?? raw.longitude);
  const rooms = parseNumber(raw.rooms ?? raw.pieces ?? raw.nombre_pieces_principales);
  const type = String(raw.type ?? '').trim().slice(0, 40) || null;
  const date = /^\d{4}-\d{2}-\d{2}/.test(String(raw.date ?? ''))
    ? String(raw.date).slice(0, 10)
    : null;
  const url = safeListingUrl(raw.url);
  const lots = parseNumber(raw.lots ?? raw.dwellingCount);
  const { prixM2, refused } = ratioFor({
    price,
    surface,
    kind,
    given: parseNumber(raw.prixM2),
    lots,
    // Carried so a second pass over an already-normalised row keeps the reason
    // the first pass established — see {@link ratioFor}.
    refused: typeof raw.ratioRefused === 'string' ? raw.ratioRefused : null,
  });
  if (!label && !Number.isFinite(price) && !Number.isFinite(prixM2)) return null;
  return {
    id: String(raw.id ?? '').trim() || derivedId({ kind, label, price, surface, date }),
    kind,
    label: label || (kind === 'vente' ? 'Vente sans adresse publiée' : 'Annonce sans adresse'),
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    price: Number.isFinite(price) ? price : null,
    surface: Number.isFinite(surface) ? surface : null,
    rooms: Number.isFinite(rooms) ? rooms : null,
    type,
    date,
    url,
    portal: String(raw.portal ?? '').trim().slice(0, 60) || portalFromUrl(url),
    note: String(raw.note ?? '').trim().slice(0, 240) || null,
    lots: Number.isFinite(lots) ? lots : null,
    prixM2,
    // Why this row carries no ratio. Printed, never swallowed.
    ratioRefused: refused,
    // A row is in the estimate and on the map, or it is in neither. The default
    // is in: a comparable the reader added is one they meant to use.
    retained: raw.retained !== false,
    source: kind === 'vente' ? 'DVF' : 'saisie',
  };
}

/**
 * One DVF mutation, as a comparable the advisor may retain.
 *
 * The register's own `prixM2` is carried across untouched — see
 * {@link ratioFor}. The mutation id is prefixed so a retained sale and a keyed
 * row can never collide in the dossier.
 *
 * @param {object} sale A member of `/api/dvf`'s `sales` array.
 * @returns {?object}
 */
export function comparableFromDvfSale(sale) {
  if (!sale || typeof sale !== 'object') return null;
  return normaliseComparable({
    id: `dvf:${sale.id}`,
    kind: 'vente',
    label: sale.address ? `${sale.address}, ${sale.commune ?? ''}`.replace(/,\s*$/, '') : sale.commune,
    lat: sale.lat,
    lon: sale.lon,
    price: sale.valeur,
    surface: sale.dwellingSurface || null,
    rooms: sale.rooms,
    type: Array.isArray(sale.types) && sale.types.length ? sale.types.join(' + ') : null,
    date: sale.date,
    prixM2: sale.prixM2,
    lots: sale.dwellingCount,
  });
}

/**
 * A quantile of a sorted sample, interpolated and NOT rounded.
 *
 * The same linear interpolation as `dvfFeed.percentile()`, minus its final
 * `Math.round()`, and the difference is not cosmetic here: that function
 * answers in €/m², where a rounded euro is the unit anyone reads, while these
 * quantiles get MULTIPLIED BY A SURFACE before they become the number a client
 * sees. Rounding first moved a printed bracket by 50 to 100 € for a 100 m²
 * flat — 250 200 € where the sample says 250 150 € — for no reason a reader
 * could see or check. Rounded once, at the end, when euros become euros.
 *
 * Local rather than a change to the shared helper: six other layers print that
 * helper's output directly, in €/m², where its rounding is correct.
 *
 * @param {number[]} sorted
 * @param {number} fraction
 * @returns {?number}
 */
export function quantile(sorted, fraction) {
  if (!Array.isArray(sorted) || sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/**
 * The statistics of one sample, and what the sample left out.
 *
 * `withRatio` beside `count` on purpose, for the reason `dvfFeed.js` states:
 * a reader must be able to see that eight comparables were retained and only
 * five of them yielded a defensible price per square metre.
 *
 * @param {Array<object>} entries
 * @returns {{count: number, withRatio: number, median: ?number, p25: ?number,
 *   p75: ?number, min: ?number, max: ?number, refused: Record<string, number>,
 *   unplaced: number}}
 */
export function sampleStats(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const ratios = [];
  const refused = {};
  let unplaced = 0;
  for (const entry of list) {
    if (Number.isFinite(entry?.prixM2)) ratios.push(entry.prixM2);
    else if (entry?.ratioRefused) refused[entry.ratioRefused] = (refused[entry.ratioRefused] ?? 0) + 1;
    if (!Number.isFinite(entry?.lat) || !Number.isFinite(entry?.lon)) unplaced += 1;
  }
  ratios.sort((a, b) => a - b);
  return {
    count: list.length,
    withRatio: ratios.length,
    median: quantile(ratios, 0.5),
    p25: quantile(ratios, 0.25),
    p75: quantile(ratios, 0.75),
    min: ratios.length ? ratios[0] : null,
    max: ratios.length ? ratios[ratios.length - 1] : null,
    refused,
    unplaced,
  };
}

/**
 * The dossier, reduced to the numbers a valuation note is written from.
 *
 * TWO SAMPLES, NEVER ONE. `ventes` are observations and `annonces` are
 * intentions; the summary computes each on its own and reports the distance
 * between them rather than a single median nobody could interpret. The
 * ESTIMATE follows from that: it is computed on the sales when there are
 * enough of them, on the listings when there are not, and it is labelled with
 * which — because an estimate built on asking prices is an estimate of what
 * the property would be ASKED for.
 *
 * @param {object} dossier
 * @param {{now?: number}} [options]
 * @returns {object}
 */
export function dossierSummary(dossier, { now = Date.now() } = {}) {
  const subject = dossier?.subject ?? null;
  const all = Array.isArray(dossier?.comparables) ? dossier.comparables : [];
  const retained = all.filter((entry) => entry?.retained !== false);
  const ventes = sampleStats(retained.filter((entry) => entry.kind === 'vente'));
  const annonces = sampleStats(retained.filter((entry) => entry.kind === 'annonce'));

  const basis = ventes.withRatio >= MIN_RATIO_SAMPLE
    ? 'ventes'
    : (annonces.withRatio >= MIN_RATIO_SAMPLE ? 'annonces' : null);
  const chosen = basis === 'ventes' ? ventes : (basis === 'annonces' ? annonces : null);
  const surface = parseNumber(subject?.surface);
  const usableSurface = Number.isFinite(surface) && surface > 0 && surface <= MAX_SURFACE_M2;
  const estimate = chosen && usableSurface && chosen.median !== null
    ? {
      basis,
      sample: chosen.withRatio,
      short: chosen.withRatio < SHORT_RATIO_SAMPLE,
      // ROUNDED ONCE, AT THE END. Rounding each €/m² quartile first and
      // multiplying second moved a printed bracket by tens of euros for no
      // reason a reader could see — 250 200 € where the sample says 250 150 €.
      // The ratios keep their decimals here and the euros are rounded when
      // they become euros.
      low: Math.round(chosen.p25 * surface),
      mid: Math.round(chosen.median * surface),
      high: Math.round(chosen.p75 * surface),
    }
    : null;

  // The distance between the two instruments, and it only exists when both
  // answered. NOT a negotiation margin, whatever it looks like: these are
  // different properties at different dates with no temporal adjustment, and
  // the line that prints it says so.
  const gapPercent = ventes.median !== null && annonces.median !== null && ventes.median > 0
    ? Math.round(((annonces.median - ventes.median) / ventes.median) * 1000) / 10
    : null;

  // `Math.max(...list)` throws `RangeError: Maximum call stack size exceeded`
  // on a long enough dossier — reproduced at 150 000 rows, which an import can
  // reach — so the maxima are folded rather than spread.
  const maxOf = (list) => list.reduce(
    (best, value) => (Number.isFinite(value) && (best === null || value > best) ? value : best),
    null,
  );
  const distances = retained.map((entry) => distanceMetres(subject, entry));
  const ages = retained.map((entry) => ageDays(entry.date, now));
  const staleListings = retained.filter((entry) => entry.kind === 'annonce'
    && (ageDays(entry.date, now) ?? 0) > STALE_LISTING_DAYS).length;

  return {
    subject: subject
      ? {
        label: subject.label ?? null,
        commune: subject.commune ?? null,
        lat: subject.lat ?? null,
        lon: subject.lon ?? null,
        surface: Number.isFinite(surface) ? surface : null,
        rooms: parseNumber(subject.rooms),
        type: subject.type ?? null,
      }
      : null,
    total: all.length,
    retained: retained.length,
    ventes,
    annonces,
    basis,
    estimate,
    gapPercent,
    staleListings,
    maxDistanceM: maxOf(distances),
    oldestDays: maxOf(ages),
    unplaced: ventes.unplaced + annonces.unplaced,
    // Split, because the sentence about them is not the same: an unplaced row
    // that BEARS a ratio really is counted in a median, and one that does not
    // is absent from everything and was being told it counted.
    unplacedCounted: retained.filter((entry) => (!Number.isFinite(entry.lat)
      || !Number.isFinite(entry.lon)) && Number.isFinite(entry.prixM2)).length,
  };
}

/** How many rows each refusal reason accounts for, both samples together. */
function mergedRefusals(summary) {
  const merged = {};
  for (const sample of [summary.ventes, summary.annonces]) {
    for (const [reason, n] of Object.entries(sample.refused)) {
      merged[reason] = (merged[reason] ?? 0) + n;
    }
  }
  return merged;
}

/**
 * The wording of one refusal reason, agreed with how many rows it accounts for.
 * @param {string} reason
 * @param {number} [n]
 * @returns {string}
 */
export function refusalWords(reason, n = 1) {
  switch (reason) {
    case 'surface': return 'sans surface';
    case 'prix': return 'sans prix';
    case 'lots': return `${agree(n, 'vente')} de plusieurs lots`;
    case 'bornes':
      return `hors bornes ${PRIX_M2_BOUNDS.min}–${_fr.format(PRIX_M2_BOUNDS.max)} €/m²`;
    default: return reason;
  }
}

/**
 * Take the card separator out of a line, and keep taking it out.
 *
 * ONE PASS IS NOT ENOUGH, and the failure is a label a reader can type. A
 * single `replaceAll(' · ', ' — ')` is non-overlapping: « A · · B » has one
 * match at the first separator, and the replacement puts a space in front of
 * the surviving dot — so the line leaves here still carrying « · » and
 * `cardFromEntity()` splits the sentence in two on screen. Repeat until the
 * string stops changing, which is at most a couple of passes because every
 * pass strictly reduces the number of dots.
 *
 * @param {string} line
 * @returns {string}
 */
export function sanitiseLine(line) {
  let out = String(line ?? '');
  while (out.includes(' · ')) out = out.replaceAll(' · ', ' — ');
  return out;
}

/**
 * The dossier as the lines a card prints.
 *
 * NO LINE MAY CONTAIN ' · '. `cardFromEntity()` splits an entity description on
 * that separator, so a line carrying one arrives on screen as two fragments —
 * and the fragment this would break is the estimate, which is the one sentence
 * on the card that must never be read half-way. Inside a line the separator is
 * a comma or an em dash. `comparablesDossier.test.mjs` asserts it.
 *
 * Pure and exported so the wording is tested rather than eyeballed: these
 * sentences are the whole product, and a line that overstated the sample would
 * be the whole failure.
 *
 * @param {object} dossier
 * @param {{now?: number}} [options]
 * @returns {string[]}
 */
export function dossierLines(dossier, { now = Date.now() } = {}) {
  const summary = dossierSummary(dossier, { now });
  const lines = [];
  const subject = summary.subject;

  if (subject) {
    const traits = [
      Number.isFinite(subject.surface) ? `${amount(subject.surface)} m²` : null,
      Number.isFinite(subject.rooms) ? `${count(subject.rooms)} ${agree(subject.rooms, 'pièce')}` : null,
      subject.type,
    ].filter(Boolean);
    lines.push(`Bien étudié — ${subject.label || 'point posé sur la carte'}`
      + (traits.length ? ` (${traits.join(', ')})` : ''));
  } else {
    lines.push('Aucun bien défini — posez le bien avant de retenir des comparables');
  }

  if (summary.retained === 0) {
    lines.push('Aucun comparable retenu — le dossier est vide');
    return lines.map(sanitiseLine);
  }

  const dropped = summary.total - summary.retained;
  lines.push(`${count(summary.retained)} ${agree(summary.retained, 'comparable')}`
    + ` ${agree(summary.retained, 'retenu')}`
    + ` — ${count(summary.ventes.count)} ${agree(summary.ventes.count, 'vente')} DVF`
    + `, ${count(summary.annonces.count)} ${agree(summary.annonces.count, 'annonce')}`
    + ` ${agree(summary.annonces.count, 'saisie')}`
    + (dropped > 0 ? ` (${dropped} ${agree(dropped, 'écarté')} du calcul)` : ''));

  // The two samples, apart, always in the same order: observed first.
  if (summary.ventes.withRatio > 0) {
    lines.push(`Ventes DVF — ${count(summary.ventes.median)} €/m² médian`
      + ` sur ${count(summary.ventes.withRatio)}`
      + `, quartiles ${count(summary.ventes.p25)} à ${count(summary.ventes.p75)}`);
  } else if (summary.ventes.count > 0) {
    lines.push(`Ventes DVF — ${count(summary.ventes.count)} retenues, aucune comparable en €/m²`);
  }
  if (summary.annonces.withRatio > 0) {
    lines.push(`Annonces — ${count(summary.annonces.median)} €/m² médian demandé`
      + ` sur ${count(summary.annonces.withRatio)}`
      + `, quartiles ${count(summary.annonces.p25)} à ${count(summary.annonces.p75)}`);
  } else if (summary.annonces.count > 0) {
    lines.push(`Annonces — ${count(summary.annonces.count)} saisies, aucune comparable en €/m²`);
  }

  if (summary.gapPercent !== null) {
    const sign = summary.gapPercent > 0 ? '+' : '';
    // THE TWO SAMPLE SIZES TRAVEL WITH THE PERCENTAGE. A median of one listing
    // against a median of two sales is a legitimate thing to print and an
    // illegitimate thing to print alone: the reader has to see that the
    // headline rests on three rows before quoting it.
    lines.push(`Écart affichage sur acte ${sign}${String(summary.gapPercent).replace('.', ',')} %`
      + ` — ${count(summary.annonces.withRatio)} ${agree(summary.annonces.withRatio, 'annonce')}`
      + ` contre ${count(summary.ventes.withRatio)} ${agree(summary.ventes.withRatio, 'vente')}`);
    lines.push('Ce n’est pas une marge de négociation — ce sont d’autres biens,'
      + ' à d’autres dates, et aucun ajustement temporel n’est appliqué');
  }

  if (summary.estimate) {
    const basisWord = summary.estimate.basis === 'ventes'
      ? 'sur les ventes actées'
      : 'sur les prix demandés, faute de ventes en nombre';
    lines.push(`Fourchette ${basisWord} — ${money(summary.estimate.low)}`
      + ` à ${money(summary.estimate.high)}, médiane ${money(summary.estimate.mid)}`);
    lines.push(`Écart interquartile sur ${count(summary.estimate.sample)} comparables`
      + ' — une dispersion observée, pas un intervalle de confiance'
      + (summary.estimate.short ? ', et l’échantillon est court' : ''));
  } else {
    // NAME EVERY BLOCKING REASON, not the first one found. A reader told the
    // surface is missing, who fills it in and still gets no range because the
    // sample was short all along, has been sent round a corner.
    const blocking = [];
    const surface = summary.subject?.surface ?? null;
    if (!summary.subject) blocking.push('aucun bien défini');
    else if (!Number.isFinite(surface)) blocking.push('surface du bien non renseignée');
    else if (surface <= 0) blocking.push('surface du bien nulle ou négative');
    else if (surface > MAX_SURFACE_M2) {
      blocking.push(`surface du bien au-delà de ${count(MAX_SURFACE_M2)} m², probablement une faute de frappe`);
    }
    if (!summary.basis) blocking.push(`moins de ${MIN_RATIO_SAMPLE} comparables avec un €/m²`);
    // A refusal with no reason after the dash is the one thing worse than the
    // refusal: reproduced with a surface of 0, which passed the finiteness
    // check and named nothing.
    lines.push(`Pas de fourchette — ${blocking.length ? blocking.join(', ') : 'raison indéterminée'}`);
  }

  const refusals = mergedRefusals(summary);
  const refusalText = Object.entries(refusals)
    .map(([reason, n]) => `${n} ${refusalWords(reason, n)}`)
    .join(', ');
  if (refusalText) {
    lines.push(`Écartés du calcul — ${refusalText}`);
  }
  if (summary.unplaced > 0) {
    const n = summary.unplaced;
    const counted = summary.unplacedCounted;
    // « comptés dans les médianes » was printed for every unplaced row, including
    // rows with no ratio at all — which the line above had just declared
    // excluded. Two different facts, so two different sentences.
    lines.push(counted === n
      ? `${count(n)} ${agree(n, 'comparable')} sans position`
        + ` — ${agree(n, 'compté')} dans les médianes, ${agree(n, 'absent')} de la carte`
      : `${count(n)} ${agree(n, 'comparable')} sans position, dont ${count(counted)}`
        + ` dans les médianes — ${agree(n, 'absent')} de la carte`);
  }
  if (summary.staleListings > 0) {
    const n = summary.staleListings;
    lines.push(`${count(n)} ${agree(n, 'annonce')} de plus de ${STALE_LISTING_DAYS} jours`
      + ' — une annonce ancienne est un prix que le marché a déjà refusé');
  }
  if (summary.maxDistanceM !== null) {
    lines.push(`Comparable le plus éloigné à ${count(summary.maxDistanceM)} m du bien`);
  }

  return lines.map(sanitiseLine);
}

/**
 * One comparable, as the lines its own card prints.
 * @param {object} entry
 * @param {?object} subject
 * @param {{now?: number}} [options]
 * @returns {{title: string, details: string[]}}
 */
export function comparableLines(entry, subject = null, { now = Date.now() } = {}) {
  const details = [];
  const kindWord = entry.kind === 'vente' ? 'Vente DVF' : 'Annonce saisie';
  details.push(entry.kind === 'vente'
    ? `${kindWord} — prix acté, source DGFiP`
    : `${kindWord} — prix demandé, saisi par le conseiller`);
  const traits = [
    Number.isFinite(entry.surface) ? `${amount(entry.surface)} m²` : null,
    Number.isFinite(entry.rooms) ? `${count(entry.rooms)} ${agree(entry.rooms, 'pièce')}` : null,
    entry.type,
  ].filter(Boolean);
  details.push(`${money(entry.price)}${traits.length ? ` — ${traits.join(', ')}` : ''}`);
  details.push(Number.isFinite(entry.prixM2)
    ? `${count(entry.prixM2)} €/m²`
    : `Pas de €/m² — ${entry.ratioRefused ? refusalWords(entry.ratioRefused, 1) : 'donnée manquante'}`);
  const distance = distanceMetres(subject, entry);
  const age = ageDays(entry.date, now);
  const when = frenchDate(entry.date);
  if (when) {
    details.push(entry.kind === 'vente'
      ? `Mutation du ${when}${age === null ? '' : ` (${count(Math.round(age / 30))} mois)`}`
      : `Relevée le ${when}${age === null ? '' : ` (${count(Math.round(age / 30))} mois)`}`);
  } else {
    details.push('Sans date — l’ancienneté de ce comparable est inconnue');
  }
  if (distance !== null) details.push(`À ${count(distance)} m du bien étudié`);
  if (entry.portal) details.push(`Vue sur ${entry.portal}`);
  if (entry.note) details.push(entry.note);
  return {
    title: sanitiseLine(entry.label),
    details: details.map(sanitiseLine),
  };
}

// ---------------------------------------------------------------------------
// Persistence — one key, one file, nothing on a wire
// ---------------------------------------------------------------------------

/**
 * Read the dossier back out of storage.
 *
 * A storage that throws (Safari private browsing refuses `localStorage`), a
 * missing key, an unparseable string and a payload from a future schema all
 * resolve to an EMPTY dossier rather than to an exception: this runs during
 * layer enable, and a dossier that cannot be read must not take the layer down
 * with it.
 *
 * @param {Storage} [storage]
 * @returns {object}
 */
export function loadDossier(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(COMPARABLES_STORAGE_KEY);
    if (!raw) return emptyDossier();
    const parsed = JSON.parse(raw);
    return adoptDossier(parsed);
  } catch {
    return emptyDossier();
  }
}

/**
 * Take any parsed object and make a dossier of it.
 * @param {unknown} parsed
 * @returns {object}
 */
export function adoptDossier(parsed) {
  if (!parsed || typeof parsed !== 'object') return emptyDossier();
  const comparables = (Array.isArray(parsed.comparables) ? parsed.comparables : [])
    .map((entry) => normaliseComparable(entry))
    .filter(Boolean);
  // BOTH coordinates, not just the latitude. `{subject: {lat: 45}}` used to
  // adopt with `lon: null`, which the panel then formatted with `.toFixed()`
  // and the render skipped — an imported file could break the panel and be
  // saved on the way through.
  const subject = parsed.subject
    && Number.isFinite(parseNumber(parsed.subject.lat))
    && Number.isFinite(parseNumber(parsed.subject.lon))
    ? {
      label: String(parsed.subject.label ?? '').slice(0, 160) || null,
      commune: String(parsed.subject.commune ?? '').slice(0, 80) || null,
      lat: parseNumber(parsed.subject.lat),
      lon: parseNumber(parsed.subject.lon),
      surface: parseNumber(parsed.subject.surface),
      rooms: parseNumber(parsed.subject.rooms),
      type: String(parsed.subject.type ?? '').slice(0, 40) || null,
    }
    : null;
  return { version: COMPARABLES_SCHEMA_VERSION, subject, comparables };
}

/**
 * Write the dossier back.
 * @param {object} dossier
 * @param {Storage} [storage]
 * @returns {boolean} False when storage refused, which the panel reports.
 */
export function saveDossier(dossier, storage = globalThis.localStorage) {
  try {
    storage?.setItem?.(COMPARABLES_STORAGE_KEY, JSON.stringify({
      version: COMPARABLES_SCHEMA_VERSION,
      subject: dossier?.subject ?? null,
      comparables: Array.isArray(dossier?.comparables) ? dossier.comparables : [],
      savedAt: new Date().toISOString(),
    }));
    return true;
  } catch {
    return false;
  }
}

/** The dossier as the file a reader downloads. */
export function exportDossierJson(dossier) {
  return JSON.stringify({
    format: 'gods-eye-view/comparables',
    version: COMPARABLES_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    subject: dossier?.subject ?? null,
    comparables: Array.isArray(dossier?.comparables) ? dossier.comparables : [],
  }, null, 2);
}

/**
 * Read a file back into a dossier — ours, or an agency's own export.
 *
 * TWO SHAPES, ON PURPOSE. The first is what {@link exportDossierJson} writes.
 * The second is a bare ARRAY of listings, which is the shape an agency's own
 * back-office produces: an agent owns the listings they publish, their CRM
 * exposes them (Apimo's provider API, Ubiflow's hundred connected packages,
 * Hektor's XML feed), and importing a file the client exported for themselves
 * is a consent, not an extraction. Field names are accepted in French and in
 * English by {@link normaliseComparable}, because that is what those exports
 * actually contain.
 *
 * Rejected rows are COUNTED and returned. An import that silently keeps 40 of
 * 60 rows is how a valuation gets written on two thirds of a file.
 *
 * @param {string} text
 * @returns {{dossier: ?object, kept: number, rejected: number, mode: string}}
 */
export function importDossierJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text ?? ''));
  } catch {
    return { dossier: null, kept: 0, rejected: 0, mode: 'illisible' };
  }
  if (Array.isArray(parsed)) {
    // A BARE ARRAY IS A LIST OF ASKING PRICES, whatever its rows claim to be.
    // `kind` used to be trusted here, so a file carrying `kind: "vente"` put
    // rows the DGFiP never published into the SALES median — and the card then
    // printed « Fourchette sur les ventes actées » over them. Nothing outside
    // `/api/dvf` may enter that sample; the array door only opens onto the
    // other one.
    const kept = parsed
      .map((entry) => normaliseComparable({ ...entry, kind: 'annonce', prixM2: null }))
      .filter(Boolean);
    return {
      dossier: { version: COMPARABLES_SCHEMA_VERSION, subject: null, comparables: kept },
      kept: kept.length,
      rejected: parsed.length - kept.length,
      mode: 'annonces',
    };
  }
  if (parsed && typeof parsed === 'object') {
    const rows = Array.isArray(parsed.comparables) ? parsed.comparables.length : 0;
    const dossier = adoptDossier(parsed);
    return {
      dossier,
      kept: dossier.comparables.length,
      rejected: Math.max(0, rows - dossier.comparables.length),
      mode: 'dossier',
    };
  }
  return { dossier: null, kept: 0, rejected: 0, mode: 'illisible' };
}

/**
 * Merge comparables into a dossier, by id, without duplicating.
 *
 * Retaining the same DVF sale twice is the obvious accident — the panel offers
 * the candidate list on every scan and a sale stays in it — so identity is the
 * id, and an id already present is left as the reader last edited it rather
 * than overwritten by the register's version of the same row.
 *
 * @param {object} dossier
 * @param {Array<object>} entries
 * @returns {{dossier: object, added: number}}
 */
export function mergeComparables(dossier, entries) {
  const base = dossier?.comparables ?? [];
  const known = new Set(base.map((entry) => entry.id));
  const additions = [];
  for (const raw of Array.isArray(entries) ? entries : []) {
    const entry = normaliseComparable(raw);
    if (!entry || known.has(entry.id)) continue;
    known.add(entry.id);
    additions.push(entry);
  }
  return {
    dossier: { ...dossier, comparables: [...base, ...additions] },
    added: additions.length,
  };
}
