/**
 * @module rteGenerationFeed
 *
 * Pure projection for **Groupes de prod (FR)** — France's power stations, unit
 * by unit, at the output RTE last published for each one.
 *
 * Two sources, joined on one key, and neither can do the job alone:
 *
 *   **RTE** `actual_generation/v1/actual_generations_per_unit` publishes what
 *   every generating unit of 100 MW or more on the metropolitan transmission
 *   grid actually produced, hour by hour — and publishes no coordinate for any
 *   of them. It needs a free RTE account (OAuth2 client-credentials).
 *
 *   **ODRÉ**'s *Registre national des installations de production et de
 *   stockage d'électricité* publishes every one of those units with its EIC
 *   code, its commune, its filière and its installed power — and no live
 *   output at all. Keyless, Licence Ouverte 2.0.
 *
 * The join key is the **EIC code** (`unit.eic_code` ↔ `codeeicresourceobject`),
 * which both sides carry verbatim. Measured 2026-08-28: the registre holds 171
 * units at or above 100 MW, all 171 with a distinct EIC, 57 of them nuclear
 * reactors for 63.0 GW. The registry half is baked at authoring time by
 * `scripts/build-rte-units-registry.mjs` and shipped as a file, so the layer
 * draws the whole fleet — sized and named — on `git clone`, with no key. The
 * key only ever adds the number that is moving.
 *
 * ── The line this module will not cross ─────────────────────────────────────
 *
 * **Nobody publishes a reactor's coordinates.** Not RTE, not ODRÉ, not OSM —
 * `power=generator` + `generator:source=nuclear` returns exactly zero elements
 * over France (measured 2026-08-28). So this layer draws the SITE, once, and
 * lists its units on the card. Four discs in a square at Paluel would be four
 * inventions. The site's own position is itself a derived thing and says which
 * of four published anchors it came from — EDF's own coordinate, an
 * OpenStreetMap plant outline, an RTE switchyard, or a commune centre — never
 * an average of them.
 *
 * ── Nine upstream traps, and which of them the live API actually plays ──────
 *
 * Everything below was written before this build had an RTE account, from the
 * published contract. It was then checked against a real 152-unit, 6 992-row
 * response (2026-08-28), and that check is recorded honestly: four traps are
 * MEASURED in v1.1, three are DEFENSIVE — the contract permits them, the
 * resource does not currently do them — and two were wrong and are rewritten.
 * A guard that has never fired is worth keeping and is not worth claiming.
 *
 * 1. **Zero is a reading, not a gap.** MEASURED, and bigger than expected:
 *    **56 of 152 units** read exactly 0 at the captured hour, four of them
 *    reactors — Chinon 2, Cruas 4, Gravelines 5, Saint-Laurent 2. `value ||
 *    null`, `if (!value)`, `values.filter(Boolean)` would each have erased a
 *    third of the fleet and drawn the rest as fully available. Nothing here
 *    tests a generation figure for truthiness; the guard is `Number.isFinite`.
 *
 * 2. **The last row might be the future.** DEFENSIVE, not measured: v1.1 sends
 *    **zero nulls** — 0 of 6 992 rows — and simply stops at the last published
 *    hour, with all 152 units in lockstep on it. The schema permits a null
 *    `value`, and éCO2mix plays exactly this trap with its `prevision_j1`
 *    padding, so the latest MEASURED value is still the last one with a finite
 *    reading rather than the last element. It costs one backwards scan.
 *
 * 3. **Negative is a station drawing from the grid, not corruption.** Measured
 *    against the live API on 2026-08-28: 24 of 152 units read negative, and
 *    **fourteen of them were REACTORS** — Chooz 1 at −58 MW, Paluel 3 at −49,
 *    Belleville 2 at −43. A reactor cannot pump. A shut-down unit still runs
 *    its coolant pumps, its instrumentation and its lighting, and buys that
 *    power back off the grid: a stopped 1 500 MW reactor is a ~50 MW LOAD. The
 *    rest are thermal units idling at −1 to −3 MW. (Pumped storage does read
 *    negative while filling its upper lake — but not one of the 28 pumped
 *    units was doing so at that hour, which is exactly why the first draft of
 *    this note, written before there was a key to check it with, was wrong.)
 *    Clamping at zero would erase the whole phenomenon. The sign is carried to
 *    the card, and `Math.abs` is used only to pick a radius.
 *
 * 4. **`values` are not promised in order.** DEFENSIVE: all 152 units arrived
 *    sorted. Nothing in the contract says they must, and "latest" has to mean
 *    latest in time rather than last in the array, so they are sorted here.
 *
 * 5. **One EIC can arrive twice.** DEFENSIVE: the 48-hour window came back as
 *    152 envelopes for 152 distinct units, one each. But each envelope carries
 *    its OWN `start_date`/`end_date`, which is a shape that only makes sense if
 *    a unit may be split across several — so envelopes are MERGED by EIC rather
 *    than assigned, because last-one-wins would silently halve a history.
 *
 * 6. **RTE revises.** `updated_date` is populated on every one of the 6 992
 *    rows, which is why it exists; no repeated `start_date` appeared in this
 *    capture, so the resolution is DEFENSIVE. Two rows for one hour are settled
 *    on the newest `updated_date`, never on arrival order.
 *
 * 7. **RTE sends no installed capacity at all.** The published schema carries
 *    `unit.installed_capacity`, and v1.1 populates it on **0 of 152** units
 *    (measured 2026-08-28). So the denominator behind every load figure on this
 *    layer is the REGISTER's `puismaxinstallee`, never RTE's. The code still
 *    prefers RTE's when present and still reports both when they disagree,
 *    because a field that is absent today is not a field that is absent
 *    forever — but nothing here may assume it will arrive.
 *
 * 8. **A unit RTE reports that the registry cannot place.** RTE's fleet and
 *    ODRÉ's register are maintained separately and drift. An unplaceable unit
 *    is COUNTED and its megawatts reported as unplaced — never dropped
 *    silently, and never dropped onto the nearest site that looks plausible.
 *
 * 9. **The two publishers cut the fleet at different granularities.** The EIC
 *    join is exact for nuclear and thermal and fails wholesale for hydro, where
 *    the register has one row per PLANT and RTE has one per TURBINE GROUP under
 *    entirely different codes — 55 of 152 units, 36% of the fleet, left over on
 *    the first live run. See `adoptUnitsByStationName`.
 *
 * Dependency-free and side-effect-free, so the projection the dev-server proxy
 * runs is the projection under test — the shape `gasFranceFeed.js` and
 * `powerGridFeed.js` established.
 */

import { textSparkline } from './sparkline.js';

/** RTE's OAuth2 token endpoint. HTTP Basic over `client_id:client_secret`. */
export const RTE_TOKEN_URL = 'https://digital.iservices.rte-france.com/token/oauth/';

/** The one resource this layer subscribes to. */
export const RTE_ACTUAL_GENERATIONS_PER_UNIT_URL =
  'https://digital.iservices.rte-france.com/open_api/actual_generation/v1/actual_generations_per_unit';

/**
 * Publication floor, in MW.
 *
 * RTE publishes per-unit generation only for units at or above 100 MW of
 * installed power. It is the reason a 3 MW hydro plant on the same river is
 * absent, and the reason the registry is filtered to the same floor — so the
 * drawn fleet is the fleet the API can speak about, rather than 139 290
 * registered installations of which 99.9% will never light up.
 */
export const RTE_UNIT_FLOOR_MW = 100;

/** ODRÉ dataset the shipped registry is built from. */
export const RTE_REGISTRY_DATASET =
  'registre-national-installation-production-stockage-electricite-agrege';

/**
 * Generation classes — one table shared by BOTH sides of the join.
 *
 * The keyless half classifies from ODRÉ's `filiere`/`technologie`/`combustible`
 * and the live half from RTE's `production_type`; they have to land on the same
 * id or a site would change colour the moment a key is added. `order` is the
 * legend order, coarsest fuel story first.
 */
export const RTE_GENERATION_CLASSES = Object.freeze({
  nuclear: Object.freeze({
    id: 'nuclear',
    label: 'Nucléaire',
    color: '#c8ff4d',
    order: 0,
    blurb: 'Fission reactors. 57 units for 63.0 GW — three fifths of France’s installed transmission-connected fleet in one filière.',
  }),
  'hydro-reservoir': Object.freeze({
    id: 'hydro-reservoir',
    label: 'Hydraulique · lac',
    color: '#4db8ff',
    order: 1,
    blurb: 'Reservoir hydro. Stored water, released on command — the fleet’s fastest large swing.',
  }),
  'hydro-run-of-river': Object.freeze({
    id: 'hydro-run-of-river',
    label: 'Hydraulique · fil de l’eau',
    color: '#5fd4e8',
    order: 2,
    blurb: 'Run-of-river and lock hydro. It follows the river, not the market.',
  }),
  'hydro-pumped': Object.freeze({
    id: 'hydro-pumped',
    label: 'Hydraulique · pompage',
    color: '#a78bfa',
    order: 3,
    blurb: 'Pumped storage. It generates and it consumes — a negative reading here is the machine filling its upper lake, rather than the house load a stopped unit of any class draws.',
  }),
  'fossil-gas': Object.freeze({
    id: 'fossil-gas',
    label: 'Gaz',
    color: '#ff9d3c',
    order: 4,
    blurb: 'Combined-cycle, open-cycle and cogeneration gas. These are the stations the Réseau gaz layer draws as inventory.',
  }),
  'fossil-coal': Object.freeze({
    id: 'fossil-coal',
    label: 'Charbon',
    color: '#9aa0a6',
    order: 5,
    blurb: 'Hard coal. Four of the six remaining units are held “en retrait provisoire” in the register.',
  }),
  'fossil-oil': Object.freeze({
    id: 'fossil-oil',
    label: 'Fioul',
    color: '#d2724f',
    order: 6,
    blurb: 'Oil-fired combustion turbines. Peaking machines, idle almost all year.',
  }),
  biomass: Object.freeze({
    id: 'biomass',
    label: 'Bioénergies',
    color: '#7ee0a8',
    order: 7,
    blurb: 'Biomass and waste-to-energy above the 100 MW floor.',
  }),
  wind: Object.freeze({
    id: 'wind',
    label: 'Éolien en mer',
    color: '#e6f2ff',
    order: 8,
    blurb: 'Offshore wind. The only wind above the floor — onshore farms are all smaller than 100 MW.',
  }),
  solar: Object.freeze({
    id: 'solar',
    label: 'Solaire',
    color: '#ffd84d',
    order: 9,
    blurb: 'Photovoltaic above the floor.',
  }),
  marine: Object.freeze({
    id: 'marine',
    label: 'Énergies marines',
    color: '#3fd0c0',
    order: 10,
    blurb: 'Tidal. One machine in France: the 240 MW Rance barrage, running since 1966.',
  }),
  battery: Object.freeze({
    id: 'battery',
    label: 'Stockage batterie',
    color: '#ff5fd0',
    order: 11,
    blurb: 'Grid batteries above the floor. Like pumped storage they read negative while charging.',
  }),
  other: Object.freeze({
    id: 'other',
    label: 'Autre',
    color: '#9aa4b2',
    order: 12,
    blurb: 'A published class this build has no row for. The upstream value is repeated on the card rather than hidden.',
  }),
});

/** Legend order for the classes, coarsest fuel story first. */
export const RTE_CLASS_ORDER = Object.freeze(
  Object.values(RTE_GENERATION_CLASSES)
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.id),
);

/**
 * RTE `production_type` → generation class.
 *
 * Covers the ENTSO-E-derived vocabulary RTE publishes on this resource. An
 * unlisted value does NOT fall through to a guess: `classifyRteProductionType`
 * returns `other` and the raw token travels to the card, so a new upstream
 * class is visible as itself rather than silently painted as something else.
 */
export const RTE_PRODUCTION_TYPE_CLASS = Object.freeze({
  NUCLEAR: 'nuclear',
  HYDRO_WATER_RESERVOIR: 'hydro-reservoir',
  HYDRO_RUN_OF_RIVER_AND_POUNDAGE: 'hydro-run-of-river',
  HYDRO_PUMPED_STORAGE: 'hydro-pumped',
  FOSSIL_GAS: 'fossil-gas',
  FOSSIL_HARD_COAL: 'fossil-coal',
  FOSSIL_BROWN_COAL: 'fossil-coal',
  FOSSIL_PEAT: 'fossil-coal',
  FOSSIL_OIL: 'fossil-oil',
  FOSSIL_OIL_SHALE: 'fossil-oil',
  BIOMASS: 'biomass',
  WASTE: 'biomass',
  WIND_OFFSHORE: 'wind',
  WIND_ONSHORE: 'wind',
  SOLAR: 'solar',
  MARINE: 'marine',
  BATTERY_STORAGE: 'battery',
  OTHER: 'other',
});

/**
 * The class a RTE `production_type` belongs to.
 * @param {*} value - Raw `unit.production_type`.
 * @returns {string} A `RTE_GENERATION_CLASSES` id; `other` when unrecognised.
 */
export function classifyRteProductionType(value) {
  const token = String(value ?? '').trim().toUpperCase();
  return RTE_PRODUCTION_TYPE_CLASS[token] || 'other';
}

/**
 * Human caption for a raw `production_type`.
 *
 * An unknown token is REPEATED rather than flattened to "Autre": RTE did say
 * something, and `production_type=FOO` on the card is more honest than
 * implying the field was empty. Same rule as the substation-role table in
 * `powerGridFeed.js`.
 * @param {*} value - Raw `unit.production_type`.
 * @returns {string}
 */
export function rteProductionTypeLabel(value) {
  const token = String(value ?? '').trim().toUpperCase();
  if (!token) return 'Filière non publiée';
  const known = RTE_PRODUCTION_TYPE_CLASS[token];
  if (known) return RTE_GENERATION_CLASSES[known].label;
  return `production_type=${token}`;
}

/** Look a class up by id, for callers holding only a projected payload. */
export function rteGenerationClass(id) {
  return RTE_GENERATION_CLASSES[String(id ?? '')] || RTE_GENERATION_CLASSES.other;
}

// --- ODRÉ registre classification -------------------------------------------

/**
 * ODRÉ `technologie` → class, consulted BEFORE `filiere`.
 *
 * Order matters and this is trap-shaped: the register files a 132 MW
 * photovoltaic farm at Ajaccio and a 112 MW one at Lucciana under
 * `filiere: "Thermique non renouvelable"`. Classifying on the filière alone
 * paints two solar farms as thermal power stations, so the finer field wins
 * wherever it says something.
 */
export const REGISTRE_TECHNOLOGY_CLASS = Object.freeze({
  'Fission nucléaire': 'nuclear',
  Lac: 'hydro-reservoir',
  Éclusée: 'hydro-run-of-river',
  Eclusée: 'hydro-run-of-river',
  'Fil de l’eau': 'hydro-run-of-river',
  "Fil de l'eau": 'hydro-run-of-river',
  'Pompage turbinage': 'hydro-pumped',
  Marémotrice: 'marine',
  Batterie: 'battery',
  Photovoltaïque: 'solar',
  'En mer posé': 'wind',
  'En mer flottant': 'wind',
  'Terrestre': 'wind',
});

/** ODRÉ `combustible` → class, for the thermal fleet. */
export const REGISTRE_FUEL_CLASS = Object.freeze({
  Gaz: 'fossil-gas',
  'Gaz naturel': 'fossil-gas',
  Charbon: 'fossil-coal',
  Lignite: 'fossil-coal',
  Fioul: 'fossil-oil',
  'Fioul domestique': 'fossil-oil',
  'Fioul lourd': 'fossil-oil',
  Gazole: 'fossil-oil',
  Bois: 'biomass',
  Biomasse: 'biomass',
  Biogaz: 'biomass',
  Déchets: 'biomass',
});

/** ODRÉ `filiere` → class. The coarsest of the three, consulted last. */
export const REGISTRE_FILIERE_CLASS = Object.freeze({
  Nucléaire: 'nuclear',
  Hydraulique: 'hydro-reservoir',
  Eolien: 'wind',
  Éolien: 'wind',
  Solaire: 'solar',
  Bioénergies: 'biomass',
  'Energies Marines': 'marine',
  'Énergies Marines': 'marine',
  'Stockage non hydraulique': 'battery',
  'Thermique non renouvelable': 'fossil-gas',
  'Thermique renouvelable': 'biomass',
});

/**
 * The class one register row belongs to.
 *
 * Technology, then fuel, then filière — narrowest published field first, so the
 * Ajaccio photovoltaic-under-thermal row lands on `solar` (see
 * `REGISTRE_TECHNOLOGY_CLASS`). A row that says nothing at all lands on
 * `other`, which is drawn, not dropped.
 * @param {{filiere?:*, technologie?:*, combustible?:*}} row
 * @returns {string} A `RTE_GENERATION_CLASSES` id.
 */
export function classifyRegistreRow(row) {
  const tech = String(row?.technologie ?? '').trim();
  if (tech && REGISTRE_TECHNOLOGY_CLASS[tech]) return REGISTRE_TECHNOLOGY_CLASS[tech];
  const fuel = String(row?.combustible ?? '').trim();
  if (fuel && REGISTRE_FUEL_CLASS[fuel]) return REGISTRE_FUEL_CLASS[fuel];
  const filiere = String(row?.filiere ?? '').trim();
  if (filiere && REGISTRE_FILIERE_CLASS[filiere]) return REGISTRE_FILIERE_CLASS[filiere];
  return 'other';
}

// --- Register row parsing ---------------------------------------------------

/**
 * `nominstallation` prefixes that introduce a site name, longest first.
 *
 * The register writes a unit's name in two grammars that do not agree on
 * spacing or on where the site sits:
 *
 *   `BVIL7N01 - GROUPE 01 DE LA CENTRALE NUCLEAIRE DE BELLEVILLE (BELLEVILLE-SUR-LOIRE)`
 *   `BOLLEH-CENTRALE HYDRAULIQUE DE BOLLENE (SPECIALISE)-6`
 *
 * so the site is whatever follows the longest matching introducer. Longest
 * first is load-bearing: `DE LA CENTRALE NUCLEAIRE DE` also contains
 * `CENTRALE NUCLEAIRE DE`.
 */
const SITE_NAME_INTRODUCERS = Object.freeze([
  /\bDE LA CENTRALE (?:NUCLEAIRE|THERMIQUE|HYDRAULIQUE) DE\s+/u,
  /\bDE LA FERME [EÉ]OLIENNE DE\s+/u,
  /\bCENTRALE (?:NUCLEAIRE|THERMIQUE|HYDRAULIQUE) DE\s+/u,
  /\bFERME [EÉ]OLIENNE DE\s+/u,
  // `SSLAIS01-STOCKAGE N0 01 DE SAINT-LAID` — the ordinal sits INSIDE the
  // introducer here, which is why these are patterns and not fixed strings.
  /\bSTOCKAGE N0\s*\d+\s+DE\s+/u,
]);

/**
 * French articles the register parks at the END of a station name.
 *
 * `TRICASTIN (LE)`, `BUGEY (LE)`, `BATHIE (LA)`, `MORANDES (LES)`, `AIGLE (L )`
 * are index-sort spellings, not part of the name. Moved back to the front so
 * the card reads `Le Tricastin` rather than `Tricastin (Le)`. A parenthetical
 * that is anything else — `BOLLENE (SPECIALISE)`, `BELLEVILLE
 * (BELLEVILLE-SUR-LOIRE)` — is left exactly where the register put it, because
 * it is saying something.
 */
const TRAILING_ARTICLE = /^(.*?)\s*\(\s*(LE|LA|LES|L)\s*'?\s*\)$/u;

/**
 * Site captions per class, used to rebuild a readable station name.
 * The register's own words, kept in French because the operator's are.
 */
const SITE_KIND_CAPTION = Object.freeze({
  nuclear: 'Centrale nucléaire',
  'hydro-reservoir': 'Centrale hydraulique',
  'hydro-run-of-river': 'Centrale hydraulique',
  'hydro-pumped': 'Station de pompage',
  'fossil-gas': 'Centrale thermique',
  'fossil-coal': 'Centrale thermique',
  'fossil-oil': 'Centrale thermique',
  biomass: 'Centrale biomasse',
  wind: 'Ferme éolienne',
  solar: 'Centrale photovoltaïque',
  marine: 'Usine marémotrice',
  battery: 'Stockage',
  other: 'Site de production',
});

/**
 * Particles that stay lower-case inside a French place name — but never as its
 * first word, which is why `Le Tricastin` survives and `Saint-Laurent-des-Eaux`
 * loses its capital D.
 */
const NAME_PARTICLES = new Set([
  'de', 'des', 'du', 'la', 'le', 'les', 'sur', 'sous', 'en', 'et', 'aux', 'au', 'lès', 'les',
]);

/**
 * Title-case a shouted register name without destroying its hyphens, its
 * particles or its roman numerals.
 *
 * `SAUSSAZ II` is the second Saussaz plant, and naive title-casing writes
 * `Saussaz Ii`, which is not a word in any language. Roman-numeral tokens are
 * left shouting.
 */
export function titleCaseStationName(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  let first = true;
  return text.replace(/[^\s\-/'’()]+/gu, (word) => {
    if (/^[IVXLC]{1,6}$/.test(word)) { first = false; return word; }
    const lower = word.toLocaleLowerCase('fr-FR');
    const cased = first || !NAME_PARTICLES.has(lower)
      ? lower.charAt(0).toLocaleUpperCase('fr-FR') + lower.slice(1)
      : lower;
    first = false;
    return cased;
  });
}

/**
 * Split one `nominstallation` into its code, its unit caption and its site.
 *
 * Returns nulls rather than guesses for the six rows the register publishes as
 * the literal string `Confidentiel` — every one of them an overseas or Corsican
 * unit, none of them on the metropolitan grid RTE's API covers, and none of
 * them carrying a `postesource` either. They are kept in the register with no
 * name rather than dropped, so the count still adds up.
 *
 * @param {*} raw - `nominstallation`.
 * @returns {{code: ?string, unit: ?string, site: ?string, confidential: boolean}}
 */
export function parseInstallationName(raw) {
  const text = String(raw ?? '').trim();
  if (!text || /^confidentiel$/i.test(text)) {
    return { code: null, unit: null, site: null, confidential: true };
  }

  // The code is everything up to the first `-`, with or without spaces around
  // it — `BVIL7N01 - GROUPE…` and `BOLLEH-CENTRALE…` are the same grammar.
  const dash = text.indexOf('-');
  const code = dash > 0 ? text.slice(0, dash).trim() : null;
  const rest = dash > 0 ? text.slice(dash + 1).trim() : text;

  const upper = rest.toUpperCase();
  let site = null;
  let unit = null;
  for (const introducer of SITE_NAME_INTRODUCERS) {
    const match = introducer.exec(upper);
    if (!match) continue;
    unit = rest.slice(0, match.index).trim().replace(/[\s-]+$/, '') || null;
    site = rest.slice(match.index + match[0].length).trim();
    break;
  }
  if (site === null) site = rest;

  // Hydro rows carry a trailing `-6` / `-7` group ordinal that belongs to the
  // unit, not to the station: `CENTRALE HYDRAULIQUE DE BROMMAT-7`.
  const ordinal = /-(\d{1,2})$/.exec(site);
  if (ordinal) {
    site = site.slice(0, ordinal.index).trim();
    if (!unit) unit = `Groupe ${ordinal[1]}`;
  }
  const article = TRAILING_ARTICLE.exec(site);
  if (article) site = `${article[2]}${article[2] === 'L' ? '’' : ' '}${article[1]}`;
  site = site.replace(/\s+/g, ' ').trim() || null;

  // The register's own unit code ends in the group ordinal — `BVIL7N01` is
  // group 01, `M.PONT51` is group 51 — so a row whose prose never says
  // "GROUPE nn" (the storage and offshore-wind grammars) still gets numbered
  // from a published field rather than from its position in a list.
  if (!unit && code) {
    const tail = /(\d{1,2})$/.exec(code);
    if (tail) unit = `Groupe ${tail[1]}`;
  }
  return {
    code: code || null,
    unit: unit ? titleCaseStationName(unit) : null,
    site,
    confidential: false,
  };
}

/**
 * Normalize a station name for comparison against OpenStreetMap.
 *
 * Accent-folded, punctuation-stripped, article-stripped, upper-cased. Used ONLY
 * by the authoring-time placement in `scripts/build-rte-units-registry.mjs`;
 * nothing at runtime matches on names.
 * @param {*} raw
 * @returns {string}
 */
export function normalizeStationName(raw) {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    // `ST-ALBAN-ST-MAURICE` in the register is `Saint-Alban` in OpenStreetMap.
    // Folding the abbreviation is what makes those two the same station.
    .replace(/\b(?:STE?|SAINTE)\b/g, 'SAINT')
    .replace(/\b(LE|LA|LES|DE|DU|DES|D|L|SUR|SOUS|EN|ET|CENTRALE|USINE|POSTE|ELECTRIQUE|HYDROELECTRIQUE|NUCLEAIRE|THERMIQUE|HYDRAULIQUE|CNPE|CENTRE|PRODUCTION|ELECTRICITE)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether two station names refer to the same station, by tokens.
 *
 * Equality first, then contiguous token containment — `SUPER BISSORTE` matches
 * `BISSORTE`, and `SAINT CROIX VERDON` matches `SAINT CROIX`. Deliberately NOT
 * a raw substring test: `DURANCE`.includes(`RANCE`) is true and would put the
 * Rance tidal barrage on a Provençal river. Returns the match STRENGTH so a
 * caller can prefer an exact hit over a loose one, which is what disambiguates
 * EDF's `BISSORTE` from its `SUPER-BISSORTE` in the same file.
 *
 * @param {string} a - A normalized name (`normalizeStationName`).
 * @param {string} b - The other normalized name.
 * @returns {number} 2 = identical, 1 = one contains the other, 0 = no match.
 */
export function stationNameMatch(a, b) {
  const left = String(a ?? '').trim();
  const right = String(b ?? '').trim();
  if (!left || !right) return 0;
  if (left === right) return 2;
  const leftTokens = left.split(' ');
  const rightTokens = right.split(' ');
  const contains = (haystack, needle) => {
    if (needle.length > haystack.length) return false;
    for (let start = 0; start + needle.length <= haystack.length; start += 1) {
      let ok = true;
      for (let i = 0; i < needle.length; i += 1) {
        if (haystack[start + i] !== needle[i]) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  };
  return contains(leftTokens, rightTokens) || contains(rightTokens, leftTokens) ? 1 : 0;
}

/**
 * `puismaxinstallee` is published in KILOWATTS.
 *
 * 1310000 is a 1 310 MW reactor, not a 1.3 TW one. Reading it as megawatts
 * makes the French fleet a thousand times larger than the planet's, which is
 * obvious — and reading it as watts makes it 1 310 kW, which is not.
 * @param {*} value
 * @returns {?number} Megawatts, or null.
 */
export function registreKwToMw(value) {
  const kw = Number(value);
  if (!Number.isFinite(kw) || kw <= 0) return null;
  return Math.round((kw / 1000) * 10) / 10;
}

/** Parse the register's `DD/MM/YYYY` dates to ISO, or null. */
export function parseRegistreDate(value) {
  const text = String(value ?? '').trim();
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return iso ? iso[0] : null;
}

/**
 * Compose a readable station name from its class and the register's site name.
 *
 * Two French contractions and one missing space, all of them in the register's
 * own strings: `de Le Bugey` is `du Bugey`, `de Les Morandes` is
 * `des Morandes`, and `PROVENCE(EX GARD5)` is missing the space before its
 * parenthesis. Nothing else about the published name is touched.
 *
 * @param {string} klass - Generation class id.
 * @param {string} siteName - Raw site name from `parseInstallationName`.
 * @returns {string}
 */
export function composeSiteName(klass, siteName) {
  const caption = SITE_KIND_CAPTION[klass] || SITE_KIND_CAPTION.other;
  const name = titleCaseStationName(String(siteName ?? '').replace(/(\S)\(/g, '$1 ('));
  if (/^Le /.test(name)) return `${caption} du ${name.slice(3)}`;
  if (/^Les /.test(name)) return `${caption} des ${name.slice(4)}`;
  if (/^La /.test(name)) return `${caption} de la ${name.slice(3)}`;
  if (/^L[’']/.test(name)) return `${caption} de ${name.charAt(0).toLowerCase()}${name.slice(1)}`;
  // `de Avignon` is not French. Elide before a vowel — and NOT before an `h`,
  // which needs to know whether it is muet or aspiré and whether the noun is
  // plural: `d’Hermillon` is right but `d’Hautes - Falaises` is not, and a
  // slightly clunky `de Hermillon` beats a confidently wrong contraction.
  if (/^[AEIOUYÀÂÉÈÊËÎÏÔÖÛÜ]/u.test(name)) return `${caption} d’${name}`;
  return `${caption} de ${name}`;
}

/**
 * Project one ODRÉ register row into a registry unit.
 * @param {object} row - Raw record from the ODRÉ registre.
 * @returns {?object} Registry unit, or null when the row carries no EIC code.
 */
export function projectRegistreUnit(row) {
  const eic = String(row?.codeeicresourceobject ?? '').trim();
  if (!eic) return null;
  const mw = registreKwToMw(row?.puismaxinstallee);
  const parsed = parseInstallationName(row?.nominstallation);
  const klass = classifyRegistreRow(row);
  return {
    eic,
    code: parsed.code,
    // The site key is the RTE connection substation the unit reports to. It is
    // the register's own grouping and it is exact: across the 171 units above
    // the floor, no `postesource` spans two communes and none mixes filières
    // (measured 2026-08-28). The six rows without one are the confidential
    // overseas units, which fall back to their commune.
    site: String(row?.postesource ?? '').trim()
      || (row?.codeinseecommune ? `INSEE:${String(row.codeinseecommune).trim()}` : null),
    siteName: parsed.site,
    unitName: parsed.unit,
    confidential: parsed.confidential,
    class: klass,
    filiere: String(row?.filiere ?? '').trim() || null,
    technologie: String(row?.technologie ?? '').trim() || null,
    combustible: String(row?.combustible ?? '').trim() || null,
    mw,
    regime: String(row?.regime ?? '').trim() || null,
    kv: String(row?.tensionraccordement ?? '').trim() || null,
    commune: String(row?.commune ?? '').trim() || null,
    insee: String(row?.codeinseecommune ?? '').trim() || null,
    departement: String(row?.departement ?? '').trim() || null,
    region: String(row?.region ?? '').trim() || null,
    commissioned: parseRegistreDate(row?.datemiseenservice),
    connected: parseRegistreDate(row?.dateraccordement),
  };
}

/**
 * Group registry units into the stations that will actually be drawn.
 *
 * A site takes the class of the class holding the most installed MW in it, and
 * reports the whole breakdown, so a station whose units disagree says so rather
 * than picking a colour and hiding the rest.
 * @param {Array<object>} units - Output of `projectRegistreUnit`.
 * @returns {Array<object>} Sites, most installed power first.
 */
export function groupRegistreSites(units) {
  const sites = new Map();
  for (const unit of Array.isArray(units) ? units : []) {
    if (!unit?.site) continue;
    let site = sites.get(unit.site);
    if (!site) {
      site = {
        id: unit.site,
        name: null,
        class: unit.class,
        mw: 0,
        units: [],
        classes: {},
        commune: unit.commune,
        insee: unit.insee,
        departement: unit.departement,
        region: unit.region,
      };
      sites.set(unit.site, site);
    }
    site.units.push(unit.eic);
    if (Number.isFinite(unit.mw)) site.mw += unit.mw;
    site.classes[unit.class] = (site.classes[unit.class] || 0) + (unit.mw || 0);
    if (!site.name && unit.siteName) {
      site.name = composeSiteName(unit.class, unit.siteName);
    }
  }
  for (const site of sites.values()) {
    site.mw = Math.round(site.mw * 10) / 10;
    const ranked = Object.entries(site.classes).sort((a, b) => b[1] - a[1]);
    if (ranked.length) site.class = ranked[0][0];
    if (!site.name) {
      site.name = site.commune
        ? `${SITE_KIND_CAPTION[site.class] || SITE_KIND_CAPTION.other} · ${site.commune}`
        : site.id;
    }
  }
  return [...sites.values()].sort((a, b) => b.mw - a.mw || a.id.localeCompare(b.id));
}

// --- Time, in the timezone the grid is dispatched in ------------------------

/**
 * Europe/Paris UTC offset at an instant, in minutes.
 *
 * RTE's timestamps and windows are Paris-local with an explicit offset, and the
 * offset moves twice a year. Derived from `Intl` rather than hardcoded to +01/+02
 * so the DST switch is not a yearly bug.
 * @param {Date} date
 * @returns {number} Minutes east of UTC (+60 in winter, +120 in summer).
 */
export function parisOffsetMinutes(date) {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    timeZoneName: 'longOffset',
  }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value || '';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/**
 * Format an instant the way RTE's query parameters want it:
 * `YYYY-MM-DDTHH:mm:ss±HH:MM`, Paris-local.
 * @param {Date} date
 * @returns {string}
 */
export function formatRteDate(date) {
  const offset = parisOffsetMinutes(date);
  const shifted = new Date(date.getTime() + offset * 60_000);
  const stamp = shifted.toISOString().slice(0, 19);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${stamp}${sign}${hh}:${mm}`;
}

/**
 * The instant of Paris-local midnight, `dayOffset` days from `date`.
 *
 * Resolved by fixed point rather than by arithmetic: the offset that applies at
 * the midnight being computed is not necessarily the offset that applies now,
 * which is exactly wrong on the two changeover days of the year.
 * @param {Date} date
 * @param {number} [dayOffset=0]
 * @returns {Date}
 */
export function parisDayStart(date, dayOffset = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const [year, month, day] = parts.split('-').map(Number);
  // The instant whose Paris wall clock reads `Y-M-(D+offset) 00:00`. Start from
  // the naive UTC midnight, then subtract the offset that actually applies
  // THERE rather than the one that applies now. One correction converges: the
  // offset moves by an hour at most, and never at midnight — France changes
  // clocks at 02:00/03:00, so a Paris midnight is never inside the seam.
  const naive = Date.UTC(year, month - 1, day + dayOffset, 0, 0, 0);
  const firstGuess = naive - parisOffsetMinutes(new Date(naive)) * 60_000;
  return new Date(naive - parisOffsetMinutes(new Date(firstGuess)) * 60_000);
}

/**
 * The window this layer asks RTE for: Paris-local yesterday 00:00 → tomorrow 00:00.
 *
 * Two days, unconditionally, and that is the point. A day-boundary window over
 * TODAY is empty at 00:30 Paris — the published-hours-so-far of a day that is
 * half an hour old — which is why other clients of this resource carry an
 * explicit "if it is before 03:00, ask for yesterday too" branch. Spanning the
 * boundary always removes the branch and the edge case with it, and buys the
 * ~24 hours of history the cards draw as a sparkline.
 *
 * @param {Date} [now=new Date()]
 * @returns {{startDate: string, endDate: string, start: Date, end: Date}}
 */
export function rteGenerationWindow(now = new Date()) {
  const start = parisDayStart(now, -1);
  const end = parisDayStart(now, 1);
  return {
    start,
    end,
    startDate: formatRteDate(start),
    endDate: formatRteDate(end),
  };
}

/** Epoch ms of an RTE timestamp, or NaN. */
function epochOf(value) {
  const time = Date.parse(String(value ?? ''));
  return Number.isFinite(time) ? time : NaN;
}

/**
 * A published megawatt reading, or null.
 *
 * Trap 1 in one function. `Number(null)`, `Number('')` and `Number(false)` are
 * all 0, so a numeric coercion alone turns three different kinds of ABSENCE
 * into a reactor that is running at exactly zero — which is a real and
 * different state. Only an actual number, or a string that is entirely one,
 * counts as a reading.
 * @param {*} raw
 * @returns {?number}
 */
export function parseGenerationValue(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// --- The live projection ----------------------------------------------------

/** How many published steps of history each unit carries to the client. */
export const RTE_HISTORY_STEPS = 24;

/**
 * Merge, de-duplicate and sort one unit's published values.
 *
 * Traps 4, 5 and 6 all land here: order is not promised, one EIC can arrive in
 * more than one envelope, and RTE republishes an hour with a newer
 * `updated_date`. Rows are keyed on `start_date`; a repeat wins only if it was
 * updated later, and a repeat with no `updated_date` never displaces one that
 * has.
 *
 * @param {Array<object>} rows - Raw `values` entries, possibly from several envelopes.
 * @returns {Array<{at:number, to:?number, mw:?number, updatedAt:?number}>} Ascending by time.
 */
export function mergeUnitValues(rows) {
  const byStart = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const at = epochOf(row?.start_date);
    if (!Number.isFinite(at)) continue;
    const updatedAt = epochOf(row?.updated_date);
    const previous = byStart.get(at);
    if (previous) {
      const previousUpdated = previous.updatedAt;
      const newerWins = Number.isFinite(updatedAt)
        && (!Number.isFinite(previousUpdated) || updatedAt >= previousUpdated);
      if (!newerWins) continue;
    }
    const to = epochOf(row?.end_date);
    byStart.set(at, {
      at,
      to: Number.isFinite(to) ? to : null,
      // Trap 1 lives in `parseGenerationValue`: `0` is a stopped reactor and it
      // is the reading this layer most needs to keep.
      mw: parseGenerationValue(row?.value),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : null,
    });
  }
  return [...byStart.values()].sort((a, b) => a.at - b.at);
}

/**
 * Index of the last MEASURED step in a merged series, or −1.
 *
 * Trap 2: the tail of the window is the future and carries `value: null`, so
 * the last ELEMENT is not the last reading. Scans backwards for a finite value.
 * @param {Array<object>} values - Output of `mergeUnitValues`.
 * @returns {number}
 */
export function latestMeasuredIndex(values) {
  if (!Array.isArray(values)) return -1;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(values[i]?.mw)) return i;
  }
  return -1;
}

/**
 * The last MEASURED step in a merged series.
 * @param {Array<object>} values - Output of `mergeUnitValues`.
 * @returns {?object}
 */
export function latestMeasured(values) {
  const index = latestMeasuredIndex(values);
  return index < 0 ? null : values[index];
}

/**
 * The `steps` readings ENDING at the last measured one.
 *
 * Not `slice(-steps)`: the window deliberately runs to tomorrow morning, so the
 * plain tail is mostly the unpublished future and a sparkline built from it is
 * two thirds empty. History ends where measurement ends. Interior nulls are
 * kept — a gap inside the record is a published gap and is drawn as one.
 *
 * @param {Array<object>} values - Output of `mergeUnitValues`.
 * @param {number} steps
 * @returns {Array<?number>} Megawatt readings, oldest first.
 */
export function measuredHistory(values, steps) {
  const end = latestMeasuredIndex(values);
  if (end < 0) return [];
  const span = Math.max(1, Math.floor(steps) || 1);
  return values.slice(Math.max(0, end - span + 1), end + 1).map((value) => value.mw);
}

/**
 * The published step of a merged series, in minutes, or null.
 * Derived rather than assumed, so a resource that moves from hourly to
 * quarter-hourly reports itself instead of silently relabelling its history.
 * @param {Array<object>} values
 * @returns {?number}
 */
export function publishedStepMinutes(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const gaps = new Map();
  for (let i = 1; i < values.length; i += 1) {
    const gap = Math.round((values[i].at - values[i - 1].at) / 60_000);
    if (gap > 0) gaps.set(gap, (gaps.get(gap) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [gap, count] of gaps) {
    if (count > bestCount) { best = gap; bestCount = count; }
  }
  return best;
}

/**
 * Project one `actual_generations_per_unit` response into per-unit records.
 *
 * @param {object} payload - Parsed RTE response.
 * @param {object} [options]
 * @param {number} [options.historySteps=RTE_HISTORY_STEPS] - Steps kept per unit.
 * @returns {{units: Array<object>, stats: object}}
 */
export function projectActualGenerations(payload, { historySteps = RTE_HISTORY_STEPS } = {}) {
  const envelopes = Array.isArray(payload?.actual_generations_per_unit)
    ? payload.actual_generations_per_unit
    : [];

  // Trap 5: merge envelopes by EIC before reading anything out of them.
  /** @type {Map<string, {unit: object, rows: Array<object>}>} */
  const merged = new Map();
  let unnamed = 0;
  for (const envelope of envelopes) {
    const eic = String(envelope?.unit?.eic_code ?? '').trim();
    if (!eic) { unnamed += 1; continue; }
    const existing = merged.get(eic);
    if (existing) {
      existing.rows.push(...(Array.isArray(envelope?.values) ? envelope.values : []));
      // A later envelope may carry a capacity the earlier one omitted; it never
      // overwrites one that is already there.
      if (!Number.isFinite(existing.unit.installed_capacity)
        && Number.isFinite(Number(envelope?.unit?.installed_capacity))) {
        existing.unit = envelope.unit;
      }
      continue;
    }
    merged.set(eic, {
      unit: envelope?.unit || {},
      rows: Array.isArray(envelope?.values) ? [...envelope.values] : [],
    });
  }

  const units = [];
  const byClass = new Map();
  const stepVotes = new Map();
  let totalMw = 0;
  let reporting = 0;
  let pumping = 0;
  let newest = null;

  for (const [eic, entry] of merged) {
    const values = mergeUnitValues(entry.rows);
    const latest = latestMeasured(values);
    const step = publishedStepMinutes(values);
    // The fleet's step is the modal one, not the first unit's: one machine with
    // a single published hour would otherwise name the resolution for all of
    // them.
    if (step) stepVotes.set(step, (stepVotes.get(step) || 0) + 1);
    const productionType = String(entry.unit?.production_type ?? '').trim() || null;
    const klass = classifyRteProductionType(productionType);
    const capacityRaw = Number(entry.unit?.installed_capacity);
    const installedMw = Number.isFinite(capacityRaw) && capacityRaw > 0 ? capacityRaw : null;

    const history = measuredHistory(values, historySteps);
    const record = {
      eic,
      name: String(entry.unit?.name ?? '').trim() || null,
      productionType,
      class: klass,
      installedMw,
      mw: latest ? latest.mw : null,
      at: latest ? latest.at : null,
      to: latest ? latest.to : null,
      updatedAt: latest ? latest.updatedAt : null,
      stepMinutes: step,
      history,
    };
    units.push(record);

    if (Number.isFinite(record.mw)) {
      reporting += 1;
      totalMw += record.mw;
      if (record.mw < 0) pumping += 1;
      const bucket = byClass.get(klass) || { mw: 0, units: 0, installedMw: 0 };
      bucket.mw += record.mw;
      bucket.units += 1;
      if (Number.isFinite(installedMw)) bucket.installedMw += installedMw;
      byClass.set(klass, bucket);
      if (newest === null || record.at > newest) newest = record.at;
    }
  }

  units.sort((a, b) => (b.installedMw || 0) - (a.installedMw || 0) || a.eic.localeCompare(b.eic));

  let stepMinutes = null;
  let stepVoteCount = 0;
  for (const [step, votes] of stepVotes) {
    if (votes > stepVoteCount) { stepMinutes = step; stepVoteCount = votes; }
  }

  return {
    units,
    stats: {
      units: units.length,
      reporting,
      pumping,
      unnamed,
      totalMw: Math.round(totalMw),
      latestAt: newest,
      stepMinutes,
      byClass: Object.fromEntries(
        [...byClass].map(([id, value]) => [id, {
          mw: Math.round(value.mw),
          units: value.units,
          installedMw: Math.round(value.installedMw),
        }]),
      ),
    },
  };
}

/**
 * RTE names a unit `<STATION> <n>` — `GRAND MAISON 10`, `BATHIE 3`, `PALUEL 1`.
 * This strips the group ordinal to leave the station.
 *
 * Only a TRAILING number is removed, so `CHOOZ B 1` keeps its `B` and
 * `SUPER BISSORTE 5` keeps `SUPER`. A name that is all station and no ordinal
 * (`CERNAY`, `SAINT-PIERRE`) passes through untouched.
 *
 * @param {*} name - RTE's `unit.name`.
 * @returns {string} The station part, unnormalized.
 */
export function rteStationNameOf(name) {
  return String(name ?? '').replace(/\s+\d+\s*$/, '').trim();
}

/**
 * Attach live units the EIC key could not place to the STATION they name.
 *
 * ── Trap 9: the two publishers cut the fleet in different places ────────────
 *
 * The EIC join is exact for nuclear and thermal, where both RTE and the ODRÉ
 * register publish one row per generating unit and agree on its code. It fails
 * wholesale for HYDRO, because they do not describe the same objects: the
 * register carries one row per plant (`G.MAIH-CENTRALE HYDRAULIQUE DE
 * GRAND-MAISON-7`, EIC `17W100P100P02756`, 1 690 MW) while RTE publishes the
 * TWELVE turbine groups inside it under twelve entirely different EIC codes
 * (`17W100P100P0058E` … `17W100P100P00699`). Neither is wrong; they are
 * different granularities of the same machine hall, and no published table
 * maps one onto the other.
 *
 * Measured against the live API on 2026-08-28: 152 units published, 97 placed
 * by EIC, and **55 left over — 36% of the fleet and 1 914 MW**, nearly all of
 * it hydro. Drawn without this fallback, Grand'Maison, La Bâthie, Montézic,
 * Revin, Super-Bissorte and thirteen more read as "RTE published nothing" while
 * RTE was publishing them by the dozen.
 *
 * So the ordinal is stripped and the station name is matched against the
 * register's, through the same token matcher the authoring script uses. The
 * rules that keep it honest:
 *
 * • **The EIC key always wins.** This runs only on what it could not place.
 * • **Only a unique winner is taken.** `SAINT-PIERRE` matches two different
 *   register stations, so it stays unplaced rather than being assigned to the
 *   nearer-looking one.
 * • **Every unit records how it was matched.** `matchedBy: 'name'` travels to
 *   the card, because a name match is weaker evidence than a published code.
 * • **Nothing is invented.** A unit whose station the register has never heard
 *   of — `DIRINON 1`, `CYCOFOS PL2` — stays unplaced and counted.
 *
 * @param {object} registry - Shipped registry.
 * @param {Array<object>} orphans - Live units no register EIC claimed.
 * @returns {Map<string, Array<object>>} Site id → the units adopted into it.
 */
export function adoptUnitsByStationName(registry, orphans) {
  const adopted = new Map();
  const sites = (Array.isArray(registry?.sites) ? registry.sites : []).map((site) => ({
    id: site.id,
    key: normalizeStationName(site.rawSiteName || site.name),
  })).filter((site) => site.key);
  if (!sites.length) return adopted;

  for (const unit of Array.isArray(orphans) ? orphans : []) {
    const wanted = normalizeStationName(rteStationNameOf(unit?.name));
    if (!wanted) continue;
    let best = 0;
    let winners = [];
    for (const site of sites) {
      const strength = stationNameMatch(wanted, site.key);
      if (!strength) continue;
      if (strength > best) { best = strength; winners = [site]; } else if (strength === best) winners.push(site);
    }
    if (winners.length !== 1) continue;
    const id = winners[0].id;
    if (!adopted.has(id)) adopted.set(id, []);
    adopted.get(id).push(unit);
  }
  return adopted;
}

/**
 * Join projected live units onto the shipped registry.
 *
 * The registry is the drawn fleet; the live document only ever adds numbers to
 * it. Trap 8 is the whole reason this returns an `unplaced` list: a unit RTE
 * reports that the registry has never heard of is counted and its megawatts
 * kept in the national total, but it is NOT drawn — there is nowhere honest to
 * draw it.
 *
 * @param {{sites: Array<object>, units: Array<object>}} registry - Shipped registry.
 * @param {Array<object>} liveUnits - Output of `projectActualGenerations().units`.
 * @returns {{sites: Array<object>, unplaced: Array<object>, stats: object}}
 */
export function joinGenerationToRegistry(registry, liveUnits) {
  const live = new Map();
  for (const unit of Array.isArray(liveUnits) ? liveUnits : []) {
    if (unit?.eic) live.set(unit.eic, unit);
  }
  const registryUnits = new Map(
    (Array.isArray(registry?.units) ? registry.units : []).map((unit) => [unit.eic, unit]),
  );

  // Trap 9 — the two publishers cut the fleet at different granularities.
  // Everything the EIC key could not place is offered to the name fallback,
  // which attaches it to a SITE rather than to a register unit.
  const adopted = adoptUnitsByStationName(registry, [...live.values()]
    .filter((unit) => !registryUnits.has(unit.eic)));

  const sites = [];
  let placedMw = 0;
  let placedUnits = 0;
  let liveSites = 0;
  for (const site of Array.isArray(registry?.sites) ? registry.sites : []) {
    const units = [];
    let mw = 0;
    let installedMw = 0;
    let reporting = 0;
    let latestAt = null;
    for (const eic of site.units || []) {
      const registered = registryUnits.get(eic) || { eic };
      const measured = live.get(eic) || null;
      // Trap 7: two capacities, both reported, never averaged. RTE's is the
      // denominator when RTE sent one, because its MW figure is measured
      // against it.
      const capacity = Number.isFinite(measured?.installedMw)
        ? measured.installedMw
        : (Number.isFinite(registered.mw) ? registered.mw : null);
      if (Number.isFinite(capacity)) installedMw += capacity;
      const value = measured && Number.isFinite(measured.mw) ? measured.mw : null;
      if (value !== null) {
        mw += value;
        reporting += 1;
        if (latestAt === null || measured.at > latestAt) latestAt = measured.at;
      }
      units.push({
        eic,
        name: registered.unitName || measured?.name || null,
        code: registered.code || null,
        class: registered.class || measured?.class || 'other',
        registryMw: Number.isFinite(registered.mw) ? registered.mw : null,
        installedMw: Number.isFinite(capacity) ? capacity : null,
        mw: value,
        at: measured?.at ?? null,
        updatedAt: measured?.updatedAt ?? null,
        regime: registered.regime || null,
        productionType: measured?.productionType || null,
        history: measured?.history || null,
        reporting: value !== null,
        matchedBy: measured ? 'eic' : null,
      });
    }

    // Units RTE publishes for this station that the register does not carry an
    // EIC for — its turbine groups, where the register only has the plant.
    // They add their MEGAWATTS but never their capacity: the register's plant
    // figure already covers the whole hall, so adding a nameplate here would
    // count the same iron twice.
    for (const measured of adopted.get(site.id) || []) {
      const value = Number.isFinite(measured.mw) ? measured.mw : null;
      if (value !== null) {
        mw += value;
        reporting += 1;
        if (latestAt === null || measured.at > latestAt) latestAt = measured.at;
      }
      units.push({
        eic: measured.eic,
        name: measured.name || null,
        code: null,
        class: measured.class || 'other',
        registryMw: null,
        installedMw: null,
        mw: value,
        at: measured.at ?? null,
        updatedAt: measured.updatedAt ?? null,
        regime: null,
        productionType: measured.productionType || null,
        history: measured.history || null,
        reporting: value !== null,
        matchedBy: 'name',
      });
    }
    units.sort((a, b) => (b.installedMw || 0) - (a.installedMw || 0) || a.eic.localeCompare(b.eic));
    if (reporting) { liveSites += 1; placedMw += mw; }
    placedUnits += reporting;
    sites.push({
      ...site,
      units,
      installedMw: Math.round(installedMw * 10) / 10,
      mw: reporting ? Math.round(mw * 10) / 10 : null,
      reporting,
      latestAt,
      // A site with no reporting unit has a null load, NOT a zero one: "RTE
      // published nothing for this station" and "this station is producing
      // nothing" are different facts and must not share a colour.
      //
      // When only SOME of a station's units report, the denominator is still
      // the WHOLE station's nameplate. That deliberately understates: Brommat
      // with one 180 MW group at 172 MW and one silent group reads as 42% of
      // 406 MW, not 96%. The alternative — dividing by the reporting units'
      // capacity only — would fill a ring sized for the whole station on the
      // strength of half of it, which claims something about the silent half.
      // Understating is recoverable; the card says how many groups reported.
      load: reporting && installedMw > 0 ? mw / installedMw : null,
    });
  }

  const adoptedEics = new Set([...adopted.values()].flat().map((unit) => unit.eic));
  const unplaced = [];
  let unplacedMw = 0;
  for (const [eic, unit] of live) {
    if (registryUnits.has(eic) || adoptedEics.has(eic)) continue;
    unplaced.push({
      eic,
      name: unit.name,
      productionType: unit.productionType,
      class: unit.class,
      installedMw: unit.installedMw,
      mw: unit.mw,
    });
    if (Number.isFinite(unit.mw)) unplacedMw += unit.mw;
  }
  unplaced.sort((a, b) => (b.installedMw || 0) - (a.installedMw || 0) || a.eic.localeCompare(b.eic));

  return {
    sites,
    unplaced,
    stats: {
      sites: sites.length,
      liveSites,
      placedUnits,
      placedMw: Math.round(placedMw),
      unplacedUnits: unplaced.length,
      unplacedMw: Math.round(unplacedMw),
      // How much of the fleet reached a station only through its NAME. Worth
      // reporting on its own: it is the weaker of the two joins.
      adoptedUnits: adoptedEics.size,
      // Registry units RTE said nothing about this window. Also a fact.
      silentUnits: [...registryUnits.keys()].filter((eic) => !live.has(eic)).length,
    },
  };
}

/**
 * Sparkline over a unit's published history.
 *
 * A null step is a published gap and is drawn as a gap (`·`), never as zero —
 * the same distinction the site load keeps. A negative step (pumping) is drawn
 * as `▽`, because it is not a small amount of generation, it is the opposite of
 * generation.
 *
 * @param {Array<?number>} history - Megawatt readings, oldest first.
 * @param {?number} referenceMw - Installed capacity the bars are scaled to.
 * @returns {string}
 */
export function generationSparkline(history, referenceMw) {
  // The drawing moved to `./sparkline.js` when the Hub'Eau layer needed the
  // same picture for a river. Kept as a named wrapper because "reference" here
  // means something specific — the group's nameplate, so two groups of
  // different sizes are comparable bar for bar — which a generic parameter name
  // would lose. See that module for why a gap is `·` and not `▁`.
  return textSparkline(history, Number.isFinite(referenceMw) && referenceMw > 0 ? referenceMw : null);
}
