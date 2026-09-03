/**
 * @module anfrFeed
 *
 * The reading of France's register of radio installations above 5 watts — and
 * of the one thing the register is really about, which is WHICH GENERATION
 * TRANSMITS FROM WHICH MAST.
 *
 * NAME COLLISION, NOT DATA COLLISION. This repo already has a layer called
 * `radio`. That one is `radio-browser.info` — internet audio streams, keyed by
 * a station UUID, played through an `HTMLAudioElement`. This one is physical
 * masts keyed by ANFR's `SUP_ID`. The two share a shelf in the panel and
 * nothing else: no field, no identifier, no upstream.
 *
 * ── Why the pre-joined mirror and not the canonical bulk file ────────────────
 * ANFR publishes the same facts twice. The canonical file is data.gouv
 * `551d4ff3c751df55da0cd89f` — measured 2026-09-01: HTTP 200, 453 875 bytes of
 * metadata, 276 resources, licence `lov2`, monthly, `last_update`
 * 2026-08-24T08:19:37+00:00, org *Agence nationale des fréquences* with badges
 * `public-service` and `certified`. Its newest data resource is a 66 019 086-byte
 * zip that expands to five semicolon tables, and getting a generation out of it
 * means joining SUP_SUPPORT → SUP_ANTENNE → SUP_EMETTEUR on the COMPOSITE key
 * `(STA_NM_ANFR, AER_ID)` and then classifying 68 distinct `EMR_LB_SYSTEME`
 * strings by prefix.
 *
 * That last step is where everybody gets it wrong, and it is the reason this
 * module does not do it. `GSM R` starts with `GSM`; `LTE 700 P` and
 * `LTE 2600 P` are the Réseau Radio du Futur, not a consumer network; four
 * labels end in `Expe`. A prefix rule sweeps all of them into "mobile" and
 * inflates the count by several thousand masts that are railway and
 * emergency-services infrastructure.
 *
 * The mirror has already done that exclusion, and the proof is a count: over
 * the whole 826 418-row observatoire this module measured **exactly 13 distinct
 * `emr_lb_systeme` values** — LTE 700 · LTE 1800 · UMTS 900 · LTE 800 ·
 * LTE 2100 · LTE 2600 · 5G NR 3500 · GSM 900 · 5G NR 2100 · 5G NR 700 ·
 * LTE 900 · UMTS 2100 · GSM 1800 — against 68 in the bulk file. No `GSM R`, no
 * `P` suffix, no `Expe`. The classification this layer would have had to invent
 * is one that ANFR already publishes, so the layer reads `generation` and stops
 * arguing.
 *
 * The bulk file is not wasted: its 4 805-byte REFERENCE archive is the only
 * place `nat_id` is spelled out, and this module parses that (38 rows,
 * `SUP_NATURE.txt`, 785 bytes) so a card can say `Pylône autostable` instead of
 * `23`. The observatoire dataset advertises its own `NAT_ID.txt` and
 * `TPO_ID.txt` resources with `datastore_active: true` — both return `total: 0`.
 *
 * ── Why the CSV and not the JSON datastore ──────────────────────────────────
 * Both routes serve the same 826 418 rows, keyless, no CORS on either. Measured
 * 2026-09-01 with the eleven columns below:
 *
 *   `/sites/default/files/dataset/…observatoireod_20260827.csv`
 *       181 988 412 bytes in **4.07 s** (44.7 MB/s), one static-file GET.
 *   `/d4c/api/records/2.0/search/?limit=150000&offset=0&fields=…`
 *       42 016 116 bytes in **4.74 s** for ONE of the six pages needed —
 *       ~231 MB and ~30 s for the set.
 *
 * One static GET is both five times cheaper and considerably kinder to a public
 * agency's database than six full-table scans, and the CSV URL is not a guess:
 * the D4C catalogue publishes it as `extras.file_csv`, alongside
 * `extras.records_count` — `{"88ef0887-…":"0000826418"}` — which is the
 * completeness proof, from the portal, for free. The datastore stays as the
 * cross-check (`?limit=1` returns `result.total` 826 418) and as the fallback.
 *
 * ── Trap 1: `Projet approuvé` is 8.05% of the file and is NOT a mast ────────
 * The register's `statut` has exactly three values, and this module counted all
 * three over the whole file: **En service 639 019 · Techniquement opérationnel
 * 120 891 · Projet approuvé 66 508** — 8.05%, not the ~5% a sample suggests.
 * A "projet approuvé" is an installation ANFR has authorised and nobody has
 * built. Drawing it as a transmitting site is the standard error with this
 * dataset and it is a big one: **3 638 supports (5.00% of 72 700) carry
 * NOTHING but approved projects**, and a further 15 606 live supports carry an
 * approved project on top of what they already radiate — on 3 776 of those the
 * project adds a generation the mast does not have yet.
 *
 * So a support gets three masks, not one: `svc` (systems declared *En service*),
 * `live` (in service OR technically operational — everything that radiates) and
 * `plan` (approved, not built). Colour reads `live`. `plan` is drawn as its own
 * band and never as a generation.
 *
 * The register agrees with itself about this, which is the reassuring part:
 * `emr_dt`, the in-service date, is null on **66 321 rows and every single one
 * of them is `Projet approuvé`**. A thing with no service date is a thing that
 * is not in service.
 *
 * ── Trap 2: the CSV is not the CRLF file next door ──────────────────────────
 * The bulk 5W tables are CRLF. This CSV is **LF only** — verified byte by byte
 * over all 181 988 412 of them, zero `\r`. A parser written for the bulk file
 * leaves a trailing `\r` on the last column, which is `statut`, so every
 * `=== 'En service'` comparison fails and the whole map turns into approved
 * projects. It also opens with a **UTF-8 BOM** (`EF BB BF`), so
 * `header.split(';')[0]` is `"﻿id"` and a column-index build silently
 * loses `id`.
 *
 * What it is NOT is quoting-hostile: all 826 418 rows split into exactly 22
 * fields on `;`, and the only quoted column is `coordonnees` — quoted because
 * its own separator is a comma. So a hand-rolled split is correct here, and
 * saying so is cheaper than pulling in a CSV parser that would be right for the
 * wrong reasons.
 *
 * ── Trap 3: French decimals, and a height of zero ───────────────────────────
 * `sup_nm_haut` is a STRING on every row and carries a decimal comma on
 * **243 889 of the 826 418**. `parseFloat('28,3')` returns 28 in JS — a silent
 * 1% error, never a crash. Measured over the 72 700 supports: median height
 * 30 m, 95th percentile 48 m, maximum 343.3 m, and **551 supports publish 0**.
 * Zero is not a height and is returned as null, not drawn as a mast flat on
 * the ground.
 *
 * ── The height is DENSE, and its 551 holes are a category, not a gap ────────
 * The column was read here and printed on a card long before it was drawn, so
 * the coverage had never been counted. It has now, over all 72 700 supports of
 * the 2026-08-27 edition: **72 149 publish a usable height (99.24 %) and 551
 * do not (0.76 %)**. Distribution, in metres: min 0.6 · p05 12 · p25 22.2 ·
 * **median 30** · p75 36 · p90 44 · **p95 48** · p99 64 · **max 343.3** (a
 * guyed mast). By decade: 1 620 under 10 m, 11 216 in 10–20, 20 486 in 20–30,
 * 26 461 in 30–40, 9 333 in 40–50, 2 646 in 50–75, 277 in 75–100, 110 at or
 * above 100 m.
 *
 * The 551 holes are the finding. They are not scattered across the register:
 * cross-tabulated against `nat_id`, **all 551 of them are underground or
 * indoor** — 506 `Intérieur sous-terrain`, 38 `Tunnel`, 7 `Intérieur galerie`,
 * and that is 551 of 551 exactly. The register leaves the height blank because
 * there is no mast to measure: the equipment is in a tunnel. So a support with
 * no published height is not a support whose height was forgotten, and the
 * drawing owes it a shape of its own rather than a default one.
 *
 * The frozen marks below are published from this count, once, and never
 * recomputed from whatever is on screen (C1).
 *
 * ── The AZIMUTH is not in the file this layer loads. Measured, twice ────────
 * A mobile antenna radiates into a sector, so the direction is the field worth
 * having. It is **not in the observatoire**: the CSV header was re-read byte
 * for byte on 2026-09-03 over a 601-byte range request, and it is 22 columns —
 * `id · adm_lb_nom · sup_id · emr_lb_systeme · emr_dt · sta_nm_dpt ·
 * code_insee · generation · date_maj · sta_nm_anfr · nat_id · sup_nm_haut ·
 * tpo_id · adr_lb_lieu · adr_lb_add1 · adr_lb_add2 · adr_lb_add3 · adr_nm_cp ·
 * com_cd_insee · coordonnees · coord · statut`. **No azimuth, no tilt, no
 * aperture, no power.** The bulk 5W archive has `AER_NB_AZIMUT` on
 * `SUP_ANTENNE.txt`, but importing it would mean the 66 MB join this module
 * refuses in its opening section, and it would arrive per-AER_ID with no way
 * to reach a viewport cheaply.
 *
 * Where it IS published is Cartoradio, per antenna, as `orientation` in
 * degrees — the same on-demand call this module already reads for the card.
 * Measured 2026-09-03 over 40 supports spread through the register (one every
 * 1 817 rows of the sorted pack), 138 installations and **328 antennas: 324
 * carry an orientation (98.8 %) and 4 do not**. Mounting height came with it:
 * `installations[].hauteur` was published on **138 of 138** (min 3 m, median
 * 26.4 m, max 48.3 m).
 *
 * And `orientation: 0` was cleared before it was drawn, because a zero in a
 * bearing column is the classic null-in-disguise. It is not one here: 26 of
 * the 138 installations carry a 0, **not one of them carries it alone**, and
 * 18 of the 26 are the textbook three-sector `0/120/240`. The rest are
 * `0/105/210`, `0/90/210`, `0/90/270`, `0/140/240`, `0/220`, `0/240`. Zero is
 * due north and is drawn as due north.
 *
 * So the azimuth reaches the map ONE MAST AT A TIME, on the card the reader
 * asked for, and never as a viewport channel. That is a limit of the transport
 * and it is stated rather than papered over.
 *
 * ── Trap 4: `fields=` will not accept an encoded comma ──────────────────────
 * The datastore's projection parameter takes LITERAL commas.
 * `fields=sup_id%2Cadm_lb_nom` returns **HTTP 200, 119 bytes,
 * `{"success":false,"error":{"fields":["invalid value \"sup_id%2C…\""]}}`* —
 * a 200 that is an error, which is what `URLSearchParams` produces if you let
 * it. Every helper here builds that parameter by hand.
 *
 * ── What the file cannot tell you, by statute ───────────────────────────────
 * Quoted from the canonical dataset: *"Installations radioélectriques de plus
 * de 5 watts, hormis celles de l'Aviation Civile et des ministères de la
 * Défense et de l'Intérieur."* Blank ground near a base or an airport is
 * policy, not a gap in the data, and the layer says so rather than letting a
 * reader infer coverage.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
 */

/** The Data4Citizen portal. NOT Opendatasoft: `/api/explore` is a 404 here. */
export const ANFR_PORTAL = 'data.anfr.fr';

/** Catalogue route. `/d4c/api/`, and 59 489 bytes for all 9 ANFR datasets. */
export const ANFR_CATALOGUE_URL = 'https://data.anfr.fr/d4c/api/datasets/2.0/search/?rows=100';

/** The dataset this layer is: *Données sur les réseaux mobiles*, weekly, LOv2. */
export const ANFR_DATASET = 'observatoire_2g_3g_4g';

/**
 * Resource id of the observatoire CSV, and the floor for discovery.
 *
 * The CSV's URL carries its own build stamp
 * (`20260827182212_observatoireod_20260827.csv`) and therefore CHANGES EVERY
 * WEEK. Pinning it would serve a stale map within seven days, so it is read
 * from the catalogue's `extras.file_csv` at build time and this id is only the
 * fallback for finding the right dataset if the name lookup ever fails.
 */
export const ANFR_RESOURCE_ID = '88ef0887-6b0f-4d3f-8545-6d64c8f597da';

/** The CSV this module was measured against — used only if discovery fails. */
export const ANFR_CSV_URL_FLOOR = 'https://data.anfr.fr/sites/default/files/dataset/20260827182212_observatoireod_20260827.csv';

/**
 * Oldest edition this layer accepts, and the one every number here was
 * measured on.
 *
 * The edition is DISCOVERED — from `extras.date_modification_data`, and
 * cross-checked against the `date_maj` stamped on all 826 418 rows
 * (`2026-08-27T16:11:53`, identical on every one). The floor is what stops the
 * discovery going backwards: an answer older than this is a malformed answer,
 * not a new fact.
 */
export const ANFR_EDITION_FLOOR = '2026-08-27';

/** The handset SAR register. Real, published, and NOT geographic — see below. */
export const ANFR_DAS_DATASET = 'das-telephonie-mobile';
export const ANFR_DAS_RESOURCE_ID = 'ada0f4f9-01c6-4fab-b2db-6e0c8e1a9096';

/**
 * Columns asked of the DAS register.
 *
 * Seven of its thirteen. Measured 2026-09-01: the whole register is 1 230 rows
 * and 497 113 bytes; this projection is **77 184 bytes**, and nothing dropped
 * is read. LITERAL COMMAS — see Trap 4.
 */
export const ANFR_DAS_FIELDS = 'marque,modele,date_prelevement,das_tete__nf_en_50360_,das_tronc__nf_en_50566_,conformite____,rapports';

/**
 * The reference archive, for `nat_id` → a support's nature.
 *
 * 4 805 bytes on static.data.gouv.fr (the only ANFR-adjacent host that sends
 * `access-control-allow-origin: *` and `accept-ranges: bytes`). Read through
 * `scripts/lib/remoteZip.mjs`, which range-reads a single member.
 */
export const ANFR_REF_ZIP_URL = 'https://static.data.gouv.fr/resources/donnees-sur-les-installations-radioelectriques-de-plus-de-5-watts-1/20260824-081936/20260731-export-etalab-ref.zip';
export const ANFR_REF_MEMBER = 'SUP_NATURE.txt';

/** Attribution carried on every payload (see DATA_SOURCES.md). */
export const ANFR_SOURCE = 'Observatoire des réseaux mobiles & installations de plus de 5 W — '
  + 'Agence nationale des fréquences (data.anfr.fr, data.gouv.fr)';

/** Cartoradio's undocumented REST root — ON-DEMAND DETAIL ONLY. See below. */
export const CARTORADIO_BASE = 'https://www.cartoradio.fr/api/v1';

/**
 * Radius, in metres, inside which a published exposure measurement is offered
 * beside a support.
 *
 * 300 m, and it is a measured ceiling rather than a round number. This module
 * indexed all **92 369** ANFR exposure-measurement points against all 72 700
 * supports: 22.7% of supports have a published measurement within 100 m, 32.0%
 * within 200 m, **37.1% within 300 m**, 43.6% within 500 m, and the median
 * distance to the nearest one is 277 m. Past ~300 m the "nearest measurement"
 * stops being about the same street and the card would be implying a link that
 * the data does not support.
 */
export const ANFR_EXPOSURE_RADIUS_M = 300;

/**
 * The eleven columns read out of the 22 the CSV publishes.
 *
 * `code_insee` and `com_cd_insee` are dropped because the national fold is
 * point-in-polygon and never a code join — the register zero-pads to three
 * characters and spells Corsica `02A`/`02B` where the bundled IGN outlines use
 * `2A`/`2B`, so a code join silently loses every Corsican mast. `sta_nm_dpt` is
 * kept anyway, but only to NAME the 3 822 overseas supports the metropolitan
 * polygons cannot hold. `coord` (the DMS spelling of `coordonnees`),
 * `tpo_id`, the four address lines and the postcode are dropped because
 * Cartoradio resolves all of them to labels on the card, and carrying the
 * postcode alone measured +210 KB gzipped on the national pack.
 */
export const ANFR_CSV_COLUMNS = Object.freeze([
  'sup_id',
  'adm_lb_nom',
  'generation',
  'statut',
  'coordonnees',
  'sta_nm_dpt',
  'nat_id',
  'sup_nm_haut',
  'emr_lb_systeme',
  'emr_dt',
  'date_maj',
]);

/**
 * The generation ladder, oldest first.
 *
 * Bit `i` of every mask in this module is `ANFR_GENERATIONS[i]`. Counted over
 * the whole observatoire, by ROWS: 4G 516 561 · 5G 141 627 · 3G 111 182 ·
 * 2G 57 048. Counted over SUPPORTS that actually radiate it: 4G 68 826 ·
 * 3G 54 757 · 5G 50 148 · 2G 36 928.
 */
export const ANFR_GENERATIONS = Object.freeze(['2G', '3G', '4G', '5G']);

/**
 * ANFR's own three statuses, verbatim, most-transmitting first.
 *
 * The middle one is the one that gets misread. *Techniquement opérationnel* is
 * a system the operator has switched on but has not declared in service; it
 * radiates. *Projet approuvé* is a file at ANFR, not a mast. So `live` folds
 * the first two and `plan` is kept apart.
 */
export const ANFR_STATUSES = Object.freeze([
  'En service', 'Techniquement opérationnel', 'Projet approuvé',
]);

export const ANFR_STATUS_LABELS = Object.freeze({
  'En service': 'En service',
  'Techniquement opérationnel': 'Techniquement opérationnel — allumé, pas déclaré en service',
  'Projet approuvé': 'Projet approuvé — autorisé, pas construit',
});

/** The two statuses that mean something is radiating. */
export const ANFR_LIVE_STATUSES = Object.freeze(['En service', 'Techniquement opérationnel']);

/**
 * The colour ladder: five bands, LOWEST CLAIM FIRST.
 *
 * The order is load-bearing twice. In the maillage, `cellRepresentative`
 * breaks a tie between two equally common categories by taking the LOWER
 * index, so index 0 must be the reading that over-claims nothing — a cell that
 * is half approved-projects and half 2G must not be drawn as 5G. And in the
 * legend it reads bottom-up as the network's own history.
 *
 * Counted over the 72 700 supports, by the newest generation that actually
 * radiates there: **5G 50 148 · 4G 18 698 · 3G 127 · 2G 89 · projet 3 638**.
 * The two middle rungs are almost empty, and that is the finding rather than a
 * bug: 54 757 supports still radiate 3G, but on 54 630 of them 4G or 5G
 * radiates too, so only 127 masts in France have 3G as their best generation.
 */
export const ANFR_BANDS = Object.freeze(['projet', '2g', '3g', '4g', '5g']);

export const ANFR_BAND_LABELS = Object.freeze({
  projet: 'Projet approuvé — rien n’émet',
  '2g': '2G seule',
  '3g': '3G au plus',
  '4g': '4G au plus',
  '5g': '5G en service',
});

/** Index of a band in the ladder — also its mesh category. */
export const ANFR_BAND_INDEX = Object.freeze(
  Object.fromEntries(ANFR_BANDS.map((band, index) => [band, index])),
);

/**
 * Tuple slots of one support in the national pack.
 *
 * A support is a 10-tuple, not an object. 72 700 of them travel in one
 * document, and measured on the real payload: tuples are 3 553 551 bytes and
 * **1 046 345 gzipped**; the same rows as objects with ten keys apiece are
 * 6 410 278 and 1 570 449 — 1.5× the wire cost for field names the browser
 * already knows. The index constants exist so no caller has to remember the
 * order.
 */
export const ANFR_ID = 0;
export const ANFR_LAT = 1;
export const ANFR_LON = 2;
/** Mask of generations declared *En service*. */
export const ANFR_SVC = 3;
/** Mask of generations that radiate (in service OR technically operational). */
export const ANFR_LIVE = 4;
/** Mask of generations that exist only as an approved project. */
export const ANFR_PLAN = 5;
/** Mask into the payload's `operators` vocabulary. */
export const ANFR_OPS = 6;
/** Mask into the payload's `systems` vocabulary. */
export const ANFR_SYS = 7;
/** ANFR `nat_id`, resolved through the payload's `natures` map. */
export const ANFR_NAT = 8;
/** Support height in metres, or null. */
export const ANFR_HAUT = 9;

/**
 * Coordinate precision kept in the pack.
 *
 * Five decimals, ~1.1 m — which is finer than the source. ANFR derives
 * `coordonnees` from degrees/minutes/**integer** seconds, so positions
 * quantise to 1/3600° (~31 m in longitude at 48°N) and masts snap to a visible
 * lattice past about z18. Five decimals reproduces that grid to within 0.6 m
 * and costs 210 KB gzipped less than six.
 */
export const ANFR_COORD_DECIMALS = 5;

/** Trimmed string, or null. */
function str(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

/**
 * A French-decimal number, or null.
 *
 * `Number('28,3')` is NaN and `parseFloat('28,3')` is 28. Neither is the
 * answer, and the second is the dangerous one because it never throws.
 */
export function anfrNumber(value) {
  const text = str(value);
  if (text === null) return null;
  const parsed = Number(text.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The support-height domain, frozen, from the whole 2026-08-27 register.
 *
 * Published marks, not a scale: the drawing extrudes a support to its REAL
 * height in metres, so there is no thematic mapping to invert and nothing to
 * classify. What a reader still needs is where a given shaft sits in the
 * national distribution, and these are the three numbers that answer it. They
 * are constants because C1 says a mark must not change meaning when the camera
 * moves: recomputing "median" from the masts in view would make the same
 * pylon read differently in Paris and in Lozère.
 *
 * Counted over 72 149 published heights — see the Trap 3 section.
 */
export const ANFR_HEIGHT_P05_M = 12;
export const ANFR_HEIGHT_MEDIAN_M = 30;
export const ANFR_HEIGHT_P95_M = 48;
export const ANFR_HEIGHT_MAX_M = 343.3;
/** Supports with, and without, a usable `sup_nm_haut`. 72 149 + 551 = 72 700. */
export const ANFR_HEIGHT_PUBLISHED = 72_149;
export const ANFR_HEIGHT_MISSING = 551;
/**
 * The three `nat_id` labels that hold all 551 missing heights.
 *
 * 506 + 38 + 7 = 551, exactly. Kept as data rather than as prose because the
 * card and the legend both say it and neither should be able to drift from
 * the count.
 */
export const ANFR_HEIGHTLESS_NATURES = Object.freeze([
  'Intérieur sous-terrain', 'Tunnel', 'Intérieur galerie',
]);

/**
 * Support height in metres, or null.
 *
 * Zero is refused rather than returned. 551 of the 72 700 supports publish
 * `0`, which is the register's way of saying nobody filled the field in — a
 * mast is not 0 m tall — and a card that prints "0 m" is asserting something
 * the file never said.
 */
export function anfrHeightM(value) {
  const metres = anfrNumber(value);
  if (metres === null || metres <= 0) return null;
  return Number(metres.toFixed(1));
}

/**
 * Read `coordonnees` as `[lat, lon]`, or null.
 *
 * ANFR national publishes `"46.177499999999995 , 3.3741666666666665"` — LAT
 * first, comma-space separated, as a string. The Clermont Auvergne Métropole
 * republication of the identical column set publishes
 * `"3.1266666666666665;45.84138888888889"` — LON first, semicolon separated.
 * Both are strings and both are called `coordonnees`. So the separator is part
 * of the contract here: a value that does not split on exactly one comma is
 * refused rather than guessed at, because guessing the axis order wrong puts
 * every French mast in the Indian Ocean and nothing downstream would notice.
 *
 * Measured over the whole file: 826 418 of 826 418 rows parse, none at (0, 0),
 * latitudes -27.618333 to 51.080278 and longitudes -178.171389 to 168.098333 —
 * Nouvelle-Calédonie to Dunkerque, Wallis-et-Futuna to the Loyauté islands.
 */
export function anfrCoordinates(value) {
  const text = str(value);
  if (text === null) return null;
  const parts = text.split(',');
  if (parts.length !== 2) return null;
  const lat = Number(parts[0].trim());
  const lon = Number(parts[1].trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 && lon === 0) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return [
    Number(lat.toFixed(ANFR_COORD_DECIMALS)),
    Number(lon.toFixed(ANFR_COORD_DECIMALS)),
  ];
}

/**
 * Column index map from the CSV's header line.
 *
 * Strips the UTF-8 BOM and refuses a header that does not carry every column
 * `projectAnfrSupports` reads — an upstream rename is a build failure here
 * rather than a map that quietly loses a field. See Trap 2.
 *
 * @param {string} line The first line of the CSV, verbatim.
 * @returns {Object<string, number>}
 */
export function anfrCsvColumns(line) {
  const header = String(line ?? '').replace(/^﻿/, '').replace(/\r$/, '');
  const index = {};
  header.split(';').forEach((name, position) => {
    const key = name.trim();
    if (key) index[key] = position;
  });
  const missing = ANFR_CSV_COLUMNS.filter((name) => !(name in index));
  if (missing.length) {
    throw new Error(`ANFR observatoire header is missing ${missing.join(', ')}`);
  }
  return index;
}

/**
 * One CSV data line as an object over `ANFR_CSV_COLUMNS`, or null.
 *
 * Only the eleven read columns are materialised; the other eleven stay as
 * substrings that are never allocated. `coordonnees` loses its surrounding
 * quotes here rather than in the coordinate parser, because the quoting is a
 * property of the transport and the parser also serves the JSON route.
 */
export function readAnfrCsvRow(line, columns) {
  const text = String(line ?? '');
  if (!text) return null;
  const fields = text.split(';');
  if (fields.length < ANFR_CSV_COLUMNS.length) return null;
  const row = {};
  for (const name of ANFR_CSV_COLUMNS) {
    const raw = fields[columns[name]];
    row[name] = raw === undefined ? null : raw.replace(/^"(.*)"$/s, '$1');
  }
  return row;
}

/**
 * `nat_id` → nature, from `SUP_NATURE.txt` inside the reference archive.
 *
 * The member is 785 bytes, CRLF, semicolon-separated, header `NAT_ID;NAT_LB_NOM`,
 * 38 rows. Its first data row is `0;Sans nature` and its last is
 * `999999999;Support non décrit` — two ways of saying "we do not know", plus a
 * literal `51;XXX` in the middle. Those pass through unchanged: inventing a
 * nicer label for a register's own placeholder is a lie about the register.
 *
 * @param {string} text Verbatim member bytes, decoded as UTF-8.
 * @returns {Object<string, string>} Keyed by the id as a string, for JSON.
 */
export function parseAnfrNatureTable(text) {
  const natures = {};
  const lines = String(text ?? '').split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const cut = line.indexOf(';');
    if (cut < 0) continue;
    const id = line.slice(0, cut).trim();
    const label = line.slice(cut + 1).trim();
    if (!/^\d+$/.test(id) || !label) continue;
    natures[id] = label;
  }
  return natures;
}

/**
 * Locate the observatoire in the D4C catalogue and read its edition from it.
 *
 * Three things come out of one 59 489-byte call: the CSV's weekly URL, the
 * portal's own row count, and the edition date. All three are floored: a CSV
 * URL that is not on the portal, a count that is not a positive integer, or an
 * edition older than `ANFR_EDITION_FLOOR` is a malformed answer and the pinned
 * value is used instead.
 *
 * @param {object} catalogue Body of `ANFR_CATALOGUE_URL`.
 * @param {object} [options]
 * @param {string} [options.editionFloor]
 * @returns {{csvUrl:string, resourceId:string, edition:string, rowsTotal:?number,
 *   discovered:boolean}}
 */
export function pickAnfrObservatoire(catalogue, { editionFloor = ANFR_EDITION_FLOOR } = {}) {
  const results = Array.isArray(catalogue?.result?.results) ? catalogue.result.results : [];
  const dataset = results.find((entry) => entry?.name === ANFR_DATASET) || null;
  const extras = Object.fromEntries(
    (Array.isArray(dataset?.extras) ? dataset.extras : []).map((entry) => [entry?.key, entry?.value]),
  );

  const csvUrl = String(extras.file_csv || '').trim();
  const usable = /^https:\/\/data\.anfr\.fr\/.+\.csv$/i.test(csvUrl);

  // `records_count` is a MAP keyed by resource id, and its value is a
  // zero-padded string — `"0000826418"`. Number() handles the padding; the
  // shape does not survive being assumed to be a bare number.
  const counts = (() => {
    try { return JSON.parse(extras.records_count || '{}'); } catch { return {}; }
  })();
  const resource = (Array.isArray(dataset?.resources) ? dataset.resources : [])
    .find((entry) => entry?.format === 'CSV' && entry?.datastore_active) || null;
  const resourceId = resource?.id || ANFR_RESOURCE_ID;
  const rowsTotal = Number(counts[resourceId]);

  const stamp = String(extras.date_modification_data || '').slice(0, 10);
  const edition = /^\d{4}-\d{2}-\d{2}$/.test(stamp) && stamp >= editionFloor ? stamp : editionFloor;

  return {
    csvUrl: usable ? csvUrl : ANFR_CSV_URL_FLOOR,
    resourceId,
    edition,
    rowsTotal: Number.isFinite(rowsTotal) && rowsTotal > 0 ? rowsTotal : null,
    discovered: usable,
    licence: dataset?.license_title || null,
  };
}

/** Bit set of the labels present in a mask, in vocabulary order. */
export function anfrDecodeMask(mask, vocabulary) {
  const bits = Number(mask) || 0;
  const list = Array.isArray(vocabulary) ? vocabulary : [];
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    if (bits & (1 << i)) out.push(list[i]);
  }
  return out;
}

/** How many bits are set. Operator count and generation depth both use it. */
export function anfrPopCount(mask) {
  let bits = Number(mask) || 0;
  let count = 0;
  while (bits) {
    bits &= bits - 1;
    count += 1;
  }
  return count;
}

/**
 * The band a support is drawn in: the newest generation that RADIATES there,
 * or `projet` when nothing does.
 *
 * Reads `live`, never `plan`. That is the whole ethical content of this
 * function: 3 638 supports would otherwise be drawn as 4G or 5G masts on the
 * strength of paperwork.
 */
export function anfrBand(liveMask) {
  const bits = Number(liveMask) || 0;
  for (let i = ANFR_GENERATIONS.length - 1; i >= 0; i -= 1) {
    if (bits & (1 << i)) return ANFR_BANDS[i + 1];
  }
  return 'projet';
}

/** French label for one band. */
export function anfrBandLabel(band) {
  return ANFR_BAND_LABELS[band] || ANFR_BAND_LABELS.projet;
}

/** Metres between two coordinates, on the local flat approximation. */
export function anfrDistanceM(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
  const kx = 111_320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * 110_574);
}

/**
 * Cartoradio's `orientation` as a bearing in [0, 360), or null.
 *
 * ZERO IS KEPT. It is a real bearing in this register and not a blank — 26 of
 * the 138 measured installations carry a 0 and every one of them carries it
 * beside another azimuth, 18 of them as the three-sector `0/120/240`. What is
 * refused is a non-number and a value outside one turn, because those are the
 * shapes a null takes when it is not spelled `null`.
 */
export function anfrAzimuthDeg(value) {
  if (value === null || value === undefined || value === '') return null;
  const deg = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(deg)) return null;
  if (deg < -360 || deg > 360) return null;
  // In range, the value is returned UNTOUCHED. `((12.7 % 360) + 360) % 360` is
  // 12.699999999999989 in IEEE 754, and a bearing that changes in its twelfth
  // decimal breaks the pair key that folds three sectors into three rays.
  if (deg >= 0 && deg < 360) return deg;
  return ((deg % 360) + 360) % 360;
}

/**
 * The point `distanceM` from (`lat`, `lon`) along a bearing, on a sphere.
 *
 * Great-circle rather than a flat offset, for one reason that matters at the
 * distances this is used at: the flat form has to divide by `cos(lat)`, and
 * that factor is what puts a 60 m ray visibly off-azimuth in Dunkerque and
 * badly off it in Nouvelle-Calédonie. The spherical form has no such term.
 *
 * @param {number} lat Degrees.
 * @param {number} lon Degrees.
 * @param {number} bearingDeg Degrees clockwise from north.
 * @param {number} distanceM Metres.
 * @returns {?{lat:number, lon:number}}
 */
export function anfrProjectPoint(lat, lon, bearingDeg, distanceM) {
  if (![lat, lon, bearingDeg, distanceM].every(Number.isFinite)) return null;
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const angular = distanceM / R;
  const lat1 = lat * rad;
  const lon1 = lon * rad;
  const bearing = bearingDeg * rad;
  const sinLat = Math.sin(lat1) * Math.cos(angular)
    + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing);
  const lat2 = Math.asin(Math.min(1, Math.max(-1, sinLat)));
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * sinLat,
  );
  return { lat: lat2 / rad, lon: (((lon2 / rad) + 540) % 360) - 180 };
}

/**
 * The `bbox` Cartoradio wants around a support, as `west,south,east,north`.
 *
 * Cartoradio returns **HTTP 500 with the body `{}`** if any of its seven
 * parameters is missing — a 500 whose body parses as valid JSON, which is the
 * worst failure signature there is. The caller builds the whole query; this
 * only shapes the box.
 */
export function anfrExposureBbox(lat, lon, radiusM = ANFR_EXPOSURE_RADIUS_M) {
  const dLat = radiusM / 111_320;
  const dLon = dLat / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  return [
    (lon - dLon).toFixed(6),
    (lat - dLat).toFixed(6),
    (lon + dLon).toFixed(6),
    (lat + dLat).toFixed(6),
  ].join(',');
}

/**
 * Fold the observatoire into one row per support.
 *
 * 826 418 rows in, 72 700 out. The fold is safe because the geometry is
 * consistent: this module checked all 72 700 groups and **not one has more
 * than a single distinct coordinate**, so a support's position is a fact about
 * the support rather than about whichever row arrived first.
 *
 * @param {object} options
 * @param {Iterable<object>} options.rows Rows from `readAnfrCsvRow`.
 * @param {Object<string,string>} [options.natures] From `parseAnfrNatureTable`.
 * @param {string} [options.edition]
 * @param {?number} [options.totalCount] The portal's own row count, used only
 *   to prove the download was not silently short.
 * @param {string} [options.source]
 * @returns {object}
 */
export function projectAnfrSupports({
  rows,
  natures = null,
  edition = ANFR_EDITION_FLOOR,
  totalCount = null,
  source = ANFR_SOURCE,
} = {}) {
  /** @type {Map<number, object>} */
  const supports = new Map();
  /** Vocabulary indexes, built as the labels are first seen. */
  const operatorIndex = new Map();
  const systemIndex = new Map();
  const statuses = Object.fromEntries(ANFR_STATUSES.map((name) => [name, 0]));
  const generationRows = Object.fromEntries(ANFR_GENERATIONS.map((name) => [name, 0]));
  let swept = 0;
  let dropped = 0;

  const slot = (index, label) => {
    let bit = index.get(label);
    if (bit === undefined) {
      bit = index.size;
      index.set(label, bit);
    }
    return bit;
  };

  for (const row of rows || []) {
    const id = Number(row?.sup_id);
    const generation = str(row?.generation);
    const statut = str(row?.statut);
    const gen = ANFR_GENERATIONS.indexOf(generation);
    if (!Number.isFinite(id) || gen < 0 || !statut) {
      dropped += 1;
      continue;
    }
    const point = anfrCoordinates(row?.coordonnees);
    if (!point) {
      // A row with no readable coordinate is COUNTED and dropped. It is never
      // placed on its commune, which is the one thing the file offers instead.
      dropped += 1;
      continue;
    }
    swept += 1;
    if (statut in statuses) statuses[statut] += 1;
    generationRows[generation] += 1;

    let support = supports.get(id);
    if (!support) {
      support = {
        id,
        lat: point[0],
        lon: point[1],
        svc: 0,
        live: 0,
        plan: 0,
        ops: 0,
        sys: 0,
        nat: Number(row?.nat_id) || 0,
        haut: anfrHeightM(row?.sup_nm_haut),
        dept: str(row?.sta_nm_dpt),
        firstService: null,
      };
      supports.set(id, support);
    }

    const operator = str(row?.adm_lb_nom);
    if (operator) support.ops |= 1 << slot(operatorIndex, operator);

    if (statut === 'Projet approuvé') {
      support.plan |= 1 << gen;
      continue;
    }
    support.live |= 1 << gen;
    if (statut === 'En service') support.svc |= 1 << gen;
    const system = str(row?.emr_lb_systeme);
    if (system) support.sys |= 1 << slot(systemIndex, system);
    const served = str(row?.emr_dt);
    if (served && (!support.firstService || served < support.firstService)) {
      support.firstService = served;
    }
  }

  // The vocabularies are re-sorted alphabetically and the masks re-mapped, so
  // the payload's operator order does not depend on which row happened to
  // arrive first. A fixture and the live file must produce the same legend.
  const operators = [...operatorIndex.keys()].sort((a, b) => a.localeCompare(b, 'fr'));
  const systems = [...systemIndex.keys()].sort((a, b) => a.localeCompare(b, 'fr'));
  const remapOps = new Map([...operatorIndex].map(([label, bit]) => [bit, operators.indexOf(label)]));
  const remapSys = new Map([...systemIndex].map(([label, bit]) => [bit, systems.indexOf(label)]));
  const remask = (mask, table) => {
    let out = 0;
    for (const [from, to] of table) if (mask & (1 << from)) out |= 1 << to;
    return out;
  };

  const pack = [];
  const bands = Object.fromEntries(ANFR_BANDS.map((band) => [band, 0]));
  const generationSupports = Object.fromEntries(ANFR_GENERATIONS.map((name) => [name, 0]));
  const operatorReach = Object.fromEntries(operators.map((name) => [name, 0]));
  const sharing = {};
  const usedNatures = new Set();
  let live = 0;
  let projectOnly = 0;
  let plannedUpgrades = 0;

  for (const support of supports.values()) {
    const ops = remask(support.ops, remapOps);
    pack.push([
      support.id, support.lat, support.lon,
      support.svc, support.live, support.plan,
      ops, remask(support.sys, remapSys),
      support.nat, support.haut,
    ]);
    const band = anfrBand(support.live);
    bands[band] += 1;
    if (support.live) live += 1; else projectOnly += 1;
    // An approved project that adds a generation the mast does not already
    // radiate is the only kind worth counting: an operator re-filing for a
    // band that is already on the air is paperwork, not an upgrade.
    if (support.live && (support.plan & ~support.live)) plannedUpgrades += 1;
    for (let i = 0; i < ANFR_GENERATIONS.length; i += 1) {
      if (support.live & (1 << i)) generationSupports[ANFR_GENERATIONS[i]] += 1;
    }
    for (const name of anfrDecodeMask(ops, operators)) operatorReach[name] += 1;
    const shared = anfrPopCount(ops);
    sharing[shared] = (sharing[shared] || 0) + 1;
    usedNatures.add(String(support.nat));
  }

  // Ascending by id, which is also roughly chronological in ANFR's numbering.
  // A stable order is what lets the viewport slice be reproducible and the
  // disk cache be diffable.
  pack.sort((a, b) => a[ANFR_ID] - b[ANFR_ID]);

  const natureTable = {};
  for (const id of [...usedNatures].sort((a, b) => Number(a) - Number(b))) {
    const label = natures?.[id];
    if (label) natureTable[id] = label;
  }

  // The portal's own count for the same file. A short body is the one failure
  // a static file server returns as HTTP 200, and it looks exactly like a
  // smaller country.
  const complete = !Number.isFinite(totalCount) || swept + dropped >= totalCount;

  return {
    supports: pack,
    operators,
    systems,
    natures: natureTable,
    natureAvailable: Object.keys(natureTable).length > 0,
    count: pack.length,
    live,
    projectOnly,
    plannedUpgrades,
    bands,
    generations: generationSupports,
    generationRows,
    statuses,
    operatorReach,
    sharing,
    rowsSwept: swept,
    rowsDropped: dropped,
    rowsTotal: Number.isFinite(totalCount) ? totalCount : null,
    complete,
    edition,
    dataset: ANFR_DATASET,
    source,
  };
}

/**
 * The national exposure readout the brief asks for and the map cannot draw.
 *
 * `das-telephonie-mobile` is the ANFR register of handset specific-absorption-rate
 * tests. Measured 2026-09-01: **1 230 rows, 1 150 Conforme and 80 Non Conforme**,
 * 136 brands, samples dated 2012-01-03 to 2025-07-02, every row carrying a link
 * to its own report. It has NO coordinate of any kind — it is a product
 * register, not a place register — so it is summarised once, on the national
 * card, and never joined to a mast. A per-antenna DAS field would be invented.
 *
 * The values themselves are refused as numbers on purpose: `das_tronc__nf_en_50566_`
 * publishes the literal string `"< 2W/kg(**)"` on some rows next to `"3,01"` on
 * others, so this returns ANFR's own conformity verdict and counts, not an
 * average of a column that is not numeric.
 */
export function projectAnfrDas(body) {
  const records = Array.isArray(body?.result?.records) ? body.result.records : [];
  const total = Number(body?.result?.total);
  let conforming = 0;
  let nonConforming = 0;
  let newest = null;
  const brands = new Set();
  for (const row of records) {
    const verdict = str(row?.conformite____);
    if (verdict === 'Conforme') conforming += 1;
    else if (verdict === 'Non Conforme') nonConforming += 1;
    const brand = str(row?.marque);
    if (brand) brands.add(brand);
    const sampled = str(row?.date_prelevement);
    if (sampled && (!newest || sampled > newest)) newest = sampled;
  }
  return {
    dataset: ANFR_DAS_DATASET,
    handsets: Number.isFinite(total) && total > 0 ? total : records.length,
    rowsRead: records.length,
    conforming,
    nonConforming,
    brands: brands.size,
    newestSample: newest,
    geographic: false,
  };
}

/**
 * One Cartoradio support detail, projected.
 *
 * `coordonnees.coord_x` is the LATITUDE and `coord_y` the LONGITUDE. That is
 * not a typo in this comment: Cartoradio names them x and y and puts them the
 * other way round from every convention, and it is verified against the
 * register — support 449714 returns `{coord_x: 48.85528, coord_y: 2.33167}`
 * for a mast the observatoire places at 48.85528, 2.33167.
 *
 * The `categories` array is the second reason this call exists. The
 * observatoire is public mobile ONLY; Cartoradio knows the same mast also
 * carries a `FH` microwave link, or TNT, or PMR. Naming those on the card is
 * how the layer admits that its dot is not the whole installation.
 */
export function projectCartoradioSupport(body) {
  const data = body?.data;
  if (!data || !Number.isFinite(Number(data.numero))) return null;
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const mobile = categories.find((entry) => entry?.code === 'TEL') || null;
  const address = [
    str(data.adresse?.numero),
    str(data.adresse?.voie),
    str(data.adresse?.adresse),
  ].filter(Boolean).join(' ');
  return {
    supId: Number(data.numero),
    nature: str(data.description?.nature),
    heightM: anfrNumber(data.description?.hauteur),
    owner: str(data.description?.proprietaire),
    address: address || null,
    postcode: str(data.adresse?.code_postal),
    commune: str(data.adresse?.commune),
    lat: anfrNumber(data.coordonnees?.coord_x),
    lon: anfrNumber(data.coordonnees?.coord_y),
    operators: (mobile?.exploitants || []).map((entry) => ({
      name: str(entry?.nom),
      systems: Array.isArray(entry?.systemes) ? entry.systemes.filter(Boolean) : [],
    })).filter((entry) => entry.name),
    // Everything on the mast that this layer does not draw, by Cartoradio's
    // own category name.
    otherCategories: categories
      .filter((entry) => entry?.code && entry.code !== 'TEL')
      .map((entry) => str(entry.nom) || entry.code),
  };
}

/**
 * The per-emitter breakdown: what each operator actually radiates, and in
 * which band pair.
 *
 * This is the answer to "and what it radiates" — the frequency edges are
 * published per emitter as `{debut, fin, unite}`, and an LTE 700 emitter
 * returns two of them because the link is duplex (778–788 MHz down,
 * 723–733 MHz up). They are kept as pairs rather than summed into a bandwidth,
 * which would be a number ANFR never published.
 *
 * The newest `date_service` across every emitter comes out of the same pass;
 * the exposure readout uses it to say whether a published measurement predates
 * the equipment it would be read as measuring.
 *
 * ── The azimuths, and the two ways they can be absent ───────────────────────
 * `antennes[].orientation` is the only direction ANFR publishes anywhere this
 * layer can reach, and `installations[].hauteur` is the only mounting height.
 * Both are folded here into one list of DISTINCT (bearing, height) pairs,
 * because a three-sector site files one antenna per operator per band and a
 * busy mast returns the same three bearings a dozen times: the measured sample
 * had 328 antennas on 138 installations, and drawing one ray per antenna would
 * stack a dozen identical rays on each of three bearings.
 *
 * What is NOT folded in is a beamwidth or a range, because ANFR publishes
 * neither. A wedge would have to invent an aperture and a distance; a ray only
 * has to be pointed. So this returns bearings, and the drawing draws bearings.
 *
 * The cost is one card's worth and it is measured on the busiest mast in the
 * fixtures, support 449714 with five operators and 33 antennas: the antenna
 * projection goes from 2 424 to 3 756 bytes, **706 to 893 gzipped**. That is
 * +187 bytes on a per-mast call that is made once, cached for a day and
 * coalesced by SUP_ID — not on the 72 700-support pack, which carries none of
 * this.
 *
 * The two absences are kept apart because they mean different things:
 * `withoutAzimuth` is an antenna whose direction nobody filed (4 of 328
 * measured), and `heightM: null` on a pair is a direction that IS filed on an
 * installation whose mounting height is not (0 of 138 measured — the branch
 * exists so the drawing can mark it rather than seat the ray on a guess).
 */
export function projectCartoradioAntennas(body) {
  const stations = Array.isArray(body?.data) ? body.data : [];
  const systems = new Map();
  /** `deg|height` → the pair, so a three-sector mast returns three rays. */
  const azimuths = new Map();
  let antennas = 0;
  let withoutAzimuth = 0;
  let newestService = null;
  const operators = new Set();

  for (const station of stations) {
    const operator = str(station?.station?.exploitant);
    if (operator) operators.add(operator);
    for (const installation of station?.installations || []) {
      const mountM = anfrHeightM(installation?.hauteur);
      for (const antenna of installation?.antennes || []) {
        antennas += 1;
        const bearing = anfrAzimuthDeg(antenna?.orientation);
        if (bearing === null) {
          withoutAzimuth += 1;
        } else {
          const key = `${bearing}|${mountM === null ? '' : mountM}`;
          const pair = azimuths.get(key);
          if (pair) pair.antennas += 1;
          else azimuths.set(key, { deg: bearing, heightM: mountM, antennas: 1 });
        }
        for (const emitter of antenna?.emetteurs || []) {
          const label = str(emitter?.systeme);
          if (!label) continue;
          let entry = systems.get(label);
          if (!entry) {
            entry = { system: label, operators: new Set(), bands: new Set(), since: null };
            systems.set(label, entry);
          }
          if (operator) entry.operators.add(operator);
          for (const band of emitter?.bandes || []) {
            const from = anfrNumber(band?.debut);
            const to = anfrNumber(band?.fin);
            if (from === null || to === null) continue;
            entry.bands.add(`${from}–${to} ${str(band?.unite) === 'G' ? 'GHz' : 'MHz'}`);
          }
          // dd/mm/yyyy upstream; sorted as yyyy-mm-dd so string order is time
          // order, which dd/mm/yyyy famously is not.
          const iso = anfrFrenchDateToIso(emitter?.date_service);
          if (iso) {
            if (!entry.since || iso < entry.since) entry.since = iso;
            if (!newestService || iso > newestService) newestService = iso;
          }
        }
      }
    }
  }

  return {
    stations: stations.length,
    antennas,
    // Sorted by bearing, then by mounting height, so two reads of the same
    // mast list the sectors in the same order and a card is diffable.
    azimuths: [...azimuths.values()]
      .sort((a, b) => a.deg - b.deg || (a.heightM ?? 0) - (b.heightM ?? 0)),
    withoutAzimuth,
    operators: [...operators].sort((a, b) => a.localeCompare(b, 'fr')),
    systems: [...systems.values()]
      .map((entry) => ({
        system: entry.system,
        operators: [...entry.operators].sort((a, b) => a.localeCompare(b, 'fr')),
        bands: [...entry.bands].sort(),
        since: entry.since,
      }))
      .sort((a, b) => a.system.localeCompare(b.system, 'fr')),
    newestService,
  };
}

/** `dd/mm/yyyy` → `yyyy-mm-dd`, or null. */
export function anfrFrenchDateToIso(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str(value) || '');
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

/**
 * The nearest published exposure measurement to a support, and what it is not.
 *
 * ANFR publishes 92 369 CEM measurement points nationally. NONE of them is
 * attached to a `SUP_ID`: a measurement is made at an address, on request, and
 * its report lists the emitters that were VISIBLE from that address with their
 * height and distance. So this returns the nearest one with its distance
 * stated, plus how many exist inside the radius, and every caller is expected
 * to print both. It is a reading of a place, not a reading of a mast.
 *
 * The staleness flag is the sharp end. Support 449714's nearest measurement is
 * 40 m away and dated 04/02/2009 under protocol ANFR/DR 15-2.1 — a report
 * whose service list has no 5G band in it at all, because 5G did not exist. A
 * card that printed "0,0 V/m" next to a 5G mast without that date would be
 * lying by omission.
 *
 * @param {object} options
 * @param {object} options.mesures GeoJSON body of the bbox call.
 * @param {?object} options.report Body of `/mesures/{id}` for the nearest.
 * @param {number} options.lat Support latitude.
 * @param {number} options.lon Support longitude.
 * @param {number} [options.radiusM]
 * @param {?string} [options.newestService] ISO date of the newest emitter.
 * @returns {?object}
 */
export function projectCartoradioExposure({
  mesures, report = null, lat, lon, radiusM = ANFR_EXPOSURE_RADIUS_M, newestService = null,
} = {}) {
  const features = Array.isArray(mesures?.features) ? mesures.features : [];
  let nearest = null;
  let within = 0;
  for (const feature of features) {
    const coordinates = feature?.geometry?.coordinates;
    const pointLat = Number(coordinates?.[1]);
    const pointLon = Number(coordinates?.[0]);
    if (!Number.isFinite(pointLat) || !Number.isFinite(pointLon)) continue;
    const metres = anfrDistanceM(lat, lon, pointLat, pointLon);
    if (metres > radiusM) continue;
    within += 1;
    if (!nearest || metres < nearest.metres) {
      nearest = { id: feature.id, metres: Math.round(metres) };
    }
  }
  if (!nearest) return { within: 0, radiusM, nearest: null, report: null };

  const data = report?.data;
  const measuredIso = anfrFrenchDateToIso(data?.date);
  const services = (Array.isArray(data?.services) ? data.services : [])
    // A service line can carry `mesure`, or `extrapolation`, or NEITHER — the
    // last means the band was below the protocol's reporting floor. Only the
    // lines that carry a number are shown, and the count of the rest is kept.
    .map((entry) => ({
      band: str(entry?.libelle),
      range: str(entry?.bande),
      volts: anfrNumber(entry?.mesure ?? entry?.extrapolation),
      extrapolated: entry?.mesure === undefined && entry?.extrapolation !== undefined,
      limit: str(entry?.limite),
    }))
    .filter((entry) => entry.band);

  return {
    within,
    radiusM,
    nearest,
    report: data
      ? {
        id: Number(data.numero) || nearest.id,
        // `mesureglobale` and `conformite` are STRINGS upstream — "0.35" and
        // "true". Coercing them here is the whole reason this projection
        // exists rather than the card reading the body directly.
        globalVoltsPerM: anfrNumber(data.mesureglobale),
        conforming: String(data.conformite) === 'true',
        measuredOn: measuredIso,
        laboratory: str(data.laboratoire),
        protocol: str(data.protocole),
        setting: str(data.milieu),
        environment: str(data.environnement),
        commune: str(data.adresse?.commune),
        services: services.filter((entry) => entry.volts !== null),
        servicesBelowFloor: services.filter((entry) => entry.volts === null).length,
        // True when the mast gained equipment AFTER the measurement was taken.
        // Then the number on the card is a true measurement of a different
        // installation, which is worth more said than hidden.
        predatesEquipment: Boolean(measuredIso && newestService && measuredIso < newestService),
        newestService,
      }
      : null,
  };
}
