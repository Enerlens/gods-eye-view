/**
 * éCO2mix feed projection — the seam between the raw ODRÉ records and what the
 * browser is served.
 *
 * Lives here rather than inside `vite.config.js` for the same reason
 * `meteoFranceVigilanceFeed.js` does: this product mixes types on
 * purpose-looking fields, and only a test against a real captured payload
 * keeps that honest. The dev-server proxy imports `projectEco2mix`; nothing in
 * the browser bundle does.
 *
 * ── The two datasets ────────────────────────────────────────────────────────
 * `eco2mix-national-tr`  — one row per 15 minutes for France (hors Corse):
 *                          load, eight generation filières, the CO₂ content of
 *                          the kWh, and the five commercial border balances.
 * `eco2mix-regional-tr`  — the same 15-minute cadence for the 12 metropolitan
 *                          regions, with a COARSER filière split.
 *
 * MEASURED against both live datasets on 2026-08-27: national 200, ~1 KB,
 * 0.30 s, 5 512 non-null rows in the rolling window; regional 200, 66 144 rows,
 * all 12 regions sharing one `date_heure`. Latest point at fetch time was
 * 07:45Z against a 07:53Z wall clock — an ~8 minute publication lag on a
 * 15-minute product.
 *
 * ── Three traps this projection exists to absorb ────────────────────────────
 *
 * 1. THE ROLLING WINDOW IS PADDED WITH THE FUTURE. `order_by=date_heure desc`
 *    alone returns tomorrow's rows, which carry `prevision_j1` and NOTHING
 *    else — every measured field is null. A client reading "the latest row"
 *    shows an empty mix. Both upstream queries therefore filter on
 *    `consommation IS NOT NULL`, and this projection filters again, because a
 *    query is a request and a null check is a guarantee.
 *
 * 2. THE SAME FIELD IS AN INT NATIONALLY AND A STRING REGIONALLY. `pompage`
 *    is `-66` in the national row and `"0"` in the regional one; so are
 *    `stockage_batterie` and `destockage_batterie`. Every numeric read goes
 *    through `megawatts()`.
 *
 * 3. THE TWO FILIÈRE SPLITS DO NOT MATCH. National separates `gaz`, `fioul`
 *    and `charbon`; regional rolls all three into `thermique`. They are kept
 *    as two distinct tables rather than reconciled — inventing a regional
 *    `gaz` figure the publisher does not publish would be fabrication.
 *
 * ── Sign convention, stated once ────────────────────────────────────────────
 * `ech_physiques` is published as CONSUMPTION MINUS GENERATION, so it is
 * NEGATIVE for a net exporter. Verified arithmetically against the captured
 * national row: filières 50 831 MW + pompage −66 = 50 765 generated against
 * 47 132 consumed, and the row's own `ech_physiques` is −3 633. The same holds
 * regionally (Auvergne-Rhône-Alpes −7 781, Île-de-France +6 478).
 *
 * The five `ech_comm_*` fields follow the same sign — negative is an export
 * from France — but they are COMMERCIAL nominations, not measured flow, and
 * they do NOT sum to `ech_physiques`: the captured row nets −2 893 commercially
 * against −3 633 physically. Both numbers are published, both are correct, and
 * the layer must never present one as the other.
 */

/**
 * National generation filières, in ODRÉ's field names and RTE's own French
 * labels. Order is the éCO2mix stack order (base load first), which is also
 * the order the legend reads best in.
 *
 * `pompage` is deliberately absent: it is consumption by pumped-storage
 * turbines running backwards, published as a negative, and stacking it as a
 * generation filière would double-count it against `hydraulique`.
 */
export const NATIONAL_FILIERES = Object.freeze([
  Object.freeze({ key: 'nucleaire', field: 'nucleaire', label: 'Nucléaire', lowCarbon: true }),
  Object.freeze({ key: 'hydraulique', field: 'hydraulique', label: 'Hydraulique', lowCarbon: true }),
  Object.freeze({ key: 'eolien', field: 'eolien', label: 'Éolien', lowCarbon: true }),
  Object.freeze({ key: 'solaire', field: 'solaire', label: 'Solaire', lowCarbon: true }),
  Object.freeze({ key: 'bioenergies', field: 'bioenergies', label: 'Bioénergies', lowCarbon: true }),
  Object.freeze({ key: 'gaz', field: 'gaz', label: 'Gaz', lowCarbon: false }),
  Object.freeze({ key: 'charbon', field: 'charbon', label: 'Charbon', lowCarbon: false }),
  Object.freeze({ key: 'fioul', field: 'fioul', label: 'Fioul', lowCarbon: false }),
]);

/**
 * Regional generation filières. `thermique` is the publisher's own roll-up of
 * gas + coal + oil — see trap 3 in the module header.
 */
export const REGIONAL_FILIERES = Object.freeze([
  Object.freeze({ key: 'nucleaire', field: 'nucleaire', label: 'Nucléaire', lowCarbon: true }),
  Object.freeze({ key: 'hydraulique', field: 'hydraulique', label: 'Hydraulique', lowCarbon: true }),
  Object.freeze({ key: 'eolien', field: 'eolien', label: 'Éolien', lowCarbon: true }),
  Object.freeze({ key: 'solaire', field: 'solaire', label: 'Solaire', lowCarbon: true }),
  Object.freeze({ key: 'bioenergies', field: 'bioenergies', label: 'Bioénergies', lowCarbon: true }),
  Object.freeze({ key: 'thermique', field: 'thermique', label: 'Thermique fossile', lowCarbon: false }),
]);

/**
 * The five commercial border balances, in ODRÉ's field names.
 *
 * `ech_comm_allemagne_belgique` is ONE field for TWO countries — RTE publishes
 * the German and Belgian balances together — so it is carried as one entry
 * with both countries named, never split into an invented pair.
 */
export const BORDER_EXCHANGES = Object.freeze([
  Object.freeze({ key: 'angleterre', field: 'ech_comm_angleterre', label: 'Angleterre' }),
  Object.freeze({ key: 'espagne', field: 'ech_comm_espagne', label: 'Espagne' }),
  Object.freeze({ key: 'italie', field: 'ech_comm_italie', label: 'Italie' }),
  Object.freeze({ key: 'suisse', field: 'ech_comm_suisse', label: 'Suisse' }),
  Object.freeze({
    key: 'allemagne_belgique',
    field: 'ech_comm_allemagne_belgique',
    label: 'Allemagne + Belgique',
  }),
]);

/**
 * Coerce an ODRÉ numeric field to a finite number, or null.
 *
 * Accepts the string form because the regional dataset publishes `pompage`,
 * `stockage_batterie` and `destockage_batterie` as strings while the national
 * one publishes ints (trap 2). Rejects `''` and `null` rather than folding
 * them to 0 — "not published" and "zero megawatts" are different facts, and
 * `Number('')` is 0.
 * @param {unknown} raw
 * @returns {number|null}
 */
export function megawatts(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Sum the filière fields present on a row.
 *
 * Absent filières are skipped, not zeroed: a row missing `solaire` at 03:00
 * and a row publishing `solaire: 0` are the same physical fact, but a row
 * missing EVERY filière is a broken row and must total null, not 0.
 * @param {object} row
 * @param {ReadonlyArray<{key:string, field:string, label:string, lowCarbon:boolean}>} filieres
 * @returns {{total:number|null, lowCarbon:number|null, mix:Array<{key:string,label:string,mw:number,lowCarbon:boolean}>}}
 */
export function summarizeMix(row, filieres) {
  const mix = [];
  let total = null;
  let lowCarbon = null;
  for (const filiere of filieres) {
    const mw = megawatts(row?.[filiere.field]);
    if (mw === null) continue;
    total = (total ?? 0) + mw;
    if (filiere.lowCarbon) lowCarbon = (lowCarbon ?? 0) + mw;
    mix.push({ key: filiere.key, label: filiere.label, mw, lowCarbon: filiere.lowCarbon });
  }
  // Largest first, so a client that shows three shows the three that matter.
  mix.sort((a, b) => b.mw - a.mw || a.key.localeCompare(b.key));
  return { total, lowCarbon, mix };
}

/**
 * Is this row a measured observation rather than the forecast padding at the
 * head of the rolling window? See trap 1.
 * @param {object|null|undefined} row
 * @returns {boolean}
 */
export function isMeasuredRow(row) {
  return megawatts(row?.consommation) !== null && Boolean(String(row?.date_heure ?? '').trim());
}

/**
 * Project the newest measured national row.
 * @param {Array<object>|null|undefined} rows Raw ODRÉ `results`.
 * @returns {object|null}
 */
export function projectNational(rows) {
  const row = (Array.isArray(rows) ? rows : []).filter(isMeasuredRow)
    .sort((a, b) => String(b.date_heure).localeCompare(String(a.date_heure)))[0];
  if (!row) return null;

  const load = megawatts(row.consommation);
  const { total, lowCarbon, mix } = summarizeMix(row, NATIONAL_FILIERES);
  const pumping = megawatts(row.pompage);
  const exchanges = [];
  for (const border of BORDER_EXCHANGES) {
    const mw = megawatts(row[border.field]);
    if (mw === null) continue;
    exchanges.push({ key: border.key, label: border.label, mw });
  }
  // Largest absolute flow first — the biggest arc is the one worth reading.
  exchanges.sort((a, b) => Math.abs(b.mw) - Math.abs(a.mw) || a.key.localeCompare(b.key));

  return {
    at: String(row.date_heure).trim(),
    load,
    // gCO₂/kWh of the electricity consumed. National only — RTE publishes no
    // regional carbon content, so the layer must not paint one.
    co2: megawatts(row.taux_co2),
    generation: total,
    lowCarbon,
    pumping,
    mix,
    netPhysical: megawatts(row.ech_physiques),
    netCommercial: exchanges.length
      ? exchanges.reduce((sum, entry) => sum + entry.mw, 0)
      : null,
    exchanges,
  };
}

/**
 * Project the newest measured row PER REGION.
 *
 * The 12 regions normally share one `date_heure`, but they are published as 12
 * independent rows and a single region can lag. Keeping the newest row per
 * region — rather than taking every row at the newest timestamp — means one
 * late region shows its own last known state instead of blanking, and the
 * per-region `at` says exactly how old that state is.
 *
 * @param {Array<object>|null|undefined} rows Raw ODRÉ `results`.
 * @returns {Array<object>} One record per region, largest absolute balance first.
 */
export function projectRegional(rows) {
  /** @type {Map<string, object>} */
  const newest = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isMeasuredRow(row)) continue;
    const code = String(row.code_insee_region ?? '').trim();
    if (!code) continue;
    const previous = newest.get(code);
    if (previous && String(previous.date_heure) >= String(row.date_heure)) continue;
    newest.set(code, row);
  }

  const records = [];
  for (const [code, row] of newest) {
    const load = megawatts(row.consommation);
    const { total, lowCarbon, mix } = summarizeMix(row, REGIONAL_FILIERES);
    records.push({
      code,
      name: String(row.libelle_region ?? '').trim() || code,
      at: String(row.date_heure).trim(),
      load,
      generation: total,
      lowCarbon,
      pumping: megawatts(row.pompage),
      mix,
      netPhysical: megawatts(row.ech_physiques),
    });
  }
  records.sort((a, b) => Math.abs(b.netPhysical ?? 0) - Math.abs(a.netPhysical ?? 0)
    || a.code.localeCompare(b.code));
  return records;
}

/**
 * Project one national + one regional ODRÉ response into the compact document
 * the proxy serves.
 *
 * Either half may be null: a regional outage must not take the national gauge
 * down, and vice versa. The client reads whichever arrived.
 *
 * @param {{national?: object|null, regional?: object|null}} payloads Raw ODRÉ bodies.
 * @param {string} source Human-readable origin, surfaced to the client.
 * @returns {{source:string, national:object|null, regions:Array<object>, regionCount:number}}
 */
export function projectEco2mix(payloads, source) {
  const national = projectNational(payloads?.national?.results);
  const regions = projectRegional(payloads?.regional?.results);
  return { source, national, regions, regionCount: regions.length };
}
