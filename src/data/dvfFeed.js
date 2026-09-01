/**
 * DVF feed projection — France's register of what property actually sold for.
 *
 * WHAT THIS SOURCE IS. *Demandes de valeurs foncières*: every transaction the
 * tax administration recorded, published by Etalab in a geolocated form. It is
 * the file a French buyer opens by hand, one commune at a time, and it is the
 * only public answer to "what did the flat next door really go for".
 *
 * MEASURED against the live files on 2026-09-01, for Paris 13e (75113), 2024:
 *   - `GET files.data.gouv.fr/geo-dvf/latest/csv/2024/communes/75/75113.csv`
 *     → 200 after one redirect, **752,768 bytes**, 3,975 data rows, 40 columns,
 *       no quoted fields anywhere in the body
 *   - 1,736 distinct mutations behind those 3,975 rows
 *   - 8 rows carry no coordinate, 6 carry no `valeur_fonciere`
 *   - editions are published per year from 2021 onward
 *
 * THE TRAP THIS MODULE EXISTS FOR, AND IT IS A BIG ONE. **`valeur_fonciere`
 * belongs to the MUTATION, not to the row, and it is repeated on every row of
 * that mutation.** In the captured file, mutation `2024-1225294` — the sale of
 * one building — is spread over **179 rows**, each restating €32,000,000.
 * Summing the column yields €5.7 BILLION for a single Paris block. Dividing
 * that first row's €32,000,000 by its 25 m² flat yields €1.28 million per
 * square metre. Both numbers are catastrophic and both are what the obvious
 * code produces, so this projection groups by `id_mutation` FIRST and treats
 * the row as what it is: one lot inside a sale.
 *
 * WHY €/m² IS OFTEN `null` HERE. A price per square metre is only a comparable
 * when the sale bought exactly one dwelling. Across a 179-lot block sale the
 * ratio is an investor's yield metric, not the number a buyer is looking for,
 * and the register cannot tell us how the €32 M was split. So the ratio is
 * computed for single-dwelling mutations and left `null` otherwise. A null
 * that says "not comparable" is worth more than a number that is wrong.
 *
 * THE SECOND TRAP — WHICH COMMUNE CODE. These files are keyed per
 * ARRONDISSEMENT in Paris, Lyon and Marseille: the path is `75113.csv`, not
 * `75056.csv`. `geo.api.gouv.fr/communes?lat&lon` answers **75056** for any
 * Paris point, and so does the `commune.codeInsee` Géorisques echoes. The only
 * source measured to return `75113` is the BAN reverse geocoder's
 * `properties.citycode`, which is therefore the one this path is built from.
 *
 * Dependency-free and side-effect-free: URL construction, CSV parsing and
 * projection only. The `/api/dvf` proxy imports this; nothing in the browser
 * bundle does.
 */

const FILES_ROOT = 'https://files.data.gouv.fr/geo-dvf/latest/csv';

/** Earliest yearly edition published under `latest`. Measured 2026-09-01. */
export const DVF_FIRST_YEAR = 2021;
/** Default search radius in metres. A buyer's "next door", not a district. */
export const DVF_DEFAULT_RADIUS_M = 300;
/** Ceiling on the radius; past this the comparables stop being comparable. */
export const DVF_MAX_RADIUS_M = 1000;
/** Ceiling on sales served in one answer. */
export const DVF_MAX_SALES = 400;

/**
 * Local types the register prices as a dwelling. `Dépendance` (1,948 of the
 * 3,975 captured rows — the single most common type) is a cellar or a parking
 * space carrying no surface, and counting it as a home is how a block sale
 * turns into a thousand imaginary flats.
 */
export const DWELLING_TYPES = Object.freeze(['Appartement', 'Maison']);

/**
 * The local type that rides along with a dwelling without changing its price
 * basis. A Paris flat is almost always sold with its cellar or parking space:
 * of the 45 mutations within 300 m of the captured point, requiring a sale to
 * contain NOTHING but the dwelling left 10 comparables, while tolerating
 * `Dépendance` leaves 35. Excluding them would not have been conservative, it
 * would have thrown away three quarters of the market. A commercial local is a
 * different matter and still disqualifies the ratio: it prices on its own
 * terms and the register does not say how the total was split.
 */
export const ANCILLARY_TYPES = Object.freeze(['Dépendance']);

/**
 * The mutation natures whose `valeur_fonciere` is a PRICE, and so the only
 * ones a price per square metre may be computed from.
 *
 * Found by fixture, not by reading the spec: the captured file holds an
 * `Echange` of a Paris flat declared at **€2,295**, which divides to 66 €/m².
 * A swap's declared value is a balancing payment between two parties, not what
 * the flat is worth, and a single such row inside a thin radius drags a median
 * through the floor. `Adjudication` — a court-ordered auction — is excluded for
 * the neighbouring reason: it is a real price, but not one a buyer can compare
 * a normal listing against. Both are still RETURNED as sales, because they
 * happened; they simply carry `prixM2: null`.
 */
export const PRICED_NATURES = Object.freeze(['Vente', "Vente en l'état futur d'achèvement"]);

/**
 * Resolve the département directory a commune file lives under.
 *
 * Overseas codes are three digits (`97213`), Corsican ones carry a letter
 * (`2A004`); both are handled by the same two rules, so this is one function
 * rather than a special case at each call site.
 * @param {string} communeCode INSEE code, arrondissement-level where one exists.
 * @returns {string}
 */
export function departementOf(communeCode) {
  const code = String(communeCode || '').trim().toUpperCase();
  if (!/^[0-9][0-9AB][0-9]{3}$/.test(code)) throw new Error(`dvf: invalid commune code ${communeCode}`);
  return code.startsWith('97') ? code.slice(0, 3) : code.slice(0, 2);
}

/**
 * Build the URL of one commune-year edition.
 * @param {{year: number|string, communeCode: string}} query
 * @returns {string}
 */
export function buildDvfUrl({ year, communeCode }) {
  const parsedYear = Number.parseInt(String(year), 10);
  if (!Number.isFinite(parsedYear) || parsedYear < DVF_FIRST_YEAR) {
    throw new Error(`dvf: year ${year} is before the first published edition`);
  }
  const code = String(communeCode).trim().toUpperCase();
  return `${FILES_ROOT}/${parsedYear}/communes/${departementOf(code)}/${code}.csv`;
}

/**
 * Coerce a query value to a number, treating ABSENT as absent.
 *
 * `URLSearchParams.get()` returns `null` for a missing parameter, `Number(null)`
 * is `0`, and `Number.isFinite(0)` is true — so a plain `Number()` turns "the
 * caller said nothing" into "the caller said zero", and every clamp below then
 * returns its MINIMUM instead of its default. Measured live: `GET /api/dpe`
 * with no `radius` scanned 50 m rather than the documented 200 m, and returned
 * `total: 0` for an address with 2,805 diagnostics around it. Same root cause
 * as the `addressPoint` guard in `vite.config.js`.
 *
 * @param {unknown} value
 * @returns {number|null} A finite number, or null when nothing usable was given.
 */
function requestedNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Clamp a requested radius into the range this layer will serve.
 * @param {unknown} value
 * @returns {number}
 */
export function clampDvfRadius(value) {
  const requested = requestedNumber(value);
  if (requested === null) return DVF_DEFAULT_RADIUS_M;
  return Math.min(DVF_MAX_RADIUS_M, Math.max(50, Math.round(requested)));
}

/**
 * Parse a DVF CSV body into row objects.
 *
 * The captured file holds no quoted field at all, so a `split(',')` would work
 * today. Quotes are honoured anyway because a street name containing a comma
 * would not fail loudly — it would shift every later column by one and publish
 * a longitude as a surface, which is the kind of wrong that survives review.
 * @param {string} text
 * @returns {Array<Record<string, string>>}
 */
export function parseDvfCsv(text) {
  const body = String(text ?? '');
  if (!body.trim()) return [];
  const rows = [];
  let header = null;
  let field = '';
  let record = [];
  let quoted = false;
  const endField = () => { record.push(field); field = ''; };
  const endRecord = () => {
    endField();
    if (record.length > 1 || record[0] !== '') {
      if (!header) header = record;
      else rows.push(Object.fromEntries(header.map((key, i) => [key, record[i] ?? ''])));
    }
    record = [];
  };
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (quoted) {
      if (char === '"') {
        if (body[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { endField(); continue; }
    if (char === '\n') { endRecord(); continue; }
    if (char === '\r') continue;
    field += char;
  }
  if (field !== '' || record.length) endRecord();
  return rows;
}

/** Parse a numeric CSV cell, treating an empty cell as absent rather than 0. */
function num(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Group rows into mutations — the unit a price actually belongs to.
 *
 * Each mutation keeps its lot composition (how many dwellings, how much
 * surface, which types) because that composition is what decides whether a
 * price per square metre means anything. The position is taken from the first
 * row that carries one; 8 of 3,975 captured rows carry none, and a mutation
 * where no row does is returned with `lon`/`lat` null rather than dropped, so
 * a caller can still count it.
 *
 * @param {Array<Record<string, string>>} rows
 * @returns {Array<object>} One entry per `id_mutation`.
 */
export function groupMutations(rows) {
  const byId = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.id_mutation || '').trim();
    if (!id) continue;
    let mutation = byId.get(id);
    if (!mutation) {
      mutation = {
        id,
        date: row.date_mutation || null,
        nature: row.nature_mutation || null,
        // Restated identically on every row of the sale; read once.
        valeur: num(row.valeur_fonciere),
        commune: row.nom_commune || null,
        communeCode: row.code_commune || null,
        address: [row.adresse_numero, row.adresse_suffixe, row.adresse_nom_voie]
          .filter((part) => part && String(part).trim()).join(' ') || null,
        parcelle: row.id_parcelle || null,
        lon: null,
        lat: null,
        rowCount: 0,
        dwellingCount: 0,
        dwellingSurface: 0,
        ancillaryCount: 0,
        otherCount: 0,
        types: new Set(),
        rooms: null,
        terrain: 0,
      };
      byId.set(id, mutation);
    }
    mutation.rowCount += 1;
    const type = (row.type_local || '').trim();
    if (type) mutation.types.add(type);
    if (mutation.lon === null) {
      const lon = num(row.longitude);
      const lat = num(row.latitude);
      if (lon !== null && lat !== null) { mutation.lon = lon; mutation.lat = lat; }
    }
    const surface = num(row.surface_reelle_bati);
    if (DWELLING_TYPES.includes(type)) {
      mutation.dwellingCount += 1;
      if (surface !== null) mutation.dwellingSurface += surface;
      const rooms = num(row.nombre_pieces_principales);
      if (mutation.rooms === null && rooms !== null) mutation.rooms = rooms;
    } else if (ANCILLARY_TYPES.includes(type)) {
      mutation.ancillaryCount += 1;
    } else if (type) {
      mutation.otherCount += 1;
    }
    const terrain = num(row.surface_terrain);
    if (terrain !== null) mutation.terrain += terrain;
  }
  return [...byId.values()].map((mutation) => ({
    ...mutation,
    types: [...mutation.types].sort(),
    // The ratio is a comparable ONLY for a sale that bought exactly one
    // dwelling, with or without its cellar. A 179-lot building or a flat sold
    // together with a shop gets null — see ANCILLARY_TYPES for why the cellar
    // is the one companion that does not disqualify the ratio.
    prixM2: mutation.dwellingCount === 1 && mutation.dwellingSurface > 0
      && mutation.valeur !== null && mutation.otherCount === 0
      && PRICED_NATURES.includes(mutation.nature)
      ? Math.round(mutation.valeur / mutation.dwellingSurface)
      : null,
  }));
}

/** Great-circle distance in metres. */
function haversineM(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Percentile of a sorted numeric array, linearly interpolated.
 * @param {number[]} sorted @param {number} fraction
 * @returns {number|null}
 */
export function percentile(sorted, fraction) {
  if (!Array.isArray(sorted) || sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sorted[low];
  return Math.round(sorted[low] + (sorted[high] - sorted[low]) * (position - low));
}

/**
 * Select the mutations within `radiusM` of a point and summarise them.
 *
 * The summary reports `comparableCount` beside `count` on purpose: a reader
 * must be able to see that 40 sales were found but only 12 of them yielded a
 * defensible price per square metre. Collapsing that gap would present a
 * median computed from a quarter of the data as if it came from all of it.
 *
 * @param {Array<object>} mutations Output of {@link groupMutations}.
 * @param {{lon: number, lat: number}} origin
 * @param {number} radiusM
 * @returns {{sales: Array<object>, summary: object}}
 */
export function selectNearbySales(mutations, origin, radiusM) {
  const radius = clampDvfRadius(radiusM);
  const near = [];
  for (const mutation of Array.isArray(mutations) ? mutations : []) {
    if (mutation.lon === null || mutation.lat === null) continue;
    const distanceM = haversineM(origin.lat, origin.lon, mutation.lat, mutation.lon);
    if (distanceM > radius) continue;
    near.push({ ...mutation, distanceM: Math.round(distanceM) });
  }
  near.sort((a, b) => a.distanceM - b.distanceM);
  const served = near.slice(0, DVF_MAX_SALES);
  const ratios = near.map((sale) => sale.prixM2).filter((value) => value !== null).sort((a, b) => a - b);
  const perYear = {};
  for (const sale of near) {
    const year = String(sale.date || '').slice(0, 4);
    if (!year) continue;
    (perYear[year] ||= []).push(sale.prixM2);
  }
  return {
    sales: served,
    summary: {
      count: near.length,
      served: served.length,
      truncated: near.length > served.length,
      comparableCount: ratios.length,
      medianPrixM2: percentile(ratios, 0.5),
      p25PrixM2: percentile(ratios, 0.25),
      p75PrixM2: percentile(ratios, 0.75),
      radiusM: radius,
      perYear: Object.fromEntries(Object.entries(perYear).map(([year, values]) => {
        const usable = values.filter((value) => value !== null).sort((a, b) => a - b);
        return [year, { count: values.length, comparableCount: usable.length, medianPrixM2: percentile(usable, 0.5) }];
      })),
    },
  };
}
