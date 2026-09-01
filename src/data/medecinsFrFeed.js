/**
 * @module medecinsFrFeed
 *
 * Reading the French doctor register, and every trap in it.
 *
 * The pack is built offline by `scripts/build-medecins-fr.mjs` and shipped as
 * `local_data/medecins_fr/medecins.json` + `praticiens.jsonl`; see that
 * directory's README for where the data comes from and why it has to be built
 * rather than fetched. This file is the reading, `medecinsFrance.js` is the
 * drawing, and the split exists so every rule below is testable without a
 * globe.
 *
 * ── What a doctor map must not claim ────────────────────────────────────────
 *
 * The register has **no identifier** — no RPPS, no ADELI. So it cannot answer
 * "how many doctors are here", only "how many distinct names practise at this
 * address". The difference is not academic: a radiologist is listed at every
 * imaging site they cover, 5.53 entries per name against 1.18 for a GP, so a
 * map sized on ENTRIES makes radiology the second specialty of France at 16 %
 * of the profession. It is not. Everything here counts `SITE_PRACTITIONERS`,
 * the distinct-name tally the build wrote, and never the entry sum.
 */

import {
  MESH_CATEGORY,
  MESH_LAT,
  MESH_LON,
  MESH_WEIGHT,
  MESH_COLS,
  MESH_ROWS,
  meshBudgetForSpan,
  meshRowId,
  meshRowInBox,
  selectGeoMesh,
} from './geoMeshThinning.js';

export const MEDECINS_FR_LAYER_ID = 'medecins-fr';

export const MEDECINS_SOURCE = 'Annuaire santé Ameli — CNAM (data.gouv.fr), géocodé BAN';
export const MEDECINS_APL_SOURCE = 'Accessibilité potentielle localisée (APL) — DREES';

/** Tuple layout of `sites[]`, as `build-medecins-fr.mjs` writes it. */
export const SITE_LAT = 0;
export const SITE_LON = 1;
export const SITE_PRECISION = 2;
export const SITE_INSEE = 3;
export const SITE_CP = 4;
export const SITE_VILLE = 5;
export const SITE_VOIE = 6;
export const SITE_TEL = 7;
export const SITE_KIND = 8;
export const SITE_SPECIALTIES = 9;
export const SITE_PRACTITIONERS = 10;

/** Tuple layout of one entry in a `praticiens.jsonl` line. */
export const PRACTITIONER_NAME = 0;
export const PRACTITIONER_CIVILITE = 1;
export const PRACTITIONER_SPECIALTY = 2;
export const PRACTITIONER_SECTEUR = 3;
export const PRACTITIONER_OPTION = 4;

/** `apl.communes[insee]` layout. */
export const APL_ALL = 0;
export const APL_65 = 1;
export const APL_62 = 2;
export const APL_60 = 3;
export const APL_POPULATION = 4;
export const APL_POPULATION_STD = 5;

/** `apl.departements[dep]` layout. */
export const APL_DEP_ALL = 0;
export const APL_DEP_65 = 1;
export const APL_DEP_62 = 2;
export const APL_DEP_POPULATION = 3;
export const APL_DEP_COMMUNES = 4;

/**
 * Six families, chosen by **what a person is looking for**, not by the
 * nomenclature's own tree.
 *
 * Forty-eight specialties is a legend nobody reads and a palette nobody can
 * tell apart. The cut below is the one a reader actually makes: the front door
 * (généraliste), the two people search by name (femme-enfant, santé mentale),
 * the ones they are sent to (spécialiste), and the two they are referred into
 * rather than choose (chirurgie, imagerie).
 *
 * Two deliberate placements that a nomenclature would make differently:
 * **ORL (11) sits in `specialiste`, not `chirurgie`**, although its own label
 * says "et chirurgien cervico-facial" — nobody looks up a surgeon when their
 * ear hurts. **Stomatologie (18) and maxillo-facial (44, 45) sit in
 * `chirurgie`**, because that is what they are, whatever the dental-sounding
 * name suggests.
 *
 * Every code the pack publishes must appear here; `medecinsFrFeed.test.mjs`
 * asserts it against the shipped file, so a new specialty in a future edition
 * fails the build instead of silently becoming "autre".
 */
export const MEDECIN_FAMILIES = Object.freeze([
  'generaliste',
  'femme-enfant',
  'sante-mentale',
  'specialiste',
  'chirurgie',
  'imagerie',
]);

export const MEDECIN_FAMILY_LABELS = Object.freeze({
  generaliste: 'Médecine générale',
  'femme-enfant': 'Femme et enfant',
  'sante-mentale': 'Santé mentale',
  specialiste: 'Spécialité médicale',
  chirurgie: 'Chirurgie',
  imagerie: 'Imagerie et biologie',
});

const FAMILY_BY_SPECIALTY = Object.freeze({
  '01': 'generaliste',
  '07': 'femme-enfant',
  12: 'femme-enfant',
  17: 'sante-mentale',
  33: 'sante-mentale',
  '04': 'chirurgie',
  10: 'chirurgie',
  16: 'chirurgie',
  18: 'chirurgie',
  41: 'chirurgie',
  43: 'chirurgie',
  44: 'chirurgie',
  45: 'chirurgie',
  46: 'chirurgie',
  47: 'chirurgie',
  48: 'chirurgie',
  49: 'chirurgie',
  69: 'chirurgie',
  '06': 'imagerie',
  37: 'imagerie',
  38: 'imagerie',
  72: 'imagerie',
  74: 'imagerie',
  76: 'imagerie',
  '02': 'specialiste',
  '03': 'specialiste',
  '05': 'specialiste',
  '08': 'specialiste',
  '09': 'specialiste',
  11: 'specialiste',
  13: 'specialiste',
  14: 'specialiste',
  15: 'specialiste',
  20: 'specialiste',
  31: 'specialiste',
  32: 'specialiste',
  34: 'specialiste',
  35: 'specialiste',
  42: 'specialiste',
  71: 'specialiste',
  73: 'specialiste',
  78: 'specialiste',
  80: 'specialiste',
  81: 'specialiste',
  82: 'specialiste',
  83: 'specialiste',
  84: 'specialiste',
  85: 'specialiste',
});

export const MEDECIN_FAMILY_INDEX = Object.freeze(
  Object.fromEntries(MEDECIN_FAMILIES.map((family, index) => [family, index])),
);

/**
 * @param {string} code  a canonical `specialite_code` from the pack
 * @returns {string} one of `MEDECIN_FAMILIES`; unknown codes fall to
 *   `specialiste` rather than throwing, because a live globe must not go blank
 *   over one unmapped row — the test is what makes that case loud.
 */
export function medecinFamily(code) {
  return FAMILY_BY_SPECIALTY[String(code)] ?? 'specialiste';
}

/** Every specialty code the family table covers, for the shipped-pack test. */
export function mappedSpecialtyCodes() {
  return Object.keys(FAMILY_BY_SPECIALTY);
}

/** BAN's own word for what it matched, in the pack's index order. */
export const MEDECIN_PRECISION_LABELS = Object.freeze({
  numero: 'adresse exacte',
  voie: 'rue, sans le numéro',
  'lieu-dit': 'lieu-dit',
  commune: 'centre de la commune',
});

/**
 * The conventional sector, said the way a patient experiences it.
 *
 * Not the register's own labels: "Secteur 2" tells a reader nothing, and
 * "OPTAM" tells them less. What matters at the point of care is whether the
 * price is fixed, capped, or free — so that is what the card says. Measured on
 * the shipped pack: 94 % of GP entries are secteur 1, against 18 % of
 * ophthalmologist entries, 63 % of whom set their own fees.
 */
export const MEDECIN_TARIFF_LABELS = Object.freeze({
  1: 'tarif fixé (secteur 1)',
  3: 'honoraires libres (secteur 2)',
  2: 'dépassement permanent',
  0: 'non conventionné',
});

export const MEDECIN_TARIFF_CAPPED = 'dépassements plafonnés (OPTAM)';

/**
 * What one practitioner costs you, in one phrase.
 * @param {string} secteur  `secteur_conventionnel_code`
 * @param {string} option   `option_tarifaire_code`, empty when there is none
 */
export function practitionerTariff(secteur, option) {
  const code = String(secteur ?? '');
  if (code === '3' && (option === '3' || option === '4')) return MEDECIN_TARIFF_CAPPED;
  return MEDECIN_TARIFF_LABELS[code] ?? 'secteur non publié';
}

/**
 * Fold a site's practitioners into the one sentence a reader wants: is this
 * place cheap, capped, or open-ended?
 *
 * Returns counts rather than a verdict — a site with eight secteur-1 GPs and
 * one secteur-2 dermatologist is not "expensive", and only the caller knows
 * which specialty the reader came for.
 */
export function tariffMix(practitioners) {
  const mix = { fixe: 0, plafonne: 0, libre: 0, autre: 0 };
  for (const entry of practitioners ?? []) {
    const secteur = String(entry[PRACTITIONER_SECTEUR] ?? '');
    const option = String(entry[PRACTITIONER_OPTION] ?? '');
    if (secteur === '1') mix.fixe += 1;
    else if (secteur === '3' && (option === '3' || option === '4')) mix.plafonne += 1;
    else if (secteur === '3') mix.libre += 1;
    else mix.autre += 1;
  }
  return mix;
}

/**
 * Place an APL value in its national tenth — 1 is the worst-served tenth of
 * the population, 10 the best.
 *
 * WHY A DECILE AND NOT THE NUMBER: "2,36 consultations par habitant et par an"
 * is the DREES's unit and it is unreadable. "Le 3e dixième — les 30 % de
 * France les moins bien dotés" is the same fact, and it is a sentence. The
 * bounds come from the pack, which reproduces the DREES's own published decile
 * table to ±0.02 across three millésimes.
 *
 * @param {number} value  an APL, in the same series as `bornes`
 * @param {number[]} bornes  `apl.bornes` — the value closing each tenth
 * @returns {?number} 1–10, or null when either input is missing
 */
export function aplDecile(value, bornes) {
  if (!Number.isFinite(value) || !Array.isArray(bornes) || bornes.length !== 10) return null;
  for (let index = 0; index < bornes.length; index += 1) {
    if (value <= bornes[index]) return index + 1;
  }
  return 10;
}

/**
 * The zoning verdict the ARS actually use: under-served at 2.5 or below,
 * well-served above 4.
 *
 * These bounds are fixed policy, not quantiles, and they are worth keeping
 * separate from the deciles for exactly that reason — a commune can be in the
 * bottom tenth of a well-supplied country, or above the threshold in a badly
 * supplied one, and conflating the two would make the map lie in both
 * directions.
 */
export function aplStanding(value, seuils) {
  if (!Number.isFinite(value)) return null;
  const under = seuils?.sousDotee ?? 2.5;
  const well = seuils?.bienDotee ?? 4;
  if (value <= under) return 'sous-dotee';
  if (value > well) return 'bien-dotee';
  return 'moyennement-dotee';
}

export const APL_STANDING_LABELS = Object.freeze({
  'sous-dotee': 'zone sous-dotée',
  'moyennement-dotee': 'moyennement dotée',
  'bien-dotee': 'bien dotée',
});

/**
 * How much of the local supply is standing on doctors about to retire.
 *
 * The pack carries the same indicator recomputed while retiring everyone over
 * 65, 62 and 60 — the closest thing anyone publishes to "and in five years".
 * Nationally that reads 3.73 → 3.27 → 2.91, so the country loses 22 % of its
 * general-practice access to the over-62s alone.
 *
 * @returns {?{now:number, at65:number, at62:number, dropAt62:number}}
 */
export function retirementCliff(commune) {
  if (!Array.isArray(commune)) return null;
  const now = commune[APL_ALL];
  const at62 = commune[APL_62];
  if (!Number.isFinite(now) || !Number.isFinite(at62) || now <= 0) return null;
  return {
    now,
    at65: commune[APL_65],
    at62,
    dropAt62: (at62 / now) - 1,
  };
}

/**
 * The family a site is READ as, when one dot has to stand for the place.
 *
 * Général practice wins whenever it is present, whatever the counts say. A
 * health centre with one GP and nine radiologists is, to the person looking at
 * the map, a place you can see a GP — and that is the scarcer, more searched
 * fact. Otherwise the largest family wins, ties broken by the family order so
 * the same site never changes colour between two renders.
 */
export function sitePrimaryFamily(site) {
  const counts = familyCounts(site);
  if (counts.generaliste) return 'generaliste';
  let best = null;
  let bestCount = 0;
  for (const family of MEDECIN_FAMILIES) {
    const count = counts[family] ?? 0;
    if (count > bestCount) { best = family; bestCount = count; }
  }
  return best ?? 'specialiste';
}

/** Entry counts per family for one site. Entries, not people — see the header. */
export function familyCounts(site) {
  const counts = {};
  for (const [code, count] of site?.[SITE_SPECIALTIES] ?? []) {
    const family = medecinFamily(code);
    counts[family] = (counts[family] ?? 0) + count;
  }
  return counts;
}

/** Specialties at a site, richest first, resolved to labels for a card. */
export function siteSpecialtyList(site, labels) {
  return (site?.[SITE_SPECIALTIES] ?? [])
    .map(([code, count]) => ({
      code,
      count,
      family: medecinFamily(code),
      label: labels?.[code] ?? code,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'));
}

/**
 * Mesh budgets, on the same ladder the schools and charge-point layers use.
 *
 * 64 232 sites is the same order as the schools register, so the tiers are the
 * same tiers: enough dots to read the shape of the country, never enough to
 * make the browser allocate its way into a stall.
 */
export const MEDECINS_MESH_BUDGETS = Object.freeze([
  Object.freeze({ maxSpanDeg: 1.2, budget: 2200 }),
  Object.freeze({ maxSpanDeg: 3, budget: 1800 }),
  Object.freeze({ maxSpanDeg: 6, budget: 1400 }),
  Object.freeze({ maxSpanDeg: Infinity, budget: 1100 }),
]);

export function medecinsMeshBudget(latSpanDeg) {
  return meshBudgetForSpan(latSpanDeg, MEDECINS_MESH_BUDGETS);
}

export const MEDECINS_MESH_COLS = MESH_COLS;
export const MEDECINS_MESH_ROWS = MESH_ROWS;
export { MESH_LAT, MESH_LON };
/** Weight is the DISTINCT-NAME count, never the entry sum. See the header. */
export const MESH_PRACTITIONERS = MESH_WEIGHT;
export const MESH_FAMILY = MESH_CATEGORY;

export function meshMedecinInBox(row, box) {
  return meshRowInBox(row, box);
}

export function meshMedecinId(row) {
  return meshRowId(row);
}

export function selectMedecinsMesh(rows, options = {}) {
  return selectGeoMesh(rows, {
    cols: MEDECINS_MESH_COLS,
    rows: MEDECINS_MESH_ROWS,
    ...options,
  });
}

/**
 * Project the shipped sites into the mesh tuple the thinner consumes.
 * `[lat, lon, practitioners, familyIndex]`.
 */
export function projectMedecinsMesh(sites) {
  const rows = [];
  for (const site of sites ?? []) {
    rows.push([
      site[SITE_LAT],
      site[SITE_LON],
      site[SITE_PRACTITIONERS] || 1,
      MEDECIN_FAMILY_INDEX[sitePrimaryFamily(site)] ?? MEDECIN_FAMILY_INDEX.specialiste,
    ]);
  }
  return rows;
}

/**
 * The widest box the site regime will ask for, in degrees.
 *
 * Paris at 0.35° holds 4 488 sites; the same span over the Massif central
 * holds forty. The ceiling is not about the server — the pack is on disk and
 * answers in milliseconds — it is about how many cards a viewport can honestly
 * carry before it becomes a smear.
 */
export const MEDECINS_MAX_BOX_DEG = 0.6;

/** Below this latitude span, the layer draws real sites rather than a mesh. */
export const MEDECINS_SITES_SPAN_DEG = 0.6;

/**
 * The national regime is entered on LATITUDE span, never on the larger of the
 * two spans — on a 16:10 viewport the larger span is mostly a statement about
 * the window's shape. Metropolitan France is 9.8° tall.
 */
export const MEDECINS_NATIONAL_SPAN_DEG = 9.5;

export function medecinsRegime(latSpanDeg) {
  if (!Number.isFinite(latSpanDeg)) return 'national';
  if (latSpanDeg >= MEDECINS_NATIONAL_SPAN_DEG) return 'national';
  if (latSpanDeg <= MEDECINS_SITES_SPAN_DEG) return 'sites';
  return 'mesh';
}
