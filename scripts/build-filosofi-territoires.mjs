#!/usr/bin/env node
/**
 * Measure the national distribution of the Filosofi indicators AT TERRITORY
 * LEVEL, so the national view's colour bands are read off the data rather than
 * borrowed from the carroyage's.
 *
 * WHY IT CANNOT BORROW THEM. The carroyage's bands are quantiles of a 200 m
 * cell's MEAN standard of living, over 80 105 cells spanning 15 300 € to
 * 32 400 €. A département carries the MEDIAN over a million people, and
 * averaging a département flattens the tails to nothing: all 97 fall between
 * roughly 19 000 € and 34 000 €, so the carroyage's ramp would paint the whole
 * country in two bands and call it a map. Same argument as
 * `build-filosofi-ramp.mjs` makes against INSEE's published individual deciles,
 * one level up.
 *
 * THE SAMPLE IS THE POPULATION, not a sample of it: there are 97 départements
 * and 14 régions with figures, and this script reads all of them. So these
 * quantiles are exact for the millésime, not estimated — re-run it when INSEE
 * ships a new one, and the numbers moving IS the news.
 *
 * Weighted by population, for the reason the carroyage's are: the unweighted
 * median of 97 départements is the median of the DÉPARTEMENTS, and nobody lives
 * in a département — they live in one of the very unequal populations behind
 * those 97 numbers.
 *
 * Usage: node scripts/build-filosofi-territoires.mjs [--level DEP|REG] [--json]
 */
const MELODI = 'https://api.insee.fr/melodi/data';
/** Geographic vintage the API answers in. It normalises, so this is a hint. */
const COG = '2026';

/** Métropole plus La Réunion — the scope `DS_FILOSOFI_CC` publishes. */
export const DEPARTEMENT_CODES = Object.freeze([
  ...Array.from({ length: 95 }, (_, i) => String(i + 1).padStart(2, '0')).filter((c) => c !== '20'),
  '2A', '2B', '974',
]);
export const REGION_CODES = Object.freeze([
  '11', '24', '27', '28', '32', '44', '52', '53', '75', '76', '84', '93', '94', '04',
]);

/**
 * What the national view can colour by, and where each number comes from.
 *
 * `MED_SL` is a MEDIAN and the carroyage's `niveau` is a MEAN — two different
 * statistics that would be dishonest to show under one label, which is why the
 * layer renames the chip when it crosses into this regime rather than pretending
 * the reader is looking at the same thing from further away.
 */
export const TERRITORY_MEASURES = Object.freeze([
  { key: 'niveau', code: 'MED_SL', unit: 'EUR_YR', round: 100 },
  { key: 'pauvrete', code: 'PR_MD60', unit: 'PT', round: 0.1 },
  { key: 'interdecile', code: 'IR_D9_D1_SL', unit: 'NR', round: 0.1 },
  { key: 'gini', code: 'GI_SL', unit: 'NR', round: 0.001 },
  { key: 'salaire', code: null, unit: 'EUR_MTH', round: 10 },
]);

const QUANTILES = [0.1, 0.25, 0.5, 0.75, 0.9];

/** @param {string} url @returns {Promise<object>} */
async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} — ${url.slice(0, 120)}`);
  return response.json();
}

/**
 * Population-weighted quantiles.
 * @param {Array<{value:number, weight:number}>} samples
 * @param {number[]} quantiles
 * @returns {Array<number|null>}
 */
export function weightedQuantiles(samples, quantiles) {
  const usable = samples
    .filter((s) => Number.isFinite(s.value) && Number.isFinite(s.weight) && s.weight > 0)
    .sort((a, b) => a.value - b.value);
  const total = usable.reduce((sum, s) => sum + s.weight, 0);
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

/** @param {number} value @param {number} step @returns {?number} */
function roundTo(value, step) {
  if (!Number.isFinite(value)) return null;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number((Math.round(value / step) * step).toFixed(decimals));
}

/** @param {string[]} codes @param {string} level @returns {string} */
const geoParams = (codes, level) => codes.map((c) => `GEO=${COG}-${level}-${c}`).join('&');

async function main() {
  const argv = process.argv.slice(2);
  const level = argv.includes('--level') ? argv[argv.indexOf('--level') + 1] : 'DEP';
  const asJson = argv.includes('--json');
  const codes = level === 'REG' ? REGION_CODES : DEPARTEMENT_CODES;
  const geo = geoParams(codes, level);

  process.stderr.write(`Reading ${codes.length} ${level} from Melodi…\n`);
  const [filosofi, population, wages] = await Promise.all([
    getJson(`${MELODI}/DS_FILOSOFI_CC?${geo}&maxResult=5000`),
    getJson(`${MELODI}/DS_POPULATIONS_REFERENCE?${geo}&maxResult=5000`),
    getJson(`${MELODI}/DS_BTS_SAL_EQTP_SEX_AGE?${geo}&SEX=_T&AGE=_T&maxResult=5000`),
  ]);

  /** code -> { measure -> value } */
  const rows = new Map();
  const put = (geoId, key, value) => {
    const code = String(geoId).split('-').pop();
    if (!rows.has(code)) rows.set(code, {});
    if (Number.isFinite(value)) rows.get(code)[key] = value;
  };
  for (const o of filosofi.observations || []) {
    put(o.dimensions.GEO, o.dimensions.FILOSOFI_MEASURE, o.measures?.OBS_VALUE_NIVEAU?.value);
  }
  for (const o of population.observations || []) {
    if (o.dimensions.POPREF_MEASURE !== 'PMUN') continue;
    put(o.dimensions.GEO, 'PMUN', o.measures?.OBS_VALUE_NIVEAU?.value);
  }
  // The wage series carries several years; keep the newest per territory.
  const wageYear = new Map();
  for (const o of wages.observations || []) {
    if (o.dimensions.DERA_MEASURE !== 'SALAIRE_NET_EQTP_MENSUEL_MOYENNE') continue;
    const code = String(o.dimensions.GEO).split('-').pop();
    const year = Number(o.dimensions.TIME_PERIOD);
    const value = o.measures?.OBS_VALUE_NIVEAU?.value;
    if (!Number.isFinite(value)) continue;
    if (!wageYear.has(code) || year > wageYear.get(code).year) wageYear.set(code, { year, value });
  }
  for (const [code, { value }] of wageYear) put(`x-x-${code}`, 'WAGE', value);

  const filosofiYear = (filosofi.observations || [])[0]?.dimensions?.TIME_PERIOD ?? null;
  const popYear = (population.observations || [])[0]?.dimensions?.TIME_PERIOD ?? null;
  const wageYears = [...new Set([...wageYear.values()].map((w) => w.year))].sort();

  const ramps = {};
  for (const measure of TERRITORY_MEASURES) {
    const field = measure.code || 'WAGE';
    const samples = [...rows.values()].map((r) => ({ value: r[field], weight: r.PMUN }));
    ramps[measure.key] = weightedQuantiles(samples, QUANTILES).map((v) => roundTo(v, measure.round));
  }
  const populations = [...rows.values()].map((r) => ({ value: r.PMUN, weight: r.PMUN }));
  ramps.population = weightedQuantiles(populations, QUANTILES).map((v) => roundTo(v, 1000));

  const covered = [...rows.entries()].filter(([, r]) => Number.isFinite(r.MED_SL));
  const result = {
    measuredAt: new Date().toISOString().slice(0, 10),
    level,
    asked: codes.length,
    withFigures: covered.length,
    people: Math.round([...rows.values()].reduce((s, r) => s + (r.PMUN || 0), 0)),
    vintages: { filosofi: filosofiYear, population: popYear, wages: wageYears },
    quantiles: QUANTILES,
    ramps,
  };

  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stderr.write('\n');
  process.stdout.write(`// ${level}: measured ${result.measuredAt} over ${result.withFigures}`
    + ` territories of ${result.asked} — ${result.people.toLocaleString('en-US')} people.\n`);
  process.stdout.write(`// Vintages: Filosofi ${filosofiYear}, population ${popYear},`
    + ` wages ${wageYears.join('/')}.\n`);
  process.stdout.write('// Population-weighted p10 / p25 / p50 / p75 / p90.\n');
  for (const [key, values] of Object.entries(ramps)) {
    process.stdout.write(`${key}: ${JSON.stringify(values)},\n`);
  }
  const missing = codes.filter((c) => !Number.isFinite(rows.get(c)?.MED_SL));
  if (missing.length) process.stdout.write(`// No Filosofi figure: ${missing.join(', ')}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
