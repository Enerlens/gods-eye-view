/**
 * EDF generating-fleet projection — the seam between three raw EDF Open Data
 * files and the one document the browser is served.
 *
 * Lives here rather than inside `vite.config.js` for the same reason
 * `eco2mixFeed.js` and `meteoFranceVigilanceFeed.js` do: these three files
 * disagree with each other on almost everything except the column that matters
 * (`puissance_installee`), and only a test against real captured payloads keeps
 * the reconciliation honest. The dev-server proxy imports `projectEdfPlants`;
 * nothing in the browser bundle does.
 *
 * ── The three datasets ──────────────────────────────────────────────────────
 * `…-hydraulique-de-edf-sa`   51 rows — one row per PLANT, 13 779 MW
 * `…-nucleaire-edf`           56 rows — one row per REACTOR, 61 370 MW
 * `…-thermique-a-flamme-…`    19 rows — one row per UNIT,     4 945 MW
 *
 * MEASURED against all three live datasets on 2026-08-27: 200 in 0.21–0.33 s,
 * 126 rows and ~111 KB across the three `lines` bodies plus ~48 KB across the
 * three metadata bodies — six round trips and ~159 KB — projected here to one
 * ~36 KB document of 79 sites totalling 80 094 MW.
 *
 * ── What this is, and what it is NOT ────────────────────────────────────────
 * This is **EDF SA's own fleet** (`perimetre_juridique` is `EDF SA` on all 126
 * rows), not France's. The hydro file publishes, in its own words, only the
 * plants above 100 MW *"sur les plus de 400 installations hydrauliques
 * exploitées par EDF"* — plus an exception for those whose secondary reserve
 * reaches 20 MW, which is exactly why five plants below 100 MW are in the file
 * (Grandval 74.1 MW / 20 MW of reserve is the smallest). The thermal file
 * carries EDF's units alone, so no Engie or TotalEnergies CCGT is here, and no
 * CNR or SHEM hydro either. Nuclear is the one filière where the operator IS
 * the country: every French reactor is EDF's, so those 56 rows are the fleet.
 *
 * ── Four traps this projection exists to absorb ─────────────────────────────
 *
 * 1. **X IS THE LATITUDE.** The hydro file publishes `coordonnees_x_wgs` =
 *    45.1458 and `coordonnees_y_wgs` = 6.0512 for Grand-Maison, which is
 *    45.1458 N 6.0512 E — the OPPOSITE of the x=longitude convention. Read the
 *    usual way, France's largest hydro plant lands off the coast of Somalia.
 *    The nuclear and thermal files instead carry ONE string,
 *    `point_gps_wsg84` (and yes, WGS is misspelt WSG), formatted `"lat, lon"`.
 *    Both shapes are normalised here and every parsed point is checked against
 *    a metropolitan-France box, so a swap regression fails loudly.
 *
 * 2. **A ROW IS NOT A SITE.** Hydro publishes plants; nuclear and thermal
 *    publish units. Drawn row-per-marker, Gravelines becomes six dots stacked
 *    on one pixel. Rows are therefore grouped by `centrale` — 56 reactors into
 *    18 sites, 19 thermal units into 10 — and the unit count is carried as a
 *    fact rather than dropped. Hydro's unit count is `null`, NOT 1: the file
 *    says nothing about how many groups a plant contains, and "1 unit" would
 *    be an invention.
 *
 * 3. **`reserve_secondaire_maximale` IS A SITE FIGURE REPEATED ON EVERY UNIT
 *    ROW.** Measured: all 28 multi-unit sites publish one identical value
 *    across their rows — Cattenom's four rows each say 60 MW. Summing them
 *    would claim 240 MW of reserve at a site that offers 60. It is therefore
 *    taken as the distinct value across the site's rows, never as a total, and
 *    left null where the file leaves it null (23 of 51 hydro plants).
 *
 * 4. **THE THREE FILES ARE THREE DIFFERENT VINTAGES.** Nuclear is a *vision
 *    consolidée au 31/12/2025*; hydro and thermal are *au 31/12/2023*. Their
 *    sum is a capacity that never existed at any single instant, so each site
 *    carries its own file's reference date and the layer reports the range
 *    rather than one authoritative "as of".
 *
 * ── Sign and unit conventions, stated once ──────────────────────────────────
 * `puissance_installee` is INSTALLED (nameplate) capacity in MW — what a site
 * can produce, never what it is producing. It is an integer in the nuclear and
 * thermal files and a float in the hydro one (Sainte-Croix is 132.27 MW), so
 * it is carried at full precision and only rounded for display.
 *
 * @module data/edfPlantsFeed
 */

// The same numeric coercion the éCO2mix feed uses, imported rather than
// re-typed: it accepts the string form these portals sometimes publish, and it
// refuses to fold `''` and `null` to 0 — "not published" and "zero megawatts"
// are different facts, and Brennilis really does publish a 0 MW reserve.
import { megawatts as numeric } from './eco2mixFeed.js';

/**
 * The three EDF Open Data datasets, in the order the legend reads best
 * (largest filière first).
 *
 * `granularity` is the single most load-bearing field here: it says whether a
 * published row is a whole plant or one unit inside one, and therefore whether
 * a unit count exists to report at all. See trap 2.
 *
 * `kindField` names the column that answers "what kind of object is this",
 * which is a different column in each file: the reactor series for nuclear,
 * the water regime for hydro, the fuel burnt for thermal. It is picked per
 * dataset rather than by falling back through the columns, because the nuclear
 * file ALSO publishes a fuel (`Uranium Enrichi` / `Multi-oxyde d'uranium et de
 * plutonium`) and labelling Gravelines by its fuel mix instead of its palier
 * would answer a question nobody asked.
 */
export const EDF_DATASETS = Object.freeze([
  Object.freeze({
    key: 'nucleaire',
    slug: 'centrales-de-production-nucleaire-edf',
    label: 'Nucléaire',
    granularity: 'unit',
    kindField: 'sous_filiere',
  }),
  Object.freeze({
    key: 'hydraulique',
    slug: 'centrales-de-production-hydraulique-de-edf-sa',
    label: 'Hydraulique',
    granularity: 'plant',
    kindField: 'categorie_centrale',
  }),
  Object.freeze({
    key: 'thermique',
    slug: 'centrales-de-production-thermique-a-flamme-d-edf-sa-fioul-gaz-charbon',
    label: 'Thermique à flamme',
    granularity: 'unit',
    kindField: 'combustible',
  }),
]);

/**
 * Sanity box for a parsed coordinate — metropolitan France with a margin.
 *
 * This is a PARSE CHECK, not a statement of coverage: it exists so an x/y swap
 * or a truncated string fails loudly instead of drawing a power station in the
 * Indian Ocean. Corsica falls inside this box and is still absent from all
 * three datasets, which is the publisher's declared scope, not this filter.
 */
export const FRANCE_BOX = Object.freeze({
  minLat: 41.0, maxLat: 51.5, minLon: -5.5, maxLon: 9.8,
});

/**
 * Parse the `"lat, lon"` string the nuclear and thermal files publish.
 *
 * Deliberately strict about the pair being two finite numbers, and deliberately
 * tolerant about the whitespace around the comma — the same field is written
 * `"47.508946, 2.875676"` in the raw row and `"45.6452741068,6.44492758326"`
 * in the platform's derived `_geopoint`.
 * @param {unknown} raw
 * @returns {[number, number]|null} `[lat, lon]`, or null.
 */
export function parseGpsPair(raw) {
  if (typeof raw !== 'string') return null;
  const parts = raw.split(',');
  if (parts.length !== 2) return null;
  const lat = numeric(parts[0]);
  const lon = numeric(parts[1]);
  if (lat === null || lon === null) return null;
  return [lat, lon];
}

/**
 * Resolve one row's position from whichever of the two shapes it publishes.
 *
 * See trap 1: `coordonnees_x_wgs` is the LATITUDE. A point outside
 * `FRANCE_BOX` is rejected rather than drawn, because every plausible failure
 * here (a swap, a decimal-comma locale, a truncated string) produces a point
 * that is confidently somewhere else on Earth.
 * @param {object|null|undefined} row Raw EDF row.
 * @returns {{lat:number, lon:number}|null}
 */
export function plantPosition(row) {
  const pair = parseGpsPair(row?.point_gps_wsg84);
  const lat = pair ? pair[0] : numeric(row?.coordonnees_x_wgs);
  const lon = pair ? pair[1] : numeric(row?.coordonnees_y_wgs);
  if (lat === null || lon === null) return null;
  if (lat < FRANCE_BOX.minLat || lat > FRANCE_BOX.maxLat) return null;
  if (lon < FRANCE_BOX.minLon || lon > FRANCE_BOX.maxLon) return null;
  return { lat, lon };
}

/**
 * Shorten a `sous_filiere` to the acronym the publisher put in its own
 * parentheses, keeping whatever qualifies it.
 *
 *   "Réacteur à eau pressurisée (REP) 1300" → "REP 1300"
 *   "Turbine à Combustion (TAC)"            → "TAC"
 *   "Gaz"                                   → "Gaz"
 *
 * A string with no parenthesised acronym is returned as published — this
 * abbreviates the publisher's own words and never invents an acronym.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function shortenSousFiliere(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const match = text.match(/\(([^)]+)\)\s*(.*)$/);
  if (!match) return text;
  return `${match[1].trim()} ${match[2].trim()}`.trim();
}

/**
 * Fold a région label into a comparison key.
 *
 * The three files write the same région three different ways: hydro publishes
 * `nom_reg` as `"Provence-Alpes-Côte d'Azur"` and carries no INSEE code, while
 * nuclear and thermal publish `region` as `"PROVENCE-ALPES-COTE D'AZUR"` next
 * to `code_insee_region`. Grouping on the raw strings would silently split one
 * région in two. This key is for JOINING ONLY — the record keeps whichever
 * spelling its own publisher used, because correcting a name is not this
 * layer's job.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function foldRegionKey(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, ' ')
    .replace(/[\s-]+/g, ' ')
    .trim()
    .toUpperCase() || null;
}

/**
 * Read the commissioning year out of either shape.
 *
 * Hydro publishes `annee_de_mise_en_service` as an integer year (1932 for
 * Kembs); nuclear and thermal publish `date_de_mise_en_service_industrielle`
 * as an ISO date. Only the year is kept, because only the year is comparable
 * across the three.
 * @param {object|null|undefined} row
 * @returns {number|null}
 */
export function commissioningYear(row) {
  const year = numeric(row?.annee_de_mise_en_service);
  if (year !== null) return Math.trunc(year);
  const iso = String(row?.date_de_mise_en_service_industrielle ?? '').trim();
  const match = iso.match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

/**
 * Collect the distinct non-empty values of one field across a site's rows,
 * in publication order.
 *
 * Used for the fields that are site-level but written onto every unit row
 * (fuel, sub-filière, secondary reserve). Returning a LIST rather than the
 * first row's value means that if EDF ever runs two fuels at one site, the
 * layer says "Gaz naturel + Charbon" instead of silently picking one.
 * @param {Array<object>} rows
 * @param {string} field
 * @returns {Array<string>}
 */
export function distinctValues(rows, field) {
  const seen = [];
  for (const row of rows) {
    const value = String(row?.[field] ?? '').trim();
    if (value && !seen.includes(value)) seen.push(value);
  }
  return seen;
}

/**
 * The site-level secondary reserve, or null.
 *
 * See trap 3: the value is repeated identically on every unit row of a site,
 * so it is READ, never summed. Rows that disagree — which no site currently
 * does — collapse to null rather than to a guess.
 * @param {Array<object>} rows
 * @returns {number|null}
 */
export function siteSecondaryReserve(rows) {
  const values = new Set();
  for (const row of rows) {
    const mw = numeric(row?.reserve_secondaire_maximale);
    if (mw !== null) values.add(mw);
  }
  return values.size === 1 ? [...values][0] : null;
}

/**
 * Group one dataset's rows into site records.
 *
 * @param {Array<object>|null|undefined} rows Raw rows from `…/lines`.
 * @param {{key:string,label:string,granularity:string,kindField:string}} spec
 * @param {{referenceDate?:string|null}} [context] The file's own vintage.
 * @returns {{sites:Array<object>, rows:number, positioned:number}}
 */
export function projectDataset(rows, spec, context = {}) {
  /** @type {Map<string, {position:{lat:number,lon:number}, rows:Array<object>}>} */
  const grouped = new Map();
  let positioned = 0;
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    const name = String(row?.centrale ?? '').trim();
    const position = plantPosition(row);
    if (!name || !position) continue;
    positioned += 1;
    const existing = grouped.get(name);
    // Every unit of a site publishes the same coordinate (verified: 0 of the
    // 28 multi-unit sites disagree), so the first placed row's point IS the
    // site's and the rest only add capacity.
    if (existing) existing.rows.push(row);
    else grouped.set(name, { position, rows: [row] });
  }

  const sites = [];
  for (const [name, { position, rows: siteRows }] of grouped) {
    let mw = null;
    for (const row of siteRows) {
      const value = numeric(row?.puissance_installee);
      if (value !== null) mw = (mw ?? 0) + value;
    }
    const years = siteRows.map(commissioningYear).filter((year) => year !== null);
    const fuels = distinctValues(siteRows, 'combustible');
    const categories = distinctValues(siteRows, 'categorie_centrale');
    const techs = distinctValues(siteRows, 'sous_filiere').map(shortenSousFiliere).filter(Boolean);
    // What this object IS, in the publisher's own vocabulary — never a word
    // this layer made up. `sous_filiere` is abbreviated to the acronym the
    // publisher itself parenthesised; the other two columns pass through.
    const kindValues = spec.kindField === 'sous_filiere'
      ? techs
      : distinctValues(siteRows, spec.kindField);
    const kind = kindValues.join(' + ') || null;
    const region = String(siteRows[0]?.nom_reg ?? siteRows[0]?.region ?? '').trim() || null;
    sites.push({
      id: `${spec.key}:${name}`,
      filiere: spec.key,
      name,
      lat: position.lat,
      lon: position.lon,
      mw,
      // Null for hydro on purpose — see trap 2.
      units: spec.granularity === 'unit' ? siteRows.length : null,
      kind,
      tech: techs.join(' + ') || null,
      fuel: fuels.join(' + ') || null,
      category: categories.join(' + ') || null,
      operator: String(siteRows[0]?.perimetre_juridique ?? '').trim() || null,
      commune: String(siteRows[0]?.commune ?? '').trim() || null,
      departement: String(siteRows[0]?.departement ?? '').trim() || null,
      region,
      regionKey: foldRegionKey(region),
      commissionedFrom: years.length ? Math.min(...years) : null,
      commissionedTo: years.length ? Math.max(...years) : null,
      secondaryReserveMw: siteSecondaryReserve(siteRows),
      // The vintage of the file this site came from, carried per site because
      // the three files do not share one. See trap 4.
      referenceDate: context.referenceDate ?? null,
    });
  }
  return { sites, rows: list.length, positioned };
}

/**
 * Read the fields the layer needs out of one data-fair dataset descriptor.
 *
 * `temporal.end` is the reference date rather than the prose "vision
 * consolidée au …" buried in `description`: it is a structured field, and it
 * agrees with that sentence in all three files (verified 2026-08-27 —
 * 2025-12-31 for nuclear, 2023-12-31 for hydro and thermal). A missing field
 * stays null; Licence Ouverte obliges the producer and the date, so neither is
 * ever guessed.
 * @param {object|null|undefined} meta Raw `…/datasets/{slug}` body.
 * @param {{key:string,slug:string,label:string}} spec
 * @returns {object}
 */
export function describeDataset(meta, spec) {
  const text = (value) => { const t = String(value ?? '').trim(); return t || null; };
  const count = numeric(meta?.count);
  return {
    key: spec.key,
    slug: text(meta?.slug) || spec.slug,
    label: spec.label,
    title: text(meta?.title),
    licence: text(meta?.license?.title),
    licenceUrl: text(meta?.license?.href),
    page: text(meta?.page),
    referenceDate: text(meta?.temporal?.end),
    dataUpdatedAt: text(meta?.dataUpdatedAt),
    frequency: text(meta?.frequency),
    publishedCount: count === null ? null : Math.trunc(count),
  };
}

/**
 * Project the three raw dataset responses into the compact document the proxy
 * serves.
 *
 * Any of the three may be missing: a filière that failed to fetch is reported
 * as absent rather than as an empty fleet, and the two that arrived are still
 * served. The caller decides whether to merge a partial refresh over its
 * previous cache.
 *
 * @param {Record<string, {meta?:object|null, lines?:object|null}|null|undefined>} payloads
 *   Keyed by `EDF_DATASETS[].key`.
 * @param {string} source Human-readable origin, surfaced to the client.
 * @returns {{source:string, sites:Array<object>, datasets:Array<object>, totals:object}}
 */
export function projectEdfPlants(payloads, source) {
  const sites = [];
  const datasets = [];
  for (const spec of EDF_DATASETS) {
    const payload = payloads?.[spec.key];
    if (!payload?.lines) continue;
    const descriptor = describeDataset(payload.meta, spec);
    const projected = projectDataset(
      payload.lines?.results,
      spec,
      { referenceDate: descriptor.referenceDate },
    );
    const published = numeric(payload.lines?.total);
    datasets.push({
      ...descriptor,
      receivedRows: projected.rows,
      positionedRows: projected.positioned,
      siteCount: projected.sites.length,
      // A page that came back short of its own declared total is reported, not
      // presented as the whole fleet.
      truncated: published !== null && projected.rows < published,
    });
    sites.push(...projected.sites);
  }
  // Biggest first: the render cap, the label cohort and the analyst snapshot
  // all read this order, and capacity is the one ranking this dataset states.
  sites.sort((a, b) => (b.mw ?? 0) - (a.mw ?? 0) || a.id.localeCompare(b.id));
  return { source, sites, datasets, totals: summarizeFleet(sites) };
}

/**
 * Roll the sites up into the fleet figures the HUD, the legend and the
 * analyst read.
 *
 * Capacities are summed at full precision and rounded once, at the end: adding
 * 51 already-rounded hydro plants loses half a megawatt for no reason.
 * @param {Array<object>|null|undefined} sites
 * @returns {{sites:number, units:number|null, capacityMw:number|null, byFiliere:object}}
 */
export function summarizeFleet(sites) {
  const labels = new Map(EDF_DATASETS.map((spec) => [spec.key, spec.label]));
  const byFiliere = {};
  let capacity = null;
  let units = null;
  let count = 0;
  for (const site of Array.isArray(sites) ? sites : []) {
    count += 1;
    const bucket = byFiliere[site.filiere] || (byFiliere[site.filiere] = {
      key: site.filiere,
      label: labels.get(site.filiere) || site.filiere,
      sites: 0,
      units: null,
      capacityMw: null,
    });
    bucket.sites += 1;
    if (Number.isFinite(site.mw)) {
      bucket.capacityMw = (bucket.capacityMw ?? 0) + site.mw;
      capacity = (capacity ?? 0) + site.mw;
    }
    if (Number.isFinite(site.units)) {
      bucket.units = (bucket.units ?? 0) + site.units;
      units = (units ?? 0) + site.units;
    }
  }
  for (const bucket of Object.values(byFiliere)) bucket.capacityMw = trimFloatTail(bucket.capacityMw);
  return { sites: count, units, capacityMw: trimFloatTail(capacity), byFiliere };
}

/**
 * Drop the binary-float tail a sum of decimals leaves behind (51 hydro plants
 * total 13778.960000000001), without touching the two decimals the publisher
 * actually printed.
 * @param {number|null} value
 * @returns {number|null}
 */
function trimFloatTail(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}
