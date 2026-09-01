/**
 * @module schoolsFeed
 *
 * The seam between the Annuaire de l'éducation's records and what the browser
 * is served for one viewport.
 *
 * Lives here rather than inside `vite.config.js` for the same reason
 * `irveFeed.js` does: the register is assembled from every académie's own
 * référentiel, and the fields disagree with themselves in ways only a test
 * against a real captured payload keeps honest. The dev-server proxy imports
 * `projectSchoolSites`; nothing in the browser bundle does.
 *
 * ── What the dataset IS ─────────────────────────────────────────────────────
 * `fr-en-annuaire-education` — the MENJ's own **Annuaire de l'éducation**,
 * published on data.education.gouv.fr under **Licence Ouverte 2.0**, rebuilt
 * daily (`modified` observed moving to 2026-09-01 during this work). One row
 * per UAI — the *unité administrative immatriculée*, the State's identifier
 * for an establishment. Measured 2026-09-01: **68 939 rows**, of which
 * **68 557** are `etat = OUVERT` and **68 158** are both open and carry a
 * coordinate.
 *
 * ── What it is NOT ──────────────────────────────────────────────────────────
 * It is not a roll. Nothing in these 68 939 rows says how many pupils are in a
 * school — that lives in four separate per-level datasets, joined here on the
 * UAI (see `SCHOOLS_ROLL_DATASETS`). So a site with no roll is drawn at the
 * base size and says "effectif non publié", never zero: an establishment
 * missing from the roll files is not an empty school.
 *
 * ── Trap 1: a UAI is not a building ─────────────────────────────────────────
 * The register's unit is administrative, and several UAIs routinely share one
 * physical site. Measured against the rentrée-2025 roll files: of the 5 235
 * open teaching establishments with no roll, **2 212 are SECTIONS** — 1 462
 * `SECTION ENSEIGNT GEN. ET PROF. ADAPTE` (SEGPA) and 750 `SECTION D
 * ENSEIGNEMENT PROFESSIONNEL` (SEP) — sub-UAIs whose pupils are already
 * counted inside the collège or lycée they sit in, at the same coordinate.
 *
 * They are kept and drawn, because they are real establishments with real
 * addresses and the register is what this layer draws. But `motherUai` travels
 * with every site that has one, so a reader who sees two dots at one address
 * can see why, and so a future roll-up can fold them without re-deriving it.
 *
 * ── Trap 2: the coordinate has a published quality, and it is not uniform ───
 * `precision_localisation` is the register's own account of how well it
 * geocoded each row, and it is worth surfacing rather than flattening.
 * Measured over the full file: 50 874 at `Numéro de rue`, 10 139 at `Rue`,
 * 3 600 `PLAQUE_ADRESSE`, **2 159 at `Ville` — the commune centroid, not the
 * school** — plus a long tail of 18 further spellings from the académies'
 * various pipelines (`Parfaite`, `BATIMENT`, `CENTRE_PARCELLE`, `MANUEL`,
 * `NE SAIT PAS`…). They are folded onto a four-step ladder here, and a site
 * geocoded only to its commune says so on its card.
 *
 * ── Trap 3: 399 open establishments have no coordinate at all ───────────────
 * Measured: `position IS NULL` on 399 rows, every one of them `OUVERT`. They
 * are dropped at the query, not placed at their commune's centroid — an
 * invented coordinate is indistinguishable from a real one once it is a dot,
 * and the layer would be silently claiming to know where 399 schools are.
 * The count is carried to the client so the shortfall is stated, not hidden.
 *
 * ── Trap 4: the booleans are 1 / 0 / null, and null is not false ────────────
 * `restauration`, `hebergement`, `ulis`, `segpa` and the section flags publish
 * `1`, `0` and `null`, where null means "not declared" rather than "no". A
 * plain coercion turns every undeclared school into one with no canteen. They
 * are read to `true` / `false` / `null` and the card omits what was never
 * declared instead of denying it.
 *
 * ── Trap 5: `type_etablissement` conflates and mis-sorts ────────────────────
 * The field has 8 values and one of them, `Ecole` (48 727), covers both
 * maternelle (12 264 by `libelle_nature`) and élémentaire (36 188). Splitting
 * the colour ladder there was rejected: a school can be BOTH — the annuaire's
 * own `ecole_maternelle` and `ecole_elementaire` flags are independently set,
 * and a primaire has both — so a maternelle/élémentaire colour would have to
 * invent a rule for the most common case. The ladder is therefore by SCHOOL
 * LEVEL, five bands, and the maternelle/élémentaire detail rides on the card
 * where it can be stated without being forced into one colour.
 *
 * The other conflation is at the far end: `Service Administratif` (1 960
 * rectorats and DSDEN), `Information et orientation` (424 CIO) and `Autre`
 * (372) are in the register but are not schools. They are kept — the layer
 * draws the register, and dropping 2 756 rows would be a silent editorial
 * decision — and given their own band so the legend names them instead of
 * letting them pass as schools.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
 */

/** Opendatasoft dataset id backing this layer. */
export const SCHOOLS_DATASET = 'fr-en-annuaire-education';
/** Portal host. Both the viewport query and the national pack read it. */
export const SCHOOLS_PORTAL = 'data.education.gouv.fr';
/** Attribution string carried on every payload (see DATA_SOURCES.md). */
export const SCHOOLS_SOURCE = 'Annuaire de l’éducation — MENJ (data.education.gouv.fr)';

/**
 * The four per-level roll datasets, joined to the register on the UAI.
 *
 * There is no single "pupils per establishment" file. Each level publishes its
 * own, under its own key name for the same UAI (`numero_ecole`,
 * `numero_college`, `numero_lycee`) and its own name for the same total. All
 * four are read at rentrée 2025, the newest common year.
 *
 * Measured join against the 62 918 open, geolocated TEACHING establishments:
 * **57 683 get a roll (91.7%)**. The 5 235 that do not are named in Trap 1
 * above — mostly sub-UAI sections, plus 455 under the ministry of Agriculture,
 * which publishes its rolls elsewhere and is out of this file's scope.
 */
export const SCHOOLS_ROLL_DATASETS = Object.freeze([
  Object.freeze({ dataset: 'fr-en-ecoles-effectifs-nb_classes', key: 'numero_ecole', total: 'nombre_total_eleves' }),
  Object.freeze({ dataset: 'fr-en-college-effectifs-niveau-sexe-lv', key: 'numero_college', total: 'nombre_eleves_total' }),
  Object.freeze({ dataset: 'fr-en-lycee_gt-effectifs-niveau-sexe-lv', key: 'numero_lycee', total: 'nombre_d_eleves' }),
  Object.freeze({ dataset: 'fr-en-lycee_pro-effectifs-niveau-sexe-lv', key: 'numero_lycee', total: 'nombre_d_eleves' }),
]);

/** Rentrée the roll join reads. The newest published by all four levels. */
export const SCHOOLS_ROLL_YEAR = 2025;

/**
 * Largest viewport this source will answer, in degrees (~39 km).
 *
 * Set by the densest real box rather than by taste: 0.35° over Paris is
 * **5 506 establishments, 3.26 MB and 0.57 s** upstream (measured). Wider is a
 * regional view where a per-site dot means nothing, and it is refused rather
 * than quietly cropped — the maillage regime answers there instead. The same
 * ceiling as the charge-point layer, for the same reason and at a fifth of the
 * row count.
 */
export const SCHOOLS_MAX_BOX_DEG = 0.35;
/**
 * Outward snap grid (~2.2 km) — neighbouring viewports quantize onto the SAME
 * box, so panning a few streets re-uses the cached answer, and the snap only
 * ever GROWS the box so a cached answer always covers what was asked for.
 */
export const SCHOOLS_BOX_STEP_DEG = 0.02;

/**
 * Fields pulled for one viewport.
 *
 * Deliberately not `select=*`: the register has 71 columns, most of them
 * per-section booleans and administrative codes that no surface here reads,
 * and asking for all of them tripled the upstream payload for nothing.
 */
export const SCHOOLS_SITE_FIELDS = Object.freeze([
  'identifiant_de_l_etablissement',
  'nom_etablissement',
  'type_etablissement',
  'libelle_nature',
  'statut_public_prive',
  'adresse_1',
  'adresse_3',
  'nom_commune',
  'code_departement',
  'libelle_departement',
  'appartenance_education_prioritaire',
  'ecole_maternelle',
  'ecole_elementaire',
  'restauration',
  'hebergement',
  'ulis',
  'segpa',
  'apprentissage',
  'etablissement_mere',
  'ministere_tutelle',
  'web',
  'precision_localisation',
  'latitude',
  'longitude',
]);

/**
 * The colour ladder: five bands, ordered youngest-and-most-common first.
 *
 * The order is load-bearing in one specific place. `cellRepresentative` in
 * `geoMeshThinning.js` breaks a tie between two equally common categories
 * toward the LOWER index, so the low end must be the reading that over-claims
 * nothing. `ecole` is both the youngest level and 71% of the file, so a tie
 * resolving to it is the conservative answer.
 */
export const SCHOOL_LEVELS = Object.freeze(['ecole', 'college', 'lycee', 'adapte', 'autre']);

export const SCHOOL_LEVEL_LABELS = Object.freeze({
  ecole: 'École',
  college: 'Collège',
  lycee: 'Lycée',
  adapte: 'Adapté & médico-social',
  autre: 'Administratif & orientation',
});

/** Index of a level in the ladder, for the mesh tuple. */
export const SCHOOL_LEVEL_INDEX = Object.freeze(
  Object.fromEntries(SCHOOL_LEVELS.map((level, index) => [level, index])),
);

/**
 * `type_etablissement` → band.
 *
 * `EREA` (80 rows) joins `Médico-social` (2 312) rather than standing alone:
 * both are adapted schooling, 80 dots is not a legend row anyone can find, and
 * the alternative — folding EREA into `Lycée` — would state something about
 * its pupils that is not true.
 */
const TYPE_TO_LEVEL = Object.freeze({
  Ecole: 'ecole',
  'École': 'ecole',
  Collège: 'college',
  Lycée: 'lycee',
  EREA: 'adapte',
  'Médico-social': 'adapte',
  'Service Administratif': 'autre',
  'Information et orientation': 'autre',
  Autre: 'autre',
});

/**
 * The four-step geocoding-quality ladder the 22 published spellings fold onto.
 *
 * `commune` is the one that matters and the one the card names: it means the
 * dot is the town's centre point, not the school. 2 159 rows are there.
 */
export const SCHOOL_PRECISION_STEPS = Object.freeze(['adresse', 'rue', 'commune', 'inconnue']);

export const SCHOOL_PRECISION_LABELS = Object.freeze({
  adresse: 'Adresse exacte',
  rue: 'Rue',
  commune: 'Centre de la commune',
  inconnue: 'Précision non publiée',
});

/** Published spelling (upper-cased, accents stripped) → ladder step. */
const PRECISION_TO_STEP = Object.freeze({
  'NUMERO DE RUE': 'adresse',
  'NUMERO (ADRESSE)': 'adresse',
  PLAQUE_ADRESSE: 'adresse',
  BATIMENT: 'adresse',
  'ENTREE PRINCIPALE': 'adresse',
  PARFAITE: 'adresse',
  MANUEL: 'adresse',
  CENTRE_PARCELLE: 'adresse',
  CENTRE_PARCELLE_PROJETE: 'adresse',
  "CENTROIDE (D'EMPRISE)": 'adresse',
  RUE: 'rue',
  CORRECTE: 'rue',
  ZONE_ADRESSAGE: 'rue',
  INTERPOLATION: 'rue',
  'DEFAUT_DE_NUMERO': 'rue',
  'LIEU-DIT': 'rue',
  MOYENNE: 'commune',
  VILLE: 'commune',
  COMMUNE: 'commune',
  MAUVAISE: 'commune',
  'NE SAIT PAS': 'inconnue',
});

/** Strip accents and upper-case, so one spelling matches its own variants. */
export function precisionKey(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
}

/**
 * Fold a published `precision_localisation` onto the ladder.
 *
 * An unrecognised spelling resolves to `inconnue` rather than to a guessed
 * step: the académies keep adding pipelines, and a new spelling silently
 * inheriting "exact address" would be the one error this ladder exists to make
 * impossible.
 */
export function schoolPrecision(value) {
  const key = precisionKey(value);
  if (!key) return 'inconnue';
  return PRECISION_TO_STEP[key] || 'inconnue';
}

/**
 * Read one of the register's 1 / 0 / null flags.
 * @returns {?boolean} `null` when the field was never declared.
 */
export function parseSchoolFlag(value) {
  if (value === 1 || value === '1' || value === true) return true;
  if (value === 0 || value === '0' || value === false) return false;
  return null;
}

/** Band for one register row. Anything unrecognised lands in `autre`. */
export function schoolLevel(row) {
  return TYPE_TO_LEVEL[String(row?.type_etablissement || '').trim()] || 'autre';
}

/** `Public` / `Privé` / null — null is 1 984 rows that declare neither. */
export function schoolSector(row) {
  const value = String(row?.statut_public_prive || '').trim();
  if (value === 'Public') return 'public';
  if (value === 'Privé' || value === 'Prive') return 'prive';
  return null;
}

/**
 * Éducation prioritaire, as published: `REP+` (2 836), `REP` (4 847) or null
 * (61 256). Not a boolean — REP+ is a stronger designation than REP and
 * collapsing them would throw away the distinction the policy is built on.
 */
export function schoolPriorityEducation(row) {
  const value = String(row?.appartenance_education_prioritaire || '').trim();
  if (value === 'REP+') return 'REP+';
  if (value === 'REP') return 'REP';
  return null;
}

/** Finite number or null — the register publishes '' and null for absent. */
function num(value) {
  const parsed = typeof value === 'string' ? Number(value.trim()) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

/** Trimmed string or null, so empty cells never reach a card as ''. */
function str(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

/**
 * Coordinate identity, to 5 decimals (~1 m).
 *
 * Matches `meshRowId` so a site selected in the maillage regime survives the
 * handover into the exact regime and stays selected.
 */
export const SCHOOL_SITE_DECIMALS = 5;
export function schoolSiteKey(lat, lon) {
  return `${lat.toFixed(SCHOOL_SITE_DECIMALS)},${lon.toFixed(SCHOOL_SITE_DECIMALS)}`;
}

/**
 * ODSQL `where` for one box.
 *
 * `in_bbox` and not a pair of numeric predicates on `latitude`/`longitude`:
 * the register's `position` IS a real geo field here (unlike the charge-point
 * file, where it is null on every row and forced `irveFeed.js` into numeric
 * comparisons), so the indexed spatial filter is available and was measured to
 * return the identical 1 335 rows over central Paris at a fraction of the
 * scan. `etat` and `position` are constrained in the same clause so the 382
 * closed and 399 uncoordinated rows never leave the portal.
 */
export function schoolsBboxWhere(box) {
  return `in_bbox(position, ${box.south}, ${box.west}, ${box.north}, ${box.east})`
    + ' AND etat="OUVERT" AND position is not null';
}

/** The `where` the national pack and the register-wide counts share. */
export const SCHOOLS_OPEN_WHERE = 'etat="OUVERT" AND position is not null';

/**
 * Project register rows into the client payload for one viewport.
 *
 * @param {object} options
 * @param {Array<object>} options.records Rows as Opendatasoft returned them.
 * @param {Map<string, number>|object} [options.rolls] UAI → pupils.
 * @param {?number} [options.totalCount] The portal's own count for the same
 *   box, used only to prove the answer was not silently capped.
 * @param {string} [options.source]
 * @returns {{sites:Array<object>, count:number, totalCount:?number,
 *   complete:boolean, dropped:number, levels:object, source:string}}
 */
export function projectSchoolSites({
  records, rolls = null, totalCount = null, source = SCHOOLS_SOURCE,
} = {}) {
  const rows = Array.isArray(records) ? records : [];
  const roll = rolls instanceof Map
    ? rolls
    : new Map(Object.entries(rolls || {}));

  const sites = [];
  const levels = Object.fromEntries(SCHOOL_LEVELS.map((level) => [level, 0]));
  let dropped = 0;
  let pupils = 0;
  let withRoll = 0;

  for (const row of rows) {
    const lat = num(row?.latitude);
    const lon = num(row?.longitude);
    // A row that reached here without a coordinate is a query that did not
    // apply `SCHOOLS_OPEN_WHERE`; count it rather than plot it at (0, 0).
    if (lat === null || lon === null || (lat === 0 && lon === 0)) {
      dropped += 1;
      continue;
    }
    const uai = str(row?.identifiant_de_l_etablissement);
    const level = schoolLevel(row);
    const enrolled = uai && roll.has(uai) ? num(roll.get(uai)) : null;
    if (enrolled !== null) {
      withRoll += 1;
      pupils += enrolled;
    }
    levels[level] += 1;

    sites.push({
      id: uai || schoolSiteKey(lat, lon),
      uai,
      lat,
      lon,
      name: str(row?.nom_etablissement),
      level,
      nature: str(row?.libelle_nature),
      sector: schoolSector(row),
      enrolled,
      commune: str(row?.nom_commune),
      dept: str(row?.code_departement),
      deptName: str(row?.libelle_departement),
      address: str(row?.adresse_1),
      postal: str(row?.adresse_3),
      ep: schoolPriorityEducation(row),
      precision: schoolPrecision(row?.precision_localisation),
      ministry: str(row?.ministere_tutelle),
      motherUai: str(row?.etablissement_mere),
      web: str(row?.web),
      maternelle: parseSchoolFlag(row?.ecole_maternelle),
      elementaire: parseSchoolFlag(row?.ecole_elementaire),
      services: {
        restauration: parseSchoolFlag(row?.restauration),
        hebergement: parseSchoolFlag(row?.hebergement),
        ulis: parseSchoolFlag(row?.ulis),
        segpa: parseSchoolFlag(row?.segpa),
        apprentissage: parseSchoolFlag(row?.apprentissage),
      },
    });
  }

  // The portal's own count for the same box. If it exceeds what arrived, the
  // answer was capped — a failure Opendatasoft reports as HTTP 200 and which
  // would otherwise look exactly like a quiet arrondissement.
  const complete = !Number.isFinite(totalCount) || sites.length + dropped >= totalCount;

  return {
    sites,
    count: sites.length,
    totalCount: Number.isFinite(totalCount) ? totalCount : null,
    complete,
    dropped,
    levels,
    pupils,
    withRoll,
    source,
    dataset: SCHOOLS_DATASET,
  };
}
