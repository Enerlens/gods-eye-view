/**
 * @module fraicheurFeed
 *
 * Where Paris keeps its cool — the three registers the Ville de Paris
 * publishes about heat, and the arithmetic that decides what each one is
 * allowed to claim.
 *
 * `fraicheurTrees.js` holds the 219 432-tree half, which is a different
 * problem and gets a different regime; `fraicheurParis.js` is the drawing.
 * Everything here is pure and node-testable, under test against real captured
 * rows.
 *
 * ── The layer's argument, in one paragraph ─────────────────────────────────
 *
 * Paris publishes two lists that both sound like "where to cool off" and are
 * not the same list. `ilots-de-fraicheur-equipements-activites` is 535 POINTS
 * and it is mostly things that never close — 127 permanent shade canopies, 125
 * places of worship, 87 misters — while only **112 of the 535** publish a
 * weekday timetable a machine can read. `ilots-de-fraicheur-espaces-verts-frais`
 * is 984 real FOOTPRINTS and is the opposite: **715 of the 984** publish one.
 * So the clock lives on the parks, not on the equipment, which is the reverse
 * of what the two dataset titles suggest.
 *
 * And the clock is dated. **682 of the 984 green spaces attach their opening
 * hours to a validity window that had already expired on 2026-09-01** — 638 of
 * them to the same one, `du 01/05/26 au 31/08/26`, which ended the day before
 * this file was measured. Only 25 were still inside their stated window. Every
 * card built here says which window its hours came from and whether that window
 * is over, because a timetable presented without its expiry date is the single
 * misreading this layer would otherwise invite.
 *
 * The asymmetry underneath: **23 of the 984 carry `canicule_ouverture = "Oui"`**
 * — a declared heatwave arrangement — and **11 of those 23 have
 * `indice_veget_sup8m_2024 = 0`**, no measured canopy over 8 m at all. Their
 * median canopy share is 0.0280 against 0.3197 across all 983 spaces that carry
 * the metric. Eight of the eleven are planters (`JARDINIÈRES`) around the Porte
 * Maillot roundabout. Paris's heatwave list is, in the majority, traffic
 * islands with nothing to close.
 *
 * ── Why the whole city ships in one document ───────────────────────────────
 *
 * Measured 2026-09-01, upstream, through the exact `exports/geojson` URLs the
 * proxy builds: équipements 45 165 B on the wire / 290 718 B decoded, espaces
 * verts 3 555 863 / 9 216 103, fontaines 61 794 / 422 828 — **3 662 822 B on
 * the wire for the three**. Projected by this module the same content is
 * 3 449 847 B of JSON and **643 100 B gzipped**, which is about what the whole
 * `sup-fr` national register costs (0.62 MB gzipped) for a city of 105 km². So there
 * is no bbox query on this half and no spatial thinning: the browser is handed
 * Paris once and answers every zoom from it. What is drawn is what is there.
 *
 * Nearly all of that saving is coordinate noise, not shape. The green-space
 * polygons publish longitude to **16 decimal places** — 10⁻¹¹ m, which is
 * smaller than an atom — across 219 832 vertices. Rounding to 5 dp (0.73 m of
 * longitude at 48.86° N) and dropping the points that collapse onto their
 * neighbour leaves **127 465 vertices: 92 367 of the published points, 42.0%,
 * were duplicates of the point before them once sub-millimetre noise was taken
 * off.** Nothing is decimated on top of that — no stride, no Douglas-Peucker —
 * so a park's outline here is its published outline, moved by at most 0.73 m.
 * The 20 outer rings and 2 interior rings that fall below a triangle at 1 m are
 * slivers under a metre wide; they are dropped and COUNTED, and no feature loses
 * all of its geometry that way.
 *
 * ── A trap that is worth 24% of the wire ───────────────────────────────────
 *
 * `exports/geojson` emits the geometry whether or not the geo field is in the
 * `select` — and if you DO name it, the coordinates ship twice, once as
 * `geometry` and once as a property. Measured on the fountains: 81 148 B with
 * `geo_point_2d` in the select, **61 794 B without it**, for identical output.
 * None of the three field lists below names its geo field.
 *
 * ── The keys are not keys ──────────────────────────────────────────────────
 *
 * `identifiant` is a key on neither list. On the equipment it has 533 distinct
 * values over 535 rows: `MU75` is both the Maison Européenne de la Photographie
 * and Le CENTQUATRE, `MA22` is both the Mairie du 20e and the Maison de la Vie
 * Associative du 7e. On the green spaces it has 955 distinct values over 984,
 * with **24 rows publishing `identifiant: null`** and six values used twice.
 * `nsq_espace_vert` is worse as an identity — 662 distinct over 984, because
 * the Bois de Vincennes is 103 separate rows and the Bois de Boulogne 46. So a
 * render id is built from the published id AND the geometry, and every reuse is
 * counted into the summary rather than silently dropping a site.
 *
 * ── Not the same three counts as the portal's own facets ───────────────────
 *
 * The three registers reach outside Paris and say so in different fields. 159
 * of the 1 323 fountains are in Pantin, Thiais, Ivry, Saint-Ouen, Bagneux,
 * Saint-Denis, Nogent and Saint-Mandé — the city's cemeteries and parks beyond
 * the périphérique. Three green spaces carry `arrondissement 94300`, and one
 * carries `75116`, the alternative code for the 16e. Nothing here folds those
 * into Paris; the field is carried verbatim and the card prints what was
 * published.
 */

import { polygonsBounds, ringLabelAnchor } from './ringGeometry.js';

/** The portal all three registers live on. Keyless, ODbL, CORS `*`. */
export const FRAICHEUR_PORTAL = 'opendata.paris.fr';

/** 535 points — shade, mist, water and cold stone. */
export const FRAICHEUR_EQUIPMENT_DATASET = 'ilots-de-fraicheur-equipements-activites';
/** 984 polygons — the parks, with a measured canopy metric on each. */
export const FRAICHEUR_SPACES_DATASET = 'ilots-de-fraicheur-espaces-verts-frais';
/** 1 323 points — drinking fountains, with a live availability flag. */
export const FRAICHEUR_FOUNTAIN_DATASET = 'fontaines-a-boire';

/** Human-facing provenance, echoed by the proxy's `/status` route. */
export const FRAICHEUR_SOURCE = 'Îlots de fraîcheur, espaces verts frais et fontaines — Ville de Paris '
  + '& Eau de Paris (opendata.paris.fr)';
export const FRAICHEUR_LICENCE = 'Open Database License (ODbL)';
export const FRAICHEUR_LICENCE_URL = 'http://opendatacommons.org/licenses/odbl/';

/**
 * Who published what, read from `metas.default.publisher` on 2026-09-01.
 *
 * Three lines and not one, because the fountains are NOT the Ville de Paris:
 * `fontaines-a-boire` is published by **Eau de Paris**, the city's water
 * utility, and merging it into the city's own credit would drop an attribution
 * the licence requires.
 */
export const FRAICHEUR_PUBLISHERS = Object.freeze({
  [FRAICHEUR_EQUIPMENT_DATASET]: 'Direction de la Transition Écologique et du Climat - Ville de Paris',
  [FRAICHEUR_SPACES_DATASET]: 'Direction de la Transition Écologique et du Climat - Ville de Paris',
  [FRAICHEUR_FOUNTAIN_DATASET]: 'Eau de Paris',
});

/**
 * Columns pulled from the equipment register — 15 of its 19.
 *
 * `geo_point_2d` and `geo_shape` are both deliberately absent: the export emits
 * the geometry regardless and naming the field ships it twice (see the header).
 * `id_dicom` is an internal CMS key and `proposition_usager` is `"Non"` on 531
 * of 535 rows, which is not a fact worth a column.
 */
export const FRAICHEUR_EQUIPMENT_FIELDS = Object.freeze([
  'identifiant', 'nom', 'type', 'payant', 'adresse', 'arrondissement',
  'statut_ouverture', 'horaires_periode',
  'horaires_lundi', 'horaires_mardi', 'horaires_mercredi', 'horaires_jeudi',
  'horaires_vendredi', 'horaires_samedi', 'horaires_dimanche',
]);

/**
 * Columns pulled from the green-space register — 21 of its 27.
 *
 * `proportion_vegetation_haute` is dropped because it is `p_vegetation_h × 100`
 * on every row, and `p_vegetation_h` itself is kept only so the card can show
 * that it DISAGREES with the survey metric: measured over the 953 rows carrying
 * both, they differ on **903** of them, median gap 0.0622 and worst 0.8176.
 * They are two different statements about the same park and the card shows both
 * rather than picking one and calling it "the vegetation".
 */
export const FRAICHEUR_SPACE_FIELDS = Object.freeze([
  'identifiant', 'nsq_espace_vert', 'nom', 'type', 'categorie', 'adresse', 'arrondissement',
  'ouvert_24h', 'canicule_ouverture', 'ouverture_estivale_nocturne', 'horaires_periode',
  'horaires_lundi', 'horaires_mardi', 'horaires_mercredi', 'horaires_jeudi',
  'horaires_vendredi', 'horaires_samedi', 'horaires_dimanche',
  'p_vegetation_h', 'surf_veget_sup8m_2024', 'indice_veget_sup8m_2024',
]);

/** Columns pulled from the fountain register — 9 of its 13. */
export const FRAICHEUR_FOUNTAIN_FIELDS = Object.freeze([
  'gid', 'type_objet', 'modele', 'voie', 'commune', 'dispo',
  'debut_ind', 'fin_ind', 'motif_ind',
]);

/**
 * The rectangle these three registers describe, plus a margin.
 *
 * NOT the city boundary. Measured over every coordinate in all four downloaded
 * files on 2026-09-01: latitude 48.7423 → 48.9122, longitude 2.2102 → 2.4698.
 * The southern edge is the Cimetière parisien de Thiais and the northern one is
 * Saint-Ouen — Paris buries and waters its dead outside its own walls, and 159
 * fountains and 25 045 trees live out there. A coverage box drawn on the
 * périphérique would report them as off-map.
 */
export const FRAICHEUR_COVERAGE = Object.freeze({
  south: 48.73, west: 2.20, north: 48.92, east: 2.48,
});

/**
 * Coordinate precision, in decimal places.
 *
 * 5 dp is 1.11 m of latitude and 0.73 m of longitude at 48.86° N. The registers
 * publish 16, which is 10⁻¹¹ m; see the header for what that costs and what
 * rounding it off recovers. A park boundary is a management envelope, not a
 * bornage, so a metre is far finer than the line itself means.
 */
export const FRAICHEUR_DECIMALS = 5;

/**
 * The seven weekday columns, Monday-first.
 *
 * Monday-first because that is the order the register publishes them in and the
 * order France counts days in; `Date#getDay()` is Sunday-first, which is why
 * {@link parisClock} converts rather than indexing straight into this.
 */
export const FRAICHEUR_DAY_KEYS = Object.freeze([
  'horaires_lundi', 'horaires_mardi', 'horaires_mercredi', 'horaires_jeudi',
  'horaires_vendredi', 'horaires_samedi', 'horaires_dimanche',
]);

export const FRAICHEUR_DAY_LABELS = Object.freeze([
  'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche',
]);

/**
 * The five ways a Parisian actually gets cool, and the 12 published types
 * folded onto them.
 *
 * Folded on the PHYSICS, never on the name. The register's own `type` is a list
 * of building categories — Musée, Mairie d'arrondissement, Lieux de culte — and
 * read that way the list looks like a municipal directory that wandered into a
 * climate dataset. It is not. A church is on it because five metres of limestone
 * holds last night's temperature through the afternoon, and so is a town hall,
 * a museum and a library. Naming the mechanism is what turns the list back into
 * what it is.
 *
 * The counts are the whole register, measured 2026-09-01 (they sum to 535):
 *
 *   pierre     225 — Lieux de culte 125, Musée 65, Mairie d'arrondissement 19,
 *                    Bibliothèque 16. Thermal mass you go inside. The BIGGEST
 *                    family, and the one nobody would have guessed: 125 of the
 *                    city's 535 official cool spots are churches.
 *   ombre      139 — Ombrière pérenne 127, Ombrière temporaire 12. Shade you
 *                    stand under. Kept apart from `pierre` because a canopy
 *                    over a pavement is not a cold room, and kept together
 *                    across pérenne/temporaire because the 12 temporary ones
 *                    are the same object with a shorter lease.
 *   brume       87 — Brumisateur. Evaporative cooling, alone, because it is the
 *                    only family that works by taking heat out of you rather
 *                    than by keeping it off you.
 *   bain        67 — Piscine 39, Bains-douches 17, Baignade extérieure 11.
 *                    Water you get INTO. The bains-douches are here rather than
 *                    with the cold stone because the point of them is the water.
 *   plein-air   17 — Terrain de boules 13, Découverte et Initiation 4. Open
 *                    ground the city has listed. The catch-all, and it keeps a
 *                    name that says so.
 *
 * Order is legend order, biggest family first.
 */
export const FRAICHEUR_FAMILIES = Object.freeze(['pierre', 'ombre', 'brume', 'bain', 'plein-air']);

export const FRAICHEUR_FAMILY_LABELS = Object.freeze({
  pierre: 'Masse froide (pierre)',
  ombre: 'Ombrière',
  brume: 'Brumisateur',
  bain: 'Bain & baignade',
  'plein-air': 'Plein air',
});

export const FRAICHEUR_FAMILY_BLURBS = Object.freeze({
  pierre: 'Lieux de culte (125), musées (65), mairies (19), bibliothèques (16). Ils sont sur la liste parce que la pierre est froide.',
  ombre: 'Ombrières pérennes (127) et temporaires (12) — de l’ombre sur un trottoir, sans porte ni horaire.',
  brume: 'Brumisateurs (87). Aucun ne publie d’horaire hebdomadaire.',
  bain: 'Piscines (39), bains-douches (17), baignades extérieures (11). La famille qui publie ses horaires : 64 des 67.',
  'plein-air': 'Terrains de boules (13) et sites Découverte & Initiation (4).',
});

/** Published `type` → family. All 12 values are named; nothing falls through. */
const TYPE_TO_FAMILY = Object.freeze({
  'Lieux de culte': 'pierre',
  'Musée': 'pierre',
  "Mairie d'arrondissement": 'pierre',
  'Mairie d’arrondissement': 'pierre',
  'Bibliothèque': 'pierre',
  'Ombrière pérenne': 'ombre',
  'Ombrière temporaire': 'ombre',
  'Brumisateur': 'brume',
  'Piscine': 'bain',
  'Bains-douches': 'bain',
  'Baignade extérieure': 'bain',
  'Terrain de boules': 'plein-air',
  'Découverte et Initiation': 'plein-air',
});

/**
 * The family for one published type. An unmapped type lands in `plein-air`,
 * which is the register's own residual category rather than a flattering one.
 * @param {unknown} type
 * @returns {string}
 */
export function fraicheurFamily(type) {
  return TYPE_TO_FAMILY[String(type ?? '').trim()] || 'plein-air';
}

/**
 * The canopy ladder: six bands on `indice_veget_sup8m_2024`, plus one for the
 * space that does not carry it.
 *
 * The metric is the share of the space covered by vegetation TALLER THAN 8 m,
 * from a 2024 survey. It is not "how green" — it is how much of the ground has
 * something over it that casts shade at three in the afternoon, which is the
 * only kind of green that matters to a heatwave.
 *
 * Thresholds are FIXED rather than quantiled per payload, because the survey is
 * a single 2024 edition and a bin that meant one thing in the 12e and another
 * in the 1er would make two viewports incomparable. They are set on the measured
 * distribution across all 983 spaces that carry the metric (p25 0.1083,
 * p50 0.3197, p75 0.5366), and the counts below are the whole register:
 *
 *   nue          66 — EXACTLY zero. Its own band and not the bottom of the ramp:
 *                     "no tall vegetation was found here" is a different
 *                     statement from "a little was", and 66 of Paris's cool
 *                     green spaces are in the first group.
 *   rare        169 — 0 < v < 0.10
 *   clairsemee  166 — 0.10 ≤ v < 0.25
 *   moyenne     186 — 0.25 ≤ v < 0.40
 *   dense       164 — 0.40 ≤ v < 0.55
 *   couverte    232 — v ≥ 0.55
 *   inconnue      1 — the metric is null. Grey, never folded into `nue`.
 *
 * 66 + 169 + 166 + 186 + 164 + 232 + 1 = 984.
 */
export const FRAICHEUR_CANOPY_BANDS = Object.freeze([
  Object.freeze({
    id: 'nue', label: 'Aucune canopée mesurée', color: '#d9c8a3', min: 0, max: 0,
    blurb: 'indice_veget_sup8m_2024 exactement 0 — 66 espaces sur 984. Rien de plus haut que 8 m au relevé 2024.',
  }),
  Object.freeze({
    id: 'rare', label: 'Canopée < 10 %', color: '#c8d98f', min: 0, max: 0.10,
    blurb: 'Moins d’un dixième du sol sous un arbre de plus de 8 m.',
  }),
  Object.freeze({
    id: 'clairsemee', label: 'Canopée 10–25 %', color: '#96c66b', min: 0.10, max: 0.25,
    blurb: 'Le quart inférieur du registre : sous 0,1083, un espace vert sur quatre.',
  }),
  Object.freeze({
    id: 'moyenne', label: 'Canopée 25–40 %', color: '#5aab52', min: 0.25, max: 0.40,
    blurb: 'La médiane parisienne est à 0,3197 — la moitié des espaces sont sous cette barre.',
  }),
  Object.freeze({
    id: 'dense', label: 'Canopée 40–55 %', color: '#2f8b43', min: 0.40, max: 0.55,
    blurb: 'Le quart supérieur commence à 0,5366.',
  }),
  Object.freeze({
    id: 'couverte', label: 'Canopée ≥ 55 %', color: '#12622f', min: 0.55, max: Infinity,
    blurb: '232 espaces. Les bois en tiennent l’essentiel : 6 159 289 m² des 8 734 377 m² de canopée mesurée à Paris.',
  }),
]);

/** The band for a space whose metric was not published. Grey, and named. */
export const FRAICHEUR_CANOPY_UNKNOWN = Object.freeze({
  id: 'inconnue', label: 'Canopée non mesurée', color: '#8a93a6', min: null, max: null,
  blurb: 'indice_veget_sup8m_2024 absent — un espace sur 984. La surface, elle, manque sur 65.',
});

/** Band ids in legend order, unknown last. */
export const FRAICHEUR_CANOPY_BAND_IDS = Object.freeze([
  ...FRAICHEUR_CANOPY_BANDS.map((band) => band.id),
  FRAICHEUR_CANOPY_UNKNOWN.id,
]);

/**
 * The canopy band for one published index.
 * @param {unknown} indice
 * @returns {typeof FRAICHEUR_CANOPY_UNKNOWN}
 */
export function fraicheurCanopyBand(indice) {
  const value = finiteOrNull(indice);
  if (value === null || value < 0) return FRAICHEUR_CANOPY_UNKNOWN;
  if (value === 0) return FRAICHEUR_CANOPY_BANDS[0];
  for (const band of FRAICHEUR_CANOPY_BANDS) {
    if (band.max === 0) continue;
    if (value < band.max) return band;
  }
  return FRAICHEUR_CANOPY_BANDS[FRAICHEUR_CANOPY_BANDS.length - 1];
}

/**
 * The fountain models, in the words on the street.
 *
 * `type_objet` is capped at 15 characters upstream and the four values that
 * would have been longer are ELIDED rather than truncated — `FONTAINE_WALLACE`
 * (16) arrives as `FONTNE_WALLACE`, `FONTAINE_PETILLANTE` (19) as
 * `FTNE_PETILLANTE`. Measured across all 1 323 rows: ten distinct values, none
 * longer than 15 characters. Printing them raw would put `FTNE_POING_EAU` on a
 * card, so every one is mapped and an unknown code is shown verbatim rather
 * than guessed at.
 */
export const FRAICHEUR_FOUNTAIN_LABELS = Object.freeze({
  FONTAINE_BOIS: 'Fontaine de parc',
  FONTNE_WALLACE: 'Fontaine Wallace',
  FONTAINE_2EN1: 'Fontaine 2-en-1',
  FONTAINE_ARCEAU: 'Fontaine arceau',
  BORNE_FONTAINE: 'Borne-fontaine',
  FTNE_PETILLANTE: 'Fontaine pétillante',
  FONTAINE_TOTEM: 'Fontaine totem',
  FTNE_POING_EAU: 'Fontaine « poing d’eau »',
  FONTAINE_ALBIEN: 'Puits de l’Albien',
  FTNE_MILLENAIRE: 'Fontaine du Millénaire',
});

/** Label for one fountain code; unmapped codes are printed as published. */
export function fraicheurFountainLabel(code) {
  const key = String(code ?? '').trim();
  if (!key) return 'Fontaine';
  return FRAICHEUR_FOUNTAIN_LABELS[key] || key;
}

/**
 * The three `modele` strings that mean "this one mists you".
 *
 * 59 + 10 + 3 = 72 of the 1 323 fountains, measured. Worth naming because the
 * equipment register lists 87 brumisateurs and these 72 are not among them —
 * a reader counting misters in Paris from either list alone is short.
 */
export const FRAICHEUR_MISTING_MODELS = Object.freeze([
  'Brumisante', 'Brumisation basse pression', 'Brumisation haute pression',
]);

// --- Small readers ----------------------------------------------------------

/**
 * @returns {?number} `value` when it is a usable finite number, else null.
 *
 * `Number(null)` is 0 and `Number('')` is 0, so the obvious one-liner turns an
 * unpublished `surf_veget_sup8m_2024` — absent on 65 of 984 — into a park that
 * DECLARES zero square metres of canopy, which is a claim the register never
 * made and which would land it in the `nue` band beside the 66 that did.
 */
export function finiteOrNull(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** A trimmed string, or null. */
export function text(value) {
  const string = typeof value === 'string' ? value.trim() : (value === null || value === undefined ? '' : String(value).trim());
  return string || null;
}

/** `"Oui"` / `"Non"` / anything else. Three-state, never coerced to boolean. */
export function ouiNonNull(value) {
  const string = text(value);
  if (!string) return null;
  const lower = string.toLowerCase();
  if (lower === 'oui') return true;
  if (lower === 'non') return false;
  return null;
}

const SCALE = 10 ** FRAICHEUR_DECIMALS;
const round5 = (value) => Math.round(value * SCALE) / SCALE;

/**
 * Round a ring to {@link FRAICHEUR_DECIMALS} and drop the points that collapse
 * onto their neighbour.
 *
 * This is the whole of the geometry projection — there is no stride and no
 * Douglas-Peucker after it, deliberately. Measured over all 3 439 published
 * rings: rounding alone takes 219 832 vertices down to 127 465, because 42.0%
 * of the published points are the same 1 m position as the point before them
 * once 16 decimal places of noise are removed. A stride on top of that would
 * save a further 16% of the gzipped pack and would make every outline a
 * simplification the card had to disclaim; this way the drawn shape IS the
 * published shape, moved by at most one metre.
 * @param {Array<number[]>} ring
 * @returns {Array<number[]>}
 */
export function roundRing(ring) {
  const out = [];
  let previous = null;
  for (const point of Array.isArray(ring) ? ring : []) {
    const lon = finiteOrNull(point?.[0]);
    const lat = finiteOrNull(point?.[1]);
    if (lon === null || lat === null) continue;
    const rounded = [round5(lon), round5(lat)];
    if (previous && previous[0] === rounded[0] && previous[1] === rounded[1]) continue;
    out.push(rounded);
    previous = rounded;
  }
  return out;
}

/**
 * Normalize a Polygon or MultiPolygon into rounded `[[outer, ...holes], …]`.
 *
 * The register is 584 Polygon and 400 MultiPolygon, so both branches are load
 * bearing. Interior rings are kept: 263 of the 984 spaces carry at least one,
 * 1 214 rings in total, and a park drawn without its holes swallows whatever
 * the city carved out of it.
 * @param {object|null|undefined} geometry
 * @returns {{parts: Array<Array<Array<number[]>>>, sourceVertices: number,
 *   keptVertices: number, droppedOuter: number, droppedHoles: number, holes: number}}
 */
export function projectSpaceGeometry(geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates
      : [];
  const parts = [];
  let sourceVertices = 0;
  let keptVertices = 0;
  let droppedOuter = 0;
  let droppedHoles = 0;
  let holes = 0;
  for (const polygon of Array.isArray(polygons) ? polygons : []) {
    const outerRaw = Array.isArray(polygon) ? polygon[0] : null;
    if (!Array.isArray(outerRaw)) continue;
    sourceVertices += outerRaw.length;
    const outer = roundRing(outerRaw);
    // A ring that cannot make a triangle at 1 m is a sliver under a metre
    // across. 20 of the register's 2 225 outer rings are; they are dropped and
    // counted, and no space in the register loses ALL of its parts that way.
    if (outer.length < 3) { droppedOuter += 1; continue; }
    const rings = [outer];
    keptVertices += outer.length;
    for (let index = 1; index < polygon.length; index += 1) {
      const holeRaw = polygon[index];
      if (!Array.isArray(holeRaw)) continue;
      sourceVertices += holeRaw.length;
      const hole = roundRing(holeRaw);
      if (hole.length < 3) { droppedHoles += 1; continue; }
      rings.push(hole);
      keptVertices += hole.length;
      holes += 1;
    }
    parts.push(rings);
  }
  return { parts, sourceVertices, keptVertices, droppedOuter, droppedHoles, holes };
}

// --- The clock --------------------------------------------------------------

/**
 * Paris local time, as a weekday index and a minute of the day.
 *
 * `Europe/Paris` and not the browser's zone, and that is not pedantry: this
 * layer answers "what is open right now" about one city, and an operator in
 * Denver reading a Paris timetable against Mountain Time would be shown a park
 * as open eight hours after it shut. `Intl.DateTimeFormat` does the conversion
 * including the summer-time step, which is exactly the arithmetic a hand-rolled
 * `+2h` would get wrong on the last Sunday of October.
 *
 * The weekday is remapped to MONDAY = 0, because that is the order the register
 * publishes its seven columns in.
 * @param {Date|number} [now]
 * @returns {{dow:number, minutes:number, day:string, hhmm:string, iso:string}}
 */
export function parisClock(now = Date.now()) {
  const date = now instanceof Date ? now : new Date(now);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const read = (type) => parts.find((part) => part.type === type)?.value ?? '';
  const MONDAY_FIRST = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const dow = MONDAY_FIRST[read('weekday')] ?? 0;
  // `hour: '2-digit'` with `hour12: false` renders midnight as `24` in some ICU
  // builds, which would put the clock at minute 1440 of the previous day.
  const hour = Number(read('hour')) % 24;
  const minute = Number(read('minute'));
  return {
    dow,
    minutes: hour * 60 + minute,
    day: FRAICHEUR_DAY_LABELS[dow],
    hhmm: `${String(hour).padStart(2, '0')} h ${String(minute).padStart(2, '0')}`,
    iso: `${read('year')}-${read('month')}-${read('day')}`,
  };
}

/** How a close time of exactly 23:59 is read. See {@link parseOpeningDay}. */
export const FRAICHEUR_END_OF_DAY_MIN = 24 * 60;

/**
 * One published day-string, as a list of `[openMinute, closeMinute)` intervals.
 *
 * Returns `null` for "nothing was published for this day" and `[]` for "the
 * register says closed". The two are NOT the same answer and collapsing them
 * would turn 187 dashes into 187 closures.
 *
 * The formats are not a convention, they are what 217 distinct day-strings
 * across the two registers actually contain, and every branch below is one of
 * them, measured:
 *   `10h00 - 18h00` · `10h - 20h` · `11:00 - 18:00` · `12h-19h` (no spaces) ·
 *   `10h00 -18h30` (one space) · `9H30 - 17H` (upper case, no closing minutes) ·
 *   `10h – 18h` (EN DASH, U+2013) · `07h00 - 08h30 / 11h30 - 13h45 / 16h45 - 22h00`
 *   (three intervals) · `Fermé` · `-`
 *
 * TWO deliberate rules, both forced by the data:
 *
 * • **A close at 23h59 is read as midnight.** `00h00 - 23h59` is how this
 *   publisher spells "all day" — it is on 2 072 of the green-space day-cells,
 *   the single commonest value in either register — and reading it literally
 *   with a half-open interval would report every park in Paris as shut for the
 *   last minute of every day. 320 spaces carry a 23h59 close somewhere.
 *
 * • **A string that parses to nothing is `null`, not `[]`.** One equipment row
 *   has the sentence "Les horaires étant susceptibles d'évoluer, merci d" — the
 *   dataset's prose disclaimer, cut to exactly 50 characters, sitting in a
 *   weekday column. It is an absence of hours, not a closure.
 * @param {unknown} raw
 * @returns {?Array<number[]>}
 */
export function parseOpeningDay(raw) {
  const value = text(raw);
  if (!value || value === '-') return null;
  if (/^ferm/i.test(value)) return [];
  const intervals = [];
  for (const chunk of value.split('/')) {
    const marks = [...chunk.matchAll(/(\d{1,2})\s*[hH:]\s*(\d{2})?/g)];
    if (marks.length < 2) continue;
    const open = Number(marks[0][1]) * 60 + Number(marks[0][2] || 0);
    let close = Number(marks[1][1]) * 60 + Number(marks[1][2] || 0);
    if (close === 23 * 60 + 59) close = FRAICHEUR_END_OF_DAY_MIN;
    if (!Number.isFinite(open) || !Number.isFinite(close)) continue;
    if (open < 0 || open >= FRAICHEUR_END_OF_DAY_MIN || close <= open) continue;
    intervals.push([open, close]);
  }
  return intervals.length ? intervals : null;
}

/** `07 h 30` from a minute of the day. */
export function formatMinuteOfDay(minutes) {
  const value = finiteOrNull(minutes);
  if (value === null) return null;
  const clamped = Math.max(0, Math.min(FRAICHEUR_END_OF_DAY_MIN, Math.round(value)));
  if (clamped >= FRAICHEUR_END_OF_DAY_MIN) return 'minuit';
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')} h ${String(clamped % 60).padStart(2, '0')}`;
}

const WINDOW_RE = /^du (\d{2})\/(\d{2})\/(\d{2}) au (\d{2})\/(\d{2})\/(\d{2})$/;
const OPEN_ENDED_RE = /^à partir du (\d{2})\/(\d{2})\/(\d{2})$/i;

/** `DD/MM/YY` → an ISO date, treating `YY` as 20YY. */
function frenchShortDate(day, month, year, endOfDay = false) {
  const iso = `20${year}-${month}-${day}`;
  const time = endOfDay ? 'T23:59:59Z' : 'T00:00:00Z';
  const value = Date.parse(iso + time);
  return Number.isFinite(value) ? { iso, at: value } : null;
}

/**
 * What `horaires_periode` says about how long its timetable is good for.
 *
 * This is the layer's most load-bearing function, because of one measurement:
 * on 2026-09-01, **682 of the 984 green spaces published a window that had
 * already ended**, 638 of them the same `du 01/05/26 au 31/08/26` — a summer
 * timetable that expired the previous day, in a file whose own `modified` stamp
 * is 2026-08-28. Only 25 were inside their stated window. The equipment register
 * is milder but not clean: 89 of its 535 rows carry a closed window and 10 of
 * those had expired, 9 of them on a row that also publishes weekday hours.
 *
 * Four shapes, all of them real (counts are equipment / green spaces):
 *   `window`     — `du DD/MM/YY au DD/MM/YY`        89 / 707
 *   `open-ended` — `à partir du DD/MM/YY`           14 /   0
 *   `prose`      — free text, 331 / 11. The commonest is "Les horaires étant
 *                  susceptibles d'évoluer, merci de vous renseigner directement
 *                  sur place." on 124 equipment rows. It is a real caveat and it
 *                  is carried to the card verbatim rather than discarded.
 *   `none`       — null, 101 / 266.
 * @param {unknown} periode
 * @param {Date|number} [now]
 * @returns {{kind:string, text:?string, from:?string, to:?string, expired:boolean, pending:boolean}}
 */
export function scheduleValidity(periode, now = Date.now()) {
  const value = text(periode);
  const at = now instanceof Date ? now.getTime() : Number(now);
  if (!value) return { kind: 'none', text: null, from: null, to: null, expired: false, pending: false };

  const window = WINDOW_RE.exec(value);
  if (window) {
    const from = frenchShortDate(window[1], window[2], window[3]);
    const to = frenchShortDate(window[4], window[5], window[6], true);
    return {
      kind: 'window',
      text: value,
      from: from?.iso ?? null,
      to: to?.iso ?? null,
      expired: Boolean(to && at > to.at),
      pending: Boolean(from && at < from.at),
    };
  }
  const openEnded = OPEN_ENDED_RE.exec(value);
  if (openEnded) {
    const from = frenchShortDate(openEnded[1], openEnded[2], openEnded[3]);
    return {
      kind: 'open-ended',
      text: value,
      from: from?.iso ?? null,
      to: null,
      expired: false,
      pending: Boolean(from && at < from.at),
    };
  }
  return { kind: 'prose', text: value, from: null, to: null, expired: false, pending: false };
}

/**
 * Is this site open at this instant, and if not, when does it next open?
 *
 * Three answers and never two. `unknown` is the honest one for 423 of the 535
 * equipment rows and 269 of the 984 green spaces, and it must never be dressed
 * up as `closed` — "we do not know" and "it is shut" send an operator to
 * different places.
 *
 * `always` short-circuits the timetable for a space the register flags
 * `ouvert_24h = "Oui"`. That flag and the timetable DISAGREE on 244 of the 984
 * spaces (189 carry the flag, 301 spell `00h00 - 23h59` on all seven days, and
 * only 123 do both), so which one wins has to be a stated choice: the flag
 * wins, because it is the field the city maintains as an assertion while the
 * seven strings are a rendering of a seasonal timetable — and the disagreement
 * is counted into the summary rather than hidden.
 * @param {{days: Array<?string>}} schedule
 * @param {{dow:number, minutes:number}} clock
 * @param {{always?: boolean}} [options]
 * @returns {{state:string, interval:?number[], opensAt:?number, opensDay:?number}}
 */
export function openStateAt(schedule, clock, { always = false } = {}) {
  if (always) return { state: 'open', interval: [0, FRAICHEUR_END_OF_DAY_MIN], opensAt: null, opensDay: null };
  const days = Array.isArray(schedule?.days) ? schedule.days : [];
  if (!days.some((day) => parseOpeningDay(day) !== null)) {
    return { state: 'unknown', interval: null, opensAt: null, opensDay: null };
  }
  const dow = Number.isFinite(clock?.dow) ? ((clock.dow % 7) + 7) % 7 : 0;
  const minutes = Number.isFinite(clock?.minutes) ? clock.minutes : 0;
  const today = parseOpeningDay(days[dow]);
  if (today) {
    for (const [open, close] of today) {
      if (minutes >= open && minutes < close) {
        return { state: 'open', interval: [open, close], opensAt: null, opensDay: null };
      }
    }
    for (const [open] of today) {
      if (open > minutes) return { state: 'closed', interval: null, opensAt: open, opensDay: dow };
    }
  }
  // The next day, up to a week out, that publishes an interval at all. A park
  // shut on Monday and open on Tuesday should say Tuesday, not just "fermé".
  for (let step = 1; step <= 7; step += 1) {
    const index = (dow + step) % 7;
    const intervals = parseOpeningDay(days[index]);
    if (intervals?.length) {
      return { state: 'closed', interval: null, opensAt: intervals[0][0], opensDay: index };
    }
  }
  return { state: 'closed', interval: null, opensAt: null, opensDay: null };
}

// --- Projection -------------------------------------------------------------

/** Pull the seven weekday strings off a row, in Monday-first order. */
function readSchedule(properties) {
  return {
    periode: text(properties?.horaires_periode),
    days: FRAICHEUR_DAY_KEYS.map((key) => text(properties?.[key])),
  };
}

/** True when a schedule carries at least one machine-readable interval. */
export function scheduleIsReadable(schedule) {
  return (schedule?.days || []).some((day) => {
    const intervals = parseOpeningDay(day);
    return Array.isArray(intervals) && intervals.length > 0;
  });
}

/**
 * A render id that is unique even though the published one is not.
 *
 * The published key plus the geometry, and an ordinal only if that still
 * collides. Every ordinal appended is counted, so "2 identifiants réutilisés"
 * reaches the summary instead of two sites quietly becoming one.
 */
function uniqueId(seen, base, counters) {
  let id = base;
  if (seen.has(id)) {
    counters.reused += 1;
    let ordinal = 2;
    while (seen.has(`${base}~${ordinal}`)) ordinal += 1;
    id = `${base}~${ordinal}`;
  }
  seen.add(id);
  return id;
}

/**
 * Project the three registers into the one document the browser receives.
 *
 * All three at once and not three endpoints, because they are read together:
 * the question "where can I cool off" is answered by a park, a mister and a tap
 * on the same screen, and splitting them would make the layer's first paint
 * three round trips instead of one. Measured output: 2 973 642 B of JSON,
 * 597 378 B gzipped.
 *
 * A missing register is a DEGRADED pack, not a failed one — pass `null` for any
 * of the three and the summary reports which ones answered. The proxy leans on
 * that: losing the fountains costs 1 323 taps and keeps 984 parks.
 *
 * @param {object} options
 * @param {?object} options.spaces Raw `exports/geojson` FeatureCollection.
 * @param {?object} options.equipment Raw `exports/geojson` FeatureCollection.
 * @param {?object} options.fountains Raw `exports/geojson` FeatureCollection.
 * @param {Date|number} [options.now] The instant "open right now" is answered at.
 * @param {string} [options.source]
 * @returns {object}
 */
export function projectFraicheurRefuges({
  spaces = null, equipment = null, fountains = null, now = Date.now(), source = FRAICHEUR_SOURCE,
} = {}) {
  const clock = parisClock(now);
  const counters = { reused: 0 };

  const spaceRows = [];
  const spaceSeen = new Set();
  let sourceVertices = 0;
  let keptVertices = 0;
  let droppedRings = 0;
  let spacesWithHoles = 0;
  let multipartSpaces = 0;
  let unplacedSpaces = 0;
  for (const feature of spaces?.features || []) {
    const properties = feature?.properties || {};
    const geometry = projectSpaceGeometry(feature?.geometry);
    sourceVertices += geometry.sourceVertices;
    keptVertices += geometry.keptVertices;
    droppedRings += geometry.droppedOuter + geometry.droppedHoles;
    if (geometry.holes > 0) spacesWithHoles += 1;
    if (geometry.parts.length > 1) multipartSpaces += 1;
    if (!geometry.parts.length) {
      // Counted, never placed at an arrondissement centroid. A park with no
      // usable footprint is a park this layer cannot draw, and saying so is the
      // only honest option.
      unplacedSpaces += 1;
      continue;
    }
    const anchorRings = geometry.parts.reduce(
      (best, rings) => (rings[0].length > (best?.[0]?.length || 0) ? rings : best),
      null,
    );
    const anchor = ringLabelAnchor(anchorRings);
    const schedule = readSchedule(properties);
    const canopy = finiteOrNull(properties.indice_veget_sup8m_2024);
    const identifiant = text(properties.identifiant);
    const nsq = finiteOrNull(properties.nsq_espace_vert);
    // The anchor, not a bounding box, and the box is deliberately NOT shipped:
    // `ringLabelAnchor` already stands inside the widest part, and
    // `polygonsBounds` costs the client one linear pass over rings it is about
    // to tessellate anyway. Measured, the boxes are 28 873 B gzipped of the
    // pack for arithmetic the browser can do in a millisecond.
    const bounds = anchor ? null : polygonsBounds(geometry.parts);
    const base = `ev:${identifiant || (nsq === null ? '?' : `nsq${nsq}`)}@`
      + `${anchor ? anchor.lon : bounds?.west ?? 0},${anchor ? anchor.lat : bounds?.south ?? 0}`;
    spaceRows.push({
      id: uniqueId(spaceSeen, base, counters),
      ref: identifiant,
      nsq,
      name: text(properties.nom),
      type: text(properties.type),
      category: text(properties.categorie),
      address: text(properties.adresse),
      arrondissement: text(properties.arrondissement),
      canopy,
      canopyM2: finiteOrNull(properties.surf_veget_sup8m_2024),
      vegHigh: finiteOrNull(properties.p_vegetation_h),
      band: fraicheurCanopyBand(canopy).id,
      open24: ouiNonNull(properties.ouvert_24h),
      canicule: ouiNonNull(properties.canicule_ouverture),
      nocturne: ouiNonNull(properties.ouverture_estivale_nocturne),
      schedule,
      anchor: anchor ? [anchor.lon, anchor.lat] : null,
      parts: geometry.parts,
    });
  }

  const equipmentRows = [];
  const equipmentSeen = new Set();
  let unplacedEquipment = 0;
  for (const feature of equipment?.features || []) {
    const properties = feature?.properties || {};
    const point = readPoint(feature?.geometry);
    if (!point) { unplacedEquipment += 1; continue; }
    const identifiant = text(properties.identifiant);
    const type = text(properties.type);
    equipmentRows.push({
      id: uniqueId(equipmentSeen, `eq:${identifiant || '?'}@${point[0]},${point[1]}`, counters),
      ref: identifiant,
      name: text(properties.nom),
      type,
      family: fraicheurFamily(type),
      paying: ouiNonNull(properties.payant),
      address: text(properties.adresse),
      arrondissement: text(properties.arrondissement),
      status: text(properties.statut_ouverture),
      schedule: readSchedule(properties),
      p: point,
    });
  }

  const fountainRows = [];
  const fountainSeen = new Set();
  let unplacedFountains = 0;
  for (const feature of fountains?.features || []) {
    const properties = feature?.properties || {};
    const point = readPoint(feature?.geometry);
    if (!point) { unplacedFountains += 1; continue; }
    const model = text(properties.modele);
    fountainRows.push({
      id: uniqueId(fountainSeen, `fo:${text(properties.gid) || '?'}@${point[0]},${point[1]}`, counters),
      ref: text(properties.gid),
      kind: text(properties.type_objet),
      model,
      misting: FRAICHEUR_MISTING_MODELS.includes(model || ''),
      street: text(properties.voie),
      commune: text(properties.commune),
      // `dispo` is the strings "OUI"/"NON", never a boolean. Three-state, so a
      // future null does not silently become "available".
      available: ouiNonNull(properties.dispo),
      from: text(properties.debut_ind),
      to: text(properties.fin_ind),
      reason: text(properties.motif_ind),
      p: point,
    });
  }

  return {
    spaces: spaceRows,
    equipment: equipmentRows,
    fountains: fountainRows,
    clock,
    available: {
      spaces: Boolean(spaces),
      equipment: Boolean(equipment),
      fountains: Boolean(fountains),
    },
    geometry: {
      sourceVertices,
      keptVertices,
      droppedRings,
      withHoles: spacesWithHoles,
      multipart: multipartSpaces,
      decimals: FRAICHEUR_DECIMALS,
    },
    unplaced: {
      spaces: unplacedSpaces,
      equipment: unplacedEquipment,
      fountains: unplacedFountains,
    },
    reusedIds: counters.reused,
    // Published-key reuse, counted per register. NOT the same number as
    // `reusedIds`: a render id carries the geometry, so the two `MU75` rows do
    // not collide once they are placed — but the register still published one
    // identifier for two museums, and a downstream consumer keying on it would
    // lose one of them. Measured: equipment 2 values over 4 rows, spaces 6
    // values over 12 rows plus 24 rows with no identifier at all.
    refReuse: {
      equipment: countRefReuse(equipmentRows),
      spaces: countRefReuse(spaceRows),
      fountains: countRefReuse(fountainRows),
    },
    summary: summarizeFraicheurRefuges(
      { spaces: spaceRows, equipment: equipmentRows, fountains: fountainRows },
      { now, reusedIds: counters.reused },
    ),
    datasets: {
      spaces: FRAICHEUR_SPACES_DATASET,
      equipment: FRAICHEUR_EQUIPMENT_DATASET,
      fountains: FRAICHEUR_FOUNTAIN_DATASET,
    },
    portal: FRAICHEUR_PORTAL,
    source,
    licence: FRAICHEUR_LICENCE,
    licenceUrl: FRAICHEUR_LICENCE_URL,
    publishers: FRAICHEUR_PUBLISHERS,
  };
}

/**
 * How many published identifiers are used more than once, and how many rows
 * carry none at all.
 * @param {Array<{ref:?string}>} rows
 * @returns {{values:number, rows:number, missing:number}}
 */
export function countRefReuse(rows) {
  const tally = new Map();
  let missing = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.ref) { missing += 1; continue; }
    tally.set(row.ref, (tally.get(row.ref) || 0) + 1);
  }
  let values = 0;
  let affected = 0;
  for (const count of tally.values()) {
    if (count > 1) { values += 1; affected += count; }
  }
  return { values, rows: affected, missing };
}

/**
 * A GeoJSON Point's `[lon, lat]`, rounded, or null.
 *
 * Refuses `[0, 0]` and anything off the globe. The register has neither — all
 * 535 equipment rows, all 1 323 fountains and all 219 432 trees carry a real
 * coordinate, measured — but a null island is the one bad coordinate that draws
 * silently and convincingly, in the Gulf of Guinea.
 */
export function readPoint(geometry) {
  if (geometry?.type !== 'Point') return null;
  const lon = finiteOrNull(geometry.coordinates?.[0]);
  const lat = finiteOrNull(geometry.coordinates?.[1]);
  if (lon === null || lat === null) return null;
  if (lon === 0 && lat === 0) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return [round5(lon), round5(lat)];
}

/**
 * Everything the row, the legend and the cards need, counted once.
 *
 * @param {{spaces:Array, equipment:Array, fountains:Array}} rows
 * @param {{now?: Date|number, reusedIds?: number}} [options]
 * @returns {object}
 */
export function summarizeFraicheurRefuges(rows, { now = Date.now(), reusedIds = 0 } = {}) {
  const spaces = Array.isArray(rows?.spaces) ? rows.spaces : [];
  const equipment = Array.isArray(rows?.equipment) ? rows.equipment : [];
  const fountains = Array.isArray(rows?.fountains) ? rows.fountains : [];
  const clock = parisClock(now);

  const canopyBands = new Map(FRAICHEUR_CANOPY_BAND_IDS.map((id) => [id, 0]));
  let canicule = 0;
  let caniculeWithoutCanopy = 0;
  let open24 = 0;
  let nocturne = 0;
  let canopyM2 = 0;
  let canopyM2Missing = 0;
  let spacesExpired = 0;
  let spacesReadable = 0;
  let spacesOpenNow = 0;
  let spacesUnknownNow = 0;
  let flagTimetableDisagree = 0;

  for (const space of spaces) {
    canopyBands.set(space.band, (canopyBands.get(space.band) || 0) + 1);
    if (space.canicule === true) {
      canicule += 1;
      if (space.canopy === 0) caniculeWithoutCanopy += 1;
    }
    if (space.open24 === true) open24 += 1;
    if (space.nocturne === true) nocturne += 1;
    if (space.canopyM2 === null) canopyM2Missing += 1;
    else canopyM2 += space.canopyM2;
    if (scheduleValidity(space.schedule?.periode, now).expired) spacesExpired += 1;
    const readable = scheduleIsReadable(space.schedule);
    if (readable) spacesReadable += 1;
    const state = openStateAt(space.schedule, clock, { always: space.open24 === true });
    if (state.state === 'open') spacesOpenNow += 1;
    else if (state.state === 'unknown') spacesUnknownNow += 1;
    // The `ouvert_24h` flag against the seven strings. Counted, not resolved.
    const allDay = space.schedule?.days?.length === 7
      && space.schedule.days.every((day) => {
        const intervals = parseOpeningDay(day);
        return intervals?.length === 1 && intervals[0][0] === 0
          && intervals[0][1] === FRAICHEUR_END_OF_DAY_MIN;
      });
    if ((space.open24 === true) !== Boolean(allDay)) flagTimetableDisagree += 1;
  }

  const families = new Map(FRAICHEUR_FAMILIES.map((id) => [id, 0]));
  let equipmentReadable = 0;
  let equipmentOpenNow = 0;
  let equipmentUnknownNow = 0;
  let equipmentExpired = 0;
  let paying = 0;
  for (const site of equipment) {
    families.set(site.family, (families.get(site.family) || 0) + 1);
    if (site.paying === true) paying += 1;
    const readable = scheduleIsReadable(site.schedule);
    if (readable) {
      equipmentReadable += 1;
      if (scheduleValidity(site.schedule?.periode, now).expired) equipmentExpired += 1;
    }
    const state = openStateAt(site.schedule, clock);
    if (state.state === 'open') equipmentOpenNow += 1;
    else if (state.state === 'unknown') equipmentUnknownNow += 1;
  }

  let fountainsAvailable = 0;
  let fountainsOut = 0;
  let fountainsStaleOutage = 0;
  let misting = 0;
  let fountainsOutsideParis = 0;
  const nowAt = now instanceof Date ? now.getTime() : Number(now);
  for (const fountain of fountains) {
    if (fountain.available === true) fountainsAvailable += 1;
    else if (fountain.available === false) {
      fountainsOut += 1;
      const until = fountain.to ? Date.parse(fountain.to) : NaN;
      // An outage whose own end date has passed while `dispo` still says NON.
      if (Number.isFinite(until) && until < nowAt) fountainsStaleOutage += 1;
    }
    if (fountain.misting) misting += 1;
    if (fountain.commune && !/^PARIS /.test(fountain.commune)) fountainsOutsideParis += 1;
  }

  return {
    spaces: spaces.length,
    equipment: equipment.length,
    fountains: fountains.length,
    canopyBands: [...FRAICHEUR_CANOPY_BANDS, FRAICHEUR_CANOPY_UNKNOWN].map((band) => ({
      id: band.id,
      label: band.label,
      color: band.color,
      blurb: band.blurb,
      count: canopyBands.get(band.id) || 0,
    })),
    families: FRAICHEUR_FAMILIES.map((id) => ({
      id,
      label: FRAICHEUR_FAMILY_LABELS[id],
      blurb: FRAICHEUR_FAMILY_BLURBS[id],
      count: families.get(id) || 0,
    })),
    canicule,
    caniculeWithoutCanopy,
    open24,
    nocturne,
    canopyM2: Math.round(canopyM2),
    canopyM2Missing,
    spacesExpired,
    spacesReadable,
    spacesOpenNow,
    spacesUnknownNow,
    flagTimetableDisagree,
    equipmentReadable,
    equipmentOpenNow,
    equipmentUnknownNow,
    equipmentExpired,
    paying,
    fountainsAvailable,
    fountainsOut,
    fountainsStaleOutage,
    misting,
    fountainsOutsideParis,
    reusedIds,
    clock,
  };
}

// --- Card copy --------------------------------------------------------------

/** French thousands separator, matching the rest of the French packs. */
function fr(value) {
  return Number(value).toLocaleString('fr-FR');
}

/** `4 231 m²`, hectares once a park stops being a square. */
export function formatAreaM2(value) {
  const m2 = finiteOrNull(value);
  if (m2 === null) return null;
  if (m2 >= 10000) return `${(m2 / 10000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ha`;
  return `${Math.round(m2).toLocaleString('fr-FR')} m²`;
}

/** `32 %`, from a 0–1 share. */
export function formatShare(value) {
  const share = finiteOrNull(value);
  if (share === null) return null;
  return `${(share * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
}

/**
 * The opening line: what the clock says, and how much that is worth.
 *
 * `unknown` never prints as "fermé". And a timetable read out of an expired
 * window carries the window on the SAME line as the answer, not in a footnote,
 * because 682 of 984 green spaces are in that state and a reader who skips one
 * footnote skips the whole caveat.
 * @param {{schedule:object, open24?: ?boolean}} entry
 * @param {{dow:number, minutes:number, day:string}} clock
 * @param {Date|number} [now]
 * @returns {string[]}
 */
export function openingLines(entry, clock, now = Date.now()) {
  const lines = [];
  const validity = scheduleValidity(entry?.schedule?.periode, now);
  const state = openStateAt(entry?.schedule, clock, { always: entry?.open24 === true });

  if (entry?.open24 === true) {
    lines.push('Ouvert 24 h/24 selon le registre');
  } else if (state.state === 'open') {
    const [, close] = state.interval || [];
    lines.push(`Ouvert maintenant — ferme à ${formatMinuteOfDay(close)}`);
  } else if (state.state === 'closed') {
    if (state.opensAt !== null && state.opensDay !== null) {
      const when = state.opensDay === clock.dow
        ? `à ${formatMinuteOfDay(state.opensAt)}`
        : `${FRAICHEUR_DAY_LABELS[state.opensDay]} à ${formatMinuteOfDay(state.opensAt)}`;
      lines.push(`Fermé maintenant — ouvre ${when}`);
    } else {
      lines.push('Fermé maintenant');
    }
  } else {
    lines.push('Aucun horaire hebdomadaire publié');
  }

  if (validity.kind === 'window') {
    lines.push(validity.expired
      ? `⚠ Horaires publiés pour ${validity.text} — période expirée`
      : `Horaires valables ${validity.text}`);
  } else if (validity.kind === 'open-ended') {
    lines.push(`Horaires ${validity.text}`);
  } else if (validity.kind === 'prose') {
    lines.push(validity.text);
  }
  return lines;
}

/**
 * The card for one green space.
 *
 * Ordered as an answer to "can I go there and will it help": what it is, is it
 * open, how much shade it has, and — last — how the two published vegetation
 * numbers disagree, which is the thing a reader would otherwise take one of on
 * trust.
 * @param {object} space
 * @param {{dow:number, minutes:number, day:string}} clock
 * @param {Date|number} [now]
 * @returns {{title:string, details:string[]}}
 */
export function spaceCardLines(space, clock, now = Date.now()) {
  const details = [];
  const kind = [space?.type, space?.category].filter(Boolean);
  if (kind.length) details.push(kind.join(' · '));

  details.push(...openingLines(space, clock, now));

  if (space?.canicule === true) {
    details.push(space.canopy === 0
      ? '🔥 Ouverture canicule déclarée — mais 0 % de canopée mesurée ici'
      : '🔥 Ouverture canicule déclarée');
  }
  if (space?.nocturne === true) details.push('Ouverture estivale nocturne');

  if (space?.canopy === null || space?.canopy === undefined) {
    details.push('Canopée > 8 m non mesurée au relevé 2024');
  } else {
    const area = formatAreaM2(space.canopyM2);
    details.push(area
      ? `Canopée > 8 m : ${formatShare(space.canopy)} du sol — ${area} (relevé 2024)`
      : `Canopée > 8 m : ${formatShare(space.canopy)} du sol — surface non publiée (relevé 2024)`);
  }
  // Both numbers, never one, and never an average — they disagree on 903 of
  // the 953 rows that carry both.
  if (space?.vegHigh !== null && space?.vegHigh !== undefined
    && space?.canopy !== null && space?.canopy !== undefined
    && Math.abs(space.vegHigh - space.canopy) > 1e-9) {
    details.push(`Le registre annonce aussi ${formatShare(space.vegHigh)} de « végétation haute » — un autre chiffre, pas une correction`);
  }

  const where = [space?.address, space?.arrondissement].filter(Boolean).join(' · ');
  if (where) details.push(where);
  if (space?.ref) details.push(`Identifiant ${space.ref}`);

  return { title: space?.name || 'Espace vert frais', details };
}

/**
 * The card for one cool spot.
 * @param {object} site
 * @param {{dow:number, minutes:number, day:string}} clock
 * @param {Date|number} [now]
 * @returns {{title:string, details:string[]}}
 */
export function equipmentCardLines(site, clock, now = Date.now()) {
  const details = [];
  const head = [site?.type || FRAICHEUR_FAMILY_LABELS[site?.family]];
  if (site?.paying === true) head.push('payant');
  else if (site?.paying === false) head.push('gratuit');
  details.push(head.filter(Boolean).join(' · '));

  details.push(...openingLines(site, clock, now));

  // `statut_ouverture` is null on 508 of the 535 rows, so it is printed only
  // when it says something — and "Eteint" on a mister is worth a line.
  if (site?.status) details.push(`Statut publié : ${site.status}`);

  const where = [site?.address, site?.arrondissement].filter(Boolean).join(' · ');
  if (where) details.push(where);
  if (site?.ref) details.push(`Identifiant ${site.ref}`);
  return { title: site?.name || FRAICHEUR_FAMILY_LABELS[site?.family] || 'Îlot de fraîcheur', details };
}

/**
 * The card for one fountain.
 *
 * The outage window is on the card because `dispo` alone is misleading in both
 * directions: 75 of the 85 unavailable fountains are inside a stated window
 * that has not ended, and **10 are outside one that has** — the tap may well be
 * running and the flag has not caught up.
 * @param {object} fountain
 * @param {Date|number} [now]
 * @returns {{title:string, details:string[]}}
 */
export function fountainCardLines(fountain, now = Date.now()) {
  const details = [];
  if (fountain?.model) details.push(`Modèle ${fountain.model}`);
  if (fountain?.misting) details.push('Modèle brumisant');

  const at = now instanceof Date ? now.getTime() : Number(now);
  if (fountain?.available === true) details.push('En service');
  else if (fountain?.available === false) {
    const until = fountain.to ? Date.parse(fountain.to) : NaN;
    const stale = Number.isFinite(until) && until < at;
    details.push(stale
      ? '⚠ Signalée hors service, mais la fin d’indisponibilité publiée est déjà passée'
      : 'Hors service');
    if (fountain.reason) details.push(`Motif : ${fountain.reason}`);
    const window = [fountain.from, fountain.to].filter(Boolean).map((value) => value.slice(0, 10));
    if (window.length === 2) details.push(`Indisponible du ${window[0]} au ${window[1]}`);
    else if (window.length === 1) details.push(`Indisponible depuis le ${window[0]}`);
  } else {
    details.push('Disponibilité non publiée');
  }

  const where = [fountain?.street, fountain?.commune].filter(Boolean).join(' · ');
  if (where) details.push(where);
  details.push('Source : Eau de Paris');
  return { title: fraicheurFountainLabel(fountain?.kind), details };
}

/**
 * The one line under the layer's toggle.
 *
 * It leads with the clock, because that is the question this layer answers, and
 * it always names the size of what it cannot answer.
 * @param {object} state
 * @returns {?string}
 */
export function fraicheurLoadingLabel({
  status, summary, drawn, trees, treeStatus, treeTotal,
} = {}) {
  if (status === 'loading') return 'lecture des trois registres parisiens…';
  if (status === 'off-coverage') return 'Hors Paris — cette couche ne décrit que la Ville de Paris et ses bois';
  if (status === 'empty') return 'Aucun îlot de fraîcheur dans cette vue';
  if (!summary) return null;

  const parts = [];
  const open = summary.spacesOpenNow + summary.equipmentOpenNow;
  const unknown = summary.spacesUnknownNow + summary.equipmentUnknownNow;
  parts.push(`${fr(open)} ouverts à ${summary.clock.hhmm} (heure de Paris)`);
  if (unknown > 0) parts.push(`${fr(unknown)} sans horaire lisible`);
  if (summary.spacesExpired > 0) parts.push(`${fr(summary.spacesExpired)} horaires expirés`);
  if (Number.isFinite(drawn)) parts.push(`${fr(drawn)} objets tracés`);
  if (treeStatus === 'too-high') parts.push('arbres : descends pour les charger');
  else if (treeStatus === 'too-dense' && Number.isFinite(treeTotal)) {
    parts.push(`${fr(treeTotal)} arbres ici — zoome`);
  } else if (Number.isFinite(trees) && trees > 0) parts.push(`${fr(trees)} arbres`);
  return parts.join(' · ');
}
