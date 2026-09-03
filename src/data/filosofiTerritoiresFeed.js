/**
 * Filosofi at territory level — what the carroyage cannot say from far away.
 *
 * WHY THIS MODULE EXISTS. The carroyage is 2.3 million squares and the layer
 * refuses to draw them above a 0.9° box, because a national view of them would
 * be a SAMPLE of the country wearing the clothes of a picture of it. That
 * refusal is correct and it left the map blank at exactly the altitude an
 * operator opens the app at. INSEE publishes the same family of indicators
 * already aggregated — commune, EPCI, département, région — through a second,
 * keyless API, and this module reads it so the layer has something true to draw
 * when the grid has nothing.
 *
 * IT IS A DIFFERENT DATASET, NOT THE SAME ONE FROM FURTHER AWAY, and every
 * label here exists to stop that confusion:
 *
 *   - The carroyage's `niveau` is a **mean** over a cell's inhabitants. This
 *     one's is the **median** over a département's. Averaging and halving are
 *     not the same statistic and the chip is renamed when the layer crosses
 *     between them.
 *   - The carroyage's `pauvrete` is the share of **households** under the
 *     threshold. `PR_MD60` is the share of **people**. Same word, two
 *     denominators.
 *   - The millésimes differ: the relayed carroyage is 2019, these figures are
 *     2023, and the wage series is 2024. A card that showed one number without
 *     its year would be inviting a comparison that does not hold.
 *
 * WHAT INSEE ACTUALLY GIVES, measured 2026-09-03 against the live API:
 * `DS_FILOSOFI_CC` answers 27 measures per territory over *France
 * métropolitaine et La Réunion* — no Guadeloupe, Martinique, Guyane or Mayotte,
 * which is a NARROWER scope than the carroyage's (that one has Martinique). It
 * carries no denominator, so the population comes from
 * `DS_POPULATIONS_REFERENCE` and the wage from `DS_BTS_SAL_EQTP_SEX_AGE`.
 *
 * @module data/filosofiTerritoiresFeed
 */

/** Melodi is INSEE's open-data API: keyless, CORS-quiet, one URL per dataset. */
export const MELODI_BASE = 'https://api.insee.fr/melodi/data';

/**
 * Geographic vintage asked for in the `GEO` dimension.
 *
 * The API normalises it — ask for `2026-DEP-33` and it answers `2025-DEP-33` on
 * the population dataset — so this is a hint rather than a contract, and the
 * code always reads the territory back off the answer instead of assuming it
 * got what it asked for.
 */
export const MELODI_COG = '2026';

/**
 * The three datasets behind one national view, and why it takes three.
 *
 * Filosofi publishes rates and medians with NO denominator: there is no
 * population in `DS_FILOSOFI_CC` at all. The layer's whole grammar is "area is
 * the count the indicator was computed on", so without a count there is no
 * symbol to draw — hence the second dataset. The third is the only income
 * figure INSEE publishes for 2024, and it answers a different question
 * (see `TERRITORY_METRICS`).
 */
export const MELODI_DATASETS = Object.freeze({
  filosofi: 'DS_FILOSOFI_CC',
  population: 'DS_POPULATIONS_REFERENCE',
  wages: 'DS_BTS_SAL_EQTP_SEX_AGE',
});

/**
 * Millésimes, read off the live API on 2026-09-03 and pinned so a silent change
 * upstream is a test failure rather than a quieter map.
 *
 * They do NOT agree with each other and they do not agree with the carroyage.
 * That is the truth about French income statistics, not a defect in the relay,
 * and every card prints the year beside the number it belongs to.
 */
export const TERRITORY_VINTAGE = Object.freeze({
  filosofi: 2023,
  population: 2023,
  wages: 2024,
  carroyage: 2019,
});

/** What `DS_FILOSOFI_CC` covers. Narrower than the carroyage — no Antilles, no Guyane, no Mayotte. */
export const TERRITORY_SCOPE = 'France métropolitaine et La Réunion';

/**
 * The two levels the layer draws, widest first.
 *
 * `maxBoxDeg` is the widest latitude span each level owns. Metropolitan France
 * is about 9.8° tall, so the DÉPARTEMENT level owns the whole-country view —
 * deliberately, because 96 départements is the map a French reader already has
 * in their head and 13 régions is too coarse to locate anything. Régions take
 * over only when France itself is small on screen.
 */
export const TERRITORY_LEVELS = Object.freeze({
  DEP: Object.freeze({ id: 'DEP', label: 'Départements', short: 'DÉP.', maxBoxDeg: 12 }),
  REG: Object.freeze({ id: 'REG', label: 'Régions', short: 'RÉG.', maxBoxDeg: Infinity }),
});

/**
 * Which level a viewport gets.
 *
 * @param {?{south:number, north:number, west:number, east:number}} box
 * @returns {'DEP'|'REG'}
 */
export function levelForBox(box) {
  if (!box) return 'REG';
  const span = Math.max(
    Math.abs(box.north - box.south),
    Math.abs(box.east - box.west) * 0.66,
  );
  return span <= TERRITORY_LEVELS.DEP.maxBoxDeg ? 'DEP' : 'REG';
}

/**
 * The six colour bands, measured over the 97 DÉPARTEMENTS and used at both
 * levels.
 *
 * MEASURED, and it had to be: the carroyage's bands are quantiles of a 200 m
 * cell's mean standard of living and run 15 300 € to 32 400 €, while every
 * département in France sits between roughly 21 000 € and 34 000 €. Borrowing
 * that ramp would paint the country in two bands and call it a map. Same
 * argument `build-filosofi-ramp.mjs` makes against INSEE's published individual
 * deciles, one level up.
 *
 * DÉPARTEMENT breaks at BOTH levels, on purpose: a région and the départements
 * inside it are then coloured on one scale, so zooming across the switch
 * recolours nothing. The régions have their own measured breaks and they are
 * within a band of these; using them would have made the same place change
 * colour on a camera move.
 *
 * `scripts/build-filosofi-territoires.mjs` measured these on 2026-09-03 over
 * **all 97 territories with figures — 67 055 494 people**. Not a sample: there
 * are only 97, so these quantiles are exact for the millésime.
 *
 * Values are p10 / p25 / p50 / p75 / p90, population-weighted.
 */
export const TERRITORY_RAMPS = Object.freeze({
  niveau: Object.freeze([23_800, 24_700, 25_900, 27_200, 28_000]),
  pauvrete: Object.freeze([11.6, 13.5, 15.8, 18.1, 20.7]),
  interdecile: Object.freeze([2.9, 3, 3.4, 3.8, 4.3]),
  gini: Object.freeze([0.246, 0.258, 0.277, 0.307, 0.325]),
  salaire: Object.freeze([2_270, 2_340, 2_480, 2_680, 3_040]),
});

/** The sample those breaks were read off, reported on the layer's card. */
export const TERRITORY_RAMP_SAMPLE = Object.freeze({
  measuredAt: '2026-09-03',
  level: 'DEP',
  territories: 97,
  people: 67_055_494,
});

/**
 * Size classes: the national quantiles of the population itself, per level.
 *
 * Per level and not shared, because the two distributions are an order of
 * magnitude apart — the median département holds about a million people, the
 * median région six million — and one scale would draw every département at the
 * floor. The colour scale is shared for the opposite reason: a median income is
 * the same kind of number whatever partition you cut the country into.
 */
export const TERRITORY_SIZE_BREAKS = Object.freeze({
  DEP: Object.freeze([334_000, 567_000, 1_051_000, 1_471_000, 2_088_000]),
  REG: Object.freeze([3_346_000, 3_907_000, 5_992_000, 8_206_000, 12_463_000]),
});

/**
 * The disc a territory is drawn as, in SCREEN pixels.
 *
 * Pixels and not ground kilometres, and this is the one place the national view
 * deliberately parts company with the carroyage. A carreau is a place with an
 * extent you are inspecting, so its symbol lives inside its own footprint. A
 * département is an aggregate ANCHORED at a point — it has no extent the number
 * belongs to — and sizing its disc in kilometres would make it a third of the
 * screen at the bottom of the level's zoom range and invisible at the top. A
 * screen-space disc is the same size wherever the camera is, which is what
 * makes "one class larger" readable at every altitude.
 *
 * The floor is 11 px because that is where a disc stops being comparable to its
 * neighbour, and the ceiling is 34 px because past that the discs of Paris and
 * its neighbours overlap into one blob at the country view.
 */
export const TERRITORY_DISC_PX = Object.freeze({ min: 11, max: 34 });

/**
 * A six-step ramp, cold to warm — the carroyage's own, deliberately.
 *
 * The BREAKS differ between the two regimes because the statistics differ; the
 * COLOURS must not, or crossing the zoom threshold would look like changing the
 * subject rather than changing the resolution.
 */
export const TERRITORY_RAMP_COLORS = Object.freeze([
  '#2c5d8f', '#4f97c4', '#8fd0d8', '#f2e18c', '#f0a145', '#d1442f',
]);

/**
 * What the national view can colour by.
 *
 * Every entry states its unit AND its year, because the three sources behind
 * this view disagree about the year and a number without one invites a
 * comparison that does not hold.
 *
 * `carreauChip` names the carroyage chip this indicator stands in for, so the
 * layer can keep the operator's choice across the zoom threshold instead of
 * resetting it — and `null` marks the two that exist only here.
 */
export const TERRITORY_METRICS = Object.freeze([
  Object.freeze({
    id: 'niveau',
    label: 'Niveau de vie médian',
    short: 'NIVEAU DE VIE',
    unit: '€/an par personne',
    field: 'niveau',
    year: TERRITORY_VINTAGE.filosofi,
    carreauChip: 'niveau',
    reversed: false,
    blurb: 'Médiane du niveau de vie des habitants du territoire — la moitié vit'
      + ' au-dessus, la moitié en dessous. Le carroyage, lui, montre une MOYENNE par'
      + ' carreau : ce ne sont pas la même statistique.',
  }),
  Object.freeze({
    id: 'pauvrete',
    label: 'Taux de pauvreté',
    short: 'PAUVRETÉ',
    unit: '% des personnes',
    field: 'pauvrete',
    year: TERRITORY_VINTAGE.filosofi,
    carreauChip: 'pauvrete',
    reversed: false,
    blurb: 'Part des personnes vivant sous 60 % du niveau de vie médian national.'
      + ' Au carreau, la même idée est comptée en MÉNAGES, pas en personnes.',
  }),
  Object.freeze({
    id: 'population',
    label: 'Population',
    short: 'POPULATION',
    unit: 'habitants',
    field: 'population',
    year: TERRITORY_VINTAGE.population,
    carreauChip: 'population',
    reversed: false,
    blurb: 'Population municipale (recensement) — la seule grandeur qui s’additionne,'
      + ' et celle qui donne sa taille à chaque disque.',
  }),
  Object.freeze({
    id: 'interdecile',
    label: 'Écart D9/D1',
    short: 'ÉCART D9/D1',
    unit: 'rapport',
    field: 'interdecile',
    year: TERRITORY_VINTAGE.filosofi,
    carreauChip: null,
    reversed: false,
    blurb: 'Combien de fois le niveau de vie des 10 % les plus aisés dépasse celui des'
      + ' 10 % les plus modestes. N’existe pas au carreau : il faut une distribution'
      + ' entière pour le calculer.',
  }),
  Object.freeze({
    id: 'gini',
    label: 'Indice de Gini',
    short: 'GINI',
    unit: '0 = égalité parfaite',
    field: 'gini',
    year: TERRITORY_VINTAGE.filosofi,
    carreauChip: null,
    reversed: false,
    blurb: 'Concentration des niveaux de vie : 0 si tout le monde a le même, 1 si une'
      + ' seule personne a tout. N’existe pas au carreau.',
  }),
  Object.freeze({
    id: 'salaire',
    label: 'Salaire net mensuel',
    short: 'SALAIRE',
    unit: '€/mois en équivalent temps plein',
    field: 'salaire',
    year: TERRITORY_VINTAGE.wages,
    carreauChip: null,
    reversed: false,
    blurb: 'Salaire net moyen du secteur PRIVÉ, en équivalent temps plein. Ce n’est pas'
      + ' un niveau de vie : c’est avant impôts et prestations, par emploi et non par'
      + ' ménage, et la fonction publique en est absente.',
  }),
]);

/** @type {Object<string, object>} */
const METRIC_BY_ID = Object.freeze(Object.fromEntries(
  TERRITORY_METRICS.map((metric) => [metric.id, metric]),
));

/**
 * The territory metric a chip id names.
 *
 * Accepts a CARROYAGE chip id too, so that crossing the zoom threshold keeps
 * the operator's choice where the two regimes have a counterpart, and falls
 * back to the median standard of living where they do not — rather than
 * silently drawing a different indicator under the chip that is lit.
 *
 * @param {?string} id
 * @returns {object}
 */
export function resolveTerritoryMetric(id) {
  const key = String(id ?? '').trim();
  if (METRIC_BY_ID[key]) return METRIC_BY_ID[key];
  const viaCarreau = TERRITORY_METRICS.find((metric) => metric.carreauChip === key);
  return viaCarreau || METRIC_BY_ID.niveau;
}

/** The Filosofi measure code behind each indicator, or null when it comes from elsewhere. */
export const TERRITORY_MEASURE_CODES = Object.freeze({
  niveau: 'MED_SL',
  pauvrete: 'PR_MD60',
  interdecile: 'IR_D9_D1_SL',
  gini: 'GI_SL',
});

/**
 * Codes to ask for, per level.
 *
 * Listed rather than discovered: Melodi has no "give me every département"
 * filter — `GEO_TYPE=DEP` is an HTTP 400, measured — so the caller has to name
 * them. 97 of them in one URL is 1 700 characters and one round trip.
 */
export const DEPARTEMENT_CODES = Object.freeze([
  ...Array.from({ length: 95 }, (_, index) => String(index + 1).padStart(2, '0'))
    .filter((code) => code !== '20'),
  '2A', '2B', '974',
]);
export const REGION_CODES = Object.freeze([
  '11', '24', '27', '28', '32', '44', '52', '53', '75', '76', '84', '93', '94', '04',
]);

/** @param {'DEP'|'REG'} level @returns {readonly string[]} */
export function codesForLevel(level) {
  return level === 'REG' ? REGION_CODES : DEPARTEMENT_CODES;
}

/**
 * The three Melodi URLs one level needs.
 *
 * @param {'DEP'|'REG'} level
 * @returns {{filosofi: string, population: string, wages: string}}
 */
export function buildTerritoryUrls(level) {
  const geo = codesForLevel(level).map((code) => `GEO=${MELODI_COG}-${level}-${code}`).join('&');
  return {
    filosofi: `${MELODI_BASE}/${MELODI_DATASETS.filosofi}?${geo}&maxResult=5000`,
    population: `${MELODI_BASE}/${MELODI_DATASETS.population}?${geo}&maxResult=5000`,
    // `_T` on both dimensions is the all-sexes, all-ages total. Without them the
    // answer is 36 rows per territory and the layer would have to pick one.
    wages: `${MELODI_BASE}/${MELODI_DATASETS.wages}?${geo}&SEX=_T&AGE=_T&maxResult=5000`,
  };
}

/**
 * The territory code inside a Melodi `GEO` value.
 *
 * `2025-DEP-2A` → `2A`. Read off the answer rather than assumed, because the
 * API normalises the geographic vintage it was asked for and the three datasets
 * do not all normalise to the same one.
 *
 * @param {unknown} geo
 * @returns {?string}
 */
export function territoryCode(geo) {
  const parts = String(geo ?? '').split('-');
  const code = parts[parts.length - 1];
  return code && parts.length >= 2 ? code : null;
}

/**
 * Fold the three answers into one row per territory.
 *
 * @param {{filosofi?: object, population?: object, wages?: object}} payloads
 * @returns {Map<string, object>} code -> values
 */
export function foldTerritoryObservations({ filosofi, population, wages } = {}) {
  /** @type {Map<string, object>} */
  const rows = new Map();
  const row = (geo) => {
    const code = territoryCode(geo);
    if (!code) return null;
    if (!rows.has(code)) rows.set(code, { code });
    return rows.get(code);
  };

  for (const observation of filosofi?.observations || []) {
    const target = row(observation?.dimensions?.GEO);
    if (!target) continue;
    const value = observation?.measures?.OBS_VALUE_NIVEAU?.value;
    if (!Number.isFinite(value)) continue;
    for (const [key, code] of Object.entries(TERRITORY_MEASURE_CODES)) {
      if (observation.dimensions.FILOSOFI_MEASURE === code) target[key] = value;
    }
    if (observation.dimensions.FILOSOFI_MEASURE === 'D1_SL') target.d1 = value;
    if (observation.dimensions.FILOSOFI_MEASURE === 'D9_SL') target.d9 = value;
    if (observation.dimensions.TIME_PERIOD) target.filosofiYear = Number(observation.dimensions.TIME_PERIOD);
  }

  for (const observation of population?.observations || []) {
    // PMUN is the population municipale — the headline census figure. PTOT adds
    // people counted apart (students elsewhere, some institutions) and PCAP is
    // only that supplement; summing them would double-count.
    if (observation?.dimensions?.POPREF_MEASURE !== 'PMUN') continue;
    const target = row(observation.dimensions.GEO);
    if (!target) continue;
    const value = observation?.measures?.OBS_VALUE_NIVEAU?.value;
    if (Number.isFinite(value)) {
      target.population = value;
      target.populationYear = Number(observation.dimensions.TIME_PERIOD);
    }
  }

  for (const observation of wages?.observations || []) {
    if (observation?.dimensions?.DERA_MEASURE !== 'SALAIRE_NET_EQTP_MENSUEL_MOYENNE') continue;
    const target = row(observation.dimensions.GEO);
    if (!target) continue;
    const value = observation?.measures?.OBS_VALUE_NIVEAU?.value;
    const year = Number(observation.dimensions.TIME_PERIOD);
    if (!Number.isFinite(value) || !Number.isFinite(year)) continue;
    // The series carries several years in one answer; keep the newest, and keep
    // the year with it so the card can say which one it is showing.
    if (!Number.isFinite(target.salaireYear) || year > target.salaireYear) {
      target.salaire = value;
      target.salaireYear = year;
    }
  }

  return rows;
}

/**
 * Which of the six bands a value falls in.
 *
 * @param {?number} value
 * @param {object} metric
 * @param {'DEP'|'REG'} [level]
 * @returns {number} 0..5, or -1 when there is nothing to band.
 */
export function territoryBand(value, metric, level = 'DEP') {
  if (!Number.isFinite(value)) return -1;
  const breaks = metric.id === 'population'
    ? TERRITORY_SIZE_BREAKS[level] || TERRITORY_SIZE_BREAKS.DEP
    : TERRITORY_RAMPS[metric.field];
  if (!breaks) return -1;
  let band = 0;
  for (const edge of breaks) {
    if (value < edge) break;
    band += 1;
  }
  return Math.min(band, TERRITORY_RAMP_COLORS.length - 1);
}

/**
 * The CSS colour for one territory under one indicator.
 * @param {object} row
 * @param {object} metric
 * @param {'DEP'|'REG'} [level]
 * @returns {?string} Null when the indicator is not published there.
 */
export function territoryColor(row, metric, level = 'DEP') {
  const band = territoryBand(row?.[metric.field], metric, level);
  if (band < 0) return null;
  const ramp = metric.reversed ? [...TERRITORY_RAMP_COLORS].reverse() : TERRITORY_RAMP_COLORS;
  return ramp[band];
}

/**
 * How big a territory's disc is, in screen pixels.
 *
 * SIZE IS ALWAYS THE POPULATION, whatever is being coloured — the same rule the
 * carroyage follows, for the same reason: it is the count every one of these
 * indicators was computed on, and it is the only one of them that adds up.
 * Six classes on the level's own measured quantiles, evenly stepped in
 * DIAMETER so "one class up" is something an eye can read back.
 *
 * @param {object} row
 * @param {'DEP'|'REG'} [level]
 * @returns {number} Pixels, 0 when the territory has no population figure.
 */
export function territoryDiscPx(row, level = 'DEP') {
  const population = row?.population;
  if (!Number.isFinite(population) || population <= 0) return 0;
  const breaks = TERRITORY_SIZE_BREAKS[level] || TERRITORY_SIZE_BREAKS.DEP;
  let band = 0;
  for (const edge of breaks) {
    if (population < edge) break;
    band += 1;
  }
  const step = (TERRITORY_DISC_PX.max - TERRITORY_DISC_PX.min) / breaks.length;
  return TERRITORY_DISC_PX.min + (band * step);
}

/**
 * What the drawn territories add up to.
 *
 * The mean is population-weighted for the reason the carroyage's is: the
 * unweighted mean of 97 départements is the mean of the DÉPARTEMENTS, and
 * nobody lives in a département.
 *
 * @param {Array<object>} rows
 * @returns {object}
 */
export function summarizeTerritories(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let people = 0;
  let weighted = 0;
  let weight = 0;
  let withoutFigures = 0;
  for (const row of list) {
    if (Number.isFinite(row.population)) people += row.population;
    if (Number.isFinite(row.niveau) && Number.isFinite(row.population)) {
      weighted += row.niveau * row.population;
      weight += row.population;
    }
    if (!Number.isFinite(row.niveau)) withoutFigures += 1;
  }
  return {
    territories: list.length,
    people: Math.round(people),
    niveau: weight > 0 ? Math.round(weighted / weight) : null,
    withoutFigures,
  };
}
