import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { parseDepartements } from './meteoFranceVigilance.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { buildDepartementIndex } from './franceDepartements.js';
import { ringAnchor } from './communeContours.js';
import {
  CELL_PUBLISHED,
  CELL_SUPPRESSED,
  CELL_ZERO,
  DELINQUANCE_ATTRIBUTION,
  DELINQUANCE_CELL_LABELS,
  DELINQUANCE_COMMUNE_CELL_SLUGS,
  DELINQUANCE_COMMUNE_SLUGS,
  DELINQUANCE_COMPLEMENT_RULE,
  DELINQUANCE_DOCUMENTATION_TITLE,
  DELINQUANCE_PLAINTE_RULE,
  DELINQUANCE_SOURCE,
  DELINQUANCE_SUPPRESSION_RULE,
  DELINQUANCE_TOTAL_COMMUNE_SLUGS,
  DELINQUANCE_TOTAL_DEPARTEMENT_SLUGS,
  DELINQUANCE_TOTAL_EXCLUDED,
  DELINQUANCE_TOTAL_SLUG,
  DELINQUANCE_ZERO_RULE,
  delinquanceIndicatorNote,
  delinquanceRateUnit,
  indicatorForSlug,
} from './delinquanceFeed.js';
import {
  DELINQUANCE_DEPARTEMENT_BINS,
  delinquanceRateBin,
  departementsInBox,
  locateDelinquanceDepartement,
  projectDelinquanceNational,
} from './delinquanceDepartements.js';

/**
 * Recorded delinquency in France, drawn with the publisher's own caution.
 *
 * THIS IS NOT A MAP OF CRIME. It is a map of what police and gendarmerie
 * REGISTERED. A commune's number moves when its residents report more, when a
 * brigade opens, when a service changes how it records — and, for a whole
 * family of indicators, when the police go looking. `Usage de stupéfiants` is
 * counted in `Mis en cause`: people who were stopped. Drawing that as a
 * property of a place is drawing policing and labelling it crime, so the
 * sentence is on the card, on the legend, in DATA_SOURCES and here.
 *
 * A CHOROPLETH OF THIS DATA WITH NO CAVEAT IS A DEFAMATION MACHINE POINTED AT
 * WHOLE COMMUNES. Everything below exists to stop that.
 *
 * ── The three states, and why the third one is the whole layer ──────────────
 * The SSMSI suppresses small counts. Its rule, verbatim from the methodology
 * PDF: *« Les données diffusées sont limitées aux communes pour lesquelles
 * plus de 5 faits ont été enregistrés pendant 3 années successives »*, with the
 * other half — *« La base de données diffusée fournit également l'information
 * sur l'absence de faits enregistrés lorsqu'elle se reproduit sur 3 années
 * successives »* — meaning a published `0` is a real, deliberate zero. So
 * every cell is exactly one of three things and each gets its own visual:
 *
 *   PUBLIÉ       a measured rate — the six-band warm ramp.
 *   AUCUN FAIT   `diff` with 0 — the palest cool wash. Measured absence.
 *   NON DIFFUSÉ  `ndiff` — SLATE, at a heavier alpha, with a wider brighter
 *                outline. It is not the bottom of the ramp and it is not the
 *                zero wash; it is off the scale entirely, in a hue the ramp
 *                never reaches, because the honest statement is "this is
 *                withheld", not "this is low".
 *
 * Measured on the 2025 edition, 523 800 commune cells: 49 879 published
 * (9.52%), 222 776 zero (42.5%), **251 145 suppressed (47.9%)**. 25 314 of the
 * 34 920 communes — 72.5% — carry not one positive published value, and 7 have
 * all fifteen indicators suppressed. Nearly half of this map is a refusal, and
 * the layer is built so a reader sees the refusal rather than a colour.
 *
 * ── THE PARAPHRASE THIS FILE USED TO PRINT, AND WHY IT WAS WRONG ───────────
 * An earlier revision of this layer put « entre 1 et 5 faits » on the card of
 * every withheld commune. That is not the rule and the register refutes it.
 * The rule is a THREE-YEAR condition on the series, so a commune that fails it
 * can carry any number at all. Re-measured against the live 2026-07-09 edition
 * on 2026-09-02:
 *   - **4 735 of the 251 145 suppressed 2025 cells** belong to a (commune,
 *     indicateur) pair that published MORE than 5 facts in 2023 or 2024. Cessy
 *     (01071) published 16 `Vols de véhicule` in 2023, then went dark.
 *   - **36 (département, indicateur) pairs carry a withheld-commune mean above
 *     5.** Seine-Saint-Denis / `Usage de stupéfiants (AFD)` averages 22.33.
 * Every surface now prints {@link delinquanceCaveat}'s verbatim quotation of
 * the SSMSI's own sentence instead. A paraphrase of a suppression rule is a
 * claim about the values being suppressed, and this one was a false one.
 *
 * ── What a suppressed commune's card is allowed to say ─────────────────────
 * The `ndiff` rows are not empty: they carry `complement_info_*`, which the PDF
 * defines as *« Valeur moyenne parmi les communes du département sous secret
 * statistique »*. Measured on 2025, grouping every suppressed row on
 * (département, indicateur): **1 470 of 1 472 pairs carry exactly one distinct
 * value.** It is a departmental constant. So it is fetched ONCE PER
 * DÉPARTEMENT, never per commune, it never touches a fill, and the card prints
 * it under the label "moyenne des communes non diffusées du département" — the
 * publisher's own words, not this commune's number.
 *
 * ── And why the withheld value can never be reconstructed ──────────────────
 * Paris publishes 75056 and its 20 arrondissements. Measured for 2025: for 14
 * of 15 indicators the arrondissements sum EXACTLY to the commune. For `Vols
 * avec armes` the commune says 393 and the arrondissements sum to 375, because
 * 4 are suppressed — and the register suppressed extra cells precisely so the
 * 18-fact residual could not be pinned on one of them. Subtracting is
 * re-identification, not recovery, and nothing here does it.
 *
 * ── Two regimes, on the two geographies the register actually publishes ────
 *   départements — the default. 96 metropolitan polygons, filled by
 *                  `taux_pour_mille` for the selected indicator and year.
 *                  There is NO suppression at this grain (the DEP base has no
 *                  `est_diffuse` column at all: 17 711 positive cells, 469
 *                  zeros, 0 nulls), so the third band never lights up here —
 *                  and that difference between the zoom levels IS the point.
 *   communes      — below {@link COMMUNE_ENTER_SPAN_DEG}. Commune outlines
 *                  from geo.api.gouv.fr for the départements in view, filled
 *                  by the three states. This is where the refusal becomes
 *                  visible: at national zoom the map looks complete, and one
 *                  zoom later half of it is slate.
 *
 * ── Why the rate and not the count ─────────────────────────────────────────
 * `delinquanceDepartements.js` carries the measurement: by count the 2025
 * cambriolages leaders are Bouches-du-Rhône, Nord, Rhône and Paris — a list of
 * big départements; by rate the leaders are Guyane, **Cher**, Ain and Isère,
 * and the Nord drops from 2nd to 17th. And the rate's denominator is not
 * uniform: `Cambriolages de logement` is per 1 000 DWELLINGS, the other
 * fourteen per 1 000 inhabitants, verified on 45 386 of 45 386 non-cambriolage
 * cells against 0 of 4 493 cambriolage ones. Every card and every legend row
 * states its own denominator.
 *
 * ── The TOTAL, which this layer used to refuse to compute ──────────────────
 * An earlier revision of this header said the layer "never sums two
 * indicators", because their `unité de compte` differs — Victime, Victime
 * entendue, Infraction, Véhicule, Mis en cause — and a total adds victims to
 * vehicles. That objection is real and it has not gone away. What changed is
 * the alternative: refusing to total meant every reader had to pick one
 * offence before seeing anything at all, which is its own distortion — it
 * makes the map answer "where are burglaries" when the question was "where is
 * this register busy".
 *
 * So the total exists, under three conditions that keep it honest:
 *   1. it is labelled a CALCULATED total, GEV's arithmetic and not the
 *      SSMSI's — the register publishes eighteen indicators and no total;
 *   2. it names its own mixed unit on the card rather than calling itself
 *      "faits", and it drops the two `Usage de stupéfiants` sub-indicators,
 *      which are a decomposition of a third (measured: parent = AFD + hors
 *      AFD in 101 départements of 101, exactly), so nothing is counted twice;
 *   3. at commune grain it is a MINORANT wherever the register withholds a
 *      contributor, and the card says how many. Measured on 2025: of the
 *      34 920 communes, 9 606 carry a positive total — **9 428 of those are
 *      minorants and only 178 are complete** — 243 are a complete measured
 *      zero, and 25 071 publish nothing at all and are drawn slate.
 * At département grain there is no suppression, so the total is exact: 3 306
 * 254 facts over 68 350 798 inhabitants nationally, from 24.4 ‰ in the Cantal
 * to 109.9 ‰ in Paris.
 *
 * Two commune outliers are worth knowing before reading the commune map:
 * **Roissy-en-France (95527) tops it at 1 512 ‰** — 4 045 facts over 2 674
 * residents — and Paris 1er at 578 ‰. Neither is a dangerous village; both are
 * places whose population at risk is an airport and a museum, not their
 * residents. The denominator is the resident population for every indicator on
 * this layer, and the total makes that limit louder rather than new.
 *
 * ── Six chips out of eighteen, chosen by the data and not by hand ──────────
 * The panel row cannot carry eighteen indicators. Hand-picking six would be a
 * claim about which offences matter; instead the chip set is derived at build
 * time as the indicators with the most communes carrying a published positive
 * value — the maps with the most ground that can honestly be coloured. On the
 * 2025 edition that is escroqueries (8 134 communes), dégradations (7 350),
 * vols sans violence (5 181), violences intrafamiliales (4 682), cambriolages
 * (4 493) and violences hors famille (3 224). All fifteen commune-grain
 * indicators — and all eighteen at département grain — stay readable on a
 * clicked card; only six can be painted, and that is a stated limit.
 *
 * ── The palette, against the neighbours it will be stacked on ──────────────
 * Warm sequential gold → crimson for the published ramp. It is deliberately
 * NOT the Vigilance green→red (that ramp means "danger forecast", and this one
 * must never be read as a warning), not the IRVE blue→red power ramp, not the
 * sup-fr violet and not the schools-fr green. The slate of the suppressed band
 * sits outside the ramp's hue range entirely, so no amount of squinting turns
 * "withheld" into "a bit less than the palest gold".
 *
 * @module data/delinquanceFrance
 */

export const DELINQUANCE_FR_LAYER_ID = 'delinquance-fr';

export const DELINQUANCE_FR_OVERLAY_SOURCE_ID = 'delinquance-fr-selected';
export const DELINQUANCE_FR_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});
export const DELINQUANCE_FR_LABEL_SOURCE_ID = 'delinquance-fr-departements';
export const DELINQUANCE_FR_LABEL_COHORT_LIMIT = 14;
export const DELINQUANCE_FR_LABEL_COLLISION_CAPACITY = 12;

const DEPARTEMENTS_URL = new URL(
  './local_data/france_departements/departements.geojson',
  import.meta.url,
).href;

// --- Activation ------------------------------------------------------------
/**
 * View LATITUDE span (degrees) at or below which the commune regime is entered.
 *
 * 0.75° is about 83 km of France, which is a city and the country around it —
 * the scale at which "is this commune's cell published?" is a question a
 * reader can act on. It is NOT the 9.5° the point layers use to leave their
 * national view, and the reason is payload: a 9.5° box touches most of France,
 * and the contour packs are per-département. Measured on the real contours,
 * the biggest département in France (Pas-de-Calais, 887 communes) is 872 494
 * bytes of wire JSON — 276 537 gzipped — after decimation. Six of those is
 * already a heavy view; sixty would be a download.
 *
 * The exit threshold is higher than the entry one so a camera resting on the
 * boundary does not swap the whole map back and forth on sub-pixel drift.
 */
export const COMMUNE_ENTER_SPAN_DEG = 0.75;
export const COMMUNE_EXIT_SPAN_DEG = 1.1;
/** Contour packs one view may ask for. See the byte measurement above. */
export const COMMUNE_MAX_PACKS = 6;
/** Packs kept in the browser between views, LRU. */
export const COMMUNE_PACK_CACHE = 8;

const CAMERA_DEBOUNCE_MS = 450;
/**
 * Poll cadence (ms). Six hours, and even that is generous: `frequency` on the
 * dataset is `annual` and the bases are rebuilt each July. The camera, not the
 * clock, drives this layer.
 */
const POLL_INTERVAL_MS = 6 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 120_000;

// --- Presentation ----------------------------------------------------------
/**
 * The published ramp, low to high. Warm sequential — see the module header for
 * why it is not any of the four ramps already on this globe.
 */
export const DELINQUANCE_RAMP = Object.freeze([
  '#ffe08a', '#ffb648', '#f97316', '#e03131', '#b02020', '#6d1414',
]);
/** Fill alpha per band — weight as well as hue. */
const RAMP_ALPHA = Object.freeze([0.30, 0.35, 0.41, 0.47, 0.54, 0.62]);
/**
 * `diff` with a count of zero: measured absence. A cool near-white wash, the
 * lightest thing on the map, because "nothing was recorded here, three years
 * running" should read as quiet rather than as a value.
 */
export const DELINQUANCE_ZERO_COLOR = '#dfe9f0';
const ZERO_ALPHA = 0.16;
/**
 * `ndiff`: withheld. Slate — off the warm ramp entirely — at a heavier alpha
 * than the palest published band so it cannot be mistaken for a low value, and
 * with its own wider, brighter outline so the eye finds the withheld cells
 * first.
 */
export const DELINQUANCE_SUPPRESSED_COLOR = '#5c6b8a';
const SUPPRESSED_ALPHA = 0.52;
/** A commune with a contour but no row at all in this edition. */
export const DELINQUANCE_MISSING_COLOR = '#2b2f36';

const OUTLINE_COLOR = '#0b0e12';
const OUTLINE_ALPHA = 0.35;
const OUTLINE_WIDTH_PX = 1.0;
const SUPPRESSED_OUTLINE_COLOR = '#aebbd6';
const SUPPRESSED_OUTLINE_ALPHA = 0.75;
const SUPPRESSED_OUTLINE_WIDTH_PX = 2.0;
const SELECTED_COLOR = '#00ffff';

/**
 * The three states mean something different under the computed total, so the
 * legend says something different. `published` in particular stops meaning
 * "measured" and starts meaning "measured floor", which is the whole reason
 * these three strings are not a reuse of the ones below.
 */
const TOTAL_STATE_BLURBS = Object.freeze({
  published: 'Somme des indicateurs DIFFUSÉS pour cette maille — total calculé par God’s Eye '
    + 'View, pas publié par le SSMSI. Dès qu’un indicateur y est non diffusé, c’est un MINORANT : '
    + 'le vrai total est plus élevé, d’un montant inconnu. Unités mélangées (victimes, '
    + 'infractions, véhicules, mis en cause).',
  zero: 'Aucun fait enregistré sur AUCUN des indicateurs, et aucun n’est non diffusé. Un zéro '
    + 'complet et mesuré — 243 communes sur 34 920 en 2025.',
  suppressed: 'Rien de publié et au moins un indicateur retenu au titre du secret statistique : '
    + 'il n’y a pas de total honnête à afficher. Ce n’est ni zéro, ni « peu » — c’est inconnu.',
});

/** One-line explanations behind each legend swatch. */
const STATE_BLURBS = Object.freeze({
  published: 'Taux publié par le SSMSI. C’est de la délinquance ENREGISTRÉE : ce que la police et '
    + 'la gendarmerie ont consigné, pas ce qui s’est produit.',
  zero: `Aucun fait enregistré. ${DELINQUANCE_ZERO_RULE} — c’est une valeur publiée, pas un trou.`,
  // The rule, word for word, because the paraphrase this row used to carry
  // ("entre 1 et 5 faits") is refuted by the register itself: 4 735 of the
  // 251 145 suppressed 2025 cells published more than 5 facts in 2023 or 2024.
  suppressed: `Non diffusé, au titre du secret statistique. ${DELINQUANCE_SUPPRESSION_RULE} `
    + 'Le critère porte sur trois années, pas sur la valeur affichée : ce n’est NI zéro, NI '
    + 'forcément une valeur basse — c’est inconnu.',
});

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});
let _overlayHost = DEFAULT_OVERLAY_HOST;

// --- Runtime state ---------------------------------------------------------
let _viewer = null;
let _enabled = false;
let _regime = 'departements';
// The layer OPENS on the computed total: picking an offence before seeing
// anything is a choice a reader should not have to make first. Every chip
// narrows from here.
let _indicator = DELINQUANCE_TOTAL_SLUG;
let _year = null;
let _clickHandler = null;
let _cameraChangedAttached = false;
let _cameraDebounceTimer = null;
let _selectedId = null;
let _count = 0;
let _lastUpdate = null;
let _loading = false;
let _error = null;
let _status = 'idle';

/** `/api/delinquance-fr/departements` payload. */
let _base = null;
let _basePromise = null;
let _national = null;
let _depDataSource = null;
let _depEntities = new Map();
let _depMeta = new Map();
let _depIndex = null;
let _depShapesPromise = null;

/** Commune regime. */
let _packs = new Map();
let _packPromises = new Map();
let _packErrors = new Map();
let _communeRecords = new Map();
let _fills = null;
let _outlines = null;
let _suppressedOutlines = null;
let _visibleDeps = [];
let _classificationType = Cesium.ClassificationType.BOTH;

// --- Formatting ------------------------------------------------------------

function fr(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('fr-FR') : '—';
}

/**
 * A `taux_pour_mille` as a card reads it.
 *
 * Three significant digits down to the thousandth, because homicide rates are
 * of the order of 0.01 per 1 000 and a two-decimal format would print every
 * département as `0.01`.
 */
export function formatDelinquanceRate(rate) {
  // `Number(null)` is 0 and `Number('')` is 0, and this layer is the one place
  // in the repo where that coercion is a safety bug rather than a nuisance: a
  // withheld cell's absent rate would print as « 0,000 pour 1 000 habitants »,
  // which is the exact sentence the three-state model exists to prevent. An
  // explicit nullish test comes first; a real published zero (Ardèche recorded
  // no homicide in 2025) still formats as 0,000, because that one is a claim.
  if (rate === null || rate === undefined || rate === '') return '—';
  const value = Number(rate);
  if (!Number.isFinite(value)) return '—';
  const decimals = value >= 10 ? 1 : (value >= 1 ? 2 : 3);
  return value.toLocaleString('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// --- Colour ----------------------------------------------------------------

function bandIndex(bin) {
  const index = Number(bin);
  if (!Number.isFinite(index) || index < 0) return -1;
  return Math.min(DELINQUANCE_RAMP.length - 1, Math.floor(index));
}

/**
 * The fill for one cell.
 *
 * State FIRST, band second — a suppressed cell never reaches the ramp, whatever
 * else is on it. That ordering is the single most load-bearing branch in this
 * file: inverted, it paints a withheld cell as a value.
 *
 * @param {?number} state CELL_PUBLISHED | CELL_ZERO | CELL_SUPPRESSED | null
 * @param {number} [bin]
 * @returns {{css:string, alpha:number}}
 */
export function delinquanceFill(state, bin = -1) {
  if (state === CELL_SUPPRESSED) {
    return { css: DELINQUANCE_SUPPRESSED_COLOR, alpha: SUPPRESSED_ALPHA };
  }
  if (state === CELL_ZERO) return { css: DELINQUANCE_ZERO_COLOR, alpha: ZERO_ALPHA };
  if (state === CELL_PUBLISHED) {
    const index = bandIndex(bin);
    if (index < 0) return { css: DELINQUANCE_ZERO_COLOR, alpha: ZERO_ALPHA };
    return { css: DELINQUANCE_RAMP[index], alpha: RAMP_ALPHA[index] };
  }
  return { css: DELINQUANCE_MISSING_COLOR, alpha: 0.22 };
}

/**
 * Legend labels for the quantile ramp, built from the measured thresholds and
 * carrying the DENOMINATOR, which changes between indicators.
 * @param {Array<number>} thresholds
 * @param {string} slug
 * @returns {Array<string>}
 */
export function delinquanceBinLabels(thresholds, slug) {
  const bounds = (Array.isArray(thresholds) ? thresholds : []).map(Number).filter(Number.isFinite);
  const labels = [];
  let previous = 0;
  for (const bound of bounds) {
    labels.push(`${formatDelinquanceRate(previous)}–${formatDelinquanceRate(bound)}`);
    previous = bound;
  }
  labels.push(`> ${formatDelinquanceRate(previous)}`);
  const unit = delinquanceRateUnit(slug);
  return labels.map((label) => `${label} / ${unit}`);
}

// --- Camera ----------------------------------------------------------------

/** The view rectangle's latitude span in degrees, Infinity past the limb. */
export function delinquanceViewSpanDeg(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.();
  if (!rectangle) return Infinity;
  const south = Cesium.Math.toDegrees(rectangle.south);
  const north = Cesium.Math.toDegrees(rectangle.north);
  if (!Number.isFinite(south) || !Number.isFinite(north) || north <= south) return Infinity;
  return north - south;
}

/**
 * Which regime a span belongs to, given the one currently on screen.
 *
 * Hysteresis: entering the commune regime needs the tighter span, leaving it
 * needs the looser one, so a camera resting on the boundary does not rebuild
 * the whole map on drift.
 */
export function delinquanceRegimeFor(spanDeg, current = 'departements') {
  const span = Number(spanDeg);
  if (!Number.isFinite(span)) return 'departements';
  if (current === 'communes') return span > COMMUNE_EXIT_SPAN_DEG ? 'departements' : 'communes';
  return span <= COMMUNE_ENTER_SPAN_DEG ? 'communes' : 'departements';
}

/** The camera rectangle as a plain box, padded. */
export function delinquanceViewBox(viewer, padFraction = 0.08) {
  const rectangle = viewer?.camera?.computeViewRectangle?.();
  if (!rectangle) return null;
  const south = Cesium.Math.toDegrees(rectangle.south);
  const north = Cesium.Math.toDegrees(rectangle.north);
  const west = Cesium.Math.toDegrees(rectangle.west);
  const east = Cesium.Math.toDegrees(rectangle.east);
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (west >= east || south >= north) return null;
  const padLat = (north - south) * padFraction;
  const padLon = (east - west) * padFraction;
  return {
    south: south - padLat,
    north: north + padLat,
    west: west - padLon,
    east: east + padLon,
  };
}

// --- Card copy -------------------------------------------------------------

/**
 * The caveat that rides on every card this layer draws.
 *
 * It is not decoration and it is not the same sentence for every indicator:
 * an offence counted in `Mis en cause` is a count of people the police
 * stopped, which is a different kind of claim from a victim's report, and the
 * card says which one the reader is looking at.
 *
 * It QUOTES rather than paraphrases, and that is a correction, not a style
 * choice. This function used to tell a reader that a withheld cell held
 * « entre 1 et 5 faits ». Measured on 2026-09-02 over the real base, that is
 * false for **4 735 of the 251 145 suppressed 2025 cells**, whose own
 * (commune, indicateur) series published MORE than 5 facts in 2023 or 2024 —
 * Cessy (01071) published 16 `Vols de véhicule` in 2023 and is withheld now.
 * The rule is a THREE-YEAR condition on the series, not a ceiling on the
 * displayed year, so the card carries {@link DELINQUANCE_SUPPRESSION_RULE}
 * word for word and lets the reader apply it.
 *
 * The reporting-rate line is the publisher's own too, with the publisher's own
 * two numbers: 12 % of victims of sexual violence outside the household report
 * it, against 74 % of burglary victims. Two indicators of this same layer are
 * therefore not on a comparable scale, and no sentence written here would say
 * that as unarguably as the SSMSI saying it about itself.
 *
 * @param {string} slug
 * @param {{state?:?number}} [options] `CELL_SUPPRESSED` adds the rule verbatim.
 * @returns {string} One or more lines; the caller splits on `\n`.
 */
export function delinquanceCaveat(slug, { state = null } = {}) {
  const meta = indicatorForSlug(slug);
  const lines = [];
  if (slug === DELINQUANCE_TOTAL_SLUG) {
    // The total is the one indicator on this layer that the SSMSI does not
    // publish, so its first line is not about crime — it is about authorship.
    lines.push('⚠ Total CALCULÉ par God’s Eye View, pas publié par le SSMSI : somme des '
      + `${DELINQUANCE_TOTAL_COMMUNE_SLUGS.length} indicateurs communaux `
      + `(${DELINQUANCE_TOTAL_DEPARTEMENT_SLUGS.length} au niveau départemental).`);
    lines.push('Unités mélangées (victimes, infractions, véhicules, mis en cause), taux '
      + 'recalculé sur la population — cambriolages compris, que le SSMSI publie, eux, pour '
      + '1 000 logements.');
    lines.push('« Usage de stupéfiants (AFD) » n’est pas recompté : il est déjà dans « Usage de '
      + 'stupéfiants » (vérifié, 101 départements sur 101).');
  } else if (meta?.unite === 'Mis en cause') {
    lines.push('⚠ Délinquance ENREGISTRÉE, comptée en mis en cause : ce sont des personnes '
      + 'interpellées. Cet indicateur mesure aussi l’activité des services.');
  } else {
    lines.push('⚠ Délinquance ENREGISTRÉE : ce que la police et la gendarmerie ont consigné, '
      + 'pas ce qui s’est produit.');
  }
  lines.push(`SSMSI : ${DELINQUANCE_PLAINTE_RULE}`);
  const note = delinquanceIndicatorNote(slug);
  if (note) lines.push(note);
  if (state === CELL_SUPPRESSED) {
    lines.push(`Règle de diffusion, mot pour mot — ${DELINQUANCE_SUPPRESSION_RULE}`);
    lines.push('Le critère porte sur TROIS ANNÉES, pas sur la valeur de l’année affichée : '
      + '4 735 cellules non diffusées en 2025 avaient publié plus de 5 faits en 2023 ou 2024. '
      + '« Non diffusé » ne veut donc pas dire « peu ».');
  }
  return lines.join('\n');
}

/** Card copy for one département. */
export function buildDelinquanceDepartementLabel(row, context = {}) {
  const slug = context.indicator || _indicator;
  const meta = indicatorForSlug(slug);
  const details = [];
  details.push(`${meta?.label || slug} — ${context.year || _year || '—'}`);
  if (slug === DELINQUANCE_TOTAL_SLUG && row.state === CELL_PUBLISHED) {
    // No `est_diffuse` column exists at this grain, so this total is complete
    // — the one place on this layer where a total is a value and not a floor.
    details.push(`${formatDelinquanceRate(row.rate)} pour 1 000 habitants · ${fr(row.count)} faits, `
      + `victimes et mis en cause cumulés sur ${DELINQUANCE_TOTAL_DEPARTEMENT_SLUGS.length} indicateurs`);
    details.push('Total exact à cette échelle : la base départementale ne connaît pas le secret '
      + 'statistique. C’est en zoomant sur les communes qu’il apparaît.');
  } else if (row.state === CELL_PUBLISHED) {
    details.push(`${formatDelinquanceRate(row.rate)} pour ${delinquanceRateUnit(slug)} · ${fr(row.count)} ${meta?.unite === 'Véhicule' ? 'véhicules' : 'faits'}`);
  } else if (row.state === CELL_ZERO) {
    details.push(DELINQUANCE_CELL_LABELS.zero);
  } else {
    details.push('Aucune ligne pour ce département dans cette édition');
  }
  if (row.pop > 0) details.push(`${fr(row.pop)} habitants · ${fr(row.log)} logements`);
  // The commune census is what turns a solid-looking département into an
  // honest one: it says how much of the finer map underneath is withheld.
  if (row.communes) {
    const total = row.communes.published + row.communes.zero + row.communes.suppressed;
    details.push(`${fr(row.communes.suppressed)} des ${fr(total)} communes non diffusées `
      + `(${((100 * row.communes.suppressed) / Math.max(1, total)).toFixed(0)} %) · `
      + `${fr(row.communes.published)} avec une valeur publiée`);
  }
  details.push(delinquanceCaveat(slug, { state: row.state }));
  details.push(DELINQUANCE_DOCUMENTATION_TITLE);
  return [row.name, ...details].join('\n');
}

/** Card copy for one commune. */
export function buildDelinquanceCommuneLabel(record) {
  const slug = record?.indicator || _indicator;
  const meta = indicatorForSlug(slug);
  const details = [];
  details.push(`${meta?.label || slug} — ${record?.year || '—'}`);
  const cell = record?.cell || null;
  const state = cell?.[0] ?? null;
  const total = slug === DELINQUANCE_TOTAL_SLUG;
  // The fourth slot of a computed total cell: how many of its contributors the
  // register withheld. It is the difference between a value and a floor, so it
  // is the first thing the card says about the number it is about to print.
  const withheld = total ? Number(cell?.[3]) || 0 : 0;
  const contributors = DELINQUANCE_TOTAL_COMMUNE_SLUGS.length;
  if (total && state === CELL_PUBLISHED) {
    details.push(`${formatDelinquanceRate(cell[2])} pour 1 000 habitants · ${fr(cell[1])} faits, `
      + 'victimes et mis en cause cumulés');
    details.push(withheld > 0
      ? `⚠ MINORANT : ${fr(withheld)} des ${contributors} indicateurs sont non diffusés ici, et `
        + 'ne sont donc PAS dans ce total. Le vrai total est plus élevé, d’un montant inconnu.'
      : `Total complet : les ${contributors} indicateurs sont tous diffusés ici — le cas de `
        + '178 communes sur 34 920 dans l’édition 2025.');
  } else if (total && state === CELL_ZERO) {
    details.push(`${DELINQUANCE_CELL_LABELS.zero} pour les ${contributors} indicateurs, et aucun `
      + `n’est non diffusé — ${DELINQUANCE_ZERO_RULE}`);
  } else if (total && state === CELL_SUPPRESSED) {
    details.push('Aucun fait publié, et le registre en retient : rien à totaliser ici');
    details.push(`${fr(withheld)} des ${contributors} indicateurs non diffusés — le total n’est `
      + 'ni zéro ni petit, il est inconnu.');
  } else if (state === CELL_PUBLISHED) {
    details.push(`${formatDelinquanceRate(cell[2])} pour ${delinquanceRateUnit(slug)} · ${fr(cell[1])} faits`);
  } else if (state === CELL_ZERO) {
    details.push(`${DELINQUANCE_CELL_LABELS.zero} (0 fait, publié comme tel) — ${DELINQUANCE_ZERO_RULE}`);
  } else if (state === CELL_SUPPRESSED) {
    details.push(`${DELINQUANCE_CELL_LABELS.suppressed}`);
    const mean = record?.mean || null;
    if (mean && Number.isFinite(mean.rate)) {
      // The publisher's own words for this column, quoted. It is a
      // DÉPARTEMENTAL average over every withheld commune, not this commune's
      // value, and the label has to make that impossible to misread.
      details.push(`Repère : ${formatDelinquanceRate(mean.rate)} pour ${delinquanceRateUnit(slug)} — `
        + `${DELINQUANCE_COMPLEMENT_RULE}, pas la valeur de cette commune`
        + (mean.variants > 1 ? ' (deux moyennes coexistent ici : communes et arrondissements)' : ''));
    }
  } else {
    details.push('Aucune ligne pour cette commune dans cette édition');
  }
  if (record?.pop === 0) {
    details.push('⚠ Population municipale nulle — aucun taux pour 1 000 habitants n’est calculable ici');
  } else if (record?.pop > 0) {
    details.push(`${fr(record.pop)} habitants${record.log > 0 ? ` · ${fr(record.log)} logements` : ''}`);
  }
  // Every other indicator for this commune, states included, so the reader is
  // never stuck with the six that happen to be paintable.
  const others = [];
  for (let i = 0; i < DELINQUANCE_COMMUNE_SLUGS.length; i += 1) {
    const other = DELINQUANCE_COMMUNE_SLUGS[i];
    if (other === slug) continue;
    const value = record?.cells?.[i];
    if (!value) continue;
    // Under the total, the two lines that would double-count are marked rather
    // than hidden: a reader adding the list up by hand must be able to see why
    // it does not reconcile with the number above it.
    const excluded = total && DELINQUANCE_TOTAL_EXCLUDED.includes(other) ? ' (hors total)' : '';
    const short = `${indicatorForSlug(other)?.short || other}${excluded}`;
    if (value[0] === CELL_PUBLISHED) others.push(`${short} ${fr(value[1])}`);
    else if (value[0] === CELL_SUPPRESSED) others.push(`${short} ✕`);
  }
  if (others.length) details.push(others.join(' · '));
  if (record?.simplified) {
    details.push('Contour simplifié pour l’affichage — ce n’est pas une limite administrative');
  }
  details.push(delinquanceCaveat(slug, { state }));
  details.push(DELINQUANCE_DOCUMENTATION_TITLE);
  return [record?.name || record?.code || 'Commune', ...details].join('\n');
}

function selectedOverlayEntry(id, position, copy) {
  const [title, ...details] = copy.split('\n');
  return {
    id: String(id),
    position,
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
  };
}

/** Ambient label for one département at national altitude. */
export function createDelinquanceDepartementOverlayEntry(row, position) {
  const value = row.state === CELL_PUBLISHED ? formatDelinquanceRate(row.rate) : '—';
  return {
    id: `delinquance-fr:dep:${row.code}`,
    position,
    variant: 'label',
    title: `${row.name} · ${value}`,
    accent: delinquanceFill(row.state, row.bin).css,
    priority: Number(row.rate) || 0,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Keep the highest-rate départements, with stable identity as tie-break. */
export function selectDelinquanceLabelCohort(entries, limit = DELINQUANCE_FR_LABEL_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(DELINQUANCE_FR_LABEL_COHORT_LIMIT, Math.floor(Number(limit) || 0)));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice()
    .sort((a, b) => b.priority - a.priority || String(a.id).localeCompare(String(b.id)))
    .slice(0, cap);
}

// --- Selection --------------------------------------------------------------

function clearSelection() {
  _selectedId = null;
  _overlayHost.clearSource(DELINQUANCE_FR_OVERLAY_SOURCE_ID);
}

function selectDepartement(code) {
  const row = _national?.departements?.find((entry) => entry.code === code);
  if (!row) return;
  const anchor = _depMeta.get(code)?.anchor;
  if (!anchor) return;
  _selectedId = `dep:${code}`;
  _overlayHost.setEntries(DELINQUANCE_FR_OVERLAY_SOURCE_ID, [selectedOverlayEntry(
    _selectedId,
    _viewer ? Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1]) : { anchor },
    buildDelinquanceDepartementLabel(row, { indicator: _indicator, year: _year }),
  )], DELINQUANCE_FR_OVERLAY_SOURCE_OPTIONS);
}

function selectCommune(id) {
  const record = _communeRecords.get(id);
  if (!record?.anchor) return;
  _selectedId = id;
  _overlayHost.setEntries(DELINQUANCE_FR_OVERLAY_SOURCE_ID, [selectedOverlayEntry(
    id,
    _viewer ? Cesium.Cartesian3.fromDegrees(record.anchor[0], record.anchor[1]) : { anchor: record.anchor },
    buildDelinquanceCommuneLabel(record),
  )], DELINQUANCE_FR_OVERLAY_SOURCE_OPTIONS);
}

function onKeyDown(event) {
  if (event.key === 'Escape') clearSelection();
}

function pickedDepartementCode(picked) {
  const code = picked?.id?.properties?.code?.getValue?.();
  return code ? String(code).trim() : null;
}

function installClickHandler(viewer) {
  if (_clickHandler || !viewer?.scene) return;
  _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _clickHandler.setInputAction((movement) => {
    const picked = viewer.scene.pick(movement.position);
    if (!picked) {
      clearSelection();
      return;
    }
    if (typeof picked.id === 'string' && _communeRecords.has(picked.id)) {
      selectCommune(picked.id);
      return;
    }
    const code = pickedDepartementCode(picked);
    if (code && _national) {
      selectDepartement(code);
      return;
    }
    clearSelection();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  document.addEventListener('keydown', onKeyDown);
}

// --- Département regime -----------------------------------------------------

async function ensureDepartementShapes() {
  if (_depShapesPromise) return _depShapesPromise;
  _depShapesPromise = (async () => {
    const geojson = await (await fetch(DEPARTEMENTS_URL)).json();
    _depMeta = parseDepartements(geojson);
    // The SAME bundle, indexed twice on purpose: `parseDepartements` gives the
    // label anchors, `buildDepartementIndex` gives the point-in-polygon tree
    // that answers which département the camera is over. Neither can do the
    // other's job.
    _depIndex = buildDepartementIndex(geojson);
    const source = await Cesium.GeoJsonDataSource.load(geojson, {
      clampToGround: true,
      fill: Cesium.Color.TRANSPARENT,
      stroke: Cesium.Color.TRANSPARENT,
      strokeWidth: 0,
    });
    source.name = 'Délinquance enregistrée — taux par département';
    source.show = _enabled;
    for (const entity of source.entities.values) {
      const code = String(entity.properties?.code?.getValue?.() ?? '').trim();
      if (!entity.polygon || !code) {
        entity.show = false;
        continue;
      }
      entity.polygon.outline = false;
      entity.polygon.classificationType = Cesium.ClassificationType.BOTH;
      entity.polygon.material = new Cesium.ColorMaterialProperty(Cesium.Color.TRANSPARENT);
      entity.show = false;
      const parts = _depEntities.get(code);
      if (parts) parts.push(entity);
      else _depEntities.set(code, [entity]);
    }
    if (_viewer) await _viewer.dataSources.add(source);
    _depDataSource = source;
    return source;
  })().catch((error) => {
    _depShapesPromise = null;
    throw error;
  });
  return _depShapesPromise;
}

function repaintDepartements() {
  if (!_national) return;
  const materials = new Map();
  const painted = new Set();
  for (const row of _national.departements || []) {
    if (row.state === null || row.state === undefined) continue;
    const fill = delinquanceFill(row.state, row.bin);
    const key = `${fill.css}|${fill.alpha}`;
    let material = materials.get(key);
    if (!material) {
      material = new Cesium.ColorMaterialProperty(
        Cesium.Color.fromCssColorString(fill.css).withAlpha(fill.alpha),
      );
      materials.set(key, material);
    }
    const parts = _depEntities.get(row.code);
    if (!parts) continue;
    painted.add(row.code);
    for (const entity of parts) {
      if (!entity.polygon) continue;
      entity.polygon.material = material;
      entity.show = true;
    }
  }
  // A département with no row at all is drawn as absence, not as the bottom
  // of the scale.
  for (const [code, parts] of _depEntities) {
    if (painted.has(code)) continue;
    for (const entity of parts) entity.show = false;
  }
  _viewer?.scene?.requestRender?.();
}

function hideDepartements() {
  for (const parts of _depEntities.values()) {
    for (const entity of parts) entity.show = false;
  }
  _overlayHost.clearSource(DELINQUANCE_FR_LABEL_SOURCE_ID);
}

function publishDepartementOverlay() {
  if (!_enabled || _regime !== 'departements') {
    _overlayHost.clearSource(DELINQUANCE_FR_LABEL_SOURCE_ID);
    return;
  }
  const entries = [];
  for (const row of _national?.departements || []) {
    if (row.state !== CELL_PUBLISHED) continue;
    const anchor = _depMeta.get(row.code)?.anchor;
    if (!anchor) continue;
    entries.push(createDelinquanceDepartementOverlayEntry(
      row,
      Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1]),
    ));
  }
  _overlayHost.setEntries(DELINQUANCE_FR_LABEL_SOURCE_ID, selectDelinquanceLabelCohort(entries), {
    cohortLimit: DELINQUANCE_FR_LABEL_COHORT_LIMIT,
    collisionCapacity: DELINQUANCE_FR_LABEL_COLLISION_CAPACITY,
    moving: false,
  });
}

// --- Fetching ---------------------------------------------------------------

async function fetchJson(path, validate) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(path, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!validate(payload)) throw new Error('malformed payload');
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureBase() {
  if (_base) return _base;
  if (_basePromise) return _basePromise;
  _basePromise = fetchJson('/api/delinquance-fr/departements', (p) => Array.isArray(p?.departements))
    .then((payload) => {
      _base = payload;
      _error = null;
      if (!_year) _year = payload.newestYear;
      // The chip SET is derived from the edition — see the module header — but
      // the default is the computed total, which is edition-independent. The
      // derived first chip is only the fallback for a payload that somehow
      // carries no total column at all.
      if (!DELINQUANCE_COMMUNE_CELL_SLUGS.includes(_indicator)
        && Array.isArray(payload.chips) && payload.chips.length) {
        _indicator = payload.chips[0];
      }
      return payload;
    })
    .catch((error) => {
      if (error?.name !== 'AbortError') {
        console.warn('[Data:Délinquance-FR] base unavailable:', error?.message || error);
        _error = 'base départementale indisponible';
      }
      return null;
    })
    .finally(() => { _basePromise = null; });
  return _basePromise;
}

async function ensurePack(dep) {
  if (_packs.has(dep)) return _packs.get(dep);
  if (_packPromises.has(dep)) return _packPromises.get(dep);
  const promise = fetchJson(`/api/delinquance-fr/communes/${dep}`, (p) => Array.isArray(p?.communes))
    .then((payload) => {
      _packs.set(dep, payload);
      _packErrors.delete(dep);
      // LRU by insertion order: Map preserves it, so the oldest key is first.
      while (_packs.size > COMMUNE_PACK_CACHE) {
        const oldest = _packs.keys().next().value;
        if (oldest === undefined) break;
        _packs.delete(oldest);
      }
      return payload;
    })
    .catch((error) => {
      if (error?.name !== 'AbortError') {
        console.warn(`[Data:Délinquance-FR] commune pack ${dep} unavailable:`, error?.message || error);
        _packErrors.set(dep, error?.message || 'indisponible');
      }
      return null;
    })
    .finally(() => { _packPromises.delete(dep); });
  _packPromises.set(dep, promise);
  return promise;
}

// --- Commune regime ---------------------------------------------------------

function clearCommunePrimitives() {
  for (const primitive of [_fills, _outlines, _suppressedOutlines]) {
    if (primitive && _viewer?.scene?.primitives) _viewer.scene.primitives.remove(primitive);
  }
  _fills = null;
  _outlines = null;
  _suppressedOutlines = null;
  _communeRecords = new Map();
}

/** Flat `[lon, lat, …]` to Cartesian positions. */
function ringPositions(flat) {
  if (!Array.isArray(flat) || flat.length < 8) return null;
  return Cesium.Cartesian3.fromDegreesArray(flat);
}

/**
 * Build the drawable record set for the packs currently in view.
 *
 * Exported and pure so the whole three-state decision can be tested without a
 * viewer: given packs and an indicator, this is exactly what would be painted.
 *
 * @param {object} input
 * @param {Array<object>} input.packs
 * @param {string} input.indicator
 * @returns {{records:Array<object>, states:{published:number, zero:number, suppressed:number, missing:number}}}
 */
export function buildDelinquanceCommuneRecords({ packs, indicator }) {
  // The CELL list, not the register's: the computed total occupies the slot
  // after the fifteen published indicators.
  const slot = DELINQUANCE_COMMUNE_CELL_SLUGS.indexOf(indicator);
  const records = [];
  const states = { published: 0, zero: 0, suppressed: 0, missing: 0 };
  for (const pack of Array.isArray(packs) ? packs : []) {
    const thresholds = pack?.thresholds?.[indicator] || [];
    const mean = pack?.means?.[indicator] || null;
    for (const commune of pack?.communes || []) {
      const cell = slot >= 0 ? (commune.v?.[slot] || null) : null;
      const state = cell ? cell[0] : null;
      if (state === CELL_PUBLISHED) states.published += 1;
      else if (state === CELL_ZERO) states.zero += 1;
      else if (state === CELL_SUPPRESSED) states.suppressed += 1;
      else states.missing += 1;
      records.push({
        id: `delinquance-fr:com:${commune.c}`,
        code: commune.c,
        name: commune.n,
        pop: commune.pop,
        log: commune.log,
        simplified: commune.s === 1,
        parts: commune.p || [],
        cells: commune.v || [],
        cell,
        state,
        // A suppressed cell has no rate, so `delinquanceRateBin` is never
        // reached for one: the bin is only computed for a published value.
        bin: state === CELL_PUBLISHED ? delinquanceRateBin(cell[2], thresholds) : -1,
        mean: state === CELL_SUPPRESSED ? mean : null,
        indicator,
        year: pack?.year || null,
        departement: pack?.departement || null,
        anchor: ringAnchor(commune.p?.[0]),
      });
    }
  }
  return { records, states };
}

function drawCommunes(records) {
  clearCommunePrimitives();
  if (!records.length || !_viewer) return;

  const fillInstances = [];
  const outlineInstances = [];
  const suppressedOutlineInstances = [];
  const outlineColor = Cesium.Color.fromCssColorString(OUTLINE_COLOR).withAlpha(OUTLINE_ALPHA);
  const suppressedOutlineColor = Cesium.Color
    .fromCssColorString(SUPPRESSED_OUTLINE_COLOR).withAlpha(SUPPRESSED_OUTLINE_ALPHA);

  for (const record of records) {
    _communeRecords.set(record.id, record);
    const fill = delinquanceFill(record.state, record.bin);
    const color = Cesium.Color.fromCssColorString(fill.css).withAlpha(fill.alpha);
    for (const part of record.parts) {
      const positions = ringPositions(part);
      if (!positions) continue;
      fillInstances.push(new Cesium.GeometryInstance({
        id: record.id,
        geometry: new Cesium.PolygonGeometry({
          // Outer rings only: a commune's interior ring is another commune,
          // and that one is drawn in its own right at the same moment.
          polygonHierarchy: new Cesium.PolygonHierarchy(positions),
          vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) },
      }));
      const outline = new Cesium.GeometryInstance({
        id: record.id,
        geometry: new Cesium.GroundPolylineGeometry({
          positions: [...positions, positions[0]],
          width: record.state === CELL_SUPPRESSED ? SUPPRESSED_OUTLINE_WIDTH_PX : OUTLINE_WIDTH_PX,
        }),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(
            record.state === CELL_SUPPRESSED ? suppressedOutlineColor : outlineColor,
          ),
        },
      });
      // The withheld cells get their own primitive so their outline is drawn
      // LAST and wins every overlap: the third state is the one the layer most
      // wants a reader to notice, and a neighbour's hairline must not hide it.
      if (record.state === CELL_SUPPRESSED) suppressedOutlineInstances.push(outline);
      else outlineInstances.push(outline);
    }
  }
  if (!fillInstances.length) return;

  _fills = new Cesium.GroundPrimitive({
    geometryInstances: fillInstances,
    appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
    classificationType: _classificationType,
    asynchronous: true,
    releaseGeometryInstances: false,
  });
  _fills.show = _enabled;
  _viewer.scene.primitives.add(_fills);

  for (const [instances, target] of [[outlineInstances, 'plain'], [suppressedOutlineInstances, 'suppressed']]) {
    if (!instances.length) continue;
    const primitive = new Cesium.GroundPolylinePrimitive({
      geometryInstances: instances,
      appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
      classificationType: _classificationType,
      asynchronous: true,
      releaseGeometryInstances: false,
    });
    primitive.show = _enabled;
    _viewer.scene.primitives.add(primitive);
    if (target === 'suppressed') _suppressedOutlines = primitive;
    else _outlines = primitive;
  }
  governorRequestRender('delinquance-draw');
}

// --- Reconciliation ---------------------------------------------------------

function recomputeNational() {
  if (!_base || !_depIndex) return;
  _national = projectDelinquanceNational({
    departements: _base.departements,
    years: _base.years,
    index: _depIndex,
    indicator: _indicator,
    year: _year || _base.newestYear,
    binCount: DELINQUANCE_DEPARTEMENT_BINS,
    communeCensus: _base.censusByDepartement
      ? Object.fromEntries(Object.entries(_base.censusByDepartement)
        .map(([dep, byIndicator]) => [dep, byIndicator[_indicator] || null]))
      : null,
  });
}

async function loadViewport({ force = false } = {}) {
  if (!_enabled) return;
  _loading = true;
  _error = null;
  try {
    await Promise.all([ensureBase(), ensureDepartementShapes().catch((error) => {
      console.warn('[Data:Délinquance-FR] département shapes unavailable:', error?.message || error);
      _error = 'contours départementaux indisponibles';
      return null;
    })]);
    if (!_base) {
      _status = 'empty';
      _count = 0;
      return;
    }
    recomputeNational();

    const span = delinquanceViewSpanDeg(_viewer);
    const next = delinquanceRegimeFor(span, _regime);
    const changed = next !== _regime;
    _regime = next;

    if (_regime === 'departements') {
      if (changed || force) clearCommunePrimitives();
      repaintDepartements();
      publishDepartementOverlay();
      _count = _national?.painted || 0;
      _status = 'ok';
      _lastUpdate = new Date();
      return;
    }

    hideDepartements();
    const box = delinquanceViewBox(_viewer);
    const deps = departementsInBox(_depIndex, box, COMMUNE_MAX_PACKS);
    _visibleDeps = deps;
    if (!deps.length) {
      clearCommunePrimitives();
      _count = 0;
      _status = 'empty';
      return;
    }
    await Promise.all(deps.map((dep) => ensurePack(dep)));
    const packs = deps.map((dep) => _packs.get(dep)).filter(Boolean);
    const { records, states } = buildDelinquanceCommuneRecords({ packs, indicator: _indicator });
    drawCommunes(records);
    _count = records.length;
    _status = records.length ? 'ok' : 'empty';
    if (_packErrors.size && !records.length) _error = 'contours communaux indisponibles';
    _lastUpdate = new Date();
    void states;
  } finally {
    _loading = false;
  }
}

function onCameraChanged() {
  if (!_enabled) return;
  clearTimeout(_cameraDebounceTimer);
  _cameraDebounceTimer = setTimeout(() => { void loadViewport(); }, CAMERA_DEBOUNCE_MS);
}

/**
 * Loading copy — named for what is being waited on, because "chargement…" over
 * a 40 MB national fold and over one département's outlines are very different
 * waits.
 */
export function buildDelinquanceLoadingLabel({
  loading = _loading, regime = _regime, base = _base,
} = {}) {
  if (!loading) return null;
  if (!base) return 'Chargement de la base départementale SSMSI…';
  return regime === 'communes' ? 'Chargement des contours communaux…' : 'Mise à jour du fond départemental…';
}

// --- Layer ------------------------------------------------------------------

const delinquanceFranceLayer = {
  id: DELINQUANCE_FR_LAYER_ID,
  name: 'Délinquance enregistrée (FR)',
  // 🚓 and not ⚠ or 🔥: the hazards group already carries weather and
  // industrial-risk glyphs, and this layer is not a warning — it is a register
  // of what a force wrote down.
  icon: '🚓',
  source: DELINQUANCE_SOURCE,
  updateInterval: POLL_INTERVAL_MS,

  init(viewer) {
    _viewer = viewer;
    _enabled = false;
    _regime = 'departements';
    _selectedId = null;
    _count = 0;
    _lastUpdate = null;
    _loading = false;
    _error = null;
    _status = 'idle';
    _classificationType = viewer?.scene?.globe?.show === false
      ? Cesium.ClassificationType.CESIUM_3D_TILE
      : Cesium.ClassificationType.BOTH;
    _overlayHost.setVisible(DELINQUANCE_FR_OVERLAY_SOURCE_ID, false);
    _overlayHost.setVisible(DELINQUANCE_FR_LABEL_SOURCE_ID, false);
  },

  enable(viewer) {
    _enabled = true;
    _error = null;
    if (_depDataSource) _depDataSource.show = true;
    for (const primitive of [_fills, _outlines, _suppressedOutlines]) {
      if (primitive) primitive.show = true;
    }
    _overlayHost.setVisible(DELINQUANCE_FR_OVERLAY_SOURCE_ID, true);
    _overlayHost.setVisible(DELINQUANCE_FR_LABEL_SOURCE_ID, true);
    installClickHandler(viewer);
    registerPickOwner(DELINQUANCE_FR_LAYER_ID, (pickedId) => _communeRecords.has(pickedId));
    if (!_cameraChangedAttached) {
      viewer.camera.changed.addEventListener(onCameraChanged);
      viewer.camera.percentageChanged = Math.min(viewer.camera.percentageChanged || 1, 0.05);
      _cameraChangedAttached = true;
    }
    void loadViewport({ force: true });
  },

  disable(viewer) {
    _enabled = false;
    clearTimeout(_cameraDebounceTimer);
    _cameraDebounceTimer = null;
    clearSelection();
    clearCommunePrimitives();
    hideDepartements();
    if (_depDataSource) _depDataSource.show = false;
    _overlayHost.setVisible(DELINQUANCE_FR_OVERLAY_SOURCE_ID, false);
    _overlayHost.setVisible(DELINQUANCE_FR_LABEL_SOURCE_ID, false);
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    document.removeEventListener('keydown', onKeyDown);
    unregisterPickOwner(DELINQUANCE_FR_LAYER_ID);
    if (_cameraChangedAttached) {
      viewer.camera.changed.removeEventListener(onCameraChanged);
      _cameraChangedAttached = false;
    }
    _loading = false;
    _status = 'idle';
  },

  async update() {
    if (!_enabled) return;
    await loadViewport({ force: true });
  },

  /**
   * Chips select the indicator. They are NOT serialized into the share link —
   * the layer is registered `enabled-only` — so a shared view always opens on
   * the computed total rather than on a silently different crime.
   */
  setParams(params = {}) {
    const next = String(params?.indicator || '').trim();
    if (!next || next === _indicator) return;
    if (!DELINQUANCE_COMMUNE_CELL_SLUGS.includes(next)) return;
    _indicator = next;
    clearSelection();
    void loadViewport({ force: true });
  },

  getParams() {
    return { indicator: _indicator, year: _year };
  },

  getStats() {
    const stats = {
      count: _count,
      lastUpdate: _lastUpdate,
      loading: _loading,
      status: _status,
    };
    const label = buildDelinquanceLoadingLabel();
    if (label) stats.loadingLabel = label;
    if (_base?.stale) stats.stale = true;
    if (_error) stats.error = _error;
    return stats;
  },

  /** National provenance, for the analyst and the attribution popover. */
  getNationalSummary() {
    if (!_base) return null;
    return {
      source: DELINQUANCE_SOURCE,
      attribution: DELINQUANCE_ATTRIBUTION,
      edition: _base.edition,
      year: _year,
      years: _base.years,
      indicator: _indicator,
      regime: _regime,
      communeCensus: _base.census?.[_indicator] || null,
      communes: _base.communes || null,
      offshore: _national?.offshore || [],
      painted: _national?.painted || 0,
      visibleDepartements: _visibleDeps,
    };
  },

  /**
   * Chips for the indicator, and the legend for whichever scale is on screen.
   *
   * The legend ALWAYS carries the three states, even at département grain
   * where the third never lights up: a legend whose meaning changes between
   * zoom levels is worse than a row that reads zero. The suppressed row's
   * count is the national one from the commune fold, so the number a reader
   * sees at national zoom is the number they will meet when they zoom in.
   */
  getRowControls() {
    if (!_base) return { chips: [], legend: [] };
    // The total leads the row, because it is the state the layer opens in and
    // because the alternative — a reader who must choose an offence before
    // seeing any map — is the thing it exists to remove.
    const chipSlugs = [DELINQUANCE_TOTAL_SLUG, ...(_base.chips || [])];
    const chips = chipSlugs.map((slug) => ({
      id: slug,
      label: indicatorForSlug(slug)?.short || slug,
      active: slug === _indicator,
      state: slug === _indicator ? 'active' : 'idle',
      title: slug === DELINQUANCE_TOTAL_SLUG
        ? `${DELINQUANCE_TOTAL_COMMUNE_SLUGS.length} indicateurs cumulés — total calculé par `
          + 'God’s Eye View, pas publié par le SSMSI ; unités mélangées ; minorant dès qu’une '
          + 'cellule est non diffusée'
        : `${indicatorForSlug(slug)?.label || slug} — unité de compte : ${indicatorForSlug(slug)?.unite || '—'}`,
      params: { indicator: slug },
    }));

    const legend = [];
    const blurbs = _indicator === DELINQUANCE_TOTAL_SLUG ? TOTAL_STATE_BLURBS : STATE_BLURBS;
    if (_regime === 'departements' && _national) {
      const labels = delinquanceBinLabels(_national.thresholds, _indicator);
      const counts = new Array(labels.length).fill(0);
      for (const row of _national.departements || []) {
        if (row.bin >= 0 && row.bin < counts.length) counts[row.bin] += 1;
      }
      labels.forEach((label, bin) => {
        if (!counts[bin]) return;
        legend.push({
          label,
          color: DELINQUANCE_RAMP[bin],
          count: counts[bin],
          blurb: blurbs.published,
        });
      });
      if (_national.zeroed > 0) {
        legend.push({
          label: DELINQUANCE_CELL_LABELS.zero,
          color: DELINQUANCE_ZERO_COLOR,
          count: _national.zeroed,
          blurb: blurbs.zero,
        });
      }
    } else {
      const packs = _visibleDeps.map((dep) => _packs.get(dep)).filter(Boolean);
      const { states } = buildDelinquanceCommuneRecords({ packs, indicator: _indicator });
      if (states.published) {
        legend.push({
          label: _indicator === DELINQUANCE_TOTAL_SLUG
            ? 'Total publié — minorant (1 000 habitants)'
            : `Publié (${delinquanceRateUnit(_indicator)})`,
          color: DELINQUANCE_RAMP[DELINQUANCE_RAMP.length - 2],
          count: states.published,
          blurb: blurbs.published,
        });
      }
      if (states.zero) {
        legend.push({
          label: DELINQUANCE_CELL_LABELS.zero,
          color: DELINQUANCE_ZERO_COLOR,
          count: states.zero,
          blurb: blurbs.zero,
        });
      }
      if (states.suppressed) {
        legend.push({
          label: DELINQUANCE_CELL_LABELS.suppressed,
          color: DELINQUANCE_SUPPRESSED_COLOR,
          count: states.suppressed,
          blurb: blurbs.suppressed,
        });
      }
    }
    // The national suppression count travels with the legend at every zoom:
    // it is the single number this layer exists to put in front of a reader.
    const national = _base.census?.[_indicator];
    if (national && !legend.some((row) => row.label === DELINQUANCE_CELL_LABELS.suppressed)) {
      legend.push({
        label: `${DELINQUANCE_CELL_LABELS.suppressed} (national)`,
        color: DELINQUANCE_SUPPRESSED_COLOR,
        count: national[CELL_SUPPRESSED] || 0,
        blurb: blurbs.suppressed,
      });
    }
    return { chips, legend };
  },

  destroy(viewer) {
    if (_enabled) this.disable(viewer);
    else {
      clearSelection();
      if (_clickHandler) {
        _clickHandler.destroy();
        _clickHandler = null;
      }
      document.removeEventListener('keydown', onKeyDown);
      unregisterPickOwner(DELINQUANCE_FR_LAYER_ID);
    }
    clearCommunePrimitives();
    if (_depDataSource) {
      viewer?.dataSources?.remove?.(_depDataSource, true);
      _depDataSource = null;
    }
    _depEntities.clear();
    _depMeta = new Map();
    _depIndex = null;
    _depShapesPromise = null;
    _packs = new Map();
    _packPromises = new Map();
    _packErrors = new Map();
    _viewer = null;
  },
};

// --- Test seams -------------------------------------------------------------

/** Seed the layer's state so cards, legends and selection run without WebGL. */
export function _setDelinquanceStateForTest({
  viewer, overlayHost, base, national, packs, communeRecords, depMeta, depIndex,
  indicator, year, regime, status, count, visibleDeps,
} = {}) {
  _viewer = viewer || null;
  _overlayHost = overlayHost || DEFAULT_OVERLAY_HOST;
  _base = base || null;
  _national = national || null;
  _packs = new Map(packs || []);
  _communeRecords = new Map((communeRecords || []).map((record) => [record.id, record]));
  _depMeta = new Map(depMeta || []);
  _depIndex = depIndex || null;
  _indicator = indicator || _indicator;
  _year = year || _year;
  _regime = regime || 'departements';
  _status = status || 'ok';
  _count = Number.isFinite(count) ? count : _communeRecords.size;
  _visibleDeps = visibleDeps || [];
  _loading = false;
  _enabled = true;
}

/** Exercise the production département selection path. */
export function _selectDelinquanceDepartementForTest(code) {
  selectDepartement(code);
}

/** Exercise the production commune selection path. */
export function _selectDelinquanceCommuneForTest(id) {
  selectCommune(id);
}

/** Exercise the production clear path and restore the production host seam. */
export function _clearDelinquanceSelectionForTest() {
  clearSelection();
  _overlayHost = DEFAULT_OVERLAY_HOST;
  // Back to the indicator a fresh boot opens on, so one test's chip choice
  // cannot become the next test's default.
  _indicator = DELINQUANCE_TOTAL_SLUG;
  _base = null;
  _national = null;
  _packs = new Map();
  _communeRecords = new Map();
  _depMeta = new Map();
  _depIndex = null;
  _regime = 'departements';
  _visibleDeps = [];
  _enabled = false;
}

/** Row controls, for tests that do not construct a viewer. */
export function _delinquanceRowControlsForTest() {
  return delinquanceFranceLayer.getRowControls();
}

/** Ambient département label cohort, for tests that do not construct a viewer. */
export function _delinquanceDepartementOverlayForTest() {
  const entries = [];
  for (const row of _national?.departements || []) {
    if (row.state !== CELL_PUBLISHED) continue;
    const anchor = _depMeta.get(row.code)?.anchor;
    if (!anchor) continue;
    entries.push(createDelinquanceDepartementOverlayEntry(row, { anchor }));
  }
  return selectDelinquanceLabelCohort(entries);
}

export default delinquanceFranceLayer;
