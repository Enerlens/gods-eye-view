/**
 * @module data/emploiFeed
 *
 * **Emploi** — activity, employment and unemployment where people live, from
 * the census, at the finest geography INSEE publishes it.
 *
 * The second of Cityscan's ten themes on which this fork was at zero. Melodi
 * is INSEE's open-data API: keyless, one URL per dataset, already used by
 * `build-filosofi-territoires.mjs` for the national ramp. `DS_RP_EMPLOI_LR_PRINC`
 * carries 17 877 132 observations of the resident population aged 15 to 64 by
 * declared activity status, at **commune and arrondissement municipal** level
 * among others — so Paris 13e has its own figures, unlike four of the other
 * registers this fiche joins.
 *
 * ── Only the four codes arithmetic can vouch for ────────────────────────────
 * `EMPSTA_ENQ` publishes ten modalities and Melodi serves no code list this
 * module could read at runtime — `/catalog/codelist/...` is a 404, and the
 * `structure` field answers with a DSD name and nothing behind it. Rather than
 * hard-code labels from memory for the six inactive breakdowns, this module
 * reads the four whose meaning its own arithmetic pins down, and **checks the
 * two identities on every answer**:
 *
 *   `1` + `2` = `1T2`      employed + unemployed = active
 *   `1T2` + `3` = `_T`     active + inactive = the whole 15-64 population
 *
 * Measured on Paris 13e: both hold to 0,0 for all three census vintages. If a
 * future edition renumbered a modality, the identity would break and the
 * payload says so rather than publishing a rate computed on the wrong column.
 *
 * ── THE REFUSAL THAT MATTERS: a rate on four people is not a rate ───────────
 * La Haute-Beaume (05066), 2023 census: **1,75 active residents, of whom 1,75
 * are unemployed and 0,0 are employed**, out of 3,5 people aged 15 to 64.
 * Printed as a percentage that is a 100 % unemployment rate, and it is
 * nonsense — the values are weighted survey estimates, which is also why they
 * carry decimals.
 *
 * So a rate is computed only above {@link EMPLOI_RATE_FLOOR} active residents,
 * a floor chosen so that **one person cannot move the rate by a whole point**.
 * Below it the counts are still reported — they are real — and the rate is
 * refused in as many words. Cityscan grades every address; this one says when
 * it cannot.
 *
 * ── Scope: France hors Mayotte, and it answers HTTP 200 to prove it ─────────
 * Asking for `2026-COM-97611` (Mamoudzou) returns **200 with zero
 * observations**, not an error. That is out-of-scope, not missing data, and
 * the two must not read the same on a card. An unknown geography, by contrast,
 * is an HTTP 400 with a non-JSON body.
 *
 * ── Three vintages, which is a fact Cityscan's static score cannot carry ────
 * The dataset publishes 2012, 2017 and 2023 side by side. The direction of
 * travel at one address — Paris 13e went 11,8 % → 12,9 % → 11,9 % — is a
 * different and more useful statement than any single year's level.
 *
 * ── The level name has to be chosen before the URL is built ─────────────────
 * Melodi serves communes as `COM` and Paris/Lyon/Marseille arrondissements as
 * `ARM`. Handing it `2026-COM-75113` returns an empty answer, not an error.
 * See `communeCode.js`.
 *
 * Dependency-free and side-effect-free. The `/api/emploi-fr` proxy imports it.
 */

import { isArrondissementCode, normaliseCommuneCode } from './communeCode.js';

/** Attribution carried on every payload (see DATA_SOURCES.md). */
export const EMPLOI_SOURCE = 'Recensement de la population — INSEE (Melodi)';
export const EMPLOI_LICENCE = 'Licence Ouverte 2.0';

export const MELODI_BASE = 'https://api.insee.fr/melodi/data';
export const EMPLOI_DATASET = 'DS_RP_EMPLOI_LR_PRINC';
/** Geographic vintage asked for. Melodi normalises, so this is a hint. */
export const EMPLOI_COG = '2026';

/**
 * The four activity-status codes this module reads.
 *
 * Every one of them is pinned by the two identities in the module header. The
 * inactive breakdown (`31`, `33`, `35`, `36`) is deliberately left alone.
 */
export const EMPLOI_STATUS = Object.freeze({
  employed: '1',
  unemployed: '2',
  active: '1T2',
  inactive: '3',
  total: '_T',
});

/**
 * Minimum active residents before a rate is published.
 *
 * One hundred, so that one person is worth at most one percentage point. Below
 * it the counts stand and the rate does not.
 */
export const EMPLOI_RATE_FLOOR = 100;

/**
 * The URL for one territory.
 *
 * `AGE=Y15T64` and `SEX=_T` and `EDUC=_T` are sent rather than filtered
 * afterwards: the unfiltered dataset crosses age, sex and diploma, and one
 * commune unfiltered is thousands of observations of which thirty are wanted.
 *
 * @param {string} code INSEE code, commune or arrondissement.
 * @returns {?string}
 */
export function buildEmploiUrl(code) {
  const raw = normaliseCommuneCode(code);
  if (!raw) return null;
  const level = isArrondissementCode(raw) ? 'ARM' : 'COM';
  const query = new URLSearchParams({
    GEO: `${EMPLOI_COG}-${level}-${raw}`,
    SEX: '_T',
    AGE: 'Y15T64',
    EDUC: '_T',
    maxResult: '200',
  });
  return `${MELODI_BASE}/${EMPLOI_DATASET}?${query.toString()}`;
}

/**
 * Index one Melodi answer by census year, then by activity status.
 *
 * @param {object} payload
 * @returns {Map<string, Map<string, number>>}
 */
export function indexEmploiObservations(payload) {
  const byYear = new Map();
  for (const observation of payload?.observations || []) {
    const year = String(observation?.dimensions?.TIME_PERIOD ?? '');
    const status = String(observation?.dimensions?.EMPSTA_ENQ ?? '');
    const value = Number(observation?.measures?.OBS_VALUE_NIVEAU?.value);
    if (!year || !status || !Number.isFinite(value)) continue;
    if (!byYear.has(year)) byYear.set(year, new Map());
    byYear.get(year).set(status, value);
  }
  return byYear;
}

/** A rate in percent to one decimal, or null. */
function rate(part, whole) {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/** Weighted census estimates carry decimals; a headcount does not. */
function people(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

/**
 * Build one census year's figures, with the two identities checked.
 *
 * @param {string} year
 * @param {Map<string, number>} values
 * @returns {?object}
 */
export function projectEmploiYear(year, values) {
  const employed = values?.get(EMPLOI_STATUS.employed);
  const unemployed = values?.get(EMPLOI_STATUS.unemployed);
  const active = values?.get(EMPLOI_STATUS.active);
  const inactive = values?.get(EMPLOI_STATUS.inactive);
  const total = values?.get(EMPLOI_STATUS.total);
  if (![employed, unemployed, active, total].every(Number.isFinite)) return null;
  // Half a person of slack, which is a rounding tolerance and not a licence:
  // the identities held to 0,0 on every territory measured, so anything above
  // this is a renumbered modality rather than arithmetic drift.
  const tolerance = 0.5;
  const consistent = Math.abs((employed + unemployed) - active) <= tolerance
    && (!Number.isFinite(inactive) || Math.abs((active + inactive) - total) <= tolerance);
  // The floor is on ACTIVE residents because they are the denominator of the
  // rate that matters; the employment and activity rates use the whole 15-64
  // population, which is always larger, so one floor covers all three.
  const enough = active >= EMPLOI_RATE_FLOOR;
  return {
    year,
    employed: people(employed),
    unemployed: people(unemployed),
    active: people(active),
    inactive: people(inactive),
    population: people(total),
    // Null rather than a number when the population cannot carry one. The
    // reason travels with it so a card never has to guess.
    unemploymentRate: enough && consistent ? rate(unemployed, active) : null,
    activityRate: enough && consistent ? rate(active, total) : null,
    employmentRate: enough && consistent ? rate(employed, total) : null,
    ratesWithheld: enough ? (consistent ? null : 'identités arithmétiques non vérifiées')
      : `moins de ${EMPLOI_RATE_FLOOR} actifs`,
    consistent,
  };
}

/**
 * Project a Melodi answer into one payload: the newest census, then the trend.
 *
 * @param {object} options
 * @param {object} options.payload Melodi's JSON.
 * @param {string} options.code The INSEE code asked for.
 * @param {boolean} [options.inScope] False when the territory is known to be
 *   outside the dataset's own scope — Mayotte — so an empty answer can be
 *   reported as out of scope rather than as silence.
 * @returns {?object}
 */
export function projectEmploi({ payload, code, inScope = true }) {
  const byYear = indexEmploiObservations(payload);
  const years = [...byYear.keys()].sort();
  const series = years
    .map((year) => projectEmploiYear(year, byYear.get(year)))
    .filter(Boolean);
  const requested = normaliseCommuneCode(code);
  if (!series.length) {
    // HTTP 200 with no observations. Two very different facts wear that shape.
    return {
      commune: { code: requested, level: requested && isArrondissementCode(requested) ? 'ARM' : 'COM' },
      current: null,
      series: [],
      outOfScope: !inScope,
      empty: true,
      source: EMPLOI_SOURCE,
      licence: EMPLOI_LICENCE,
    };
  }
  const current = series[series.length - 1];
  const previous = series.length > 1 ? series[series.length - 2] : null;
  return {
    commune: {
      code: requested,
      level: requested && isArrondissementCode(requested) ? 'ARM' : 'COM',
    },
    current,
    // The earlier censuses, oldest first. The direction is the product here.
    series,
    trend: previous && current.unemploymentRate !== null && previous.unemploymentRate !== null
      ? Math.round((current.unemploymentRate - previous.unemploymentRate) * 10) / 10
      : null,
    ageRange: '15 à 64 ans',
    basis: 'lieu de résidence',
    outOfScope: false,
    empty: false,
    source: EMPLOI_SOURCE,
    licence: EMPLOI_LICENCE,
  };
}
