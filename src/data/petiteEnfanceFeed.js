/**
 * @module petiteEnfanceFeed
 *
 * Where a childcare place is easy to find in France, and where it is not.
 *
 * ── Why this layer draws a RATE and not a register ──────────────────────────
 * There is no national open register of crèches. The question was asked and
 * measured before this file existed, and the answer is worth writing down so
 * nobody re-derives it:
 *
 *   · The CNAF — which HAS the list, behind monenfant.fr — publishes 210 open
 *     datasets and **not one of them is an establishment**. They are all
 *     aggregates: coverage rates and place counts by IRIS, QPV, commune, EPCI,
 *     département, région, national.
 *   · FINESS is not it either. Measured on the daily flux: 174 621
 *     establishments, of which **183** have a crèche-shaped name, and those
 *     are incidental (the crèche inside a rehabilitation centre). EAJE are
 *     authorised by the département's PMI, not by an ARS, so they are outside
 *     FINESS by construction.
 *   · INSEE's BPE has the right object — code `D502`, *Établissement d'accueil
 *     du jeune enfant* — but the only millésimes with an API behind them are
 *     2016 and **2021**, and 2021 holds 11 756 crèches against the ~15 000 the
 *     ONAPE counts.
 *   · Sirene has NAF 88.91A and 21 801 active companies, but filtering on the
 *     COMPANY's activity silently drops the public sector: `nature_juridique`
 *     7210 (commune) with APE 88.91A returns **zero rows**, while a municipal
 *     crèche is really there as an ESTABLISHMENT of the commune's SIREN
 *     (measured: COMMUNE DE SAINT-ANDRE-LES-VERGERS, company APE 84.11Z,
 *     establishment sign "CRECHE", establishment APE 88.91A).
 *
 * So this layer draws what IS published, honestly, rather than a register
 * assembled out of proxies: the CNAF's own *taux de couverture* — places of
 * formal childcare per 100 children under three — at the three scales the
 * CNAF publishes it.
 *
 * ── What the dataset IS ─────────────────────────────────────────────────────
 * Seven Opendatasoft datasets on **data.caf.fr**, Licence Ouverte 2.0,
 * published annually. Measured 2026-09-01, rentrée de référence **2023** (the
 * newest of the two years published, alongside 2022):
 *
 *   scale        taux            places          rows
 *   national     txcouv_pe_nat   —                  1   60,9 places / 100 enfants
 *   département  txcouv_pe_dep   nbpla_pe_dep     102
 *   EPCI         txcouv_pe_epci  nbpla_pe_epci  1 251
 *   commune      txcouv_pe_com   nbpla_pe_com   1 061
 *
 * The national figure cross-checks exactly against the ONAPE 2024 report
 * (60,9 places for 100 children under 3 in 2023), which is the reassurance
 * that this is the published indicator and not a re-derivation of it.
 *
 * ── Trap 1: the commune scale covers 1 061 communes, not 34 875 ─────────────
 * The CNAF publishes the communal breakdown **only for communes of more than
 * 10 000 inhabitants**. That is 1 061 of France's ~34 875 communes. It is a
 * city-scale detail, never a national mesh, and a choropleth built from it
 * would be 97% holes. So the two grains are drawn NESTED rather than side by
 * side: the EPCI territory — which does tile the whole country — is the wash,
 * and the 1 061 communes the CNAF breaks out are cut out of it and filled with
 * their own rate. Every card says which scale it is reporting.
 *
 * ── Trap 2: some rows are not areas, and they are not spelled alike ─────────
 * `numepci = "XX"`, `nomepci = "XX"` — a placeholder for the communes that
 * belong to no intercommunalité. It carries a REAL and extreme value (195,8),
 * which makes it the single most damaging row in the whole layer: left in, it
 * is the national maximum, it anchors any linear ramp, and it is drawn nowhere
 * because no contour matches `XX`. Dropped here. With it gone the real EPCI
 * range is **2,7** (CC de l'Est Guyanais) to **160,5** (CC Altitude 800),
 * median 62,9, and only 4 EPCI exceed 100.
 *
 * The département PLACES file carries the same idea spelled differently —
 * `numdep = "XXX"`, 15 places — so the test matches any run of X rather than
 * the literal string, which is the difference between catching one of the two
 * and catching both.
 *
 * ── Trap 3: `annee` is an int in six datasets and a DATE in the seventh ─────
 * `txcouv_pe_dep`, `_epci`, `_com` and the three `nbpla_*` publish `annee` as
 * `int`; `txcouv_pe_nat` publishes it as `date`. One `where=annee=2023` clause
 * cannot serve both — the national one answers HTTP 400. The national file is
 * two rows, so it is read whole and filtered here.
 *
 * ── Trap 4: a coverage rate is not a percentage and can exceed 100 ──────────
 * It counts PLACES per 100 resident children under three, so an area that
 * hosts more places than it has children — a commuter town, a tiny
 * denominator in the mountains — legitimately passes 100. Four EPCI do.
 * Nothing is clamped: clamping would turn a real finding into a ceiling.
 *
 * ── Trap 5: the published components do not sum exactly ─────────────────────
 * Every rate is published rounded to 0,1, so the five leaves (crèche PSU,
 * crèche hors PSU, préscolarisation, assistante maternelle, garde à domicile)
 * add up to the global rate only to within rounding: nationally
 * 19,9 + 3,6 + 3,3 + 31,9 + 2,2 = 60,9 exactly, but at other scales the sum
 * drifts by a tenth. The global figure is the published one and is never
 * recomputed from the parts.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
 */

import {
  arrondissementContoursUrl,
  communeContoursUrl,
  hasArrondissements,
  projectCommuneContours,
} from './communeContours.js';

/** Portal every one of the seven datasets lives on. */
export const PE_PORTAL = 'data.caf.fr';

/** Attribution carried on every payload (see DATA_SOURCES.md). */
export const PE_SOURCE = 'Taux de couverture d’accueil du jeune enfant — Cnaf (data.caf.fr)';
/** The centroid source, which is a different producer and says so. */
export const PE_GEO_SOURCE = 'Contours et centres administratifs — geo.api.gouv.fr (Etalab)';

/**
 * The national reference dataset, read whole.
 *
 * Two rows and no `where` clause, because its `annee` is a DATE where every
 * other file publishes an int — see Trap 3. Two rows are cheaper to filter
 * here than to argue with upstream about.
 */
export const PE_NATIONAL_DATASET = 'txcouv_pe_nat';

/**
 * Oldest reference year this layer will accept, and the one it was measured
 * on. The year is DISCOVERED at fetch time — the CNAF adds one every January —
 * and floored here so a malformed answer cannot walk the map backwards.
 */
export const PE_YEAR_FLOOR = 2023;

/**
 * The three published scales, coarse to fine.
 *
 * Order is load-bearing: the layer walks it outward-in when deciding which
 * scale can answer a view, and the first entry is the only one with bundled
 * geometry behind it.
 */
export const PE_SCALES = Object.freeze(['dep', 'epci', 'com']);

export const PE_SCALE_LABELS = Object.freeze({
  dep: 'Département',
  epci: 'Intercommunalité',
  com: 'Commune',
});

/**
 * Per-scale dataset ids and column names.
 *
 * The CNAF's naming is perfectly regular — every column carries its scale as a
 * suffix — so the reader is parameterised rather than written three times.
 * Verified column-for-column against all six files.
 */
const SCALE_SPEC = Object.freeze({
  dep: Object.freeze({
    taux: 'txcouv_pe_dep', places: 'nbpla_pe_dep', suffix: 'dep', code: 'numdep', name: 'nomdep',
  }),
  epci: Object.freeze({
    taux: 'txcouv_pe_epci', places: 'nbpla_pe_epci', suffix: 'epci', code: 'numepci', name: 'nomepci',
  }),
  com: Object.freeze({
    taux: 'txcouv_pe_com', places: 'nbpla_pe_com', suffix: 'com', code: 'numcom', name: 'nomcom',
  }),
});

/** Dataset ids and key columns for one scale. */
export function peScaleSpec(scale) {
  return SCALE_SPEC[scale] || null;
}

/**
 * The five childcare modes that ADD UP to the global rate, plus the two
 * subtotals the CNAF also publishes.
 *
 * The leaves are what a card lists, because the subtotals (`eaje`, `ind`) are
 * sums of leaves and printing both would double-count on the page. They are
 * still read, so a card can name "accueil collectif" against "accueil
 * individuel" without re-adding anything.
 */
export const PE_MODES = Object.freeze(['psu', 'horsPsu', 'prescol', 'am', 'gad']);

export const PE_MODE_LABELS = Object.freeze({
  psu: 'Crèche (EAJE financé PSU)',
  horsPsu: 'Crèche hors PSU (micro-crèche Paje)',
  prescol: 'Préscolarisation (maternelle avant 3 ans)',
  am: 'Assistante maternelle',
  gad: 'Garde à domicile',
});

/** Short labels, for the status line and the legend where width is scarce. */
export const PE_MODE_SHORT = Object.freeze({
  psu: 'crèche PSU',
  horsPsu: 'micro-crèche',
  prescol: 'maternelle',
  am: 'assistante maternelle',
  gad: 'garde à domicile',
});

/** Column stem for each mode, before the scale suffix. */
const MODE_STEM = Object.freeze({
  psu: 'psu_col',
  horsPsu: 'hors_psu_col',
  prescol: 'prescol',
  am: 'am_ind',
  gad: 'gad_ind',
});

/** The two published subtotals, kept because a card reads them as a pair. */
const SUBTOTAL_STEM = Object.freeze({ collectif: 'eaje', individuel: 'ind' });

/**
 * Colour bands, as a RATIO to the national rate — not quantiles.
 *
 * This is a deliberate departure from `schools-fr`, `irve-fr` and `sup-fr`,
 * which all bin by quantile, and the reason is that this layer paints THREE
 * scales. A quantile band means "the top sixth of what is on screen", so the
 * same colour would mean a different thing on the département map and on the
 * EPCI map, and an operator zooming in would watch an area change colour
 * without anything changing about it. Anchoring every scale to the one
 * national figure the CNAF publishes makes the colour mean one thing
 * everywhere: how this place compares with France.
 *
 * The thresholds are ratios, so they survive the national rate moving between
 * editions (59,5 in 2022, 60,9 in 2023) without re-cutting the ramp.
 */
export const PE_BAND_RATIOS = Object.freeze([0.60, 0.85, 1.00, 1.15, 1.40]);

export const PE_BANDS = Object.freeze([
  'tres-bas', 'bas', 'sous-moyenne', 'sur-moyenne', 'haut', 'tres-haut',
]);

export const PE_BAND_LABELS = Object.freeze({
  'tres-bas': 'Très inférieur à la moyenne',
  bas: 'Inférieur',
  'sous-moyenne': 'Un peu sous la moyenne',
  'sur-moyenne': 'Un peu au-dessus',
  haut: 'Supérieur',
  'tres-haut': 'Très supérieur à la moyenne',
});

/**
 * Band for one rate, against the national reference.
 *
 * @param {?number} rate Published coverage rate.
 * @param {?number} national The same edition's national rate.
 * @returns {?string} null when either number is missing — an unbanded area is
 *   drawn as absence, never as the bottom of the scale.
 */
export function peBand(rate, national) {
  // `Number(null)` is 0, not NaN, so a plain coercion would band an area with
  // NO PUBLISHED RATE as the worst in France — the single worst failure this
  // ramp can have, because both of its ends are strong claims. Absence is
  // rejected before the number is read, never after.
  if (rate === null || rate === undefined || rate === '') return null;
  if (national === null || national === undefined || national === '') return null;
  const value = Number(rate);
  const reference = Number(national);
  if (!Number.isFinite(value) || !Number.isFinite(reference) || reference <= 0) return null;
  const ratio = value / reference;
  for (let i = 0; i < PE_BAND_RATIOS.length; i += 1) {
    if (ratio < PE_BAND_RATIOS[i]) return PE_BANDS[i];
  }
  return PE_BANDS[PE_BANDS.length - 1];
}

/** Index of a band on the ramp, or -1. */
export function peBandIndex(band) {
  const index = PE_BANDS.indexOf(band);
  return index;
}

/** Finite number, or null — the portal publishes '' and null for absent. */
function num(value) {
  const parsed = typeof value === 'string' ? Number(value.trim()) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

/** Trimmed string, or null. */
function str(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

/**
 * Whether a row is an all-X placeholder rather than a real area.
 *
 * See Trap 2. Matched on BOTH the code and the name, and on ANY run of X
 * rather than on the literal `XX`, because the CNAF does not spell it the same
 * way twice: the EPCI rate file uses `XX` (1 row, and it carries the national
 * maximum) while the département PLACES file uses `XXX` (1 row, 15 places).
 * Pinning the exact string would have caught one and let the other through.
 */
const PLACEHOLDER_CODE = /^X+$/;

export function isPlaceholderArea(code, name) {
  const c = String(code ?? '').trim().toUpperCase();
  const n = String(name ?? '').trim().toUpperCase();
  return !c || PLACEHOLDER_CODE.test(c) || PLACEHOLDER_CODE.test(n);
}

/**
 * Reference year the portal reports, refusing anything below the floor.
 *
 * @param {Array<object>} rows Grouped rows carrying `annee`.
 * @param {number} [floor]
 * @returns {number}
 */
export function newestYear(rows, floor = PE_YEAR_FLOOR) {
  let best = Number(floor);
  for (const row of Array.isArray(rows) ? rows : []) {
    // `annee` arrives as an int here and as an ISO date on the national file;
    // both start with the four digits that matter.
    const match = /^(\d{4})/.exec(String(row?.annee ?? '').trim());
    const year = match ? Number(match[1]) : NaN;
    if (Number.isFinite(year) && year > best) best = year;
  }
  return best;
}

/** The `where` every scaled dataset takes. */
export function peYearWhere(year) {
  return `annee=${Number(year)}`;
}

/**
 * Read the national reference row for one year out of the two published.
 *
 * @param {Array<object>} rows Rows of `txcouv_pe_nat`, read whole.
 * @param {number} year
 * @returns {?object}
 */
export function readNational(rows, year) {
  const wanted = String(year);
  let latest = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    const match = /^(\d{4})/.exec(String(row?.annee ?? '').trim());
    if (!match) continue;
    if (match[1] !== wanted) continue;
    const rate = num(row?.txcouv_nat);
    if (rate === null) continue;
    latest = {
      year: Number(match[1]),
      rate,
      // "FRANCE ENTIERE HORS MAYOTTE" — the perimeter is published on the row
      // and is carried rather than paraphrased, because the national rate this
      // layer compares every area against excludes a département that the
      // départemental file does not.
      perimeter: str(row?.national),
      modes: readModes(row, 'nat'),
      subtotals: readSubtotals(row, 'nat'),
    };
  }
  return latest;
}

/** The five leaf rates for one row at one scale. */
function readModes(row, suffix) {
  const modes = {};
  for (const mode of PE_MODES) {
    modes[mode] = num(row?.[`txcouv_${MODE_STEM[mode]}_${suffix}`]);
  }
  return modes;
}

/** The two published subtotals for one row at one scale. */
function readSubtotals(row, suffix) {
  return {
    collectif: num(row?.[`txcouv_${SUBTOTAL_STEM.collectif}_${suffix}`]),
    individuel: num(row?.[`txcouv_${SUBTOTAL_STEM.individuel}_${suffix}`]),
  };
}

/** The five leaf PLACE counts for one row at one scale. */
function readPlaces(row, suffix) {
  const places = {};
  for (const mode of PE_MODES) {
    places[mode] = num(row?.[`pl_${MODE_STEM[mode]}_${suffix}`]);
  }
  return places;
}

/**
 * The mode that supplies the most places in an area.
 *
 * The single most legible fact this dataset holds after the rate itself: the
 * Jura is 52,6 assistante maternelle against 17,1 crèche, Paris is the other
 * way round, and the national average hides both. Ties resolve to the earlier
 * entry in `PE_MODES`, which puts collective care first — the conservative
 * reading, since it is the one a reader looking for "a crèche place" means.
 */
export function dominantMode(modes) {
  let best = null;
  let bestValue = -Infinity;
  for (const mode of PE_MODES) {
    const value = Number(modes?.[mode]);
    if (!Number.isFinite(value)) continue;
    if (value > bestValue) {
      bestValue = value;
      best = mode;
    }
  }
  return bestValue > 0 ? best : null;
}

/**
 * Join one scale's rate rows to its place rows and project them into areas.
 *
 * @param {object} options
 * @param {string} options.scale One of `PE_SCALES`.
 * @param {Array<object>} options.taux Rows of the `txcouv_*` dataset.
 * @param {Array<object>} [options.places] Rows of the matching `nbpla_*` dataset.
 * @param {?number} options.national The same edition's national rate.
 * @param {number} options.year
 * @returns {{areas:Array<object>, byCode:Map<string,object>, dropped:number,
 *   bands:object, scale:string, year:number}}
 */
export function projectPeAreas({
  scale, taux, places = null, national = null, year = PE_YEAR_FLOOR,
} = {}) {
  const spec = SCALE_SPEC[scale];
  if (!spec) return { areas: [], byCode: new Map(), dropped: 0, bands: {}, scale, year };

  const placeByCode = new Map();
  for (const row of Array.isArray(places) ? places : []) {
    const code = str(row?.[spec.code]);
    if (code) placeByCode.set(code.toUpperCase(), row);
  }

  const areas = [];
  const byCode = new Map();
  const bands = Object.fromEntries(PE_BANDS.map((band) => [band, 0]));
  let dropped = 0;

  for (const row of Array.isArray(taux) ? taux : []) {
    const code = str(row?.[spec.code]);
    const name = str(row?.[spec.name]);
    if (isPlaceholderArea(code, name)) {
      dropped += 1;
      continue;
    }
    const rate = num(row?.[`txcouv_${spec.suffix}`]);
    const modes = readModes(row, spec.suffix);
    const placeRow = placeByCode.get(code.toUpperCase()) || null;
    const band = peBand(rate, national);
    if (band) bands[band] += 1;

    const area = {
      scale,
      code,
      name,
      rate,
      band,
      // How this area sits against France, as a plain multiple. The colour is
      // derived from it, and the card prints it, so the two can never disagree.
      ratio: Number.isFinite(rate) && Number.isFinite(national) && national > 0
        ? Number((rate / national).toFixed(3))
        : null,
      modes,
      subtotals: readSubtotals(row, spec.suffix),
      dominant: dominantMode(modes),
      places: placeRow ? readPlaces(placeRow, spec.suffix) : null,
      totalPlaces: placeRow ? num(placeRow[`tot_offre_${spec.suffix}`]) : null,
      dept: scale === 'dep' ? code : str(row?.numdep),
      deptName: scale === 'dep' ? name : str(row?.nomdep),
      region: str(row?.nomregi),
      year,
    };
    areas.push(area);
    byCode.set(code.toUpperCase(), area);
  }

  areas.sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.code.localeCompare(b.code));
  return { areas, byCode, dropped, bands, scale, year };
}

/**
 * Attach a centroid to each area, from the geo.api.gouv.fr index.
 *
 * Areas that find no centroid are NOT dropped: they keep their rate and their
 * card, and are counted so the layer can say how many it could not place. The
 * CNAF's codes and Etalab's are both INSEE codes and match at 99.92% for EPCI
 * and 100% for communes once municipal arrondissements are included, so a miss
 * is a real boundary change between editions rather than a format mismatch.
 *
 * @param {Array<object>} areas From `projectPeAreas`.
 * @param {Map<string, {lat:number, lon:number, population:?number}>} centroids
 * @returns {{placed:Array<object>, unplaced:number}}
 */
export function placePeAreas(areas, centroids) {
  const index = centroids instanceof Map ? centroids : new Map(Object.entries(centroids || {}));
  const placed = [];
  let unplaced = 0;
  for (const area of Array.isArray(areas) ? areas : []) {
    const point = index.get(String(area.code).toUpperCase());
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
      unplaced += 1;
      continue;
    }
    placed.push({
      ...area,
      id: `${area.scale}:${area.code}`,
      lat: point.lat,
      lon: point.lon,
      population: Number.isFinite(point.population) ? point.population : null,
    });
  }
  return { placed, unplaced };
}

// ---------------------------------------------------------------------------
// Territories
// ---------------------------------------------------------------------------

/**
 * ── Why the layer draws ground and not a dot ───────────────────────────────
 *
 * A coverage rate is a property of a TERRITORY. Drawn as a point it becomes a
 * property of a coordinate, and the coordinate is the area's administrative
 * centre — a field outside the seat commune for a rural intercommunalité, or
 * a spot in the 5th for a Métropole. Readers correctly refused to read that as
 * "this rate holds here and up to that ridge"; nothing on screen said where
 * "here" ended.
 *
 * So the areas are filled instead, from the only source that publishes French
 * communal limits openly: `geo.api.gouv.fr`, one département per call, which
 * is what `communeContours.js` wraps. Two consequences follow and both are
 * deliberate:
 *
 *   · An EPCI has NO contour of its own on that API. Its territory is drawn as
 *     its member communes, sharing one fill and carrying no internal outline,
 *     so the wash reads as one area rather than as a mosaic. Membership comes
 *     from `codeEpci`, which rides along with the geometry at no extra call.
 *   · The commune grain is only fetchable a département at a time, so the
 *     territory regime is entered LOW — see `PE_TERRITORY_ENTER_SPAN_DEG` in
 *     the render module. Above it the département choropleth answers, which is
 *     also a territory, only coarser. There is no zoom at which this layer
 *     puts a number on a spot again.
 */

/**
 * Properties asked of `geo.api.gouv.fr` with the geometry.
 *
 * `codeEpci` is the whole reason the EPCI scale can be drawn at all — it turns
 * one commune request into both grains this layer publishes.
 */
export const PE_CONTOUR_FIELDS = 'code,nom,population,codeEpci';

/**
 * The parent commune of each département that publishes arrondissements
 * municipaux — the only three in France.
 *
 * The CNAF breaks Paris, Lyon and Marseille down by arrondissement, so 45 of
 * its 1 061 commune rows have no commune-level contour: `geo.api.gouv.fr`
 * answers Paris as ONE polygon. The arrondissement outlines are a second call,
 * and the parent is named here so a pack can say which ground the finer
 * outlines replace.
 */
export const PE_ARRONDISSEMENT_PARENTS = Object.freeze({
  75: '75056',
  69: '69123',
  13: '13055',
});

/** Parent commune code for a département's arrondissements, or null. */
export function peArrondissementParent(departement) {
  return PE_ARRONDISSEMENT_PARENTS[String(departement || '').trim().toUpperCase()] || null;
}

/**
 * The one or two contour requests one département needs.
 *
 * @param {string} departement
 * @returns {{communes:string, arrondissements:?string}}
 */
export function peContourUrls(departement) {
  return {
    communes: communeContoursUrl(departement, { fields: PE_CONTOUR_FIELDS }),
    arrondissements: hasArrondissements(departement)
      ? arrondissementContoursUrl(departement, { fields: PE_CONTOUR_FIELDS })
      : null,
  };
}

/**
 * The widest box the contour endpoint will answer, in degrees of latitude.
 *
 * Measured on the real geography 2026-09-02, at 1400×900: a 0,9° view is
 * 110×110 km, and France's 34 875 communes over 550 000 km² put roughly
 * **1 450 communes** inside one. That is the same order as the parcel and
 * commune batches this app already draws, and twice it is not. The renderer
 * enters the territory regime at that span for this reason and no other.
 */
export const PE_MAX_BOX_DEG = 1.3;
/**
 * Cache grid the browser snaps its box to before asking.
 *
 * 0,1° is about 11 km, so panning across a city re-asks once every few
 * screens instead of once per camera settle, and two operators looking at the
 * same place send the same request.
 */
export const PE_BOX_STEP_DEG = 0.1;
/**
 * Communes one answer may carry.
 *
 * A ceiling on the pathological box rather than a policy: 2 400 is well past
 * the ~1 450 a full-width view holds. What it drops is REPORTED, and it drops
 * from the EDGES first — see `peTerritoiresInBox`.
 */
export const PE_MAX_BOX_COMMUNES = 2400;
/**
 * Départements one answer may read.
 *
 * Measured over five cities: a 0,9° box touches 4 to 18 départements — Paris
 * being the worst because its are the smallest — so this has to be generous
 * where the pack cap is strict. It costs upstream calls the FIRST time a
 * region is looked at and nothing after that, because each département's
 * outlines are memoized whole.
 */
export const PE_MAX_BOX_DEPARTEMENTS = 20;

/** Bounding box `[west, south, east, north]` of a flat `[lon, lat, …]` ring. */
export function ringBox(flat) {
  if (!Array.isArray(flat) || flat.length < 4) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (let i = 0; i < flat.length; i += 2) {
    const lon = flat[i];
    const lat = flat[i + 1];
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return Number.isFinite(west) ? [west, south, east, north] : null;
}

/** The box covering every part of one commune. */
function communeBox(parts) {
  let box = null;
  for (const part of parts || []) {
    const partBox = ringBox(part);
    if (!partBox) continue;
    if (!box) box = partBox.slice();
    else {
      box[0] = Math.min(box[0], partBox[0]);
      box[1] = Math.min(box[1], partBox[1]);
      box[2] = Math.max(box[2], partBox[2]);
      box[3] = Math.max(box[3], partBox[3]);
    }
  }
  return box;
}

/**
 * Cut the départements in hand down to the communes a view can see.
 *
 * WHY THE ANSWER IS BOXED AND THE FETCH IS NOT. `geo.api.gouv.fr` only
 * publishes contours a département at a time, so that is how they are fetched
 * and memoized — once each, whole, for the life of the process. But a view is
 * not shaped like a département: measured over five cities, a 0,9° box clips
 * 4 to 18 of them, and sending whole packs would mean shipping Pas-de-Calais
 * because a corner of it caught the edge of the screen. Serving the box costs
 * nothing upstream and turns a megabyte of off-screen geometry into none.
 *
 * The cap drops from the EDGES, by distance from the centre of the view: a
 * truncated answer is then complete where the operator is looking and thin at
 * the margins, rather than complete in whatever order a département's file
 * happened to arrive in.
 *
 * @param {object} input
 * @param {Array<object>} input.packs From `projectPeTerritoires`.
 * @param {{south:number, west:number, north:number, east:number}} input.box
 * @param {number} [input.limit]
 * @returns {{communes:Array<object>, departements:Array<string>, dropped:number, vertices:number}}
 */
export function peTerritoiresInBox({ packs, box, limit = PE_MAX_BOX_COMMUNES } = {}) {
  const hits = [];
  const departements = [];
  if (!box || ![box.south, box.west, box.north, box.east].every(Number.isFinite)) {
    return {
      communes: [], departements, dropped: 0, vertices: 0,
    };
  }
  const midLon = (box.west + box.east) / 2;
  const midLat = (box.south + box.north) / 2;
  for (const pack of Array.isArray(packs) ? packs : []) {
    const rows = Array.isArray(pack?.communes) ? pack.communes : [];
    const boxes = Array.isArray(pack?.bboxes) ? pack.bboxes : [];
    let any = false;
    for (let i = 0; i < rows.length; i += 1) {
      const bounds = boxes[i];
      if (!bounds) continue;
      if (bounds[2] < box.west || bounds[0] > box.east
        || bounds[3] < box.south || bounds[1] > box.north) continue;
      any = true;
      hits.push({
        row: rows[i],
        distance: Math.hypot(
          (bounds[0] + bounds[2]) / 2 - midLon,
          (bounds[1] + bounds[3]) / 2 - midLat,
        ),
      });
    }
    if (any && pack.departement) departements.push(pack.departement);
  }
  hits.sort((a, b) => a.distance - b.distance
    || String(a.row.c).localeCompare(String(b.row.c)));
  const cap = Math.max(1, Math.floor(limit));
  const kept = hits.slice(0, cap);
  let vertices = 0;
  for (const hit of kept) {
    for (const part of hit.row.p) vertices += part.length / 2;
  }
  departements.sort();
  return {
    communes: kept.map((hit) => hit.row),
    departements,
    dropped: Math.max(0, hits.length - kept.length),
    vertices,
  };
}

/** One projected contour as a wire row. Short keys: this is the heavy payload. */
function peContourRow(commune, extra = {}) {
  const row = { c: commune.code, n: commune.name, p: commune.parts };
  if (commune.epci) row.e = commune.epci;
  if (commune.simplified) row.s = 1;
  return Object.assign(row, extra);
}

/**
 * Fold one département's contours into the pack the browser draws.
 *
 * Arrondissements are appended to the commune list rather than replacing their
 * parent, and BOTH are marked: `a` names the parent an arrondissement
 * subdivides, `x` flags that parent as subdivided. The renderer picks — the
 * parent carries the EPCI wash, the
 * arrondissements carry the rates the CNAF actually publishes for that ground
 * — and neither can be drawn without knowing that the other exists, which is
 * exactly the double-paint this marking prevents.
 *
 * An arrondissement inherits its parent's `codeEpci`, which the API does not
 * send for it. Without that, dropping the parent at commune grain would leave
 * any arrondissement the CNAF happens not to publish as a hole in the map
 * rather than as the EPCI ground it is.
 *
 * @param {object} input
 * @param {object} input.communes `geo.api.gouv.fr` FeatureCollection.
 * @param {?object} [input.arrondissements] The second call, for 75/69/13.
 * @param {string} input.departement
 * @returns {object} Wire pack.
 */
export function projectPeTerritoires({ communes, arrondissements = null, departement } = {}) {
  const base = projectCommuneContours(communes);
  const parent = peArrondissementParent(departement);
  const sub = parent ? projectCommuneContours(arrondissements) : null;
  const parentEpci = parent
    ? base.communes.find((commune) => commune.code === parent)?.epci || null
    : null;

  const rows = base.communes.map((commune) => peContourRow(
    commune,
    parent && commune.code === parent && sub?.communes.length ? { x: 1 } : {},
  ));
  for (const commune of sub?.communes || []) {
    rows.push(peContourRow(
      { ...commune, epci: commune.epci || parentEpci },
      { a: parent },
    ));
  }

  return {
    departement: String(departement || '').trim().toUpperCase(),
    communes: rows,
    // Parallel to `communes`, and deliberately NOT a field on the row: the
    // rows go out on the wire and a bounding box the browser never reads
    // would be 4% of the payload spent on nothing.
    bboxes: rows.map((row) => communeBox(row.p)),
    // Geometry cost, reported rather than hidden — the rings are decimated and
    // multi-part communes are capped, and a card that says "contour simplifié"
    // has to be able to prove it.
    vertices: base.vertices + (sub?.vertices || 0),
    simplified: base.simplified + (sub?.simplified || 0),
    droppedParts: base.droppedParts + (sub?.droppedParts || 0),
    arrondissements: sub?.communes.length || 0,
  };
}
