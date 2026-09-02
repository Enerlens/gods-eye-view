/**
 * @module sitadelFeed
 *
 * Sitadel — every building permit France has granted since 2013, and the
 * arithmetic that decides which of them is allowed to have a position.
 *
 * The Cesium drawing lives in `sitadelFrance.js`. Everything here is pure and
 * node-testable, and it is where the one hard problem of this layer is held
 * down: **the file has no coordinates at all.**
 *
 * ── What this layer is, against the one it sits next to ─────────────────────
 *
 * `dvf-sales` draws completed transactions — what changed hands, for how much,
 * with a latitude and a longitude already in the file. This draws
 * AUTHORISATIONS. It is the only forward-looking dataset on this globe:
 * everything else describes what exists, and Sitadel describes what somebody
 * has been given permission to build and has not necessarily built. On the same
 * parcel the two compose — "this plot sold in 2023, and a permit for 40
 * dwellings was granted on it in 2025" — which is exactly why the position has
 * to be the PARCEL and not the commune.
 *
 * ── The decisive fact: 94 columns and not one of them is a coordinate ───────
 *
 * Measured 2026-09-01 against the live DiDo metadata for datafile
 * `8b35affb-55fc-4c1f-915b-7750f974446a`: 1 917 260 rows, 94 columns,
 * `geoFields: ["REG","DEP"]` — the portal itself claims no finer geography than
 * the département. The demolition file `1a9a2f0c-…` says the same over its
 * 202 895 rows and 33 columns. Across all four Sitadel files there are
 * 3 020 749 permits and zero positions.
 *
 * What the file DOES carry is up to three cadastral parcel references per
 * permit — and this repo already draws cadastral parcels. So every point on
 * this layer is something we COMPUTED, and the whole design is about being
 * able to say, per permit, whether that computation is allowed to produce a
 * position at all.
 *
 * ── The placement rule, and the four answers it gives ───────────────────────
 *
 * A permit is placed on a parcel only when one of its references resolves to
 * EXACTLY ONE parcel in its commune. There are four outcomes; all four are
 * counted, only the first is drawn, and the other three are on the row:
 *
 *   placed      — one parcel. Drawn.
 *   ambiguous   — the reference matches SEVERAL parcels of the same commune.
 *                 Never placed. See "the préfixe trap" below.
 *   missing     — the reference matches nothing: the parcel was divided or
 *                 renumbered after the permit was filed.
 *   noref       — the file publishes no cadastral reference at all.
 *
 * Measured over 22 474 permits in eleven communes on 2026-09-01, against the
 * Etalab cadastre edition 2026-06-01: **11 902 placed (53.0%)**, 7 065
 * ambiguous (31.4%), 3 338 missing (14.9%), 169 with no reference (0.8%).
 *
 * That 53.0% is the honest number and it is worth one comparison. DREAL
 * Auvergne-Rhône-Alpes published the same join officially: 362 038 permits,
 * 162 171 with a geometry — 44.8%, and only their `precision: "parcelle"` rows
 * ever carry a point.
 *
 * ── The préfixe trap, which is the one nobody had measured ──────────────────
 *
 * Sitadel publishes `SEC_CADASTRE1` (2 characters) and `NUM_CADASTRE1`. The
 * cadastre's key has a THIRD component — the `préfixe`, three digits — and
 * Sitadel has no column for it. In most of France that is harmless because the
 * préfixe is `000` everywhere in the commune. Where a commune absorbed others,
 * it is not.
 *
 * Toulouse publishes 46 préfixes (801–846) and **70 815 of its 91 938 parcels
 * share their (section, numéro) with at least one other parcel of the same
 * commune**. A join that ignores the préfixe "places" 97.7% of Toulouse's
 * permits and nearly all of them on the wrong parcel. Resolved honestly, only
 * **9.5% of Toulouse's 3 846 permits land on a single parcel** and 88.2% are
 * ambiguous. All sixteen Marseille arrondissements have the same defect.
 *
 * How common: over the 1 923 communes of seven départements (13, 14, 31, 44,
 * 49, 69, 75), **129 — 6.7% — publish a section code under more than one
 * préfixe**, so a Sitadel reference there is ambiguous by construction. It is
 * 23.3% in Maine-et-Loire, which is full of communes nouvelles, and 0.0% in
 * Paris.
 *
 * ── The arrondissement, solved from the file itself ─────────────────────────
 *
 * `COMM` is 75056 on all 3 595 Paris permits, while the cadastre is keyed by
 * arrondissement (75101–75120). The recon proposed deriving the arrondissement
 * from the postal code. There is something better, and the publisher's own
 * variable dictionary says so: NUM_DAU is "un numéro sur 13 caractères : les 6
 * premiers caractères correspondent au code commune". Measured: **all 3 595
 * Paris permits carry 075101–075120 in those six characters**, and all 1 773
 * Lyon permits carry 069381–069389 — 100% filled against 98.4% for the address.
 * Paris then joins at **93.0%** and Lyon at **81.3%**.
 *
 * Marseille is the exception that proves it: all 4 842 of its permits carry
 * `013055`, the aggregate commune, so the registration number says nothing.
 * The postal code is the only fallback there (99.7% filled) and it lands at
 * 20.6% placed — because Marseille also has the préfixe defect.
 *
 * ── The join is CHECKED, not assumed ────────────────────────────────────────
 *
 * `SUPERFICIE_TERRAIN` is the surface the applicant declared for the plot, and
 * it is filled on 95.4% of rows. It is not used to place anything; it is used
 * to audit the placement. Over 5 929 placed permits in Nantes, Paris and
 * Bordeaux the median ratio of the drawn parcel's area to the declared terrain
 * is **1.00**, and **96.0% agree within a factor of two** (Paris: p10 1.00,
 * p90 1.00). That is independent evidence that the parcel we drew is the parcel
 * the permit was granted for, and every card carries its own copy of it.
 *
 * ── The age curve, and why it is a fact about building and not about data ───
 *
 * Over the eight sampled communes with no préfixe defect (13 538 permits,
 * 77.0% placed), the placement rate by year of authorisation runs 2013 66.4%,
 * 2015 72.6%, 2018 73.0%, 2021 79.6%, 2023 86.2%, 2025 89.6%, **2026 95.4%**.
 * Dividing a plot is what happens when somebody builds on it, so the dataset
 * systematically loses the permits that changed the ground the most.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
 */

import { pointInPolygons, polygonsBounds } from './ringGeometry.js';

// --- Upstream ---------------------------------------------------------------

/** SDES's DiDo API root. Keyless, `access-control-allow-origin: *`. */
export const SITADEL_DIDO_BASE = 'https://data.statistiques.developpement-durable.gouv.fr/dido/api/v1';

/** The DiDo dataset that lists the four Sitadel datafiles and their rids. */
export const SITADEL_DIDO_DATASET = '6513f0189d7d312c80ec5b5b';
/** The data.gouv.fr landing page, for the credit line. */
export const SITADEL_DATASET_PAGE = 'https://www.data.gouv.fr/fr/datasets/689c42fa521ccf80ce954f83/';

/**
 * The two datafiles this layer reads, and the titles the discovery matches on.
 *
 * The rid is PINNED and also DISCOVERED. Pinned because it is what every number
 * in this header was measured against; discovered because SDES republishes
 * monthly and a rid that changed would otherwise turn the layer off silently.
 * A discovery that returns nothing falls back to the pin — never the reverse.
 */
export const SITADEL_HOUSING_RID = '8b35affb-55fc-4c1f-915b-7750f974446a';
export const SITADEL_DEMOLITION_RID = '1a9a2f0c-56fe-4e69-84a7-fbbda2121f02';
export const SITADEL_HOUSING_TITLE = 'créant des logements';
export const SITADEL_DEMOLITION_TITLE = 'permis de démolir';

/**
 * Newest DiDo edition accepted, and the one every number here was measured on.
 *
 * `millesime` is a `YYYY-MM` string on the datafile metadata. Floored rather
 * than pinned for the usual reason: a discovery OLDER than what this file was
 * written against is a malformed answer, not a new fact.
 */
export const SITADEL_MILLESIME_FLOOR = '2026-08';

/**
 * Columns asked for on the housing file. 23 of its 94, and every one is read.
 *
 * Projection is not an optimisation here, it is the difference between a
 * browser payload and a download: measured 2026-09-01 on Nantes, the same
 * 2 049 rows cost 1 120 835 bytes with these 23 columns against 1 012 340 bytes
 * for nine columns and several megabytes unprojected.
 *
 * `DESTINATION_PRINCIPALE` is deliberately NOT here. It is `1` (habitation) on
 * all 2 049 Nantes rows, because this is the housing file — the column exists
 * to separate this file from its non-residential sibling and says nothing
 * inside it.
 */
export const SITADEL_HOUSING_COLUMNS = Object.freeze([
  'COMM',
  'NUM_DAU',
  'TYPE_DAU',
  'ETAT_DAU',
  'DATE_REELLE_AUTORISATION',
  'DATE_REELLE_DOC',
  'DATE_REELLE_DAACT',
  'SEC_CADASTRE1',
  'NUM_CADASTRE1',
  'SEC_CADASTRE2',
  'NUM_CADASTRE2',
  'SEC_CADASTRE3',
  'NUM_CADASTRE3',
  'SUPERFICIE_TERRAIN',
  'NATURE_PROJET_COMPLETEE',
  'NB_LGT_TOT_CREES',
  'NB_LGT_DEMOLIS',
  'SURF_HAB_CREEE',
  'SURF_HAB_DEMOLIE',
  'DENOM_DEM',
  'ADR_NUM_TER',
  'ADR_LIBVOIE_TER',
  'ADR_CODPOST_TER',
]);

/**
 * Columns asked for on the demolition file. 15 of its 33.
 *
 * `NUM_PD`/`ETAT_PD` replace `NUM_DAU`/`ETAT_DAU`, and there is no
 * `DATE_REELLE_DOC` or `DATE_REELLE_DAACT` at all — a demolition is authorised
 * and the file never says when it happened.
 */
export const SITADEL_DEMOLITION_COLUMNS = Object.freeze([
  'COMM',
  'NUM_PD',
  'ETAT_PD',
  'DATE_REELLE_AUTORISATION',
  'SEC_CADASTRE1',
  'NUM_CADASTRE1',
  'SEC_CADASTRE2',
  'NUM_CADASTRE2',
  'SEC_CADASTRE3',
  'NUM_CADASTRE3',
  'SUPERFICIE_TERRAIN',
  'DENOM_DEM',
  'ADR_NUM_TER',
  'ADR_LIBVOIE_TER',
  'ADR_CODPOST_TER',
]);

/** Etalab's cadastre mirror. Build-time only — see the proxy header. */
export const CADASTRE_ETALAB_BASE = 'https://cadastre.data.gouv.fr/data/etalab-cadastre';

/**
 * Oldest Etalab cadastre edition accepted, and the one the join was measured
 * against.
 *
 * The edition is discovered, not pinned: `latest` is a symlink and the 302 it
 * answers with names the real directory
 * (`.../etalab-cadastre/2026-06-01/geojson/...`), which is both free and
 * exact. Floored for the same reason as the millésime.
 */
export const CADASTRE_EDITION_FLOOR = '2026-06-01';

/** Etalab's own reverse commune lookup. Keyless and CORS-open. */
export const GEO_API_COMMUNES = 'https://geo.api.gouv.fr/communes';

export const SITADEL_SOURCE = 'Sitadel — permis de construire et de démolir, SDES/CGDD'
  + ' · parcelles cadastrales Etalab (DGFiP)';
export const SITADEL_LICENCE = 'Licence Ouverte (Etalab)';

// --- The three communes that are not one commune ----------------------------

/**
 * The arrondissement codes of Paris, Lyon and Marseille.
 *
 * A closed list and not a formula, exactly as `cadastreFeed.js` keeps its
 * `ARRONDISSEMENT_BASES`: no other commune in France splits its cadastre this
 * way, and an unknown one is answered with "join in COMM" rather than with an
 * expansion derived from a pattern that was only ever true for three cities.
 *
 * Sitadel's `COMM` is the aggregate code (75056 / 69123 / 13055) on every row,
 * and Etalab publishes no cadastre under any of the three. Without this
 * expansion those 10 210 permits — Paris 3 595, Marseille 4 842, Lyon 1 773 —
 * would every one of them be `missing`.
 */
export const ARRONDISSEMENT_COMMUNES = Object.freeze({
  75056: Object.freeze(Array.from({ length: 20 }, (_, i) => `751${String(i + 1).padStart(2, '0')}`)),
  69123: Object.freeze(Array.from({ length: 9 }, (_, i) => `6938${i + 1}`)),
  13055: Object.freeze(Array.from({ length: 16 }, (_, i) => `132${String(i + 1).padStart(2, '0')}`)),
});

// --- Published vocabularies -------------------------------------------------

/**
 * The colour ladder: three states of a project, plus cancelled, plus
 * demolition.
 *
 * The first four are `ETAT_DAU`, and the labels are the publisher's own, taken
 * verbatim from the variable dictionary shipped beside the file
 * (`dictionnaire_variables logements_permis_construire.xls`): `2 = Autorisé`,
 * `4 = Annulé`, `5 = Commencé`, `6 = Terminé`. The same sheet carries the
 * sentence that stops `2` from being read as "authorised and not started":
 * *"Toutes les DAU du fichier ont été autorisées ; les modalités 4 à 6
 * concernent des DAU pour lesquelles est connu l'état postérieur d'avancement
 * du projet."* A `2` is a permit about which nothing further has been
 * reported, which is a weaker statement than "nothing has happened".
 *
 * The field is exactly consistent with the three dates, checked over 22 474
 * rows: all 5 241 `Commencé` rows carry a DATE_REELLE_DOC and none a DAACT;
 * all 7 969 `Terminé` rows carry a DAACT; no `Autorisé` row carries either.
 * 103 of the `Terminé` rows carry no start date, which the card names rather
 * than silently completing.
 *
 * The fifth band is not a state, it is a FILE — the permis de démolir. It gets
 * a band of its own instead of being coloured by its own `ETAT_PD` because
 * that field is empty of information there: 1 497 of Nantes' 1 587 demolition
 * permits (94.3%) and 1 582 of Paris' 1 609 (98.3%) sit at `Autorisé`. Four
 * colours spent on a distinction the file does not make would be four colours
 * wasted; one colour spent on "this is authorised to come down" is the whole
 * point of reading that file.
 *
 * The hues avoid the two layers this one is stacked on. `cadastre-fr` runs
 * cyan → green → yellow → orange and `dvf-sales` runs orange → yellow → green
 * → teal; neither uses violet, indigo or deep red. The single overlap is the
 * amber of an open site, which is the most legible reading of "work in
 * progress" and is worth the collision.
 */
export const SITADEL_BANDS = Object.freeze([
  Object.freeze({
    id: 'autorise',
    state: 2,
    label: 'Autorisé',
    color: '#b197fc',
    blurb: 'Autorisé, et rien de plus n’est remonté au SDES — ni ouverture de chantier ni achèvement. Pâle : il n’y a peut-être encore rien sur le terrain.',
  }),
  Object.freeze({
    id: 'commence',
    state: 5,
    label: 'Chantier ouvert',
    color: '#f59f00',
    blurb: 'Déclaration d’ouverture de chantier (DOC) déposée, achèvement non déclaré. Les travaux ont commencé.',
  }),
  Object.freeze({
    id: 'termine',
    state: 6,
    label: 'Travaux achevés',
    color: '#4c6ef5',
    blurb: 'Déclaration attestant l’achèvement (DAACT) déposée. Le bâti devrait exister — la BD TOPO doit être d’accord.',
  }),
  Object.freeze({
    id: 'annule',
    state: 4,
    label: 'Annulé',
    color: '#6c757d',
    blurb: 'Autorisation annulée après coup. Le permis a existé, le projet non.',
  }),
  Object.freeze({
    id: 'demolition',
    state: null,
    label: 'Permis de démolir',
    color: '#c92a2a',
    blurb: 'Fichier des permis de démolir (depuis 1996). Une seule bande : 94,3 % des démolitions de Nantes et 98,3 % de celles de Paris restent à « Autorisé », l’état d’avancement n’y dit rien.',
  }),
]);

/** Band ids in legend order. */
export const SITADEL_BAND_IDS = Object.freeze(SITADEL_BANDS.map((band) => band.id));

/** `ETAT_DAU` / `ETAT_PD` → band id, for the construction files. */
const STATE_TO_BAND = Object.freeze(Object.fromEntries(
  SITADEL_BANDS.filter((band) => band.state !== null).map((band) => [band.state, band.id]),
));

/** Band lookup by id. */
const BAND_BY_ID = Object.freeze(Object.fromEntries(SITADEL_BANDS.map((band) => [band.id, band])));

/**
 * `NATURE_PROJET_COMPLETEE`, verbatim from the publisher's dictionary.
 *
 * Six modalities, and the distinction that matters on a photorealistic globe is
 * the first one: `1 = nouvelle construction` means the parcel is expected to
 * change, everything else means an existing building is being worked on. A
 * reader looking at a roof needs to know which.
 */
export const SITADEL_NATURE_LABELS = Object.freeze({
  1: 'Nouvelle construction',
  2: 'Transformation sans changement de surface',
  3: 'Transformation avec extension',
  4: 'Transformation avec diminution de surface',
  5: 'Extension sans transformation',
  6: 'Diminution de surface sans transformation',
});

/** `TYPE_DAU`. `PA` and `PD` genuinely occur inside the housing file — 3 each over 22 474 rows. */
export const SITADEL_TYPE_LABELS = Object.freeze({
  PC: 'Permis de construire',
  DP: 'Déclaration préalable',
  PA: 'Permis d’aménager',
  PD: 'Permis de démolir',
});

/** How a permit ended up where it is — or why it is nowhere. Printed on the row. */
export const SITADEL_OUTCOMES = Object.freeze(['placed', 'ambiguous', 'missing', 'noref']);

export const SITADEL_OUTCOME_LABELS = Object.freeze({
  placed: 'Posé sur sa parcelle',
  ambiguous: 'Référence ambiguë — plusieurs parcelles portent ce numéro',
  missing: 'Parcelle absente du cadastre actuel — divisée ou renumérotée',
  noref: 'Aucune référence cadastrale publiée',
});

/**
 * Dwellings above which the dot stops growing.
 *
 * 200, measured: over 22 474 permits the 99th percentile is 190 dwellings and
 * the largest single permit creates 659. Without a ceiling that one permit
 * would be drawn three times the area of a 200-dwelling block, and 57.0% of
 * permits — the ones creating exactly one dwelling — would all be the same
 * invisible minimum.
 */
export const SITADEL_SIZE_CEILING_LGT = 200;

/**
 * Ratio band inside which the drawn parcel and the declared terrain are called
 * an agreement.
 *
 * A factor of two, which is deliberately loose, because the two numbers are not
 * the same measurement: `SUPERFICIE_TERRAIN` is the whole plot the applicant
 * declared and a permit may name only some of its parcels. At this width
 * 96.0% of 5 929 placed permits agree and the median ratio is 1.00; tightening
 * it would start reporting multi-parcel projects as join failures.
 */
export const SITADEL_AREA_AGREEMENT = 2;

/** Coordinate precision shipped to the browser. 6 decimals ≈ 0.11 m. */
export const SITADEL_COORDINATE_DECIMALS = 6;

const EARTH_RADIUS_M = 6378137;

// --- Small readers ----------------------------------------------------------

/**
 * The exact five-code-point group the double-encoding produces.
 *
 * Written with `\u` escapes on purpose: three of the five characters are
 * invisible in an editor, and a regex literal that a copy-paste can silently
 * mangle is a regex that stops matching without ever failing.
 */
const SITADEL_MOJIBAKE_GROUP = /A\u00C3\u0082\u00C2([\u0080-\u00BF])/g;

/**
 * The double-encoding in the free-text columns, and its repair.
 *
 * Measured 2026-09-01 over 78 349 text values in thirteen commune queries:
 * **177 carry the signature** (0.226%), and the shape is always the same
 * five-code-point group `A` U+00C3 U+0082 U+00C2 U+00xx standing in for one
 * Latin-1 letter whose code point is that tail plus `0x40`. Measured tails:
 * `\u0089` inside `GALIL_E` yields `GALILÉ`... i.e. `GALILEE` accented,
 * `\u0088` yields `GUIBLINIERE` accented, and `\u0082` yields `BATONNIER`
 * accented. All three were read out of the live Nantes answer.
 *
 * The repair is deliberately narrow: it fires only on that exact group and only
 * when the result lands in the Latin-1 letter range, so a genuinely clean
 * string is untouched (`Île-de-France` and `RÉSIDENCE` both survive verbatim,
 * which the naive `latin-1 → utf-8` round trip does not manage). All 177
 * values repaired, 187 characters, and exactly one keeps a residue — a Maine-
 * et-Loire commune whose apostrophe was mangled a second time inside the same
 * word. That one is left as published rather than guessed at.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function repairSitadelText(value) {
  return String(value ?? '').replace(SITADEL_MOJIBAKE_GROUP, (whole, tail) => {
    const code = tail.codePointAt(0) + 0x40;
    if (code < 0x00C0 || code > 0x00FF || code === 0x00D7 || code === 0x00F7) return whole;
    return String.fromCodePoint(code);
  });
}

/** Trimmed, mojibake-repaired string, or null. */
export function sitadelText(value) {
  if (value === null || value === undefined) return null;
  const text = repairSitadelText(value).trim();
  return text ? text : null;
}

/**
 * @returns {?number} `value` as a finite number, or null.
 *
 * The null/blank guard is load-bearing and not defensive padding: `Number(null)`
 * is `0` and `Number('')` is `0`, so the obvious one-liner turns an unpublished
 * `SUPERFICIE_TERRAIN` into a permit that DECLARES zero square metres — and the
 * agreement check above would then read a real parcel as a join failure.
 */
export function finiteOrNull(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Round to the shipped coordinate precision. */
function round6(value) {
  const scale = 10 ** SITADEL_COORDINATE_DECIMALS;
  return Math.round(value * scale) / scale;
}

// --- The key ----------------------------------------------------------------

/**
 * The cadastral key, from a commune code and a Sitadel reference.
 *
 * Three normalisations, each of which was measured to matter:
 *
 * • **The section is padded to two and upper-cased.** Sitadel publishes `"A"`
 *   where the cadastre publishes `"0A"`, and Marseille publishes a lowercase
 *   `"t"`. Upper-casing alone moved Bordeaux from 1 417 placed permits to
 *   1 432.
 * • **The numéro is padded to four.** Sitadel publishes `"99"`; the national
 *   identifier is `44109000WZ0099`. Measured on Nantes, joining without the
 *   pad collapses the placement rate from 67.0% to 0.3% — and it fails
 *   SILENTLY, which is why this is a function with a test and not three
 *   template literals.
 * • **The préfixe is NOT in the key**, because Sitadel has no column for it.
 *   That absence is what `indexCadastreParcels` turns into an explicit
 *   ambiguity rather than a wrong answer.
 *
 * @param {string} insee Commune the join is performed in.
 * @param {unknown} section
 * @param {unknown} numero
 * @returns {?string} null when either part is missing.
 */
export function sitadelParcelKey(insee, section, numero) {
  const commune = String(insee ?? '').trim();
  const sec = String(section ?? '').trim().toUpperCase();
  const num = String(numero ?? '').trim();
  if (!commune || !sec || !num) return null;
  return `${commune}${sec.padStart(2, '0')}${num.padStart(4, '0')}`;
}

/**
 * The commune code buried in a permit's registration number, or null.
 *
 * The publisher's dictionary: *"Numéro sur 13 caractères : les 6 premiers
 * caractères correspondent au code commune, les 2 suivants à l'année de dépôt
 * de la DAU, les 5 derniers à un numéro d'ordre."* Six characters, so a
 * five-digit INSEE code arrives zero-padded — `044109`, `075105`.
 *
 * The same dictionary flags the caveat this function cannot fix: the code is
 * the commune's *at the time the permit was filed* and *"il n'est pas
 * recodifié dans un millésime particulier du COG"*. For a commune that has
 * since merged, the registration number names a commune that no longer exists,
 * so {@link sitadelJoinCommune} only trusts it when it names a commune we hold
 * a cadastre for.
 *
 * @param {object} row
 * @returns {?string}
 */
export function sitadelRegistrationCommune(row) {
  const registration = String(row?.NUM_DAU ?? row?.NUM_PD ?? '').trim();
  if (registration.length !== 13) return null;
  const head = registration.slice(0, 6);
  if (!/^\d{6}$/.test(head)) return null;
  const code = String(Number(head));
  return code.length === 5 ? code : null;
}

/**
 * The arrondissement a postal code names inside one of the three cities.
 *
 * Only ever consulted for Paris, Lyon and Marseille, and only when the
 * registration number did not already answer. Paris' 16th has two postal codes
 * (75016 and 75116) and both resolve to 75116, which is why this compares the
 * last two digits rather than the whole code.
 *
 * @param {unknown} postal
 * @param {ReadonlyArray<string>} codes The city's arrondissement codes.
 * @returns {?string}
 */
export function sitadelPostalArrondissement(postal, codes) {
  const value = String(postal ?? '').trim();
  if (!/^\d{5}$/.test(value) || !Array.isArray(codes) || !codes.length) return null;
  const ordinal = Number(value.slice(3));
  if (!(ordinal > 0)) return null;
  return codes.find((code) => Number(code.slice(3)) === ordinal) || null;
}

/**
 * The commune this permit's cadastral reference should be looked up in.
 *
 * Three steps, in order of how much the file itself vouches for the answer:
 * the registration number (published, 13 characters, 100% filled), then the
 * postal code (98.4% in Paris, 99.7% in Marseille), then `COMM`.
 *
 * @param {object} row
 * @param {?ReadonlyArray<string>} arrondissements Codes we hold a cadastre for,
 *   or null for an ordinary commune.
 * @returns {?string}
 */
export function sitadelJoinCommune(row, arrondissements = null) {
  const codes = Array.isArray(arrondissements) && arrondissements.length ? arrondissements : null;
  const registration = sitadelRegistrationCommune(row);
  if (registration && (!codes || codes.includes(registration))) return registration;
  if (codes) {
    const postal = sitadelPostalArrondissement(row?.ADR_CODPOST_TER, codes);
    if (postal) return postal;
    // The registration number named the aggregate commune and the address
    // named nothing: there is no arrondissement to look this up in, and
    // guessing one of sixteen is how a permit ends up on the wrong side of a
    // city. Answered with the aggregate code, which matches no parcel and is
    // therefore counted as `missing` rather than drawn somewhere plausible.
    return String(row?.COMM ?? '').trim() || null;
  }
  return String(row?.COMM ?? '').trim() || null;
}

/**
 * The Etalab commune files a Sitadel `COMM` has to be joined against.
 *
 * One file for almost every commune in France, twenty for Paris, sixteen for
 * Marseille, nine for Lyon. Measured 2026-09-01: Nantes' single file is
 * 5 176 390 bytes gzipped and holds 58 099 parcels; the twenty Paris files
 * together hold 78 154; Marseille's sixteen hold 126 311.
 *
 * @param {string} insee
 * @returns {Array<string>}
 */
export function communeCadastreCodes(insee) {
  const code = String(insee ?? '').trim();
  if (!code) return [];
  return [...(ARRONDISSEMENT_COMMUNES[code] || [code])];
}

/** @returns {boolean} Whether this commune is one of the three split cities. */
export function isArrondissementCommune(insee) {
  return Boolean(ARRONDISSEMENT_COMMUNES[String(insee ?? '').trim()]);
}

/** The DiDo URL the proxy fetches for one commune and one datafile. */
export function sitadelDatafileUrl(rid, insee, columns) {
  const params = new URLSearchParams({
    COMM: `eq:${String(insee)}`,
    columns: (Array.isArray(columns) ? columns : []).join(','),
  });
  return `${SITADEL_DIDO_BASE}/datafiles/${rid}/json?${params}`;
}

/** The DiDo metadata URL for one datafile — where `millesime` is published. */
export function sitadelDatafileMetaUrl(rid) {
  return `${SITADEL_DIDO_BASE}/datafiles/${rid}`;
}

/** Etalab's parcel file for one commune, at the `latest` alias. */
export function cadastreCommuneUrl(insee) {
  const code = String(insee).trim();
  return `${CADASTRE_ETALAB_BASE}/latest/geojson/communes/${code.slice(0, 2)}/${code}`
    + `/cadastre-${code}-parcelles.json.gz`;
}

/** The reverse commune lookup the proxy resolves a camera focus with. */
export function geoCommuneUrl(lat, lon) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    fields: 'nom,code,departement,region,population,contour',
    format: 'json',
  });
  return `${GEO_API_COMMUNES}?${params}`;
}

// --- Edition discovery ------------------------------------------------------

/**
 * Newest `millesime` among the datafiles read, refusing anything below the
 * floor.
 *
 * String compare and not a date parse: the column is a `YYYY-MM` TEXT field
 * upstream, and a value that is not one must not win by parsing to NaN.
 *
 * @param {Array<?string>} values
 * @param {string} [floor]
 * @returns {string}
 */
export function newestMillesime(values, floor = SITADEL_MILLESIME_FLOOR) {
  let best = String(floor);
  for (const value of Array.isArray(values) ? values : []) {
    const text = String(value ?? '').trim();
    if (/^\d{4}-\d{2}$/.test(text) && text > best) best = text;
  }
  return best;
}

/**
 * The Etalab edition named by a redirect from `latest`, floored.
 *
 * `https://cadastre.data.gouv.fr/.../latest/...` answers 302 with
 * `location: https://cadastre.s3.rbx.io.cloud.ovh.net:443/etalab-cadastre/2026-06-01/...`.
 * That is the cheapest possible discovery — it costs the request we were making
 * anyway — and it is exact, where scraping the directory index would not be.
 *
 * @param {?string} location
 * @param {string} [floor]
 * @returns {string}
 */
export function newestCadastreEdition(location, floor = CADASTRE_EDITION_FLOOR) {
  const match = /etalab-cadastre\/(\d{4}-\d{2}-\d{2})\//.exec(String(location ?? ''));
  if (!match) return String(floor);
  return match[1] > String(floor) ? match[1] : String(floor);
}

/**
 * The rid of one Sitadel datafile, from DiDo's own dataset listing.
 *
 * @param {Array<object>} datafiles
 * @param {string} titleFragment
 * @param {string} pinned Fallback — the rid this layer was measured against.
 * @returns {string}
 */
export function discoverSitadelRid(datafiles, titleFragment, pinned) {
  const needle = titleFragment.toLocaleLowerCase('fr');
  for (const file of Array.isArray(datafiles) ? datafiles : []) {
    const title = String(file?.title ?? '').toLocaleLowerCase('fr');
    const rid = String(file?.rid ?? '').trim();
    if (rid && title.includes(needle)) return rid;
  }
  return pinned;
}

// --- Geometry ---------------------------------------------------------------

/** GeoJSON geometry → `[[outerRing, ...holes], ...]`. */
export function parcelParts(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'MultiPolygon') return Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  if (geometry.type === 'Polygon') return Array.isArray(geometry.coordinates) ? [geometry.coordinates] : [];
  return [];
}

/**
 * Area of one closed ring in m², by shoelace on a local equirectangular
 * projection.
 *
 * `latRef` is passed in rather than derived per ring so a parcel's holes are
 * measured on the SAME projection as the ring they are subtracted from.
 * @param {Array<number[]>} ring
 * @param {number} latRef
 * @returns {number}
 */
export function ringAreaM2(ring, latRef) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  const k = Math.cos((latRef * Math.PI) / 180) * EARTH_RADIUS_M * (Math.PI / 180);
  const m = EARTH_RADIUS_M * (Math.PI / 180);
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[j];
    const b = ring[i];
    if (!Array.isArray(a) || !Array.isArray(b)) continue;
    sum += (a[0] * k) * (b[1] * m) - (b[0] * k) * (a[1] * m);
  }
  return Math.abs(sum) / 2;
}

/** Area of a whole parcel: every outer ring, minus every hole. */
export function parcelAreaM2(parts) {
  const polygons = Array.isArray(parts) ? parts : [];
  const first = polygons?.[0]?.[0]?.[0];
  const latRef = Array.isArray(first) ? (finiteOrNull(first[1]) ?? 0) : 0;
  let total = 0;
  let measured = false;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) continue;
    const outer = ringAreaM2(polygon[0], latRef);
    if (outer <= 0) continue;
    measured = true;
    total += outer;
    for (let h = 1; h < polygon.length; h += 1) total -= ringAreaM2(polygon[h], latRef);
  }
  return measured ? Math.max(0, total) : null;
}

/**
 * Area centroid of a parcel's LARGEST ring, as `[lon, lat]`.
 *
 * The largest and not the first: a multi-part parcel whose first part is a 6 m²
 * sliver would otherwise anchor its dot and its card on the sliver.
 * @param {Array<Array<Array<number[]>>>} parts
 * @returns {?number[]}
 */
export function parcelAnchor(parts) {
  const polygons = Array.isArray(parts) ? parts : [];
  const first = polygons?.[0]?.[0]?.[0];
  const latRef = Array.isArray(first) ? (finiteOrNull(first[1]) ?? 0) : 0;
  let best = null;
  let bestArea = -Infinity;
  for (const polygon of polygons) {
    const ring = Array.isArray(polygon) ? polygon[0] : null;
    if (!Array.isArray(ring) || ring.length < 3) continue;
    const area = ringAreaM2(ring, latRef);
    if (area > bestArea) { bestArea = area; best = ring; }
  }
  if (!best) return null;

  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = best.length - 1; i < best.length; j = i, i += 1) {
    const a = best[j];
    const b = best[i];
    if (!Array.isArray(a) || !Array.isArray(b)) continue;
    const cross = (a[0] * b[1]) - (b[0] * a[1]);
    twiceArea += cross;
    cx += (a[0] + b[0]) * cross;
    cy += (a[1] + b[1]) * cross;
  }
  // A degenerate ring divides by zero here. Fall back to the vertex average
  // rather than emitting a NaN that Cesium places at the centre of the Earth.
  if (twiceArea === 0) {
    let lon = 0;
    let lat = 0;
    for (const [x, y] of best) { lon += x; lat += y; }
    const anchor = [lon / best.length, lat / best.length];
    return anchor.every(Number.isFinite) ? anchor : null;
  }
  const anchor = [cx / (3 * twiceArea), cy / (3 * twiceArea)];
  return anchor.every(Number.isFinite) ? anchor : null;
}

/** Whether a point falls on a parcel — inside an outer ring, outside its holes. */
export function pointOnParcel(parts, lon, lat) {
  return pointInPolygons(parts, lon, lat);
}

/** Axis-aligned bounds of a shape's outer rings. */
export function partsBounds(parts) {
  return polygonsBounds(parts);
}

// --- The index --------------------------------------------------------------

/**
 * Index Etalab's parcel features by {@link sitadelParcelKey}, keeping EVERY
 * candidate.
 *
 * The array, not the last writer, is the whole point. Toulouse publishes 91 938
 * parcels under 21 123 distinct (section, numéro) pairs — one key carries 34
 * different parcels — and a `Map` that overwrote would answer every one of
 * those lookups with whichever parcel happened to be read last. That is a
 * layer that draws 97.7% of Toulouse's permits and is wrong about nearly all
 * of them.
 *
 * @param {Array<object>} featureCollections Raw Etalab FeatureCollections.
 * @returns {{index: Map<string, Array<object>>, parcels: number, ambiguousKeys: number}}
 */
export function indexCadastreParcels(featureCollections) {
  const index = new Map();
  let parcels = 0;
  for (const collection of Array.isArray(featureCollections) ? featureCollections : []) {
    for (const feature of collection?.features || []) {
      const props = feature?.properties;
      const key = sitadelParcelKey(props?.commune, props?.section, props?.numero);
      if (!key) continue;
      parcels += 1;
      const bucket = index.get(key);
      if (bucket) bucket.push(feature);
      else index.set(key, [feature]);
    }
  }
  let ambiguousKeys = 0;
  for (const bucket of index.values()) if (bucket.length > 1) ambiguousKeys += 1;
  return { index, parcels, ambiguousKeys };
}

// --- Projection -------------------------------------------------------------

/** Band id for one row of one file. */
export function sitadelBandId(row, file) {
  if (file === 'demolition') return 'demolition';
  const state = finiteOrNull(row?.ETAT_DAU ?? row?.ETAT_PD);
  return STATE_TO_BAND[state] || 'autorise';
}

/** The band record for one id. */
export function sitadelBand(id) {
  return BAND_BY_ID[id] || BAND_BY_ID.autorise;
}

/** Colour for one band id. */
export function sitadelBandColor(id) {
  return sitadelBand(id).color;
}

/**
 * Dot radius for one permit, by dwellings created.
 *
 * Square-rooted against {@link SITADEL_SIZE_CEILING_LGT} so a 200-dwelling
 * block is four times the AREA of a 50-dwelling one rather than four times the
 * radius. A permit that creates no dwelling — a demolition, or one of the
 * 0.3% of housing permits with `NB_LGT_TOT_CREES` at zero — draws at the
 * minimum, and the card says which of the two it is.
 *
 * @param {?number} dwellings
 * @param {number} [min]
 * @param {number} [max]
 * @returns {number}
 */
export function sitadelPointSize(dwellings, min = 5, max = 22) {
  const count = finiteOrNull(dwellings);
  if (count === null || count <= 0) return min;
  const scale = Math.sqrt(Math.min(count, SITADEL_SIZE_CEILING_LGT))
    / Math.sqrt(SITADEL_SIZE_CEILING_LGT);
  return min + (max - min) * scale;
}

/**
 * Resolve one permit against the parcel index.
 *
 * @param {object} row
 * @param {Map<string, Array<object>>} index
 * @param {?ReadonlyArray<string>} arrondissements
 * @returns {{outcome:string, features:Array<object>, keys:Array<string>, commune:?string,
 *   refs:number, ambiguousRefs:number}}
 */
export function resolveSitadelParcels(row, index, arrondissements = null) {
  const commune = sitadelJoinCommune(row, arrondissements);
  const features = [];
  const keys = [];
  let refs = 0;
  let ambiguousRefs = 0;
  for (const slot of [1, 2, 3]) {
    const section = row?.[`SEC_CADASTRE${slot}`];
    const numero = row?.[`NUM_CADASTRE${slot}`];
    if (section === null || section === undefined || section === '') continue;
    if (numero === null || numero === undefined || numero === '') continue;
    refs += 1;
    const key = sitadelParcelKey(commune, section, numero);
    const bucket = key ? index?.get(key) : null;
    if (!bucket || !bucket.length) continue;
    // SEVERAL candidates is not a near miss to be broken by picking the first.
    // The préfixe that would separate them is the one component of the
    // cadastral key Sitadel does not publish, so the honest answer is that this
    // reference does not identify a parcel.
    if (bucket.length > 1) { ambiguousRefs += 1; continue; }
    if (!keys.includes(key)) { keys.push(key); features.push(bucket[0]); }
  }
  let outcome = 'noref';
  if (features.length) outcome = 'placed';
  else if (ambiguousRefs) outcome = 'ambiguous';
  else if (refs) outcome = 'missing';
  return { outcome, features, keys, commune, refs, ambiguousRefs };
}

/** Year of authorisation, as a 4-character string, or null. */
export function sitadelYear(row) {
  const date = String(row?.DATE_REELLE_AUTORISATION ?? '').trim();
  return /^\d{4}/.test(date) ? date.slice(0, 4) : null;
}

/**
 * The whole client payload for one commune.
 *
 * Parcels are shipped ONCE and referenced by index, because permits repeat
 * them: measured on Nantes, 1 372 placed permits sit on 1 703 distinct parcels
 * over thirteen years, and Toulouse's 366 placed permits sit on 384. Finished
 * payloads, gzipped: Toulouse 0.05 MB, Marseille 0.14 MB, Bordeaux 0.20 MB,
 * Lyon 0.20 MB, Nantes 0.21 MB, Paris 0.39 MB.
 *
 * @param {object} input
 * @param {Array<object>} [input.housing] Rows of the housing datafile.
 * @param {Array<object>} [input.demolition] Rows of the demolition datafile.
 * @param {Map<string, Array<object>>} input.index From {@link indexCadastreParcels}.
 * @param {object} input.commune `{code, nom, departement, region, population}`.
 * @param {object} [input.outline] From `projectGeometry` of the commune contour.
 * @param {string} [input.millesime]
 * @param {string} [input.cadastreEdition]
 * @param {Array<string>} [input.cadastreCommunes]
 * @param {number} [input.cadastreParcels]
 * @param {boolean} [input.demolitionAvailable]
 * @returns {object}
 */
export function projectSitadelCommune({
  housing = [],
  demolition = [],
  index = new Map(),
  commune = {},
  outline = null,
  millesime = SITADEL_MILLESIME_FLOOR,
  cadastreEdition = CADASTRE_EDITION_FLOOR,
  cadastreCommunes = [],
  cadastreParcels = 0,
  demolitionAvailable = true,
} = {}) {
  const insee = String(commune?.code ?? '').trim();
  const arrondissements = ARRONDISSEMENT_COMMUNES[insee] || null;

  /** key → payload index, so a parcel is emitted once however many permits name it. */
  const parcelSlots = new Map();
  const parcels = [];
  const permits = [];
  const outcomes = { placed: 0, ambiguous: 0, missing: 0, noref: 0 };
  const years = new Map();
  const bands = new Map(SITADEL_BAND_IDS.map((id) => [id, 0]));

  let dwellings = 0;
  let dwellingsDrawn = 0;
  let surfaceCreated = 0;
  let dwellingsDemolished = 0;
  let surfaceDemolished = 0;
  let terrainChecked = 0;
  let terrainAgreeing = 0;
  let multiParcel = 0;
  let mojibake = 0;

  const files = [
    { file: 'housing', rows: Array.isArray(housing) ? housing : [] },
    { file: 'demolition', rows: Array.isArray(demolition) ? demolition : [] },
  ];

  for (const { file, rows } of files) {
    for (const row of rows) {
      const year = sitadelYear(row);
      if (year) {
        const tally = years.get(year) || { year, permits: 0, placed: 0 };
        tally.permits += 1;
        years.set(year, tally);
      }

      const created = finiteOrNull(row?.NB_LGT_TOT_CREES) ?? 0;
      if (file === 'housing') {
        dwellings += created;
        surfaceCreated += finiteOrNull(row?.SURF_HAB_CREEE) ?? 0;
        dwellingsDemolished += finiteOrNull(row?.NB_LGT_DEMOLIS) ?? 0;
        surfaceDemolished += finiteOrNull(row?.SURF_HAB_DEMOLIE) ?? 0;
      }

      const resolved = resolveSitadelParcels(row, index, arrondissements);
      outcomes[resolved.outcome] += 1;
      if (resolved.outcome !== 'placed') continue;
      if (year) years.get(year).placed += 1;

      const slots = [];
      let drawnM2 = 0;
      for (let i = 0; i < resolved.features.length; i += 1) {
        const key = resolved.keys[i];
        let slot = parcelSlots.get(key);
        if (slot === undefined) {
          const feature = resolved.features[i];
          const parts = parcelParts(feature?.geometry);
          const anchor = parcelAnchor(parts);
          if (!parts.length || !anchor) continue;
          const props = feature.properties || {};
          slot = parcels.length;
          parcelSlots.set(key, slot);
          parcels.push({
            k: key,
            m: String(props.commune ?? '') || null,
            s: String(props.section ?? '') || null,
            n: String(props.numero ?? '') || null,
            // The préfixe the cadastre publishes and Sitadel does not. Carried
            // so a reader can see the component the join had to do without.
            x: String(props.prefixe ?? '') || null,
            c: finiteOrNull(props.contenance),
            a: Number((parcelAreaM2(parts) ?? 0).toFixed(2)),
            p: [round6(anchor[0]), round6(anchor[1])],
            g: parts.map((part) => part.map((ring) => ring.map(([lon, lat]) => [round6(lon), round6(lat)]))),
          });
        }
        if (!slots.includes(slot)) slots.push(slot);
        drawnM2 += parcels[slot].a;
      }
      if (!slots.length) {
        // Every candidate parcel had unusable geometry. Counted as missing
        // rather than placed: there is nothing to draw and nothing to claim.
        outcomes.placed -= 1;
        outcomes.missing += 1;
        if (year) years.get(year).placed -= 1;
        continue;
      }
      if (slots.length > 1) multiParcel += 1;

      const bandId = sitadelBandId(row, file);
      bands.set(bandId, (bands.get(bandId) || 0) + 1);
      if (file === 'housing') dwellingsDrawn += created;

      const terrain = finiteOrNull(row?.SUPERFICIE_TERRAIN);
      let agreement = null;
      if (terrain !== null && terrain > 0 && drawnM2 > 0) {
        const ratio = drawnM2 / terrain;
        agreement = Number(ratio.toFixed(3));
        terrainChecked += 1;
        if (ratio >= 1 / SITADEL_AREA_AGREEMENT && ratio <= SITADEL_AREA_AGREEMENT) terrainAgreeing += 1;
      }

      const street = sitadelText(row?.ADR_LIBVOIE_TER);
      const applicant = sitadelText(row?.DENOM_DEM);
      if (repairSitadelText(row?.ADR_LIBVOIE_TER ?? '') !== String(row?.ADR_LIBVOIE_TER ?? '')
        || repairSitadelText(row?.DENOM_DEM ?? '') !== String(row?.DENOM_DEM ?? '')) mojibake += 1;

      permits.push({
        // The registration number is not a primary key — 3 561 distinct values
        // across Paris' 3 595 rows, so 34 permits share one with another. The
        // render id below adds the file and the row's own ordinal.
        i: sitadelText(row?.NUM_DAU ?? row?.NUM_PD),
        f: file === 'demolition' ? 'dem' : 'lgt',
        b: bandId,
        t: sitadelText(row?.TYPE_DAU) || (file === 'demolition' ? 'PD' : null),
        e: finiteOrNull(row?.ETAT_DAU ?? row?.ETAT_PD),
        y: year,
        da: sitadelText(row?.DATE_REELLE_AUTORISATION),
        do: sitadelText(row?.DATE_REELLE_DOC),
        df: sitadelText(row?.DATE_REELLE_DAACT),
        lgt: file === 'housing' ? created : null,
        srf: file === 'housing' ? finiteOrNull(row?.SURF_HAB_CREEE) : null,
        dlg: file === 'housing' ? finiteOrNull(row?.NB_LGT_DEMOLIS) : null,
        dsr: file === 'housing' ? finiteOrNull(row?.SURF_HAB_DEMOLIE) : null,
        ter: terrain,
        ag: agreement,
        np: file === 'housing' ? finiteOrNull(row?.NATURE_PROJET_COMPLETEE) : null,
        dem: applicant,
        an: sitadelText(row?.ADR_NUM_TER),
        av: street,
        px: slots,
      });
    }
  }

  permits.sort((a, b) => String(b.da || '').localeCompare(String(a.da || ''))
    || (b.lgt || 0) - (a.lgt || 0)
    || String(a.i || '').localeCompare(String(b.i || '')));

  const total = outcomes.placed + outcomes.ambiguous + outcomes.missing + outcomes.noref;
  return {
    insee,
    commune: sitadelText(commune?.nom) || insee,
    dept: String(commune?.departement?.code ?? '') || null,
    deptName: sitadelText(commune?.departement?.nom),
    region: sitadelText(commune?.region?.nom),
    population: finiteOrNull(commune?.population),
    cadastreCommunes: [...cadastreCommunes],
    parcels,
    permits,
    outline: outline ? {
      parts: outline.parts || [],
      simplified: Boolean(outline.simplified),
      sourceParts: outline.sourceParts ?? null,
      servedParts: outline.servedParts ?? null,
    } : null,
    years: [...years.values()].sort((a, b) => a.year.localeCompare(b.year)),
    summary: {
      permits: total,
      housing: Array.isArray(housing) ? housing.length : 0,
      demolition: Array.isArray(demolition) ? demolition.length : 0,
      ...outcomes,
      drawn: permits.length,
      parcels: parcels.length,
      multiParcel,
      bands: SITADEL_BANDS.map((band) => ({
        id: band.id,
        label: band.label,
        color: band.color,
        blurb: band.blurb,
        count: bands.get(band.id) || 0,
      })),
      dwellings,
      dwellingsDrawn,
      surfaceCreated: Math.round(surfaceCreated),
      dwellingsDemolished,
      surfaceDemolished: Math.round(surfaceDemolished),
      terrainChecked,
      terrainAgreeing,
      mojibake,
      cadastreParcels,
      // Not fatal: the housing file alone is the layer. Losing the demolition
      // file costs the fifth band and says so, rather than showing a commune
      // that never knocks anything down.
      demolitionAvailable: Boolean(demolitionAvailable),
    },
    millesime,
    cadastreEdition,
    source: SITADEL_SOURCE,
    licence: SITADEL_LICENCE,
    datasetPage: SITADEL_DATASET_PAGE,
  };
}

// --- Card copy --------------------------------------------------------------

/** French thousands separator, matching the other French packs. */
function fr(value) {
  return Number(value).toLocaleString('fr-FR');
}

/** `1 234 m²`, hectares once a plot stops being a plot. */
export function formatSurfaceM2(value) {
  const m2 = finiteOrNull(value);
  if (m2 === null) return null;
  if (m2 >= 10000) return `${(m2 / 10000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ha`;
  return `${Math.round(m2).toLocaleString('fr-FR')} m²`;
}

/** `04/10/2024` from an ISO date, or null. */
export function formatSitadelDate(value) {
  const text = String(value ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

/** The one-line title of a permit. */
export function sitadelPermitTitle(permit) {
  const type = SITADEL_TYPE_LABELS[permit?.t] || (permit?.f === 'dem' ? 'Permis de démolir' : 'Autorisation d’urbanisme');
  const created = finiteOrNull(permit?.lgt);
  if (created !== null && created > 0) {
    return `${type} — ${fr(created)} logement${created > 1 ? 's' : ''}`;
  }
  return type;
}

/**
 * The card for one permit.
 *
 * Ordered as an answer to "what is going to happen here": what was authorised,
 * how far it has got, what it creates, what it removes, and — last, always —
 * how the position was obtained and how well it checks out. That last pair is
 * not a footnote: this is the only layer on the globe whose every coordinate
 * was computed rather than published, and the card is where that is admitted.
 *
 * @param {object} permit
 * @param {Array<object>} parcels The payload's parcel table.
 * @returns {string[]} Title first, then detail lines.
 */
export function buildSitadelPermitCard(permit, parcels = []) {
  const lines = [];
  const band = sitadelBand(permit?.b);

  const authorised = formatSitadelDate(permit?.da);
  lines.push(authorised ? `${band.label} · autorisé le ${authorised}` : band.label);

  // The three real dates, and the gaps between them. An `Autorisé` permit has
  // no DOC and no DAACT by construction, so saying "chantier non déclaré"
  // there would be repeating the band; the line only appears when the file
  // actually distinguishes two moments.
  const started = formatSitadelDate(permit?.do);
  const finished = formatSitadelDate(permit?.df);
  if (started && finished) lines.push(`Chantier ouvert le ${started}, achevé le ${finished}`);
  else if (started) lines.push(`Chantier ouvert le ${started} — achèvement non déclaré`);
  else if (finished) lines.push(`Achevé le ${finished} — aucune ouverture de chantier déclarée`);

  const created = finiteOrNull(permit?.lgt);
  const surface = finiteOrNull(permit?.srf);
  if (created !== null || surface !== null) {
    const parts = [];
    if (created !== null) parts.push(`${fr(created)} logement${created > 1 ? 's' : ''} créé${created > 1 ? 's' : ''}`);
    if (surface !== null && surface > 0) parts.push(`${formatSurfaceM2(surface)} de surface habitable`);
    if (parts.length) lines.push(parts.join(' · '));
  }

  const removedDwellings = finiteOrNull(permit?.dlg);
  const removedSurface = finiteOrNull(permit?.dsr);
  if ((removedDwellings ?? 0) > 0 || (removedSurface ?? 0) > 0) {
    const parts = [];
    if ((removedDwellings ?? 0) > 0) parts.push(`${fr(removedDwellings)} logement${removedDwellings > 1 ? 's' : ''} démoli${removedDwellings > 1 ? 's' : ''}`);
    if ((removedSurface ?? 0) > 0) parts.push(`${formatSurfaceM2(removedSurface)} supprimée`);
    lines.push(parts.join(' · '));
  }

  const nature = SITADEL_NATURE_LABELS[permit?.np];
  if (nature) lines.push(nature);

  const address = [permit?.an, permit?.av].filter(Boolean).join(' ');
  if (address) lines.push(address);
  if (permit?.dem) lines.push(permit.dem);

  const slots = Array.isArray(permit?.px) ? permit.px : [];
  const named = slots.map((slot) => parcels?.[slot]).filter(Boolean);
  if (named.length) {
    const label = named.map((parcel) => `${parcel.s ?? '?'} ${parcel.n ?? '?'}`).join(' · ');
    lines.push(named.length > 1
      ? `${named.length} parcelles : ${label}`
      : `Parcelle ${label}`);
    // The préfixe is the component Sitadel does not publish. Where it is not
    // `000` the reference could only be resolved because nothing else in the
    // commune shares this (section, numéro) — worth naming.
    const prefixes = [...new Set(named.map((parcel) => parcel.x).filter((value) => value && value !== '000'))];
    if (prefixes.length) lines.push(`Préfixe de section ${prefixes.join(', ')} — absent du fichier Sitadel`);
  }

  const terrain = finiteOrNull(permit?.ter);
  const drawn = named.reduce((sum, parcel) => sum + (finiteOrNull(parcel.a) ?? 0), 0);
  if (terrain !== null && terrain > 0) {
    const agreement = finiteOrNull(permit?.ag);
    const verdict = agreement === null ? null
      : (agreement >= 1 / SITADEL_AREA_AGREEMENT && agreement <= SITADEL_AREA_AGREEMENT
        ? 'concordant' : 'DISCORDANT');
    lines.push(`Terrain déclaré ${formatSurfaceM2(terrain)} · parcelle tracée ${formatSurfaceM2(drawn)}`
      + (verdict ? ` — ${verdict}` : ''));
  } else {
    lines.push('Superficie du terrain non publiée — le tracé n’est pas recoupé');
  }

  lines.push('Position calculée par jointure cadastrale — Sitadel ne publie aucune coordonnée');
  if (permit?.i) lines.push(`N° ${permit.i}`);
  return [sitadelPermitTitle(permit), ...lines];
}

/**
 * The line under the layer's toggle.
 *
 * Says the commune first, because this layer answers one commune at a time and
 * a reader who does not know that will read the empty neighbouring commune as
 * "no permits here".
 *
 * @param {object} state
 * @returns {?string}
 */
export function sitadelLoadingLabel({
  status, commune, summary, millesime,
} = {}) {
  if (status === 'too-high') return 'Sitadel interroge une commune à la fois — descends sous 12 000 m';
  if (status === 'off-coverage') return 'Hors de France — Sitadel ne couvre que les communes françaises';
  if (status === 'loading') return commune ? `Permis de ${commune}…` : 'Recherche de la commune…';
  if (status === 'no-commune') return 'Aucune commune française sous le centre de l’écran';
  if (!summary) return null;
  const parts = [];
  const head = commune ? `${commune} · ` : '';
  parts.push(`${head}${fr(summary.drawn || 0)} permis posés sur ${fr(summary.parcels || 0)} parcelles`);
  const unplaced = (summary.ambiguous || 0) + (summary.missing || 0) + (summary.noref || 0);
  if (unplaced > 0) {
    const share = summary.permits > 0 ? Math.round((100 * unplaced) / summary.permits) : 0;
    parts.push(`${fr(unplaced)} non posés (${share} %)`);
  }
  if (summary.dwellingsDrawn > 0) parts.push(`${fr(summary.dwellingsDrawn)} logements autorisés`);
  if (millesime) parts.push(`millésime ${millesime}`);
  return parts.join(' · ');
}

/**
 * The sentence that explains where the unplaced permits went.
 *
 * Three different failures with three different causes, kept apart because the
 * reader can act on the difference: an ambiguous reference means this commune
 * has prefixed sections and NOTHING will fix it; a missing one means the
 * parcel was built on and divided; no reference means the file is blank.
 *
 * @param {object} summary
 * @returns {string[]}
 */
export function sitadelUnplacedLines(summary) {
  const lines = [];
  if (!summary) return lines;
  if (summary.ambiguous > 0) {
    lines.push(`${fr(summary.ambiguous)} référence${summary.ambiguous > 1 ? 's' : ''} ambiguë${summary.ambiguous > 1 ? 's' : ''}`
      + ' — plusieurs parcelles de la commune portent la même section et le même numéro (préfixes de section, absents de Sitadel)');
  }
  if (summary.missing > 0) {
    lines.push(`${fr(summary.missing)} parcelle${summary.missing > 1 ? 's' : ''} introuvable${summary.missing > 1 ? 's' : ''}`
      + ' dans le cadastre d’aujourd’hui — divisée ou renumérotée depuis le dépôt');
  }
  if (summary.noref > 0) {
    lines.push(`${fr(summary.noref)} permis sans aucune référence cadastrale publiée`);
  }
  return lines;
}
