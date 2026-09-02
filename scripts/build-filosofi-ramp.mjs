#!/usr/bin/env node
/**
 * Measure the national distribution of the INSEE Filosofi carroyage, so the
 * layer's colour ramps are READ OFF THE DATA rather than chosen by eye.
 *
 * WHY THIS SCRIPT EXISTS. A choropleth needs breaks, and there are only three
 * honest ways to get them: publish an absolute scale everyone already knows,
 * derive them from the data, or admit they are decoration. The first does not
 * exist here — INSEE publishes deciles of niveau de vie PER PERSON, and a
 * carreau carries a MEAN over its inhabitants, which is a different and much
 * narrower distribution (averaging 100 people flattens both tails). Colouring
 * cell means against individual deciles would paint almost the whole country
 * in the middle four bands and call the result a map.
 *
 * So the breaks are measured here: a national sample of real carreaux, and the
 * population-weighted deciles of each indicator over that sample. Weighted,
 * because a carreau is not an observation — a 6-person square in the Cantal and
 * a 2 800-person square in Paris 19e each answer for a very different number of
 * people, and an unweighted decile would let the empty half of the country set
 * the scale for the full half.
 *
 * The output is pasted into `src/data/filosofiFeed.js` as a frozen constant and
 * the sample size + date recorded beside it. Re-run it when INSEE ships a new
 * millésime; the numbers moving IS the news.
 *
 * Usage: node scripts/build-filosofi-ramp.mjs [--boxes 48] [--json]
 */

const WFS = 'https://data.geopf.fr/wfs/ows';
/**
 * The two grids, and why both are measured.
 *
 * The colour ramps are read off the 200 m grid and applied to both, because
 * every indicator on them is a RATE and a rate does not care how big the
 * square is. The SIZE of the drawn symbol does: a 1 km carreau holds 25 times
 * the people of a 200 m one at the same density, and scaling one reference by
 * 25 puts 60 % of a région's coarse cells on the floor — measured over
 * Bordeaux, 1 907 cells, p90 of the drawn fraction at 0.185 against a ceiling
 * of 0.72. So the coarse grid gets its own measured reference, on its own
 * distribution.
 */
const TYPENAMES = Object.freeze({
  200: 'INSEE.FILOSOFI.INDICATORS:carreaux_200m',
  1000: 'INSEE.FILOSOFI.INDICATORS:carreaux_1km',
});
/** The imputation flag is spelled differently on each grid. */
const IMPUTED_FIELD = Object.freeze({ 200: 'i_car_est', 1000: 'i_est_1km' });
/**
 * Fields the ramp is measured on, plus the two weights.
 *
 * `geom` is deliberately absent: the sample needs numbers, not polygons, and
 * omitting it cuts the payload by roughly five sixths. The layer does the same
 * for the same reason — see `filosofiFeed.js`, where the cell's outline is
 * rebuilt from `id_inspire` instead of being transported.
 */
const BASE_FIELDS = [
  'id_inspire', 'ind', 'men', 'ind_snv_div_ind', 'men_pauv_div_men',
  'part_log_soc_div_men', 'men_surf_div_men', 'part_ind_0_17_div_ind',
  'part_ind_65p_div_ind', 'men_prop_div_men', 'men_1ind_div_men',
];
const fieldsFor = (resolution) => [...BASE_FIELDS, IMPUTED_FIELD[resolution]];

/**
 * Sample boxes, spread over inhabited France rather than over its bounding
 * rectangle — half of which is sea, and a uniformly random box would spend
 * most of its draws there. Each entry is a 0.25° square anchored on a real
 * urban, peri-urban or rural area, in that mix, so the sample is not a survey
 * of city centres.
 */
const SAMPLE_ANCHORS = Object.freeze([
  // Dense urban cores
  [2.35, 48.86, 'Paris'], [4.84, 45.75, 'Lyon'], [5.38, 43.30, 'Marseille'],
  [1.44, 43.60, 'Toulouse'], [-1.55, 47.22, 'Nantes'], [7.27, 43.70, 'Nice'],
  [3.88, 43.61, 'Montpellier'], [-0.58, 44.84, 'Bordeaux'], [7.75, 48.58, 'Strasbourg'],
  [3.06, 50.63, 'Lille'],
  // Mid-sized cities
  [5.72, 45.19, 'Grenoble'], [-1.68, 48.11, 'Rennes'], [5.04, 47.32, 'Dijon'],
  [4.39, 45.44, 'Saint-Étienne'], [1.90, 47.90, 'Orléans'], [6.18, 48.69, 'Nancy'],
  [-4.49, 48.39, 'Brest'], [0.10, 49.49, 'Le Havre'], [2.90, 42.70, 'Perpignan'],
  [4.81, 43.95, 'Avignon'],
  // Peri-urban and small towns
  [1.09, 49.44, 'Rouen'], [3.29, 49.85, 'Saint-Quentin'], [6.02, 47.24, 'Besançon'],
  [-0.36, 43.30, 'Pau'], [2.44, 44.93, 'Aurillac'], [5.90, 43.12, 'Toulon'],
  [-1.15, 46.16, 'La Roche-sur-Yon'], [4.08, 49.26, 'Reims'], [0.69, 47.39, 'Tours'],
  [3.52, 47.80, 'Auxerre'],
  // Rural and mountain
  [2.60, 44.35, 'Millau'], [6.63, 45.90, 'Albertville'], [0.15, 45.65, 'Angoulême'],
  [-2.76, 48.51, 'Saint-Brieuc'], [4.90, 44.93, 'Valence'], [1.26, 45.83, 'Limoges'],
  [2.34, 46.57, 'Montluçon'], [-0.46, 46.32, 'Niort'], [6.36, 49.12, 'Metz'],
  [9.15, 41.93, 'Ajaccio'],
  // Overseas — the carroyage covers Martinique and La Réunion, and a ramp
  // measured on the mainland alone would be applied to them anyway.
  [-61.07, 14.61, 'Fort-de-France'], [55.45, -20.88, 'Saint-Denis (La Réunion)'],
]);

const BOX_DEG = 0.14;

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch one sample box.
 * @param {[number, number, string]} anchor
 * @param {number} count Row ceiling for this box.
 * @returns {Promise<Array<object>>} Raw feature properties.
 */
async function fetchBox([lon, lat, label], count, resolution) {
  const half = BOX_DEG / 2;
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: TYPENAMES[resolution],
    OUTPUTFORMAT: 'application/json',
    PROPERTYNAME: fieldsFor(resolution).join(','),
    COUNT: String(count),
    // lon,lat order: with a plain `EPSG:4326` suffix the service reads the box
    // in GIS order. The URN spelling (`urn:ogc:def:crs:EPSG::4326`) reads it
    // lat-first — both were measured on 2026-09-02 and they disagree, which is
    // exactly the trap this comment exists to keep someone out of.
    BBOX: `${(lon - half).toFixed(4)},${(lat - half).toFixed(4)},${(lon + half).toFixed(4)},${(lat + half).toFixed(4)},EPSG:4326`,
  });
  const response = await fetch(`${WFS}?${params}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  const payload = await response.json();
  const rows = (payload.features || []).map((feature) => feature.properties || {});
  process.stderr.write(`  ${label.padEnd(26)} ${String(rows.length).padStart(5)} carreaux`
    + ` (${payload.numberMatched} in box)\n`);
  return rows;
}

/**
 * Population-weighted quantiles.
 *
 * @param {Array<{value: number, weight: number}>} samples
 * @param {number[]} quantiles In 0..1.
 * @returns {number[]} One value per requested quantile.
 */
export function weightedQuantiles(samples, quantiles) {
  const usable = samples
    .filter((entry) => Number.isFinite(entry.value) && Number.isFinite(entry.weight) && entry.weight > 0)
    .sort((a, b) => a.value - b.value);
  const total = usable.reduce((sum, entry) => sum + entry.weight, 0);
  if (!total) return quantiles.map(() => null);
  const out = [];
  let cursor = 0;
  let index = 0;
  for (const q of quantiles) {
    const target = q * total;
    while (index < usable.length - 1 && cursor + usable[index].weight < target) {
      cursor += usable[index].weight;
      index += 1;
    }
    out.push(usable[index].value);
  }
  return out;
}

/** Indicators the ramp is measured for, with the count each is computed on. */
const METRICS = Object.freeze([
  { key: 'niveau', field: 'ind_snv_div_ind', weight: 'ind', round: 100 },
  { key: 'pauvrete', field: 'men_pauv_div_men', weight: 'men', round: 0.1 },
  { key: 'social', field: 'part_log_soc_div_men', weight: 'men', round: 0.1 },
  { key: 'surface', field: 'men_surf_div_men', weight: 'men', round: 1 },
  { key: 'jeunes', field: 'part_ind_0_17_div_ind', weight: 'ind', round: 0.1 },
  { key: 'aines', field: 'part_ind_65p_div_ind', weight: 'ind', round: 0.1 },
  { key: 'proprietaires', field: 'men_prop_div_men', weight: 'men', round: 0.1 },
  { key: 'solo', field: 'men_1ind_div_men', weight: 'men', round: 0.1 },
  { key: 'population', field: 'ind', weight: 'ind', round: 1 },
  { key: 'menages', field: 'men', weight: 'men', round: 1 },
]);

const QUANTILES = [0.1, 0.25, 0.5, 0.75, 0.9];

/**
 * Round to a step, then back off the binary-float residue.
 *
 * `Math.round(5.3 / 0.1) * 0.1` is 5.300000000000001, and a constant pasted
 * into a source file with that tail reads as a precision nobody measured.
 * @param {number} value
 * @param {number} step
 * @returns {?number}
 */
function roundTo(value, step) {
  if (!Number.isFinite(value)) return null;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number((Math.round(value / step) * step).toFixed(decimals));
}

async function main() {
  const argv = process.argv.slice(2);
  const boxLimit = Number(argv[argv.indexOf('--boxes') + 1]) || SAMPLE_ANCHORS.length;
  const asJson = argv.includes('--json');
  const resolution = argv.includes('--resolution')
    ? Number(argv[argv.indexOf('--resolution') + 1]) : 200;
  if (!TYPENAMES[resolution]) throw new Error(`unsupported resolution ${resolution}`);
  const anchors = SAMPLE_ANCHORS.slice(0, boxLimit);
  const perBox = 4000;

  process.stderr.write(`Sampling ${anchors.length} boxes of ${BOX_DEG}° at ${resolution} m…\n`);
  const rows = [];
  for (const anchor of anchors) {
    try {
      rows.push(...await fetchBox(anchor, perBox, resolution));
    } catch (error) {
      process.stderr.write(`  ${anchor[2]}: ${error.message}\n`);
    }
    // The service is keyless and shared. One box per 250 ms is well inside
    // anything it publishes as a limit and finishes the sweep in ten seconds.
    await sleep(250);
  }

  const imputed = rows.filter((row) => Number(row[IMPUTED_FIELD[resolution]]) === 1).length;
  const people = rows.reduce((sum, row) => sum + (Number(row.ind) || 0), 0);
  const households = rows.reduce((sum, row) => sum + (Number(row.men) || 0), 0);

  const ramps = {};
  for (const metric of METRICS) {
    const samples = rows.map((row) => ({
      value: Number(row[metric.field]),
      weight: Number(row[metric.weight]),
    }));
    ramps[metric.key] = weightedQuantiles(samples, QUANTILES)
      .map((value) => roundTo(value, metric.round));
  }

  const result = {
    measuredAt: new Date().toISOString().slice(0, 10),
    resolution,
    boxes: anchors.length,
    cells: rows.length,
    imputedCells: imputed,
    people: Math.round(people),
    households: Math.round(households),
    quantiles: QUANTILES,
    ramps,
  };

  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stderr.write('\n');
  process.stdout.write(`// Measured ${result.measuredAt} over ${result.cells} carreaux`
    + ` in ${result.boxes} boxes — ${result.people.toLocaleString('en-US')} people,`
    + ` ${result.imputedCells} imputed.\n`);
  process.stdout.write(`// Grid: ${resolution} m.`
    + ' Population-weighted p10 / p25 / p50 / p75 / p90.\n');
  for (const metric of METRICS) {
    process.stdout.write(`${metric.key}: ${JSON.stringify(ramps[metric.key])},\n`);
  }
  // The size channel's reference, which is the p90 of the COUNT itself — the
  // last entry of the population and menages rows above, repeated here because
  // it lands in a different constant (`FILOSOFI_FULL_SIZE_COUNT`) and reading it
  // off a ramp row by eye is how the wrong number gets pasted.
  process.stdout.write(`// FILOSOFI_FULL_SIZE_COUNT[${resolution}]:`
    + ` { ind: ${ramps.population.at(-1)}, men: ${ramps.menages.at(-1)} }\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
