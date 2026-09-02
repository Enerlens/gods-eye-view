/**
 * French weather-station projection — the pure half of the Stations météo layer.
 *
 * Lives here rather than inside the build script for the reason `frHydroFeed.js`
 * does: the shapes Météo-France publishes are strange in specific, repeatable
 * ways, and the only thing that keeps a normalisation honest across a rebuild is
 * a test against captured rows. `scripts/build-meteo-stations-fr.mjs` imports
 * these functions; so does the browser layer, for the display half, and so does
 * the dev-server proxy, for the two live readings.
 *
 * ── What this network is ────────────────────────────────────────────────────
 * Météo-France's *liste des stations du réseau d'observation temps réel*:
 * **2 144 stations**, 1 818 in metropolitan France and 326 overseas, from sea
 * level to the Aiguille du Midi at 3 845 m. It is a different list from the
 * climatological register — that one carries **14 751 postes back to 1806, of
 * which only 2 404 are still open** — and a different list again from the 699
 * *stations complémentaires* run by the DGPR, the DIR routes, the DREAL and
 * EDF. This layer draws the real-time network, because that is the one that is
 * measuring the weather right now.
 *
 * ── The trap that names this layer: a weather station measures almost nothing ─
 * A reader who turns this layer on expects each dot to know the temperature,
 * the wind, the pressure and the humidity. Measured against Météo-France's own
 * per-station parameter inventory:
 *
 *   température sous abri  2 084     insolation      228
 *   précipitations         2 068     visibilité      211
 *   humidité                 860     temps présent   206
 *   vent à 10 m              845     nébulosité      186
 *   neige au sol             309     chaussée        149
 *   rayonnement global       270     sol (-10 cm)    132
 *   pression                 234     état de la mer   44
 *
 * **1 254 of the 2 144 — 58 % — measure temperature and rain and nothing
 * else.** Only 228 measure the five a reader means by "weather station", and
 * only 845 can tell you which way the wind is blowing. `STATION_CLASSES` is
 * that measurement turned into the layer's palette, so the map says what each
 * dot can and cannot answer instead of drawing 2 144 identical instruments.
 *
 * ── The second trap: the live list still carries closed stations ─────────────
 * Seven rows of the real-time list are stations Météo-France's OWN metadata
 * records as closed — MARSILLARGUES on 2026-01-01, DESHAIES GENDARMERIE on
 * 2024-10-01, ST JOSEPH-CIRAD and TAN ROUGE-CIRAD on 2023-03-29. They are kept
 * and flagged, never silently dropped: a station that stopped reporting is a
 * fact about the network, and `closed` puts it on the card.
 *
 * ── The third trap: the SYNOP list names a third of the SYNOP product ────────
 * Météo-France publishes a *liste des stations SYNOP* with **62** rows. The
 * archive that list describes carries **190** — Boulogne-sur-Mer, Le Touquet,
 * Dunkerque, Dieppe, Beauvais-Tillé, Ouessant-Stiff and 123 others write an
 * open hourly observation the list never mentions, and every one of the 190
 * resolves to a station in the real-time list. It fails the other way too:
 * **CAP CEPET (07661) is named in the list and has written nothing all year.**
 * So `synop` (named) and `live` (publishing) are shipped as separate fields and
 * the layer counts on the second.
 *
 * ── The fourth trap: the popular SYNOP mirrors died on 2026-01-15 ────────────
 * Every OpenDataSoft copy of *Données SYNOP essentielles OMM* — the
 * `public.opendatasoft.com` one and the Toulouse Métropole one that data.gouv
 * links to — stops at **2026-01-15T09:00Z**, measured 2026-09-02. Météo-France's
 * own S3 archive was written that same morning and carries observations to the
 * previous hour. Anything reading a mirror for "current French weather" has been
 * serving a seven-month-old reading since January. See `SYNOP_ARCHIVE_URL`.
 *
 * ── The fifth trap: Corsica is département 20 here ───────────────────────────
 * `NUM_POSTE` is `DDCCCNNN` on the 1976 département numbering, so Corsican
 * stations are `20xxxxxx` and no station in France carries `2A` or `2B`.
 * `departementOf` returns what the identifier says and does not invent the
 * modern code, because the identifier is the join key.
 *
 * @module data/meteoStationsFrFeed
 */

/**
 * The real-time station list — Météo-France's own, via data.gouv.fr.
 *
 * A stable data.gouv resource id, not a dated static URL: this file is
 * re-published in place when the network changes, and the resource id survives
 * that. Columns: `Id_station;Id_omm;Nom_usuel;Latitude;Longitude;Altitude;
 * Date_ouverture;Pack`.
 */
export const RT_STATIONS_URL = 'https://www.data.gouv.fr/fr/datasets/r/79cdea2f-55c5-43b2-82c4-4a82534bba0a';

/**
 * The stations Météo-France's SYNOP list SAYS publish with no key.
 *
 * It names 62. The product it describes contains 190 — see trap 3. The list is
 * still read, because "named in the list" and "actually publishes" are two
 * facts a card is entitled to keep apart, and they disagree in both directions.
 */
export const SYNOP_STATIONS_URL = 'https://www.data.gouv.fr/api/1/datasets/r/8d205e4f-1dc2-42d4-868b-ab373e27bb27';

/**
 * Every poste the climatological base knows, open or closed, since 1806.
 *
 * Read for the commune, the lieu-dit, the current poste type and — the reason
 * it is read at all — `DATFERM`, which is what catches the seven closed
 * stations the real-time list still carries.
 */
export const POSTES_URL = 'https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/POSTES/POSTES_MF.csv';

/**
 * Per-station metadata: producers, position history, poste types over time and
 * — the payload this build wants — every parameter the station has ever
 * measured, each with its own start and end date.
 *
 * **191 MB.** It is downloaded once at build time and never shipped; what
 * survives into the pack is fourteen booleans per station. There is no smaller
 * form of this file: Météo-France publishes the whole inventory or nothing.
 */
export const FICHES_URL = 'https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/METADONNEES_STATION/fiches.json';

/**
 * The running-year SYNOP archive — the only live keyless observation product
 * Météo-France still publishes.
 *
 * 22 MB gzipped, single-member, so no range request can reach its tail; the
 * proxy therefore fetches it whole, keeps the newest observation per station,
 * and caches. That cost is deliberate and is why the fetch is LAZY — see
 * `SYNOP_CACHE_MS` and the `/api/meteo-stations/observations` handler. The alternative
 * was a mirror that has been seven months stale since January (trap 3).
 */
export const SYNOP_ARCHIVE_URL = 'https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/OBS/SYNOP/synop_%YEAR%.csv.gz';

/**
 * A station's *fiche climatologique*: 1991-2020 normals and the records held at
 * that station, with the period each record was established over.
 *
 * ~6 kB of semicolon-separated text per station, keyless, published for **1 578
 * postes of which 1 230 are in the real-time network**. Fetched per card, never
 * bundled — 1 230 × 6 kB is 7 MB to answer a question most readers never ask.
 */
export const FICHECLIM_URL = 'https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/REF_STATION/FICHECLIM_%ID%.data';

/** How long a fetched SYNOP tail stays warm. Upstream writes hourly. */
export const SYNOP_CACHE_MS = 3_600_000;

/** How long a parsed fiche climatologique stays warm. It moves once a year. */
export const NORMALS_CACHE_MS = 86_400_000;

/**
 * The two publication packs the real-time list distinguishes.
 *
 * `RADOME` is the reference network — 696 stations, expertised at J+1, the ones
 * whose readings Météo-France stands behind. `ETENDU` is the other 1 448.
 * The distinction is the publisher's own and is NOT a quality claim this
 * project invented; it is shown because a reader comparing two dots a valley
 * apart is entitled to know one of them is in the reference network.
 */
export const STATION_PACKS = Object.freeze({
  RADOME: Object.freeze({ label: 'RADOME', blurb: 'réseau de référence, expertisé à J+1' }),
  ETENDU: Object.freeze({ label: 'Étendu', blurb: 'réseau complémentaire temps réel' }),
});

/**
 * Météo-France's own poste typology, verbatim from `POSTES_descriptif_champs`.
 *
 * Type 5 does not appear here: those are the *stations complémentaires* run by
 * other bodies, published in a separate file, and none of them is in the
 * real-time list this layer draws.
 */
export const POSTE_TYPES = Object.freeze({
  0: 'station synoptique, temps réel, expertisée à J+1',
  1: 'station automatique Radome-Resome, temps réel, expertisée à J+1',
  2: 'station automatique hors Radome-Resome, temps réel, expertisée à J+1',
  3: 'station automatique, temps réel, expertisée en temps différé',
  4: 'poste climatologique manuel ou automatique, acquisition en temps différé',
});

/**
 * The instrument families, each anchored on ONE parameter name.
 *
 * WHY AN ANCHOR AND NOT A KEYWORD MATCH. Météo-France's parameter vocabulary is
 * 254 names for the real-time network and most of them are DERIVED statistics —
 * `NOMBRE DE JOURS AVEC TX>=35°C`, `CUMUL DES DJU SEUIL 18 METHODE
 * CHAUFFAGISTE`, `SOMME DES TNTXM QUOTIDIEN SUP A 8°C`. Matching on the word
 * "TEMPERATURE" would count a degree-day accumulator as a thermometer, and
 * matching on "VENT" would count `MOYENNE DECADAIRE DE LA FORCE DU VENT` —
 * present on 879 stations — as an anemometer when only 845 have one.
 *
 * Each family is therefore anchored on the station's own HOURLY base reading,
 * which exists if and only if the instrument does. The counts below are the
 * anchors, measured on the 2026-09-02 inventory across the 2 138 real-time
 * stations that have a fiche.
 *
 * Order is by how many stations carry it, which is also roughly the order a
 * reader would guess — and the order that makes the card's "measures / does not
 * measure" split read as a descent from the ordinary to the rare.
 */
export const INSTRUMENT_FAMILIES = Object.freeze([
  Object.freeze({
    key: 'temp', anchor: 'TEMPERATURE SOUS ABRI HORAIRE', count: 2084,
    label: 'température', short: 'T', blurb: 'thermomètre sous abri',
  }),
  Object.freeze({
    key: 'rain', anchor: 'HAUTEUR DE PRECIPITATIONS HORAIRE', count: 2068,
    label: 'précipitations', short: 'RR', blurb: 'pluviomètre',
  }),
  Object.freeze({
    key: 'humidity', anchor: 'HUMIDITE RELATIVE HORAIRE', count: 860,
    label: 'humidité', short: 'U', blurb: 'hygromètre',
  }),
  Object.freeze({
    key: 'wind', anchor: 'VITESSE DU VENT HORAIRE', count: 845,
    label: 'vent à 10 m', short: 'FF', blurb: 'anémomètre à 10 m',
  }),
  Object.freeze({
    key: 'snow', anchor: 'EPAISSEUR DE NEIGE TOTALE HORAIRE', count: 309,
    label: 'neige au sol', short: 'NEIG', blurb: 'hauteur de neige totale',
  }),
  Object.freeze({
    key: 'radiation', anchor: 'RAYONNEMENT GLOBAL HORAIRE', count: 270,
    label: 'rayonnement global', short: 'GLO', blurb: 'pyranomètre',
  }),
  Object.freeze({
    key: 'pressure', anchor: 'PRESSION STATION HORAIRE', count: 234,
    label: 'pression', short: 'P', blurb: 'baromètre',
  }),
  Object.freeze({
    key: 'sunshine', anchor: "DUREE D'INSOLATION HORAIRE", count: 228,
    label: 'insolation', short: 'INS', blurb: 'héliographe',
  }),
  Object.freeze({
    key: 'visibility', anchor: 'VISIBILITE HORAIRE', count: 211,
    label: 'visibilité', short: 'VV', blurb: 'visibilimètre',
  }),
  Object.freeze({
    key: 'weather', anchor: 'CODE TEMPS PRESENT HORAIRE', count: 206,
    label: 'temps présent', short: 'WW', blurb: 'capteur de temps présent',
  }),
  Object.freeze({
    key: 'cloud', anchor: 'NEBULOSITE TOTALE HORAIRE', count: 186,
    label: 'nébulosité', short: 'N', blurb: 'célomètre',
  }),
  Object.freeze({
    key: 'road', anchor: 'TEMPERATURE DE CHAUSSEE', count: 149,
    label: 'température de chaussée', short: 'RTE', blurb: 'sonde de chaussée — station routière',
  }),
  Object.freeze({
    key: 'soil', anchor: 'TEMPERATURE A -10 CM HORAIRE', count: 132,
    label: 'température du sol', short: 'SOL', blurb: 'sondes enterrées',
  }),
  Object.freeze({
    key: 'sea', anchor: 'ETAT DE LA MER HORAIRE', count: 44,
    label: 'état de la mer', short: 'MER', blurb: 'observation de l’état de la mer',
  }),
]);

/** Family keys in declaration order — the order every readout uses. */
export const FAMILY_KEYS = Object.freeze(INSTRUMENT_FAMILIES.map((family) => family.key));

/** Anchor parameter name → family key. Built once; the build script's index. */
export const FAMILY_BY_ANCHOR = Object.freeze(Object.fromEntries(
  INSTRUMENT_FAMILIES.map((family) => [family.anchor, family.key]),
));

/** Family key → its descriptor. */
export const FAMILY_BY_KEY = Object.freeze(Object.fromEntries(
  INSTRUMENT_FAMILIES.map((family) => [family.key, family]),
));

/**
 * The five parameters a reader means when they say "weather station".
 *
 * Not an arbitrary five: they are the SYNOP core — the set the World
 * Meteorological Organization's surface message is built around, and the set
 * every consumer weather app displays. 228 French real-time stations have all
 * of them.
 */
export const SYNOPTIC_CORE = Object.freeze(['temp', 'rain', 'wind', 'humidity', 'pressure']);

/**
 * What a station can answer, as the layer's palette.
 *
 * Colour carries the layer's whole argument, so it is ordered by capability and
 * separated in LIGHTNESS as well as hue — the classes stay distinguishable
 * under deuteranopia, and every marker's card names its class in words. The
 * counts are measured on the 2026-09-02 build.
 *
 * `unknown` is not a sixth grade of instrument; it is the six stations that
 * appear in the real-time list and in NO metadata file, so nothing is known
 * about what they measure. They are drawn in the neutral grey the sibling
 * layers use for "the publisher did not say", never as an empty station.
 */
export const STATION_CLASSES = Object.freeze({
  synoptic: Object.freeze({
    key: 'synoptic', label: 'Synoptique complète', color: '#7ee8fa', count: 228,
    blurb: 'température, pluie, vent, humidité et pression',
  }),
  wind: Object.freeze({
    key: 'wind', label: 'Automatique avec vent', color: '#66d9a6', count: 565,
    blurb: 'température, pluie et vent — pas de pression',
  }),
  'temp-rain': Object.freeze({
    key: 'temp-rain', label: 'Température et pluie', color: '#ffd166', count: 1254,
    blurb: 'ne mesure ni le vent ni la pression',
  }),
  thermo: Object.freeze({
    key: 'thermo', label: 'Température seule', color: '#f4a261', count: 37,
    blurb: 'thermomètre sans pluviomètre',
  }),
  rain: Object.freeze({
    key: 'rain', label: 'Pluviomètre', color: '#c792ea', count: 21,
    blurb: 'la pluie et rien d’autre',
  }),
  other: Object.freeze({
    key: 'other', label: 'Autres capteurs', color: '#8fa3b8', count: 33,
    blurb: 'ni température ni pluie — capteurs spécialisés',
  }),
  unknown: Object.freeze({
    key: 'unknown', label: 'Inventaire non publié', color: '#5c6b7a', count: 6,
    blurb: 'station listée en temps réel, absente des métadonnées',
  }),
});

/** Legend order — most capable first, `unknown` last. */
export const STATION_CLASS_ORDER = Object.freeze([
  'synoptic', 'wind', 'temp-rain', 'thermo', 'rain', 'other', 'unknown',
]);

/**
 * Which class a station falls in, from the families it actually measures.
 *
 * `null` families — meaning no metadata file mentions this station at all — is
 * NOT the same as an empty set, and the two must not collapse: an empty set is
 * a station whose inventory says it measures nothing, and `null` is a station
 * whose inventory does not exist. Only the second is `unknown`.
 * @param {Array<string>|null|undefined} families Family keys, or null when unknown.
 * @returns {string} A key of `STATION_CLASSES`.
 */
export function classifyStation(families) {
  if (!Array.isArray(families)) return 'unknown';
  const has = new Set(families);
  if (SYNOPTIC_CORE.every((key) => has.has(key))) return 'synoptic';
  if (has.has('temp') && has.has('rain') && has.has('wind')) return 'wind';
  if (has.has('temp') && has.has('rain')) return 'temp-rain';
  if (has.has('temp')) return 'thermo';
  if (has.has('rain')) return 'rain';
  return 'other';
}

/**
 * The département a station identifier belongs to.
 *
 * The first two digits of `NUM_POSTE`, with the overseas convention Météo-France
 * uses: `971`–`978` are three digits, so `97105002` is Guadeloupe (971) and not
 * département 97. Corsica stays `20` — see trap 4 in the module header.
 * @param {string|number|null|undefined} id
 * @returns {string|null}
 */
export function departementOf(id) {
  const digits = String(id ?? '').trim().padStart(8, '0');
  if (!/^\d{8}$/.test(digits)) return null;
  return digits.startsWith('97') || digits.startsWith('98')
    ? digits.slice(0, 3)
    : digits.slice(0, 2);
}

/**
 * A finite number, or null.
 * @param {unknown} value
 * @returns {number|null}
 */
export function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Split a semicolon-separated line, trimming each cell.
 *
 * Every Météo-France CSV in this layer uses `;`, and none of them quotes a
 * field containing one — checked across the station list, POSTES_MF and a full
 * year of SYNOP. A quote-aware parser would be dead code pretending to be
 * safety, so this is deliberately the simple split, and the build script
 * asserts the column count on every row rather than trusting it.
 * @param {string} line
 * @returns {string[]}
 */
export function splitSemicolon(line) {
  return String(line ?? '').split(';').map((cell) => cell.trim());
}

/**
 * Project one row of the real-time station list into the shape this layer ships.
 *
 * Everything the list publishes and nothing it does not. The enrichment — the
 * commune, the closure date, the instrument families — is joined in by the
 * build script from three other files and is NOT invented here.
 * @param {Record<string, string>} row Parsed CSV row.
 * @returns {object|null} Null when the row carries no usable identity or position.
 */
export function projectStationRow(row) {
  const id = String(row?.Id_station ?? '').trim();
  const lat = finiteOrNull(row?.Latitude);
  const lon = finiteOrNull(row?.Longitude);
  if (!/^\d{8}$/.test(id) || lat === null || lon === null) return null;
  const pack = String(row?.Pack ?? '').trim().toUpperCase();
  const omm = String(row?.Id_omm ?? '').trim();
  return {
    id,
    // 287 of the 2 144 carry a WMO identifier; only 62 of those are published
    // in the open SYNOP product. Having an OMM number is not the same as
    // being readable, and the two flags stay separate for that reason.
    omm: omm || null,
    name: String(row?.Nom_usuel ?? '').trim() || null,
    lat,
    lon,
    alt: finiteOrNull(row?.Altitude),
    pack: Object.hasOwn(STATION_PACKS, pack) ? pack : null,
    opened: /^\d{4}-\d{2}-\d{2}$/.test(String(row?.Date_ouverture ?? '').trim())
      ? String(row.Date_ouverture).trim()
      : null,
    dep: departementOf(id),
  };
}

/**
 * The families a station is CURRENTLY instrumented for, from its fiche.
 *
 * A parameter with a `dateFin` is one the station used to measure and no longer
 * does — a decommissioned instrument, not a present one. Reading them would
 * report an anemometer on a mast that came down in 2011.
 * @param {{parametres?: Array<{nom?: string, dateFin?: string}>}|null|undefined} fiche
 * @returns {string[]|null} Family keys in declaration order, or null with no fiche.
 */
export function familiesFromFiche(fiche) {
  if (!fiche || !Array.isArray(fiche.parametres)) return null;
  const found = new Set();
  for (const parameter of fiche.parametres) {
    if (String(parameter?.dateFin ?? '').trim()) continue;
    const key = FAMILY_BY_ANCHOR[String(parameter?.nom ?? '').trim()];
    if (key) found.add(key);
  }
  return FAMILY_KEYS.filter((key) => found.has(key));
}

/**
 * What a station measures and what it does not, in the reader's words.
 * @param {Array<string>|null|undefined} families
 * @returns {{measures: string[], missing: string[]}}
 */
export function describeInstruments(families) {
  if (!Array.isArray(families)) return { measures: [], missing: [] };
  const has = new Set(families);
  return {
    measures: FAMILY_KEYS.filter((key) => has.has(key)).map((key) => FAMILY_BY_KEY[key].label),
    // Only the synoptic core is reported as MISSING. Listing all fourteen would
    // print "ne mesure pas l'état de la mer" under a station in the Cantal,
    // which is true and useless; the five are the ones a reader assumed.
    //
    // Ordered by `FAMILY_KEYS` and not by `SYNOPTIC_CORE`, so both halves of
    // one card read in the same order — a "mesure / ne mesure pas" pair that
    // sorted its two lists differently would read as two unrelated lists.
    missing: FAMILY_KEYS
      .filter((key) => SYNOPTIC_CORE.includes(key) && !has.has(key))
      .map((key) => FAMILY_BY_KEY[key].label),
  };
}

/**
 * Network figures, recomputed from what will actually be drawn.
 * @param {Array<object>} stations
 * @returns {object}
 */
export function summarizeStations(stations) {
  const list = Array.isArray(stations) ? stations : [];
  const byClass = {};
  const byPack = {};
  const byFamily = {};
  let synop = 0;
  let live = 0;
  let closed = 0;
  let fiche = 0;
  let overseas = 0;
  for (const station of list) {
    const klass = station?.klass || 'unknown';
    byClass[klass] = (byClass[klass] || 0) + 1;
    if (station?.pack) byPack[station.pack] = (byPack[station.pack] || 0) + 1;
    for (const key of station?.fam || []) byFamily[key] = (byFamily[key] || 0) + 1;
    if (station?.synop) synop += 1;
    if (station?.live) live += 1;
    if (station?.closed) closed += 1;
    if (station?.fiche) fiche += 1;
    if (String(station?.dep || '').length === 3) overseas += 1;
  }
  return {
    stations: list.length,
    metropole: list.length - overseas,
    overseas,
    synop,
    live,
    closed,
    fiche,
    byClass,
    byPack,
    byFamily,
  };
}

/**
 * Kelvin as degrees Celsius, rounded to a tenth.
 *
 * The SYNOP product publishes every temperature in kelvin — `t`, `td`, `tn12`,
 * `tx12`, `tminsol`, `tw` — and a card that printed 294.25 would be reporting a
 * correct number nobody can read.
 * @param {unknown} kelvin
 * @returns {number|null}
 */
export function kelvinToCelsius(kelvin) {
  const value = finiteOrNull(kelvin);
  return value === null ? null : Math.round((value - 273.15) * 10) / 10;
}

/**
 * The 16-point compass name for a wind direction in degrees.
 *
 * `dd` is the direction the wind blows FROM, in degrees clockwise from true
 * north, which is what the card says in words.
 * @param {unknown} degrees
 * @returns {string|null}
 */
export function compassPoint(degrees) {
  const value = finiteOrNull(degrees);
  if (value === null) return null;
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
  return points[Math.round(((value % 360) + 360) % 360 / 22.5) % 16];
}

/**
 * A streaming reducer over the SYNOP archive, keeping the newest observation
 * per station.
 *
 * A FACTORY rather than a function over an iterable, because the archive
 * arrives two different ways and both must run the same code. The build script
 * and the proxy read it from the network as a gunzip stream, which is
 * ASYNC-iterable; the tests read a captured excerpt as an array, which is not.
 * A reducer written against `for...of` silently accepts the stream object and
 * throws `lines is not iterable` at the first row — which it did, and which is
 * why the two paths now share one accumulator instead of one loop.
 *
 * The archive is the running year in one file, oldest first, so the last row
 * for a station is normally its newest observation — but "normally" is not a
 * guarantee, and `validity_time` is compared rather than assumed.
 *
 * `validity_time` is the observation's own hour, `insert_time` is when
 * Météo-France received it, and they differ by minutes. The card reports
 * VALIDITY — a reader asking "what is the weather at Nîmes" is asking about the
 * hour that was measured, not the hour a file was written.
 * @returns {{push:(line:string)=>void, result:()=>{observations:Record<string,object>, rows:number, newest:string|null}}}
 */
export function createSynopReducer() {
  let header = null;
  let index = null;
  const observations = {};
  let rows = 0;
  let newest = null;
  return {
    push(line) {
      if (!line) return;
      if (!header) {
        header = splitSemicolon(line);
        index = Object.fromEntries(header.map((name, position) => [name, position]));
        // A silently renamed column would turn every reading into null rather
        // than into an error, so the two the reduction cannot work without are
        // asserted here instead of discovered as an empty card.
        if (index.geo_id_wmo === undefined || index.validity_time === undefined) {
          throw new Error('SYNOP archive: colonnes geo_id_wmo / validity_time absentes');
        }
        return;
      }
      const cells = line.split(';');
      if (cells.length < header.length) return;
      const station = cells[index.geo_id_wmo]?.trim();
      const validity = cells[index.validity_time]?.trim();
      if (!station || !validity) return;
      rows += 1;
      const previous = observations[station];
      if (previous && previous.at >= validity) return;
      observations[station] = projectSynopObservation(cells, index, validity);
      if (!newest || validity > newest) newest = validity;
    },
    result() {
      return { observations, rows, newest };
    },
  };
}

/**
 * Reduce a SYNOP archive held in memory. See `createSynopReducer` for the
 * streaming form the network paths use.
 * @param {Iterable<string>} lines Raw CSV lines, header first.
 * @returns {{observations: Record<string, object>, rows: number, newest: string|null}}
 */
export function reduceSynopArchive(lines) {
  const reducer = createSynopReducer();
  for (const line of lines) reducer.push(line);
  return reducer.result();
}

/**
 * One SYNOP row as the card reads it.
 *
 * Units are converted HERE, once, so no consumer can print a kelvin or a
 * pascal. Pressure is `pmer` — reduced to sea level, which is the number a
 * barometer reading is compared against — and it is published in Pa, so a
 * station at 101 870 Pa is 1 018,7 hPa.
 * @param {string[]} cells
 * @param {Record<string, number>} index Column name → position.
 * @param {string} validity ISO validity time.
 * @returns {object}
 */
export function projectSynopObservation(cells, index, validity) {
  const at = (name) => (index[name] === undefined ? null : (cells[index[name]] ?? '').trim());
  const pressurePa = finiteOrNull(at('pmer'));
  return {
    at: validity,
    name: at('name') || null,
    tempC: kelvinToCelsius(at('t')),
    dewC: kelvinToCelsius(at('td')),
    humidity: finiteOrNull(at('u')),
    windMs: finiteOrNull(at('ff')),
    windDir: finiteOrNull(at('dd')),
    gustMs: finiteOrNull(at('raf10')),
    pressureHpa: pressurePa === null ? null : Math.round(pressurePa / 10) / 10,
    // `rr1` is the hour's rainfall and a genuine 0.0 means "it did not rain",
    // which is information. `finiteOrNull` keeps the zero; only an empty cell
    // becomes null.
    rain1hMm: finiteOrNull(at('rr1')),
    visibilityM: finiteOrNull(at('vv')),
    snowM: finiteOrNull(at('ht_neige')),
  };
}

/**
 * Parse a *fiche climatologique* into the two things a card can use: the
 * station's records, and the period they were established over.
 *
 * The file is a human-readable report, not a data product — blocks of
 * semicolon-padded columns under French headings, with `.` where a month has no
 * value and a `Date` row beneath each record row. The LAST column of every row
 * is the annual one, and its date cell is a bare year (`2019`) where the twelve
 * monthly cells carry `DD-YYYY`; the annual column is the one read here, so a
 * record's date is a year. Only the two record blocks and their stated periods
 * are read; the monthly normals are
 * left alone, because thirteen columns of them is a table this globe has
 * nowhere to put and a summary of them would be a number this project made up.
 *
 * Returns null rather than a half-parsed object when the two record blocks are
 * not both present: a fiche whose shape changed should show nothing, not a
 * record with no date.
 * @param {string} text Raw `.data` contents.
 * @returns {{station:string|null, edited:string|null, period:string|null,
 *   high:{value:number, date:string}|null, low:{value:number, date:string}|null}|null}
 */
export function parseFicheClim(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  if (lines.length < 8) return null;
  const header = lines.find((line) => /Indicatif\s*:/.test(line)) || '';
  const edited = /Edit[ée] le\s*:\s*([\d/]+)/.exec(lines.find((line) => /Edit[ée] le/.test(line)) || '');

  /** The last cell of a `;`-separated row is the ANNUAL column — the record. */
  const annual = (line) => {
    const cells = splitSemicolon(line).filter((cell) => cell !== '');
    return cells.length ? cells[cells.length - 1] : null;
  };

  const block = (heading) => {
    const start = lines.findIndex((line) => line.startsWith(heading));
    if (start < 0) return null;
    const period = /du (\d{2}-\d{2}-\d{4}) au (\d{2}-\d{2}-\d{4})/.exec(lines[start + 1] || '');
    const values = lines[start + 2] || '';
    const dates = lines[start + 3] || '';
    const value = finiteOrNull(annual(values));
    const date = annual(dates);
    if (value === null || !date) return null;
    return { value, date, period: period ? `${period[1]} → ${period[2]}` : null };
  };

  const high = block('La température la plus élevée');
  const low = block('La température la plus basse');
  if (!high || !low) return null;

  return {
    station: header ? header.split('Indicatif')[0].trim().replace(/;$/, '') || null : null,
    edited: edited ? edited[1] : null,
    period: high.period || low.period,
    high: { value: high.value, date: high.date },
    low: { value: low.value, date: low.date },
  };
}
