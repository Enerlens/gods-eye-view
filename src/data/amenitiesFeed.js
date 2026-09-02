/**
 * @module amenitiesFeed
 *
 * The reading of the two registers behind "où est le plus proche" — INSEE's
 * Base permanente des équipements and the FINESS health-and-social register —
 * and, just as important, the list of things in them this layer REFUSES to
 * draw because another layer already draws them better.
 *
 * `amenitiesMesh.js` holds the middle regime, `amenitiesDepartements.js` the
 * national fold, `amenitiesFrance.js` the rendering. Everything here is pure
 * and runs under `node --test` against real captured rows.
 *
 * ── Why the browser never touches INSEE, and why that is not a size problem ──
 * Measured twice on 2026-09-02 from this machine:
 * `https://www.insee.fr/fr/statistiques/8217525` answers **HTTP 200 with no
 * `Origin` header and HTTP 403 with one** (tested `http://localhost:4173`), on
 * the page, on `BPE25.zip` and on `BPE25.parquet`, for GET and HEAD alike. It
 * also ignores `Range`: `curl -r 0-2000` returns 200, not 206, and starts
 * streaming the whole file. So this is not "too big for a browser", it is
 * unreachable from one — no key, no CORS proxy header, no partial fetch. The
 * fold happens in the dev-server proxy or it does not happen.
 *
 * The size is real too, and it was measured rather than quoted: the archive is
 * **142 884 474 bytes** (51.3 s on this connection), holds exactly one member,
 * and inflates to **1 515 251 530 bytes** of semicolon CSV — **2 921 770 rows ×
 * 95 columns**, 235 distinct TYPEQU codes, 27 SDOM, 7 DOM. INSEE serves it
 * chunked with no `Content-Length`, so a byte-size integrity gate is not
 * available; the zip's own central directory is.
 *
 * ── What is drawn: seven families, one register each ────────────────────────
 * The brief's row is *écoles, médecins, pharmacies, supermarchés, piscines,
 * poste, gendarmerie*. Six of the seven are drawn, one is refused outright, and
 * two more are added where a register already folded gives them for free. The
 * rule that decides every one of them is **one register per family, never two**
 * — two registers on one family is how a map ends up with every pharmacy in
 * France drawn twice, forty metres apart.
 *
 *   medecin     BPE D265 — 61 263 rows in the file
 *   courses     BPE B104 + B105 + B201 — 2 256 + 12 929 + 5 617 = 20 802
 *   pharmacie   FINESS categetab 620 — 20 003, NOT BPE D307's 20 334
 *   poste       BPE A206 + A207 + A208 — 6 584 + 3 164 + 7 122 = 16 870
 *   piscine     BPE F101 — 3 633
 *   gendarmerie BPE A104 + A140 — 3 394 + 661 = 4 055
 *   hopital     FINESS categagretab 1101/1102/1106/1110 — 388 + 1 371 + 195
 *               + 631 = 2 585
 *
 * 129 211 candidate rows. After the two refusals below, **126 859 are drawn**.
 *
 * ── What is refused, and the measurement behind each refusal ────────────────
 * 1. **DOM = C, enseignement, 79 743 rows — refused entirely.** `schools-fr`
 *    already draws 68 158 open, geolocated schools from the ministry's own
 *    Annuaire, keyed on the UAI, and `sup-fr` 6 914 higher-education sites.
 *    BPE's C1 + C2 + C3 alone is 48 661 + 7 532 + 5 872 = 62 065 rows over the
 *    same buildings, and it **has no UAI column at all** — this module checked
 *    all 95 delivered names — so a BPE school cannot even be reconciled with
 *    the school already on the globe except by fuzzy address matching. Adding
 *    it would double every school in France from a source whose geocoding is
 *    measurably worse (79.2% `QUALITE_XY = B` over the whole file, against the
 *    ministry's own coordinates). C4–C7, another 17 678 rows, are `sup-fr`'s
 *    subject for the same reason.
 * 2. **B326 stations de recharge, 28 819 rows — refused.** `irve-fr` reads the
 *    same fact live from transport.data.gouv.fr, where it is 231 079 charge
 *    points on 39 579 distinct coordinates. Showing 28 819 points frozen at the
 *    2025 vintage beside them is not a second opinion, it is a stale one.
 * 3. **DOM = E, transports, 99 280 rows — refused.** 96 253 of them are
 *    TAXI-VTC operators' registered addresses, which are not equipment a
 *    reader can walk to; the 2 938 gares and 89 aéroports are `transit-fr`'s
 *    and `local-airports`' subject.
 * 4. **D307 pharmacies, 20 334 rows — refused in favour of FINESS's 20 003.**
 *    The two registers describe the same objects and disagree by 331. FINESS
 *    wins on three measured grounds: `nofinesset` is a stable unique key
 *    (103 032 rows, 103 032 distinct values, zero duplicates), the file is
 *    refreshed monthly against BPE's annual snapshot, and every one of its
 *    102 937 placed rows carries a 2026 `datemaj_geoloc`.
 * 5. **D106 urgences, 695 rows — refused as a duplicate of `hopital`.** Not
 *    asserted: measured. Of the 694 that carry a coordinate, **547 (78.8%) sit
 *    within 200 m of a FINESS hospital-family establishment and 665 (95.8%)
 *    within 1 km, median distance 79 m.** An A&E is a department inside a
 *    hospital, and drawing both puts two dots on one building.
 *
 * Everything else in the file — 231 989 restaurants, 113 427 plumbers, 50 122
 * bakeries, 34 917 mairies — is simply outside the brief's row and is counted,
 * never drawn. The proxy reports the whole 2 921 770 so the card can say what
 * fraction of the register this layer is.
 *
 * ── Trap 1: both registers admit which of their points are invented, and this
 *    module refuses those points rather than drawing them ─────────────────────
 * BPE publishes `QUALITE_GEOLOC`, whose modality **33** INSEE spells out in
 * `BPE25_anonymisee_varmod.csv` as *"Voie inconnue, Position aléatoire dans la
 * commune"*. That is not an imprecise position, it is a drawn one. Over the
 * ten selected codes it is **1 284 rows**, and this module proved the wording
 * literal: of the 207 communes holding more than one such row (724 rows), only
 * **3** contain any repeated coordinate — the position is re-drawn per row.
 *
 * FINESS does the same thing differently. Its `sourcecoordet` names the
 * geocoder, and **4 646 rows are geocoded against `ADMIN-EXPRESS-2023`** — the
 * IGN commune database — with a score of `.` instead of a number. The
 * partition is exact: geocoder ∈ {BAN 88 737, BDADRESSE 9 535} carries a
 * numeric score, and {ADMIN-EXPRESS-2023 4 646, MAPS 19} carries none. This
 * module proved those are commune centroids: of the 2 619 ADMIN-EXPRESS rows
 * that share a commune with another, **2 612 sit on a byte-identical
 * coordinate**, against 1 608 of 84 561 for the BAN control. Four different
 * establishments in Bourg-en-Bresse all sit at 5.224702, 46.205283.
 *
 * Both are refused: **1 284 BPE rows and 898 FINESS rows** in the drawn
 * families, counted and reported per family, never placed. One register draws
 * a random point in the commune and the other draws the same point for the
 * whole commune; neither is where the thing is.
 *
 * ── Trap 2: a row with no coordinate at all, and where they are ─────────────
 * 170 of the 106 623 selected BPE rows publish no LATITUDE. **100 of those 170
 * are in Mayotte** — every single one of the département's 100 rows in these
 * ten codes, across all five families, with LATITUDE, LONGITUDE, LAMBERT_X and
 * LAMBERT_Y all empty while still declaring `EPSG=4471`. Mayotte has 7 081 BPE
 * rows and 17 communes; this layer draws none of its BPE equipment, and the
 * card says so rather than letting an empty island read as an empty island.
 * FINESS is the counterweight and it is drawn: 189 Mayotte establishments,
 * 28 pharmacies and 7 hospitals among them.
 *
 * ── Trap 3: FINESS coordinates are projected, in five CRS, named inside a
 *    free-text field ───────────────────────────────────────────────────────────
 * There is no lat/lon column. `coordxet`/`coordyet` are metres, and the
 * projection is the **fifth comma-separated token of `sourcecoordet`**, e.g.
 * `1,ATLASANTE,96,BAN,EPSG:2154 RGF93 / Lambert-93 (Métropole)`. Measured over
 * all 103 032 rows: every one of the 102 937 non-empty values splits into
 * **exactly five tokens** with the CRS at index 4 — including the two rows
 * reading `4,ATLASANTE,.,MAPS 06-11-2024,WGS84/UTM zone 1S (Wallis-et-Futuna)`,
 * whose token positions are often claimed to shift and do not. So a positional
 * split is correct for 100% of rows and a regex on `EPSG:(\d+)` is not: **18
 * rows carry no `EPSG:` prefix** (16 Saint-Pierre-et-Miquelon, 2
 * Wallis-et-Futuna) and a regex silently drops them.
 *
 * The distribution: EPSG:2154 Lambert-93 100 278 · EPSG:5490 Antilles 1 278 ·
 * EPSG:2975 La Réunion 876 · EPSG:2972 Guyane 298 · EPSG:4471 Mayotte 189 ·
 * WGS84/UTM 21N Saint-Pierre-et-Miquelon 16 · WGS84/UTM 1S Wallis-et-Futuna 2 ·
 * empty 95.
 *
 * **Pushing the 2 659 non-metropolitan rows through the Lambert-93 inverse
 * moves them a median of 6 990 km** — minimum 4 632 km, maximum 21 004 km, the
 * Hôpital de Sia on Wallis landing at 0.88 E / 63.57 N in the Norwegian Sea.
 * The one mercy is that the failure is loud: all 2 659 land OUTSIDE the
 * Lambert-93 area of use, so a sanity gate catches every one. Catching them
 * would still lose 2 659 real establishments. Reading the declared CRS is the
 * only right answer, and it is why this module carries a UTM inverse next to
 * the Lambert-93 one it borrows from `scripts/lib/lambert93.mjs`.
 *
 * ── Trap 4: three vocabularies for one département ──────────────────────────
 * BPE spells the overseas départements `971 972 973 974 976`. FINESS spells the
 * same territories `9A 9B 9C 9D 9F`, plus `9E` Saint-Pierre-et-Miquelon and
 * `9J` Wallis-et-Futuna — measured, not assumed. The bundled IGN outlines use
 * a third set. BPE also spells Corsica `2A`/`2B` where other French registers
 * zero-pad. So nothing here is ever joined on a département code: every point
 * is placed by point-in-polygon in `amenitiesDepartements.js`.
 *
 * ── Trap 5: `_Z` and `_U` are not categories ────────────────────────────────
 * BPE's missing sentinels are the two-character strings `_Z` ("Sans objet") and
 * `_U` ("Indéterminé"), not empty strings — one sampled row carries `_Z` in
 * about forty of its 95 columns, alongside empty strings and literal `"0"`s in
 * the same row. A parser that treats them as values invents a nationwide
 * equipment type called `_Z`. They are read here as "the register does not
 * state this", which is a third thing from "good" and from "bad": **3 626 of
 * the 3 633 bassins de natation carry `QUALITE_XY = _U` and 3 632 carry
 * `QUALITE_GEOLOC = _Z`** — the sports census is not geocoded by the address
 * pipeline at all, so every pool on this map is drawn at a position whose
 * precision INSEE never published.
 *
 * ── Trap 6: the file is a moving target at a stable URL ─────────────────────
 * INSEE: *"Ce fichier d'équipements est actualisé mensuellement pour tenir
 * compte de l'opposition de certains chefs d'entreprise à la diffusion de leurs
 * données à caractère personnel sur sirene.fr."* Row counts and names drift
 * month to month with no version in the path, so `BPE_ROW_FLOOR` below pins
 * what was measured and the proxy warns on drift instead of assuming stability.
 *
 * ── How the edition is discovered ───────────────────────────────────────────
 * Not pinned, and not guessed. `data.gouv.fr` dataset
 * `548acaf2c751df1eac4120e7` is INSEE's own entry (licence `fr-lo`,
 * `frequency: annual`, `last_update` 2026-08-02) and its single resource URL is
 * **the current edition's INSEE landing page** — measured today,
 * `https://www.insee.fr/fr/statistiques/8217537`, titled *"Dénombrement et
 * géolocalisation des équipements en 2025"*. That page lists four sub-pages
 * (8217525, 8217527, 8217532, 8217535) and exactly one of them carries
 * `BPE25.zip`. Three cheap hops, a stable root, and a floor: a discovery that
 * comes back OLDER than `BPE_EDITION_FLOOR` is a malformed answer, not a new
 * fact.
 *
 * Licences. BPE: Licence Ouverte, "Insee, Base permanente des équipements
 * 2025". FINESS: Licence Ouverte 2.0, réexposition data.gouv.fr of the ARS /
 * Agence du Numérique en Santé register, geocoded by ATLASANTE against the BAN.
 * No key, no quota observed.
 */

import { lambert93ToWgs84 } from '../../scripts/lib/lambert93.mjs';

// --- Provenance -------------------------------------------------------------

export const AMENITIES_SOURCE = 'BPE 2025 — Insee · FINESS — ARS/ANS';

/** INSEE's own data.gouv entry. Its one resource URL is the current landing page. */
export const BPE_DATAGOUV_DATASET = '548acaf2c751df1eac4120e7';
export const BPE_DATAGOUV_URL = `https://www.data.gouv.fr/api/1/datasets/${BPE_DATAGOUV_DATASET}/`;
/** Where discovery starts if data.gouv is unreachable — the edition measured against. */
export const BPE_LANDING_URL = 'https://www.insee.fr/fr/statistiques/8217537';
/**
 * Two-digit edition floor. `BPE25.zip` is what every number in this module was
 * measured against; a discovery of `BPE24` is a malformed answer.
 */
export const BPE_EDITION_FLOOR = 25;
/** Rows measured in BPE25.csv on 2026-09-02. Drift is warned about, not assumed away. */
export const BPE_ROW_FLOOR = 2_921_770;
/** Columns delivered. The dictionary documents 98; IDEQUIP, IDSOURCE and SOU are not shipped. */
export const BPE_COLUMN_COUNT = 95;

export const FINESS_DATAGOUV_DATASET = '67e43007cd5e91b9fdcbc7b3';
export const FINESS_CSV_URL = 'https://data-pipeline-open.s3.sbg.io.cloud.ovh.net/finess/finess_etablissements.csv';
/** Rows measured 2026-09-02, all 35 columns present, 103 032 distinct `nofinesset`. */
export const FINESS_ROW_FLOOR = 103_032;
export const FINESS_COLUMN_COUNT = 35;

/**
 * Viewport ceiling for the exact regime, in degrees.
 *
 * 0.35, the same ceiling `schools-fr` and `anfr-fr` settled on, and here it is
 * a payload bound rather than an upstream one: the proxy answers `/sites` out
 * of the folded index with no network call at all. Measured on the real pack,
 * the densest 0.349° square the ceiling allows anywhere in France — 48.65 N,
 * 2.20 E, Paris and its inner south-eastern suburbs — holds **9 139 dots,
 * 2 840 075 bytes of JSON and 277 260 gzipped**; the same square over Lyon holds
 * 1 762 and over the Creuse 81.
 */
export const AMENITIES_MAX_BOX_DEG = 0.35;

// --- The seven families -----------------------------------------------------

/**
 * Family ids, in the order the mesh uses as its category index.
 *
 * The order is not cosmetic. `geoMeshThinning.js` breaks a tie between two
 * equally common categories in a cell towards the LOWER index, so the ladder
 * runs from the family that over-claims least to the one that over-claims most:
 * a cell drawn as "a GP" when it also held a hospital under-states, and a cell
 * drawn as "a hospital" when it held one GP over-states. Ascending by national
 * count is the same order, which is a coincidence worth not relying on.
 */
export const AMENITY_FAMILIES = Object.freeze([
  'medecin', 'courses', 'pharmacie', 'poste', 'piscine', 'gendarmerie', 'hopital',
]);

/** Index of a family in {@link AMENITY_FAMILIES}, or -1. */
export function amenityFamilyIndex(family) {
  return AMENITY_FAMILIES.indexOf(family);
}

export const AMENITY_FAMILY_LABELS = Object.freeze({
  medecin: 'Médecin généraliste',
  courses: 'Supermarché, supérette',
  pharmacie: 'Pharmacie',
  poste: 'La Poste',
  piscine: 'Bassin de natation',
  gendarmerie: 'Gendarmerie, police',
  hopital: 'Hôpital',
});

/** Singular/plural head-word for a card, keyed the same way. */
export const AMENITY_FAMILY_PLURALS = Object.freeze({
  medecin: 'médecins généralistes',
  courses: 'commerces alimentaires',
  pharmacie: 'pharmacies',
  poste: 'points de contact La Poste',
  piscine: 'bassins de natation',
  gendarmerie: 'unités de gendarmerie et de police',
  hopital: 'hôpitaux',
});

/** One line behind each swatch — what the family actually contains, measured. */
export const AMENITY_FAMILY_BLURBS = Object.freeze({
  medecin: 'BPE D265. 61 263 dans le fichier, 60 270 dessinés : 946 sont placés au hasard dans leur commune et 47 n’ont pas de coordonnée.',
  courses: 'BPE B104 hypermarché et grand magasin (2 256), B105 supermarché (12 929), B201 supérette (5 617). Ni épicerie ni boulangerie : ce sont 80 226 lignes de plus.',
  pharmacie: 'FINESS, catégorie 620 « Pharmacie d’Officine » — 20 003 officines, contre 20 334 pour la BPE. Un seul registre par famille, et c’est celui qui a une clé stable.',
  poste: 'BPE A206 bureau de poste (6 584), A208 agence postale communale (7 122), A207 relais poste commerçant (3 164). Trois formes de guichet, pas trois postes.',
  piscine: 'BPE F101. Le recensement des équipements sportifs : 3 626 des 3 633 lignes ne publient AUCUN indice de précision de position.',
  gendarmerie: 'BPE A104 gendarmerie recevant du public (3 394) et A140 police (661). Ce sont les points d’accueil, pas le maillage opérationnel.',
  hopital: 'FINESS : CHR (388), centres hospitaliers (1 371), hôpitaux locaux (195), soins de courte durée (631). Les urgences de la BPE ne sont pas ajoutées — 78,8 % d’entre elles sont à moins de 200 m d’un de ces points.',
});

/** Which register answers for a family. One each, never two. */
export const AMENITY_FAMILY_REGISTER = Object.freeze({
  medecin: 'bpe',
  courses: 'bpe',
  pharmacie: 'finess',
  poste: 'bpe',
  piscine: 'bpe',
  gendarmerie: 'bpe',
  hopital: 'finess',
});

// --- BPE selection ----------------------------------------------------------

/** TYPEQU → family. The only ten codes of 235 this layer draws. */
export const BPE_CODE_FAMILY = Object.freeze({
  D265: 'medecin',
  B104: 'courses',
  B105: 'courses',
  B201: 'courses',
  A206: 'poste',
  A207: 'poste',
  A208: 'poste',
  F101: 'piscine',
  A104: 'gendarmerie',
  A140: 'gendarmerie',
});

/** INSEE's own label for each drawn code, verbatim from `TYPEQU_2025.csv`. */
export const BPE_CODE_LABELS = Object.freeze({
  D265: 'Médecin généraliste',
  B104: 'Hypermarché et grand magasin',
  B105: 'Supermarché et magasin multi-commerce',
  B201: 'Supérette',
  A206: 'Bureau de poste',
  A207: 'Relais poste',
  A208: 'Agence postale',
  F101: 'Bassin de natation',
  A104: 'Gendarmerie',
  A140: 'Police',
});

/**
 * Codes present in BPE that this layer deliberately does not draw, with the
 * measured reason. Read by the card and by the test that keeps the two in step.
 */
export const BPE_REFUSED_CODES = Object.freeze({
  D307: 'Pharmacies (20 334) — FINESS répond pour cette famille, avec une clé unique et une mise à jour mensuelle.',
  D106: 'Urgences (695) — 547 des 694 géolocalisées sont à moins de 200 m d’un hôpital FINESS déjà dessiné.',
  B326: 'Stations de recharge (28 819) — irve-fr lit le même fait en direct, sur 39 579 coordonnées.',
  C107: 'Écoles maternelles (12 563) — schools-fr dessine le registre du ministère, clé UAI.',
  C108: 'Écoles primaires (21 450) — schools-fr dessine le registre du ministère, clé UAI.',
  C109: 'Écoles élémentaires (14 648) — schools-fr dessine le registre du ministère, clé UAI.',
  C201: 'Collèges (7 532) — schools-fr dessine le registre du ministère, clé UAI.',
  C301: 'Lycées généraux et technologiques (2 815) — schools-fr.',
  C501: 'UFR (699) — sup-fr dessine 6 914 sites d’enseignement supérieur.',
  E107: 'Gares d’intérêt national (114) — transit-fr.',
  E102: 'Aéroports (89) — local-airports.',
});

/** DOM codes refused wholesale, with the row count measured over the file. */
export const BPE_REFUSED_DOMAINS = Object.freeze({
  C: { rows: 79_743, why: 'Enseignement — schools-fr (68 158 établissements ouverts et géolocalisés) et sup-fr (6 914 sites). La BPE ne porte aucune colonne UAI.' },
  E: { rows: 99_280, why: 'Transports — 96 253 des 99 280 lignes sont des adresses d’exploitants de taxis et VTC ; les gares et aéroports appartiennent à transit-fr et local-airports.' },
});

// --- FINESS selection -------------------------------------------------------

/** `categetab` of an officine. 20 003 rows. */
export const FINESS_PHARMACIE_CATEG = '620';
/**
 * `categagretab` codes folded into `hopital`, with the count measured today.
 * Deliberately narrow: CHS (1 103, 1 406 rows), SSR (1 107) and soins de longue
 * durée (1 109) are hospitals in law and not the building a reader means by
 * "l'hôpital", so they stay out and the card says how many that is.
 */
export const FINESS_HOPITAL_AGGREGATES = Object.freeze({
  1101: 'Centre hospitalier régional',
  1102: 'Centre hospitalier',
  1106: 'Hôpital local',
  1110: 'Établissement de soins de courte durée',
});

// --- Position precision -----------------------------------------------------

/**
 * Four precision bands, shared by both registers so one legend covers both.
 *
 * There is no band for "invented": a row whose register admits it drew the
 * position is not given a band, it is refused. See {@link BPE_RANDOM_GEOLOC}
 * and {@link FINESS_COMMUNE_GEOCODERS}.
 */
export const AMENITY_PRECISIONS = Object.freeze(['indeterminee', 'approchee', 'voie', 'numero']);

export const AMENITY_PRECISION_LABELS = Object.freeze({
  numero: 'Numéro trouvé dans une voie sûre',
  voie: 'Position dans la voie',
  approchee: 'Voie probable',
  indeterminee: 'Précision non publiée',
});

/** `QUALITE_GEOLOC = 33` — "Voie inconnue, Position aléatoire dans la commune". */
export const BPE_RANDOM_GEOLOC = '33';
/** FINESS geocoders that place a row on its commune rather than its address. */
export const FINESS_COMMUNE_GEOCODERS = Object.freeze(['ADMIN-EXPRESS-2023']);

/**
 * Precision band for one BPE row, from INSEE's own `QUALITE_GEOLOC` modalities.
 *
 * 11 "Voie sûre, Numéro trouvé" → numero. 12 "Voie sûre, Position aléatoire
 * dans la voie" and 21 "Voie probable, Numéro trouvé" → voie: one is sure about
 * the street and vague about the number, the other the reverse, and both put
 * the dot on the right street. 22 → approchee. `_U`/`_Z` → indeterminee, which
 * is the register declining to say and NOT a bad grade — 3 632 of the 3 633
 * bassins de natation are `_Z`.
 *
 * Returns `null` for the one modality that means the coordinate was drawn at
 * random, so a caller cannot accidentally band it.
 *
 * @param {string} qualiteGeoloc
 * @returns {?string} A member of {@link AMENITY_PRECISIONS}, or null.
 */
export function bpePrecision(qualiteGeoloc) {
  const value = String(qualiteGeoloc ?? '').trim();
  if (value === BPE_RANDOM_GEOLOC) return null;
  if (value === '11') return 'numero';
  if (value === '12' || value === '21') return 'voie';
  if (value === '22') return 'approchee';
  return 'indeterminee';
}

/**
 * Precision band for one FINESS row, from the ATLASANTE geocoding score.
 *
 * The score is the third token of `sourcecoordet` and is a number for exactly
 * the 98 272 rows geocoded against the BAN or the BDADRESSE. Bands measured
 * over the whole file: ≥ 95 → 70 786 rows, 80–94 → 26 138, < 80 → 1 348.
 *
 * A guard that coerced would be a bug here: `Number('.')` is `NaN` but
 * `Number(null)` is 0, which would file an unscored row as the worst-located
 * one instead of as an unscored one. The caller refuses those rows before this
 * is reached; the `typeof` check is the second lock on the same door.
 *
 * @param {number} score
 * @returns {string} A member of {@link AMENITY_PRECISIONS}.
 */
export function finessPrecision(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'indeterminee';
  if (score >= 95) return 'numero';
  if (score >= 80) return 'voie';
  return 'approchee';
}

/** Band index, for the mesh tuple's weight slot. Higher is better located. */
export function amenityPrecisionRank(precision) {
  const index = AMENITY_PRECISIONS.indexOf(precision);
  return index < 0 ? 0 : index;
}

/** Band id from a rank, for reading a mesh tuple back. */
export function amenityPrecisionFromRank(rank) {
  return typeof rank === 'number' && rank >= 0 && rank < AMENITY_PRECISIONS.length
    ? AMENITY_PRECISIONS[rank]
    : 'indeterminee';
}

// --- Projections ------------------------------------------------------------

/** GRS80, which every French overseas CRS in FINESS is built on. */
const UTM_A = 6378137.0;
const UTM_INVF = 298.257222101;
const UTM_F = 1 / UTM_INVF;
const UTM_E2 = UTM_F * (2 - UTM_F);
const UTM_EP2 = UTM_E2 / (1 - UTM_E2);
const UTM_K0 = 0.9996;

/**
 * Transverse-Mercator (UTM) inverse on GRS80.
 *
 * WHY THIS IS HERE AND NOT BORROWED. `scripts/lib/lambert93.mjs` covers the
 * 100 278 metropolitan rows and nothing else. The remaining 2 659 are spread
 * over five UTM zones in four CRS — RGAF09/20N, RGR92/40S, RGFG95/22N,
 * RGM04/38S — plus two prefix-less WGS84 zones, 21N for Saint-Pierre-et-Miquelon
 * and 1S for Wallis-et-Futuna. Every one of those datums is GRS80 (WGS84's
 * semi-minor axis differs by 0.1 mm), so ONE inverse parameterised by zone and
 * hemisphere covers all seven — which is why they are not seven pasted
 * constants.
 *
 * Verified against the register itself rather than against a table: the CH de
 * Fleyriat's Lambert-93 pair (870262.2, 6571540.8) comes back 5.209181 /
 * 46.222286 through the borrowed inverse, and every CRS handled here lands its
 * rows inside its own territory's bounding box — Antilles −63.09…−60.84 /
 * 14.43…18.10, Guyane −54.38…−51.80 / 3.64…5.74, Réunion 55.22…55.83 /
 * −21.39…−20.87, Mayotte 45.06…45.28 / −12.99…−12.69, Saint-Pierre −56.19…−56.17
 * / 46.77…46.78, Wallis-et-Futuna −178.16…−176.18 / −14.30…−13.28.
 *
 * @param {number} x Easting in metres.
 * @param {number} y Northing in metres.
 * @param {number} zone UTM zone, 1–60.
 * @param {boolean} southern Whether the false northing of 10 000 000 applies.
 * @returns {{lon: number, lat: number}} Degrees.
 */
export function utmToWgs84(x, y, zone, southern) {
  const east = x - 500000;
  const north = southern ? y - 10000000 : y;
  const m = north / UTM_K0;
  const e1 = (1 - Math.sqrt(1 - UTM_E2)) / (1 + Math.sqrt(1 - UTM_E2));
  const mu = m / (UTM_A * (1 - UTM_E2 / 4 - (3 * UTM_E2 * UTM_E2) / 64 - (5 * UTM_E2 ** 3) / 256));
  const phi1 = mu
    + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
    + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sinPhi = Math.sin(phi1);
  const cosPhi = Math.cos(phi1);
  const tanPhi = Math.tan(phi1);
  const n1 = UTM_A / Math.sqrt(1 - UTM_E2 * sinPhi * sinPhi);
  const t1 = tanPhi * tanPhi;
  const c1 = UTM_EP2 * cosPhi * cosPhi;
  const r1 = (UTM_A * (1 - UTM_E2)) / (1 - UTM_E2 * sinPhi * sinPhi) ** 1.5;
  const d = east / (n1 * UTM_K0);
  const lat = phi1 - ((n1 * tanPhi) / r1) * ((d * d) / 2
    - ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * UTM_EP2) * d ** 4) / 24
    + ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * UTM_EP2 - 3 * c1 * c1) * d ** 6) / 720);
  const lon = (d
    - ((1 + 2 * t1 + c1) * d ** 3) / 6
    + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * UTM_EP2 + 24 * t1 * t1) * d ** 5) / 120) / cosPhi;
  return { lat: (lat * 180) / Math.PI, lon: zone * 6 - 183 + (lon * 180) / Math.PI };
}

/**
 * The CRS vocabulary FINESS actually uses, keyed on the fifth token verbatim.
 *
 * `null` means Lambert-93 and is handled by the borrowed inverse. The two
 * entries with no `EPSG:` prefix are the 18 rows a regex would have dropped.
 */
export const FINESS_CRS = Object.freeze({
  'EPSG:2154': { id: 'EPSG:2154', label: 'RGF93 / Lambert-93 (Métropole)', utm: null },
  'EPSG:5490': { id: 'EPSG:5490', label: 'RGAF09 / UTM 20N (Antilles)', utm: { zone: 20, southern: false } },
  'EPSG:2975': { id: 'EPSG:2975', label: 'RGR92 / UTM 40S (La Réunion)', utm: { zone: 40, southern: true } },
  'EPSG:2972': { id: 'EPSG:2972', label: 'RGFG95 / UTM 22N (Guyane)', utm: { zone: 22, southern: false } },
  'EPSG:4471': { id: 'EPSG:4471', label: 'RGM04 / UTM 38S (Mayotte)', utm: { zone: 38, southern: true } },
  'WGS84:21N': { id: 'WGS84 / UTM 21N', label: 'WGS84 / UTM 21N (Saint-Pierre-et-Miquelon)', utm: { zone: 21, southern: false } },
  'WGS84:1S': { id: 'WGS84 / UTM 1S', label: 'WGS84 / UTM 1S (Wallis-et-Futuna)', utm: { zone: 1, southern: true } },
});

/**
 * Read `sourcecoordet` positionally.
 *
 * `1,ATLASANTE,96,BAN,EPSG:2154 RGF93 / Lambert-93 (Métropole)` — rank,
 * provider, score, geocoder, CRS. Positional because it is correct for all
 * 102 937 rows that have a value, including the two `MAPS 06-11-2024` rows on
 * Wallis whose token positions are said to shift and do not.
 *
 * @param {string} text
 * @returns {?{rank: string, provider: string, score: ?number, geocoder: string,
 *   crsText: string, crs: ?object}}
 */
export function parseFinessSourceCoord(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const tokens = raw.split(',');
  if (tokens.length < 5) return null;
  const crsText = tokens[4].trim();
  const scoreText = tokens[2].trim();
  // `.` is the register's own "no score", and it belongs to exactly the rows
  // geocoded to a commune. Number('.') is NaN; the explicit test keeps it from
  // ever becoming a 0 that would read as "worst-located".
  const score = /^-?\d+(\.\d+)?$/.test(scoreText) ? Number(scoreText) : null;
  let crs = null;
  const epsg = /^EPSG:(\d+)/.exec(crsText);
  if (epsg) crs = FINESS_CRS[`EPSG:${epsg[1]}`] || null;
  else if (/UTM zone 21N/i.test(crsText)) crs = FINESS_CRS['WGS84:21N'];
  else if (/UTM zone 1S/i.test(crsText)) crs = FINESS_CRS['WGS84:1S'];
  return {
    rank: tokens[0].trim(),
    provider: tokens[1].trim(),
    score,
    geocoder: tokens[3].trim(),
    crsText,
    crs,
  };
}

/**
 * Unproject one FINESS row into degrees, in the CRS the row itself declares.
 *
 * @param {number} x `coordxet`, metres.
 * @param {number} y `coordyet`, metres.
 * @param {?object} crs A member of {@link FINESS_CRS}.
 * @returns {?{lon: number, lat: number}}
 */
export function finessPosition(x, y, crs) {
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (!crs) return null;
  const point = crs.utm
    ? utmToWgs84(x, y, crs.utm.zone, crs.utm.southern)
    : lambert93ToWgs84(x, y);
  if (!Number.isFinite(point.lon) || !Number.isFinite(point.lat)) return null;
  return point;
}

// --- CSV reading ------------------------------------------------------------

/**
 * Split one semicolon row and strip INSEE's surrounding quotes.
 *
 * BPE quotes every field and FINESS quotes none, so both are read through the
 * same splitter. Neither file quotes a semicolon inside a field — verified on
 * BPE by the 95-column invariant holding over all 2 921 770 rows, and on FINESS
 * by the 35-column invariant holding over all 103 032 — so a full CSV state
 * machine would be 200 lines of insurance against a case neither file contains.
 * The column-count guard below is what makes that safe rather than lucky: a row
 * with the wrong arity is skipped and counted, never parsed at an offset.
 *
 * @param {string} line
 * @returns {Array<string>}
 */
export function splitSemicolonRow(line) {
  const parts = String(line ?? '').split(';');
  for (let i = 0; i < parts.length; i += 1) {
    const value = parts[i];
    if (value.length >= 2 && value.charCodeAt(0) === 34 && value.charCodeAt(value.length - 1) === 34) {
      parts[i] = value.slice(1, -1);
    }
  }
  return parts;
}

/** Column name → index, from a header line. Strips a UTF-8 BOM if present. */
export function csvHeaderIndex(headerLine) {
  const line = String(headerLine ?? '').replace(/^﻿/, '');
  const index = Object.create(null);
  splitSemicolonRow(line).forEach((name, i) => { index[name.trim()] = i; });
  return index;
}

/** BPE's missing sentinels, which are values and not blanks. */
export function bpeValue(raw) {
  const value = String(raw ?? '').trim();
  if (!value || value === '_Z' || value === '_U') return '';
  return value;
}

/**
 * Read one BPE row into an outcome.
 *
 * Returns one of:
 *   `{ kind: 'skip' }`            — not one of the ten drawn codes
 *   `{ kind: 'refused', reason }` — a drawn code whose position is unusable
 *   `{ kind: 'site', site }`      — drawable
 *
 * @param {Array<string>} fields
 * @param {Record<string, number>} index
 * @returns {object}
 */
export function readBpeRow(fields, index) {
  if (!Array.isArray(fields) || fields.length !== BPE_COLUMN_COUNT) {
    return { kind: 'malformed', family: null };
  }
  const at = (name) => {
    const position = index[name];
    return position === undefined ? '' : String(fields[position] ?? '');
  };
  const code = at('TYPEQU').replace(/^"|"$/g, '').trim();
  const family = BPE_CODE_FAMILY[code];
  if (!family) return { kind: 'skip', family: null, code };

  const latText = at('LATITUDE').replace(/^"|"$/g, '').trim();
  const lonText = at('LONGITUDE').replace(/^"|"$/g, '').trim();
  const lat = latText ? Number(latText) : NaN;
  const lon = lonText ? Number(lonText) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { kind: 'refused', family, code, reason: 'sans-coordonnee' };
  }
  const qualiteGeoloc = at('QUALITE_GEOLOC').replace(/^"|"$/g, '').trim();
  const precision = bpePrecision(qualiteGeoloc);
  if (!precision) return { kind: 'refused', family, code, reason: 'position-aleatoire' };

  const depcom = bpeValue(at('DEPCOM').replace(/^"|"$/g, ''));
  return {
    kind: 'site',
    family,
    code,
    depcom,
    site: {
      // No stable key exists in the public file — IDEQUIP, IDSOURCE and SOU are
      // documented and not delivered, and SIRET is blank on every non-Sirene
      // equipment. The identity is therefore the tuple that is actually unique
      // on screen: register, code, and the position to five decimals.
      id: `b:${code}:${lat.toFixed(5)},${lon.toFixed(5)}`,
      family,
      register: 'bpe',
      kind: BPE_CODE_LABELS[code] || code,
      lat: Number(lat.toFixed(5)),
      lon: Number(lon.toFixed(5)),
      precision,
      name: bpeValue(at('NOMRS').replace(/^"|"$/g, '')),
      commune: bpeValue(at('LIBCOM').replace(/^"|"$/g, '')),
      depcom,
      quality: bpeValue(at('QUALITE_XY').replace(/^"|"$/g, '')),
      distance: bpeValue(at('TR_DIST_PRECISION').replace(/^"|"$/g, '')),
    },
  };
}

/**
 * Read one FINESS row into the same three outcomes as {@link readBpeRow}.
 *
 * @param {Array<string>} fields
 * @param {Record<string, number>} index
 * @returns {object}
 */
export function readFinessRow(fields, index) {
  if (!Array.isArray(fields) || fields.length !== FINESS_COLUMN_COUNT) {
    return { kind: 'malformed', family: null };
  }
  const at = (name) => {
    const position = index[name];
    return position === undefined ? '' : String(fields[position] ?? '').trim();
  };
  const categ = at('categetab');
  const aggregate = at('categagretab');
  let family = null;
  if (categ === FINESS_PHARMACIE_CATEG) family = 'pharmacie';
  else if (FINESS_HOPITAL_AGGREGATES[aggregate]) family = 'hopital';
  if (!family) return { kind: 'skip', family: null };

  const source = parseFinessSourceCoord(at('sourcecoordet'));
  if (!source || !source.crs) {
    return { kind: 'refused', family, reason: source ? 'crs-inconnu' : 'sans-coordonnee' };
  }
  if (FINESS_COMMUNE_GEOCODERS.includes(source.geocoder) || typeof source.score !== 'number') {
    // ADMIN-EXPRESS-2023 and the 19 MAPS rows are exactly the rows with no
    // score, and they sit on their commune's single point. Refusing on either
    // condition means neither half of that partition can drift open later.
    return { kind: 'refused', family, reason: 'geocode-commune' };
  }
  const xText = at('coordxet');
  const yText = at('coordyet');
  const point = finessPosition(
    xText ? Number(xText) : NaN,
    yText ? Number(yText) : NaN,
    source.crs,
  );
  if (!point) return { kind: 'refused', family, reason: 'sans-coordonnee' };

  const id = at('nofinesset');
  return {
    kind: 'site',
    family,
    site: {
      id: `f:${id}`,
      family,
      register: 'finess',
      finess: id,
      kind: at('libcategetab') || FINESS_HOPITAL_AGGREGATES[aggregate] || '',
      lat: Number(point.lat.toFixed(5)),
      lon: Number(point.lon.toFixed(5)),
      precision: finessPrecision(source.score),
      name: at('rs'),
      longName: at('rslongue'),
      commune: at('ligneacheminement'),
      depcom: '',
      crs: source.crs.label,
      geocoder: source.geocoder,
      score: source.score,
      uai: at('numuai'),
      updated: at('datemaj_geoloc'),
    },
  };
}

// --- Edition discovery ------------------------------------------------------

/**
 * The INSEE landing page for the current edition, from INSEE's own data.gouv
 * entry. Measured today: exactly one resource, whose `url` is the landing page
 * and whose `filesize` is null — there is no data.gouv-hosted mirror.
 *
 * @param {object} dataset The data.gouv dataset document.
 * @returns {?string}
 */
export function bpeLandingFromDataset(dataset) {
  const resources = Array.isArray(dataset?.resources) ? dataset.resources : [];
  for (const resource of resources) {
    const url = String(resource?.url ?? '');
    if (/^https:\/\/www\.insee\.fr\/fr\/statistiques\/\d+/.test(url)) return url;
  }
  return null;
}

/** Sub-page ids listed by a BPE landing page. Measured: four of them. */
export function bpeSubPagesFromHtml(html) {
  const found = new Set();
  const pattern = /href="\/fr\/statistiques\/(\d+)\?sommaire=(\d+)"/g;
  let match = pattern.exec(String(html ?? ''));
  while (match) {
    found.add(match[1]);
    match = pattern.exec(String(html ?? ''));
  }
  return [...found];
}

/**
 * The geolocated archive advertised by one BPE sub-page, with its edition.
 *
 * Floored: an edition older than {@link BPE_EDITION_FLOOR} is a malformed
 * answer, not a new fact, and is reported as such rather than downloaded.
 *
 * @param {string} html
 * @returns {?{path: string, edition: number}}
 */
export function bpeArchiveFromHtml(html) {
  const match = /\/fr\/statistiques\/fichier\/(\d+)\/BPE(\d{2})\.zip/.exec(String(html ?? ''));
  if (!match) return null;
  const edition = Number(match[2]);
  if (!Number.isFinite(edition)) return null;
  return { path: `/fr/statistiques/fichier/${match[1]}/BPE${match[2]}.zip`, edition };
}

/**
 * Pick the newest archive among the sub-pages, refusing anything older than the
 * floor.
 *
 * @param {Array<?{path: string, edition: number}>} candidates
 * @param {number} [floor]
 * @returns {?{path: string, edition: number, url: string, year: number}}
 */
export function newestBpeArchive(candidates, floor = BPE_EDITION_FLOOR) {
  let best = null;
  for (const candidate of candidates || []) {
    if (!candidate || typeof candidate.edition !== 'number') continue;
    if (candidate.edition < floor) continue;
    if (!best || candidate.edition > best.edition) best = candidate;
  }
  if (!best) return null;
  return {
    ...best,
    url: `https://www.insee.fr${best.path}`,
    year: 2000 + best.edition,
  };
}

// --- Accumulator ------------------------------------------------------------

/**
 * A fresh tally for one national fold.
 *
 * Kept as a plain object rather than as counters inside the proxy so the
 * arithmetic that decides what the card says is testable without a server.
 */
export function newAmenityTally() {
  const zeroByFamily = () => Object.fromEntries(AMENITY_FAMILIES.map((family) => [family, 0]));
  return {
    scanned: 0,
    malformed: 0,
    drawn: zeroByFamily(),
    refusedNoCoordinate: zeroByFamily(),
    refusedInvented: zeroByFamily(),
    refusedCrs: zeroByFamily(),
    precision: Object.fromEntries(AMENITY_PRECISIONS.map((band) => [band, 0])),
  };
}

/** Fold one `readBpeRow`/`readFinessRow` outcome into a tally. */
export function tallyAmenityOutcome(tally, outcome) {
  if (!tally || !outcome) return tally;
  tally.scanned += 1;
  if (outcome.kind === 'malformed') {
    tally.malformed += 1;
    return tally;
  }
  if (outcome.kind === 'skip' || !outcome.family) return tally;
  if (outcome.kind === 'refused') {
    if (outcome.reason === 'sans-coordonnee') tally.refusedNoCoordinate[outcome.family] += 1;
    else if (outcome.reason === 'crs-inconnu') tally.refusedCrs[outcome.family] += 1;
    else tally.refusedInvented[outcome.family] += 1;
    return tally;
  }
  tally.drawn[outcome.family] += 1;
  tally.precision[outcome.site.precision] += 1;
  return tally;
}

/** Sum of one per-family record. */
export function sumByFamily(record) {
  let total = 0;
  for (const family of AMENITY_FAMILIES) total += Number(record?.[family]) || 0;
  return total;
}

/**
 * Order the sites of one viewport for the wire.
 *
 * RAREST FAMILY FIRST, then best-located first. That ordering is the whole
 * defence against the render cap: a 0.35° box over Paris holds 13 735 amenities
 * of which 6 991 are GPs and 267 are hospitals, so a cap applied to an
 * arbitrary order would drop hospitals — the family a reader is most likely to
 * be looking for — while keeping thousands of interchangeable GP dots. Sorted
 * this way, a truncated view loses only the most numerous family, and the count
 * of what was lost is reported.
 *
 * @param {Array<object>} sites
 * @returns {Array<object>}
 */
export function orderAmenitySites(sites) {
  const rows = Array.isArray(sites) ? [...sites] : [];
  const rank = new Map(AMENITY_FAMILIES.map((family, i) => [family, i]));
  rows.sort((a, b) => {
    const familyDelta = (rank.get(b.family) ?? -1) - (rank.get(a.family) ?? -1);
    if (familyDelta) return familyDelta;
    const precisionDelta = amenityPrecisionRank(b.precision) - amenityPrecisionRank(a.precision);
    if (precisionDelta) return precisionDelta;
    if (a.lat !== b.lat) return a.lat - b.lat;
    return a.lon - b.lon;
  });
  return rows;
}

/** Whether a site falls inside a box (edges count). */
export function amenitySiteInBox(site, box) {
  if (!site || !box) return false;
  return site.lat >= box.south && site.lat <= box.north
    && site.lon >= box.west && site.lon <= box.east;
}

// --- Collapsing to the unit that is actually on screen -----------------------

/**
 * How many co-located names one card prints before summarising the rest.
 *
 * Four, and it is not a round number: the largest cluster in the register is
 * **146 médecins généralistes at 48.83801, 2.34276** and a card that printed
 * them would be taller than the globe.
 */
export const AMENITY_CARD_NAME_LIMIT = 4;

/**
 * Collapse register rows onto the unit a reader can actually see: one dot per
 * (famille, position).
 *
 * WHY THIS EXISTS, with the measurement that forces it. Neither register
 * publishes one row per building. BPE has **no per-equipment key at all** —
 * IDEQUIP, IDSOURCE and SOU are documented in `BPE25_dessin_fichier.csv` and
 * are not among the 95 delivered columns, and SIRET is blank on every
 * non-Sirene equipment — so a row is only identifiable by what it is and where
 * it is. And rows pile up: **60 270 médecins généralistes occupy 30 215
 * distinct coordinates**, 12 084 of which hold more than one, up to 146 at a
 * single address in the 14e arrondissement of Paris. Drawing a dot per row
 * would draw one dot and claim it 146 times.
 *
 * So the drawn unit is the position, and the multiplicity moves onto the card,
 * where it is a fact instead of an invisible overdraw: 126 859 rows become
 * **95 406 dots**. Families are never merged into each other — 1 137 positions
 * carry two different families, and a pharmacy inside a supermarket is two
 * things, so those stay as two stacked dots.
 *
 * The surviving precision is the BEST among the merged rows, because the
 * position drawn is one the register did give at that quality; the worst would
 * understate a coordinate that is genuinely a street number.
 *
 * @param {Array<object>} sites Site objects from `readBpeRow`/`readFinessRow`.
 * @returns {Array<object>} One record per (famille, position).
 */
export function foldAmenitySites(sites) {
  const byPosition = new Map();
  for (const site of Array.isArray(sites) ? sites : []) {
    if (!site || typeof site.lat !== 'number' || typeof site.lon !== 'number') continue;
    const familyIndex = amenityFamilyIndex(site.family);
    if (familyIndex < 0) continue;
    const key = `a:${familyIndex}:${site.lat.toFixed(5)},${site.lon.toFixed(5)}`;
    const existing = byPosition.get(key);
    if (!existing) {
      byPosition.set(key, {
        id: key,
        family: site.family,
        register: site.register,
        lat: site.lat,
        lon: site.lon,
        precision: site.precision,
        count: 1,
        names: site.name ? [site.name] : [],
        unnamed: site.name ? 0 : 1,
        kinds: site.kind ? [site.kind] : [],
        commune: site.commune || '',
        depcom: site.depcom || '',
        finess: site.finess ? [site.finess] : [],
        uai: site.uai || '',
        score: typeof site.score === 'number' ? site.score : null,
        crs: site.crs || '',
        geocoder: site.geocoder || '',
        quality: site.quality || '',
        distance: site.distance || '',
        updated: site.updated || '',
      });
      continue;
    }
    existing.count += 1;
    if (site.name) {
      if (!existing.names.includes(site.name)) existing.names.push(site.name);
    } else existing.unnamed += 1;
    if (site.kind && !existing.kinds.includes(site.kind)) existing.kinds.push(site.kind);
    if (site.finess && !existing.finess.includes(site.finess)) existing.finess.push(site.finess);
    if (!existing.commune && site.commune) existing.commune = site.commune;
    if (!existing.uai && site.uai) existing.uai = site.uai;
    if (typeof site.score === 'number' && (existing.score === null || site.score > existing.score)) {
      existing.score = site.score;
    }
    if (amenityPrecisionRank(site.precision) > amenityPrecisionRank(existing.precision)) {
      existing.precision = site.precision;
    }
  }
  return [...byPosition.values()];
}

/**
 * Trim a folded record for the wire: names capped, arrays only where they say
 * something. The remainder is COUNTED, never dropped silently.
 *
 * @param {object} record
 * @returns {object}
 */
export function trimAmenityRecord(record) {
  const names = Array.isArray(record?.names) ? record.names : [];
  const trimmed = {
    id: record.id,
    family: record.family,
    register: record.register,
    lat: record.lat,
    lon: record.lon,
    precision: record.precision,
    count: record.count,
    names: names.slice(0, AMENITY_CARD_NAME_LIMIT),
    moreNames: Math.max(0, names.length - AMENITY_CARD_NAME_LIMIT),
    unnamed: record.unnamed || 0,
    kinds: record.kinds || [],
    commune: record.commune || '',
  };
  if (record.finess?.length) trimmed.finess = record.finess.slice(0, AMENITY_CARD_NAME_LIMIT);
  if (record.uai) trimmed.uai = record.uai;
  if (typeof record.score === 'number') trimmed.score = record.score;
  if (record.crs) trimmed.crs = record.crs;
  if (record.geocoder) trimmed.geocoder = record.geocoder;
  if (record.quality) trimmed.quality = record.quality;
  if (record.distance) trimmed.distance = record.distance;
  if (record.updated) trimmed.updated = record.updated;
  return trimmed;
}

/**
 * The national mesh document: `[lat, lon, precisionRank, familyIndex]`, sorted
 * south-to-north then west-to-east.
 *
 * The sort is not cosmetic. Measured on the real 95 406 tuples the sorted
 * document gzips to **640 980 bytes against 679 314 unsorted** — neighbouring
 * amenities share leading digits, so one sort returns 5.6% of the wire for the
 * cost of one comparison per row.
 *
 * @param {Array<object>} records Folded records.
 * @returns {Array<Array<number>>}
 */
export function buildAmenityMeshRows(records) {
  const rows = [];
  for (const record of Array.isArray(records) ? records : []) {
    if (typeof record?.lat !== 'number' || typeof record?.lon !== 'number') continue;
    const familyIndex = amenityFamilyIndex(record.family);
    if (familyIndex < 0) continue;
    rows.push([record.lat, record.lon, amenityPrecisionRank(record.precision), familyIndex]);
  }
  rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return rows;
}
