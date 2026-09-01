/**
 * IRVE feed projection — the seam between ODRÉ's `bornes-irve` records and
 * what the browser is served.
 *
 * Lives here rather than inside `vite.config.js` for the same reason
 * `eco2mixFeed.js` does: this file is a consolidation of ~180 separate
 * publishers' spreadsheets, and almost every field disagrees with itself
 * somewhere. Only a test against a real captured payload keeps the reading
 * honest. The dev-server proxy imports `projectIrveSites`; nothing in the
 * browser bundle does.
 *
 * ── What the dataset IS ─────────────────────────────────────────────────────
 * The *fichier consolidé des bornes de recharge pour véhicules électriques* —
 * a STATIC REGISTER of where France's public charge points are declared to be,
 * assembled daily by transport.data.gouv.fr from the operators' own IRVE
 * filings and republished on ODRÉ under Licence Ouverte 2.0. Measured
 * 2026-08-27: **231 079 points de charge**, one row per *point de charge*
 * (a single plug-and-pay position), not one row per station.
 *
 * ── What it is NOT ──────────────────────────────────────────────────────────
 * It is not an availability feed. Nothing in these 231 079 rows says whether a
 * charge point is free right now, working, or occupied — that lives in each
 * operator's own OCPI endpoint, behind a contract. So this layer never draws a
 * "N bornes libres" count and never colours a site green-for-available: it
 * draws INSTALLED CAPACITY, and says so.
 *
 * ── Trap 1: the published geometry is unusable, twice over ──────────────────
 * `geo_point_borne` is NULL on all 231 079 rows (measured), so Opendatasoft's
 * `within_bbox()` cannot be used at all — the viewport filter has to be a
 * numeric predicate on the consolidated columns.
 *
 * Worse, `coordonneesxy` is LABELLED BACKWARDS: its `lon` key holds the
 * latitude and its `lat` key holds the longitude, on **every row checked**
 * (32 091/32 091 across Île-de-France). A reader who trusts the key names puts
 * Gennevilliers off the coast of Somalia. Only `consolidated_latitude` /
 * `consolidated_longitude` are read here, and `coordonneesxy` is never touched.
 *
 * ── Trap 2: the station id fragments the station ────────────────────────────
 * `id_station_itinerance` cannot be the render unit. Q-Park's Grande Arche car
 * park at La Défense publishes **127 distinct station ids at one coordinate**,
 * one per charge point; Interparking Clichy-Montmartre publishes 82. And 1 192
 * rows nationally publish the literal string `"Non concerné"` as their station
 * id, spread across coordinates up to 55 km apart. The render unit here is
 * therefore THE COORDINATE (rounded to ~1 m), and a site is described as "N
 * points de charge published at this point" rather than as a station.
 *
 * `nbre_pdc` — the operator's own declared count — is not used either: only
 * 2 641 of 6 272 Île-de-France stations have it agreeing with the number of
 * rows actually published (Bump's Lobau station declares 203 and publishes
 * 229; one Citeo station declares 10 and publishes 1). Counting the rows that
 * exist is a fact; repeating a declaration that contradicts them is not.
 *
 * ── Trap 3: the same charge points are published twice ──────────────────────
 * Measured over Île-de-France: **442 of 3 812 sites (11.6%) carry two or more
 * "operators" publishing an IDENTICAL power profile at the same point**, worth
 * 2 392 charge points — 7.5% of the area's total — that a naive sum counts
 * twice. The pairs are unambiguous: TotalEnergies Charging Services with
 * TotalEnergies Marketing France (378 sites), SPIE CITYNETWORKS with SPIE
 * CityNetworks (107, pure case), ENGIE Vianeo with its Greenflux back end
 * (35), E-TOTEM with E-Totem, ELECTRA with Electra. Only 3 of the 576 clusters
 * were a single charge point, so the test is precise rather than lucky.
 *
 * Identical profiles collapse to one; overlapping ones never do. Both figures
 * travel to the client — `pdcPublished` is what the file says, `pdcDistinct`
 * is what is drawn — and the collapsed names are named on the card.
 *
 * ── Trap 4: kilowatts that are watts ────────────────────────────────────────
 * `puissance_nominale` is kW per the IRVE schema, and 6 981 rows nationally
 * (3.0%) are outside any envelope a charge point can occupy: 5 315 publish
 * ≤ 0 kW, and 1 666 publish more than 400 kW — headed by 771 rows at exactly
 * 7 360 and 90 at 3 680, which are 7.36 kW and 3.68 kW expressed in watts.
 *
 * Those are NOT rescaled. Dividing 7 360 by a thousand is a guess that happens
 * to be right, and the same guess turns a genuine 600 kW bank into 0.6 kW.
 * They go to an explicit `inconnue` band — counted, named, never painted as a
 * power — and the card still prints the published figure verbatim.
 *
 * ── Trap 5: eight spellings of a boolean ────────────────────────────────────
 * `gratuit`, `prise_type_*` and `station_deux_roues` are published as
 * `"True"`, `"true"`, `"TRUE"`, `"False"`, `"false"`, `"FALSE"`, `"1"`, `"0"`
 * and null — all nine forms measured in one Île-de-France pull. In JavaScript
 * `Boolean("False")` is `true`, so a plain coercion reports every paid site as
 * free and fits every socket with a CCS plug.
 *
 * ── Trap 6: mojibake, in a closed vocabulary ────────────────────────────────
 * A handful of publishers ship text whose accents were decoded through the
 * wrong table: `"Acc\x8fs libre"` (Mac Roman read as Latin-1, 48 rows in
 * Île-de-France), plus rarer `"Accčs libre"` and `"Acc¸s libre"`. Left alone
 * they split one legend row into four.
 *
 * Two repairs, in order. The C1 range 0x80–0x9F can never legitimately appear
 * in a name, so those code points are re-read through Mac Roman — an exact,
 * reversible fix. Then `condition_acces`, `implantation_station` and
 * `accessibilite_pmr` are matched to the IRVE schema's own closed vocabulary
 * on their ASCII skeleton, which folds every remaining mangling of a known
 * value onto that value without guessing at any character. A value that
 * matches nothing passes through as published.
 *
 * ── Trap 7: "not verified" is not "wrong" ───────────────────────────────────
 * `consolidated_is_lon_lat_correct` is False on 37% of the file, and reading
 * that as "bad coordinate" would discard a third of France. It is False in two
 * quite different situations, separable because the consolidation fills
 * `consolidated_commune` only when it verified the INSEE code:
 *
 *   False + no commune  → 80 545 rows the pipeline could not CHECK. Kept.
 *   False + commune     →  5 361 rows whose coordinate contradicts a commune
 *                          the pipeline DID verify. Withheld, and counted.
 *   True                → 145 173 rows verified against their commune. Kept.
 *
 * The withheld class is not theoretical: QOVOLTIS publishes "Route du
 * Baganais", verified commune Le Porge (Gironde), at −44.996 / +44.996 — south
 * of Madagascar. Plus 24 rows at exactly (0, 0), which are dropped outright.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
 */

/** ODRÉ dataset id backing this layer. */
export const IRVE_DATASET = 'bornes-irve';
/** Attribution string carried on every payload (see DATA_SOURCES.md). */
export const IRVE_SOURCE = 'transport.data.gouv.fr / ODRÉ (odre.opendatasoft.com)';

/**
 * Largest viewport this source will answer, in degrees (~39 km).
 *
 * Set by the densest real box rather than by taste: 0.35° over Paris is
 * 22 348 charge points, which the grouped query answers in 0.78 s and 3.3 MB.
 * A wider request is a regional view where a per-site dot means nothing, and
 * it is refused rather than quietly cropped.
 */
export const IRVE_MAX_BOX_DEG = 0.35;
/**
 * Outward snap grid (~2.2 km) — neighbouring viewports quantize onto the SAME
 * box, so panning a few streets re-uses the cached answer, and the snap only
 * ever GROWS the box so a cached answer always covers what was asked for.
 */
export const IRVE_BOX_STEP_DEG = 0.02;
/**
 * Row cap on the grouped query. Never reached in France at
 * `IRVE_MAX_BOX_DEG` — the densest measured box grouped to 4 996 rows — so it
 * is a safety net, and `projectIrveSites` proves it was not hit by checking
 * the group counts against the dataset's own total.
 */
export const IRVE_GROUP_LIMIT = 20000;

/**
 * Group key for the viewport query, and the exact list of columns read.
 *
 * Grouping is what makes this layer affordable: the 4 017 charge-point rows in
 * central Paris collapse to 469 grouped rows (300 KB, 0.77 s) against 3.2 MB
 * and 2.1 s for the same rows exported flat, and Opendatasoft's own `count(*)`
 * does the per-point tallying.
 *
 * `id_station_itinerance` and `nbre_pdc` are deliberately ABSENT: they vary
 * per charge point at operators like Q-Park, so including either would undo
 * the grouping entirely — 224 charge points at La Défense group to 8 rows
 * without them and to 100+ with them. See trap 2.
 */
export const IRVE_GROUP_FIELDS = Object.freeze([
  'consolidated_latitude',
  'consolidated_longitude',
  'nom_station',
  'nom_operateur',
  'nom_enseigne',
  'implantation_station',
  'condition_acces',
  'gratuit',
  'accessibilite_pmr',
  'puissance_nominale',
  'prise_type_2',
  'prise_type_combo_ccs',
  'prise_type_chademo',
  'prise_type_ef',
  'prise_type_autre',
  'consolidated_commune',
  'consolidated_is_lon_lat_correct',
  'date_maj',
]);

/**
 * Power bands, in kW, ordered low to high. `max` is inclusive.
 *
 * The ceiling of the `hpc` band is the envelope: 400 kW is the most any
 * charge point in production delivers today, so anything above it — like the
 * 771 national rows at 7 360 — is a unit error, not a charger. See trap 4.
 */
export const IRVE_POWER_BANDS = Object.freeze([
  Object.freeze({ key: 'lente', max: 7.4, label: 'Lente (≤ 7,4 kW)' }),
  Object.freeze({ key: 'normale', max: 22, label: 'Normale (≤ 22 kW)' }),
  Object.freeze({ key: 'accelere', max: 50, label: 'Accélérée (≤ 50 kW)' }),
  Object.freeze({ key: 'rapide', max: 150, label: 'Rapide (≤ 150 kW)' }),
  Object.freeze({ key: 'hpc', max: 400, label: 'Haute puissance (> 150 kW)' }),
]);
/** Band for a charge point whose published power is outside the envelope. */
export const IRVE_UNKNOWN_BAND = Object.freeze({
  key: 'inconnue',
  label: 'Puissance non exploitable',
});
/** Band keys, low to high, with the out-of-envelope band last. */
export const IRVE_BAND_KEYS = Object.freeze([
  ...IRVE_POWER_BANDS.map((band) => band.key),
  IRVE_UNKNOWN_BAND.key,
]);
/** Human label for a band key. */
export const IRVE_BAND_LABELS = Object.freeze(Object.fromEntries([
  ...IRVE_POWER_BANDS.map((band) => [band.key, band.label]),
  [IRVE_UNKNOWN_BAND.key, IRVE_UNKNOWN_BAND.label],
]));

/**
 * Mac Roman's 0x80–0x9F block, which is where this dataset's mojibake lands.
 * These code points are C1 control characters in Unicode and cannot appear in
 * a station name for any legitimate reason, so re-reading them is a repair
 * rather than a guess. See trap 6.
 */
const MAC_ROMAN_C1 = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü';

/**
 * IRVE schema enumerations, keyed by the ASCII skeleton of each legal value.
 *
 * Matching on the skeleton — the value with every non-ASCII character removed,
 * lowercased — folds all four observed spellings of `Accès libre` onto one
 * entry without asserting anything about which byte became which character.
 * The skeletons of the legal values stay mutually distinct (`accs libre` vs
 * `accs rserv`), so the fold can never move a value onto its neighbour.
 */
const IRVE_ENUMS = Object.freeze({
  condition_acces: Object.freeze([
    'Accès libre',
    'Accès réservé',
  ]),
  implantation_station: Object.freeze([
    'Voirie',
    'Parking public',
    'Parking privé à usage public',
    'Parking privé réservé à la clientèle',
    'Station dédiée à la recharge rapide',
  ]),
  accessibilite_pmr: Object.freeze([
    'Réservé PMR',
    'Accessible mais non réservé PMR',
    'Non accessible',
    'Accessibilité inconnue',
  ]),
});

/** Skeleton → canonical value, per enumerated field. */
const ENUM_BY_SKELETON = new Map(Object.entries(IRVE_ENUMS).map(([field, values]) => [
  field,
  new Map(values.map((value) => [asciiSkeleton(value), value])),
]));

/**
 * The ASCII skeleton of a string: non-ASCII characters removed, punctuation
 * dropped, lowercased, whitespace collapsed.
 *
 * @param {*} value
 * @returns {string}
 */
export function asciiSkeleton(value) {
  return String(value ?? '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Repair the Mac-Roman-through-Latin-1 mojibake in a published string.
 *
 * Only the C1 block is touched; every other character is returned untouched,
 * so a correctly encoded value is a no-op and a mangling this table does not
 * cover survives verbatim rather than being mangled further.
 *
 * @param {*} value - Raw published text.
 * @returns {string} Repaired text, trimmed. Empty string for null/undefined.
 */
export function repairIrveText(value) {
  const text = String(value ?? '');
  if (!text) return '';
  let repaired = '';
  for (const char of text) {
    const code = char.codePointAt(0);
    repaired += (code >= 0x80 && code <= 0x9F)
      ? MAC_ROMAN_C1[code - 0x80]
      : char;
  }
  return repaired.trim();
}

/**
 * Canonicalize a value of one of the IRVE schema's enumerated fields.
 *
 * @param {string} field - Column name (`condition_acces`, …).
 * @param {*} value - Raw published value.
 * @returns {string} A legal schema value, or the repaired text if none matches.
 */
export function canonicalIrveEnum(field, value) {
  const repaired = repairIrveText(value);
  if (!repaired) return '';
  return ENUM_BY_SKELETON.get(field)?.get(asciiSkeleton(repaired)) || repaired;
}

/**
 * Parse one of this dataset's booleans.
 *
 * Tri-state on purpose: `null` means the publisher said nothing, which is a
 * different fact from "no" and is the one the card has to keep separate. See
 * trap 5.
 *
 * @param {*} value - Raw published value.
 * @returns {?boolean} true, false, or null when unstated/unparseable.
 */
export function parseIrveBoolean(value) {
  if (value === true || value === false) return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'true' || text === '1') return true;
  if (text === 'false' || text === '0') return false;
  return null;
}

/**
 * Band a published nominal power.
 *
 * @param {*} kW - Raw `puissance_nominale`.
 * @returns {string} A band key; `inconnue` for anything outside (0, 400] kW.
 */
export function irvePowerBand(kW) {
  const power = Number(kW);
  if (!Number.isFinite(power) || power <= 0) return IRVE_UNKNOWN_BAND.key;
  for (const band of IRVE_POWER_BANDS) {
    if (power <= band.max) return band.key;
  }
  return IRVE_UNKNOWN_BAND.key;
}

/**
 * Decimal places the site key rounds to (~1.1 m).
 *
 * Not cosmetic: the same Brétigny-sur-Orge site is published at 6 decimals by
 * one feed and 7 by another (48.618492 against 48.6184923), and grouping on
 * the raw float would draw it twice, a metre apart, for ever.
 */
export const IRVE_SITE_DECIMALS = 5;

/** Stable site key for a coordinate pair. */
export function irveSiteKey(lat, lon) {
  return `${Number(lat).toFixed(IRVE_SITE_DECIMALS)},${Number(lon).toFixed(IRVE_SITE_DECIMALS)}`;
}

/**
 * Verdict on a grouped row's coordinate. See trap 7.
 *
 * @param {object} row - Grouped ODRÉ record.
 * @returns {'verified'|'unverified'|'contradicted'|'invalid'}
 */
export function irveCoordinateVerdict(row) {
  const lat = Number(row?.consolidated_latitude);
  const lon = Number(row?.consolidated_longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'invalid';
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return 'invalid';
  // Exactly (0, 0) is the consolidation's own "no coordinate" placeholder —
  // 24 rows nationally, all with a real French commune beside them.
  if (lat === 0 && lon === 0) return 'invalid';
  const verified = parseIrveBoolean(row?.consolidated_is_lon_lat_correct);
  if (verified === true) return 'verified';
  // False WITH a verified commune is the publisher's own contradiction; False
  // with no commune only means the pipeline had nothing to check against.
  const commune = repairIrveText(row?.consolidated_commune);
  return commune ? 'contradicted' : 'unverified';
}

/** Normalize `date_maj` to `YYYY-MM-DD`; the two ODS endpoints disagree on shape. */
export function irveUpdatedOn(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

/**
 * Numeric bbox predicate for the viewport query.
 *
 * `geo_point_borne` is null on every row, so Opendatasoft's `within_bbox()` is
 * unavailable and the filter has to be four comparisons on the consolidated
 * columns. Every value is formatted from a Number, so nothing user-supplied
 * reaches the ODSQL string. See trap 1.
 *
 * @param {{south:number, west:number, north:number, east:number}} box
 * @returns {string} ODSQL `where` clause.
 */
export function irveBboxWhere(box) {
  const n = (value) => Number(value).toFixed(6);
  return `consolidated_latitude>=${n(box.south)}`
    + ` AND consolidated_latitude<=${n(box.north)}`
    + ` AND consolidated_longitude>=${n(box.west)}`
    + ` AND consolidated_longitude<=${n(box.east)}`;
}

/** Operator identity used to compare publications; case and spacing are noise. */
function operatorKey(name) {
  return asciiSkeleton(name);
}

/** Signature of one operator's published power profile at a site. */
function profileSignature(byPower) {
  return [...byPower.entries()]
    .map(([power, count]) => [Number(power), count])
    .sort((a, b) => a[0] - b[0])
    .map(([power, count]) => `${power}x${count}`)
    .join('|');
}

/** Sum the values of a Map. */
function sumValues(map) {
  let total = 0;
  for (const value of map.values()) total += value;
  return total;
}

/** Most frequent non-empty string in a tally, ties broken alphabetically. */
function dominant(tally) {
  let best = '';
  let bestCount = 0;
  for (const [value, count] of tally.entries()) {
    if (!value) continue;
    if (count > bestCount || (count === bestCount && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** The five connector columns, in the order the card reads them. */
const CONNECTOR_FIELDS = Object.freeze([
  Object.freeze({ field: 'prise_type_2', key: 'type2', label: 'Type 2' }),
  Object.freeze({ field: 'prise_type_combo_ccs', key: 'ccs', label: 'Combo CCS' }),
  Object.freeze({ field: 'prise_type_chademo', key: 'chademo', label: 'CHAdeMO' }),
  Object.freeze({ field: 'prise_type_ef', key: 'ef', label: 'Prise E/F' }),
  Object.freeze({ field: 'prise_type_autre', key: 'autre', label: 'Autre' }),
]);
/** Connector key → display label. */
export const IRVE_CONNECTOR_LABELS = Object.freeze(
  Object.fromEntries(CONNECTOR_FIELDS.map(({ key, label }) => [key, label])),
);

/**
 * Fold grouped ODRÉ records into one entry per charging SITE.
 *
 * @param {object} input
 * @param {Array<object>} input.groups - `results` of the grouped query, each
 *   row carrying the group key columns plus a `pdc` count.
 * @param {?number} [input.totalCount] - The dataset's own count for the same
 *   box, used only to prove the grouped answer was complete.
 * @param {string} [input.source]
 * @returns {{sites:Array<object>, siteCount:number, pdcPublished:number,
 *   pdcDistinct:number, pdcTotal:?number, pdcWithheld:number,
 *   pdcInvalid:number, duplicateSites:number, truncated:boolean,
 *   source:string}}
 */
export function projectIrveSites({ groups, totalCount = null, source = IRVE_SOURCE } = {}) {
  const rows = Array.isArray(groups) ? groups : [];

  /** @type {Map<string, object>} */
  const bySite = new Map();
  let pdcGrouped = 0;
  let pdcWithheld = 0;
  let pdcInvalid = 0;

  for (const row of rows) {
    const count = Math.max(0, Math.trunc(Number(row?.pdc)) || 0);
    if (!count) continue;
    pdcGrouped += count;

    const verdict = irveCoordinateVerdict(row);
    if (verdict === 'invalid') {
      pdcInvalid += count;
      continue;
    }
    if (verdict === 'contradicted') {
      pdcWithheld += count;
      continue;
    }

    const lat = Number(row.consolidated_latitude);
    const lon = Number(row.consolidated_longitude);
    const key = irveSiteKey(lat, lon);
    let site = bySite.get(key);
    if (!site) {
      site = {
        key,
        // The rounded coordinate IS the site, so it is what gets drawn — using
        // the first row's raw value instead would place the dot up to a metre
        // off the point every other row in the group agrees on.
        lat: Number(lat.toFixed(IRVE_SITE_DECIMALS)),
        lon: Number(lon.toFixed(IRVE_SITE_DECIMALS)),
        profiles: new Map(),
        names: new Map(),
        networks: new Map(),
        communes: new Map(),
        implantations: new Map(),
        access: new Map(),
        pmr: new Map(),
        connectors: new Set(),
        free: new Set(),
        powers: [],
        verifiedPdc: 0,
        updatedFrom: '',
        updatedTo: '',
      };
      bySite.set(key, site);
    }

    const operator = repairIrveText(row.nom_operateur);
    const opKey = operatorKey(operator);
    let profile = site.profiles.get(opKey);
    if (!profile) {
      profile = { name: operator, byPower: new Map() };
      site.profiles.set(opKey, profile);
    }
    // Keep the best-spelled label for an operator published under several
    // casings ("SPIE CITYNETWORKS" and "SPIE CityNetworks" are one operator).
    if (operator && (!profile.name || operator.length > profile.name.length)) {
      profile.name = operator;
    }
    const power = Number(row.puissance_nominale);
    const powerKey = Number.isFinite(power) ? power : NaN;
    profile.byPower.set(powerKey, (profile.byPower.get(powerKey) || 0) + count);

    const bump = (tally, value) => {
      if (!value) return;
      tally.set(value, (tally.get(value) || 0) + count);
    };
    bump(site.names, repairIrveText(row.nom_station));
    bump(site.networks, repairIrveText(row.nom_enseigne));
    bump(site.communes, repairIrveText(row.consolidated_commune));
    bump(site.implantations, canonicalIrveEnum('implantation_station', row.implantation_station));
    bump(site.access, canonicalIrveEnum('condition_acces', row.condition_acces));
    bump(site.pmr, canonicalIrveEnum('accessibilite_pmr', row.accessibilite_pmr));
    for (const { field, key: connectorKey } of CONNECTOR_FIELDS) {
      if (parseIrveBoolean(row[field]) === true) site.connectors.add(connectorKey);
    }
    site.free.add(parseIrveBoolean(row.gratuit));
    if (verdict === 'verified') site.verifiedPdc += count;

    const updated = irveUpdatedOn(row.date_maj);
    if (updated) {
      if (!site.updatedFrom || updated < site.updatedFrom) site.updatedFrom = updated;
      if (!site.updatedTo || updated > site.updatedTo) site.updatedTo = updated;
    }
  }

  const sites = [];
  let pdcPublished = 0;
  let pdcDistinct = 0;
  let duplicateSites = 0;

  for (const site of bySite.values()) {
    // Collapse operators whose power profile is character-for-character the
    // same publication. Overlapping profiles are left alone: two operators
    // that genuinely share a car park are two operators. See trap 3.
    const bySignature = new Map();
    for (const profile of site.profiles.values()) {
      const signature = profileSignature(profile.byPower);
      const bucket = bySignature.get(signature);
      if (bucket) bucket.push(profile);
      else bySignature.set(signature, [profile]);
    }

    const kept = [];
    const collapsed = [];
    for (const bucket of bySignature.values()) {
      const ordered = [...bucket].sort((a, b) => a.name.localeCompare(b.name));
      kept.push(ordered[0]);
      for (const duplicate of ordered.slice(1)) {
        if (duplicate.name) collapsed.push(duplicate.name);
      }
    }

    const published = [...site.profiles.values()].reduce((sum, p) => sum + sumValues(p.byPower), 0);
    const distinct = kept.reduce((sum, p) => sum + sumValues(p.byPower), 0);

    const bands = Object.fromEntries(IRVE_BAND_KEYS.map((key) => [key, 0]));
    let peakKW = null;
    for (const profile of kept) {
      for (const [power, count] of profile.byPower.entries()) {
        const band = irvePowerBand(power);
        bands[band] += count;
        if (band !== IRVE_UNKNOWN_BAND.key && (peakKW === null || power > peakKW)) {
          peakKW = power;
        }
      }
    }
    // Highest band with anything in it. `inconnue` is never a "top" band — a
    // site whose only usable reading is a 7 kW socket is a 7 kW site even when
    // a second row beside it publishes 7 360.
    let topBand = IRVE_UNKNOWN_BAND.key;
    for (const key of IRVE_POWER_BANDS.map((band) => band.key)) {
      if (bands[key] > 0) topBand = key;
    }

    // A site is free only if every surviving publication says so; one silent
    // or paying publication makes the answer "unstated", not "free".
    const freeFlags = [...site.free];
    const free = freeFlags.length === 1 ? freeFlags[0] : null;

    if (collapsed.length) duplicateSites += 1;
    pdcPublished += published;
    pdcDistinct += distinct;

    sites.push({
      id: site.key,
      lat: site.lat,
      lon: site.lon,
      name: dominant(site.names),
      commune: dominant(site.communes),
      operators: kept.map((profile) => profile.name).filter(Boolean).sort(),
      networks: [...site.networks.keys()].sort(),
      duplicateOperators: collapsed.sort(),
      pdcPublished: published,
      pdcDistinct: distinct,
      bands,
      topBand,
      peakKW,
      implantation: dominant(site.implantations),
      access: dominant(site.access),
      pmr: dominant(site.pmr),
      connectors: CONNECTOR_FIELDS
        .filter(({ key }) => site.connectors.has(key))
        .map(({ key }) => key),
      free,
      // A site is only "verified" when every charge point at it was; a mixed
      // site keeps the weaker claim.
      coordVerified: site.verifiedPdc === published && published > 0,
      updatedFrom: site.updatedFrom,
      updatedTo: site.updatedTo,
    });
  }

  sites.sort((a, b) => b.pdcDistinct - a.pdcDistinct || a.id.localeCompare(b.id));

  // The grouped query is complete when its counts add up to the dataset's own
  // count for the same box — the one check that would catch a silent
  // aggregation cap, which no error field would report.
  //
  // `Number(null)` is 0, not NaN, so an ABSENT count has to be rejected before
  // the numeric check: coerced, it would be reported to the client as a box
  // holding zero charge points.
  const counted = totalCount === null || totalCount === undefined || totalCount === ''
    ? NaN
    : Number(totalCount);
  const expected = Number.isFinite(counted) ? counted : NaN;
  const truncated = Number.isFinite(expected) && expected > 0 && pdcGrouped < expected;

  return {
    sites,
    siteCount: sites.length,
    pdcPublished,
    pdcDistinct,
    pdcTotal: Number.isFinite(expected) ? expected : null,
    pdcWithheld,
    pdcInvalid,
    duplicateSites,
    truncated,
    source,
  };
}
