/**
 * @module data/loyersFeed
 *
 * The **carte des loyers** — what it would cost to rent at this address, from
 * the only national source there is, and everything that source says about how
 * much it does not know.
 *
 * Cityscan cites *« Observatoires immobiliers »* among its own sources for the
 * Immobilier theme. This is the file behind that phrase for anywhere outside
 * the twenty-odd agglomerations an *observatoire local des loyers* covers:
 * the Ministry's own econometric prediction, published per commune, France
 * entière hors Mayotte, licence ouverte, no key.
 *
 * ── WHAT THE NUMBER IS, AND FOUR THINGS IT IS NOT ───────────────────────────
 * Read from the millésime 2025 guide (`guide-dutilisation-des-donnees.pdf`,
 * December 2025) and confirmed against the four published files:
 *
 * 1. **It is a prediction, not a median.** The guide says so in as many words:
 *    the indicators come from an econometric model, *« il ne s'agit donc pas de
 *    loyers « médians » ou « moyens » »*. Nobody in this commune necessarily
 *    pays it.
 * 2. **It is CHARGES COMPRISES.** Every French rental listing a reader has ever
 *    seen quotes rent hors charges; this file quotes it charges comprises, for
 *    an unfurnished dwelling let in Q3 2025. Printing it beside a listing
 *    without saying so overstates the listing by the charges.
 * 3. **It is per m² of a BIEN TYPE, not of your flat.** Each segment has its
 *    own reference dwelling — 52 m² for an apartment, 37 m² for a T1-T2, 72 m²
 *    for a T3-plus, 92 m² for a house — and the €/m² is the model's answer for
 *    THAT dwelling. Multiplying it by 120 m² does not predict a 120 m² flat.
 * 4. **It is built on ASKING prices**, from leboncoin and the Groupe SeLoger
 *    over 2019-2025. It is what landlords asked, not what tenants signed.
 *
 * ── THE MEASUREMENT THAT DECIDES HOW THIS IS DRAWN ──────────────────────────
 * Measured over the four live files on 2026-09-08 — 34 900 communes each, the
 * same commune set in all four, no missing value anywhere:
 *
 *   segment  commune-based   maille   EPCI    median €/m²   range
 *   app          4 871       30 029      0       10,00      6,28 – 37,89
 *   app12        3 139       31 761      0       11,97      7,09 – 40,43
 *   app3         3 378       31 459     63        8,53      5,49 – 37,61
 *   maison       3 619       30 673    608        8,75      5,74 – 30,22
 *
 * **Six communes in seven get a figure that was not computed for them.** With
 * fewer than about a hundred observations, the model falls back to a *maille*
 * of neighbouring communes holding at least 500 — 3 079 such mailles for
 * apartments — and every commune in the maille receives the identical number.
 * Measured: the 30 029 `maille` apartment rows carry only **2 375 distinct
 * values**, and the largest cluster is **77 communes sharing one price**.
 * La Haute-Beaume (05066) and La Bâtie-des-Fonds (26030) are 120 km apart in
 * two different régions and both are told 9,757696 €/m², to the microcent.
 *
 * So `basis` travels with every figure and the card says it out loud. A
 * borrowed number presented as a local one is the single most misleading thing
 * this file could be made to do.
 *
 * ── Trap 1: `nbobs_com` is NOT the sample the figure was computed on ────────
 * Chattancourt (55106) publishes `nbobs_com = 9` for apartments and
 * `TYPPRED = maille`; for T3-plus it publishes `nbobs_com = 5` and
 * `TYPPRED = EPCI`. The observation count is how many ads were seen in the
 * commune, full stop — the model used them or it did not, and only `TYPPRED`
 * says which. A card that read "9 observations" beside a maille figure would
 * be attributing a national model's answer to nine adverts.
 *
 * ── Trap 2: the published interval is enormous, and it is the honest part ───
 * `lwr.IPm2` and `upr.IPm2` are a PREDICTION interval — the range an individual
 * dwelling's rent is expected to fall in, not the precision of the estimate.
 * Measured over the 34 900 apartment rows, its width is **45,7 % of the value
 * at the median** (p10 37,2 %, p90 54,8 %, max 123,5 %), and it barely narrows
 * where the data is thickest: 45,0 % on commune-based rows against 45,8 % on
 * maille rows. Paris 9e, with 7 870 observations of its own, is published as
 * 33,55 €/m² with an interval of 26,30 – 42,80.
 *
 * That is why this module never returns a bare number. The interval is not a
 * footnote on this source, it is most of what the source knows.
 *
 * ── Trap 3: even a dense arrondissement borrows a segment ───────────────────
 * Paris 13e is `commune` for all three apartment segments and **`maille` for
 * houses**, on 54 observations, at 22,56 €/m² with an interval of
 * 13,29 – 38,32 — a spread of 125 % of the value. The segment, not the
 * commune, is the unit of trust.
 *
 * ── Trap 4: the file is CP1252, semicolon-delimited, comma-decimal, CRLF ────
 * Byte 0xE2 in `La Bâtie-des-Fonds` is not valid UTF-8, so a default
 * `response.text()` mangles a fifth of French commune names. `decodeLoyersCsv`
 * owns the decode and a unit test pins it on real bytes.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 * France entière **hors Mayotte** — 976 is absent from all four files, and the
 * DOM that are present (971-974) carry their own `DOM_n` mesh identifiers.
 * Commune geography as of 1 January 2025. Paris, Lyon and Marseille are
 * published PER ARRONDISSEMENT, so this is one of the registers that must NOT
 * be handed a folded code — see `communeCode.js`.
 *
 * Dependency-free and side-effect-free: decoding, parsing and projection only.
 * The `/api/loyers-fr` proxy imports it; nothing in the browser bundle does.
 */

/** Attribution carried on every payload (see DATA_SOURCES.md). */
export const LOYERS_SOURCE = 'Carte des loyers 2025 — DGALN/DHUP, ANIL, SDES';
export const LOYERS_LICENCE = 'Licence Ouverte 2.0';
/** The millésime these resource ids belong to. Bumping one means bumping both. */
export const LOYERS_MILLESIME = 2025;
/** Where the model's observations come from, named because it changes the reading. */
export const LOYERS_OBSERVATION_SOURCE = 'annonces leboncoin et Groupe SeLoger, 2019-2025';
/** The quarter the predicted dwelling is let in. */
export const LOYERS_REFERENCE_PERIOD = '3ᵉ trimestre 2025';

/**
 * The four segments, their data.gouv resource ids and their reference dwelling.
 *
 * Addressed by RESOURCE ID rather than by the dated `static.data.gouv.fr` path
 * the dataset page shows: `https://www.data.gouv.fr/api/1/datasets/r/{id}`
 * redirects to whatever file currently sits behind that resource, so a
 * re-upload of the same millésime does not need a code change — while a NEW
 * millésime does, which is the right way round.
 *
 * `surfaceM2` is the model's reference dwelling for that segment, straight out
 * of the guide. It is the only surface the €/m² is defined at.
 */
export const LOYERS_SEGMENTS = Object.freeze([
  Object.freeze({
    key: 'app',
    label: 'Appartement',
    resource: '55b34088-0964-415f-9df7-d87dd98a09be',
    surfaceM2: 52,
    roomSurfaceM2: 22.2,
  }),
  Object.freeze({
    key: 'app12',
    label: 'Appartement T1-T2',
    resource: '14a1fe11-b2d1-49b3-9f6b-83d12df9482c',
    surfaceM2: 37,
    roomSurfaceM2: 22.9,
  }),
  Object.freeze({
    key: 'app3',
    label: 'Appartement T3 et plus',
    resource: '5e3b28a4-cf56-43a3-ae79-43cceeb27f8c',
    surfaceM2: 72,
    roomSurfaceM2: 21.3,
  }),
  Object.freeze({
    key: 'maison',
    label: 'Maison',
    resource: '129f764d-b613-44e4-952c-5ff50a8c9b73',
    surfaceM2: 92,
    roomSurfaceM2: 22.4,
  }),
]);

/** Resource URL for one segment. @param {string} resource @returns {string} */
export function loyersResourceUrl(resource) {
  return `https://www.data.gouv.fr/api/1/datasets/r/${resource}`;
}

/**
 * How the model arrived at a commune's figure, as the file's `TYPPRED` says.
 *
 * The wording matters more than the code: `maille` is the modal case, and a
 * reader who is not told will assume the number was computed where they are
 * standing.
 */
export const LOYERS_BASIS = Object.freeze({
  commune: Object.freeze({
    id: 'commune',
    label: 'estimé sur la commune',
    borrowed: false,
  }),
  maille: Object.freeze({
    id: 'maille',
    label: 'repris d’une maille de communes voisines',
    borrowed: true,
  }),
  epci: Object.freeze({
    id: 'epci',
    label: 'repris de l’intercommunalité',
    borrowed: true,
  }),
});

/** The columns this module reads, pinned so a renamed one fails a test. */
export const LOYERS_COLUMNS = Object.freeze([
  'INSEE_C', 'LIBGEO', 'EPCI', 'DEP', 'REG',
  'loypredm2', 'lwr.IPm2', 'upr.IPm2', 'TYPPRED', 'nbobs_com', 'nbobs_mail', 'R2_adj',
]);

/**
 * Decode the published bytes.
 *
 * CP1252, not UTF-8. `TextDecoder('windows-1252')` is required by the WHATWG
 * encoding standard and present in Node and every browser, so this needs no
 * dependency — but it does need to be done, because the alternative is a fifth
 * of French commune names arriving with replacement characters in them.
 *
 * @param {ArrayBuffer|Uint8Array} bytes
 * @returns {string}
 */
export function decodeLoyersCsv(bytes) {
  return new TextDecoder('windows-1252').decode(bytes);
}

/**
 * A French decimal, as this file writes it.
 * @param {unknown} value @returns {?number}
 */
function decimal(value) {
  const text = String(value ?? '').trim().replace(/^"|"$/g, '').replace(',', '.');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** An integer count, absent rather than zero when the column is empty. */
function counted(value) {
  const text = String(value ?? '').trim().replace(/^"|"$/g, '');
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Strip the quoting this file applies to its text columns. */
function unquote(value) {
  return String(value ?? '').trim().replace(/^"|"$/g, '');
}

/**
 * Parse one published segment file into an index keyed on the INSEE code.
 *
 * A Map rather than an object: 34 900 five-character keys, looked up once per
 * address scan, and a Map neither collides with `Object.prototype` nor pays
 * for a megamorphic shape.
 *
 * Rows are accepted on the columns this module actually reads. A row whose
 * `loypredm2` will not parse is DROPPED rather than stored as null — the
 * published files have no such row today, and one appearing would mean a
 * changed upstream rather than a commune without a price.
 *
 * @param {string} text Decoded CSV.
 * @returns {{rows: Map<string, object>, dropped: number, header: string[]}}
 */
export function parseLoyersCsv(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const header = (lines[0] || '').split(';').map(unquote);
  const at = (parts, column) => {
    const index = header.indexOf(column);
    return index < 0 ? '' : parts[index];
  };
  const rows = new Map();
  let dropped = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split(';');
    const code = unquote(at(parts, 'INSEE_C')).toUpperCase();
    const eurM2 = decimal(at(parts, 'loypredm2'));
    if (!code || eurM2 === null) { dropped += 1; continue; }
    const rawBasis = unquote(at(parts, 'TYPPRED')).toLowerCase();
    rows.set(code, {
      code,
      name: unquote(at(parts, 'LIBGEO')) || null,
      epci: unquote(at(parts, 'EPCI')) || null,
      departement: unquote(at(parts, 'DEP')) || null,
      region: unquote(at(parts, 'REG')) || null,
      eurM2,
      low: decimal(at(parts, 'lwr.IPm2')),
      high: decimal(at(parts, 'upr.IPm2')),
      // An unrecognised TYPPRED is kept verbatim and flagged borrowed: the
      // three known values are `commune`, `maille` and `EPCI`, and a fourth
      // appearing means the model gained a fallback level, which is exactly
      // the case where claiming "estimé sur la commune" would be wrong.
      basis: LOYERS_BASIS[rawBasis]?.id ?? rawBasis ?? null,
      observationsCommune: counted(at(parts, 'nbobs_com')),
      observationsMesh: counted(at(parts, 'nbobs_mail')),
      r2: decimal(at(parts, 'R2_adj')),
    });
  }
  return { rows, dropped, header };
}

/** Round to the nearest cent, keeping null as null. */
function cents(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

/**
 * The half-width of the published interval, as a percentage of the value.
 *
 * Symmetric on the value rather than on the interval's own midpoint, because
 * that is how the figure will be read: "33,55 €/m², à ±25 %". The interval is
 * not symmetric — it is wider above than below on every row measured — so this
 * takes the LARGER side. Understating a published uncertainty in the name of
 * tidiness is the failure this whole module is built against.
 *
 * @param {{eurM2: ?number, low: ?number, high: ?number}} row
 * @returns {?number} Percent, rounded to the unit, or null.
 */
export function intervalPercent(row) {
  const value = row?.eurM2;
  if (!Number.isFinite(value) || value <= 0) return null;
  const below = Number.isFinite(row?.low) ? value - row.low : null;
  const above = Number.isFinite(row?.high) ? row.high - value : null;
  const widest = Math.max(below ?? 0, above ?? 0);
  if (!(widest > 0)) return null;
  return Math.round((widest / value) * 100);
}

/**
 * Monthly rent for the segment's own reference dwelling.
 *
 * The €/m² is defined at ONE surface and this is that surface — 52 m² for an
 * apartment, 92 m² for a house. It is offered because a monthly figure is what
 * a reader can check against a listing, and it is labelled with the surface it
 * belongs to for the same reason.
 *
 * @param {?number} eurM2 @param {number} surfaceM2 @returns {?number}
 */
export function monthlyRent(eurM2, surfaceM2) {
  if (!Number.isFinite(eurM2) || !Number.isFinite(surfaceM2)) return null;
  return Math.round(eurM2 * surfaceM2);
}

/**
 * Project the four segment rows for one commune into a payload.
 *
 * A segment whose file did not answer is reported in `missing` rather than
 * omitted: three prices and a silence is a different fact from three prices.
 *
 * @param {object} options
 * @param {string} options.code The INSEE code asked for — arrondissement-level
 *   where the BAN gave one, because this register publishes arrondissements.
 * @param {Object<string, ?object>} options.rows Segment key → parsed row.
 * @param {Array<string>} [options.missing] Segment keys whose file was silent.
 * @returns {object}
 */
export function projectLoyers({ code, rows = {}, missing = [] }) {
  const segments = [];
  const absent = [...missing];
  let commune = null;
  for (const segment of LOYERS_SEGMENTS) {
    const row = rows[segment.key] ?? null;
    if (!row) {
      if (!absent.includes(segment.key)) absent.push(segment.key);
      continue;
    }
    if (!commune) {
      commune = {
        code: row.code,
        name: row.name,
        epci: row.epci,
        departement: row.departement,
        region: row.region,
      };
    }
    const basis = LOYERS_BASIS[row.basis] ?? null;
    segments.push({
      key: segment.key,
      label: segment.label,
      surfaceM2: segment.surfaceM2,
      eurM2: cents(row.eurM2),
      low: cents(row.low),
      high: cents(row.high),
      intervalPercent: intervalPercent(row),
      monthlyEur: monthlyRent(row.eurM2, segment.surfaceM2),
      monthlyLowEur: monthlyRent(row.low, segment.surfaceM2),
      monthlyHighEur: monthlyRent(row.high, segment.surfaceM2),
      basis: row.basis,
      basisLabel: basis?.label ?? `base « ${row.basis} » non documentée`,
      // Unknown basis counts as borrowed. See `parseLoyersCsv`.
      borrowed: basis ? basis.borrowed : true,
      // Kept apart from `borrowed` on purpose — see Trap 1. This is how many
      // ads the file saw in the commune, NOT the sample behind the figure.
      observationsCommune: row.observationsCommune,
      observationsMesh: row.observationsMesh,
      r2: row.r2 === null ? null : Math.round(row.r2 * 1000) / 1000,
    });
  }
  const borrowed = segments.filter((segment) => segment.borrowed).length;
  return {
    commune: commune ?? { code: String(code ?? '').toUpperCase() || null, name: null },
    millesime: LOYERS_MILLESIME,
    referencePeriod: LOYERS_REFERENCE_PERIOD,
    observationSource: LOYERS_OBSERVATION_SOURCE,
    // Said on every payload, not only when a reader asks: the whole file is
    // charges comprises and every listing they will compare it to is not.
    charges: 'comprises',
    furnished: false,
    segments,
    borrowedSegments: borrowed,
    missing: absent,
    source: LOYERS_SOURCE,
    licence: LOYERS_LICENCE,
  };
}
