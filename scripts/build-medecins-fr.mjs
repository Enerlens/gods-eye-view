#!/usr/bin/env node
/**
 * Build `src/data/local_data/medecins_fr/medecins.json` — every place in France
 * where a doctor holds a conventioned practice, and the best coordinate anyone
 * can derive for it.
 *
 * WHY THIS SCRIPT EXISTS: **the national register of doctors has no
 * coordinates, and the geocoded copies in circulation are a decade old.**
 *
 * The Caisse nationale de l'Assurance Maladie publishes the *Annuaire santé
 * Ameli* (`annuaire-sante-ameli`, Licence Ouverte 2.0, weekly) — the only
 * nationwide list of doctors practising under convention, published under
 * article L. 1461-2 of the Code de la santé publique. Measured on the
 * 2026-08-17 edition: **555 249 rows, of which 194 114 are doctors**. Its
 * address block is called `coordonnees_*`, and that word is a false friend:
 * `coordonnees_voie`, `coordonnees_code_postal`, `coordonnees_ville`,
 * `coordonnees_num_tel`. It means *contact details*. **There is not one
 * latitude in the file.**
 *
 * The obvious escape is to use one of the ready-geocoded copies — Opendatasoft
 * publishes `medecins` with a real `geo_point_2d`, and a dozen territorial
 * portals (Île-de-France, Aix-Marseille, Orléans, Blois, Gers…) federate it
 * with an Explore API that would have made this script unnecessary. Do not.
 * Every one of them descends from the PREVIOUS CNAM directory, which was
 * deprecated when the Ameli file replaced it in December 2025, and the age
 * shows in its own columns: its convention field still reads *"Secteur 2,
 * Signature du contrat d'accès aux soins"*. The CAS closed to new signatures on
 * 2016-12-31 and was replaced by the OPTAM — which is what the current Ameli
 * file publishes. That copy also holds **128 721 distinct professionals of
 * every profession**, against 187 584 distinct doctor-at-address tuples in the
 * file this script reads. It is not a stale mirror; it is a different decade.
 *
 * The one daily-geocoded national register does exist — Atlasanté's RPPS
 * layer, geocoded through the IGN geoservices — and it answers HTTP 403,
 * *"Accès interdit aux données en consultation"*, to anyone outside the ARS
 * network. So the geocoding has to happen here.
 *
 *   1. **CNAM — Annuaire santé Ameli** (Licence Ouverte 2.0), the PS file. The
 *      spine: name, specialty, practice address, telephone, conventional
 *      sector, tariff option, Sesam-Vitale. Coordinates: none.
 *   2. **CNAM — Annuaire santé Ameli**, the CDS file. 3 601 centres de santé by
 *      FINESS number, of which **2 375 over 2 346 addresses offer a medical
 *      specialty** — 9 086 more entries. Urban general practice the PS file
 *      alone would leave as a hole.
 *   3. **BAN — Base Adresse Nationale** (Licence Ouverte 2.0), through
 *      `api-adresse.data.gouv.fr/search/csv/`. Keyless, batch, no quota to ask
 *      for. It is what turns 1 and 2 into a map.
 *
 * ── The three geocoding passes, and why there are three ─────────────────────
 *
 * Deduplicating doctors down to practice addresses gives 64 625 addresses, and
 * a single BAN pass filtered on the postcode column places 60 702 of them
 * (93.9 %). The 3 923 failures are not bad addresses — they are **CEDEX**.
 * The register stores the CEDEX distribution code where a postcode belongs:
 * `57085 METZ CEDEX 03` is a mail-sorting identity, not a place, and BAN
 * rightly knows no such postcode. So:
 *
 *   pass 1  voie + ville, FILTERED on code_postal. Strictest, 93.9 %.
 *   pass 2  the failures again, CEDEX and CS/BP/TSA stripped, postcode filter
 *           DROPPED — matching on text alone. Recovers 2 982.
 *   pass 3  what is still missing, ville alone, accepting a commune centre.
 *           Recovers 547 more, and they are marked as commune-level.
 *
 * Passes 2 and 3 drop the postcode filter, so they can match a same-named
 * commune four departments away. Every result from them is therefore checked
 * against the department of the original postcode and DISCARDED on mismatch —
 * 512 in pass 2, 382 in pass 3. Placing a Metz practice in the Var would be
 * worse than not placing it, so 394 addresses end this script unplaced, are
 * counted in `stats.passes.unplaced`, listed by name in `nonLocalisees`, and
 * are not drawn anywhere.
 *
 * ── What the precision means ────────────────────────────────────────────────
 *
 * BAN says what it matched, and this file keeps that word rather than flatten
 * it: `numero` (53 442 addresses, 82.7 %, the exact door), `voie` (9 390,
 * 14.5 %, the street), `lieu-dit` (683), `commune` (716 — the town centre,
 * which is not a surgery). A consumer that draws all four the same way is
 * claiming a precision the source never gave. Same rule the schools layer
 * settled on, for the same reason.
 *
 * ── What this file cannot tell you ──────────────────────────────────────────
 *
 * **The register carries no identifier.** No RPPS, no ADELI, no SIRET — just a
 * name, a specialty and an address. So "how many doctors are there" is NOT
 * answerable from it: a doctor practising on two sites is two rows, and two
 * namesakes at one address are indistinguishable from one doctor listed twice.
 * Everything this script counts is counted in tuples of (name, first name,
 * address), and `stats` says so in those words. Do not let a consumer print
 * "187 584 doctors" — the honest sentence is "187 584 distinct
 * practitioner-at-address entries".
 *
 * It is also **conventioned liberal practice only**. A hospital salaried
 * doctor is not in it, which is why the map thins out around a CHU rather than
 * over it. The exhaustive register of everyone authorised to practise is the
 * ANS's RPPS extraction — 817 MB, daily, and with no coordinates either.
 *
 * ── Is it right? The CNAM's own headcount says yes ──────────────────────────
 *
 * The same publisher counts the same population a second way, in
 * `demographie-exercices-liberaux` on data.ameli.fr — liberal exclusive plus
 * mixed, millésime 2024 — and that is the control `--verifier` runs against.
 * Measured 2026-09-01: **117 922 named doctors here against 112 159 there,
 * +5.1 %**, across 23 matched professions running −1.5 % to +15.1 % with the
 * bulk between +2 and +6 %. Per DEPARTMENT — the number that decides whether a
 * map is honest — the median gap is **+2.1 %, with 97 of 101 departments inside
 * [-10 %, +15 %]**, so the geocoding has not moved population between
 * departments. A directory sitting a few percent above an activity count taken
 * two years earlier is the expected answer, not a defect.
 *
 * ── Two outputs, and why the names are not in the map file ──────────────────
 *
 *   medecins.json     sites, specialties, the department rollup, the APL.
 *   praticiens.jsonl  the named practitioners, ONE LINE PER SITE, in the same
 *                     order as `sites[]`.
 *
 * Inlining the names cost 4.9 MB on a 7.3 MB file, downloaded in full to draw
 * dots that never show a name. Line N ↔ `sites[N]` means a byte-offset index
 * stays trivial the day the card is served by a proxy.
 *
 * Usage:
 *   npm run medecins:registry
 *   npm run medecins:registry -- --report        # full precision + coverage audit
 *   npm run medecins:registry -- --refresh       # re-download, ignore the cache
 *   npm run medecins:registry -- --no-cds        # PS file only, skip centres de santé
 *   npm run medecins:registry -- --no-apl        # skip the DREES accessibility indicator
 *   npm run medecins:registry -- --praticiens    # also write the per-doctor CSV to the cache
 *   npm run medecins:registry -- --verifier      # cross-check against the CNAM's own headcount
 *   npm run medecins:registry -- --plain         # write the two outputs uncompressed
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { listXlsxSheets, readXlsxSheet } from './lib/xlsx-sheet.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(ROOT, 'src', 'data', 'local_data', 'medecins_fr', 'medecins.json');
const CACHE_DIR = path.join(ROOT, '.gev-cache', 'medecins-fr');
const USER_AGENT = 'gods-eye-view/0.1 (+https://github.com/bilawalsidhu/gods-eye-view)';

const DATAGOUV_DATASET = 'https://www.data.gouv.fr/api/1/datasets/annuaire-sante-ameli/';
const DATAGOUV_APL = 'https://www.data.gouv.fr/api/1/datasets/accessibilite-potentielle-localisee-apl-aux-professionnels-de-sante/';
/** The CNAM's OWN headcount of the same population — the control, see `verify`. */
const AMELI_DEMOGRAPHY = 'https://data.ameli.fr/api/explore/v2.1/catalog/datasets/demographie-exercices-liberaux/records';
const BAN_CSV = 'https://api-adresse.data.gouv.fr/search/csv/';
/** The official commune list — the referee when BAN and the register disagree. */
const GEO_API_COMMUNES = 'https://geo.api.gouv.fr/communes?fields=code,nom,centre&format=json';

/**
 * Rows per BAN request.
 *
 * The endpoint accepts far more, and the reason to stay at 8 000 is not size
 * but blast radius: one chunk in eight returned HTTP 500 on the build this
 * script was written from, and a retry of 8 000 rows costs 35 seconds where a
 * retry of the whole 64 625 costs five minutes. Chunks are cached individually
 * so a failure never re-does the work that succeeded.
 */
const BAN_CHUNK_ROWS = 8000;
const BAN_ATTEMPTS = 4;

/**
 * The 54 `specialite_code` values the PS file marks as `type_ps_code = 1`.
 *
 * Derived from the register rather than hard-coded from a nomenclature, and
 * verified disjoint: not one of these 54 codes ever appears on a row of type 2
 * (dentists, midwives, nurses…), 3 (laboratories), 4 (non-conventioned) or 5.
 * That disjointness is what lets the CDS file — which carries no
 * `type_ps_code` column at all — be filtered by specialty alone.
 */
function medecinSpecialtyCodes(psRows) {
  const byType = new Map();
  for (const row of psRows) {
    const type = row.type_ps_code;
    if (!byType.has(type)) byType.set(type, new Set());
    byType.get(type).add(row.specialite_code);
  }
  const medecins = byType.get('1') ?? new Set();
  const others = new Set();
  for (const [type, codes] of byType) {
    if (type === '1') continue;
    for (const code of codes) others.add(code);
  }
  const shared = [...medecins].filter((code) => others.has(code));
  if (shared.length) {
    // A shared code would mean the CDS filter silently admits dentists as
    // doctors. Refuse the build rather than publish the wrong denominator.
    throw new Error(
      `specialite_code ${shared.join(', ')} appears on both doctor and non-doctor rows — `
      + 'the CDS filter can no longer be built from specialty alone',
    );
  }
  return medecins;
}

/**
 * Collapse the specialty codes that publish the SAME label onto one canonical
 * code, and keep the map that says which was folded into which.
 *
 * **The register spells one specialty several ways.** `01`, `22` and `23` are
 * all `Médecin généraliste` — 60 207, 6 897 and 688 rows — with nothing in the
 * published columns to tell them apart (`activite_particuliere_libelle` is
 * empty on 99 % of all three). `33`/`75` are both `Psychiatre`;
 * `07`/`70`/`77`/`79` are all `Gynécologue / Obstétricien`. A consumer that
 * groups by code — the obvious thing to do — silently drops **7 585 general
 * practitioners, 11 % of them**, into two categories it will render as
 * something else or not at all.
 *
 * So the label is the identity here, and the code is not. `alias` is published
 * alongside so nothing is hidden: a reader who needs the register's own code
 * can always undo this.
 */
function canonicalSpecialties(labelByCode) {
  const canonicalByLabel = new Map();
  for (const code of Object.keys(labelByCode).sort()) {
    const label = labelByCode[code];
    if (!canonicalByLabel.has(label)) canonicalByLabel.set(label, code);
  }
  const canonicalByCode = {};
  const alias = {};
  for (const [code, label] of Object.entries(labelByCode)) {
    const canonical = canonicalByLabel.get(label);
    canonicalByCode[code] = canonical;
    if (canonical !== code) alias[code] = canonical;
  }
  const labels = Object.fromEntries(
    [...canonicalByLabel].map(([label, code]) => [code, label]),
  );
  return { canonicalByCode, alias, labels };
}

/**
 * The two tariff vocabularies, kept as the register's own codes.
 *
 * They are what makes the difference between a 30 € consultation and a 70 €
 * one, so they belong on the card. Measured on the 2026-08-17 edition:
 * 115 575 doctor rows in secteur 1, 76 999 in secteur 2, 1 484 non
 * conventionné, 56 with a permanent right to overcharge — and 38 856 rows
 * carrying an OPTAM commitment, which caps what secteur 2 may charge. An empty
 * `option_tarifaire_code` means NO commitment, not an unknown one.
 */
const SECTEUR_LABELS = Object.freeze({
  0: 'Non conventionné',
  1: 'Secteur 1 ou conventionné',
  2: 'Conventionné Dépassement Permanent',
  3: 'Secteur 2',
});
const OPTION_TARIFAIRE_LABELS = Object.freeze({
  3: 'OPTAM',
  4: 'OPTAM-ACO',
});

/** `numero` is the exact door; `commune` is the town centre and not a surgery. */
const PRECISION = Object.freeze(['numero', 'voie', 'lieu-dit', 'commune']);
const PRECISION_BY_BAN_TYPE = Object.freeze({
  housenumber: 'numero',
  street: 'voie',
  locality: 'lieu-dit',
  municipality: 'commune',
});


/**
 * The APL — *accessibilité potentielle localisée* — for general practice, by
 * commune.
 *
 * WHY IT IS HERE AND POSITIONS ARE NOT ENOUGH: a map of where doctors are is
 * not a map of where they are missing. The APL is the DREES's answer to that,
 * and it is the indicator the ARS, the assurance maladie and every "désert
 * médical" article in France actually use. It is not a density: it counts, for
 * each commune, **how many consultations a resident can reach per year**, from
 * the doctors of the surrounding communes too, weighted by each doctor's real
 * activity, by travel time, and by the age structure of the local population.
 * A commune with no doctor is not automatically a desert — its neighbour's may
 * be twelve minutes away — and the APL is what says so.
 *
 * Three of its columns are the same indicator recomputed while retiring every
 * doctor over 65, 62 and 60. That is the closest thing anyone publishes to
 * "what happens here in five years", and it is kept for that reason.
 *
 * The millésime is picked from the workbook rather than named: the DREES adds a
 * tab each July and drops the oldest, so a literal `APL 2024` is a build that
 * breaks silently next summer.
 */
async function fetchApl(args) {
  const dataset = await fetchJson(DATAGOUV_APL);
  const candidates = dataset.resources.filter(
    (resource) => /médecins? généralistes/i.test(resource.title ?? '')
      && /spreadsheetml|xlsx/i.test(resource.format ?? ''),
  );
  if (!candidates.length) throw new Error(`no APL général-practice spreadsheet in ${DATAGOUV_APL}`);
  candidates.sort((a, b) => String(b.last_modified).localeCompare(String(a.last_modified)));
  const resource = candidates[0];
  const stamp = String(resource.last_modified).slice(0, 10);

  const file = await cachedDownload(resource.url, `apl-medecins-generalistes-${stamp}.xlsx`, args);
  const buffer = await fsp.readFile(file);

  const years = listXlsxSheets(buffer)
    .map((name) => ({ name, year: Number.parseInt(/^APL\s+(\d{4})$/.exec(name)?.[1] ?? '', 10) }))
    .filter((sheet) => Number.isFinite(sheet.year))
    .sort((a, b) => a.year - b.year);
  if (!years.length) throw new Error('APL workbook has no "APL <year>" sheet');
  const newest = years.at(-1);

  const rows = readXlsxSheet(buffer, newest.name);
  const headerIndex = rows.findIndex((row) => row[0] === 'Code commune INSEE');
  if (headerIndex < 0) throw new Error(`APL sheet ${newest.name}: no "Code commune INSEE" header`);
  const header = rows[headerIndex];
  const column = (needle) => {
    const index = header.findIndex((cell) => cell.trim().toLowerCase().startsWith(needle));
    if (index < 0) throw new Error(`APL sheet ${newest.name}: no column starting "${needle}"`);
    return index;
  };
  // Matched on a prefix, because the published headers carry a trailing space
  // and an inconsistent "de 65 ans ou moins " suffix.
  const columns = {
    apl: column('apl aux médecins généralistes'),
    apl65: column('apl aux médecins généralistes de 65'),
    apl62: column('apl aux médecins généralistes de 62'),
    apl60: column('apl aux médecins généralistes de 60'),
    population: column('population totale'),
    // Two populations, and they are not interchangeable. The Lisez-moi is
    // explicit: aggregate the INDICATOR weighted by the STANDARDISED
    // population, count population under a threshold with the TOTAL one.
    populationStandardisee: column('population standardisée'),
  };

  const communes = {};
  let skipped = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    const insee = (row[0] ?? '').trim();
    // The row under the header holds the units, and the sheet ends with notes.
    if (!/^(\d{5}|\d[AB]\d{3}|\d{2}[AB]\d{2})$/i.test(insee)) { skipped += 1; continue; }
    const round = (value, digits) => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? Math.round(parsed * 10 ** digits) / 10 ** digits : null;
    };
    communes[insee] = [
      round(row[columns.apl], 2),
      round(row[columns.apl65], 2),
      round(row[columns.apl62], 2),
      round(row[columns.apl60], 2),
      round(row[columns.population], 0),
      round(row[columns.populationStandardisee], 0),
    ];
  }

  return {
    millesime: newest.year,
    resource: { url: resource.url, title: resource.title, modified: resource.last_modified },
    licence: dataset.license,
    communes,
    skippedRows: skipped,
  };
}

/**
 * Roll the APL up to departments the only way that is not a lie: **weighted by
 * population**, never averaged over communes.
 *
 * A plain mean over communes gives every hamlet the weight of Marseille and
 * turns a department into whatever its emptiest villages say. The DREES's own
 * note says the same thing in its own words — an aggregate APL is a
 * population-weighted mean.
 */
function rollAplToDepartements(communes) {
  const totals = new Map();
  for (const [insee, values] of Object.entries(communes)) {
    const [apl, apl65, apl62, , population, standardisee] = values;
    if (apl === null || !standardisee) continue;
    const dep = /^9[78]/.test(insee) ? insee.slice(0, 3) : insee.slice(0, 2);
    const entry = totals.get(dep)
      ?? { apl: 0, apl65: 0, apl62: 0, standardisee: 0, population: 0, communes: 0 };
    entry.apl += apl * standardisee;
    entry.apl65 += (apl65 ?? apl) * standardisee;
    entry.apl62 += (apl62 ?? apl) * standardisee;
    entry.standardisee += standardisee;
    entry.population += population ?? 0;
    entry.communes += 1;
    totals.set(dep, entry);
  }
  const round = (value) => Math.round(value * 100) / 100;
  return Object.fromEntries(
    [...totals].sort().map(([dep, entry]) => [dep, [
      round(entry.apl / entry.standardisee),
      round(entry.apl65 / entry.standardisee),
      round(entry.apl62 / entry.standardisee),
      entry.population,
      entry.communes,
    ]]),
  );
}

/**
 * The ten population deciles of the headline indicator, and the national mean.
 *
 * WHY: "2,36 consultations par habitant" is not a sentence anyone can act on.
 * "Cette commune est dans le 3e dixième — les 30 % de France les moins bien
 * dotés" is. The deciles are what turn the DREES's unit into a position, and
 * a position is what a reader actually wants.
 *
 * Two rules from the Lisez-moi, both load-bearing and both easy to get wrong:
 * the MEAN is weighted by the STANDARDISED population, and the DECILES are cut
 * on the TOTAL one. Swapping them changes the answer.
 *
 * The headline column is `apl65` — general practitioners **aged 65 or under**.
 * That is not an editorial choice: it is the series the DREES itself
 * publishes and quotes ("3,3 consultations par an et par habitant en 2024"),
 * and reading the all-ages column instead answers 3,72 and disagrees with
 * every published figure. Reproduced exactly by this code across the three
 * millésimes in the workbook — mean, 1st decile, 10th decile, ratio.
 */
function aplDistribution(communes) {
  const rows = Object.values(communes)
    .filter((values) => values[1] !== null && values[4] && values[5])
    .map((values) => ({ apl65: values[1], population: values[4], standardisee: values[5] }));
  const standardisee = rows.reduce((total, row) => total + row.standardisee, 0);
  const national = rows.reduce((total, row) => total + row.apl65 * row.standardisee, 0) / standardisee;

  rows.sort((a, b) => a.apl65 - b.apl65);
  const population = rows.reduce((total, row) => total + row.population, 0);
  const deciles = [];
  const bounds = [];
  let cumulative = 0;
  let weighted = 0;
  let inBucket = 0;
  for (const row of rows) {
    weighted += row.apl65 * row.population;
    inBucket += row.population;
    cumulative += row.population;
    if (cumulative >= population * (deciles.length + 1) / 10 && deciles.length < 10) {
      deciles.push(Math.round(weighted / inBucket * 100) / 100);
      bounds.push(row.apl65);
      weighted = 0;
      inBucket = 0;
    }
  }
  return {
    national: Math.round(national * 100) / 100,
    // Mean APL of each tenth of the population, poorest-served first.
    dixiemes: deciles,
    // The APL value that closes each tenth — what a commune is compared against
    // to be placed in one.
    bornes: bounds,
    population,
  };
}


/**
 * Assign every doctor to ONE department, and roll the counts up there.
 *
 * WHY THIS IS NOT `count distinct names per department`: **7.9 % of doctors
 * hold a practice in more than one department** — 9 235 of 117 922, up to six
 * departments each. Counting distinct names inside each department and adding
 * the columns therefore counts 12 408 doctors twice or more, and lands at
 * 130 330 where the country holds 117 922. That is not a rounding error, it is
 * a choropleth that overstates every department at once and a national total
 * that does not close.
 *
 * The gap is measurable because the CNAM publishes its own departmental
 * headcount (`demographie-exercices-liberaux` on data.ameli.fr), and its
 * columns sum EXACTLY to its national figure — so it assigns each doctor to one
 * department too. Against that control, checked 2026-09-01:
 *
 *   distinct names per department, summed   130 330   +16.2 %   median +15.4 %
 *   assigned to the principal department    117 922    +5.1 %   median  +2.1 %
 *
 * The rule: the department holding the MOST of that doctor's entries; ties go
 * to the lowest department code, so a rebuild never reshuffles the map. There
 * is nothing better available — the register publishes no principal-practice
 * flag, no identifier, and no way to tell a main surgery from a Thursday
 * afternoon in the next valley.
 */
function rollDoctorsToDepartements(placed) {
  const departementsByDoctor = new Map();
  const sitesByDepartement = new Map();
  const entriesByDepartement = new Map();

  for (const site of placed) {
    const dep = departementOf(site.position.insee) || site.departement;
    sitesByDepartement.set(dep, (sitesByDepartement.get(dep) ?? 0) + 1);
    let entries = 0;
    for (const [, count] of site.specialites) entries += count;
    entriesByDepartement.set(dep, (entriesByDepartement.get(dep) ?? 0) + entries);
    for (const [name] of site.praticiens) {
      let counts = departementsByDoctor.get(name);
      if (!counts) { counts = new Map(); departementsByDoctor.set(name, counts); }
      counts.set(dep, (counts.get(dep) ?? 0) + 1);
    }
  }

  const doctorsByDepartement = new Map();
  let multiDepartement = 0;
  let duplicatedByNaiveSum = 0;
  for (const counts of departementsByDoctor.values()) {
    if (counts.size > 1) { multiDepartement += 1; duplicatedByNaiveSum += counts.size - 1; }
    let best = null;
    for (const dep of [...counts.keys()].sort()) {
      if (best === null || counts.get(dep) > counts.get(best)) best = dep;
    }
    doctorsByDepartement.set(best, (doctorsByDepartement.get(best) ?? 0) + 1);
  }

  const departements = Object.fromEntries(
    [...new Set([...sitesByDepartement.keys(), ...doctorsByDepartement.keys()])].sort().map((dep) => [dep, [
      doctorsByDepartement.get(dep) ?? 0,
      sitesByDepartement.get(dep) ?? 0,
      entriesByDepartement.get(dep) ?? 0,
    ]]),
  );
  return {
    departements,
    medecins: departementsByDoctor.size,
    multiDepartement,
    duplicatedByNaiveSum,
  };
}


/**
 * The CNAM's specialty vocabulary is not this register's vocabulary.
 *
 * `demographie-exercices-liberaux` publishes 38 profession labels; the register
 * publishes 48 specialties. Where the two disagree it is almost always because
 * the demography groups what the directory splits — its single `Chirurgiens`
 * covers ten surgical specialties, and its `Stomatologues` covers the
 * maxillo-facial labels too. Mapping those two wrongly is what produced a
 * −66.7 % and a +12.8 % on the first run of this check; mapped as below they
 * are +4.9 % and +6.0 %, in line with everything else.
 */
const CNAM_SPECIALTY_CONTROL = Object.freeze([
  ['Ensemble des médecins généralistes', ['Médecin généraliste']],
  ['Psychiatres', ['Psychiatre', 'Neuropsychiatre']],
  ['Radiologues', ['Radiologue']],
  ['Cardiologues', ['Cardiologue']],
  ['Gynécologues médicaux et obstétriciens', ['Gynécologue / Obstétricien']],
  ['Ophtalmologues', ['Ophtalmologiste']],
  ['Anesthésistes-réanimateurs', ['Anesthésiste réanimateur']],
  ['Pédiatres', ['Pédiatre']],
  ['Dermatologues', ['Dermatologue et vénérologue']],
  ['Hépato-gastro-entérologues', ['Gastro-entérologue et hépatologue']],
  ['Oto-rhino-laryngologistes', ['Oto-Rhino-Laryngologue (ORL) et chirurgien cervico-facial']],
  ['Rhumatologues', ['Rhumatologue']],
  ['Pneumologues', ['Pneumologue']],
  ['Neurologues', ['Neurologue']],
  ['Médecins vasculaires', ['Médecine vasculaire']],
  ['Endocrinologues', ['Endocrinologue-diabétologue']],
  ['Médecins pathologistes', ['Anatomo-Cyto-Pathologiste']],
  ['Néphrologues', ['Néphrologue']],
  ['Radiothérapeutes', ['Cancérologue radiothérapeute', 'Radiothérapeute']],
  ['Médecins nucléaires', ['Médecin spécialiste en médecine nucléaire']],
  ['Allergologues', ['Spécialiste en allergologie']],
  ['Stomatologues', ['Stomatologiste', 'Chirurgien maxillo-facial et stomatologiste', 'Chirurgien maxillo-facial']],
  ['Chirurgiens', [
    'Chirurgien orthopédiste et traumatologue', 'Chirurgien urologue', 'Chirurgien plasticien',
    'Chirurgien général', 'Chirurgien viscéral', 'Chirurgien vasculaire', 'Neurochirurgien',
    'Chirurgien thoracique et cardio-vasculaire', 'Chirurgien infantile', 'Chirurgien oral',
  ]],
]);

async function ameliRecords(query) {
  const response = await fetch(`${AMELI_DEMOGRAPHY}?${query}`, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`data.ameli.fr → HTTP ${response.status}`);
  const body = await response.json();
  if (!body.results) throw new Error(`data.ameli.fr: ${body.message ?? 'no results'}`);
  return body.results;
}

/**
 * Check this build against the CNAM's own count of the same population.
 *
 * Not run by default: it reaches a third service, and a data build that fails
 * because someone else's API is down is a bad build. `--verifier` is the point
 * where you ask for it — before shipping a rebuild, or when a number looks off.
 *
 * What "agreement" means here: this register is a DIRECTORY and the control is
 * an ACTIVITY count taken two years earlier, so a few percent above is the
 * expected answer, not a defect. What would be a defect is a department far off
 * the rest — that is a geocoding failure, and it is what this exists to catch.
 */
async function verifyAgainstCnam(rollup, namesBySpecialty, specialtyLabels) {
  const scope = 'region%3D%2299%22%20and%20departement%3D%22999%22';
  // The newest millésime FIRST: every other query has to be constrained to it,
  // because an unfiltered `sum(effectif)` adds fifteen years of the same
  // doctors together and answers 2.5 million.
  const years = await ameliRecords('group_by=annee&select=annee&order_by=annee%20desc&limit=1');
  const millesime = String(years[0]?.annee ?? '').slice(0, 4);
  if (!/^\d{4}$/.test(millesime)) throw new Error(`data.ameli.fr returned no usable year: ${years[0]?.annee}`);
  // NO region filter here. `region=99` IS the national aggregate and it only
  // ever carries `departement=999`, so asking for both at once returns the
  // empty set — silently, and the check then reports zero departments as if
  // everything agreed.
  process.stderr.write(`\nCONTRÔLE — CNAM, effectif libéral ${millesime} (data.ameli.fr)\n`);

  const nationalNewest = await ameliRecords(
    `where=${scope}%20and%20annee%3Ddate%27${millesime}-01-01%27&group_by=profession_sante&select=profession_sante,sum(effectif)%20as%20n&limit=60&order_by=n%20desc`,
  );
  const control = new Map(nationalNewest.map((row) => [row.profession_sante, row.n]));
  const nameCount = (labels) => {
    const union = new Set();
    for (const label of labels) for (const name of namesBySpecialty.get(label) ?? []) union.add(name);
    return union.size;
  };

  process.stderr.write(`  ${'profession (vocabulaire CNAM)'.padEnd(42)}${'CNAM'.padStart(8)}${'nous'.padStart(8)}${'écart'.padStart(9)}\n`);
  for (const [profession, labels] of CNAM_SPECIALTY_CONTROL) {
    const expected = control.get(profession);
    if (expected === undefined) { process.stderr.write(`  ${profession} — absent du contrôle\n`); continue; }
    const found = nameCount(labels);
    process.stderr.write(`  ${profession.slice(0, 41).padEnd(42)}${String(expected).padStart(8)}${String(found).padStart(8)}${`${((found / expected - 1) * 100).toFixed(1)} %`.padStart(9)}\n`);
  }
  const ensemble = control.get('Ensemble des médecins');
  if (ensemble) {
    process.stderr.write(
      `  ${'ENSEMBLE DES MÉDECINS'.padEnd(42)}${String(ensemble).padStart(8)}${String(rollup.medecins).padStart(8)}`
      + `${`${((rollup.medecins / ensemble - 1) * 100).toFixed(1)} %`.padStart(9)}\n`,
    );
  }

  const byDepartement = await ameliRecords(
    `where=annee%3Ddate%27${millesime}-01-01%27%20and%20profession_sante%3D%22Ensemble%20des%20m%C3%A9decins%22`
    + '%20and%20departement%20!%3D%20%22999%22&group_by=departement&select=departement,sum(effectif)%20as%20n&limit=200',
  );
  const expectedByDep = new Map();
  for (const row of byDepartement) {
    const code = String(row.departement).trim();
    const dep = code.length === 3 ? code : code.padStart(2, '0');
    expectedByDep.set(dep, (expectedByDep.get(dep) ?? 0) + row.n);
  }
  const gaps = [];
  for (const [dep, expected] of expectedByDep) {
    if (!expected) continue;
    const found = rollup.departements[dep]?.[0] ?? 0;
    gaps.push({ dep, expected, found, gap: (found / expected - 1) * 100 });
  }
  gaps.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  const median = [...gaps].sort((a, b) => a.gap - b.gap)[Math.floor(gaps.length / 2)]?.gap ?? 0;
  process.stderr.write(
    `\n  ${gaps.length} départements — écart médian ${median.toFixed(1)} %, `
    + `${gaps.filter((row) => row.gap >= -10 && row.gap <= 15).length} dans [-10 %, +15 %]\n`,
  );
  process.stderr.write('  les 6 plus forts :\n');
  for (const row of gaps.slice(0, 6)) {
    process.stderr.write(`    ${row.dep.padStart(3)}  CNAM ${String(row.expected).padStart(6)}   nous ${String(row.found).padStart(6)}   ${row.gap.toFixed(1)} %\n`);
  }
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, report: false, refresh: false, cds: true, apl: true, praticiens: false, verifier: false, plain: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--report') args.report = true;
    else if (arg === '--refresh') args.refresh = true;
    else if (arg === '--no-cds') args.cds = false;
    else if (arg === '--no-apl') args.apl = false;
    else if (arg === '--verifier') args.verifier = true;
    else if (arg === '--plain') args.plain = true;
    else if (arg === '--praticiens') args.praticiens = true;
    else if (arg.startsWith('--out=')) args.out = path.resolve(arg.slice('--out='.length));
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.json();
}

/**
 * Resolve the CURRENT resource URLs from the dataset API, never a dated URL.
 *
 * data.gouv.fr mints a new path on every weekly republication
 * (`…/20260817-004705/liste-ps-20260817-023126.csv`), so a hard-coded link
 * would keep working while quietly serving last quarter's register — the exact
 * failure mode this whole script exists to escape.
 */
async function resolveAmeliResources() {
  const dataset = await fetchJson(DATAGOUV_DATASET);
  const pick = (needle) => {
    const found = dataset.resources.filter(
      (resource) => resource.format === 'csv' && resource.url.includes(needle),
    );
    if (!found.length) throw new Error(`no CSV resource matching "${needle}" in ${DATAGOUV_DATASET}`);
    // Newest first — the dataset keeps prior editions alongside the current one.
    found.sort((a, b) => String(b.last_modified).localeCompare(String(a.last_modified)));
    return found[0];
  };
  const ps = pick('liste-ps');
  const cds = pick('liste-cds');
  return {
    licence: dataset.license,
    ps: { url: ps.url, modified: ps.last_modified, bytes: ps.filesize },
    cds: { url: cds.url, modified: cds.last_modified, bytes: cds.filesize },
  };
}

async function cachedDownload(url, name, { refresh }) {
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, name);
  if (!refresh) {
    const stat = await fsp.stat(file).catch(() => null);
    if (stat?.size > 0) {
      process.stderr.write(`  ${name} — cache (${(stat.size / 1e6).toFixed(1)} MB)\n`);
      return file;
    }
  }
  process.stderr.write(`  ${name} — téléchargement…`);
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(file, body);
  process.stderr.write(` ${(body.length / 1e6).toFixed(1)} MB\n`);
  return file;
}

/**
 * Minimal RFC-4180 reader for the two shapes this build meets: the register's
 * `;`-delimited quoted CSV, and BAN's `,`-delimited answer. Quotes only ever
 * appear around whole fields in both, but `""` escapes are handled because a
 * practice named `SELARL "LES TILLEULS"` would otherwise shift every column
 * after it silently.
 */
function parseCsv(text, delimiter) {
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') { field += char; continue; }
      if (text[i + 1] === '"') { field += '"'; i += 1; continue; }
      quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === delimiter) { row.push(field); field = ''; continue; }
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (char === '\r') continue;
    field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function readRegister(file, delimiter = ';') {
  // The register ships a UTF-8 BOM; left in place it becomes part of the first
  // header name and `ps_activite_nom` is never found again.
  const text = (await fsp.readFile(file, 'utf8')).replace(/^﻿/, '');
  const rows = parseCsv(text, delimiter);
  const header = rows.shift();
  return rows
    .filter((cells) => cells.length === header.length)
    .map((cells) => Object.fromEntries(header.map((key, index) => [key, cells[index]])));
}

/** `01000` → `01`, `97400` → `974`, `98000` → `980`. */
function departementOf(code) {
  const trimmed = String(code ?? '').trim();
  if (!trimmed) return '';
  return /^9[78]/.test(trimmed) ? trimmed.slice(0, 3) : trimmed.slice(0, 2);
}

/**
 * Departments the guard must treat as the same place, because La Poste and
 * INSEE disagree about them.
 *
 * **Saint-Martin (977) and Saint-Barthélemy (978) left Guadeloupe in 2007 and
 * kept their `971xx` postcodes.** So the register files a Marigot surgery under
 * postcode 97150 — department `971` — while BAN answers with citycode `97801`,
 * department `978`, and a naive guard throws away a correct answer.
 *
 * Measured, and smaller than it looks: **1 address recovered**. The 61 sites
 * that sit on the two islands nearly all come through pass 1, where the guard
 * does not run at all because the postcode filter already constrains the
 * answer. The map earns its place as a correctness fix, not as recall — and
 * the 7 island addresses still unplaced are unplaced because BAN has no match
 * for `CENTRE D AFFAIRE LLOBREGAT`, not because of any department check.
 */
const DEPARTEMENT_EQUIVALENTS = Object.freeze(new Map([
  ['971', new Set(['971', '977', '978'])],
  ['977', new Set(['971', '977'])],
  ['978', new Set(['971', '978'])],
]));

function sameDepartement(expected, found) {
  if (expected === found) return true;
  return DEPARTEMENT_EQUIVALENTS.get(expected)?.has(found) ?? false;
}

/**
 * Are BAN's place and the register's the same place, said differently?
 *
 * The register writes `PARIS`, BAN writes `Paris`; the register writes
 * `ST MARTIN`, BAN writes `Saint-Martin`. Comparing the two literally reports
 * a disagreement on 100 % of sites, which would make the "what the register
 * published" field pure noise instead of the 6 % that actually matters —
 * CEDEX identities, merged communes, and arrondissements.
 */
function sameLocality(a, b) {
  const fold = (value) => String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\bSAINTE?\b/g, 'ST')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  return fold(a) === fold(b);
}

function addressKey(voie, cp, ville) {
  // NUL, written as an escape and never as a literal byte: a printable
  // separator can collide (voie `A B` + cp `C` keys the same as voie `A` +
  // cp `B C`), and a literal NUL in the source makes every ripgrep-class
  // tool treat this file as binary and skip it.
  return [voie, cp, ville].join('\u0000');
}

function toCsv(rows) {
  const escape = (value) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `${rows.map((row) => row.map(escape).join(',')).join('\n')}\n`;
}

/**
 * One BAN batch. `columns` are the address columns to concatenate; `postcode`
 * names a column to FILTER on, which is what makes pass 1 strict and what
 * passes 2 and 3 deliberately give up.
 */
async function banGeocode(rows, { columns, postcode = null, label }) {
  const csv = toCsv(rows);
  // Rebuilt per attempt: a FormData body is a stream, and `fetch` consumes it,
  // so a retry that reuses one sends an empty request and gets HTTP 400 —
  // which reads exactly like a malformed file and is not.
  const makeBody = () => {
    const body = new FormData();
    body.append('data', new Blob([csv], { type: 'text/csv' }), 'a.csv');
    for (const column of columns) body.append('columns', column);
    if (postcode) body.append('postcode', postcode);
    return body;
  };

  let lastError = null;
  for (let attempt = 1; attempt <= BAN_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(BAN_CSV, { method: 'POST', body: makeBody(), headers: { 'user-agent': USER_AGENT } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const parsed = parseCsv(text, ',');
      const header = parsed.shift();
      return parsed
        .filter((cells) => cells.length === header.length)
        .map((cells) => Object.fromEntries(header.map((key, index) => [key, cells[index]])));
    } catch (error) {
      lastError = error;
      process.stderr.write(`    ${label} — ${error.message}, tentative ${attempt}/${BAN_ATTEMPTS}\n`);
      await new Promise((resolve) => { setTimeout(resolve, 5000 * attempt); });
    }
  }
  throw new Error(`BAN ${label}: ${lastError?.message ?? 'échec'}`);
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Accept a BAN answer only if it landed in the department the register named.
 *
 * Passes 2 and 3 match on text with no postcode filter, so `SAINT-MARTIN`
 * resolves to whichever of the several it likes. Without this guard the recall
 * those passes buy is paid for in silently relocated practices.
 */
function acceptResult(result, expectedDepartement, { requireDepartement }) {
  const lat = Number.parseFloat(result.latitude);
  const lon = Number.parseFloat(result.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const precision = PRECISION_BY_BAN_TYPE[result.result_type];
  if (!precision) return null;
  if (requireDepartement && !sameDepartement(expectedDepartement, departementOf(result.result_citycode))) return null;
  return {
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    precision,
    score: Math.round(Number.parseFloat(result.result_score) * 1000) / 1000,
    insee: result.result_citycode || '',
    label: result.result_label || '',
    // BAN's normalised place, kept BESIDE the register's own spelling rather
    // than replacing it. The register writes CEDEX identities where a postcode
    // belongs — `75651 PARIS CEDEX 13` — and a card that prints that is
    // printing a mail-sorting code at someone looking for a surgery. BAN
    // answers `75013 Paris 13e Arrondissement` for the same door.
    ville: result.result_city || '',
    cp: result.result_postcode || '',
  };
}

async function geocodeSites(sites, { refresh }) {
  const byId = new Map(sites.map((site) => [site.id, site]));
  await fsp.mkdir(path.join(CACHE_DIR, 'ban'), { recursive: true });

  const runPass = async (pending, { name, build, header, columns, postcode, requireDepartement }) => {
    const placed = [];
    const batches = chunk(pending, BAN_CHUNK_ROWS);
    for (const [index, batch] of batches.entries()) {
      const cacheFile = path.join(CACHE_DIR, 'ban', `${name}-${String(index).padStart(2, '0')}.json`);
      let results = null;
      if (!refresh) results = await fsp.readFile(cacheFile, 'utf8').then(JSON.parse).catch(() => null);
      if (!results) {
        const rows = [header, ...batch.map((site) => build(site))];
        results = await banGeocode(rows, { columns, postcode, label: `${name}#${index}` });
        await fsp.writeFile(cacheFile, JSON.stringify(results), 'utf8');
      }
      for (const result of results) {
        const site = byId.get(result.id);
        if (!site || site.position) continue;
        const accepted = acceptResult(result, site.departement, { requireDepartement });
        if (accepted) { site.position = { ...accepted, pass: name }; placed.push(site); }
      }
      process.stderr.write(
        `    ${name} ${index + 1}/${batches.length} — ${placed.length} placées\n`,
      );
    }
    return placed.length;
  };

  // Pass 1 — strict: street + town as the query, the register's own postcode as
  // a FILTER. The postcode column is in the file but deliberately not in
  // `columns`: BAN would otherwise search for the digits as part of the address
  // text as well as constrain on them.
  const pass1 = await runPass(sites, {
    name: 'p1',
    header: ['id', 'voie', 'ville', 'code_postal', 'dep'],
    columns: ['voie', 'ville'],
    postcode: 'code_postal',
    requireDepartement: false,
    build: (site) => [site.id, site.voie, site.ville, site.cp, site.departement],
  });

  // Pass 2 — the CEDEX rescue. `57085 METZ CEDEX 03` is a mail-sorting code,
  // not a postcode, so the filter is dropped and the department guard replaces it.
  const stillMissing = () => sites.filter((site) => !site.position);
  const pass2 = await runPass(stillMissing(), {
    name: 'p2',
    header: ['id', 'voie', 'ville', 'dep'],
    columns: ['voie', 'ville'],
    postcode: null,
    requireDepartement: true,
    build: (site) => [
      site.id,
      site.voie.replace(/\s*-?\s*(CS|BP|TSA)\s*\d+.*$/i, '').trim(),
      site.ville.replace(/\s*CEDEX\s*\d*\s*$/i, '').trim(),
      site.departement,
    ],
  });

  // Pass 3 — the town centre, and it is labelled as the town centre.
  const pass3 = await runPass(stillMissing(), {
    name: 'p3',
    header: ['id', 'ville', 'dep'],
    columns: ['ville'],
    postcode: null,
    requireDepartement: true,
    build: (site) => [site.id, site.ville.replace(/\s*CEDEX\s*\d*\s*$/i, '').trim(), site.departement],
  });

  return { pass1, pass2, pass3, unplaced: stillMissing().length };
}

/**
 * Fold a commune name to something two spellings of the same place share.
 * `SAINT-MARTIN`, `St Martin` and `Saint Martin` all become `ST MARTIN`.
 */
function foldCommune(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\bSAINTE?\b/g, 'ST')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * The official commune list, indexed by code and by (department, folded name).
 *
 * WHY IT IS NEEDED — the failure it exists to catch: BAN's `postcode` filter is
 * a HARD filter, and the register's postcode is not always the register's
 * commune's postcode. Row `1100 RUE DE GENEVE / 01220 / DAGNEUX` names Dagneux,
 * whose postcode is 01120; 01220 belongs to Divonne-les-Bains. Pass 1 honours
 * the postcode, finds a Rue de Genève in Divonne, and places that doctor
 * **99 km from where they practise** — with a `numero` precision and a
 * confident score, because as far as BAN was concerned nothing went wrong.
 *
 * Measured before the repair below: **205 sites in a commune other than the one
 * the register names, 49 of them beyond 15 km**, worst at 99 km. 0.076 % of the
 * file, and exactly the kind of error that a percentage makes sound harmless.
 */
async function fetchCommuneIndex(args) {
  const file = await cachedDownload(GEO_API_COMMUNES, 'communes-geo-api.json', args);
  const communes = JSON.parse(await fsp.readFile(file, 'utf8'));
  const byCode = new Map();
  const byDepName = new Map();
  for (const commune of communes) {
    const centre = commune.centre?.coordinates;
    if (!centre) continue;
    const entry = { code: commune.code, nom: commune.nom, lat: centre[1], lon: centre[0] };
    byCode.set(commune.code, entry);
    const key = `${departementOf(commune.code)}|${foldCommune(commune.nom)}`;
    const bucket = byDepName.get(key);
    if (bucket) bucket.push(entry);
    else byDepName.set(key, [entry]);
  }
  return { byCode, byDepName, size: communes.length };
}

/** Great-circle kilometres. */
function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Beyond this, a placement is in the wrong place rather than the wrong spelling. */
const MISPLACED_KM = 15;

/**
 * Repair the sites BAN placed in a commune the register did not name.
 *
 * Two steps, and the order matters. First ASK AGAIN without the postcode
 * filter, matching on `voie` + the register's own commune — that recovers the
 * real door whenever the street exists there. Only what still cannot be found
 * is demoted to the commune centre, at `commune` precision, so the card says
 * "centre de la commune" instead of showing a house number that is a fiction.
 *
 * Never silently: `stats.reparations` publishes both counts.
 */
async function repairMisplaced(placed, communeIndex, { refresh }) {
  const suspects = [];
  for (const site of placed) {
    const expected = communeIndex.byDepName.get(`${site.departement}|${foldCommune(site.ville)}`);
    if (!expected?.length) continue;
    if (expected.some((commune) => commune.code === site.position.insee)) continue;
    const target = expected[0];
    const km = haversineKm(site.position.lat, site.position.lon, target.lat, target.lon);
    if (km <= MISPLACED_KM) continue;
    suspects.push({ site, target, km });
  }
  if (!suspects.length) return { suspects: 0, regeocoded: 0, demoted: 0 };

  await fsp.mkdir(path.join(CACHE_DIR, 'ban'), { recursive: true });
  const cacheFile = path.join(CACHE_DIR, 'ban', 'repair-00.json');
  let results = null;
  if (!refresh) results = await fsp.readFile(cacheFile, 'utf8').then(JSON.parse).catch(() => null);
  if (!results) {
    const rows = [
      ['id', 'voie', 'ville', 'dep'],
      ...suspects.map(({ site }) => [site.id, site.voie, site.ville, site.departement]),
    ];
    results = await banGeocode(rows, { columns: ['voie', 'ville'], postcode: null, label: 'repair' });
    await fsp.writeFile(cacheFile, JSON.stringify(results), 'utf8');
  }

  const byId = new Map(suspects.map((entry) => [entry.site.id, entry]));
  let regeocoded = 0;
  for (const result of results) {
    const entry = byId.get(result.id);
    if (!entry) continue;
    const accepted = acceptResult(result, entry.site.departement, { requireDepartement: true });
    // Accept ONLY if it landed in the commune the register named. A second
    // wrong answer is not better than the first.
    if (!accepted || accepted.insee !== entry.target.code) continue;
    entry.site.position = { ...accepted, pass: 'repair' };
    entry.repaired = true;
    regeocoded += 1;
  }

  let demoted = 0;
  for (const entry of suspects) {
    if (entry.repaired) continue;
    entry.site.position = {
      lat: Math.round(entry.target.lat * 1e5) / 1e5,
      lon: Math.round(entry.target.lon * 1e5) / 1e5,
      precision: 'commune',
      score: 0,
      insee: entry.target.code,
      label: entry.target.nom,
      ville: entry.target.nom,
      cp: entry.site.cp,
      pass: 'commune-registre',
    };
    demoted += 1;
  }
  return { suspects: suspects.length, regeocoded, demoted };
}

function printReport(sites, specialtyLabels) {
  const precision = new Map();
  const departement = new Map();
  const specialty = new Map();
  let medecins = 0;
  for (const site of sites) {
    const key = site.position?.precision ?? '(non localisée)';
    precision.set(key, (precision.get(key) ?? 0) + 1);
    departement.set(site.departement, (departement.get(site.departement) ?? 0) + 1);
    for (const [code, count] of site.specialites) {
      specialty.set(code, (specialty.get(code) ?? 0) + count);
      medecins += count;
    }
  }
  const line = (label, value, total) => `  ${label.padEnd(48)} ${String(value).padStart(7)}  ${(value / total * 100).toFixed(1)} %`;
  process.stderr.write('\nPRÉCISION DE LA POSITION\n');
  for (const [key, value] of [...precision].sort((a, b) => b[1] - a[1])) {
    process.stderr.write(`${line(key, value, sites.length)}\n`);
  }
  process.stderr.write('\nSPÉCIALITÉS (entrées praticien-adresse)\n');
  for (const [code, value] of [...specialty].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    process.stderr.write(`${line(specialtyLabels[code] ?? code, value, medecins)}\n`);
  }
  process.stderr.write('\nDÉPARTEMENTS LES PLUS DENSES (adresses)\n');
  for (const [code, value] of [...departement].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    process.stderr.write(`${line(code, value, sites.length)}\n`);
  }
}

async function main() {
  const args = parseArgs(process.argv);

  process.stderr.write('Annuaire santé Ameli — résolution des ressources\n');
  const resources = await resolveAmeliResources();
  process.stderr.write(`  PS  ${resources.ps.modified?.slice(0, 10)} (${(resources.ps.bytes / 1e6).toFixed(0)} MB)\n`);
  process.stderr.write(`  CDS ${resources.cds.modified?.slice(0, 10)} (${(resources.cds.bytes / 1e6).toFixed(1)} MB)\n`);

  const psFile = await cachedDownload(resources.ps.url, `liste-ps-${resources.ps.modified?.slice(0, 10)}.csv`, args);
  const psRows = await readRegister(psFile);
  const medecinCodes = medecinSpecialtyCodes(psRows);

  const rawSpecialtyLabels = {};
  for (const row of psRows) {
    if (row.type_ps_code === '1') rawSpecialtyLabels[row.specialite_code] = row.specialite_libelle;
  }
  const { canonicalByCode, alias, labels: specialtyLabels } = canonicalSpecialties(rawSpecialtyLabels);

  /** @type {Map<string, any>} */
  const sitesByAddress = new Map();
  const praticiens = [];
  let doctorRows = 0;

  const addRow = ({ voie, cp, ville, code: rawCode, kind, name, civilite, secteur, optam, tel, raison }) => {
    const code = canonicalByCode[rawCode] ?? rawCode;
    const key = addressKey(voie, cp, ville);
    let site = sitesByAddress.get(key);
    if (!site) {
      site = {
        id: String(sitesByAddress.size),
        voie,
        cp,
        ville,
        departement: departementOf(cp),
        kinds: new Set(),
        specialites: new Map(),
        people: new Set(),
        praticiens: [],
        tel: tel || '',
        position: null,
      };
      sitesByAddress.set(key, site);
    }
    site.kinds.add(kind);
    site.specialites.set(code, (site.specialites.get(code) ?? 0) + 1);
    if (name) {
      site.people.add(name);
      // Codes, not labels: the labels live once at the top of the document, and
      // repeating `Chirurgien orthopédiste et traumatologue` 6 738 times would
      // cost more than the whole APL table.
      site.praticiens.push([name, civilite || '', code, secteur || '', optam || '']);
    }
    if (!site.tel && tel) site.tel = tel;
    if (args.praticiens) {
      praticiens.push([
        site.id, name, specialtyLabels[code] ?? code,
        SECTEUR_LABELS[secteur] ?? '', OPTION_TARIFAIRE_LABELS[optam] ?? '', raison, kind,
      ]);
    }
    doctorRows += 1;
  };

  for (const row of psRows) {
    if (row.type_ps_code !== '1') continue;
    const cp = row.coordonnees_code_postal.trim();
    if (!cp) continue; // 8 rows in 555 249 — no postcode is no department is no map.
    addRow({
      voie: row.coordonnees_voie.trim(),
      cp,
      ville: row.coordonnees_ville.trim(),
      code: row.specialite_code,
      kind: 'liberal',
      name: `${row.ps_activite_nom} ${row.ps_activite_prenom}`.trim(),
      civilite: row.ps_activite_civilite,
      secteur: row.secteur_conventionnel_code,
      optam: row.option_tarifaire_code,
      tel: row.coordonnees_num_tel.trim(),
      raison: row.ps_activite_raison_sociale,
    });
  }

  let cdsRows = 0;
  if (args.cds) {
    const cdsFile = await cachedDownload(resources.cds.url, `liste-cds-${resources.cds.modified?.slice(0, 10)}.csv`, args);
    for (const row of await readRegister(cdsFile)) {
      if (!medecinCodes.has(row.specialite_code)) continue;
      const cp = row.coordonnees_code_postal.trim();
      if (!cp) continue;
      addRow({
        voie: row.coordonnees_voie.trim(),
        cp,
        ville: row.coordonnees_ville.trim(),
        code: row.specialite_code,
        kind: 'centre-de-sante',
        name: '',
        civilite: '',
        secteur: '',
        optam: '',
        tel: row.coordonnees_num_tel.trim(),
        raison: row.etab_raison_sociale,
      });
      cdsRows += 1;
    }
  }

  const sites = [...sitesByAddress.values()];
  process.stderr.write(
    `\n${doctorRows} lignes médecin (dont ${cdsRows} en centre de santé) → ${sites.length} adresses distinctes\n`,
  );

  process.stderr.write('\nGéocodage BAN\n');
  const passes = await geocodeSites(sites, args);
  const placed = sites.filter((site) => site.position);
  process.stderr.write(
    `\n  passe 1 ${passes.pass1} · passe 2 ${passes.pass2} · passe 3 ${passes.pass3} · non localisées ${passes.unplaced}\n`,
  );

  process.stderr.write('\nContrôle des placements contre la liste officielle des communes\n');
  const communeIndex = await fetchCommuneIndex(args);
  const repairs = await repairMisplaced(placed, communeIndex, args);
  process.stderr.write(
    `  ${communeIndex.size} communes — ${repairs.suspects} sites hors de leur commune de plus de `
    + `${MISPLACED_KM} km : ${repairs.regeocoded} replacés à l'adresse, ${repairs.demoted} ramenés au centre de la commune\n`,
  );

  const rollup = rollDoctorsToDepartements(placed);

  /** label → the distinct names practising it, for the CNAM cross-check. */
  const namesBySpecialty = new Map();
  for (const site of placed) {
    for (const [name, , code] of site.praticiens) {
      const label = specialtyLabels[code] ?? code;
      if (!namesBySpecialty.has(label)) namesBySpecialty.set(label, new Set());
      namesBySpecialty.get(label).add(name);
    }
  }
  if (args.verifier) await verifyAgainstCnam(rollup, namesBySpecialty, specialtyLabels);

  let apl = null;
  if (args.apl) {
    process.stderr.write('\nAPL — DREES, accessibilité potentielle localisée\n');
    apl = await fetchApl(args);
    const withApl = placed.filter((site) => apl.communes[site.position.insee]).length;
    apl.departements = rollAplToDepartements(apl.communes);
    Object.assign(apl, aplDistribution(apl.communes));
    // The DREES's own words for what the number is and where it stops.
    apl.indicateur = 'APL aux médecins généralistes de 65 ans ou moins';
    apl.unite = 'consultations, visites et téléconsultations accessibles par habitant standardisé et par an';
    apl.champ = 'France hors Mayotte';
    // Une commune est sous-dotée si son APL est ≤ 2,5 ; moyennement dotée
    // jusqu'à 4 ; bien dotée au-delà. Ces bornes servent les zonages ARS.
    apl.seuils = { sousDotee: 2.5, bienDotee: 4 };
    apl.jointure = {
      communesPubliees: Object.keys(apl.communes).length,
      sitesAvecApl: withApl,
      sitesSansApl: placed.length - withApl,
      departements: Object.keys(apl.departements).length,
    };
    process.stderr.write(
      `  millésime ${apl.millesime} — ${apl.jointure.communesPubliees} communes, `
      + `${withApl} sites appariés sur ${placed.length} `
      + `(${(withApl / placed.length * 100).toFixed(1)} %)\n`,
    );
    process.stderr.write(
      `  ${apl.indicateur} — national ${apl.national.toFixed(2)}, `
      + `1er dixième ${apl.dixiemes[0].toFixed(2)}, 10e ${apl.dixiemes[9].toFixed(2)} `
      + `(rapport ${(apl.dixiemes[9] / apl.dixiemes[0]).toFixed(2)})\n`,
    );
  }

  if (args.report) printReport(sites, specialtyLabels);

  const document = {
    generated: new Date().toISOString().slice(0, 10),
    source: {
      dataset: 'annuaire-sante-ameli',
      publisher: "Caisse nationale de l'Assurance Maladie",
      licence: resources.licence,
      ps: { url: resources.ps.url, modified: resources.ps.modified },
      cds: args.cds ? { url: resources.cds.url, modified: resources.cds.modified } : null,
    },
    sources: [
      'CNAM — Annuaire santé Ameli, liste des professionnels de santé (Licence Ouverte 2.0)',
      'CNAM — Annuaire santé Ameli, liste des centres de santé (Licence Ouverte 2.0)',
      'BAN — Base Adresse Nationale, api-adresse.data.gouv.fr (Licence Ouverte 2.0)',
      ...(apl ? [`DREES — Accessibilité potentielle localisée (APL) ${apl.millesime} aux médecins généralistes (Licence Ouverte 2.0)`] : []),
    ],
    // The register has no identifier, so this is a count of tuples and the name
    // of the field says which tuple. See the header.
    stats: {
      lignesMedecin: doctorRows,
      lignesCentreDeSante: cdsRows,
      adresses: sites.length,
      adressesLocalisees: placed.length,
      praticiensAdresseDistincts: sites.reduce((total, site) => total + site.people.size, 0),
      // Distinct NAMES across the whole country, on placed addresses. Not the
      // same as the tuple count above, and much closer to a headcount — see
      // `rollDoctorsToDepartements` for what it can and cannot be compared to.
      medecinsNommes: rollup.medecins,
      medecinsMultiDepartement: rollup.multiDepartement,
      surcompteSommeDepartementale: rollup.duplicatedByNaiveSum,
      passes,
      // What the commune-list control caught, and what it did about it. See
      // `repairMisplaced` — the worst case it fixes is 99 km.
      reparations: repairs,
      precision: Object.fromEntries(
        PRECISION.map((key) => [key, placed.filter((site) => site.position.precision === key).length]),
      ),
    },
    precision: PRECISION,
    specialites: specialtyLabels,
    secteurs: SECTEUR_LABELS,
    optionsTarifaires: OPTION_TARIFAIRE_LABELS,
    // The register's own codes, and which canonical code each was folded into.
    // Published so the fold is reversible — see `canonicalSpecialties`.
    specialitesAlias: alias,
    /**
     * One tuple per address:
     *   [lat, lon, precisionIndex, insee, cp, ville, voie, tel, kinds,
     *    [[specialiteCode, nEntrees], …], nPraticiensDistincts, adresseRegistre]
     *
     * `cp` and `ville` are BAN's, not the register's — see `acceptResult`.
     * `adresseRegistre` carries the register's own spelling when the two
     * disagree, and is an empty string when they do not.
     */
    sites: placed.map((site) => [
      site.position.lat,
      site.position.lon,
      PRECISION.indexOf(site.position.precision),
      site.position.insee,
      site.position.cp || site.cp,
      site.position.ville || site.ville,
      site.voie,
      site.tel,
      [...site.kinds].sort().join('+'),
      [...site.specialites].sort((a, b) => b[1] - a[1]),
      site.people.size,
      // The register's own spelling, and only when BAN disagrees — 6 % of
      // sites. Kept because it is what the doctor published, and a reader
      // matching this map against an Ameli page needs to see the same words.
      (site.position.cp && site.position.cp !== site.cp)
        || (site.position.ville && !sameLocality(site.position.ville, site.ville))
        ? `${site.cp} ${site.ville}`
        : '',
    ]),
    /**
     * The DREES indicator, keyed by INSEE commune:
     *   [apl, apl65, apl62, apl60, populationTotale, populationStandardisée]
     *
     * `apl65` — general practitioners aged 65 or under — is the HEADLINE, and
     * `national` / `dixiemes` are computed on it, because that is the series
     * the DREES publishes and every article quotes. The other three columns
     * are the same indicator recomputed while retiring everyone over 65, 62
     * and 60: read across them and you get what this place looks like as its
     * doctors age out. Nationally in 2024 that reads 3.72 → 3.27 → 2.91 →
     * 2.70, which is −22 % by the time the over-62s have gone.
     *
     * `departements[dep]` = `[apl, apl65, apl62, population, communes]`,
     * weighted by the STANDARDISED population as the DREES prescribes.
     * `null` when built with `--no-apl`.
     */
    apl,
    /**
     * Per department: `[medecins, adresses, entrees]`.
     *
     * `medecins` assigns each doctor to ONE department, so the column SUMS to
     * `stats.medecinsNommes`. Never recompute it as "distinct names seen in
     * this department" — that double-counts 7.9 % of the profession. See
     * `rollDoctorsToDepartements`.
     */
    departements: rollup.departements,
    // Named, not dropped: an address BAN could not place, or placed in the
    // wrong department, is still a place where doctors practise.
    nonLocalisees: sites
      .filter((site) => !site.position)
      .map((site) => [site.cp, site.ville, site.voie, [...site.specialites].reduce((n, [, c]) => n + c, 0)]),
  };

  await fsp.mkdir(path.dirname(args.out), { recursive: true });
  /**
   * Both outputs ship GZIPPED, and that is a size decision with a measured
   * price. Plain they are 8.93 MB + 7.25 MB = **16.18 MB in the repository**,
   * larger than every other file in it put together; gzipped they are 3.67 MB,
   * **4.4× less**. What that costs at runtime is **15 ms of `gunzipSync` at
   * the proxy's first request**, once per process — against 12.5 MB on every
   * clone, every CI checkout and every container image.
   *
   * `--plain` writes them uncompressed for anyone who wants to grep the
   * dataset; the proxy reads whichever of the two it finds.
   */
  const write = async (file, text) => {
    if (args.plain) {
      await fsp.rm(`${file}.gz`, { force: true });
      await fsp.writeFile(file, text, 'utf8');
      return (await fsp.stat(file)).size;
    }
    await fsp.rm(file, { force: true });
    await fsp.writeFile(`${file}.gz`, zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 }));
    return (await fsp.stat(`${file}.gz`)).size;
  };

  const bytes = await write(args.out, `${JSON.stringify(document)}\n`);

  /**
   * The named practitioners, in a SECOND file, one line per site.
   *
   * Line N describes `sites[N]` — same order, no key to join on, nothing to
   * index. That is the point: the map file stays the size of a map, and the
   * card file can later be served by byte offset without re-encoding anything.
   * Inlining the names into `medecins.json` was measured first and costs 4.9 MB
   * on a 7.3 MB file, all of it downloaded to draw dots that never show a name.
   *
   * Each entry is `[nom, civilité, specialiteCode, secteurCode, optionCode]`.
   * A centre de santé publishes no practitioner names, so its line is `[]` —
   * and that is not the same statement as "no doctors here", which is why the
   * site's own `[[specialite, n]]` tally counts those rows and this file does
   * not.
   */
  const praticiensPath = path.join(path.dirname(args.out), 'praticiens.jsonl');
  const praticiensBytes = await write(
    praticiensPath,
    `${placed.map((site) => JSON.stringify(site.praticiens)).join('\n')}\n`,
  );
  process.stderr.write(
    `${path.relative(ROOT, praticiensPath)}${args.plain ? '' : '.gz'} — `
    + `${placed.reduce((n, site) => n + site.praticiens.length, 0)} praticiens nommés sur ${placed.length} lignes, `
    + `${(praticiensBytes / 1024 / 1024).toFixed(1)} MB\n`,
  );

  if (args.praticiens) {
    const file = path.join(CACHE_DIR, 'praticiens.csv');
    await fsp.writeFile(
      file,
      toCsv([['site_id', 'nom', 'specialite', 'secteur', 'option_tarifaire', 'raison_sociale', 'type'], ...praticiens]),
      'utf8',
    );
    process.stderr.write(`${path.relative(ROOT, file)} — ${praticiens.length} lignes praticien\n`);
  }

  process.stderr.write(
    `\n${path.relative(ROOT, args.out)}${args.plain ? '' : '.gz'} — ${placed.length} adresses localisées `
    + `sur ${sites.length} (${(placed.length / sites.length * 100).toFixed(1)} %), `
    + `${doctorRows} entrées médecin, ${(bytes / 1024 / 1024).toFixed(1)} MB\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`\n✖ ${error.message}\n`);
  process.exitCode = 1;
});
