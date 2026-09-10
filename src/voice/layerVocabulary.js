/**
 * What the voice brain is allowed to NAME when it means a data layer.
 *
 * The bug this module exists to close: `set_layer_visibility.layerId` shipped a
 * hand-written enum of 17 ids inherited from upstream, while the fork had grown
 * to 60 registered layers. A model that respects an enum — Mistral does — could
 * not emit `medecins-fr`, so when a French operator asked for the doctors layer
 * it answered, correctly for what it could see, that no such layer exists.
 * Forty-three layers were unreachable by voice for exactly that reason.
 *
 * THE REGISTRY IS THE LIST. `LAYER_TAXONOMY` already states, in one reviewable
 * table, what every layer IS: its id, its French label, its group. Deriving the
 * vocabulary from it means adding a layer makes it speakable, and the enum in
 * `vite.config.js` is checked against this module by a test rather than being a
 * second list somebody has to remember. (The enum stays a literal there on
 * purpose: the tool schema is byte-frozen and sliced out as source text by the
 * bench, so it cannot be computed at module scope.)
 *
 * THREE WAYS IN, because a model reaches for a layer three different ways:
 *   1. the exact id — `medecins-fr`
 *   2. a spoken alias, French or English — "médecins", "doctors", "généralistes"
 *   3. the panel LABEL as the operator reads it — "Médecins", "Bornes de recharge"
 * All three normalize through the same accent-and-case-blind key, because a
 * model transcribing French speech drops accents about as often as it keeps them.
 */

import { ANALYST_LAYERS } from '../data/analystEngine.js';
import { LAYER_CATEGORIES, LAYER_TAXONOMY } from '../data/layerTaxonomy.js';

/**
 * Fold a spoken or written layer name to a comparison key.
 *
 * Accents go (`médecins` → `medecins`), case goes, and every run of anything
 * that is not a letter or a digit becomes one space — so `bornes de recharge`,
 * `Bornes-de-Recharge` and `BORNES  DE  RECHARGE` are one key. Latin-1 only is
 * enough: every label in the registry is French or English.
 *
 * @param {unknown} value Raw text.
 * @returns {string} Normalized key, or '' when there was nothing to fold.
 */
export function normalizeVocabularyKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Every layer the voice surface may name.
 *
 * `military-awareness` is excluded and is the only exclusion: it is a
 * `coordinator`, not a dataset — it loads nothing of its own and is entered
 * through the Contacts tab, never through a toggle. Offering it as a
 * `set_layer_visibility` target would hand the model a switch for something
 * that is not a source of data.
 *
 * @type {ReadonlyArray<string>}
 */
export const VOICE_LAYER_IDS = Object.freeze(
  LAYER_TAXONOMY.filter((entry) => entry.kind === 'dataset').map((entry) => entry.id),
);

/**
 * Layers `analyst_query` may be asked about.
 *
 * The engine's own table IS the list — a layer it does not know is refused by
 * name, so an enum wider than this one only teaches the model to make calls
 * that come back as errors.
 * @type {ReadonlyArray<string>}
 */
export const ANALYST_QUERY_LAYER_IDS = Object.freeze(
  Object.keys(ANALYST_LAYERS).filter((id) => VOICE_LAYER_IDS.includes(id)),
);

/**
 * Layers that answer "what am I looking at" but publish no queryable records —
 * bundled reference sets whose entities live in the shared context store. They
 * join the analyst layers in `get_entity_context`'s filter and nowhere else.
 */
const CONTEXT_ONLY_LAYER_IDS = Object.freeze([
  'local-datacenters',
  'local-dams',
  'local-ports',
  'local-airports',
  'telegeography-submarine-cables',
  'military-installations',
]);

/** Layers `get_entity_context` may be filtered to. */
export const ENTITY_CONTEXT_LAYER_IDS = Object.freeze([
  ...ANALYST_QUERY_LAYER_IDS,
  ...CONTEXT_ONLY_LAYER_IDS.filter((id) => VOICE_LAYER_IDS.includes(id)),
]);

/** id → taxonomy entry, for label and group lookups. */
const TAXONOMY_BY_ID = new Map(LAYER_TAXONOMY.map((entry) => [entry.id, entry]));
/** category id → its French label, for `list_layers` grouping. */
const CATEGORY_LABELS = new Map(LAYER_CATEGORIES.map((entry) => [entry.id, entry.label]));

/**
 * Spoken names for the layers, French first.
 *
 * WHY THIS TABLE AND NOT ONLY THE LABELS: a label is what the panel prints
 * ("Accueil du jeune enfant"), and nobody says that out loud — they say
 * "crèches". The labels are matched too (see `resolveVoiceLayerId`), so this
 * table only has to carry what a person would SAY, not a second copy of the
 * registry.
 *
 * Keys are written naturally and folded through `normalizeVocabularyKey` at
 * module load, so an accent here is documentation rather than a matching rule.
 * English entries stay for the upstream vocabulary and for a bilingual
 * operator; `gevActions.js` keeps its own older English table, and this one is
 * consulted after it, so nothing that used to resolve stops resolving.
 */
const SPOKEN_ALIASES = Object.freeze({
  'military-installations': ['sites militaires', 'bases militaires', 'base militaire', 'installations militaires', 'military bases', 'military installations', 'casernes'],
  'road-status-fr': ['état du réseau routier', 'etat des routes', 'état des routes', 'réseau routier', 'reseau routier', 'road status', 'viabilité', 'viabilite', 'routes fermées', 'routes fermees'],
  'idfm-network': ['réseau idfm', 'reseau idfm', 'idfm', 'métro parisien', 'metro parisien', 'réseau parisien', 'reseau parisien', 'ratp', 'lignes de métro', 'lignes de metro'],
  'velo-pulse-fr': ['pouls vélo', 'pouls velo', 'semaine type vélo', 'semaine type velo', 'usage vélo', 'usage velo', 'bike pulse'],
  'road-events-fr': ['événements routiers', 'evenements routiers', 'incidents routiers', 'chantiers', 'travaux routiers', 'accidents', 'bouchons signalés', 'road events', 'roadworks'],
  'idfm-frequency': ['fréquence des transports', 'frequence des transports', 'fréquence idfm', 'frequence idfm', 'passages par heure', 'desserte'],
  'france-energy': ['mix électrique', 'mix electrique', 'mix énergétique', 'mix energetique', 'production électrique', 'production electrique', 'électricité française', 'electricite francaise', 'electricity mix'],
  'edf-power-plants': ['centrales edf', 'centrales nucléaires', 'centrales nucleaires', 'parc edf', 'réacteurs edf', 'reacteurs edf', 'edf plants'],
  'fr-hydro-plants': ['petite hydro', 'hydroélectricité', 'hydroelectricite', 'centrales hydro', 'hydroélectriques', 'hydroelectriques', 'small hydro'],
  vigicrues: ['crues', 'crue', 'vigicrues', 'inondations', 'inondation', 'vigilance crues', 'flood watch', 'floods'],
  'hubeau-hydro': ["stations hub'eau", 'hubeau', "hub eau", 'hydrométrie', 'hydrometrie', 'débit des rivières', 'debit des rivieres', 'hauteur des rivières', 'hauteur des rivieres'],
  georisques: ['risques', 'géorisques', 'georisques', 'risques naturels', 'risques technologiques', 'ppr', 'retrait gonflement', 'argiles', 'hazard register'],
  'meteofrance-vigilance': ['vigilance météo', 'vigilance meteo', 'vigilance', 'alerte météo', 'alerte meteo', 'alertes météo', 'alertes meteo', 'vigilance orange', 'vigilance rouge', 'weather warnings'],
  'bruit-fr': ['bruit', 'bruit des aéroports', 'bruit des aeroports', 'nuisances sonores', 'nuisance sonore', 'plan de gêne sonore', 'plan de gene sonore', 'pgs', 'noise'],
  'fraicheur-fr': ['îlots de fraîcheur', 'ilots de fraicheur', 'fraîcheur', 'fraicheur', 'îlots de chaleur', 'ilots de chaleur', 'chaleur urbaine', 'cool islands'],
  'delinquance-fr': ['délinquance', 'delinquance', 'criminalité', 'criminalite', 'sécurité', 'securite', 'faits constatés', 'faits constates', 'cambriolages', 'crime'],
  'anfr-fr': ['antennes', 'antenne', 'antennes mobiles', 'antennes relais', 'anfr', 'pylônes télécom', 'pylones telecom', '5g', '4g', 'couverture mobile', 'cell towers', 'mobile masts'],
  'dvf-sales': ['ventes immobilières', 'ventes immobilieres', 'ventes', 'dvf', 'transactions immobilières', 'transactions immobilieres', 'prix au mètre carré', 'prix au metre carre', 'mutations', 'property sales'],
  'avis-valeur': ['avis de valeur', 'estimation', 'estimation immobilière', 'estimation immobiliere', 'valeur vénale', 'valeur venale', 'valuation'],
  'dpe-fr': ['dpe', 'performance énergétique', 'performance energetique', 'diagnostic de performance énergétique', 'diagnostic de performance energetique', 'étiquette énergie', 'etiquette energie', 'passoires thermiques', 'energy label'],
  'urbanisme-gpu': ['urbanisme', 'plu', 'plui', 'zonage', 'servitudes', 'géoportail de l’urbanisme', 'geoportail de l urbanisme', 'gpu', 'règles d’urbanisme', 'regles d urbanisme', 'zoning'],
  'ads-fr': ["autorisations d'urbanisme", 'autorisations urbanisme', 'permis de construire', 'permis', 'déclarations préalables', 'declarations prealables', 'ads', 'building permits'],
  'isochrone-fr': ['isochrone', 'isochrones', 'zone de chalandise', 'chalandise', 'temps de trajet', 'catchment'],
  'implantation-fr': ['fiche implantation', 'implantation', 'site implantation'],
  'comparables-fr': ['comparables', 'biens comparables', 'sélection conseiller', 'selection conseiller', 'comparable sales'],
  'filosofi-fr': ['carroyage insee', 'filosofi', 'revenus', 'revenu médian', 'revenu median', 'population', 'densité de population', 'densite de population', 'niveau de vie', 'income grid'],
  'amenities-fr': ['équipements du quotidien', 'equipements du quotidien', 'commerces', 'commerce', 'pharmacies', 'pharmacie', 'boulangeries', 'supermarchés', 'supermarches', 'services de proximité', 'services de proximite', 'amenities', 'shops'],
  'sitadel-fr': ['sitadel', 'permis de construire sitadel', 'construction neuve', 'logements autorisés', 'logements autorises', 'mises en chantier'],

  // Reinforcements for layers the older English table already knows, so the
  // French phrasings Memel actually uses land on the same id.
  flights: ['avions', 'avion', 'vols', 'vols en direct', 'trafic aérien', 'trafic aerien'],
  military: ['vols militaires', 'avions militaires', 'aviation militaire'],
  satellites: ['satellites', 'satellite'],
  'rocket-launches': ['missions spatiales', 'lancements', 'lancement', 'fusées', 'fusees', 'décollages', 'decollages'],
  earthquakes: ['séismes', 'seismes', 'séisme', 'seisme', 'tremblements de terre', 'magnitude'],
  'local-firms': ['feux', 'feu', 'feux actifs', 'incendies', 'incendie', 'firms'],
  // Deliberately NOT 'feux' or 'incendie': those belong to the live row above,
  // and a bare "montre les feux" must keep meaning "what is burning now". Every
  // phrase here names the EVENT — a place, a month, or the word mégafeu.
  'gironde-megafire-2026': ['mégafeu', 'megafeu', 'mégafeu de gironde', 'megafeu de gironde',
    'incendie de gironde', 'incendie de la gironde', 'feu de gironde', 'gironde 2026',
    'incendie du bassin d’arcachon', 'incendie du bassin d arcachon', 'incendie d’arcachon',
    'incendie d arcachon', 'feu d’arcachon', 'feu d arcachon', 'saumos', 'le porge',
    'cap ferret', 'lège-cap-ferret', 'lege cap ferret', 'gironde wildfire'],
  traffic: ['trafic routier', 'circulation', 'embouteillages', 'congestion'],
  cctv: ['caméras', 'cameras', 'caméras publiques', 'cameras publiques', 'vidéosurveillance', 'videosurveillance', 'webcams'],
  radio: ['radio', 'radios', 'stations de radio'],
  bikeshare: ['vélos', 'velos', 'vélo', 'velo', 'stations vélos', 'stations velos', 'vélos en libre service', 'velos en libre service', 'vlille', 'vélib', 'velib', 'tbm', 'le vélo', 'le velo'],
  'shared-mobility-fr': ['véhicules partagés', 'vehicules partages', 'trottinettes', 'trottinette', 'mobilités partagées', 'mobilites partagees', 'free floating', 'autopartage'],
  'transit-fr': ['transports en commun', 'transports', 'bus', 'tram', 'trams', 'tramway', 'métro', 'metro', 'cars', 'réseau de bus', 'reseau de bus'],
  'ais-live-vessels': ['navires', 'navire', 'bateaux', 'bateau', 'navires en direct', 'trafic maritime'],
  'marine-buoys': ['bouées', 'bouees', 'bouées marines', 'bouees marines', 'état de la mer', 'etat de la mer', 'houle', 'vagues'],
  'local-ports': ['ports', 'port'],
  'local-dams': ['barrages', 'barrage'],
  'local-datacenters': ['datacenters', 'centres de données', 'centres de donnees'],
  'telegeography-submarine-cables': ['câbles sous marins', 'cables sous marins', 'câbles', 'cables'],
  'local-airports': ['aéroports', 'aeroports', 'aérodromes', 'aerodromes', 'pistes'],
  'power-grid': ['réseau électrique', 'reseau electrique', 'lignes haute tension', 'postes électriques', 'postes electriques', 'pylônes', 'pylones'],
  'irve-fr': ['bornes de recharge', 'bornes', 'borne de recharge', 'recharge', 'points de charge', 'irve', 'recharge électrique', 'recharge electrique'],
  'medecins-fr': ['médecins', 'medecins', 'médecin', 'medecin', 'docteurs', 'docteur', 'généralistes', 'generalistes', 'médecine de ville', 'medecine de ville', 'déserts médicaux', 'deserts medicaux'],
  'schools-fr': ['écoles', 'ecoles', 'établissements scolaires', 'etablissements scolaires', 'collèges', 'colleges', 'lycées', 'lycees'],
  'petite-enfance-fr': ['crèches', 'creches', 'petite enfance', 'garde d’enfants', 'garde d enfants'],
  'sup-fr': ['universités', 'universites', 'enseignement supérieur', 'enseignement superieur', 'facs'],
  'cadastre-fr': ['cadastre', 'parcelles', 'parcelle', 'parcelles cadastrales'],
  'bdtopo-buildings': ['bâti', 'bati', 'bâti 3d', 'bati 3d', 'bâtiments', 'batiments', 'bâtiments 3d', 'batiments 3d'],
  'gas-fr': ['réseau gaz', 'reseau gaz', 'gaz', 'gazoducs'],
  'rte-generation': ['groupes de production', 'production', 'réacteurs', 'reacteurs', 'centrales'],
  // The BARE word belongs to the row, not to the companion. Since the fusion
  // (`layerFusions.js`) `meteofrance-vigilance` is LABELLED « Météo » and
  // carries the stations as a chip, so an operator saying "météo" means the
  // subject and gets the row; "stations météo" still reaches the instruments.
  'meteo-stations-fr': ['stations météo', 'stations meteo', 'réseau météo', 'reseau meteo'],
  'comptages-fr': ['comptages routiers', 'comptages', 'comptage'],
});

/** normalized alias → layer id. Built once; first writer of a key wins. */
const ALIAS_INDEX = (() => {
  const index = new Map();
  const claim = (key, layerId) => {
    if (!key || index.has(key)) return;
    index.set(key, layerId);
  };
  // Ids first: an id typed verbatim must never be shadowed by someone else's alias.
  for (const id of VOICE_LAYER_IDS) claim(normalizeVocabularyKey(id), id);
  for (const [layerId, aliases] of Object.entries(SPOKEN_ALIASES)) {
    if (!VOICE_LAYER_IDS.includes(layerId)) continue;
    for (const alias of aliases) claim(normalizeVocabularyKey(alias), layerId);
  }
  // Labels last, so a deliberate alias outranks a label that happens to collide.
  for (const entry of LAYER_TAXONOMY) {
    if (entry.kind !== 'dataset') continue;
    claim(normalizeVocabularyKey(entry.label), entry.id);
    // "Vigilance météo (FR)" and "Séismes (24 h)" carry a parenthetical the
    // operator never says; index the bare name too.
    const bare = entry.label.replace(/\s*\([^)]*\)\s*/g, ' ');
    claim(normalizeVocabularyKey(bare), entry.id);
  }
  return index;
})();

/**
 * Resolve anything an operator or a model might say to a registered layer id.
 * @param {unknown} value Id, alias, or panel label.
 * @returns {string|null} A registered layer id, or null when nothing matches.
 */
export function resolveVoiceLayerId(value) {
  const key = normalizeVocabularyKey(value);
  if (!key) return null;
  return ALIAS_INDEX.get(key) || null;
}

/** Every normalized name that resolves to a layer — its own id, aliases and label. */
function vocabularyFor(layerId) {
  const names = [];
  for (const [key, id] of ALIAS_INDEX) if (id === layerId) names.push(key);
  return names;
}

/**
 * Words that carry no subject. Left in, French grammar alone would make
 * "la couche des licornes" look like a half-match for "Bruit des aéroports",
 * and the model would be handed three confident suggestions for a layer nobody
 * has. A suggestion list that fires on nonsense is worse than an empty one:
 * it invites the operator to pick something they did not ask for.
 */
const STOPWORDS = new Set(['de', 'des', 'du', 'd', 'la', 'le', 'les', 'l', 'en', 'et', 'a', 'au', 'aux', 'the', 'of', 'and', 'fr', 'couche', 'couches', 'layer', 'layers']);

/** Meaningful tokens of a normalized key. */
function contentTokens(key) {
  return key.split(' ').filter((token) => token && !STOPWORDS.has(token));
}

/** Below this, an overlap is coincidence rather than a near miss. */
const SUGGESTION_FLOOR = 0.34;

/**
 * The three layers closest to something that resolved to nothing.
 *
 * Deliberately crude — token overlap plus a substring bonus, no edit distance.
 * The consumer is an instruction that says "propose the three closest", and a
 * near-miss list only has to be plausible enough for the operator to pick from;
 * spending a Levenshtein matrix per candidate to reorder three suggestions
 * would buy nothing anyone can hear.
 *
 * @param {unknown} value What the operator asked for.
 * @param {number} [limit=3] How many to return.
 * @returns {Array<{id: string, label: string}>} Best guesses, best first.
 */
export function suggestVoiceLayers(value, limit = 3) {
  const key = normalizeVocabularyKey(value);
  if (!key) return [];
  const asked = new Set(contentTokens(key));
  if (!asked.size) return [];
  const scored = [];
  for (const id of VOICE_LAYER_IDS) {
    let best = 0;
    for (const name of vocabularyFor(id)) {
      const tokens = contentTokens(name);
      if (!tokens.length) continue;
      let shared = 0;
      for (const token of tokens) if (asked.has(token)) shared += 1;
      let score = shared / tokens.length;
      if (name.includes(key) || key.includes(name)) score += 0.5;
      if (score > best) best = score;
    }
    if (best >= SUGGESTION_FLOOR) scored.push({ id, score: best });
  }
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, Math.max(0, limit)).map(({ id }) => ({
    id,
    label: TAXONOMY_BY_ID.get(id)?.label || id,
  }));
}

/**
 * The registry as the voice model should read it: id, French label, group, and
 * — when a manager is supplied — whether it is on and how much it holds.
 *
 * @param {object} [options]
 * @param {object|null} [options.dataManager] Live layer manager, for state.
 * @param {string|null} [options.query] Optional filter; matches ids, aliases and labels.
 * @returns {Array<{id: string, label: string, group: string, coverage: string, enabled: boolean|null, count: number|null}>}
 */
export function describeVoiceLayers({ dataManager = null, query = null } = {}) {
  const wanted = normalizeVocabularyKey(query);
  const matches = wanted
    ? new Set([
      ...(resolveVoiceLayerId(query) ? [resolveVoiceLayerId(query)] : []),
      ...suggestVoiceLayers(query, 8).map((entry) => entry.id),
    ])
    : null;
  const live = new Map();
  try {
    for (const layer of dataManager?.getAll?.() || []) live.set(layer.id, layer);
  } catch {
    // A manager that cannot answer is not a reason to withhold the registry.
  }
  const rows = [];
  for (const entry of LAYER_TAXONOMY) {
    if (entry.kind !== 'dataset') continue;
    if (matches && !matches.has(entry.id)) continue;
    const state = live.get(entry.id) || null;
    rows.push({
      id: entry.id,
      label: entry.label,
      group: CATEGORY_LABELS.get(entry.category) || entry.category,
      coverage: entry.coverage,
      enabled: state ? Boolean(state.enabled) : null,
      count: state ? (state.stats?.count ?? null) : null,
    });
  }
  return rows;
}
