/*
 * LAYER FUSIONS — the one place that says which rows are ONE SUBJECT.
 *
 * `layerTaxonomy.js` answers "what is this dataset, and which group does it
 * belong to". It cannot answer the question this file exists for: "are these
 * two rows the same subject seen twice?" That is a statement ABOUT A PAIR, and
 * a per-layer field can only ever hold half of it.
 *
 * The audit that produced this table counted fourteen subjects drawn by two to
 * four rows each — DVF sold three times, the road measured four ways, three
 * registers of power plants, education split across two ministries. Every one
 * of those splits is an artifact of the order the layers merged in, not a
 * distinction a reader asked for. A panel that lists them separately makes the
 * reader do the join.
 *
 * WHAT A FUSION IS, AND WHAT IT IS NOT
 *
 * A fusion is a PRESENTATION decision: one row in the Data Layers panel, whose
 * toggle carries several registered layers, with one chip per companion so the
 * reader can still take the subject apart. It deletes NOTHING — not a module,
 * not a source, not a share token. Every fused layer keeps:
 *
 *   - its own id, module, lifecycle and cache;
 *   - its own share token, so links already sent keep restoring exactly what
 *     they always restored (a companion is enabled by token, with or without
 *     its primary — the row simply reads as partly on);
 *   - its own map legend entry, which `_refreshMapLegend` gathers from
 *     `getAll()` and therefore never went through a row in the first place;
 *   - its own credit line.
 *
 * That is deliberate and it is the whole reason this is a table and not a
 * rewrite: merging two layer MODULES is a data migration with a rollback cost,
 * merging two ROWS is a line in this file. Where a deeper merge is genuinely
 * owed — the 56 power plants held by three registers, the médecins family
 * `amenities-fr` still draws — the note on the entry says so, and the fusion
 * is the first half of that work, not a substitute for it.
 *
 * WHY NOT `showInTogglePanel: false` ON THE COMPANION
 *
 * Because that flag says "you enter this through another surface" — it is what
 * `military-awareness` uses, and it leaves the layer with no control at all in
 * the panel. A companion is not hidden: it is a chip, one click away, showing
 * its own on/off state. The reader who wants Sitadel alone can still have it.
 *
 * EXHAUSTIVENESS IS ENFORCED, NOT DOCUMENTED
 *
 * `validateLayerFusions()` runs at import and cross-checks against
 * REGISTERED_LAYER_IDS: an unknown id, an id claimed twice, a primary that is
 * itself somebody's companion, or a fusion with no companion is a BOOT
 * FAILURE. Same contract, same reason, as the taxonomy next door and the
 * duplicate-token assertion in `layerState.js`.
 */

import { REGISTERED_LAYER_IDS } from './layerState.js';

/**
 * The merged subjects.
 *
 * `primary` is the layer that KEEPS the row: its label, its scope chip, its
 * count and its meta line are what the row shows when nothing is expanded.
 * Choosing it is a product decision, not a size contest — where a fusion mixes
 * a world layer with a French one, the world layer is primary, so the row's
 * scope chip never tells a reader outside France that a row with data for them
 * is French-only.
 *
 * `companions[].chip` is the chip label. It is short on purpose: the chip row
 * is a control strip, not a second list of names. `title` is the tooltip, and
 * it is where the honest hedge goes.
 *
 * `optIn: true` means the row's toggle does NOT switch that companion on. It
 * is for a companion whose cost is real and whose value is conditional — the
 * reader asks for it by pressing the chip. Every other companion follows the
 * row, which is the point of the row.
 */
export const LAYER_FUSIONS = Object.freeze([
  // ── 1. Autorisations d'urbanisme ─────────────────────────────────────────
  // The two rows read the SAME four Sitadel files through the same shared
  // module. What differed was placement — `ads-fr` geocodes through the BAN
  // and lands within ~400 m, `sitadel-fr` lands on the cadastral parcel — and
  // that is a precision fact about one subject, not two subjects.
  Object.freeze({
    primary: 'ads-fr',
    companions: Object.freeze([
      Object.freeze({
        id: 'sitadel-fr',
        chip: 'Sur parcelle',
        title: 'Sitadel posé sur la parcelle cadastrale, quand la référence est publiée',
      }),
    ]),
  }),

  // ── 2. Immobilier (DVF) ──────────────────────────────────────────────────
  // Three rows for one question: "combien vaut ce sol". They read the same
  // register — `avis-valeur` already reuses the DVF silhouette — and the
  // comparables dossier is a tool applied to that same selection.
  Object.freeze({
    primary: 'dvf-sales',
    companions: Object.freeze([
      Object.freeze({
        id: 'avis-valeur',
        chip: 'Avis de valeur',
        title: 'Estimation au point cliqué, calculée sur les mêmes mutations',
      }),
      Object.freeze({
        id: 'comparables-fr',
        chip: 'Comparables',
        // Opt-in: the dossier is the reader's OWN selection, and an empty
        // dossier switched on by a row toggle draws nothing while costing a
        // lifecycle. It is a tool, and a tool is picked up.
        optIn: true,
        title: 'Dossier de comparables — sélection manuelle, à ouvrir quand on en constitue un',
      }),
    ]),
  }),

  // ── 3. Enseignement ──────────────────────────────────────────────────────
  // The taxonomy already stated the problem in prose next to `sup-fr`: "one
  // subject split across two ministries, and the taxonomy should not repeat
  // the split". It repeated it anyway, as two rows. It stops here.
  Object.freeze({
    primary: 'schools-fr',
    companions: Object.freeze([
      Object.freeze({
        id: 'sup-fr',
        chip: 'Supérieur',
        title: 'Établissements du supérieur — 2 800 lycées à BTS sont dans les deux registres',
      }),
    ]),
  }),

  // ── 4. Navires et ports ──────────────────────────────────────────────────
  // A port is where the vessels stop. The two rows shared nothing in code and
  // everything in subject; the destination field of an AIS message is a port
  // name, unresolved to this day.
  Object.freeze({
    primary: 'ais-live-vessels',
    companions: Object.freeze([
      Object.freeze({
        id: 'local-ports',
        chip: 'Ports',
        title: 'World Port Index — les escales que les navires déclarent',
      }),
    ]),
  }),

  // ── 5. Zone de chalandise ────────────────────────────────────────────────
  // The fiche IS the card of the ring: `implantation-fr` joins four layers
  // inside the isochrone this row draws, and neither is readable without the
  // other.
  Object.freeze({
    primary: 'isochrone-fr',
    companions: Object.freeze([
      Object.freeze({
        id: 'implantation-fr',
        chip: 'Fiche',
        title: "Fiche implantation — ce que l'anneau contient, en une carte",
      }),
    ]),
  }),

  // ── 6. Aéroports ─────────────────────────────────────────────────────────
  // `bruit-fr` leaves RISQUES & ENVIRONNEMENT to become a chip here. The
  // taxonomy's objection is on the record — "the polygon is about the
  // aircraft, not about the ground under it" — and that is exactly the
  // argument for filing it with the aircraft. The ground-level reading is
  // owed elsewhere: the address radiography, where a PEB zone is a fact about
  // a door.
  Object.freeze({
    primary: 'local-airports',
    companions: Object.freeze([
      Object.freeze({
        id: 'bruit-fr',
        chip: 'Bruit (PEB)',
        title: "Plans d'exposition au bruit — la contrainte au sol des aéroports",
      }),
    ]),
  }),

  // ── 7. Cours d'eau ───────────────────────────────────────────────────────
  // The two module headers already cite each other in prose. Vigicrues paints
  // the reach, Hub'Eau measures the flow inside it.
  Object.freeze({
    primary: 'vigicrues',
    companions: Object.freeze([
      Object.freeze({
        id: 'hubeau-hydro',
        chip: 'Stations',
        title: "Hub'Eau — débit et hauteur mesurés sur le tronçon",
      }),
    ]),
  }),

  // ── 8. Météo ─────────────────────────────────────────────────────────────
  // An inventory of instruments has value through its readings. The vigilance
  // says what is coming, the stations say what is measured.
  Object.freeze({
    primary: 'meteofrance-vigilance',
    companions: Object.freeze([
      Object.freeze({
        id: 'meteo-stations-fr',
        chip: 'Stations',
        title: 'Réseau Météo-France — 2 144 instruments et leur relevé horaire',
      }),
    ]),
  }),

  // ── 9. Centrales électriques ─────────────────────────────────────────────
  // Three registers, 56 plants held by more than one of them, five gas sites
  // drawn twice with different megawatts. The row merge is the FIRST half of
  // this fix; the deduplication by EIC and by ODRÉ id is the second, and it is
  // not done here. Until it is, the chips at least let a reader see the same
  // plant twice on purpose rather than by accident.
  Object.freeze({
    primary: 'edf-power-plants',
    companions: Object.freeze([
      Object.freeze({
        id: 'rte-generation',
        chip: 'Groupes RTE',
        title: 'Groupes de production RTE — production temps réel avec une clé',
      }),
      Object.freeze({
        id: 'fr-hydro-plants',
        chip: 'Petite hydro',
        title: 'Registre ODRÉ des petites centrales hydroélectriques',
      }),
    ]),
  }),

  // ── 10. Transports en commun ─────────────────────────────────────────────
  // Vehicles where the operator publishes them, stops with their frequency
  // where it does not. Île-de-France is the second case, which is why the
  // capital had zero vehicles on the row that promised them.
  //
  // ONE IDFM chip and not two. `idfm-frequency` was a second chip on this row
  // until 2026-09-10, drawing the SAME stops — 95.6 % of its 36 502 join
  // `arrets.arrid` — so a reader who wanted "how good is the transport here"
  // had to know to press both, and the frequency half answered a click with a
  // card the network half could not see. The two modules are now one layer and
  // one card; see `idfmNetwork.js` for what the merge kept and what it dropped.
  Object.freeze({
    primary: 'transit-fr',
    companions: Object.freeze([
      Object.freeze({
        id: 'idfm-network',
        chip: 'Réseau IDFM',
        title: 'Arrêts, lignes et fréquence horaire d’Île-de-France — 37 956 arrêts',
      }),
    ]),
  }),

  // ── 11. Vélos et véhicules partagés ──────────────────────────────────────
  // `bikeshare` is primary although it is the smaller set: it is the one with
  // data outside France, and a row that carried the `FR` chip would tell a
  // reader in Montréal that a layer serving them is French-only.
  Object.freeze({
    primary: 'bikeshare',
    companions: Object.freeze([
      Object.freeze({
        id: 'shared-mobility-fr',
        chip: 'Longue traîne FR',
        title: '135 opérateurs français, tous modes — vélo, trottinette, scooter, voiture',
      }),
      Object.freeze({
        id: 'velo-pulse-fr',
        chip: 'Semaine type',
        title: 'Remplissage moyen par heure de la semaine — Paris et Lyon',
      }),
    ]),
  }),

  // ── 12. Trafic routier ───────────────────────────────────────────────────
  // The same road measured four ways: a modelled ratio, a declared status, an
  // event list and a loop count. Three of the four already share the RRN
  // centreline pack.
  Object.freeze({
    primary: 'traffic',
    companions: Object.freeze([
      Object.freeze({
        id: 'road-status-fr',
        chip: 'État du réseau',
        title: 'Traficolor — état déclaré par les DIR, hors autoroutes concédées',
      }),
      Object.freeze({
        id: 'road-events-fr',
        chip: 'Événements',
        title: 'Chantiers, accidents et fermetures publiés par Bison Futé',
      }),
      Object.freeze({
        id: 'comptages-fr',
        chip: 'Comptages',
        title: 'Comptages par boucles — un COMPTAGE, pas une congestion, et Paris seul',
      }),
    ]),
  }),

  // ── 13. Territoire ───────────────────────────────────────────────────────
  // Three choropleth engines over the same contours. The row merge is the
  // first half; the shared indicator selector the audit asks for is the
  // second. The delinquance layer's anti-defamation guard travels WITH its
  // chip — it lives in that module and nothing here weakens it.
  Object.freeze({
    primary: 'filosofi-fr',
    companions: Object.freeze([
      Object.freeze({
        id: 'delinquance-fr',
        chip: 'Délinquance',
        title: 'Taux enregistrés par les services — à lire avec la garde du module',
      }),
      Object.freeze({
        id: 'petite-enfance-fr',
        chip: 'Petite enfance',
        title: "Places pour 100 enfants de moins de trois ans",
      }),
    ]),
  }),

  // ── 14. Infrastructure numérique ─────────────────────────────────────────
  // `local-datacenters` is primary for the same reason `bikeshare` is: it has
  // data everywhere. The submarine cables stay — they are already here, they
  // are drawn, and a French focus is a reason to ADD French layers, never a
  // reason to unplug a world one.
  Object.freeze({
    primary: 'local-datacenters',
    companions: Object.freeze([
      Object.freeze({
        id: 'telegeography-submarine-cables',
        chip: 'Câbles',
        title: 'TeleGeography — atterrages et câbles sous-marins (licence non commerciale)',
      }),
      Object.freeze({
        id: 'anfr-fr',
        chip: 'Antennes',
        title: 'Supports ANFR — 2G à 5G, par opérateur',
      }),
    ]),
  }),

  // ── 15. Vols en direct ───────────────────────────────────────────────────
  // The military register already runs while its row is off — it feeds the
  // CONTACTS roster — and it mirrors `flights` options by explicit registry
  // disposition. It was a second row for the same sky.
  Object.freeze({
    primary: 'flights',
    companions: Object.freeze([
      Object.freeze({
        id: 'military',
        chip: 'Militaires',
        title: 'Aéronefs militaires identifiés — même source, même rendu',
      }),
    ]),
  }),
]);

/**
 * Validate the fusion table against the registered layer set.
 * @param {ReadonlyArray<object>} [fusions] Table under test.
 * @param {ReadonlyArray<string>} [registeredIds] Ids the app actually registers.
 * @returns {true} When valid.
 * @throws {Error} On any unknown id, duplicate claim, or empty fusion.
 */
export function validateLayerFusions(
  fusions = LAYER_FUSIONS,
  registeredIds = REGISTERED_LAYER_IDS,
) {
  if (!Array.isArray(fusions)) throw new Error('Layer fusions must be an array');
  const registered = new Set(registeredIds);
  const claimed = new Map();
  const primaries = new Set();
  for (const fusion of fusions) {
    const primary = fusion?.primary;
    if (typeof primary !== 'string' || !primary) {
      throw new Error('Layer fusion missing primary');
    }
    if (!registered.has(primary)) throw new Error(`Unknown fusion primary: ${primary}`);
    if (primaries.has(primary)) throw new Error(`Duplicate fusion primary: ${primary}`);
    primaries.add(primary);
    if (claimed.has(primary)) {
      throw new Error(`Fusion primary is already a companion: ${primary}`);
    }
    claimed.set(primary, primary);
    const companions = fusion.companions;
    if (!Array.isArray(companions) || companions.length === 0) {
      throw new Error(`Fusion has no companion: ${primary}`);
    }
    for (const companion of companions) {
      const id = companion?.id;
      if (typeof id !== 'string' || !id) throw new Error(`Fusion companion missing id: ${primary}`);
      if (!registered.has(id)) throw new Error(`Unknown fusion companion: ${id}`);
      if (claimed.has(id)) throw new Error(`Layer claimed by two fusions: ${id}`);
      if (!companion.chip || typeof companion.chip !== 'string') {
        throw new Error(`Fusion companion missing chip label: ${id}`);
      }
      claimed.set(id, primary);
    }
  }
  // A companion that is itself a primary would render a row AND a chip for the
  // same layer, which is the exact duplication this table exists to remove.
  for (const [id, owner] of claimed) {
    if (id !== owner && primaries.has(id)) {
      throw new Error(`Fusion companion is also a primary: ${id}`);
    }
  }
  return true;
}

validateLayerFusions();

const FUSION_BY_PRIMARY = new Map(LAYER_FUSIONS.map((fusion) => [fusion.primary, fusion]));
const PRIMARY_BY_COMPANION = new Map();
for (const fusion of LAYER_FUSIONS) {
  for (const companion of fusion.companions) {
    PRIMARY_BY_COMPANION.set(companion.id, fusion.primary);
  }
}

/**
 * The companions a row carries.
 * @param {string} layerId Registered layer id.
 * @returns {ReadonlyArray<object>|null} Companion descriptors, or null.
 */
export function fusionCompanionsFor(layerId) {
  return FUSION_BY_PRIMARY.get(layerId)?.companions || null;
}

/**
 * The row a layer disappeared into.
 * @param {string} layerId Registered layer id.
 * @returns {string|null} Primary layer id, or null when the layer keeps a row.
 */
export function fusedIntoFor(layerId) {
  return PRIMARY_BY_COMPANION.get(layerId) || null;
}

/**
 * Every layer a row's toggle switches on — the primary first, then the
 * companions that follow it. `optIn` companions are excluded: the row toggle
 * does not switch them on, their chip does.
 * @param {string} layerId Registered layer id.
 * @returns {string[]} Layer ids, primary first.
 */
export function fusionToggleGroupFor(layerId) {
  const companions = fusionCompanionsFor(layerId);
  if (!companions) return [layerId];
  return [layerId, ...companions.filter((entry) => entry.optIn !== true).map((entry) => entry.id)];
}
