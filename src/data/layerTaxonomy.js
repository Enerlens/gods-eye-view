/*
 * LAYER TAXONOMY — the one place that says what each dataset IS.
 *
 * The Data Layers panel used to render `getAll()` in registration order, which
 * is the order the layers were merged in. That was an accident, not a decision:
 * the French energy layers sat together because their PRs landed back to back,
 * and Marine Buoys sat between Mapped Installations and Datacenters for no
 * reason at all. This file replaces that accident with a stated grouping.
 *
 * WHY A CENTRAL FILE AND NOT A `category:` FIELD ON EACH LAYER MODULE
 *
 * Grouping and ordering are product decisions about the WHOLE set — "does
 * Defence stand apart from Air & Space?" is not a question any single layer
 * module can answer. Spread across 27 modules those decisions become unreviewable;
 * here they are one diff. This mirrors LAYER_STATE_REGISTRY in ./layerState.js,
 * which already owns the other cross-cutting per-layer decision (share tokens).
 *
 * EXHAUSTIVENESS IS ENFORCED, NOT DOCUMENTED
 *
 * `validateLayerTaxonomy()` runs at import and cross-checks this table against
 * REGISTERED_LAYER_IDS in both directions. Adding a data layer without giving it
 * a category is therefore a BOOT FAILURE, not a row that quietly lands in
 * whatever group it was appended next to. Same contract, same reason, as the
 * duplicate-token assertion next door.
 *
 * WHAT READS THIS
 *
 * `main.js` hands both tables to `finalizeRegistrations()`, and the Data Layers
 * panel renders one collapsible group per category, each row showing `label`
 * (the French name) plus a scope chip derived from `coverage`. `name` — the
 * English string on the layer module — stays the canonical id-adjacent name and
 * is what the voice layer and the LLM scene context still report; only the
 * human-facing surfaces moved to `label`.
 *
 * A manager sealed WITHOUT these tables still renders the old flat list. That
 * is not dead code: `getAll()` already documents "null when sealed without a
 * taxonomy", and the unit tests build bare managers that way.
 */

import { REGISTERED_LAYER_IDS } from './layerState.js';

/**
 * The groups, in panel order. Ordering is a product decision: the flagship
 * live-tracking layers open the panel, the bundled reference sets close it.
 *
 * Labels are French and UPPERCASE. They are stored ACCENTED (`ÉNERGIE`, not
 * `ENERGIE`) rather than relying on `text-transform: uppercase` to add accents,
 * because it does not — CSS uppercasing preserves an accent that is already
 * there and invents none. `Énergie` typed lowercase-accented would render
 * correctly, but a plain `Energie` would render as a typo forever.
 */
export const LAYER_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'air-space', label: 'AIR & ESPACE', icon: '✈️' }),
  Object.freeze({ id: 'defence', label: 'DÉFENSE', icon: '🎖️' }),
  Object.freeze({ id: 'maritime', label: 'MARITIME', icon: '⚓' }),
  Object.freeze({ id: 'ground-mobility', label: 'MOBILITÉ TERRESTRE', icon: '🚗' }),
  // Deliberately "ÉNERGIE" and not "ÉNERGIE & RÉSEAUX": `comms-sensors` below is
  // "RÉSEAUX & CAPTEURS", and two categories whose labels both lead with the same
  // noun are two categories nobody can tell apart at a glance. The six layers
  // here — mix, production groups, plants, HV grid, gas, dams — are all covered
  // honestly by the single word.
  Object.freeze({ id: 'energy', label: 'ÉNERGIE', icon: '⚡' }),
  Object.freeze({ id: 'hazards', label: 'RISQUES & ENVIRONNEMENT', icon: '⚠' }),
  Object.freeze({ id: 'comms-sensors', label: 'RÉSEAUX & CAPTEURS', icon: '≋' }),
  // An EIGHTH group, added rather than forcing the building stock into one of
  // the seven. It fits none of them: a building is not energy, not a hazard,
  // not mobility, and putting it in "RÉSEAUX & CAPTEURS" beside CCTV and radio
  // would say it is a network, which it is not. It closes the panel because it
  // is base reference data — the ground everything else stands on — and it is
  // where a cadastre, a land-use or a population layer would join.
  Object.freeze({ id: 'built-environment', label: 'BÂTI & TERRITOIRE', icon: '▤' }),
]);

/**
 * `dataset` — a toggleable source the visitor turns on and off.
 * `coordinator` — registered in the same manager, but loads nothing of its own:
 *   it orchestrates other layers. `military-awareness` is the only one, and it
 *   is why this distinction exists. It depends on flights + military + AIS +
 *   installations to compute the 250 km proximity roster behind the CONTACTS
 *   panel, and it is `showInTogglePanel: false` because you enter it through
 *   that tab, never through a toggle. Listing it as a dataset would put a row
 *   in a group count for something that is not a source of data.
 */
const VALID_KINDS = new Set(['dataset', 'coordinator']);

/** Where the layer has data at all. Drives the per-row scope chip. */
const VALID_COVERAGE = new Set(['global', 'fr', 'us', 'cities']);

/**
 * The scope chip text for each coverage value — and the reason the `(FR)`
 * suffixes could leave the names.
 *
 * `global` maps to null ON PURPOSE. It is the default case, and a badge on
 * every row is a badge on none: chipping the global layers too would leave the
 * exceptional rows no louder than the ordinary ones. The chip answers one
 * question — "does this layer have anything where I am looking?" — and only a
 * non-global layer can ever answer it "no".
 */
export const COVERAGE_CHIPS = Object.freeze({
  global: null,
  fr: 'FR',
  us: 'US',
  cities: 'VILLES',
});

/**
 * Chip text for a coverage value.
 * @param {string} coverage One of VALID_COVERAGE.
 * @returns {string|null} Chip text, or null when the row needs no chip.
 */
export function coverageChip(coverage) {
  return COVERAGE_CHIPS[coverage] ?? null;
}

/** What it costs to see it — the README's 🟢 / 🟡 / 🔴 ladder, as data. */
const VALID_AUTH = new Set(['none', 'free-key', 'metered']);

/**
 * `live` — continuously moving or streaming subjects.
 * `periodic` — refetched on a poll or per viewport.
 * `static` — bundled in the repo; changes only when someone rebuilds the pack.
 */
const VALID_CADENCE = new Set(['live', 'periodic', 'static']);

const VALID_CATEGORY_IDS = new Set(LAYER_CATEGORIES.map((entry) => entry.id));

/**
 * Category, display name and facets for every registered layer.
 *
 * Ordered by category, then by intended within-group order — this array IS the
 * panel order, so a layer's position here is the decision, not an artifact of
 * where it was appended.
 *
 * The `(FR)` suffixes that five names carry today are gone on purpose: the
 * `coverage: 'fr'` facet renders as a scope chip on the row, which says the same
 * thing once instead of five times, and frees the width for a readable name
 * ("Groupes de production" rather than "Groupes de prod (FR)").
 */
const LAYER_TAXONOMY_TABLE = Object.freeze([
  // ── AIR & ESPACE ──────────────────────────────────────────────────────────
  Object.freeze({
    id: 'flights',
    category: 'air-space',
    label: 'Vols en direct',
    kind: 'dataset',
    coverage: 'global',
    auth: 'none',
    cadence: 'live',
  }),
  Object.freeze({
    id: 'satellites',
    category: 'air-space',
    label: 'Satellites',
    kind: 'dataset',
    coverage: 'global',
    auth: 'none',
    cadence: 'live',
  }),
  // The ground half of AIR & ESPACE, and the only static row in the group: the
  // other three move. `coverage: 'global'` is the honest facet even though the
  // pack is denser over France — the scope chip says where a layer HAS data,
  // and this one has data everywhere. What it does NOT have everywhere is the
  // grass-strip long tail, which is a completeness claim the row's source line
  // and the dataset README carry, not a two-word chip.
  Object.freeze({
    id: 'local-airports',
    category: 'air-space',
    label: 'Aéroports',
    kind: 'dataset',
    coverage: 'global',
    auth: 'none',
    cadence: 'static',
  }),
  // "(30d)" is dropped from the name: the rolling window is a property of the
  // feed, and the row's meta line already reports it.
  Object.freeze({
    id: 'rocket-launches',
    category: 'air-space',
    label: 'Missions spatiales',
    kind: 'dataset',
    coverage: 'global',
    auth: 'none',
    cadence: 'periodic',
  }),

  // ── DÉFENSE ───────────────────────────────────────────────────────────────
  Object.freeze({
    id: 'military',
    category: 'defence',
    label: 'Vols militaires',
    kind: 'dataset',
    coverage: 'global',
    auth: 'none',
    cadence: 'live',
  }),
  // The English name says "Mapped", not "Military", as a deliberate hedge: this
  // is volunteer OSM tagging (military=airfield|naval_base|range|barracks|base
  // plus landuse=military), incomplete by nature. "Sites cartographiés" carried
  // the hedge but told the visitor nothing about the subject, so the honesty
  // moves to where it is already stated — the row's source line and the card —
  // and the name says what the things are.
  Object.freeze({
    id: 'military-installations',
    category: 'defence',
    label: 'Sites militaires',
    kind: 'dataset',
    coverage: 'global',
    auth: 'none',
    cadence: 'periodic',
  }),
  Object.freeze({
    id: 'military-awareness',
    category: 'defence',
    label: 'Contexte global',
    kind: 'coordinator',
    coverage: 'global',
    auth: 'none',
    cadence: 'live',
  }),

  // ── MARITIME ──────────────────────────────────────────────────────────────
  // "Navires en direct" rather than "Navires AIS": the acronym means nothing to
  // a first-time visitor, it is already on the source line, and this phrasing
  // makes a matched pair with "Vols en direct" at the top of AIR & ESPACE.
  Object.freeze({
    id: 'ais-live-vessels',
    category: 'maritime',
    label: 'Navires en direct',
    kind: 'dataset',
    coverage: 'global',
    auth: 'free-key',
    cadence: 'live',
  }),
  Object.freeze({
    id: 'marine-buoys',
    category: 'maritime',
    label: 'Bouées marines',
    kind: 'dataset',
    coverage: 'us',
    auth: 'none',
    cadence: 'periodic',
  }),
  Object.freeze({
    id: 'local-ports',
    category: 'maritime',
    label: 'Ports',
    kind: 'dataset',
    coverage: 'global',
    auth: 'none',
    cadence: 'static',
  }),

  // ── MOBILITÉ TERRESTRE ────────────────────────────────────────────────────
  Object.freeze({
    id: 'traffic',
    category: 'ground-mobility',
    label: 'Trafic routier',
    kind: 'dataset',
    coverage: 'global',
    auth: 'none',
    cadence: 'live',
  }),
  // Directly under "Trafic routier" because it is the same subject measured a
  // different way — TomTom's modelled ratio above, the State's own loop
  // detectors here — and a viewer comparing them should not have to hunt.
  Object.freeze({
    id: 'road-status-fr',
    category: 'ground-mobility',
    label: 'État du réseau routier',
    kind: 'dataset',
    coverage: 'fr',
    auth: 'none',
    cadence: 'live',
  }),
  Object.freeze({
    id: 'transit-fr',
    category: 'ground-mobility',
    label: 'Transports en commun',
    kind: 'dataset',
    coverage: 'fr',
    auth: 'none',
    cadence: 'live',
  }),
  // OPEN QUESTION, deliberately parked: this pair's names do not yet express
  // what actually separates them. It is not docked-vs-free-floating — both carry
  // stations. It is 36 curated flagship bike systems here, against the long tail
  // of 135 French operators across every mode there. "Vélos en libre-service" /
  // "Véhicules partagés" would say that; "Stations vélos" describes what the
  // row draws. Left as-is until it is decided, and nothing reads `label` yet.
  Object.freeze({
    id: 'bikeshare',
    category: 'ground-mobility',
    label: 'Stations vélos',
    kind: 'dataset',
    coverage: 'cities',
    auth: 'none',
    cadence: 'periodic',
  }),
  // "Véhicules" and not "Mobilité": the layer draws six distinct silhouettes —
  // bike, e-bike, trottinette, moped, CAR, other — so any name built on bikes or
  // scooters alone would be false, and "mobilité" is an abstraction where the
  // globe shows objects.
  Object.freeze({
    id: 'shared-mobility-fr',
    category: 'ground-mobility',
    label: 'Véhicules partagés',
    kind: 'dataset',
    coverage: 'fr',
    auth: 'none',
    cadence: 'periodic',
  }),
  // `periodic` and not `live`: the event aggregate is republished hourly, so it
  // does not stream — it is a polled snapshot, and calling it live would
  // promise a cadence the source does not have. (Its sibling `road-status-fr`
  // IS `live`: the Traficolor status it draws moves every 60-360 s.)
  //
  // It keeps no `(FR)` in the label, like the rest of the table: the `coverage: 'fr'` facet renders as a scope chip on the row and
  // says it once instead of twice. It cannot say the sharper truth — that the
  // coverage is the RRN *non concédé*, without the conceded motorways — so the
  // row's source line and each card carry that, and `getStats().coverage`
  // states it in one string.
  Object.freeze({
    id: 'road-events-fr',
    category: 'ground-mobility',
    label: 'Événements routiers',
    kind: 'dataset',
    coverage: 'fr',
    auth: 'none',
    cadence: 'periodic',
  }),

  // ── ÉNERGIE ───────────────────────────────────────────────────────────────
  Object.freeze({
    id: 'france-energy',
    category: 'energy',
    label: 'Mix électrique',
    kind: 'dataset',
    coverage: 'fr',
    auth: 'none',
    cadence: 'periodic',
  }),
  // `free-key` is the honest reading of a layer that draws its whole subject
  // keyless and uses the key only to fill in live output: without RTE
  // credentials the fleet still renders at installed capacity.
  Object.freeze({
    id: 'rte-generation',
    category: 'energy',
    label: 'Groupes de production',
    kind: 'dataset',
    coverage: 'fr',
    auth: 'free-key',
    cadence: 'periodic',
  }),
  Object.freeze({
    id: 'edf-power-plants',
    category: 'energy',
    label: 'Centrales EDF',
    kind: 'dataset',
    coverage: 'fr',
    auth: 'none',
    cadence: 'periodic',
  }),
  // `static`, like `local-dams`: the register is a file committed in the repo
  // (ODRÉ publishes no coordinates, so every position is a build-time join) and
  // it changes only when someone re-runs `npm run hydro:registry`.
  Object.freeze({
    id: 'fr-hydro-plants',
    category: 'energy',
    label: 'Petite hydro',
    kind: 'dataset',
    coverage: 'fr',
    auth: 'none',
    cadence: 'static',
  }),
  Object.freeze({
    id: 'power-grid',
    category: 'energy',
    label: 'Réseau électrique',
    kind: 'dataset',
    coverage: 'global',
    auth: 'none',
    cadence: 'periodic',
  }),
  Object.freeze({
    id: 'gas-fr',
    category: 'energy',
    label: 'Réseau gaz',
    kind: 'dataset',
    coverage: 'fr',
    auth: 'none',
    cadence: 'periodic',
  }),
  // The hinge between ÉNERGIE and MOBILITÉ TERRESTRE, filed under energy because
  // what it publishes is installed capacity — kW per point de charge — and never
  // whether one is free. `periodic`, like its neighbours: the register is
  // consolidated daily upstream and this layer refetches per viewport.
  Object.freeze({
    id: 'irve-fr',
    category: 'energy',
    label: 'Bornes de recharge',
    kind: 'dataset',
    coverage: 'fr',
    auth: 'none',
    cadence: 'periodic',
  }),
  // `fr` and no longer `us` — which was never true of a pack whose 704 features
  // were spread over six continents and only 44 of them in France. The pack is
  // now a complete OSM extraction of the French dam structures (métropole and
  // outre-mer, 5 529 of them) plus the 660 world features the old Open
  // Infrastructure Map snapshot had, kept so the layer is not empty elsewhere.
  // The chip says where the layer can be TRUSTED to have the set, and that is
  // France; the world tail is a bonus nobody should read as coverage.
  Object.freeze({
    id: 'local-dams',
    category: 'energy',
    label: 'Barrages',
    kind: 'dataset',
    coverage: 'fr',
    auth: 'none',
    cadence: 'static',
  }),

  // ── RISQUES & ENVIRONNEMENT ───────────────────────────────────────────────
  Object.freeze({
    id: 'earthquakes',
    category: 'hazards',
    label: 'Séismes (24 h)',
    kind: 'dataset',
    coverage: 'global',
    auth: 'none',
    cadence: 'periodic',
  }),
  Object.freeze({
    id: 'local-firms',
    category: 'hazards',
    label: 'Feux actifs (FIRMS)',
    kind: 'dataset',
    coverage: 'global',
    auth: 'free-key',
    cadence: 'periodic',
  }),
  Object.freeze({
    id: 'vigicrues',
    category: 'hazards',
    label: 'Vigicrues',
    kind: 'dataset',
    coverage: 'fr',
    auth: 'none',
    cadence: 'periodic',
  }),
  Object.freeze({
    id: 'hubeau-hydro',
    category: 'hazards',
    label: "Stations Hub'Eau",
    kind: 'dataset',
    coverage: 'fr',
    auth: 'none',
    cadence: 'periodic',
  }),
  Object.freeze({
    id: 'meteofrance-vigilance',
    category: 'hazards',
    label: 'Vigilance météo',
    kind: 'dataset',
    coverage: 'fr',
    auth: 'none',
    cadence: 'periodic',
  }),

  // ── RÉSEAUX & CAPTEURS ────────────────────────────────────────────────────
  Object.freeze({
    id: 'telegeography-submarine-cables',
    category: 'comms-sensors',
    label: 'Câbles sous-marins',
    kind: 'dataset',
    coverage: 'global',
    auth: 'none',
    cadence: 'static',
  }),
  Object.freeze({
    id: 'local-datacenters',
    category: 'comms-sensors',
    label: 'Datacenters',
    kind: 'dataset',
    coverage: 'global',
    auth: 'none',
    cadence: 'static',
  }),
  // The LAYER is renamed; the dedicated CCTV panel keeps its acronym by explicit
  // decision, so `#cctv-panel` and its buttons stay as they are.
  Object.freeze({
    id: 'cctv',
    category: 'comms-sensors',
    label: 'Caméras publiques',
    kind: 'dataset',
    coverage: 'cities',
    auth: 'none',
    cadence: 'live',
  }),
  Object.freeze({
    id: 'radio',
    category: 'comms-sensors',
    label: 'Radio',
    kind: 'dataset',
    coverage: 'global',
    auth: 'none',
    cadence: 'live',
  }),

  // ── BÂTI & TERRITOIRE ─────────────────────────────────────────────────────
  // `periodic` rather than `static`: nothing about a building moves, but the
  // layer refetches per viewport because no bundle could hold 47 million of
  // them. The cadence facet describes how the app ACQUIRES the data, not how
  // fast the subject changes.
  Object.freeze({
    id: 'bdtopo-buildings',
    category: 'built-environment',
    label: 'Bâti 3D',
    kind: 'dataset',
    coverage: 'fr',
    auth: 'none',
    cadence: 'periodic',
  }),
  // Joins the eighth group rather than founding a ninth. The header above says
  // this is where "a cadastre, a land-use or a population layer would join",
  // and 68 158 schools are a population layer wearing an address: the register
  // is the State's account of where its pupils are put, which is base
  // reference data in exactly the sense `bdtopo-buildings` is. It is not
  // mobility, not energy, and not a hazard.
  Object.freeze({
    id: 'schools-fr',
    category: 'built-environment',
    label: 'Établissements scolaires',
    kind: 'dataset',
    coverage: 'fr',
    auth: 'none',
    cadence: 'periodic',
  }),
]);

/**
 * The table as everything else sees it, with the scope chip resolved once here
 * rather than by whoever renders a row.
 *
 * The chip is display copy, and display copy belongs next to the names it sits
 * beside — not inside DataLayerManager, which is handed its registries
 * precisely so it stays free of this fork's product decisions. Deriving it
 * instead of typing it into all 32 rows also means `coverage` and the badge can
 * never drift apart.
 */
export const LAYER_TAXONOMY = Object.freeze(LAYER_TAXONOMY_TABLE.map((entry) => Object.freeze({
  ...entry,
  scopeChip: coverageChip(entry.coverage),
})));

const TAXONOMY_BY_ID = new Map(LAYER_TAXONOMY.map((entry) => [entry.id, entry]));

/**
 * Validate the taxonomy, and prove it covers the registered layer set exactly.
 *
 * The cross-check is the point: a table that merely happens to be complete today
 * is a table that silently stops being complete on the next merge.
 * @param {ReadonlyArray<object>} [taxonomy] Table under test.
 * @param {ReadonlyArray<string>} [registeredIds] Ids the app actually registers.
 * @returns {true} When valid.
 * @throws {Error} On any malformed entry, duplicate, or coverage mismatch.
 */
export function validateLayerTaxonomy(
  taxonomy = LAYER_TAXONOMY,
  registeredIds = REGISTERED_LAYER_IDS,
) {
  if (!Array.isArray(taxonomy) || taxonomy.length === 0) {
    throw new Error('Layer taxonomy must be a non-empty array');
  }
  const categoryIds = new Set();
  for (const category of LAYER_CATEGORIES) {
    if (!category?.id || !/^[a-z0-9-]+$/.test(category.id)) {
      throw new Error(`Invalid layer category id: ${category?.id}`);
    }
    if (categoryIds.has(category.id)) throw new Error(`Duplicate layer category: ${category.id}`);
    if (!category.label || typeof category.label !== 'string') {
      throw new Error(`Layer category missing label: ${category.id}`);
    }
    categoryIds.add(category.id);
  }

  // A coverage value with no chip entry would render as an empty badge rather
  // than no badge, so the chip table is checked against its own vocabulary.
  for (const coverage of VALID_COVERAGE) {
    if (!Object.hasOwn(COVERAGE_CHIPS, coverage)) {
      throw new Error(`Coverage has no scope chip mapping: ${coverage}`);
    }
  }

  const seen = new Set();
  for (const entry of taxonomy) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) {
      throw new Error('Layer taxonomy entry missing id');
    }
    if (seen.has(entry.id)) throw new Error(`Duplicate layer taxonomy id: ${entry.id}`);
    seen.add(entry.id);
    if (!VALID_CATEGORY_IDS.has(entry.category)) {
      throw new Error(`Unknown category for layer: ${entry.id}`);
    }
    if (!entry.label || typeof entry.label !== 'string') {
      throw new Error(`Layer taxonomy entry missing label: ${entry.id}`);
    }
    if (!VALID_KINDS.has(entry.kind)) throw new Error(`Invalid layer kind: ${entry.id}`);
    if (!VALID_COVERAGE.has(entry.coverage)) throw new Error(`Invalid layer coverage: ${entry.id}`);
    if (!VALID_AUTH.has(entry.auth)) throw new Error(`Invalid layer auth: ${entry.id}`);
    if (!VALID_CADENCE.has(entry.cadence)) throw new Error(`Invalid layer cadence: ${entry.id}`);
  }

  const registered = new Set(registeredIds);
  const missing = [...registered].filter((id) => !seen.has(id));
  const extra = [...seen].filter((id) => !registered.has(id));
  if (missing.length || extra.length) {
    throw new Error(
      `Layer taxonomy mismatch (uncategorized: ${missing.join(', ') || 'none'}; `
      + `unknown: ${extra.join(', ') || 'none'})`,
    );
  }
  return true;
}

validateLayerTaxonomy();

/**
 * Look up one layer's taxonomy entry.
 * @param {string} layerId Registered layer id.
 * @returns {object|null} Frozen entry, or null when the id is not registered.
 */
export function layerTaxonomyFor(layerId) {
  return TAXONOMY_BY_ID.get(layerId) || null;
}

/**
 * Group layer ids by category, in category order then within-group order.
 * Coordinators are excluded: they are not datasets and must never occupy a row
 * or inflate a group's count.
 * @param {ReadonlyArray<object>} [taxonomy] Table to project.
 * @returns {Array<{id: string, label: string, icon: string, layerIds: string[]}>} Groups.
 */
export function groupLayerIdsByCategory(taxonomy = LAYER_TAXONOMY) {
  return LAYER_CATEGORIES.map((category) => Object.freeze({
    id: category.id,
    label: category.label,
    icon: category.icon,
    layerIds: taxonomy
      .filter((entry) => entry.category === category.id && entry.kind === 'dataset')
      .map((entry) => entry.id),
  }));
}
