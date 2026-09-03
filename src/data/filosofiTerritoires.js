import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import {
  TERRITORY_DISC_PX,
  TERRITORY_LEVELS,
  TERRITORY_METRICS,
  TERRITORY_RAMPS,
  TERRITORY_RAMP_COLORS,
  TERRITORY_RAMP_SAMPLE,
  TERRITORY_SCOPE,
  TERRITORY_SIZE_BREAKS,
  TERRITORY_VINTAGE,
  summarizeTerritories,
  territoryBand,
  territoryColor,
  territoryDiscPx,
} from './filosofiTerritoiresFeed.js';

/**
 * The national view: one disc per département or région, drawn in screen space.
 *
 * THIS IS THE VIEW HALF of the national regime; `filosofiTerritoiresFeed.js`
 * holds the arithmetic and the provenance. It lives apart from
 * `filosofiCarreaux.js` because the two regimes share a layer row and almost no
 * drawing code: a carreau is a place with an extent, drawn as ground geometry
 * inside its own footprint, and a territory is an aggregate anchored at a point.
 *
 * SCREEN-SPACE DISCS, and that is the whole reason this file is short. The
 * département regime spans a 0.9° box to a 12° one — a factor of thirteen — and
 * a disc sized in kilometres would be a third of the screen at one end and
 * invisible at the other. A point primitive is the same size wherever the
 * camera is, so "one class larger" stays readable at every altitude, and 97
 * discs of at most 34 px never come close to covering France.
 *
 * THE SAME GRAMMAR AS THE CARROYAGE, deliberately: area is the population,
 * colour is the indicator, six measured classes on each. Crossing the zoom
 * threshold changes the STATISTIC — a median where there was a mean, people
 * where there were households, 2023 where there was 2019 — and the card says so
 * in words every time. What it must not change is the visual language, or the
 * operator would think they had changed subject rather than resolution.
 *
 * @module data/filosofiTerritoires
 */

/** Where the anchors come from. Fetched, not bundled into the JS. */
const ANCHORS_URL = new URL(
  './local_data/france_territoires/territoires.json',
  import.meta.url,
).href;

export const TERRITORY_SELECTED_OVERLAY_SOURCE_ID = 'filosofi-fr-territory-selected';

/** Selection accent, matching the app's other selected-object cards. */
const SELECTED_COLOR = '#00ffff';

/**
 * The alpha every disc is drawn at — the carroyage's own.
 *
 * The national view has more basemap to protect, not less: at 12° the labels
 * underneath are country and region names, and covering those is how a map
 * stops telling you where you are.
 */
const DISC_ALPHA = 0.7;

/**
 * A hairline of the basemap's own darkness around each disc.
 *
 * Without it a pale band (`#8fd0d8`, `#f2e18c`) over a light basemap loses its
 * edge and two neighbouring discs read as one blob. With it, the size class —
 * which is the population, the whole denominator — stays countable.
 */
const OUTLINE_COLOR = Cesium.Color.fromCssColorString('#0b1622').withAlpha(0.55);
const OUTLINE_WIDTH = 1.5;

/**
 * How far above the ellipsoid the discs are anchored.
 *
 * Enough to clear any terrain under a département's anchor — Mont Blanc is
 * 4 806 m and the anchors are lowland, but the Hautes-Alpes anchor sits at
 * about 2 000 m — while staying depth-tested, so the globe itself occludes the
 * discs on its far side. Disabling the depth test instead would draw
 * Île-de-France through the Pacific at a whole-Earth zoom.
 */
const ANCHOR_HEIGHT_M = 5_200;

let _anchorsPromise = null;

/**
 * The anchor pack, fetched once per session.
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{departements: Array<object>, regions: Array<object>}>}
 */
export function loadTerritoryAnchors(fetchImpl = fetch) {
  if (!_anchorsPromise) {
    _anchorsPromise = fetchImpl(ANCHORS_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`anchors HTTP ${response.status}`);
        return response.json();
      })
      .then((pack) => {
        if (!Array.isArray(pack?.departements) || !Array.isArray(pack?.regions)) {
          throw new Error('anchors: unexpected shape');
        }
        return pack;
      })
      .catch((error) => {
        _anchorsPromise = null;
        throw error;
      });
  }
  return _anchorsPromise;
}

/** Test seam: drop the memoised pack. */
export function _resetTerritoryAnchorsForTest() {
  _anchorsPromise = null;
}

/** A stable, human-readable id for one drawn territory. */
export function territoryId(level, code) {
  return `filosofi-territoire:${level}:${code}`;
}

/**
 * Join the figures to their anchors.
 *
 * A territory with figures and no anchor is DROPPED and counted, never drawn at
 * a guessed coordinate: the four DOM outside `TERRITORY_SCOPE` have no figures,
 * and anything else missing an anchor is a pack that needs rebuilding, which
 * should be visible rather than papered over.
 *
 * @param {Array<object>} rows Territory figures from the proxy.
 * @param {{departements: Array<object>, regions: Array<object>}} anchors
 * @param {'DEP'|'REG'} level
 * @returns {{records: Array<object>, unanchored: Array<string>}}
 */
export function joinTerritories(rows, anchors, level) {
  const list = level === 'REG' ? anchors?.regions : anchors?.departements;
  const byCode = new Map((list || []).map((entry) => [entry.code, entry]));
  const records = [];
  const unanchored = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const anchor = byCode.get(row?.code);
    if (!anchor) {
      if (row?.code) unanchored.push(row.code);
      continue;
    }
    records.push({
      id: territoryId(level, row.code),
      level,
      code: row.code,
      nom: anchor.nom,
      lon: anchor.lon,
      lat: anchor.lat,
      anchorFromCoverageBox: Boolean(anchor.anchorFromCoverageBox),
      ...row,
    });
  }
  records.sort((a, b) => a.code.localeCompare(b.code));
  return { records, unanchored };
}

/**
 * The colour one record is drawn in, at the layer's one alpha.
 * @param {object} record
 * @param {object} metric
 * @returns {?Cesium.Color} Null when the indicator is not published there.
 */
export function territoryDiscColor(record, metric) {
  const css = territoryColor(record, metric, record.level);
  if (!css) return null;
  return Cesium.Color.fromCssColorString(css).withAlpha(DISC_ALPHA);
}

/**
 * Draw one level's discs into a point collection.
 *
 * Returns the records it actually drew, which is not every record it was given:
 * a territory with no value for the chosen indicator is left OUT rather than
 * drawn in a neutral grey, because a grey disc among coloured ones reads as a
 * low value and the legend already has a row that counts them honestly.
 *
 * @param {Cesium.PointPrimitiveCollection} collection
 * @param {Array<object>} records
 * @param {object} metric
 * @returns {Array<object>} The drawn records, in draw order.
 */
export function fillTerritoryCollection(collection, records, metric) {
  collection.removeAll();
  const drawn = [];
  for (const record of records) {
    const color = territoryDiscColor(record, metric);
    const pixelSize = territoryDiscPx(record, record.level);
    if (!color || pixelSize <= 0) continue;
    collection.add({
      id: record.id,
      position: Cesium.Cartesian3.fromDegrees(record.lon, record.lat, ANCHOR_HEIGHT_M),
      pixelSize,
      color,
      outlineColor: OUTLINE_COLOR,
      outlineWidth: OUTLINE_WIDTH,
    });
    drawn.push(record);
  }
  return drawn;
}

const _fr = new Intl.NumberFormat('fr-FR');

/** @param {?number} value @param {number} [digits] @returns {string} */
function num(value, digits = 0) {
  if (!Number.isFinite(value)) return '—';
  return _fr.format(digits ? Number(value.toFixed(digits)) : Math.round(value));
}

/**
 * The card for one selected territory.
 *
 * EVERY LINE CARRIES ITS YEAR, and that is not decoration. Three publishers
 * stand behind this card — Filosofi for the income, the census for the
 * population, the wage base for the salary — and they are on 2023, 2023 and
 * 2024. A card that printed them as one set of facts about "now" would be
 * inviting arithmetic between numbers that do not belong to the same year.
 *
 * @param {object} record
 * @param {object} metric
 * @returns {?object}
 */
export function createTerritorySelectedOverlayEntry(record, metric) {
  if (!record?.id) return null;
  const levelLabel = record.level === 'REG' ? 'Région' : 'Département';
  const details = [];

  details.push(`${num(record.population)} habitants (recensement ${record.populationYear ?? TERRITORY_VINTAGE.population})`);
  details.push(Number.isFinite(record.niveau)
    ? `Niveau de vie MÉDIAN ${num(record.niveau)} €/an par personne (Filosofi ${record.filosofiYear ?? TERRITORY_VINTAGE.filosofi})`
    : 'Niveau de vie non publié pour ce territoire');
  if (Number.isFinite(record.pauvrete)) {
    details.push(`${num(record.pauvrete, 1)} % des PERSONNES sous le seuil de pauvreté`);
  }
  if (Number.isFinite(record.d1) && Number.isFinite(record.d9)) {
    details.push(`D1 ${num(record.d1)} € · D9 ${num(record.d9)} €`
      + `${Number.isFinite(record.interdecile) ? ` · rapport ${num(record.interdecile, 1)}` : ''}`);
  }
  if (Number.isFinite(record.gini)) details.push(`Indice de Gini ${num(record.gini, 3)}`);
  if (Number.isFinite(record.salaire)) {
    details.push(`Salaire net privé ${num(record.salaire)} €/mois en EQTP (${record.salaireYear ?? TERRITORY_VINTAGE.wages})`
      + ' — avant impôts et prestations, hors fonction publique');
  }

  // The line that stops the two regimes being read as one dataset. Never
  // omitted: it is the only thing on the card that explains why zooming in
  // changes the number — and the YEAR is the one the proxy says it would serve,
  // not a constant. A deployment that builds a local pack draws 2021 while the
  // relay is on 2019, and a hard-coded year would caption the map wrongly the
  // moment that happened. It did, on staging, before this line read it.
  const carroyageVintage = record.carroyageVintage ?? TERRITORY_VINTAGE.carroyage;
  details.push(`Agrégat ${levelLabel.toLowerCase()} — au carreau, le calque montre une MOYENNE`
    + ` par carreau de 200 m, millésime ${carroyageVintage}`);
  if (record.anchorFromCoverageBox) {
    details.push('Repère posé au centre de la zone de couverture : ce territoire n’a pas de contour embarqué');
  }
  details.push(`Aire du disque = habitants, couleur = ${metric.label.toLowerCase()}`);

  return {
    id: String(record.id),
    position: Cesium.Cartesian3.fromDegrees(record.lon, record.lat, ANCHOR_HEIGHT_M),
    variant: 'selected',
    selected: true,
    protected: true,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    title: `${record.nom} (${record.code})`,
    details,
    accent: SELECTED_COLOR,
    interactive: false,
    anchorRadiusPx: 11,
    minAnchorGapPx: 13,
    verticalOnly: true,
    placement: 'above',
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
  };
}

/** @param {*} picked @param {(id:string)=>boolean} has @returns {?string} */
export function resolveTerritoryPickId(picked, has) {
  const id = typeof picked?.id === 'string' ? picked.id : picked?.id?.id;
  return typeof id === 'string' && id.startsWith('filosofi-territoire:') && has(id) ? id : null;
}

const SHAPE_LEGEND_TINT = '#9ec8e0';
const svgGlyph = (body) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 13 13">${body}</svg>`,
)}`;
/** Three discs, small to large — the same glyph the carroyage's size row uses. */
const SIZE_GLYPH = svgGlyph(
  '<circle cx="1.6" cy="10.4" r="1.6"/>'
  + '<circle cx="5.6" cy="9.4" r="2.6"/>'
  + '<circle cx="11.3" cy="8" r="4"/>',
);

/**
 * The legend for the national regime.
 *
 * Six colour bands with their break VALUES, then the size row with the
 * population it totals — the same three-channel legend the carroyage carries,
 * because the grammar is the same and a reader crossing the threshold should
 * not have to relearn it.
 *
 * @param {object} metric
 * @param {Array<object>} records
 * @param {'DEP'|'REG'} level
 * @returns {Array<object>}
 */
export function territoryLegend(metric, records = [], level = 'DEP') {
  const breaks = metric.id === 'population'
    ? TERRITORY_SIZE_BREAKS[level] || TERRITORY_SIZE_BREAKS.DEP
    : TERRITORY_RAMPS[metric.field];
  const counts = new Array(TERRITORY_RAMP_COLORS.length).fill(0);
  let unknown = 0;
  let people = 0;
  for (const record of records) {
    if (Number.isFinite(record.population)) people += record.population;
    const band = territoryBand(record[metric.field], metric, level);
    if (band < 0) unknown += 1;
    else counts[band] += 1;
  }
  const suffix = metric.unit.startsWith('%') ? ' %' : '';
  const colors = metric.reversed ? [...TERRITORY_RAMP_COLORS].reverse() : TERRITORY_RAMP_COLORS;
  const legend = colors.map((color, index) => {
    const low = index === 0 ? null : breaks?.[index - 1];
    const high = index < (breaks?.length ?? 0) ? breaks[index] : null;
    const label = low === null || low === undefined
      ? `< ${_fr.format(high)}${suffix}`
      : high === null || high === undefined
        ? `≥ ${_fr.format(low)}${suffix}`
        : `${_fr.format(low)} – ${_fr.format(high)}${suffix}`;
    return {
      label,
      color,
      count: counts[index],
      blurb: `${metric.unit} — ${metric.label}, millésime ${metric.year}.`
        + ` Paliers mesurés sur les ${TERRITORY_RAMP_SAMPLE.territories} départements.`,
    };
  });
  if (unknown > 0) {
    legend.push({
      label: 'Non publié',
      color: '#4a5568',
      count: unknown,
      blurb: `Le territoire existe mais l’indicateur n’y est pas diffusé (${TERRITORY_SCOPE}).`,
    });
  }
  legend.push({
    label: 'Aire = habitants',
    color: SHAPE_LEGEND_TINT,
    glyph: SIZE_GLYPH,
    count: Math.round(people),
    blurb: `Six tailles, sur les quantiles nationaux de population par ${
      level === 'REG' ? 'région' : 'département'} : `
      + `${(TERRITORY_SIZE_BREAKS[level] || TERRITORY_SIZE_BREAKS.DEP).map((b) => _fr.format(b)).join(' · ')}`
      + ` habitants. Le disque garde sa taille à l’écran quel que soit le zoom :`
      + ` un territoire est un agrégat posé sur un point, pas une étendue.`,
  });
  return legend;
}

/**
 * The chips for the national regime.
 * @param {object} active
 * @returns {Array<object>}
 */
export function territoryChips(active) {
  return TERRITORY_METRICS.map((metric) => ({
    id: metric.id,
    label: metric.short,
    active: active?.id === metric.id,
    state: active?.id === metric.id ? 'active' : 'idle',
    title: `${metric.label} — ${metric.blurb} (${metric.unit}, ${metric.year})`,
    params: { metric: metric.id },
  }));
}

/**
 * The stats line for the national regime.
 * @param {Array<object>} records
 * @param {'DEP'|'REG'} level
 * @returns {object}
 */
export function territoryStats(records, level) {
  const summary = summarizeTerritories(records);
  return {
    ...summary,
    level,
    levelLabel: (TERRITORY_LEVELS[level] || TERRITORY_LEVELS.DEP).label,
    scope: TERRITORY_SCOPE,
    vintage: TERRITORY_VINTAGE,
  };
}

export { DISC_ALPHA as TERRITORY_DISC_ALPHA, ANCHOR_HEIGHT_M as TERRITORY_ANCHOR_HEIGHT_M };
export { TERRITORY_DISC_PX };
