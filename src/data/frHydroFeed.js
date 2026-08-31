/**
 * French hydro register projection — the pure half of the Petite hydro layer.
 *
 * Lives here rather than inside the build script for the reason
 * `rteGenerationFeed.js` and `edfPlantsFeed.js` do: the shapes ODRÉ publishes
 * are strange in specific, repeatable ways, and the only thing that keeps a
 * normalisation honest across a rebuild is a test against captured rows. The
 * build script (`scripts/build-fr-hydro-registry.mjs`) imports these functions;
 * so does the browser layer, for the display half.
 *
 * ── What this register is ───────────────────────────────────────────────────
 * ODRÉ's *Registre national des installations de production et de stockage
 * d'électricité* is the only nationwide list of French hydro. Measured on the
 * 30/06/2026 edition: **2 757 hydraulic installations, 26,04 GW**, against the
 * 51 plants EDF Open Data publishes and the 56 the ≥ 100 MW `units.json`
 * registry carries. It is the reason the nine SHEM plants at Laruns — 223,9 MW
 * in one commune of the Pyrénées-Atlantiques — were on no layer of this globe:
 * every other French source this project reads is either EDF-only or has a
 * 100 MW floor, and Laruns is neither EDF nor above 100 MW.
 *
 * ── The trap that shapes everything here: no coordinates ────────────────────
 * **The register publishes no position.** Not a point, not a parcel — a commune
 * INSEE code and nothing else. Every marker this layer draws is therefore a
 * JOIN, and the join succeeds for some plants and fails for others. That
 * failure is not hidden: see `PLACEMENT_TIERS`.
 *
 * ── The second trap: half the register has no name ──────────────────────────
 * 1 359 of the 2 757 rows publish `nominstallation` as the literal string
 * `"Confidentiel"` — small private installations whose operator is a person,
 * anonymised by the publisher. `plantName()` returns `null` for those rather
 * than the word "Confidentiel", because "Confidentiel" is not a plant's name
 * and no card should print it as one.
 *
 * What survives anonymisation is most of the row. Measured across the 1 359:
 * commune 100 %, installed power 100 %, technology 96 %, commissioning date
 * 100 %, connection voltage 100 %, source substation 95 %, grid operator 100 %,
 * EIC code 100 %, and rolling twelve-month energy injected 90 %. An anonymous
 * plant is a full card missing one line, not an empty one.
 *
 * ── The third trap: published zeros that mean "not published" ───────────────
 * `hauteurchute`, `debitmaximal`, `productible`, `capacitereservoir` and
 * `energiestockable` are published as `0.0` on rows that simply do not declare
 * them. Measured across all 2 757 hydro rows, the share carrying a NON-ZERO
 * value is: head 24 %, annual productible 8 %, reservoir capacity 3 %, and
 * **maximum flow 0 % — the column is zero on every single row in France**. They
 * are therefore read through `positiveOrNull()`, and `debitmaximal` is not read
 * at all: a layer that showed "0 m³/s" would be asserting a stopped turbine on
 * 2 757 running plants.
 *
 * ── The fourth trap: 26 hydro plants published as photovoltaic ──────────────
 * `technologie` is `Photovoltaïque` on 26 rows whose `codefiliere` is `HYDLQ`.
 * 25 of them are in Corsica, all connected by EDF-SEI, and they are the
 * island's actual hydroelectric fleet: Rizzanese at Sainte-Lucie-de-Tallano
 * (55 MW), Lugo-di-Nazza (43 MW), Castirla (28,5 MW), Tolla, Calacuccia, Ocana,
 * Asco. 220,9 MW of hydro carrying the wrong technology in the publisher's own
 * file.
 *
 * The filière is right and the technology is wrong, so the rows are KEPT and
 * the technology is refused: `techKey` is null for any value outside the five
 * hydro technologies, while `tech` preserves the published string verbatim so
 * the anomaly stays visible in the file instead of being quietly corrected to
 * something this project made up. The same rule catches the register's own
 * `Autre` on three Tarn mills.
 *
 * ── The one measurement in the file ─────────────────────────────────────────
 * `energieannuelleglissanteinjectee` is real: the energy actually injected over
 * the trailing twelve months, in kWh, present and non-zero on 94 % of rows. It
 * is the only figure here that is an OUTPUT rather than a nameplate, which is
 * why it is carried under a name that says so and why `loadFactor()` exists —
 * 74 MW at Miégebat against 188 GWh injected is 29 %, and that ratio is the
 * single most informative thing this register can tell a reader about a plant
 * whose name it refuses to publish.
 *
 * @module data/frHydroFeed
 */

/** ODRÉ dataset carrying the current edition of the register. */
export const HYDRO_REGISTRY_DATASET = 'registre-national-installation-production-stockage-electricite-agrege';

/** The register's own word for the filière this layer draws. */
export const HYDRO_FILIERE = 'Hydraulique';

/**
 * Default publication floor, in kilowatts.
 *
 * Zero — the layer draws the register entire, down to the 40 kW mill at
 * Monteils. The floor exists as a build knob, not as an editorial position:
 * see the README for what each floor costs in coverage.
 */
export const HYDRO_FLOOR_KW = 0;

/**
 * How far a candidate position may sit from the commune the register names.
 *
 * 12 km, against the 30 km the ≥ 100 MW registry allows. That registry places
 * reactors and thermal stations, which sit in flat communes near their own
 * name; this one places powerhouses at the bottom of Alpine and Pyrenean
 * valleys where two plants 15 km apart can share a name and a river. It is
 * re-tested on the FINAL position, after a scheme-wide match has been snapped
 * to its generating hall — a snap moves a point by up to 7,5 km, so checking
 * only the candidate's bbox centre would let the drawn dot escape the ring it
 * was supposed to be inside.
 */
export const HYDRO_MAX_ANCHOR_KM = 12;

/**
 * Where a drawn position came from, best evidence first.
 *
 * The tiers are ordered by how much is INFERRED, not by how precise the number
 * looks — with one deliberate exception at the top. `ign-bdtopo` is IGN's
 * surveyed footprint of the building, joined on the INSEE code both IGN and the
 * register publish, and it carries IGN's own planimetric accuracy; it is
 * allowed to REFINE a position any other tier established, because it is the
 * only source here that measured the building. `edf-published` infers nothing
 * about which object the plant is — the
 * operator published a point for a station it names. `osm-plant` infers that a
 * volunteer-mapped object IS this register row, from its name or its megawatts.
 * `rte-switchyard` infers nothing about identity — the register's `postesource`
 * and OSM's `ref:FR:RTE` are the same published code — but it points at the
 * connection yard rather than the generating hall, so it is the last resort.
 * `commune-centre` infers nothing and asserts nothing beyond the commune, which
 * is why plants that land there are not drawn as plants at all (see
 * `clusterUnplaced`).
 *
 * Orthogonal to the tier is WHICH OBJECT the coordinate is, carried separately
 * as `geometry` — see `GEOMETRY_NOTES` in `frHydroPlants.js`. An `osm-plant`
 * position can be the plant's own outline or the generators inside a scheme too
 * large to be one, and the difference is kilometres.
 */
export const PLACEMENT_TIERS = Object.freeze([
  'ign-bdtopo', 'edf-published', 'osm-plant', 'rte-switchyard', 'commune-centre',
]);

/**
 * The register's technology vocabulary, with the palette the layer draws it in.
 *
 * These are the publisher's own five values, not a taxonomy invented here.
 * Colour never carries the meaning alone: every marker's label names the
 * technology in words, and the hues are separated in lightness as well as hue
 * so the layer survives deuteranopia.
 *
 * Counts measured on the 30/06/2026 edition, all filières hydrauliques:
 * fil de l'eau 2 305, éclusée 177, lac 107, hydrolien fluvial 45,
 * pompage-turbinage 34, unpublished 60.
 */
export const HYDRO_TECHNOLOGIES = Object.freeze({
  "Fil de l'eau": Object.freeze({
    key: 'run-of-river', label: "Fil de l'eau", color: '#4fc3f7',
    blurb: 'Turbine le débit qui se présente, sans réserve',
  }),
  Eclusée: Object.freeze({
    key: 'pondage', label: 'Éclusée', color: '#66d9a6',
    blurb: 'Réserve de quelques heures à quelques jours',
  }),
  Lac: Object.freeze({
    key: 'reservoir', label: 'Lac', color: '#c792ea',
    blurb: 'Retenue saisonnière, turbinée à la pointe',
  }),
  'Pompage turbinage': Object.freeze({
    key: 'pumped', label: 'Pompage-turbinage', color: '#ffd166',
    blurb: 'STEP — remonte l’eau aux heures creuses',
  }),
  'Hydrolien fluvial': Object.freeze({
    key: 'instream', label: 'Hydrolien fluvial', color: '#7fd4c1',
    blurb: 'Turbine immergée, sans ouvrage de chute',
  }),
});

/** Technology order for the legend — largest installed fleet first. */
export const HYDRO_TECHNOLOGY_ORDER = Object.freeze([
  "Fil de l'eau", 'Eclusée', 'Lac', 'Pompage turbinage', 'Hydrolien fluvial',
]);

/** Neutral hue for a row whose technology the register leaves blank or wrong. */
export const HYDRO_UNKNOWN_COLOR = '#8fa3b8';

/** Bucket label for rows whose technology this layer refuses to colour. */
export const HYDRO_UNKNOWN_TECH_LABEL = 'Non publiée';

/**
 * The technology bucket a plant counts in, for legends and roll-ups.
 *
 * Only the five real hydro technologies get their own bucket. A row published
 * as `Photovoltaïque` or `Autre` counts as unpublished HERE — its raw string
 * still travels on the record and still reaches the card, but it is not given a
 * slice of a hydro legend it does not belong in. See trap 4.
 * @param {{techKey?:string|null}|null|undefined} plant
 * @returns {string}
 */
export function techBucket(plant) {
  const key = plant?.techKey ?? null;
  if (!key) return HYDRO_UNKNOWN_TECH_LABEL;
  const entry = Object.values(HYDRO_TECHNOLOGIES).find((tech) => tech.key === key);
  return entry ? entry.label : HYDRO_UNKNOWN_TECH_LABEL;
}

/**
 * The literal string ODRÉ writes where an installation's name is withheld.
 *
 * Matched exactly, and only in `nominstallation`. A plant genuinely called
 * something containing this word would keep its name.
 */
export const ANONYMOUS_NAME = 'Confidentiel';

/**
 * Read a number that the register publishes as `0` when it means "not
 * declared".
 *
 * See trap 3 in the module header. Applied ONLY to the columns measured to
 * behave this way — never to `puismaxinstallee`, where zero would be a real
 * (and reportable) fact, and never to the energy column, where a genuine zero
 * means a plant that injected nothing in twelve months.
 * @param {unknown} value
 * @returns {number|null}
 */
export function positiveOrNull(value) {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * A finite number, or null. Zero survives.
 * @param {unknown} value
 * @returns {number|null}
 */
export function finiteOrNull(value) {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The installation's name, or null where the publisher withheld it.
 *
 * Returning null rather than `"Confidentiel"` is the whole point: it forces
 * every consumer to decide what to show in place of a name instead of printing
 * a French word for "redacted" as though it were one.
 * @param {object|null|undefined} row Raw ODRÉ record.
 * @returns {string|null}
 */
export function plantName(row) {
  const raw = String(row?.nominstallation ?? '').trim();
  if (!raw || raw === ANONYMOUS_NAME) return null;
  return raw;
}

/**
 * Strip the register's internal decoration from a plant name.
 *
 * RTE-connected rows are published as `<CODE>-<NAME>-<n>`:
 * `MIEGEH-CENTRALE HYDRAULIQUE DE MIEGEBAT-3`, `RANDEH-CENTRALE HYDRAULIQUE DE
 * RANDENS-2`. The prefix is an internal code — usually, but NOT always, the
 * `postesource` plus a filière letter — the suffix is a revision, and neither is
 * part of what the plant is called.
 *
 * **Both halves must be present, or nothing is stripped.** Recognising the
 * prefix alone is what made `GRAND-MAISON` normalise to `maison`: `GRAND` is
 * five uppercase characters followed by a hyphen, which is indistinguishable
 * from `MIEGEH-` by shape. That silently broke the join between EDF's own
 * coordinate for France's largest hydro plant and the register row for it, and
 * it would have eaten the real names `HYDR-AUZENE` and `COLY-LAMALETTE` too.
 *
 * Measured over the 1 398 named rows of the 30/06/2026 edition: 384 carry both
 * halves (and are undecorated here), 8 carry a prefix-shaped first word with no
 * revision suffix (and are left alone — `GRAND-MAISON` is one of them), 21
 * carry a trailing `-n` with no prefix, and 985 carry no decoration at all.
 * Requiring the pair is what tells those four groups apart.
 * @param {string|null|undefined} name
 * @returns {string|null}
 */
export function undecorateName(name) {
  const text = String(name ?? '').trim();
  if (!text) return null;
  const decorated = /^[A-Z0-9.]{4,6}-(?=[A-ZÀ-Ý])(.*)-\d+$/.exec(text);
  return (decorated ? decorated[1].trim() : text) || null;
}

/**
 * Fold a name to the token set two sources can be compared on.
 *
 * Accents, case, punctuation and the vocabulary EVERY French hydro plant shares
 * are removed — a match on the word "centrale" is not evidence of anything. The
 * corporate-form words are stripped for the same reason: `SARL LES MOULINS` and
 * `Les Moulins` are the same mill.
 * @param {string|null|undefined} name
 * @returns {string}
 */
export function normalizeHydroName(name) {
  const undecorated = undecorateName(name);
  if (!undecorated) return '';
  return undecorated
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[''`]/g, ' ')
    .replace(/\b(centrale|centrales|microcentrale|usine|hydroelectrique|hydroelectriques|hydraulique|hydrauliques|electrique|electriques|amenagement|sarl|sas|sasu|snc|sci|scea|societe|ste|eurl|gaec|earl|edf|dpih|shem|cnr|de|du|des|d|la|le|les|l|et|en|sur|sous|a|au|aux)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * How strongly two normalised names agree, as evidence for a join.
 *
 * 1 — identical token sets. 0.5 — every token of the shorter set appears in the
 * longer one, AND the shorter set is either several tokens carrying one of four
 * characters or more, or a single token of six or more. 0 — anything else.
 *
 * The single-token rule is what stops the register's `CENTRALE HYDROELECTRIQUE
 * DU PONT` — which normalises to the one word `pont` — from claiming
 * OpenStreetMap's `Centrale de Pont de Camps` in the next valley. Short shared
 * tokens are exactly the ones French place names repeat everywhere, and a join
 * built on one of them is a coin toss wearing evidence's clothes. Six
 * characters keeps `artouste`, `miegebat` and `espalungue`; it refuses `pont`,
 * `moulin` is six and survives, which is why a partial match is recorded as
 * `name-partial` on the card rather than presented as a name match.
 * @param {string} a Normalised name.
 * @param {string} b Normalised name.
 * @returns {number} 0, 0.5 or 1.
 */
export function hydroNameMatch(a, b) {
  const left = String(a || '').split(' ').filter(Boolean);
  const right = String(b || '').split(' ').filter(Boolean);
  if (!left.length || !right.length) return 0;
  const setL = new Set(left);
  const setR = new Set(right);
  if (setL.size === setR.size && [...setL].every((token) => setR.has(token))) return 1;
  const [small, large] = setL.size <= setR.size ? [setL, setR] : [setR, setL];
  const floor = small.size === 1 ? 6 : 4;
  if (![...small].some((token) => token.length >= floor)) return 0;
  return [...small].every((token) => large.has(token)) ? 0.5 : 0;
}

/**
 * Parse OpenStreetMap's `plant:output:electricity` into megawatts.
 *
 * The tag is free text with a unit: `74 MW`, `677 kW`, `1.5 MW`, and the
 * non-numeric `yes` / `small_installation` that mean "there is a plant here,
 * size unrecorded". Those return null rather than 0 — a plant of unknown size
 * must not match a register row of any size.
 * @param {string|null|undefined} tag
 * @returns {number|null} Megawatts.
 */
export function parseOsmOutputMw(tag) {
  const match = /^\s*([\d.,]+)\s*(k|M|G)?W\b/i.exec(String(tag ?? ''));
  if (!match) return null;
  const value = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  const scale = { K: 0.001, M: 1, G: 1000 }[(match[2] || 'M').toUpperCase()];
  return value * scale;
}

const EARTH_MEAN_RADIUS_KM = 6371.0088;

/**
 * Great-circle distance in kilometres.
 * @param {{lat:number, lon:number}} a
 * @param {{lat:number, lon:number}} b
 * @returns {number}
 */
export function haversineKm(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MEAN_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * `DD/MM/YYYY` — the register's date format — as ISO `YYYY-MM-DD`.
 *
 * The register ALSO publishes `datemiseenservice_date` already in ISO, but only
 * for that one column; `dateraccordement` exists solely in the slash form. One
 * parser, used for both, so the two dates cannot end up in two formats on one
 * card.
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
export function parseFrenchDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value ?? '').trim());
  if (!match) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? '').trim());
    return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  }
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/**
 * Capacity factor from installed power and twelve-month energy.
 *
 * The register gives kW and kWh, so the denominator is `kW × 8760`. Returns
 * null rather than 0 when either side is missing — an unreported energy is not
 * an idle plant.
 * @param {number|null|undefined} kw Installed power.
 * @param {number|null|undefined} kwh Rolling twelve-month energy injected.
 * @returns {number|null} Fraction in [0, 1+), unrounded.
 */
export function loadFactor(kw, kwh) {
  if (!Number.isFinite(kw) || kw <= 0) return null;
  if (!Number.isFinite(kwh) || kwh <= 0) return null;
  return kwh / (kw * 8760);
}

/**
 * Project one raw ODRÉ register row into the shape this project ships.
 *
 * Everything the register publishes about a hydro installation and nothing it
 * does not. Columns dropped deliberately: `debitmaximal` (zero on every row in
 * France), `energiestockable` (likewise), `codes3renr`, the IRIS codes, and the
 * three `energieannuelleglissante*` columns other than `injectee`, which are
 * null on every hydro row measured.
 * @param {object} row Raw ODRÉ record.
 * @returns {object|null} Null when the row carries no usable identity.
 */
export function projectHydroRow(row) {
  const kw = finiteOrNull(row?.puismaxinstallee);
  const insee = String(row?.codeinseecommune ?? '').trim();
  if (kw === null || !insee) return null;
  const eic = String(row?.codeeicresourceobject ?? '').trim();
  const name = plantName(row);
  return {
    // The EIC code is the register's own stable key and the one RTE's live API
    // would join on if these plants were ever big enough for it to publish.
    // A row without one falls back to a key built from commune and power,
    // which is stable across editions for as long as neither changes.
    id: eic || `${insee}:${Math.round(kw)}`,
    eic: eic || null,
    name,
    anonymous: name === null,
    kw,
    // The publisher's string, verbatim — including the 26 rows that say
    // `Photovoltaïque` about a hydro plant (trap 4).
    tech: String(row?.technologie ?? '').trim() || null,
    // …and the key the legend and the palette are allowed to use, which is
    // null unless the published value is one of the five real hydro
    // technologies. A wrong value is shown, never coloured.
    techKey: HYDRO_TECHNOLOGIES[String(row?.technologie ?? '').trim()]?.key ?? null,
    regime: String(row?.regime ?? '').trim() || null,
    commissioned: parseFrenchDate(row?.datemiseenservice),
    connected: parseFrenchDate(row?.dateraccordement),
    voltage: String(row?.tensionraccordement ?? '').trim() || null,
    poste: String(row?.postesource ?? '').trim() || null,
    operator: String(row?.gestionnaire ?? '').trim() || null,
    commune: String(row?.commune ?? '').trim() || null,
    insee,
    departement: String(row?.departement ?? '').trim() || null,
    region: String(row?.region ?? '').trim() || null,
    headM: positiveOrNull(row?.hauteurchute),
    groups: positiveOrNull(row?.nbgroupes),
    reservoirMm3: positiveOrNull(row?.capacitereservoir),
    productibleKwh: positiveOrNull(row?.productible),
    // The one measurement. Named for what it is so no consumer can read it as
    // a capacity, and kept even when zero — see `positiveOrNull`'s contract.
    energyKwh: finiteOrNull(row?.energieannuelleglissanteinjectee),
    // How many physical installations this row stands for. 2 742 of 2 757 rows
    // say 1; the rest are the publisher's own commune-level aggregates of
    // small identical installations, and a card that said "1 plant" on a row
    // covering 21 would be wrong.
    installations: positiveOrNull(row?.nbinstallations) ?? 1,
  };
}

/**
 * Roll the plants that reached no better anchor than their commune into one
 * marker per commune.
 *
 * WHY THIS EXISTS. Drawing an unplaced plant at its commune centre would be
 * wrong twice. It is wrong about WHERE: measured across the 998 plants this
 * build does place, the commune centre sits a median 2,5 km from the
 * powerhouse and more than 3 km away for half of them — in the Alps and the
 * Pyrénées that is routinely the wrong side of a ridge, in a different valley,
 * on a different river. And it is wrong about HOW MANY: seven plants in one
 * commune become seven markers on one pixel, each claiming to be somewhere.
 *
 * So they are drawn as ONE marker that claims only what the register actually
 * says — this commune contains N hydro installations totalling X kW — and the
 * layer renders it as a commune, not as a plant.
 *
 * @param {Array<object>} plants Projected rows with no resolved position.
 * @param {Map<string, {lat:number, lon:number, nom?:string}>} centres By INSEE.
 * @returns {Array<object>} One cluster per commune, largest first.
 */
export function clusterUnplaced(plants, centres) {
  const byCommune = new Map();
  for (const plant of Array.isArray(plants) ? plants : []) {
    const centre = centres?.get?.(plant.insee);
    if (!centre || !Number.isFinite(centre.lat) || !Number.isFinite(centre.lon)) continue;
    let bucket = byCommune.get(plant.insee);
    if (!bucket) {
      bucket = {
        id: `INSEE:${plant.insee}`,
        insee: plant.insee,
        commune: plant.commune || centre.nom || null,
        departement: plant.departement,
        region: plant.region,
        lat: centre.lat,
        lon: centre.lon,
        placement: 'commune-centre',
        plants: 0,
        installations: 0,
        anonymous: 0,
        kw: 0,
        // The largest single installation in the roll-up. The layer's power
        // floor tests THIS rather than the commune total: a ring is shown when
        // the commune holds a plant that clears the floor, not when the sum of
        // a dozen mills happens to.
        maxKw: 0,
        energyKwh: null,
        names: [],
        techs: {},
      };
      byCommune.set(plant.insee, bucket);
    }
    bucket.plants += 1;
    bucket.installations += plant.installations;
    bucket.kw += plant.kw;
    bucket.maxKw = Math.max(bucket.maxKw, plant.kw);
    if (plant.anonymous) bucket.anonymous += 1;
    else if (bucket.names.length < 8) bucket.names.push(undecorateName(plant.name));
    if (Number.isFinite(plant.energyKwh)) {
      bucket.energyKwh = (bucket.energyKwh ?? 0) + plant.energyKwh;
    }
    const tech = techBucket(plant);
    bucket.techs[tech] = (bucket.techs[tech] || 0) + 1;
  }
  const clusters = [...byCommune.values()];
  for (const cluster of clusters) cluster.kw = Math.round(cluster.kw * 1000) / 1000;
  clusters.sort((a, b) => b.kw - a.kw || a.insee.localeCompare(b.insee));
  return clusters;
}

/**
 * Fleet figures, recomputed from what will actually be drawn.
 *
 * Deliberately reports placed and clustered capacity SEPARATELY as well as
 * together: "26 GW of French hydro" and "26 GW of French hydro drawn where it
 * physically is" are different claims, and the layer makes only the first.
 * @param {Array<object>} plants Placed plants.
 * @param {Array<object>} clusters Commune roll-ups.
 * @returns {object}
 */
export function summarizeHydro(plants, clusters) {
  const list = Array.isArray(plants) ? plants : [];
  const groups = Array.isArray(clusters) ? clusters : [];
  const byTech = {};
  const placement = {};
  let placedKw = 0;
  let anonymous = 0;
  for (const plant of list) {
    placedKw += plant.kw ?? 0;
    if (plant.anonymous) anonymous += 1;
    const tech = techBucket(plant);
    const bucket = byTech[tech] || (byTech[tech] = { plants: 0, kw: 0 });
    bucket.plants += 1;
    bucket.kw += plant.kw ?? 0;
    placement[plant.placement] = (placement[plant.placement] || 0) + 1;
  }
  let clusteredKw = 0;
  let clusteredPlants = 0;
  for (const cluster of groups) {
    clusteredKw += cluster.kw ?? 0;
    clusteredPlants += cluster.plants ?? 0;
    anonymous += cluster.anonymous ?? 0;
  }
  const round = (v) => Math.round(v * 1000) / 1000;
  for (const bucket of Object.values(byTech)) bucket.kw = round(bucket.kw);
  return {
    plants: list.length + clusteredPlants,
    placed: list.length,
    clustered: clusteredPlants,
    communes: groups.length,
    anonymous,
    placedKw: round(placedKw),
    clusteredKw: round(clusteredKw),
    installedKw: round(placedKw + clusteredKw),
    placement: { ...placement, 'commune-centre': clusteredPlants },
    byTech,
  };
}
