/**
 * @module delinquanceFeed
 *
 * The reading of the SSMSI's *bases statistiques de la délinquance
 * enregistrée* — and, above everything else in this file, the reading of what
 * the publisher REFUSES to tell us.
 *
 * ── What the source is, and what it is not ──────────────────────────────────
 * Three annual bases (commune, département, région) published by the Service
 * statistique ministériel de la sécurité intérieure on data.gouv.fr under
 * Licence Ouverte 2.0, dataset `621df2954fa5a3b5a023e23c`. Measured against
 * the live dataset on 2026-09-01: `last_update` 2026-07-09T12:01:37Z, 11
 * resources, `frequency: annual`, organisation *Ministère de l'intérieur*.
 *
 * It counts **what police and gendarmerie registered**, in the publisher's own
 * words *"les enregistrements par les services de police et unités de
 * gendarmerie des procédures relatives à des infractions pénales, avant leur
 * transmission à l'autorité judiciaire"*. That is not crime. It is a function
 * of whether a victim reported, of whether a force was there to record, and —
 * for one whole family of indicators — of what the police went looking for.
 * `Usage de stupéfiants` is counted in **`Mis en cause`**: people the police
 * stopped. A commune with more of them may be a commune with more policing.
 * Nothing in this module can fix that; every surface it feeds has to say it.
 *
 * ── THE SECRECY RULE, which is the reason this file is careful ──────────────
 * The commune base carries a column no other grain has, `est_diffuse`. The
 * methodology PDF (277 329 bytes, `pdftotext`-extracted 2026-09-01) states the
 * rule verbatim:
 *
 *   *« Les données diffusées sont limitées aux communes pour lesquelles plus
 *   de 5 faits ont été enregistrés pendant 3 années successives. »*
 *
 * and the mechanism:
 *
 *   *« Si cette indicatrice prend la valeur "diff" alors le nombre de faits et
 *   le nombre de faits pour 1 000 sont renseignés. Au contraire si cette
 *   indicatrice vaut "ndiff", alors ces deux valeurs ne sont pas renseignées.
 *   Toutefois, le nombre moyen de faits ainsi que le taux moyen pour mille,
 *   par indicateur, année et département pour les communes non diffusées sont
 *   renseignés. »*
 *
 * with one further clause that is the half everyone forgets:
 *
 *   *« La base de données diffusée fournit également l'information sur
 *   l'absence de faits enregistrés lorsqu'elle se reproduit sur 3 années
 *   successives. »*
 *
 * So the file has THREE states, not two, and this module names all three:
 *   `published`   — `diff` with a positive `nombre`. A measured value.
 *   `zero`        — `diff` with `nombre = 0`. A published, deliberate zero:
 *                   no fact recorded, three years running.
 *   `suppressed`  — `ndiff`. The three-year criterion was not met.
 *                   NOT zero. NOT NECESSARILY SMALL. Not knowable here.
 *
 * ── A CORRECTION, and it is the most important line in this file ───────────
 * An earlier revision of this module — and of `delinquanceFrance.js`, whose
 * card printed it to a reader — glossed `ndiff` as *« entre 1 et 5 faits »*.
 * **That gloss is wrong, and the register itself refutes it.** The rule is not
 * a ceiling on the displayed year's value; it is a THREE-YEAR condition on the
 * series, and a commune that fails it can carry any number at all. Measured on
 * 2026-09-02 over the real base:
 *   - **4 735 of the 251 145 suppressed 2025 cells belong to a (commune,
 *     indicateur) pair that PUBLISHED MORE THAN 5 FACTS in 2023 or 2024.**
 *     Cessy (01071) published 16 `Vols de véhicule` in 2023 and is withheld in
 *     2024 and 2025; its 2025 `complement_info_nombre` is 2.05, which is the
 *     Ain's average over withheld communes and has nothing to do with Cessy.
 *   - **36 (département, indicateur) pairs have a withheld-commune MEAN above
 *     5.** Seine-Saint-Denis / `Usage de stupéfiants (AFD)` averages 22.33
 *     facts per withheld commune; Marseille's three withheld arrondissements
 *     average 11.0 `Vols avec armes` each.
 * So `suppressed` is unbounded above, and every surface that describes it now
 * quotes {@link DELINQUANCE_SUPPRESSION_RULE} instead of paraphrasing it.
 *
 * Measured over the whole commune base (5 238 000 rows, 621 167 706 bytes
 * inflated, counted row by row on 2026-09-01):
 *   suppressed  2 425 872  (46.31%)
 *   zero        2 375 233  (45.35%)
 *   published     436 895  ( 8.34%)
 * and in the newest edition alone (2025, 523 800 cells):
 *   suppressed    251 145  (47.9%)
 *   zero          222 776  (42.5%)
 *   published      49 879  ( 9.52%)
 * **25 314 of the 34 920 communes — 72.5% — carry not one positive published
 * value in 2025, and 7 of them have all fifteen indicators suppressed.**
 *
 * That is why the suppressed state gets its own colour rather than the bottom
 * of a ramp. Painting `ndiff` as a low value would manufacture a claim about
 * a real named place, in the exact cases the publisher decided were too small
 * to be interpretable and too identifying to be safe.
 *
 * ── The trap INSIDE the suppression, and it is a trap that reads as data ────
 * A `ndiff` row is not empty. `complement_info_nombre` and
 * `complement_info_taux` are populated — and they are NOT that commune's
 * value. The PDF defines them as *« Valeur moyenne parmi les communes du
 * département sous secret statistique »*. Measured over the 2025 slice by
 * grouping every suppressed row on (département, indicateur): **1 470 of the
 * 1 472 pairs carry exactly ONE distinct `complement_info_taux`**, and the two
 * that do not (13 and 69, `Vols avec armes`) carry two. It is a departmental
 * constant. Colouring a commune with it paints a departmental average and
 * calls it that commune's crime. This module reads those two columns and
 * hands them on under names that cannot be mistaken — `departementMeanRate`,
 * `departementMeanCount` — and never lets them reach a cell's own value.
 *
 * ── Why a suppressed cell can never be recovered by arithmetic ─────────────
 * Paris publishes both the whole commune (75056) and its 20 arrondissements.
 * Measured for 2025: for 14 of the 15 indicators the arrondissements sum
 * EXACTLY to the commune total. For `Vols avec armes` the commune says 393 and
 * the twenty arrondissements sum to 375, because **4 of them are suppressed**
 * and the register suppressed them precisely so the residual could not be
 * pinned on any one of them. The PDF says so: *« 3 arrondissements ne sont pas
 * diffusés afin de ne pas permettre par différence avec la donnée communale de
 * déduire la valeur non diffusable »*. 18 facts exist somewhere in four
 * arrondissements and the file will not say where. Subtracting is not
 * recovery, it is re-identification, and this module does not do it.
 *
 * ── Grain is not uniform, and a UI that pretends it is, lies ────────────────
 * 18 indicators at département and région grain; **15 at commune grain**.
 * `Homicides`, `Tentatives d'homicide` and `Usage de stupéfiants (hors AFD)`
 * exist only above the commune. Measured: the DEP base is 101 × 18 × 10 =
 * 18 180 rows exactly, the COM base 34 920 × 15 × 10 = 5 238 000 exactly.
 * Every indicator here therefore declares the grains it is published at, and
 * an indicator asked for at the wrong grain is refused rather than drawn empty.
 *
 * ── The denominator changes under you ───────────────────────────────────────
 * `taux_pour_mille` is per 1 000 INHABITANTS for 14 indicators and per 1 000
 * DWELLINGS for `Cambriolages de logement`. Verified rather than assumed, on
 * the 49 879 positive published commune cells of 2025: for the 45 386
 * non-cambriolage cells, `nombre / insee_pop × 1000` reproduces the published
 * `taux_pour_mille` **exactly, 45 386 times out of 45 386**. For the 4 493
 * cambriolage cells it reproduces it **zero times**, while `nombre /
 * insee_log × 1000` lands within a median relative error of 0.0048% and a
 * worst case of 0.11% — the right denominator, published at a slightly
 * different millésime. So: the published rate is used as published, never
 * recomputed, and cambriolages are never compared with anything else.
 *
 * Six communes carry `insee_pop = 0` in 2025 — 55039, 55050, 55139, 55189,
 * 55239, 55307, the *villages détruits* of Verdun, administratively alive and
 * uninhabited since 1916. A per-1 000-inhabitants rate over zero inhabitants
 * is not a number, and the register agrees: measured on 2026-09-02, all six
 * publish `nombre = "0"` with `est_diffuse = "diff"` and `taux_pour_mille`
 * literally `NA`. **That is the one case where a PUBLISHED cell has no rate**,
 * so `null` from `ssmsiNumber` must not be read as "suppressed" and must not
 * be read as 0.0 either. `delinquanceCellState` tests `est_diffuse` before it
 * looks at any number, which is exactly why it survives this row.
 *
 * ── Why the whole commune base is downloaded instead of queried ─────────────
 * data.gouv.fr's tabular API does index the commune resource (probed
 * 2026-09-01: `total: 5238000`, matching this module's own row count exactly)
 * — and caps `page_size` at **200**, answering `"Page size exceeds allowed
 * maximum: 200"` at 1 000. The newest year alone is 523 800 rows, so a
 * per-département fold through it would be 26 190 round trips. The bulk file
 * is 39 932 450 bytes gzipped and one request. It is also why the fold below
 * is a STREAMING one: inflated the CSV is 621 167 706 bytes, and Node's
 * maximum string length is 536 870 888, so this file physically cannot be
 * held as one JS string — `readResponseTextCapped` would throw on it.
 *
 * ── Why the CSV is split on `;` and not walked character by character ───────
 * Quoted fields, `;` delimiter, decimal COMMA, `NA` for null, and a UTF-8 BOM
 * on the DEP base but not on the commune one. All five measured. A
 * quote-aware character walk over 621 MB is minutes; a `split(';')` with a
 * field-count guard is 4.0 s for the whole 5 238 000 rows. The guard is not
 * decoration — it is what makes the shortcut honest, and it fired **0 times**
 * across all 5 238 000 rows on 2026-09-01. When it does fire, the slow
 * quote-aware path takes that one line.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
 */

import {
  COMMUNE_COORDINATE_DECIMALS,
  COMMUNE_MAX_PARTS,
  COMMUNE_MAX_RING_VERTICES,
  GEO_API_ROOT,
  communeContoursUrl,
} from './communeContours.js';

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/** data.gouv.fr, where all three bases live. */
export const DELINQUANCE_PORTAL = 'www.data.gouv.fr';

/**
 * The dataset id.
 *
 * Reached by id and not by search on purpose: data.gouv.fr's search is
 * accent-sensitive on this term. Measured 2026-09-01, `?q=delinquance`
 * returns `total: 0`; `?q=d%C3%A9linquance` returns `total: 5` and surfaces
 * this dataset. A layer that discovered its own source by the unaccented
 * spelling would find nothing and report it as an outage.
 */
export const DELINQUANCE_DATASET = '621df2954fa5a3b5a023e23c';

/** Dataset metadata endpoint — where the resource URLs are discovered. */
export const DELINQUANCE_DATASET_URL = `https://${DELINQUANCE_PORTAL}/api/1/datasets/${DELINQUANCE_DATASET}/`;

/** Short provenance line for the layer object and the cards. */
export const DELINQUANCE_SOURCE = 'Délinquance enregistrée — SSMSI (ministère de l’Intérieur)';

/** Licence, verbatim from the dataset payload's `license` field: `lov2`. */
export const DELINQUANCE_LICENCE = 'Licence Ouverte 2.0 (Etalab)';

/** Attribution string to carry wherever this data is shown. */
export const DELINQUANCE_ATTRIBUTION = 'SSMSI — Service statistique ministériel de la sécurité '
  + 'intérieure, bases statistiques de la délinquance enregistrée par la police et la gendarmerie '
  + 'nationales (Licence Ouverte 2.0)';

// ---------------------------------------------------------------------------
// The publisher's own sentences
//
// These four strings are QUOTED, not summarised, and they are exported so no
// surface has to re-say them in its own words. Extracted with `pdftotext
// -layout` from the 277 329-byte methodology PDF (`Documentation - Bases
// statistiques communale, départementale et régionale…`, last_modified
// 2026-07-09T12:01:37) on 2026-09-02, and diffed character-for-character
// against the extraction. The reason they are constants is the correction in
// the module header: the moment a rule is paraphrased on a card, it stops
// being the rule and starts being this repo's opinion of it.
// ---------------------------------------------------------------------------

/** Where the four quotes below come from, so a card can cite it. */
export const DELINQUANCE_DOCUMENTATION_TITLE = 'Documentation — bases statistiques de la '
  + 'délinquance enregistrée, SSMSI, juillet 2026';

/** The suppression rule, verbatim. The single most misquoted sentence here. */
export const DELINQUANCE_SUPPRESSION_RULE = '« Les données diffusées sont limitées aux communes '
  + 'pour lesquelles plus de 5 faits ont été enregistrés pendant 3 années successives. »';

/** The other half of the rule: a published 0 is a claim, not a gap. */
export const DELINQUANCE_ZERO_RULE = '« La base de données diffusée fournit également '
  + 'l’information sur l’absence de faits enregistrés lorsqu’elle se reproduit sur 3 années '
  + 'successives. »';

/** What `complement_info_taux` is, verbatim. It is not the commune's value. */
export const DELINQUANCE_COMPLEMENT_RULE = '« Valeur pour 1 000 moyenne parmi les communes du '
  + 'département sous secret statistique »';

/**
 * The reporting-rate caveat, in the SSMSI's own words and with its own two
 * numbers — which are far more damning than any sentence this repo could
 * write. 12 % against 74 % means two indicators of this same layer are not on
 * a comparable scale at all.
 */
export const DELINQUANCE_PLAINTE_RULE = '« La propension à déposer plainte a un impact sur le '
  + 'niveau de la délinquance enregistrée […] en moyenne sur la période 2011-2018 seules 12 % '
  + 'des victimes de violences sexuelles hors ménage portent plainte, contre 74 % pour les '
  + 'victimes de cambriolages. »';

/**
 * Per-indicator warnings the register publishes and a generic card would drop.
 *
 * `escroqueries` is the one that matters most, because it is the FIRST chip:
 * measured on the 2025 edition it is the indicator with the most communes
 * carrying a published positive value (8 134), so it is what the layer opens
 * on — and the PDF says its victims are counted where they LIVE. A reader
 * looking at that map is looking at residence, not at a crime scene.
 *
 * Keyed by slug; a slug with no note gets none rather than a filler line.
 */
export const DELINQUANCE_INDICATOR_NOTES = Object.freeze({
  escroqueries: '⚠ Comptées au LIEU DE RÉSIDENCE de la victime, pas au lieu de commission '
    + '(« une part importante de ces infractions a lieu sur internet »). Cette carte montre où '
    + 'habitent les victimes déclarées.',
  cambriolages: 'Taux pour 1 000 LOGEMENTS et non pour 1 000 habitants — cet indicateur ne se '
    + 'compare à aucun autre de cette liste.',
  'usage-stupefiants': 'Mis en cause élucidés. « Un mis en cause donné n’est compté qu’une seule '
    + 'fois par unité spatiale » : le total départemental n’est pas la somme des communes.',
  'usage-stupefiants-afd': 'Amendes forfaitaires délictuelles. La date retenue a changé en '
    + 'juillet 2026 (+1 %, soit 2 614 mis en cause) — une rupture de série, pas une hausse.',
  'usage-stupefiants-hors-afd': 'Publié au département et à la région seulement : il n’existe pas '
    + 'de carte communale de cet indicateur.',
  'trafic-stupefiants': 'Mis en cause élucidés. « Un mis en cause donné n’est compté qu’une seule '
    + 'fois par unité spatiale » : le total départemental n’est pas la somme des communes.',
  homicides: 'Publié au département et à la région seulement : il n’existe pas de carte communale '
    + 'de cet indicateur.',
  'tentatives-homicide': 'Publié au département et à la région seulement : il n’existe pas de '
    + 'carte communale de cet indicateur.',
});

/**
 * The same warnings, compressed to ONE card line each.
 *
 * The verbatim register above is what the layer says when a reader asks for
 * it; this one is what a card says by default. Measured on the 2025 edition, a
 * Dordogne card carried 858 characters of which 558 were quotation — repeated
 * identically on every card of that indicator, around four useful numbers, and
 * drawn as a box wider than the screen. A warning nobody finishes reading is
 * not a warning, so the default card keeps the CLAIM of each rule and drops
 * its wording; the `méthodo` chip puts the wording back, unabridged.
 *
 * Every line here is ≤ 60 characters, which is what the selected card fits
 * before the overlay wraps it.
 */
export const DELINQUANCE_INDICATOR_NOTES_SHORT = Object.freeze({
  escroqueries: '⚠ Comptées au domicile de la victime, pas au lieu du fait',
  cambriolages: 'Rapporté aux LOGEMENTS — non comparable aux autres',
  'usage-stupefiants': 'Mis en cause élucidés — mesure l’activité des services',
  'usage-stupefiants-afd': 'Amendes forfaitaires — rupture de série en juillet 2026',
  'usage-stupefiants-hors-afd': 'Publié au département seulement',
  'trafic-stupefiants': 'Mis en cause élucidés — mesure l’activité des services',
  homicides: 'Publié au département seulement',
  'tentatives-homicide': 'Publié au département seulement',
});

/**
 * The note for one indicator, or null. Never a filler sentence.
 * @param {string} slug
 * @param {{short?:boolean}} [options] `short` picks the one-line register.
 * @returns {?string}
 */
export function delinquanceIndicatorNote(slug, { short = false } = {}) {
  const key = String(slug ?? '').trim();
  const register = short ? DELINQUANCE_INDICATOR_NOTES_SHORT : DELINQUANCE_INDICATOR_NOTES;
  return register[key] || null;
}

/**
 * The four boilerplate caveats, compressed. Each keeps the load-bearing token
 * of its long form — `Délinquance ENREGISTRÉE`, the 12 %/74 % pair, the
 * three-year condition — so nothing a card asserts today stops being asserted.
 */
export const DELINQUANCE_ENREGISTREE_SHORT = '⚠ Délinquance ENREGISTRÉE — le déclaré, pas le réel';
/** Its `Mis en cause` variant: a count of people stopped, not of reports. */
export const DELINQUANCE_MIS_EN_CAUSE_SHORT = '⚠ Délinquance ENREGISTRÉE, comptée en mis en cause';
/** The reporting-rate scale, with the publisher's own two numbers. */
export const DELINQUANCE_PLAINTE_SHORT = 'Plainte : 12 % à 74 % selon l’atteinte';
/** The suppression rule's CLAIM: a withheld cell is unknown, not small. */
export const DELINQUANCE_SUPPRESSION_SHORT = 'Diffusé si > 5 faits 3 ans de suite — ni zéro, ni « peu »';
/** Provenance, short enough to ride at the end of another line. */
export const DELINQUANCE_DOCUMENTATION_SHORT = 'SSMSI, juillet 2026';

/**
 * The computed total's own three claims, compressed.
 *
 * The total is the one indicator here the SSMSI does not publish, so the first
 * of the three is about AUTHORSHIP rather than about crime, and it is the one
 * line of this whole file that may never be dropped for length: a reader who
 * loses it is reading GEV's arithmetic as the register's.
 */
export const DELINQUANCE_TOTAL_AUTHORSHIP_SHORT = '⚠ Total CALCULÉ par God’s Eye View, non publié par le SSMSI';
/** Why the number cannot be called « faits », and what its rate sits on. */
export const DELINQUANCE_TOTAL_UNITS_SHORT = 'Unités mélangées, taux recalculé sur la population';
/** Why one indicator of the eighteen is not in it. */
export const DELINQUANCE_TOTAL_AFD_SHORT = 'Usage stup. (AFD) non recompté : déjà dans son parent';

/**
 * What the numbers on a card actually COUNT, per indicator.
 *
 * This is the answer to the only question a rate provokes — « 6,22 quoi ? » —
 * and the register answers it differently for each indicator: escroqueries are
 * counted in VICTIMES, cambriolages in INFRACTIONS, vols de véhicule in
 * VÉHICULES, stupéfiants in MIS EN CAUSE. The card used to print « faits » for
 * every one of them, which is a paraphrase for four of the five units and says
 * nothing for the fifth. Keyed by the `unite` column, singular then plural.
 */
const UNIT_NOUNS = Object.freeze({
  Victime: Object.freeze(['victime', 'victimes']),
  'Victime entendue': Object.freeze(['victime entendue', 'victimes entendues']),
  Infraction: Object.freeze(['infraction', 'infractions']),
  Véhicule: Object.freeze(['véhicule', 'véhicules']),
  'Mis en cause': Object.freeze(['mis en cause', 'mis en cause']),
});
const DEFAULT_UNIT_NOUNS = Object.freeze(['fait', 'faits']);

/**
 * The noun this indicator's counts are expressed in, agreed with the count.
 * @param {string} slug
 * @param {number} [count] Drives the plural; 1 alone is singular.
 * @returns {string}
 */
export function delinquanceCountNoun(slug, count = 2) {
  const nouns = UNIT_NOUNS[indicatorForSlug(slug)?.unite] || DEFAULT_UNIT_NOUNS;
  return Math.abs(Number(count)) < 2 ? nouns[0] : nouns[1];
}

/**
 * Edition floor — the `last_modified` of the resources this was measured
 * against, ISO date.
 *
 * The bases are rebuilt once a year in July; the resource URL carries the
 * build stamp (`.../20260709-120038/donnee-dep-...csv`) and therefore CHANGES
 * every edition, which is why the URLs are discovered from the dataset API
 * rather than pinned. A discovery OLDER than this floor is a malformed answer
 * — a rolled-back portal, not a new edition — and is refused.
 */
export const DELINQUANCE_EDITION_FLOOR = '2026-07-09';

/** First year in every base. Measured: the year column starts at 2016. */
export const DELINQUANCE_FIRST_YEAR = '2016';

/**
 * Newest year floor.
 *
 * Measured 2026-09-01: both bases carry exactly the ten years 2016–2025, and
 * 2025 is the newest. Discovery reads the year column and floors here, so a
 * truncated edition cannot quietly move the map back to 2024.
 */
export const DELINQUANCE_YEAR_FLOOR = '2025';

/**
 * Commune contours. IGN ADMIN EXPRESS / INSEE COG, redistributed by the
 * Etalab `geo` API under Licence Ouverte, keyless, `access-control-allow-origin`
 * echoing the request origin (measured with `Origin: https://gev.enerlens.com`
 * → 200, `access-control-allow-origin: https://gev.enerlens.com`).
 *
 * The SSMSI base publishes a CODGEO and nothing else — no coordinate, no
 * outline — so the shapes have to come from somewhere. This one is the same
 * INSEE geography the base is keyed on, which is what makes the join exact:
 * measured over all 101 départements on 2026-09-01, **all 34 875 communes the
 * API returns have an SSMSI row, and the only 45 SSMSI codes with no contour
 * are exactly the 20 arrondissements of Paris, the 9 of Lyon and the 16 of
 * Marseille** — whose parent communes 75056, 69123 and 13055 are present and
 * carry the same totals. 34 920 = 34 875 + 45, and nothing is lost.
 */
export const DELINQUANCE_CONTOURS_ROOT = `${GEO_API_ROOT}/departements`;

/**
 * Build the commune-contour URL for one département.
 *
 * The guard and the template live in `communeContours.js`; what stays here is
 * the message, because a bad code reaching this function is a délinquance bug
 * and the log has to say which layer asked.
 */
export function delinquanceContoursUrl(departement) {
  try {
    return communeContoursUrl(departement);
  } catch (error) {
    throw new Error(`delinquance: invalid département code ${departement}`, { cause: error });
  }
}

// ---------------------------------------------------------------------------
// The indicator vocabulary
// ---------------------------------------------------------------------------

/**
 * The 18 published indicators, in the publisher's own order and spelling.
 *
 * The LABEL is the join key — there is no code column — and the labels move.
 * The PDF records that in July 2025 *« l'indicateur des "coups et blessures
 * volontaires sur personne de 15 ans ou plus" est remplacé par deux nouveaux
 * indicateurs »*, which is exactly the kind of change that turns a silent
 * `undefined` into an empty map. So the table is explicit, `indicatorForLabel`
 * returns null rather than guessing, and every caller counts what it could not
 * recognise instead of dropping it.
 *
 * `per` is the denominator of `taux_pour_mille` and it is NOT uniform — see
 * the module header for the 45 386-of-45 386 versus 0-of-4 493 measurement
 * that settles it.
 *
 * `grains` is which bases carry the indicator. Three of the eighteen are
 * département-and-above only, so a commune map of them does not exist.
 */
export const DELINQUANCE_INDICATORS = Object.freeze([
  { slug: 'homicides', label: 'Homicides', short: 'Homicides', unite: 'Victime', per: 'habitants', grains: Object.freeze(['dep']) },
  { slug: 'tentatives-homicide', label: "Tentatives d'homicide", short: 'Tentatives d’homicide', unite: 'Victime', per: 'habitants', grains: Object.freeze(['dep']) },
  { slug: 'violences-intrafamiliales', label: 'Violences physiques intrafamiliales', short: 'Violences intrafamiliales', unite: 'Victime', per: 'habitants', grains: Object.freeze(['dep', 'com']) },
  { slug: 'violences-hors-famille', label: 'Violences physiques hors cadre familial', short: 'Violences hors famille', unite: 'Victime', per: 'habitants', grains: Object.freeze(['dep', 'com']) },
  { slug: 'violences-sexuelles', label: 'Violences sexuelles', short: 'Violences sexuelles', unite: 'Victime', per: 'habitants', grains: Object.freeze(['dep', 'com']) },
  { slug: 'vols-armes', label: 'Vols avec armes', short: 'Vols avec armes', unite: 'Infraction', per: 'habitants', grains: Object.freeze(['dep', 'com']) },
  { slug: 'vols-violents', label: 'Vols violents sans arme', short: 'Vols violents', unite: 'Infraction', per: 'habitants', grains: Object.freeze(['dep', 'com']) },
  { slug: 'vols-sans-violence', label: 'Vols sans violence contre des personnes', short: 'Vols sans violence', unite: 'Victime entendue', per: 'habitants', grains: Object.freeze(['dep', 'com']) },
  { slug: 'cambriolages', label: 'Cambriolages de logement', short: 'Cambriolages', unite: 'Infraction', per: 'logements', grains: Object.freeze(['dep', 'com']) },
  { slug: 'vols-vehicules', label: 'Vols de véhicule', short: 'Vols de véhicule', unite: 'Véhicule', per: 'habitants', grains: Object.freeze(['dep', 'com']) },
  { slug: 'vols-dans-vehicules', label: 'Vols dans les véhicules', short: 'Vols dans les véhicules', unite: 'Véhicule', per: 'habitants', grains: Object.freeze(['dep', 'com']) },
  { slug: 'vols-accessoires', label: "Vols d'accessoires sur véhicules", short: 'Vols d’accessoires', unite: 'Véhicule', per: 'habitants', grains: Object.freeze(['dep', 'com']) },
  { slug: 'degradations', label: 'Destructions et dégradations volontaires', short: 'Dégradations', unite: 'Infraction', per: 'habitants', grains: Object.freeze(['dep', 'com']) },
  { slug: 'usage-stupefiants', label: 'Usage de stupéfiants', short: 'Usage de stupéfiants', unite: 'Mis en cause', per: 'habitants', grains: Object.freeze(['dep', 'com']) },
  { slug: 'usage-stupefiants-afd', label: 'Usage de stupéfiants (AFD)', short: 'Usage stup. (AFD)', unite: 'Mis en cause', per: 'habitants', grains: Object.freeze(['dep', 'com']) },
  { slug: 'usage-stupefiants-hors-afd', label: 'Usage de stupéfiants (hors AFD)', short: 'Usage stup. (hors AFD)', unite: 'Mis en cause', per: 'habitants', grains: Object.freeze(['dep']) },
  { slug: 'trafic-stupefiants', label: 'Trafic de stupéfiants', short: 'Trafic de stupéfiants', unite: 'Mis en cause', per: 'habitants', grains: Object.freeze(['dep', 'com']) },
  { slug: 'escroqueries', label: 'Escroqueries et fraudes aux moyens de paiement', short: 'Escroqueries', unite: 'Victime', per: 'habitants', grains: Object.freeze(['dep', 'com']) },
]);

/** Slugs published at commune grain — 15 of the 18. */
export const DELINQUANCE_COMMUNE_SLUGS = Object.freeze(
  DELINQUANCE_INDICATORS.filter((entry) => entry.grains.includes('com')).map((entry) => entry.slug),
);
/** Slugs published at département grain — all 18. */
export const DELINQUANCE_DEPARTEMENT_SLUGS = Object.freeze(
  DELINQUANCE_INDICATORS.map((entry) => entry.slug),
);

// ---------------------------------------------------------------------------
// The all-offences total — the one indicator the SSMSI does NOT publish
// ---------------------------------------------------------------------------

/**
 * Slug of the cumulative indicator. It is a COMPUTED one, and every surface
 * that draws it has to say so: the register publishes eighteen indicators and
 * no total, so this one is this repo's arithmetic and not the publisher's
 * claim. `computed: true` on the meta is what the cards test.
 */
export const DELINQUANCE_TOTAL_SLUG = 'tous';

/**
 * Indicators that are a DECOMPOSITION of another one in the same table, and
 * would therefore be counted twice by a naive sum.
 *
 * `Usage de stupéfiants` = `Usage de stupéfiants (AFD)` + `Usage de
 * stupéfiants (hors AFD)`, verified rather than assumed: over the 2025
 * département base the parent equals the sum of its two children in **101 of
 * 101 départements, exactly**. At commune grain only the AFD child is
 * published, and it is ≤ its parent in all 2 057 communes where both carry a
 * published value. So the children are dropped and the parent is kept, which
 * leaves **14 contributors at commune grain and 16 at département grain**.
 */
export const DELINQUANCE_TOTAL_EXCLUDED = Object.freeze([
  'usage-stupefiants-afd',
  'usage-stupefiants-hors-afd',
]);

/**
 * The computed total's own vocabulary entry.
 *
 * `unite` is deliberately a mouthful. The eighteen indicators are counted in
 * five different units — `Victime`, `Victime entendue`, `Infraction`,
 * `Véhicule` and `Mis en cause` — so their sum is not "faits": it adds people
 * the police stopped to victims who reported to vehicles taken. That is a real
 * limit of any total over this register, it cannot be fixed by arithmetic, and
 * the honest thing is to name it in the unit itself.
 *
 * `per` is `habitants` for the whole total, including the burglaries the
 * register publishes per 1 000 DWELLINGS: the total's rate is recomputed from
 * counts over `insee_pop` rather than assembled from published rates, because
 * published rates on two different denominators cannot be added at all.
 */
export const DELINQUANCE_TOTAL_INDICATOR = Object.freeze({
  slug: DELINQUANCE_TOTAL_SLUG,
  label: 'Tous les indicateurs — total calculé',
  short: 'Tous',
  unite: 'Victimes, infractions, véhicules et mis en cause confondus',
  per: 'habitants',
  grains: Object.freeze(['dep', 'com']),
  computed: true,
});

/** The 14 commune-grain contributors to the total. */
export const DELINQUANCE_TOTAL_COMMUNE_SLUGS = Object.freeze(
  DELINQUANCE_COMMUNE_SLUGS.filter((slug) => !DELINQUANCE_TOTAL_EXCLUDED.includes(slug)),
);
/** The 16 département-grain contributors to the total. */
export const DELINQUANCE_TOTAL_DEPARTEMENT_SLUGS = Object.freeze(
  DELINQUANCE_DEPARTEMENT_SLUGS.filter((slug) => !DELINQUANCE_TOTAL_EXCLUDED.includes(slug)),
);

/**
 * Commune cell order ON THE WIRE: the register's 15, then the computed total.
 *
 * The total is appended rather than inserted so that every existing slot index
 * keeps its meaning, and it is a SEPARATE list from
 * {@link DELINQUANCE_COMMUNE_SLUGS} so that no loop over "the indicators the
 * register publishes" can accidentally sweep the one it does not.
 */
export const DELINQUANCE_COMMUNE_CELL_SLUGS = Object.freeze([
  ...DELINQUANCE_COMMUNE_SLUGS,
  DELINQUANCE_TOTAL_SLUG,
]);

/** Indicator lookup by the register's own French label. */
const INDICATOR_BY_LABEL = new Map(DELINQUANCE_INDICATORS.map((entry) => [entry.label, entry]));
/**
 * Indicator lookup by slug — the register's eighteen PLUS the computed total.
 *
 * The total is reachable by slug (a card asks for its label and its unit) and
 * unreachable by label (no upstream row carries one), which is exactly the
 * asymmetry that keeps `indicatorForLabel` from ever resolving a total out of
 * the CSV.
 */
const INDICATOR_BY_SLUG = new Map(
  [...DELINQUANCE_INDICATORS, DELINQUANCE_TOTAL_INDICATOR].map((entry) => [entry.slug, entry]),
);

/**
 * Resolve one of the register's labels. Returns null for anything unknown,
 * which the callers COUNT rather than swallow — see the July-2025 rename.
 * @param {string} label
 * @returns {?object}
 */
export function indicatorForLabel(label) {
  return INDICATOR_BY_LABEL.get(String(label ?? '').trim()) || null;
}

/** Resolve one indicator by slug. */
export function indicatorForSlug(slug) {
  return INDICATOR_BY_SLUG.get(String(slug ?? '').trim()) || null;
}

/**
 * The unit a rate is per, as a French noun for a card.
 * @param {string} slug
 * @returns {string}
 */
export function delinquanceRateUnit(slug) {
  return indicatorForSlug(slug)?.per === 'logements' ? '1 000 logements' : '1 000 habitants';
}

// ---------------------------------------------------------------------------
// The three cell states
// ---------------------------------------------------------------------------

/** A measured, published value. */
export const CELL_PUBLISHED = 0;
/** A published zero: no fact recorded, three years running. */
export const CELL_ZERO = 1;
/**
 * `est_diffuse = ndiff`: the three-year publication criterion was not met.
 * NOT zero, and NOT bounded above — 4 735 of the 251 145 suppressed 2025
 * cells published more than 5 facts in 2023 or 2024. See the module header.
 */
export const CELL_SUPPRESSED = 2;

/** Wire-order state names, for tests and for the legend. */
export const DELINQUANCE_CELL_STATES = Object.freeze(['published', 'zero', 'suppressed']);

/** French label for each state, written so neither can be read as the other. */
export const DELINQUANCE_CELL_LABELS = Object.freeze({
  published: 'Valeur publiée',
  zero: 'Aucun fait enregistré',
  suppressed: 'Non diffusé — secret statistique',
});

/**
 * Classify one commune cell.
 *
 * The order matters and is the whole point: `ndiff` is tested FIRST, before
 * any look at `nombre`, so a suppressed cell can never fall through to a
 * numeric branch and be read as 0. `diff` with `nombre = 0` is a real zero and
 * says so; anything else with a finite positive count is published.
 *
 * @param {{est_diffuse?:string, nombre?:*}} row
 * @returns {number} One of CELL_PUBLISHED / CELL_ZERO / CELL_SUPPRESSED.
 */
export function delinquanceCellState(row) {
  // `ssmsiText`, not a bare `String()`: every field arriving from the fold is a
  // RAW CSV token and the register quotes them, so the flag is `"ndiff"` with
  // the quotes attached. A bare comparison against `ndiff` never matches, the
  // `ndiff` branch becomes dead code, and classification silently falls
  // through to the numeric one — which today lands on the right answer only
  // because a withheld row also happens to carry `nombre = NA`. That is an
  // accident, not a guarantee: the moment an edition writes a number beside a
  // `ndiff` flag, the fall-through paints a withheld commune as measured.
  const flag = ssmsiText(row?.est_diffuse).toLowerCase();
  if (flag === 'ndiff') return CELL_SUPPRESSED;
  const count = ssmsiNumber(row?.nombre);
  if (count === null) return CELL_SUPPRESSED;
  return count > 0 ? CELL_PUBLISHED : CELL_ZERO;
}

/**
 * Sum one commune's fourteen contributing cells into the computed total.
 *
 * ── What the three states mean for a TOTAL, which is not what they mean for
 *    an indicator ──────────────────────────────────────────────────────────
 * `published`  — at least one contributor published a positive count. The sum
 *                is of the PUBLISHED ones only, so when `withheld > 0` it is a
 *                **minorant**: a floor, never the value. Every card says so.
 * `zero`       — nothing was recorded AND nothing is withheld. A complete,
 *                measured zero across all fourteen indicators.
 * `suppressed` — nothing published and something withheld: the register is
 *                holding back the only thing that could have made this cell
 *                non-zero, so there is no honest number to paint at all.
 *
 * Measured over the 2025 edition's 34 920 communes: **9 606 published (9 428
 * of them minorants and only 178 exact), 243 complete zeros, 25 071
 * suppressed**. Nine thousand six hundred is more paintable ground than any
 * single indicator has — escroqueries, the current top chip, publishes 8 134 —
 * which is the whole case for offering the total at all.
 *
 * ── Why the rate is recomputed and not summed ──────────────────────────────
 * `taux_pour_mille` is per 1 000 inhabitants for thirteen of these fourteen
 * and per 1 000 DWELLINGS for `Cambriolages de logement`; rates on two
 * denominators cannot be added. So the total's rate is `count / insee_pop ×
 * 1 000`, which makes burglaries per-inhabitant here and nowhere else. A
 * commune with `insee_pop = 0` — the six *villages détruits* of Verdun — gets
 * a null rate rather than a division.
 *
 * @param {Array<?Array<number>>} cells The 15 register cells, in
 *   {@link DELINQUANCE_COMMUNE_SLUGS} order.
 * @param {?number} pop `insee_pop`.
 * @returns {Array<number>} `[state, count, rate, withheld]`.
 */
export function aggregateDelinquanceCommuneTotal(cells, pop) {
  const source = Array.isArray(cells) ? cells : [];
  let count = 0;
  let withheld = 0;
  let seen = 0;
  for (let i = 0; i < DELINQUANCE_COMMUNE_SLUGS.length; i += 1) {
    if (DELINQUANCE_TOTAL_EXCLUDED.includes(DELINQUANCE_COMMUNE_SLUGS[i])) continue;
    const cell = source[i];
    // An absent cell is an indicator this edition did not carry for this
    // commune. It is counted with the withheld ones — both mean "the total
    // cannot be complete" — rather than treated as a zero it never published.
    if (!cell) { withheld += 1; continue; }
    seen += 1;
    if (cell[0] === CELL_SUPPRESSED) { withheld += 1; continue; }
    if (cell[0] === CELL_PUBLISHED) count += Number(cell[1]) || 0;
  }
  const population = Number(pop);
  const state = count > 0
    ? CELL_PUBLISHED
    : (withheld > 0 || seen === 0 ? CELL_SUPPRESSED : CELL_ZERO);
  // A suppressed total carries NO rate, the same rule the register applies to
  // a `ndiff` cell: the sum of the published contributors is 0 there, and a
  // stored `0` is exactly the number a renderer would paint as "quiet". A
  // COMPLETE zero does carry 0, because that one is a claim.
  const rate = state === CELL_SUPPRESSED || !(Number.isFinite(population) && population > 0)
    ? null
    : (count / population) * 1000;
  return [state, count, rate, withheld];
}

// ---------------------------------------------------------------------------
// CSV reading
// ---------------------------------------------------------------------------

/**
 * One numeric cell.
 *
 * Three things at once, all measured in the real files: `NA` is the null
 * sentinel (not an empty string), the decimal separator is a COMMA inside the
 * quoted field (`"0,0078318"`), and surrounding quotes may or may not be
 * there. An empty cell is also null — never 0, because 0 is a claim this data
 * makes deliberately and only sometimes.
 *
 * @param {*} value
 * @returns {?number}
 */
export function ssmsiNumber(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/^"|"$/g, '').trim();
  if (!text || text === 'NA') return null;
  const parsed = Number(text.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** One text cell: unquoted, trimmed, empty and `NA` both becoming ''. */
export function ssmsiText(value) {
  const text = String(value ?? '').trim().replace(/^"|"$/g, '').trim();
  return text === 'NA' ? '' : text;
}

/**
 * Split one `;`-delimited SSMSI line into its fields.
 *
 * Fast path first: a plain `split(';')`, valid because no field in either base
 * contains the delimiter — measured by asserting the field count on all
 * 5 238 000 commune rows and all 18 180 département rows, which held every
 * time. The `expected` guard is what keeps that shortcut honest: when the
 * count is wrong the line is re-read by a quote-aware walk, so a future
 * edition that starts quoting a commune name with a semicolon in it degrades
 * to slow-and-correct rather than to silently-misaligned.
 *
 * @param {string} line
 * @param {number} expected Field count the header declared.
 * @returns {Array<string>}
 */
export function splitSsmsiLine(line, expected) {
  const text = String(line ?? '');
  const fast = text.split(';');
  if (!Number.isFinite(expected) || fast.length === expected) return fast;
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ';') { out.push(field); field = ''; continue; }
    field += char;
  }
  out.push(field);
  return out;
}

/** Strip a UTF-8 BOM. Present on the DEP base, absent from the commune one. */
export function stripBom(text) {
  const body = String(text ?? '');
  return body.charCodeAt(0) === 0xFEFF ? body.slice(1) : body;
}

/**
 * Parse a whole SSMSI CSV into row objects.
 *
 * Only ever used on the DÉPARTEMENT base (2 001 231 bytes, 18 180 rows) and on
 * the fixtures. The commune base is 621 167 706 bytes inflated and goes
 * through {@link createCommuneFold} instead — see the module header.
 *
 * @param {string} text
 * @returns {Array<Record<string,string>>}
 */
export function parseSsmsiCsv(text) {
  const body = stripBom(text).replace(/\r\n?/g, '\n');
  const lines = body.split('\n');
  let header = null;
  const rows = [];
  for (const line of lines) {
    if (!line) continue;
    if (!header) {
      header = splitSsmsiLine(line, NaN).map((name) => ssmsiText(name));
      continue;
    }
    const fields = splitSsmsiLine(line, header.length);
    const row = {};
    for (let i = 0; i < header.length; i += 1) row[header[i]] = ssmsiText(fields[i]);
    rows.push(row);
  }
  return rows;
}

/**
 * The commune base's geography column, whose NAME moves every edition.
 *
 * Measured 2026-09-01: the shipped file's header says `CODGEO_2026` while the
 * methodology PDF's own variable table still says `CODGEO_2025`. A hardcoded
 * column name would have broken this July and will break next July, so the
 * column is found by prefix and the resolved name is reported.
 *
 * @param {Array<string>} header
 * @returns {?string}
 */
export function communeCodeColumn(header) {
  for (const name of header || []) {
    if (/^CODGEO(_\d{4})?$/i.test(String(name).trim())) return String(name).trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resource discovery
// ---------------------------------------------------------------------------

/**
 * Pick the three resources this layer needs out of the dataset payload.
 *
 * The dataset carries 11 resources and four of them are 44–174 MB atlas PDFs,
 * so this cannot be "the first csv". Selection is by format AND by the title
 * prefix the publisher uses (`DEP - `, `COM - `), with the build-stamped URL
 * taken as published. The `last_modified` is compared against
 * {@link DELINQUANCE_EDITION_FLOOR}: an edition older than the one this was
 * measured against is a rolled-back portal, not a new fact.
 *
 * @param {object} dataset data.gouv.fr `/api/1/datasets/<id>/` payload.
 * @param {{editionFloor?:string}} [options]
 * @returns {{departements:object, communes:object, documentation:?object, edition:string, licence:string}}
 */
export function pickDelinquanceResources(dataset, { editionFloor = DELINQUANCE_EDITION_FLOOR } = {}) {
  const resources = Array.isArray(dataset?.resources) ? dataset.resources : [];
  const find = (predicate) => resources.find(predicate) || null;
  const title = (resource) => String(resource?.title ?? '');

  const departements = find((r) => String(r?.format) === 'csv' && /^DEP\b/.test(title(r)));
  const communes = find((r) => String(r?.format) === 'csv.gz' && /^COM\b/.test(title(r)));
  const documentation = find((r) => String(r?.format) === 'pdf' && /^Documentation\b/.test(title(r)));

  if (!departements?.url) throw new Error('delinquance: no DEP csv resource in the dataset');
  if (!communes?.url) throw new Error('delinquance: no COM csv.gz resource in the dataset');

  const stamps = [departements.last_modified, communes.last_modified]
    .map((value) => String(value ?? '').slice(0, 10))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  const newest = stamps.length ? stamps.sort()[stamps.length - 1] : '';
  const edition = newest && newest >= editionFloor ? newest : editionFloor;

  return {
    departements: {
      url: departements.url,
      bytes: Number(departements.filesize) || null,
      lastModified: String(departements.last_modified ?? '').slice(0, 10) || null,
    },
    communes: {
      url: communes.url,
      bytes: Number(communes.filesize) || null,
      lastModified: String(communes.last_modified ?? '').slice(0, 10) || null,
    },
    documentation: documentation?.url ? { url: documentation.url } : null,
    edition,
    // `staleEdition` is true when the portal answered with something OLDER
    // than the floor. The build still runs — on the floor — and says so.
    staleEdition: Boolean(newest) && newest < editionFloor,
    licence: String(dataset?.license ?? '') === 'lov2' ? DELINQUANCE_LICENCE : String(dataset?.license ?? 'unknown'),
    lastUpdate: String(dataset?.last_update ?? '') || null,
  };
}

/**
 * Newest year present, floored.
 *
 * String comparison, not numeric: the column is TEXT upstream and a value that
 * is not a plain year must not win by parsing to NaN. Same rule as
 * `supFeed.newestYear`, for the same reason.
 *
 * @param {Iterable<string>} years
 * @param {string} [floor]
 * @returns {string}
 */
export function newestDelinquanceYear(years, floor = DELINQUANCE_YEAR_FLOOR) {
  let best = String(floor);
  for (const value of years || []) {
    const text = String(value ?? '').trim();
    if (/^\d{4}$/.test(text) && text > best) best = text;
  }
  return best;
}

// ---------------------------------------------------------------------------
// The département base
// ---------------------------------------------------------------------------

/**
 * Project the whole DÉPARTEMENT base into the wire shape.
 *
 * Everything is kept — 101 départements × 18 indicators × 10 years — because
 * the whole base is 2 001 231 bytes of CSV and the projection below is a few
 * hundred KB of JSON. There is no suppression at this grain (measured: the DEP
 * base has NO `est_diffuse` column at all, 17 711 positive cells, 469 zeros
 * and 0 nulls), so a département is only ever `published` or `zero` — the
 * third state exists in the vocabulary anyway, because the SAME legend has to
 * describe both grains and a legend that changes meaning between zoom levels
 * is worse than one row that never lights up.
 *
 * @param {object} input
 * @param {Array<Record<string,string>>} input.rows From `parseSsmsiCsv`.
 * @param {string} [input.yearFloor]
 * @returns {object}
 */
export function projectDelinquanceDepartements({ rows, yearFloor = DELINQUANCE_YEAR_FLOOR } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const years = new Set();
  const unknownLabels = new Map();
  /** @type {Map<string, {code:string, region:string, pop:number, log:number, cells:Map}>} */
  const byCode = new Map();
  let swept = 0;
  let kept = 0;

  for (const row of list) {
    swept += 1;
    const code = ssmsiText(row.Code_departement);
    const year = ssmsiText(row.annee);
    const label = ssmsiText(row.indicateur);
    if (!code || !/^\d{4}$/.test(year)) continue;
    const indicator = indicatorForLabel(label);
    if (!indicator) {
      unknownLabels.set(label, (unknownLabels.get(label) || 0) + 1);
      continue;
    }
    years.add(year);
    let entry = byCode.get(code);
    if (!entry) {
      entry = { code, region: ssmsiText(row.Code_region), pop: new Map(), log: new Map(), cells: new Map() };
      byCode.set(code, entry);
    }
    // Population and dwellings ride on every row of the same (dep, year), so
    // they are collected PER YEAR and the newest is picked at the end. Picking
    // as we go would be wrong: the newest year is not known until the sweep
    // finishes, and 2016 is the first year in the file.
    if (!entry.pop.has(year)) entry.pop.set(year, ssmsiNumber(row.insee_pop));
    if (!entry.log.has(year)) entry.log.set(year, ssmsiNumber(row.insee_log));
    const count = ssmsiNumber(row.nombre);
    const rate = ssmsiNumber(row.taux_pour_mille);
    entry.cells.set(`${indicator.slug}|${year}`, {
      state: count === null ? CELL_SUPPRESSED : (count > 0 ? CELL_PUBLISHED : CELL_ZERO),
      count,
      rate,
    });
    kept += 1;
  }

  const sortedYears = [...years].sort();
  const newest = newestDelinquanceYear(years, yearFloor);
  const departements = [...byCode.values()]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((entry) => ({
      code: entry.code,
      region: entry.region,
      pop: entry.pop.get(newest) ?? null,
      log: entry.log.get(newest) ?? null,
      // Columnar on purpose: one array per indicator, in `years` order, of
      // `[state, count, rate]`. A per-cell object keyed by year triples the
      // payload for a document that is read once and switched through often.
      cells: Object.fromEntries(DELINQUANCE_DEPARTEMENT_SLUGS.map((slug) => [
        slug,
        sortedYears.map((year) => {
          const cell = entry.cells.get(`${slug}|${year}`);
          return cell ? [cell.state, cell.count, cell.rate] : null;
        }),
      ])),
    }));

  return {
    departements,
    years: sortedYears,
    newestYear: newest,
    rowsSwept: swept,
    cellsKept: kept,
    // A label the vocabulary does not know is REPORTED, never dropped in
    // silence: the register renamed an indicator in July 2025 and will again.
    unknownIndicators: [...unknownLabels.entries()]
      .map(([label, count]) => ({ label, rows: count }))
      .sort((a, b) => b.rows - a.rows),
  };
}

// ---------------------------------------------------------------------------
// The commune base — a streaming fold
// ---------------------------------------------------------------------------

/**
 * A one-pass fold of the commune base down to one year.
 *
 * Streaming because the inflated CSV (621 167 706 bytes) exceeds Node's
 * maximum string length (536 870 888) and cannot be a string at all. The fold
 * keeps ONE year — 34 920 communes × 15 indicators = 523 800 cells — which is
 * the year the map is about; ten years would be 5 238 000 cells and is not a
 * thing to hold in a dev-server proxy. That asymmetry (ten years at
 * département grain, one at commune grain) is a real limit and is reported on
 * the payload rather than hidden.
 *
 * It also builds, in the same pass, the two things the browser cannot compute
 * for itself because it only ever holds one département:
 *   - the national CENSUS of the three states, per indicator and per
 *     département, which is what puts a suppressed count on the card;
 *   - the national list of published RATES per indicator, from which the
 *     quantile ramp is cut, so a quiet département is not re-binned into
 *     looking like a busy one.
 *
 * @param {{year?:string}} [options]
 */
export function createCommuneFold({ year = DELINQUANCE_YEAR_FLOOR } = {}) {
  const wanted = String(year);
  const slugIndex = new Map(DELINQUANCE_COMMUNE_SLUGS.map((slug, i) => [slug, i]));
  /** @type {Map<string, {dep:string, pop:?number, log:?number, cells:Array}>} */
  const communes = new Map();
  /** @type {Map<string, Array<number>>} slug -> published rates, for quantiles. */
  const rates = new Map(DELINQUANCE_COMMUNE_SLUGS.map((slug) => [slug, []]));
  /** @type {Map<string, Int32Array>} slug -> [published, zero, suppressed]. */
  const census = new Map(DELINQUANCE_COMMUNE_SLUGS.map((slug) => [slug, new Int32Array(3)]));
  /** @type {Map<string, Map<string, Int32Array>>} dep -> slug -> census. */
  const byDepartement = new Map();
  /**
   * dep -> slug -> tally of the DEPARTMENTAL MEANS a suppressed row carries.
   *
   * These are `complement_info_*`, and they are a departmental constant, not a
   * commune value — so they are hoisted out of the cells and counted here
   * instead. Measured on the 2025 slice: 1 470 of the 1 472 (département,
   * indicateur) pairs carry exactly ONE distinct `complement_info_taux`. The
   * two that do not are (13, Vols avec armes) and (69, Vols avec armes), and
   * the reason is exact: Marseille's 16 and Lyon's 9 arrondissements form
   * their OWN suppressed sub-population with their own mean — 0,3287180
   * across 3 suppressed arrondissements against 0,1049460 across 62 ordinary
   * communes in the 13, and 0,1543028 across 3 against 0,1527191 across 67 in
   * the 69. The modal value is kept and the variant count is reported, so a
   * card can say "the mean is not unique here" instead of quietly picking one.
   * @type {Map<string, Map<string, Map<string, {count:?number, rate:?number, rows:number}>>>}
   */
  const means = new Map();
  const unknownLabels = new Map();
  const yearsSeen = new Set();
  let header = null;
  let codeColumn = null;
  let columns = null;
  let rowsSwept = 0;
  let rowsKept = 0;
  let slowLines = 0;
  let zeroPopulation = 0;

  /** Column indices, resolved once from the header. */
  function resolveColumns(names) {
    const at = (name) => names.indexOf(name);
    codeColumn = communeCodeColumn(names);
    return {
      code: codeColumn ? at(codeColumn) : -1,
      annee: at('annee'),
      indicateur: at('indicateur'),
      nombre: at('nombre'),
      taux: at('taux_pour_mille'),
      est: at('est_diffuse'),
      pop: at('insee_pop'),
      log: at('insee_log'),
      complementCount: at('complement_info_nombre'),
      complementRate: at('complement_info_taux'),
    };
  }

  return {
    /** Feed one raw line (header first). */
    push(line) {
      if (!line) return;
      if (!header) {
        header = splitSsmsiLine(stripBom(line), NaN).map((name) => ssmsiText(name));
        columns = resolveColumns(header);
        if (columns.code < 0) throw new Error('delinquance: commune base has no CODGEO column');
        return;
      }
      const fields = splitSsmsiLine(line, header.length);
      if (fields.length !== header.length) slowLines += 1;
      rowsSwept += 1;
      const year = ssmsiText(fields[columns.annee]);
      yearsSeen.add(year);
      if (year !== wanted) return;
      const code = ssmsiText(fields[columns.code]);
      const indicator = indicatorForLabel(ssmsiText(fields[columns.indicateur]));
      if (!code) return;
      if (!indicator) {
        const label = ssmsiText(fields[columns.indicateur]);
        unknownLabels.set(label, (unknownLabels.get(label) || 0) + 1);
        return;
      }
      const slot = slugIndex.get(indicator.slug);
      if (slot === undefined) return;

      const state = delinquanceCellState({
        est_diffuse: fields[columns.est],
        nombre: fields[columns.nombre],
      });
      const count = state === CELL_SUPPRESSED ? null : ssmsiNumber(fields[columns.nombre]);
      const rate = state === CELL_SUPPRESSED ? null : ssmsiNumber(fields[columns.taux]);

      let entry = communes.get(code);
      if (!entry) {
        entry = {
          dep: code.startsWith('97') ? code.slice(0, 3) : code.slice(0, 2),
          pop: ssmsiNumber(fields[columns.pop]),
          log: ssmsiNumber(fields[columns.log]),
          cells: new Array(DELINQUANCE_COMMUNE_SLUGS.length).fill(null),
        };
        if (entry.pop === 0) zeroPopulation += 1;
        communes.set(code, entry);
      }
      // A suppressed cell carries NO numbers, and a zero cell carries none
      // either because its two are implied. That is not only smaller — it is
      // the shape that makes the wrong render impossible downstream: there is
      // no value on a `ndiff` cell to accidentally paint.
      if (state === CELL_SUPPRESSED) {
        entry.cells[slot] = [state];
        let depMeans = means.get(entry.dep);
        if (!depMeans) { depMeans = new Map(); means.set(entry.dep, depMeans); }
        let slugMeans = depMeans.get(indicator.slug);
        if (!slugMeans) { slugMeans = new Map(); depMeans.set(indicator.slug, slugMeans); }
        const meanCount = ssmsiNumber(fields[columns.complementCount]);
        const meanRate = ssmsiNumber(fields[columns.complementRate]);
        const key = `${meanCount}|${meanRate}`;
        const seen = slugMeans.get(key);
        if (seen) seen.rows += 1;
        else slugMeans.set(key, { count: meanCount, rate: meanRate, rows: 1 });
      } else if (state === CELL_ZERO) {
        entry.cells[slot] = [state];
      } else {
        entry.cells[slot] = [state, count, rate];
      }

      census.get(indicator.slug)[state] += 1;
      let depCensus = byDepartement.get(entry.dep);
      if (!depCensus) {
        depCensus = new Map();
        byDepartement.set(entry.dep, depCensus);
      }
      let cell = depCensus.get(indicator.slug);
      if (!cell) {
        cell = new Int32Array(3);
        depCensus.set(indicator.slug, cell);
      }
      cell[state] += 1;
      if (state === CELL_PUBLISHED && rate !== null && rate > 0) rates.get(indicator.slug).push(rate);
      rowsKept += 1;
    },

    /**
     * Close the fold and hand back everything it built.
     *
     * The computed total is derived HERE, in the one place that holds every
     * commune at once: its quantile ramp has to be cut nationally for the same
     * reason every other indicator's is (a pack-local cut would rebin a quiet
     * département into looking like a busy one), and a browser only ever holds
     * the two or three départements it is looking at.
     */
    finish() {
      const totalCensus = new Int32Array(3);
      const totalRates = [];
      for (const entry of communes.values()) {
        const total = aggregateDelinquanceCommuneTotal(entry.cells, entry.pop);
        // Appended, so every register slot keeps the index it was folded into.
        entry.cells[DELINQUANCE_COMMUNE_SLUGS.length] = total;
        totalCensus[total[0]] += 1;
        let depCensus = byDepartement.get(entry.dep);
        if (!depCensus) {
          depCensus = new Map();
          byDepartement.set(entry.dep, depCensus);
        }
        let cell = depCensus.get(DELINQUANCE_TOTAL_SLUG);
        if (!cell) {
          cell = new Int32Array(3);
          depCensus.set(DELINQUANCE_TOTAL_SLUG, cell);
        }
        cell[total[0]] += 1;
        if (total[0] === CELL_PUBLISHED && total[2] !== null && total[2] > 0) totalRates.push(total[2]);
      }
      census.set(DELINQUANCE_TOTAL_SLUG, totalCensus);
      rates.set(DELINQUANCE_TOTAL_SLUG, totalRates);

      return {
        year: wanted,
        yearsSeen: [...yearsSeen].filter((value) => /^\d{4}$/.test(value)).sort(),
        codeColumn,
        communes,
        rates,
        census: Object.fromEntries([...census].map(([slug, cell]) => [slug, [...cell]])),
        censusByDepartement: Object.fromEntries(
          [...byDepartement].map(([dep, map]) => [
            dep,
            Object.fromEntries([...map].map(([slug, cell]) => [slug, [...cell]])),
          ]),
        ),
        departementMeans: Object.fromEntries(
          [...means].map(([dep, map]) => [
            dep,
            Object.fromEntries([...map].map(([slug, tally]) => {
              const variants = [...tally.values()].sort((a, b) => b.rows - a.rows);
              const modal = variants[0];
              return [slug, {
                count: modal.count,
                rate: modal.rate,
                rows: modal.rows,
                variants: variants.length,
              }];
            })),
          ]),
        ),
        communeCount: communes.size,
        rowsSwept,
        rowsKept,
        // Non-zero here would mean the fast `split(';')` path was wrong for
        // some line and the quote-aware walk took over. Measured 0 across all
        // 5 238 000 rows on 2026-09-01.
        slowLines,
        zeroPopulation,
        unknownIndicators: [...unknownLabels.entries()]
          .map(([label, count]) => ({ label, rows: count }))
          .sort((a, b) => b.rows - a.rows),
      };
    },
  };
}

/**
 * Rank the indicators by how much map each one actually has.
 *
 * The control-panel row cannot carry eighteen chips, so the set has to be
 * chosen — and hand-picking six would be a claim about which crimes matter.
 * This rule is not: **the chips are the indicators with the most communes
 * carrying a PUBLISHED POSITIVE value**, i.e. the maps with the most ground
 * that can honestly be coloured. It is derived from the edition at build time,
 * so it moves when the data does.
 *
 * Measured on the 2025 edition: escroqueries 8 134, dégradations 7 350, vols
 * sans violence 5 181, violences intrafamiliales 4 682, cambriolages 4 493,
 * violences hors famille 3 224 — then a step down to 2 992 and below. Every
 * one of the fifteen is still readable on a clicked commune's card; only six
 * can be painted.
 *
 * @param {Record<string, Array<number>>} census slug -> [published, zero, suppressed]
 * @param {number} [limit]
 * @returns {Array<string>} Slugs, most-paintable first.
 */
export function selectDelinquanceChips(census, limit = 6) {
  const entries = DELINQUANCE_COMMUNE_SLUGS
    .map((slug) => ({ slug, published: Number(census?.[slug]?.[CELL_PUBLISHED]) || 0 }))
    .sort((a, b) => b.published - a.published || a.slug.localeCompare(b.slug));
  return entries.slice(0, Math.max(1, Math.floor(limit))).map((entry) => entry.slug);
}

// ---------------------------------------------------------------------------
// Commune contours
// ---------------------------------------------------------------------------

/**
 * The contour machinery lives in `communeContours.js`, which this layer used
 * to own outright. It moved out when the childcare layer became the second
 * caller — nothing in a ring's decimation is about recorded crime. The
 * measurements that justify the constants were made here, on the real SSMSI
 * geography, and stay here as the layer's own record of them.
 */
export {
  decimateCommuneRing,
  projectCommuneContours,
} from './communeContours.js';

/** Coordinate precision kept on a commune ring. 4 dp is ~11 m of latitude. */
export const DELINQUANCE_COORDINATE_DECIMALS = COMMUNE_COORDINATE_DECIMALS;
/**
 * Vertices kept per commune ring.
 *
 * Measured against the real contours on 2026-09-01. Pas-de-Calais is the worst
 * case at **887 communes and 4 135 420 bytes** of raw GeoJSON; at 64 vertices
 * and 4 dp it becomes 770 051 bytes of wire JSON (249 869 gzipped), against
 * 1 260 072 (392 454) at 128. A commune is a few dozen pixels wide at the zoom
 * this regime is entered at, so the extra 64 vertices buy nothing a reader can
 * see and cost 57% more payload on the largest département in France.
 */
export const DELINQUANCE_MAX_RING_VERTICES = COMMUNE_MAX_RING_VERTICES;
/**
 * Separate PIECES of one commune kept, largest first. Islands and exclaves
 * beyond the third are dropped; the count of what was dropped is reported so
 * the simplification is visible rather than silent.
 */
export const DELINQUANCE_MAX_PARTS = COMMUNE_MAX_PARTS;

/**
 * Join one département's contours to its folded commune cells.
 *
 * The two sides disagree by design and the disagreement is reported, not
 * papered over. Measured nationally 2026-09-01: every one of the 34 875
 * contours has an SSMSI row, and 45 SSMSI codes have no contour — the 20
 * arrondissements of Paris, 9 of Lyon, 16 of Marseille, whose parent communes
 * are drawn and carry the same totals. So `unshaped` is a FINER grain folded
 * away, never a loss, and the payload says which.
 *
 * @param {object} input
 * @param {Array<object>} input.contours From `projectCommuneContours`.
 * @param {Map<string,object>} input.cells From `createCommuneFold().finish().communes`.
 * @param {string} input.departement
 * @returns {object}
 */
export function joinCommuneCells({ contours, cells, departement }) {
  const shapes = Array.isArray(contours) ? contours : [];
  const source = cells instanceof Map ? cells : new Map();
  const drawn = [];
  const unshaped = [];
  const shapeCodes = new Set(shapes.map((shape) => shape.code));
  let withoutCells = 0;

  for (const shape of shapes) {
    const entry = source.get(shape.code);
    if (!entry) {
      withoutCells += 1;
      continue;
    }
    drawn.push({
      c: shape.code,
      n: shape.name,
      pop: entry.pop,
      log: entry.log,
      s: shape.simplified ? 1 : 0,
      p: shape.parts,
      v: entry.cells,
    });
  }
  for (const [code, entry] of source) {
    if (shapeCodes.has(code)) continue;
    if (entry.dep !== departement) continue;
    unshaped.push({ c: code, pop: entry.pop, v: entry.cells });
  }
  unshaped.sort((a, b) => a.c.localeCompare(b.c));
  return { communes: drawn, unshaped, withoutCells };
}
