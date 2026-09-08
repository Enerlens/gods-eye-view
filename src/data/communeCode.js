/**
 * @module communeCode
 *
 * The one piece of French geography every commune-keyed register needs, and
 * that every one of them spells differently: Paris, Lyon and Marseille.
 *
 * The BAN answers **75113** for a point in the 13th arrondissement, because an
 * address there really is in an *arrondissement municipal* and the COG says so.
 * Registers disagree about whether that is a place. Measured on 2026-09-08
 * against the live files:
 *
 *   - **Carte des loyers** publishes 75101…75120 — twenty rows, twenty prices.
 *   - **ARCEP Ma connexion internet** publishes **75056** and nothing finer:
 *     one row, 1 667 292 locaux, for the whole city.
 *   - **Atmo France** publishes 75056 as one `code_zone`.
 *   - **INSEE Melodi** publishes both, under two different levels — `COM` for
 *     75056 and `ARM` for 75113.
 *
 * So an address scan that asks four registers the same question has to hand
 * two of them a different code than the BAN gave it, and one of them a
 * different *level name* as well. Getting that wrong does not fail loudly: it
 * answers HTTP 200 with an empty result, which on a card reads as "there is no
 * fibre at this address" rather than as "you asked the wrong question".
 *
 * This module exists so that fold is written once. `adsFeed.js` carried the
 * first copy of it for Sitadel and still exports it under its own name.
 */

/** The three cities whose arrondissements have their own INSEE codes. */
const ARRONDISSEMENT_RANGES = Object.freeze([
  Object.freeze({ from: 75101, to: 75120, commune: '75056' }),
  Object.freeze({ from: 13201, to: 13216, commune: '13055' }),
  Object.freeze({ from: 69381, to: 69389, commune: '69123' }),
]);

/** The shape every French INSEE commune code has, Corsica included. */
export const COMMUNE_CODE_PATTERN = /^[0-9][0-9AB][0-9]{3}$/;

/**
 * Normalise a code to the five-character upper-case form, or null.
 * @param {unknown} code
 * @returns {?string}
 */
export function normaliseCommuneCode(code) {
  const raw = String(code ?? '').trim().toUpperCase();
  return COMMUNE_CODE_PATTERN.test(raw) ? raw : null;
}

/**
 * Fold an arrondissement code onto its parent commune.
 *
 * Every other code passes through unchanged, including the Corsican `2A`/`2B`
 * forms and the five-digit overseas ones.
 *
 * @param {?string} code INSEE code, at any level.
 * @returns {?string} The parent commune's code, or null when unusable.
 */
export function foldToCommune(code) {
  const raw = normaliseCommuneCode(code);
  if (!raw) return null;
  const number = Number.parseInt(raw, 10);
  for (const range of ARRONDISSEMENT_RANGES) {
    if (number >= range.from && number <= range.to) return range.commune;
  }
  return raw;
}

/**
 * Whether a code names an arrondissement municipal rather than a commune.
 *
 * The caller that needs this is the one talking to Melodi, which serves the
 * two under different `spatialResolution` names — `ARM` and `COM` — so the
 * level has to be chosen before the URL is built, not discovered from an empty
 * answer afterwards.
 *
 * @param {?string} code
 * @returns {boolean}
 */
export function isArrondissementCode(code) {
  const raw = normaliseCommuneCode(code);
  if (!raw) return false;
  return foldToCommune(raw) !== raw;
}
