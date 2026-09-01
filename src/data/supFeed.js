/**
 * @module supFeed
 *
 * The reading of France's HIGHER-education register — the level
 * `schoolsFeed.js` stops before.
 *
 * ── Why this layer exists at all ────────────────────────────────────────────
 * The Annuaire de l'éducation is the MENJ's register and it ends at the
 * baccalauréat. Measured against the live file 2026-09-01, its
 * `type_etablissement` has exactly eight values — Ecole, Collège, Lycée, EREA,
 * Médico-social, Service Administratif, Information et orientation, Autre —
 * and **not one of them is a university, an IUT, an école d'ingénieurs, an
 * école de commerce, an IFSI or a school of architecture**. 45 of its 68 557
 * open rows carry `ministere_tutelle = ENSEIGNEMENT SUPERIEUR`, against some
 * six thousand post-bac establishments that actually exist. `schools-fr` is
 * not missing a few rows; it is missing a whole degree of education.
 *
 * The size of the hole, measured by joining the two registers on the UAI:
 * of the 6 509 establishments the ministry's Parcoursup cartography lists for
 * the 2026 session, **3 492 appear nowhere in the Annuaire**. The 3 017 that
 * do are almost all lycées (2 800 of them) hosting a BTS or a CPGE — see
 * "Trap 3" below, because those are the dots that will sit on top of
 * `schools-fr`'s and it matters that the map says why.
 *
 * ── What the dataset IS ─────────────────────────────────────────────────────
 * `fr-esr-atlas_regional-effectifs-d-etudiants-inscrits-detail_etablissements`
 * — the MESR's own *Effectifs d'étudiants inscrits … détail par
 * établissements*, published on data.enseignementsup-recherche.gouv.fr under
 * **Licence Ouverte 2.0**. One row per (établissement × composante × degré
 * d'études). Measured at rentrée 2024, the newest published: **22 068 rows,
 * 6 294 establishments, 8 103 composantes, 3 027 462 students.**
 *
 * It is chosen over the two obvious alternatives on purpose.
 * `fr-esr-principaux-etablissements-enseignement-superieur` is the canonical
 * list and holds 245 rows — the *principaux*, which is a third of one percent
 * of the map this layer draws. `fr-esr-implantations_etablissements_d_
 * enseignement_superieur_publics` has 2 561 rows and was last modified in
 * **2017**. This one is rebuilt annually, carries the official 14-category
 * typology AND the enrolment, and is the only one that does all three.
 *
 * ── Trap 1: the register is a STATISTIC, so 1 665 of its establishments have
 *    no coordinate — and the fix is a second dataset, not a guess ────────────
 * `geo` is null on 3 442 of the 22 068 rows. Rolled up: **1 665 of the 6 294
 * establishments cannot be placed at all**, holding 130 480 students. Among
 * them are the Université de la Nouvelle-Calédonie (2 844) and the Université
 * de la Polynésie française (2 596) — two whole universities.
 *
 * They are not placed at their commune's centroid. The layer instead reads a
 * SECOND ministry file, `fr-esr-cartographie_formations_parcoursup` (session
 * 2026, Licence Ouverte 2.0, 25 831 formations, every one geolocated), and
 * borrows a coordinate ONLY where that file gives exactly one point for the
 * UAI. Measured: that is **977 establishments and 82 200 students**, lifting
 * placed enrolment from 95.69% to **98.41%**. Where Parcoursup gives several
 * points for an establishment the Atlas cannot place (119 establishments),
 * nothing is borrowed — picking one of several campuses is inventing a fact,
 * and the count is reported instead.
 *
 * The two universities above are what the rule looks like in practice: the
 * Université de la Polynésie française is recovered and appears on the map,
 * and the Université de la Nouvelle-Calédonie is NOT — Parcoursup does not
 * list New Caledonia, which runs its own admissions, so all 18 of the
 * territory's establishments stay in `unplaced` and are reported there rather
 * than invented into the Pacific.
 *
 * The borrowing is safe because it was checked rather than assumed. On the
 * 3 304 establishments where BOTH files give exactly one point, the median
 * disagreement is **74 m** and 90% agree within 1 km.
 *
 * ── Trap 2: an establishment is not a place ─────────────────────────────────
 * Aix-Marseille Université is one UAI and 59 coordinates. Drawing one dot per
 * establishment would put a 80 000-student university on a single street
 * corner; drawing one dot per row would draw the same campus seven times, once
 * per degree level. The unit here is therefore the **site** — one distinct
 * coordinate of one establishment — and the enrolment attached to it is the
 * sum over the composantes AT that coordinate, never the establishment's.
 *
 * A composante whose own `geo` is null inside an establishment that HAS other
 * coordinates is the residual case — **19 170 students, flagged on 376 of the
 * 6 914 sites** — and they are deliberately left unattributed rather than moved to the
 * establishment's largest site: pushing them there would inflate a real number
 * with an invented one. They are counted in `unsited` and stated on the card,
 * so a reader who adds the dots up and finds less than the establishment holds
 * can see the difference named.
 *
 * The register is an ENROLMENT file, which has one pleasant consequence worth
 * stating because it does not hold for `schools-fr`: a site exists here only
 * because students are counted at it, so all 6 914 of them carry a positive
 * roll. There is no "effectif non publié" case to draw, and dot size means the
 * same thing on every dot.
 *
 * ── Trap 3: 2 819 of these "establishments" are lycées ──────────────────────
 * BTS and CPGE are taught inside secondary schools, so the register's second
 * biggest category by count is `Lycées` — 2 819 establishments and 349 955
 * students, every one of which `schools-fr` already draws as a *Lycée* dot at
 * the same address. They are kept, because a map of where France's students
 * are that omitted a fifth of them would be a worse lie than a stacked dot.
 * They get their OWN band on the ladder so the legend names the overlap
 * instead of letting it look like a duplicate, and the card says which lycée.
 *
 * ── Trap 4: the roll is not a headcount of humans ───────────────────────────
 * `effectifhdccpge` is inscriptions *hors doubles comptes*, which is the
 * ministry's de-duplicated figure — a CPGE student enrolled at both a lycée
 * and a university is counted once. It is the right number and it is NOT
 * comparable to a naive sum of registrations; the card names the rentrée it
 * belongs to so it is never read as "today".
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
 */

/** Portal both datasets are published on. */
export const SUP_PORTAL = 'data.enseignementsup-recherche.gouv.fr';

/** The register: enrolment by establishment and composante. */
export const SUP_DATASET = 'fr-esr-atlas_regional-effectifs-d-etudiants-inscrits-detail_etablissements';
/** The complement: Parcoursup's geolocated cartography of the offer. */
export const SUP_OFFER_DATASET = 'fr-esr-cartographie_formations_parcoursup';

/** Attribution carried on every payload (see DATA_SOURCES.md). */
export const SUP_SOURCE = 'Effectifs d’étudiants inscrits & Cartographie Parcoursup — MESR '
  + '(data.enseignementsup-recherche.gouv.fr)';

/**
 * Oldest rentrée this layer will accept, and the one it was measured on.
 *
 * The rentrée is DISCOVERED at fetch time rather than pinned, because the
 * Atlas gains a year every spring and a hard-coded `2024` would quietly serve
 * a stale map forever. The floor is what stops the discovery going backwards:
 * if the portal answers with something older than what this file was written
 * against, that is a malformed answer and the pinned year is used instead.
 */
export const SUP_RENTREE_FLOOR = '2024';
/** Oldest Parcoursup session accepted for the coordinate complement. */
export const SUP_SESSION_FLOOR = '2026';

/**
 * Columns pulled from the register.
 *
 * Nine of its 28, and every one is read. The dataset publishes a full
 * geographic hierarchy (académie, unité urbaine, code commune) and a
 * sex breakdown that no surface here draws; asking for all of it tripled the
 * export for nothing.
 */
export const SUP_ATLAS_FIELDS = Object.freeze([
  'id_etablissement',
  'sigle_etablissement',
  'libelle_etablissement_1',
  'libelle_etablissement_2',
  'categorie_etablissement',
  'secteur_etablissement',
  'libelle_composante_1',
  'dep_id',
  'dep_num_nom',
  'com_nom',
  'geo',
  'degre_etudes',
  'effectifhdccpge',
]);

/**
 * Columns pulled from the Parcoursup cartography.
 *
 * Five of its 25. This file is read for two things only — a coordinate for the
 * establishments the register cannot place, and the list of formation types on
 * the card — so the 20 columns describing individual formations (names,
 * mentions, internal Parcoursup codes, links to each fiche) are not asked for.
 */
export const SUP_OFFER_FIELDS = Object.freeze([
  'etab_uai',
  'etab_nom',
  'tf',
  'etab_url',
  'etab_gps',
]);

/**
 * The colour ladder: seven bands, ordered by how specific a claim each makes.
 *
 * Seven and not five, and that is the whole point of this layer. The register
 * publishes **14** official categories and the request this answers is
 * precisely that the map does not have all the kinds of school there are;
 * folding them back down to four would re-create the hole. What IS folded is
 * folded on a stated rule, never on how a name sounds:
 *
 *   universite   Universités (73) + Autre établissements d'enseignement
 *                universitaire (32) + Écoles normales supérieures (4). All
 *                three award national university diplomas; 4 ENS dots is not
 *                a legend row anyone can find.
 *   lycee        Lycées (2 819) — BTS and CPGE. Kept ALONE, because this is
 *                the band that overlaps `schools-fr` and merging it into
 *                anything would hide that.
 *   ingenieur    Écoles d'ingénieurs (109) + Écoles vétérinaires (5). Common
 *                post-CPGE competitive entry; 5 dots is not a legend row.
 *   commerce     Écoles de commerce, gestion et vente (434) + Écoles
 *                juridiques et administratives (32).
 *   sante        Écoles paramédicales hors université (439) + Écoles préparant
 *                aux fonctions sociales (130). IFSI, IFAS and the social-work
 *                schools — the training the hospital and the département run.
 *   art          Écoles supérieures artistiques et culturelles (312) + Écoles
 *                d'architecture (23) + Écoles de journalisme et écoles
 *                littéraires (48).
 *   autre        Autres écoles de spécialités diverses (1 981). The register's
 *                own catch-all, mostly CFA and private training bodies. It
 *                keeps the register's name rather than being given a flattering
 *                one, because nothing here knows what is in it.
 *
 * The order is load-bearing in one place only: a site whose composantes
 * disagree about their category resolves to the LOWEST index present, so the
 * low end must be the reading that over-claims nothing about the site. A
 * campus that is partly a university IS a university campus.
 */
export const SUP_KINDS = Object.freeze([
  'universite', 'lycee', 'ingenieur', 'commerce', 'sante', 'art', 'autre',
]);

export const SUP_KIND_LABELS = Object.freeze({
  universite: 'Université',
  lycee: 'Lycée — BTS & CPGE',
  ingenieur: 'École d’ingénieurs',
  commerce: 'Commerce & gestion',
  sante: 'Santé & social',
  art: 'Art, archi & culture',
  autre: 'Autres écoles spécialisées',
});

/** Index of a band in the ladder. */
export const SUP_KIND_INDEX = Object.freeze(
  Object.fromEntries(SUP_KINDS.map((kind, index) => [kind, index])),
);

/** Published `categorie_etablissement` → band. All 14 are named. */
const CATEGORY_TO_KIND = Object.freeze({
  'Universités': 'universite',
  'Autre établissements d’enseignement universitaire': 'universite',
  "Autre établissements d'enseignement universitaire": 'universite',
  'Écoles normales supérieures': 'universite',
  'Lycées': 'lycee',
  'Écoles d’ingénieurs': 'ingenieur',
  "Écoles d'ingénieurs": 'ingenieur',
  'Écoles vétérinaires': 'ingenieur',
  'Écoles de commerce, gestion et vente': 'commerce',
  'Écoles juridiques et administratives': 'commerce',
  'Écoles paramédicales hors université': 'sante',
  'Écoles préparant aux fonctions sociales': 'sante',
  'Écoles supérieures artistiques et culturelles': 'art',
  'Écoles d’architecture': 'art',
  "Écoles d'architecture": 'art',
  'Écoles de journalisme et écoles littéraires': 'art',
  'Autres écoles de spécialités diverses': 'autre',
});

/**
 * The three LMD cycles the seven published `degre_etudes` values fold onto.
 *
 * The register counts by year (`BAC + 1` … `BAC + 6 et plus`), which is too
 * fine to read on a card and too coarse to be a diploma. The LMD split is the
 * one the French system is actually built on, so a site's mix says something —
 * a BTS lycée is all `licence`, a doctoral campus is not.
 */
export const SUP_CYCLES = Object.freeze(['licence', 'master', 'doctorat']);

export const SUP_CYCLE_LABELS = Object.freeze({
  licence: 'Licence & bac+1 à +3',
  master: 'Master — bac+4 et +5',
  doctorat: 'Doctorat — bac+6 et plus',
});

/** Published `degre_etudes` → cycle. Anything unrecognised is dropped. */
const DEGREE_TO_CYCLE = Object.freeze({
  'Inférieur ou égal au baccalauréat': 'licence',
  'BAC + 1': 'licence',
  'BAC + 2': 'licence',
  'BAC + 3': 'licence',
  'BAC + 4': 'master',
  'BAC + 5': 'master',
  'BAC + 6 et plus': 'doctorat',
});

/** How a site's coordinate was obtained. Printed on the card. */
export const SUP_PLACEMENTS = Object.freeze(['register', 'offer']);

export const SUP_PLACEMENT_LABELS = Object.freeze({
  register: 'Position publiée par le registre',
  offer: 'Position reprise de la cartographie Parcoursup',
});

/** Coordinate identity, to 5 decimals (~1 m). */
export const SUP_SITE_DECIMALS = 5;

/**
 * How many composante names ride on one site.
 *
 * Six. A card is read, not scrolled, and the tail is long for the wrong
 * reason: a big university campus lists every UFR, IUT and service at the
 * address, and the seventh line is never the one that tells a reader where
 * they are. The count is not hidden — `siteCount` and the establishment total
 * are on the same card.
 */
export const SITE_COMPOSANTE_LIMIT = 6;

/**
 * Trimmed string, or null.
 *
 * `'nan'` is refused alongside the empty string, and that is not paranoia: the
 * register is published from a pandas frame whose missing values were
 * stringified on the way out, so the literal three letters appear as DATA on
 * **3 806 rows of `libelle_etablissement_2`** (448 establishments), 29 sigles
 * and 5 composante labels. A plain trim lets them through, and the card then
 * reads "AFTRAL — nan".
 */
function str(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.toLowerCase() === 'nan') return null;
  return text;
}

/** Finite number, or null. */
function num(value) {
  const parsed = typeof value === 'string' ? Number(value.trim()) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

/** A UAI, upper-cased — the two files disagree about case on a few hundred. */
export function supUai(value) {
  const text = str(value);
  return text ? text.toUpperCase() : null;
}

/**
 * The register's own name for an establishment, from its two label columns.
 *
 * Both are needed and neither is sufficient. `libelle_etablissement_1` is a
 * TYPE far more often than a name — `LYCEE GENERAL ET TECHNOLOGIQUE` on 599
 * establishments, `ORGANISME FORMATION-CFA` on 580, and a bare `UNIVERSITE` on
 * seven of them, Sorbonne Université among those. `libelle_etablissement_2`
 * carries the distinguishing part but is truncated to 30 characters upstream
 * (`METIERS DU BATIMENT ET DE LA C`) and is the literal string `nan` on 448.
 *
 * So they are joined when the second says something the first does not, and
 * `projectSupSites` prefers Parcoursup's `etab_nom` over the result where the
 * cartography has one — same ministry, same UAI, and a name a human wrote.
 */
export function supRegisterName(row) {
  const primary = str(row?.libelle_etablissement_1);
  const secondary = str(row?.libelle_etablissement_2);
  if (!primary) return secondary;
  if (!secondary || secondary === primary) return primary;
  // The truncation makes containment the right test, not equality: `UNIVERSITE
  // PARIS 8 VINCENNES` inside `UNIVERSITE  PARIS 8 VINCENNES` is one name
  // published twice, not two facts. It runs both ways — `UNIVERSITE` plus
  // `SORBONNE UNIVERSITE` is the second name, not a hyphenation of both.
  const squash = (value) => value.replace(/\s+/g, ' ').toUpperCase();
  const a = squash(primary);
  const b = squash(secondary);
  if (a.includes(b)) return primary;
  if (b.includes(a)) return secondary;
  return `${primary} — ${secondary}`;
}

/**
 * A Parcoursup `etab_nom`, without the locality Parcoursup appends to it.
 *
 * The cartography disambiguates its own list by suffixing a commune and a
 * département — `AFTRAL - AUXERRE (Appoigny - 89)`, `Université de Brest (EPE)
 * (29)` — which is exactly the line the card prints underneath anyway. Only a
 * TRAILING parenthetical whose last token is a département code is removed, so
 * `(EPE)` survives and only the suffix goes.
 */
export function supOfferName(value) {
  const text = str(value);
  if (!text) return null;
  return str(text.replace(/\s*\([^()]*(?:\b\d{2,3}|2[AB])\)\s*$/u, '')) || text;
}

/** Band for one published category. Anything unrecognised lands in `autre`. */
export function supKind(category) {
  return CATEGORY_TO_KIND[String(category || '').trim()] || 'autre';
}

/** `public` / `prive` / null. */
export function supSector(value) {
  const text = String(value || '').trim();
  if (text === 'Public') return 'public';
  if (text === 'Privé' || text === 'Prive') return 'prive';
  return null;
}

/** LMD cycle for one published degree, or null when it is not one of the 7. */
export function supCycle(value) {
  return DEGREE_TO_CYCLE[String(value || '').trim()] || null;
}

/**
 * Read a `geo_point_2d` as `[lat, lon]`, or null.
 *
 * Opendatasoft returns `{lat, lon}` from `exports/json` and `records`, but the
 * same field arrives as `"lat, lon"` from a CSV export and as `[lon, lat]`
 * from the GeoJSON one. Only the two JSON shapes are accepted; a string is
 * refused rather than parsed, because guessing the axis order wrong puts every
 * French university in the Indian Ocean and nothing downstream would notice.
 */
export function supPoint(value) {
  if (!value || typeof value !== 'object') return null;
  const lat = num(Array.isArray(value) ? value[1] : value.lat);
  const lon = num(Array.isArray(value) ? value[0] : value.lon);
  if (lat === null || lon === null) return null;
  if (lat === 0 && lon === 0) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return [Number(lat.toFixed(SUP_SITE_DECIMALS)), Number(lon.toFixed(SUP_SITE_DECIMALS))];
}

/** Stable identity for one site: its establishment and its coordinate. */
export function supSiteKey(uai, lat, lon) {
  return `${uai || '—'}@${lat.toFixed(SUP_SITE_DECIMALS)},${lon.toFixed(SUP_SITE_DECIMALS)}`;
}

/**
 * Newest year the portal reports, refusing anything below the floor.
 *
 * @param {Array<object>} rows Grouped rows carrying `field`.
 * @param {string} field Column the grouping was on (`rentree` / `annee`).
 * @param {string} floor Oldest acceptable value, and the fallback.
 * @returns {string}
 */
export function newestYear(rows, field, floor) {
  let best = String(floor);
  for (const row of Array.isArray(rows) ? rows : []) {
    const value = str(row?.[field]);
    // String compare, not numeric: these columns are TEXT upstream, and a
    // value that is not a plain year must not win by parsing to NaN.
    if (value && /^\d{4}$/.test(value) && value > best) best = value;
  }
  return best;
}

/** The register's `where`, for one rentrée. */
export function supAtlasWhere(rentree) {
  return `rentree="${String(rentree)}"`;
}

/** The cartography's `where`, for one Parcoursup session. */
export function supOfferWhere(session) {
  return `annee="${String(session)}"`;
}

/**
 * Index the Parcoursup cartography by UAI.
 *
 * One pass, producing what the register cannot supply: the formation types on
 * offer, the establishment's own website, and — only where the file gives
 * exactly ONE point for a UAI — a coordinate to lend.
 *
 * @param {Array<object>} records Rows of `fr-esr-cartographie_formations_parcoursup`.
 * @returns {Map<string, {point:?Array<number>, points:number, offer:Array<string>, web:?string, name:?string}>}
 */
export function indexSupOffers(records) {
  /** @type {Map<string, {points:Set<string>, first:?Array<number>, offer:Set<string>, web:?string, names:Set<string>}>} */
  const draft = new Map();
  for (const row of Array.isArray(records) ? records : []) {
    const uai = supUai(row?.etab_uai);
    if (!uai) continue;
    let entry = draft.get(uai);
    if (!entry) {
      entry = { points: new Set(), first: null, offer: new Set(), web: null, names: new Set() };
      draft.set(uai, entry);
    }
    const name = supOfferName(row?.etab_nom);
    if (name) entry.names.add(name);
    entry.web = entry.web || str(row?.etab_url);
    // `tf` is an ARRAY upstream — one formation can be filed under several
    // types — and it also arrives as a single string from the CSV export.
    const types = Array.isArray(row?.tf) ? row.tf : [row?.tf];
    for (const type of types) {
      const label = str(type);
      if (label) entry.offer.add(label);
    }
    const point = supPoint(row?.etab_gps);
    if (point) {
      const key = `${point[0]},${point[1]}`;
      if (!entry.points.has(key)) {
        entry.points.add(key);
        entry.first = entry.first || point;
      }
    }
  }

  const index = new Map();
  for (const [uai, entry] of draft) {
    index.set(uai, {
      // A single point is a fact about where the establishment is. Several
      // points are a fact about how many campuses it has, and lending one of
      // them would be a guess dressed as a coordinate.
      point: entry.points.size === 1 ? entry.first : null,
      points: entry.points.size,
      offer: [...entry.offer].sort((a, b) => a.localeCompare(b, 'fr')),
      web: entry.web,
      // Same rule as the coordinate, for the same reason: 808 UAIs carry
      // SEVERAL names here, one per campus or per component, and picking
      // whichever row arrived first would put one campus's name on all of
      // them. Only an unambiguous name is lent.
      name: entry.names.size === 1 ? [...entry.names][0] : null,
      names: entry.names.size,
    });
  }
  return index;
}

/** An empty per-cycle tally. */
function emptyCycles() {
  return Object.fromEntries(SUP_CYCLES.map((cycle) => [cycle, 0]));
}

/**
 * Project the register into the national site list.
 *
 * This is the WHOLE layer's payload and not a viewport's: the register is
 * 6 294 establishments, and the finished pack — 6 914 sites, each with its
 * name, sigle, band, enrolment, cycle mix, campus count, commune, département,
 * formation list and website — measures 3.89 MB, **0.62 MB gzipped**
 * (measured off the running proxy). That is what the `schools-fr` maillage
 * costs to ship (0.63 MB gzipped) while carrying no names at all, so there is
 * no viewport query here, no bbox ceiling and no spatial thinning: the browser
 * is handed the register once and answers every zoom from it. The three-regime
 * ladder those files needed is a response to 68 158 rows, and this is not that
 * problem.
 *
 * @param {object} options
 * @param {Array<object>} options.records Rows of the Atlas, one rentrée.
 * @param {Map<string, object>} [options.offers] From `indexSupOffers`.
 * @param {string} [options.rentree]
 * @param {string} [options.session]
 * @param {?number} [options.totalCount] The portal's own count for the same
 *   `where`, used only to prove the export was not silently short.
 * @param {string} [options.source]
 * @returns {object} `{sites, count, establishments, students, …}`
 */
export function projectSupSites({
  records,
  offers = null,
  rentree = SUP_RENTREE_FLOOR,
  session = SUP_SESSION_FLOOR,
  totalCount = null,
  source = SUP_SOURCE,
} = {}) {
  const rows = Array.isArray(records) ? records : [];
  const offerIndex = offers instanceof Map ? offers : new Map(Object.entries(offers || {}));

  /**
   * establishment → { points: Map<key, siteDraft>, … }
   * @type {Map<string, object>}
   */
  const etabs = new Map();
  let swept = 0;

  for (const row of rows) {
    const uai = supUai(row?.id_etablissement);
    if (!uai) continue;
    swept += 1;

    let etab = etabs.get(uai);
    if (!etab) {
      etab = {
        uai,
        name: null,
        sigle: null,
        sector: null,
        category: null,
        points: new Map(),
        students: 0,
        unsited: 0,
        cycles: emptyCycles(),
        commune: null,
        dept: null,
        deptName: null,
      };
      etabs.set(uai, etab);
    }
    etab.name = etab.name || supRegisterName(row);
    etab.sigle = etab.sigle || str(row?.sigle_etablissement);
    etab.sector = etab.sector || supSector(row?.secteur_etablissement);
    etab.category = etab.category || str(row?.categorie_etablissement);
    // Read OUTSIDE the coordinate branch below. The register names the commune
    // and the département on every row, including the 3 442 that carry no
    // `geo` — so an establishment placed from the cartography instead still
    // knows where it is administratively, and the 46 overseas sites that reach
    // the national rollup that way can be named rather than counted as `—`.
    etab.commune = etab.commune || str(row?.com_nom);
    etab.dept = etab.dept || str(row?.dep_id);
    etab.deptName = etab.deptName || str(row?.dep_num_nom);

    const students = num(row?.effectifhdccpge) || 0;
    const cycle = supCycle(row?.degre_etudes);
    etab.students += students;
    if (cycle) etab.cycles[cycle] += students;

    const point = supPoint(row?.geo);
    if (!point) {
      // A composante with no coordinate inside an establishment that has
      // others. Its students are NOT moved onto a sibling site — see Trap 2.
      etab.unsited += students;
      continue;
    }
    const key = `${point[0]},${point[1]}`;
    let site = etab.points.get(key);
    if (!site) {
      site = {
        lat: point[0],
        lon: point[1],
        students: 0,
        cycles: emptyCycles(),
        categories: new Set(),
        composantes: new Set(),
        commune: null,
        dept: null,
        deptName: null,
      };
      etab.points.set(key, site);
    }
    site.students += students;
    if (cycle) site.cycles[cycle] += students;
    if (row?.categorie_etablissement) site.categories.add(String(row.categorie_etablissement).trim());
    const composante = str(row?.libelle_composante_1);
    if (composante && composante !== etab.name) site.composantes.add(composante);
    site.commune = site.commune || str(row?.com_nom);
    site.dept = site.dept || str(row?.dep_id);
    site.deptName = site.deptName || str(row?.dep_num_nom);
  }

  const sites = [];
  const kinds = Object.fromEntries(SUP_KINDS.map((kind) => [kind, 0]));
  let borrowed = 0;
  let borrowedStudents = 0;
  let unplaced = 0;
  let unplacedStudents = 0;
  let unsitedStudents = 0;
  let studentsOnMap = 0;

  for (const etab of etabs.values()) {
    const offer = offerIndex.get(etab.uai) || null;
    let placement = 'register';
    let points = [...etab.points.values()];
    // Students this establishment counts but cannot put anywhere. Zero on the
    // borrowed path below, where the single site absorbs the whole roll by
    // construction — reporting them there would tell a reader that the dot
    // they are looking at is missing the students it is drawn from.
    let unsited = etab.unsited;

    if (!points.length) {
      // Nothing in the register places this establishment. Borrow a
      // coordinate only where the cartography gives exactly one.
      if (!offer?.point) {
        unplaced += 1;
        unplacedStudents += etab.students;
        continue;
      }
      placement = 'offer';
      borrowed += 1;
      borrowedStudents += etab.students;
      unsited = 0;
      points = [{
        lat: offer.point[0],
        lon: offer.point[1],
        // The establishment has ONE site here, so its whole roll belongs to
        // it — this is the one case where the two numbers coincide, and it is
        // an identity rather than an attribution.
        students: etab.students,
        cycles: { ...etab.cycles },
        categories: new Set(etab.category ? [etab.category] : []),
        composantes: new Set(),
        commune: null,
        dept: null,
        deptName: null,
      }];
    } else {
      unsitedStudents += etab.unsited;
    }

    const siteCount = points.length;
    points.sort((a, b) => b.students - a.students || a.lat - b.lat || a.lon - b.lon);

    points.forEach((site, index) => {
      // A site whose composantes disagree resolves to the lowest band on the
      // ladder present there — see the SUP_KINDS header.
      const categories = site.categories.size
        ? [...site.categories]
        : [etab.category].filter(Boolean);
      let kind = 'autre';
      let rank = SUP_KINDS.length;
      for (const category of categories) {
        const candidate = supKind(category);
        const candidateRank = SUP_KIND_INDEX[candidate];
        if (candidateRank < rank) {
          rank = candidateRank;
          kind = candidate;
        }
      }
      kinds[kind] += 1;
      studentsOnMap += site.students;

      sites.push({
        id: supSiteKey(etab.uai, site.lat, site.lon),
        uai: etab.uai,
        // Parcoursup's name first, and the register's second. Both are MESR
        // files keyed on the same UAI, and the cartography's is the one a
        // human wrote: it says "Sorbonne Université" where the register says
        // "UNIVERSITE". 4 825 of the 6 294 establishments have one.
        name: offer?.name || etab.name,
        sigle: etab.sigle,
        kind,
        category: categories.length === 1 ? categories[0] : (etab.category || null),
        sector: etab.sector,
        lat: site.lat,
        lon: site.lon,
        students: site.students > 0 ? site.students : null,
        cycles: site.cycles,
        commune: site.commune || etab.commune,
        dept: site.dept || etab.dept,
        deptName: site.deptName || etab.deptName,
        composantes: [...site.composantes].sort((a, b) => a.localeCompare(b, 'fr')).slice(0, SITE_COMPOSANTE_LIMIT),
        // `siteCount` travels with every dot so a reader who sees eleven
        // Sorbonne dots can tell that is one university, not eleven.
        siteCount,
        siteIndex: index + 1,
        etabStudents: etab.students,
        // Students in composantes this establishment could not place. Non-zero
        // means the dots here add up to less than the establishment does.
        unsited,
        placement,
        offer: offer?.offer?.length ? offer.offer : null,
        web: offer?.web || null,
      });
    });
  }

  sites.sort((a, b) => (b.students || 0) - (a.students || 0) || a.id.localeCompare(b.id));

  // The portal's own count for the same `where`. A short export is the one
  // failure Opendatasoft streams as HTTP 200, and it looks exactly like a
  // smaller country.
  const complete = !Number.isFinite(totalCount) || swept >= totalCount;

  return {
    sites,
    count: sites.length,
    establishments: etabs.size,
    placed: etabs.size - unplaced,
    students: studentsOnMap,
    studentsTotal: studentsOnMap + unplacedStudents + unsitedStudents,
    kinds,
    borrowed,
    borrowedStudents,
    unplaced,
    unplacedStudents,
    unsitedStudents,
    rowsSwept: swept,
    rowsTotal: Number.isFinite(totalCount) ? totalCount : null,
    complete,
    rentree,
    session,
    dataset: SUP_DATASET,
    offerDataset: SUP_OFFER_DATASET,
    source,
  };
}
