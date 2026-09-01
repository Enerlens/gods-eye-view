import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { cachedGroundFloor, resolveGroundFloorCellsBounded } from './groundFloor.js';
import {
  clearOverlaySource,
  hitTestWorldOverlay,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { pickOverlayLabelId } from './overlayLabelPick.js';
import {
  HYDRO_TECHNOLOGIES,
  HYDRO_TECHNOLOGY_ORDER,
  HYDRO_UNKNOWN_COLOR,
  HYDRO_UNKNOWN_TECH_LABEL,
  loadFactor,
  techBucket,
  undecorateName,
} from './frHydroFeed.js';

/**
 * Petite hydro (FR) — every hydro plant in France's national register, not just
 * the big ones.
 *
 * This layer exists because of a hole a user found by looking for one place.
 * There are nine hydroelectric plants in the commune of Laruns, in the
 * Pyrénées-Atlantiques — Miégebat, Le Hourat, Pont-de-Camps, Artouste, Bious,
 * Geteu, Fabrèges, Espalungue, Artouste-Lac — 223,9 MW between them, and NONE
 * of them appeared anywhere on this globe. Not a bug: the *Centrales EDF* layer
 * draws EDF SA's own fleet and those nine are SHEM's, and the *Groupes de prod*
 * layer has a 100 MW floor because that is RTE's publication floor, and every
 * plant at Laruns is below it. Two correct layers, and a whole valley of
 * generating capacity between them.
 *
 * Measured against ODRÉ's national register: France has **2 757 hydro
 * installations for 26,04 GW**, and the two existing layers between them could
 * draw 56 of them. This layer draws the rest.
 *
 * ── What is drawn, and what a marker means ──────────────────────────────────
 *
 * There are exactly TWO kinds of marker here, and the difference between them
 * is the difference between a known position and an unknown one:
 *
 * **A filled disc is a plant, where it is.** Area proportional to installed
 * power, coloured by the register's own technology vocabulary. **589 of the 998
 * positions are a building footprint surveyed by IGN** — the data the Plan IGN
 * is drawn from, median span 32 m, with IGN's own planimetric accuracy printed
 * on the card. The rest come from EDF's published point, an OpenStreetMap
 * object this build could prove is that plant, or the RTE yard whose published
 * code the register names. The card says which, and says which OBJECT.
 *
 * **A hollow ring is a COMMUNE, not a plant.** It stands for every plant in
 * that commune no source places, and it is drawn at the commune centre because
 * that is the only thing the register publishes about them. It says how many
 * and how much, never where.
 *
 * The ring exists because the alternative was worse in two ways at once.
 * Measured across the 998 plants this build does place: **the commune centre
 * sits a median 2,5 km from the actual powerhouse, and p90 7,5 km.** In an
 * Alpine or Pyrenean valley that is routinely the wrong side of a ridge, on a
 * different river. And 1 744 plants share 1 147 communes, so drawing them
 * individually would stack up to a dozen markers on one pixel, each of them
 * asserting a position none of them has.
 *
 * ── Honesty rules this layer is built around ────────────────────────────────
 *
 * • **Half of this register has no name, and the card says so instead of
 *   inventing one.** 1 359 of the drawn installations publish `Confidentiel`
 *   where a name belongs — small private plants whose operator is a person.
 *   They are NOT dropped and they are NOT labelled "Confidentiel": the card
 *   leads with what the register does publish about them, which is nearly
 *   everything else. Commune, installed power, technology, commissioning date,
 *   connection voltage, source substation, grid operator, EIC code — and the
 *   energy actually injected over the last twelve months, on 90 % of them.
 *   An anonymous plant is a full card missing one line.
 *
 * • **Installed power is not output, except in the one line where it is.**
 *   Every disc is sized by NAMEPLATE. The card's `energyKwh` line is the only
 *   measurement in the layer, and it is a trailing twelve-month total, not a
 *   live reading — the *Groupes de prod* layer owns live output, and it cannot
 *   see any of these plants.
 *
 * • **26,04 GW is the register's figure, not this layer's placement claim.**
 *   `getStats()` reports installed, placed and clustered capacity separately,
 *   because "France has 26 GW of hydro" and "this globe shows you where 24,3 GW
 *   of it is" are different sentences.

 * • **Four rows are filed under the wrong commune, and the card shows both
 *   claims.** The register puts the 30 MW Lac d'Oô — Luchon, Haute-Garonne — in
 *   Guyane, Luz in Martinique, Motz in Guadeloupe and Pont-du-Loup at La
 *   Réunion. Each is caught by its own `postesource`, whose OpenStreetMap
 *   `ref:FR:RTE` sits thousands of kilometres from the commune named. The plant
 *   is drawn at its substation and the card prints the register's claim beside
 *   the contradiction, rather than quietly correcting the publisher.
 *
 * • **26 hydro plants are published as photovoltaic and the layer refuses to
 *   colour them.** 25 in Corsica — Rizzanese, Castirla, Tolla, Calacuccia — are
 *   the island's real hydro fleet carrying `technologie = Photovoltaïque` in
 *   ODRÉ's own file. They keep their disc and their published string on the
 *   card, and count as technology-unpublished in the legend. See trap 4 in
 *   `frHydroFeed.js`.
 *
 * • **This layer overlaps the other two, and nothing is de-duplicated.** The 56
 *   plants above 100 MW are in all three registers. Drawing them once here is
 *   correct — this is the national register — and a reader who turns on
 *   *Centrales EDF* too will see EDF's own coordinate for the same station,
 *   sometimes a few hundred metres away. Quietly dropping one publisher's
 *   figure would hide that they disagree.
 *
 * The register is a shipped file — `local_data/fr_hydro_plants/plants.json`,
 * rebuilt with `npm run hydro:registry` — because the register publishes no
 * coordinates at all, and every position here is a join of four sources done at
 * authoring time so it is auditable in the diff. See that script's header.
 */

const REGISTRY_URL = new URL('./local_data/fr_hydro_plants/plants.json', import.meta.url).href;

/** Layer id — also the share-link registry key. */
export const FR_HYDRO_LAYER_ID = 'fr-hydro-plants';
/** Prefix for every render id this layer puts in the scene. */
export const FR_HYDRO_RENDER_PREFIX = 'fr-hydro:';
/** Ambient labels. */
export const FR_HYDRO_OVERLAY_SOURCE_ID = 'fr-hydro-plants';
/** Selected-object card, on its own protected source. */
export const FR_HYDRO_SELECTED_OVERLAY_SOURCE_ID = 'fr-hydro-plants-selected';
/**
 * Ambient-label entry-id prefix — the click surface the plant's NAME provides.
 * It is deliberately NOT `FR_HYDRO_RENDER_PREFIX`: the label names the upstream
 * plant id, the record map is keyed by the render id, and the click path
 * converts between them rather than assuming they are the same string.
 */
export const FR_HYDRO_LABEL_PREFIX = 'fr-hydro-label:';
/** 2 742 installations; the label cohort is the handful worth naming at a glance. */
export const FR_HYDRO_OVERLAY_COHORT_LIMIT = 22;
/** Shared ambient-label paint budget, matching the sibling French sources. */
export const FR_HYDRO_OVERLAY_COLLISION_CAPACITY = 16;

/**
 * Metres above the local ground the markers are drawn at.
 *
 * **A marker MUST be clamped to the terrain, not left on the ellipsoid.** A
 * point drawn at ellipsoidal height 0 in the Ossau valley sits 556 m BELOW the
 * ground it is meant to be standing on, and a buried point does not merely look
 * low — it looks like it is in the wrong PLACE. The screen position of a point
 * below the surface is offset from the surface point above it by
 * `depth × tan(angle between the view ray and the local vertical)`, which is
 * zero at the centre of a nadir view and grows towards the edges: at the rim of
 * a 60° field of view, 556 m of depth becomes about 320 m of apparent
 * displacement. Pan the camera and that angle changes, so the marker SLIDES
 * across the map while the map stays still.
 *
 * Reported from the map at Espalungue, where the plant's own coordinate is
 * 6 m from IGN's building footprint and the dot still would not sit on it. The
 * data was right; the rendering was putting it half a kilometre underground.
 *
 * Two metres of lift, so the disc sits ON the surface rather than z-fighting
 * it — the same treatment `rteGeneration.js` gives its station rings.
 */
export const GROUND_LIFT_M = 2;

/**
 * Above this camera height the clamp is not worth a network round trip.
 *
 * At 200 km the ground is roughly 200 m per pixel, so half a kilometre of
 * parallax is two pixels and half of that is the marker's own radius. Below it,
 * the offset is what the reader is looking at. The SYNCHRONOUS half of the
 * clamp — reading a floor already in cache — always applies; only the fetch is
 * gated, so nothing flickers at the threshold.
 */
export const FLOOR_WARM_MAX_CAMERA_M = 200_000;

/** Never ask the terrain resolver for more than this many markers at once. */
export const FLOOR_WARM_MAX_POINTS = 250;

const SELECTED_COLOR = '#7ee8fa';
const COLOR_OUTLINE = Cesium.Color.fromCssColorString('#04121f');
const CLUSTER_COLOR = '#9fb4c7';
const CLUSTER_FILL_ALPHA = 0.14;

export const FR_HYDRO_SELECTED_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/**
 * The power floors the row's chips offer.
 *
 * A RUNTIME filter, not a build one: the shipped file always holds the whole
 * register, so raising the floor hides markers rather than losing data, and the
 * stats line keeps reporting what was hidden. `0` is the default because the
 * point of this layer is the plants the other two cannot see, and those are the
 * small ones.
 */
export const FR_HYDRO_FLOORS = Object.freeze([
  Object.freeze({ id: 'all', label: 'TOUT', kw: 0 }),
  Object.freeze({ id: 'mw1', label: '≥ 1 MW', kw: 1000 }),
  Object.freeze({ id: 'mw10', label: '≥ 10 MW', kw: 10_000 }),
]);

/**
 * Disc size in pixels.
 *
 * Radius grows with the fourth root of installed power, not the square root the
 * EDF layer uses. That layer spans 74 MW to 5 460 MW — a factor of 74. This one
 * spans 40 kW to 1 800 MW, a factor of 45 000, and a square-root scale over
 * that range either drowns the mills at two pixels or paints Grand-Maison over
 * a département. The fourth root keeps a 40 kW mill legible and Grand-Maison
 * large without either claiming the other's magnitude — and because the area no
 * longer tracks the megawatts, the card always prints the number.
 */
export const HYDRO_PIXEL_MIN = 4.5;
export const HYDRO_PIXEL_MAX = 22;
const PIXEL_PER_ROOT4_KW = 0.62;

/**
 * Pixel diameter for one plant.
 * @param {number|null|undefined} kw Installed capacity.
 * @returns {number}
 */
export function hydroPixelSize(kw) {
  if (!Number.isFinite(kw) || kw <= 0) return HYDRO_PIXEL_MIN;
  return Math.min(HYDRO_PIXEL_MAX, HYDRO_PIXEL_MIN + (kw ** 0.25) * PIXEL_PER_ROOT4_KW);
}

/**
 * Marker colour for one plant.
 *
 * Driven by `techKey`, never by the raw published string: a row that says
 * `Photovoltaïque` about a hydro plant gets the neutral grey, not a yellow disc
 * asserting a solar farm on a Corsican river.
 * @param {{techKey?:string|null}|null|undefined} plant
 * @returns {Cesium.Color}
 */
export function hydroColor(plant) {
  const entry = plant?.techKey
    ? Object.values(HYDRO_TECHNOLOGIES).find((tech) => tech.key === plant.techKey)
    : null;
  return Cesium.Color.fromCssColorString(entry ? entry.color : HYDRO_UNKNOWN_COLOR);
}

/**
 * Format kilowatts the way a French readout would, promoting to MW and GW when
 * the number earns it.
 *
 * The register publishes kW for a 40 kW mill and for a 1 800 MW pumped-storage
 * plant in the same column, so one unit cannot serve both.
 * @param {number|null|undefined} kw
 * @returns {string}
 */
export function formatHydroPower(kw) {
  if (!Number.isFinite(kw)) return '— kW';
  const fr = (value, digits) => value.toLocaleString('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).replace(/[\u00a0\u202f]/g, ' ');
  if (kw >= 1_000_000) return `${fr(kw / 1_000_000, 2)} GW`;
  if (kw >= 1000) return `${fr(kw / 1000, kw >= 100_000 ? 0 : 1)} MW`;
  return `${fr(kw, 0)} kW`;
}

/**
 * Format a twelve-month energy total, promoting kWh → MWh → GWh.
 * @param {number|null|undefined} kwh
 * @returns {string|null}
 */
export function formatHydroEnergy(kwh) {
  if (!Number.isFinite(kwh)) return null;
  const fr = (value, digits) => value.toLocaleString('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).replace(/[\u00a0\u202f]/g, ' ');
  if (kwh >= 1_000_000) return `${fr(kwh / 1_000_000, 1)} GWh`;
  if (kwh >= 1000) return `${fr(kwh / 1000, 0)} MWh`;
  return `${fr(kwh, 0)} kWh`;
}

/**
 * What to call a plant on screen.
 *
 * Two rules, both of them about not printing the register's internals at a
 * reader. The published name of Miégebat is
 * `MIEGEH-CENTRALE HYDRAULIQUE DE MIEGEBAT-3`: a repeat of the source
 * substation code, the name, and an internal revision number. Only the middle
 * part is what the plant is called, so `undecorateName` strips the other two.
 *
 * And when the register withholds the name entirely, this returns NEVER the
 * string "Confidentiel" — an anonymous plant is described by the two facts that
 * do identify it to someone looking at a map, where it is and how big it is,
 * and the card explains why there is no name.
 * @param {object} plant
 * @returns {string}
 */
export function hydroDisplayName(plant) {
  const name = undecorateName(plant?.name);
  if (name) return name;
  const commune = plant?.commune ? ` à ${plant.commune}` : '';
  return `Centrale hydraulique${commune}`;
}

/** Ambient label text for one plant. */
export function hydroLabelText(plant) {
  return `${hydroDisplayName(plant)} · ${formatHydroPower(plant?.kw)}`;
}

/**
 * What identified this plant, in the reader's words.
 *
 * `edf-published` and `sole` are very different amounts of evidence for the
 * same dot, and a reader deciding whether to trust a marker within 200 m has to
 * be able to tell them apart.
 */
export const MATCH_NOTES = Object.freeze({
  name: 'appariée sur le nom',
  'name-partial': 'appariée sur une partie du nom seulement — appariement faible',
  power: 'appariée sur la puissance, seule candidate de la commune',
  sole: 'seule centrale cartographiée de la commune, seule ligne au registre',
  postesource: 'code de poste source publié des deux côtés',
  toponyme: 'appariée sur le toponyme du plan IGN',
  'insee-sole': 'seule centrale au plan IGN dans la commune, seule ligne au registre',
});

/**
 * WHICH OBJECT the coordinate actually is.
 *
 * This distinction exists because getting it wrong is the worst bug this layer
 * has had. OpenStreetMap maps a large hydro scheme as one `type=site` relation
 * covering the intake, the tunnel, the penstock, the powerhouse and the
 * tailrace, and the centre of that relation is a point on NO object — for the
 * Centrale du Hourat it fell 2,7 km up the mountain, mid-forest, while the
 * powerhouse stands in the middle of Laruns beside the Arriussé. 127 plants
 * were drawn that way before the build learned to snap to the generating hall
 * instead, and the card now names which object it is pointing at.
 */
export const GEOMETRY_NOTES = Object.freeze({
  'ign-footprint': 'emprise du bâtiment levée par l’IGN',
  'published-point': "point publié par l'exploitant",
  outline: 'emprise cartographiée de la centrale',
  generators: 'groupes cartographiés à l’intérieur de l’emprise — la salle des machines',
  switchyard: 'le POSTE de raccordement, pas la salle des machines',
});

/** Where the coordinate came from, in the reader's words. */
export const SOURCE_NOTES = Object.freeze({
  'ign-bdtopo': 'IGN BD TOPO®',
  'edf-published': 'EDF Open Data',
  'osm-plant': 'OpenStreetMap',
  'rte-switchyard': 'OpenStreetMap',
});

/**
 * The card for one placed plant.
 *
 * Ordered by what a reader wants first and by what is most likely to be
 * present: power, then the measurement, then identity, then the caveats. The
 * anonymity note comes early, because a reader who sees no name needs to know
 * within one line that the name is withheld rather than missing.
 * @param {object} plant
 * @returns {string} Newline-separated; the first line is the title.
 */
export function buildHydroCard(plant) {
  const lines = [hydroDisplayName(plant)];
  lines.push(`⚡ ${formatHydroPower(plant?.kw)} installés`);

  const energy = formatHydroEnergy(plant?.energyKwh);
  if (energy) {
    const factor = loadFactor(plant?.kw, plant?.energyKwh);
    const hours = factor === null ? '' : ` · ${Math.round(factor * 8760)} h équivalent pleine puissance`;
    lines.push(`↻ ${energy} injectés sur 12 mois glissants${factor === null ? '' : ` (${Math.round(factor * 100)} %)`}${hours}`);
  } else {
    lines.push('↻ énergie injectée non publiée — ce n’est pas une centrale à l’arrêt');
  }

  if (plant?.anonymous) {
    lines.push('⊘ nom non publié — ODRÉ anonymise les petites installations privées');
  }

  const tech = plant?.techKey ? techBucket(plant) : null;
  if (tech) {
    const entry = Object.values(HYDRO_TECHNOLOGIES).find((t) => t.key === plant.techKey);
    lines.push(`◈ ${tech}${entry ? ` — ${entry.blurb}` : ''}`);
  } else if (plant?.tech) {
    // The publisher's word, shown and flagged rather than corrected.
    lines.push(`◈ technologie publiée : « ${plant.tech} » — hors vocabulaire hydraulique du registre`);
  }

  if (plant?.headM) lines.push(`↧ ${plant.headM} m de chute`);
  if (plant?.groups) lines.push(`▸ ${plant.groups} groupe${plant.groups > 1 ? 's' : ''}`);
  if (plant?.installations > 1) {
    lines.push(`▸ ligne agrégée : ${plant.installations} installations`);
  }

  if (plant?.commune) {
    const commune = `📍 ${plant.commune}${plant.departement ? ` · ${plant.departement}` : ''}`;
    // The register's own two fields disagree by a continent — see
    // COMMUNE_CONTRADICTION_KM in the build script. Both claims are shown,
    // because the reader is owed the contradiction, not a quiet edit.
    lines.push(Number.isFinite(plant?.communeContradictedKm)
      ? `${commune}  ⚠ selon le registre — et son propre poste source est à ${plant.communeContradictedKm.toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g, ' ')} km de là`
      : commune);
  }
  const grid = [plant?.voltage, plant?.poste ? `poste ${plant.poste}` : null, plant?.operator]
    .filter(Boolean).join(' · ');
  if (grid) lines.push(`⌁ ${grid}`);
  if (plant?.commissioned) lines.push(`🕐 en service depuis le ${plant.commissioned.split('-').reverse().join('/')}`);
  if (plant?.regime && plant.regime !== 'En service') lines.push(`⚠ régime : ${plant.regime}`);

  lines.push(...buildPlacementLines(plant));
  if (plant?.eic) lines.push(`# EIC ${plant.eic}`);
  return lines.join('\n');
}

/**
 * The two or three card lines that say where this dot came from and how much to
 * trust it.
 *
 * Split out of `buildHydroCard` because it is the part a reader argues with. It
 * names the source, the object, the evidence and the distance — enough to
 * check the claim against an aerial photo without leaving the globe.
 * @param {object} plant
 * @returns {Array<string>}
 */
export function buildPlacementLines(plant) {
  const lines = [];
  const source = SOURCE_NOTES[plant?.placement];
  if (!source) return lines;
  const geometry = GEOMETRY_NOTES[plant?.geometry];
  const km = Number.isFinite(plant?.anchorKm) && plant.anchorKm > 0
    ? ` · ${plant.anchorKm.toFixed(1)} km du centre de commune`
    : '';
  lines.push(`◎ ${source}${geometry ? ` — ${geometry}` : ''}${km}`);

  if (plant?.placement === 'ign-bdtopo') {
    // IGN publishes its own planimetric accuracy per object, so the card can
    // state the position's error bar instead of implying one.
    const precision = Number.isFinite(plant?.ignPrecisionM) ? ` ± ${plant.ignPrecisionM} m` : '';
    // …and whether IGN actually called it hydroelectric, or merely did not call
    // it something else. 87 of the plants IGN alone places sit on a
    // `Centrale électrique` of unstated kind, and that is an inference.
    lines.push(plant?.ignKind
      ? `   « ${plant.ignKind} » au plan IGN${precision}`
      : `   ⚠ « Centrale électrique » au plan IGN, nature non précisée${precision}`);
    if (Number.isFinite(plant?.ignShiftM)) {
      const from = MATCH_NOTES[plant?.matchedBy]
        ? `identifiée par ${SOURCE_NOTES[plant?.corroborates] || 'une autre source'}`
        : '';
      lines.push(`   ${from}, position affinée de ${plant.ignShiftM} m`);
    }
  }

  const match = MATCH_NOTES[plant?.matchedBy];
  if (match && plant?.placement !== 'ign-bdtopo') lines.push(`   ${match}`);
  if (match && plant?.placement === 'ign-bdtopo' && !Number.isFinite(plant?.ignShiftM)) {
    lines.push(`   ${match}`);
  }
  // The audit trail for the bug this replaced: how far the honest point sits
  // from the bbox centre an earlier build would have used.
  if (Number.isFinite(plant?.snapKm) && plant.snapKm > 0) {
    const span = Number.isFinite(plant?.outlineSpanM)
      ? ` d’une emprise de ${(plant.outlineSpanM / 1000).toFixed(1)} km`
      : '';
    lines.push(`   recalée de ${plant.snapKm.toFixed(1)} km depuis le centre${span}`);
  }
  if (plant?.placement === 'rte-switchyard') {
    lines.push(Number.isFinite(plant?.communeContradictedKm)
      ? '   ⚠ la commune publiée par le registre est incompatible avec son propre poste'
        + ' source — c’est le poste qui a été suivi'
      : '   ⚠ la centrale elle-même n’est cartographiée nulle part');
  }
  return lines;
}

/**
 * The card for one commune roll-up.
 *
 * Says what it is in the first line, so a reader who clicked expecting a plant
 * learns immediately that this is not one.
 * @param {object} cluster
 * @returns {string}
 */
export function buildHydroClusterCard(cluster) {
  const count = cluster?.plants ?? 0;
  const lines = [`${cluster?.commune ?? 'Commune'} — ${count} centrale${count > 1 ? 's' : ''} non localisée${count > 1 ? 's' : ''}`];
  lines.push(`⚡ ${formatHydroPower(cluster?.kw)} installés au total`);
  const energy = formatHydroEnergy(cluster?.energyKwh);
  if (energy) lines.push(`↻ ${energy} injectés sur 12 mois glissants (cumul)`);
  lines.push('◎ marqueur posé au CENTRE DE LA COMMUNE — le registre ne publie aucune position');
  lines.push('   et aucune source ne place ces installations. Distance typique au bâtiment réel : 3 km.');
  if (cluster?.anonymous) {
    lines.push(`⊘ ${cluster.anonymous} sans nom publié`);
  }
  const techs = Object.entries(cluster?.techs || {}).sort((a, b) => b[1] - a[1]);
  if (techs.length) lines.push(`◈ ${techs.map(([name, n]) => `${n} × ${name}`).join(', ')}`);
  for (const name of (cluster?.names || []).slice(0, 6)) {
    if (name) lines.push(`▸ ${name}`);
  }
  const shown = Math.min(6, (cluster?.names || []).filter(Boolean).length);
  const named = (cluster?.names || []).filter(Boolean).length;
  if (named > shown) lines.push(`… et ${named - shown} autre${named - shown > 1 ? 's' : ''}`);
  if (cluster?.departement) lines.push(`📍 ${cluster.departement}`);
  return lines.join('\n');
}

/** Keep the largest plants, with stable identity as the tie-break. */
export function selectHydroOverlayCohort(entries, limit = FR_HYDRO_OVERLAY_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(FR_HYDRO_OVERLAY_COHORT_LIMIT, Math.floor(Number(limit) || 0)));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/**
 * Legend rows: one per technology actually drawn, plus the ring.
 * @param {Array<object>} plants Visible plants.
 * @param {Array<object>} clusters Visible clusters.
 * @returns {Array<object>}
 */
export function hydroLegend(plants, clusters) {
  const tally = new Map();
  for (const plant of plants) {
    const bucket = techBucket(plant);
    const entry = tally.get(bucket) || { count: 0, kw: 0 };
    entry.count += 1;
    entry.kw += plant.kw ?? 0;
    tally.set(bucket, entry);
  }
  const legend = [];
  for (const key of HYDRO_TECHNOLOGY_ORDER) {
    const style = HYDRO_TECHNOLOGIES[key];
    const entry = tally.get(style.label);
    if (!entry) continue;
    legend.push({
      label: style.label,
      color: style.color,
      count: entry.count,
      blurb: `${style.blurb} — ${formatHydroPower(entry.kw)} installés`,
    });
  }
  const unknown = tally.get(HYDRO_UNKNOWN_TECH_LABEL);
  if (unknown) {
    legend.push({
      label: HYDRO_UNKNOWN_TECH_LABEL,
      color: HYDRO_UNKNOWN_COLOR,
      count: unknown.count,
      blurb: 'Le registre ne publie pas la technologie, ou en publie une qui n’est pas '
        + 'hydraulique — 25 centrales corses sont classées « Photovoltaïque » dans le fichier source',
    });
  }
  const clusterPlants = clusters.reduce((sum, c) => sum + (c.plants ?? 0), 0);
  if (clusterPlants) {
    legend.push({
      label: 'Anneau = commune, pas centrale',
      color: CLUSTER_COLOR,
      count: clusters.length,
      blurb: `${clusterPlants} installations qu’aucune source ne localise, regroupées par commune. `
        + 'Le registre ne publie qu’un code INSEE ; le centre de commune est à 3 km de la centrale '
        + 'réelle en médiane, donc elles ne sont pas dessinées comme des centrales.',
    });
  }
  return legend;
}

/**
 * JSON-safe analyst record for one plant. Pure — no Cesium types.
 * @param {object} plant
 * @param {number} [index=0]
 * @returns {object}
 */
export function mapHydroAnalystRecord(plant, index = 0) {
  const text = (value) => { const t = String(value ?? '').trim(); return t || null; };
  const num = (value) => (Number.isFinite(value) ? value : null);
  const cluster = plant?.kind === 'cluster';
  return {
    id: text(plant?.id) || `HYDRO-${String(index).padStart(4, '0')}`,
    // Null, not "Confidentiel": an analyst asking "which plants are unnamed"
    // must be able to test for absence.
    name: text(plant?.name),
    // `anonymous` is a BOOLEAN about one plant. A roll-up's own `anonymous` is
    // a COUNT of its unnamed members, and reporting it here would answer
    // "is this plant unnamed?" with `false` for a commune holding three of
    // them. So a roll-up reports null for the boolean and the count separately.
    anonymous: cluster ? null : plant?.anonymous === true,
    plants: cluster ? (Number(plant?.plants) || null) : null,
    anonymousPlants: cluster ? (Number(plant?.anonymous) || 0) : null,
    kind: cluster ? 'commune-rollup' : 'plant',
    capacityKw: num(plant?.kw),
    technology: text(plant?.tech),
    energyKwh12m: num(plant?.energyKwh),
    loadFactor: loadFactor(plant?.kw, plant?.energyKwh),
    headM: num(plant?.headM),
    commune: text(plant?.commune),
    insee: text(plant?.insee),
    departement: text(plant?.departement),
    region: text(plant?.region),
    voltage: text(plant?.voltage),
    substation: text(plant?.poste),
    gridOperator: text(plant?.operator),
    commissioned: text(plant?.commissioned),
    eic: text(plant?.eic),
    lat: num(plant?.lat),
    lon: num(plant?.lon),
    placement: text(plant?.placement),
    placementEvidence: text(plant?.matchedBy),
  };
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
  hitTest: hitTestWorldOverlay,
});

/**
 * @param {object} [options]
 * @returns {object} Data-manager layer module.
 */
export function createFrHydroPlantsLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  registryUrl = REGISTRY_URL,
  // Injected so the lifecycle can be exercised headless: Vite serves this file
  // over HTTP in the browser, and Node's `fetch` refuses the `file:` URL the
  // test resolves to.
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  let _viewer = null;
  let _points = null;
  let _clickHandler = null;
  let _registry = null;
  let _plants = [];
  let _clusters = [];
  let _visiblePlants = [];
  let _visibleClusters = [];
  let _records = new Map();
  let _selectedId = null;
  let _enabled = false;
  let _loading = false;
  let _lastUpdate = null;
  let _lastError = null;
  let _floorKw = 0;
  let _rowControlsListener = null;
  let _labelEntries = [];
  let _cameraRemovers = [];
  let _floorToken = 0;

  const renderId = (id) => `${FR_HYDRO_RENDER_PREFIX}${id}`;

  /**
   * The Cartesian a marker is drawn at: on the terrain when its floor is known,
   * on the ellipsoid when it is not yet. See `GROUND_LIFT_M`.
   */
  function markerPosition(lat, lon) {
    const floor = cachedGroundFloor(lat, lon);
    return Cesium.Cartesian3.fromDegrees(
      lon, lat, (Number.isFinite(floor) ? floor : 0) + GROUND_LIFT_M,
    );
  }

  function applyFloor() {
    _visiblePlants = _plants.filter((plant) => (plant.kw ?? 0) >= _floorKw);
    // A ring is a commune, so the floor tests its LARGEST member, never its
    // total: a commune holding twelve 200 kW mills does not clear a 1 MW floor
    // just because they add up to 2,4 MW. The ring's own card keeps describing
    // the whole commune either way, because that is what the ring means.
    _visibleClusters = _floorKw > 0
      ? _clusters.filter((cluster) => (cluster.maxKw ?? cluster.kw ?? 0) >= _floorKw)
      : _clusters;
  }

  function repaint() {
    if (!_points) return;
    // Everything a clamp pass was about to write into belongs to the
    // collection this line destroys.
    _floorToken += 1;
    _points.removeAll();
    _records = new Map();
    const entries = [];

    for (const plant of _visiblePlants) {
      const position = markerPosition(plant.lat, plant.lon);
      const id = renderId(plant.id);
      const color = hydroColor(plant);
      const pixelSize = hydroPixelSize(plant.kw);
      const point = _points.add({
        position,
        pixelSize,
        color,
        outlineColor: COLOR_OUTLINE,
        outlineWidth: 1,
        scaleByDistance: new Cesium.NearFarScalar(20_000, 1.25, 3_000_000, 0.5),
        translucencyByDistance: new Cesium.NearFarScalar(20_000, 1, 5_000_000, 0.3),
        disableDepthTestDistance: 5000,
        id,
      });
      const record = {
        id, point, position, subject: plant, kind: 'plant', baseColor: color, basePixelSize: pixelSize,
        degrees: { lat: plant.lat, lon: plant.lon },
        floorResolved: Number.isFinite(cachedGroundFloor(plant.lat, plant.lon)),
      };
      _records.set(id, record);
      record.labelEntry = {
        id: `${FR_HYDRO_LABEL_PREFIX}${plant.id}`,
        position,
        // Carried on the entry so the viewport filter needs no second lookup;
        // the overlay host ignores keys it does not know.
        degrees: { lat: plant.lat, lon: plant.lon },
        variant: 'label',
        title: hydroLabelText(plant),
        accent: color.toCssColorString(),
        priority: Math.round(plant.kw ?? 0),
        collisionGroup: 'ambient-label',
        paintLane: 'ambient-label',
        // The plant's name is a click surface, not a caption — see
        // `overlayLabelPick.js` for the mechanism and the pick-ordering rule.
        interactive: true,
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
        gapPx: 13,
        verticalOnly: true,
        placement: 'above',
      };
      entries.push(record.labelEntry);
    }

    const ringColor = Cesium.Color.fromCssColorString(CLUSTER_COLOR);
    for (const cluster of _visibleClusters) {
      const position = markerPosition(cluster.lat, cluster.lon);
      const id = renderId(cluster.id);
      const pixelSize = hydroPixelSize(cluster.kw);
      const point = _points.add({
        position,
        pixelSize,
        // Nearly transparent fill with a solid outline: a ring, which reads as
        // "an area contains this" rather than "this is here".
        color: ringColor.withAlpha(CLUSTER_FILL_ALPHA),
        outlineColor: ringColor,
        outlineWidth: 1.4,
        scaleByDistance: new Cesium.NearFarScalar(20_000, 1.25, 3_000_000, 0.5),
        translucencyByDistance: new Cesium.NearFarScalar(20_000, 1, 5_000_000, 0.3),
        disableDepthTestDistance: 5000,
        id,
      });
      _records.set(id, {
        id, point, position, subject: cluster, kind: 'cluster',
        baseColor: ringColor.withAlpha(CLUSTER_FILL_ALPHA), basePixelSize: pixelSize,
        degrees: { lat: cluster.lat, lon: cluster.lon },
        floorResolved: Number.isFinite(cachedGroundFloor(cluster.lat, cluster.lon)),
      });
    }

    _labelEntries = entries;
    publishOverlay();
    if (_selectedId && _records.has(_selectedId)) selectObject(_selectedId);
    governorRequestRender('fr-hydro-repaint');
  }

  /**
   * Publish the ambient labels for what is ON SCREEN.
   *
   * The overlay host applies `cohortLimit` to whatever it is given, so a layer
   * of 2 742 markers that hands it every entry gets the 22 largest plants IN
   * FRANCE — and zooming into the Ossau valley then shows twenty unlabelled
   * dots, because Grand-Maison and Montézic are holding the label budget from
   * four hundred kilometres away. The cohort is therefore drawn from the
   * plants inside the current view rectangle, which is what makes zooming in
   * reveal local names instead of losing them. `viewportPlants` falls back to
   * everything when the camera cannot produce a rectangle (a full-globe or
   * limb-crossing view), which is the case where the national top 22 IS the
   * right answer.
   */
  function publishOverlay() {
    if (!_enabled) {
      overlayHost.clearSource(FR_HYDRO_OVERLAY_SOURCE_ID);
      return;
    }
    const inView = viewportFilter();
    const entries = inView ? _labelEntries.filter((entry) => inView(entry)) : _labelEntries;
    // Fall through to the ground clamp: what is on screen is exactly what is
    // worth pulling onto the terrain, and this is where that set is known.
    void clampVisibleToGround();
    overlayHost.setEntries(
      FR_HYDRO_OVERLAY_SOURCE_ID,
      selectHydroOverlayCohort(entries),
      {
        cohortLimit: FR_HYDRO_OVERLAY_COHORT_LIMIT,
        collisionCapacity: FR_HYDRO_OVERLAY_COLLISION_CAPACITY,
        moving: false,
      },
    );
  }

  /**
   * Pull the visible markers onto the terrain.
   *
   * Runs after the camera settles. Only the markers actually on screen are
   * resolved, and only below `FLOOR_WARM_MAX_CAMERA_M`, which bounds the work
   * to what a reader can see being wrong: at country zoom the offset is
   * sub-pixel, and at valley zoom there are a handful of markers in frame.
   *
   * Positions are updated IN PLACE on the existing primitives rather than by
   * repainting the collection — 2 742 points do not need rebuilding because
   * twelve of them learned their altitude.
   */
  async function clampVisibleToGround() {
    if (!_enabled || !_points) return;
    const cameraM = _viewer?.camera?.positionCartographic?.height;
    if (!Number.isFinite(cameraM) || cameraM > FLOOR_WARM_MAX_CAMERA_M) return;
    const inView = viewportFilter();
    const pending = [];
    for (const record of _records.values()) {
      if (record.floorResolved) continue;
      if (inView && !inView(record)) continue;
      pending.push(record);
      if (pending.length >= FLOOR_WARM_MAX_POINTS) break;
    }
    if (!pending.length) return;
    const token = ++_floorToken;
    await resolveGroundFloorCellsBounded(pending.map((record) => record.degrees));
    // The camera can move, the layer can be disabled, or the floor filter can
    // repaint the collection while the resolver is in flight. Anything the
    // repaint replaced is stale, so the token check drops this whole pass.
    if (token !== _floorToken || !_enabled || !_points) return;
    let moved = 0;
    for (const record of pending) {
      const floor = cachedGroundFloor(record.degrees.lat, record.degrees.lon);
      if (!Number.isFinite(floor)) continue;
      record.floorResolved = true;
      const position = Cesium.Cartesian3.fromDegrees(
        record.degrees.lon, record.degrees.lat, floor + GROUND_LIFT_M,
      );
      record.position = position;
      if (record.point) record.point.position = position;
      if (record.labelEntry) record.labelEntry.position = position;
      moved += 1;
    }
    if (!moved) return;
    publishOverlay();
    if (_selectedId && _records.has(_selectedId)) selectObject(_selectedId);
    governorRequestRender('fr-hydro-ground-clamp');
  }

  /**
   * A predicate for "this label's plant is inside the current view", or null
   * when the camera cannot answer.
   */
  function viewportFilter() {
    const rectangle = _viewer?.camera?.computeViewRectangle?.();
    if (!rectangle) return null;
    const { west, south, east, north } = rectangle;
    if (![west, south, east, north].every(Number.isFinite)) return null;
    // A rectangle that spans the antimeridian has west > east; France cannot
    // be in one, and refusing it is cheaper than being subtly wrong about it.
    if (west > east) return null;
    return (entry) => {
      if (!entry?.degrees) return true;
      const { lat, lon } = entry.degrees;
      const radLat = lat * Math.PI / 180;
      const radLon = lon * Math.PI / 180;
      return radLon >= west && radLon <= east && radLat >= south && radLat <= north;
    };
  }

  function clearSelection() {
    const record = _selectedId ? _records.get(_selectedId) : null;
    if (record?.point) {
      record.point.color = record.baseColor;
      record.point.pixelSize = record.basePixelSize;
      record.point.outlineColor = record.kind === 'cluster'
        ? Cesium.Color.fromCssColorString(CLUSTER_COLOR)
        : COLOR_OUTLINE;
    }
    _selectedId = null;
    overlayHost.clearSource(FR_HYDRO_SELECTED_OVERLAY_SOURCE_ID);
  }

  function selectObject(id) {
    const record = _records.get(id);
    clearSelection();
    if (!record) return;
    _selectedId = id;
    const selected = Cesium.Color.fromCssColorString(SELECTED_COLOR);
    if (record.point) {
      record.point.outlineColor = selected;
      record.point.pixelSize = record.basePixelSize + 5;
    }
    const text = record.kind === 'cluster'
      ? buildHydroClusterCard(record.subject)
      : buildHydroCard(record.subject);
    const [title, ...details] = text.split('\n');
    overlayHost.setEntries(
      FR_HYDRO_SELECTED_OVERLAY_SOURCE_ID,
      [{
        id,
        position: record.position,
        variant: 'selected',
        selected: true,
        protected: true,
        paintLane: 'selected',
        collisionGroup: 'ambient-card',
        priority: Number.MAX_SAFE_INTEGER,
        title,
        details,
        accent: SELECTED_COLOR,
        interactive: false,
        anchorRadiusPx: 9,
        minAnchorGapPx: 11,
        verticalOnly: true,
        placement: 'above',
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
      }],
      FR_HYDRO_SELECTED_OVERLAY_SOURCE_OPTIONS,
    );
    governorRequestRender('fr-hydro-select');
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && _selectedId) {
      clearSelection();
      governorRequestRender('fr-hydro-deselect');
    }
  }

  /**
   * Install the click-to-select handler.
   *
   * Guarded on `document` because Cesium's `ScreenSpaceEventHandler` registers
   * DOM listeners in its constructor, and this layer's lifecycle is exercised
   * headless in `frHydroPlants.test.mjs`. Nothing else in the layer needs a
   * DOM, so the guard costs only the selection card off-browser.
   */
  function installClickHandler(viewer) {
    if (_clickHandler || typeof document === 'undefined') return;
    _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    _clickHandler.setInputAction((click) => {
      if (!_enabled) return;
      const picked = viewer.scene.pick(click.position);
      const id = typeof picked?.primitive?.id === 'string' ? picked.primitive.id : null;
      if (id && _records.has(id)) { selectObject(id); return; }
      // The label plane the depth buffer knows nothing about, resolved after
      // the native pick so a name drawn across a neighbouring plant cannot
      // steal it. The label carries the upstream plant id, not the render id.
      const labelled = pickOverlayLabelId(click.position, {
        sourceId: FR_HYDRO_OVERLAY_SOURCE_ID,
        prefix: FR_HYDRO_LABEL_PREFIX,
        has: (plantId) => _records.has(renderId(plantId)),
        hitTest: overlayHost.hitTest,
      });
      if (labelled) { selectObject(renderId(labelled)); return; }
      if (!id || !id.startsWith(FR_HYDRO_RENDER_PREFIX)) clearSelection();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    document.addEventListener('keydown', onKeyDown);
  }

  function removeClickHandler() {
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
  }

  const layer = {
    id: FR_HYDRO_LAYER_ID,
    name: 'Petite hydro (FR)',
    icon: '≈',
    source: 'ODRÉ + OSM',
    // The register is a shipped file and never changes between page loads.
    // A finite interval exists only so a first load that failed heals itself.
    updateInterval: 1_800_000,

    init(viewer) {
      _viewer = viewer;
      _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
      viewer.scene.primitives.add(_points);
      _points.show = false;
      _records = new Map();
      _selectedId = null;
      _enabled = false;
      overlayHost.setVisible(FR_HYDRO_OVERLAY_SOURCE_ID, false);
      overlayHost.setVisible(FR_HYDRO_SELECTED_OVERLAY_SOURCE_ID, false);
      registerPickOwner(FR_HYDRO_LAYER_ID, (pickedId) => (
        typeof pickedId === 'string' && pickedId.startsWith(FR_HYDRO_RENDER_PREFIX)
      ));
      console.log('[Data:Petite hydro] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (viewer) installClickHandler(viewer);
      if (_points) _points.show = true;
      overlayHost.setVisible(FR_HYDRO_OVERLAY_SOURCE_ID, true);
      overlayHost.setVisible(FR_HYDRO_SELECTED_OVERLAY_SOURCE_ID, true);
      // Labels follow the camera, and so does the ground clamp — see
      // `publishOverlay` and `clampVisibleToGround`.
      //
      // BOTH events, because neither covers the other. `moveEnd` fires when a
      // user finishes dragging but NOT when the camera is placed
      // programmatically, which is exactly what a share link does — so on its
      // own it would leave a link that opens straight into a valley with every
      // marker still buried. `changed` fires from inside the render loop for
      // any camera delta, including `setView`, but not reliably at the end of
      // a gesture. Both handlers are idempotent: they recompute a viewport
      // filter and, at most, kick one bounded terrain resolve for cells that
      // are not already warm.
      const follow = () => { if (_enabled) publishOverlay(); };
      if (!_cameraRemovers.length) {
        for (const event of [_viewer?.camera?.moveEnd, _viewer?.camera?.changed]) {
          if (event?.addEventListener) _cameraRemovers.push(event.addEventListener(follow));
        }
      }
      if (_plants.length || _clusters.length) repaint();
    },

    disable() {
      _enabled = false;
      clearSelection();
      removeClickHandler();
      for (const remove of _cameraRemovers) remove();
      _cameraRemovers = [];
      if (_points) _points.show = false;
      overlayHost.clearSource(FR_HYDRO_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(FR_HYDRO_OVERLAY_SOURCE_ID, false);
      overlayHost.setVisible(FR_HYDRO_SELECTED_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      if (_registry) return true;
      _loading = true;
      try {
        const response = await fetchImpl(registryUrl);
        if (!response.ok) {
          _lastError = `Registre hydro HTTP ${response.status}`;
          return false;
        }
        const payload = await response.json();
        if (!Array.isArray(payload?.plants) || !Array.isArray(payload?.clusters)) {
          _lastError = 'Registre hydro malformé';
          return false;
        }
        _registry = payload;
        _plants = payload.plants.filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
        _clusters = payload.clusters.filter((c) => Number.isFinite(c?.lat) && Number.isFinite(c?.lon));
        applyFloor();
        _lastUpdate = Date.now();
        _lastError = null;
        repaint();
        _rowControlsListener?.();
        console.log(
          `[Data:Petite hydro] ${payload.stats?.plants ?? 0} installations, `
          + `${formatHydroPower(payload.stats?.installedKw)} installés, `
          + `${_plants.length} placées + ${_clusters.length} communes`,
        );
        return true;
      } catch (error) {
        console.warn('[Data:Petite hydro] Load error:', error);
        _lastError = 'Registre hydro illisible';
        return false;
      } finally {
        _loading = false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      clearSelection();
      overlayHost.clearSource(FR_HYDRO_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(FR_HYDRO_OVERLAY_SOURCE_ID, false);
      overlayHost.setVisible(FR_HYDRO_SELECTED_OVERLAY_SOURCE_ID, false);
      unregisterPickOwner(FR_HYDRO_LAYER_ID);
      removeClickHandler();
      for (const remove of _cameraRemovers) remove();
      _cameraRemovers = [];
      if (_points) {
        viewer?.scene?.primitives?.remove?.(_points);
        _points = null;
      }
      _viewer = null;
      _records = new Map();
      _registry = null;
      _plants = [];
      _clusters = [];
      _visiblePlants = [];
      _visibleClusters = [];
      _labelEntries = [];
      _floorToken += 1;
      _selectedId = null;
      _lastUpdate = null;
      _lastError = null;
    },

    /**
     * Runtime params. `floorKw` hides the plants below a power, without losing
     * them: the shipped file always carries the whole register and `getStats()`
     * keeps reporting the totals.
     * @param {{floorKw?: number}} [params]
     * @returns {boolean}
     */
    setParams(params = {}) {
      if (params.floorKw === undefined) return false;
      const floor = Math.max(0, Number(params.floorKw) || 0);
      if (floor === _floorKw) return false;
      _floorKw = floor;
      applyFloor();
      if (_selectedId && !_records.has(_selectedId)) clearSelection();
      repaint();
      _rowControlsListener?.();
      return true;
    },

    setRowControlsListener(listener) {
      _rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    getRowControls() {
      const chips = FR_HYDRO_FLOORS.map((floor) => ({
        id: floor.id,
        label: floor.label,
        active: _floorKw === floor.kw,
        state: _floorKw === floor.kw ? 'active' : 'idle',
        title: floor.kw === 0
          ? `Tout le registre — ${_plants.length + _clusters.length} marqueurs`
          : `Masquer les installations sous ${formatHydroPower(floor.kw)}`,
        params: { floorKw: floor.kw },
      }));
      return { chips, legend: hydroLegend(_visiblePlants, _visibleClusters) };
    },

    getAnalystRecords(maxCount = 200) {
      if (!_enabled) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 200;
      const out = [];
      for (const plant of _visiblePlants) {
        if (out.length >= limit) break;
        out.push(mapHydroAnalystRecord(plant, out.length));
      }
      for (const cluster of _visibleClusters) {
        if (out.length >= limit) break;
        out.push(mapHydroAnalystRecord({ ...cluster, kind: 'cluster' }, out.length));
      }
      return out;
    },

    getStats() {
      const stats = _registry?.stats || null;
      return {
        // Markers on the globe, which is not the installation count — 1 980 of
        // them share 1 369 rings.
        count: _visiblePlants.length + _visibleClusters.length,
        lastUpdate: _lastUpdate,
        loading: _loading,
        error: _lastError,
        stale: false,
        // The register's own figures, reported whatever the floor hides.
        installations: stats?.plants ?? null,
        placed: stats?.placed ?? null,
        clustered: stats?.clustered ?? null,
        communes: stats?.communes ?? null,
        anonymous: stats?.anonymous ?? null,
        // Three capacities, because they answer three different questions.
        installedKw: stats?.installedKw ?? null,
        placedKw: stats?.placedKw ?? null,
        clusteredKw: stats?.clusteredKw ?? null,
        floorKw: _floorKw,
        hidden: (_plants.length + _clusters.length) - (_visiblePlants.length + _visibleClusters.length),
        // Licence Ouverte 2.0 obliges the producer AND the data's own date.
        registryEdition: _registry?.registre?.edition ?? null,
        registryModified: _registry?.registre?.modified ?? null,
        generated: _registry?.generated ?? null,
      };
    },
  };

  return layer;
}

const frHydroPlantsLayer = createFrHydroPlantsLayer();

export default frHydroPlantsLayer;
