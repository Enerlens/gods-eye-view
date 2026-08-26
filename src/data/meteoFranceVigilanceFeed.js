/**
 * Météo-France Vigilance feed projection — the seam between the raw
 * `CDP_CARTE_EXTERNE` product and what the browser is served.
 *
 * Lives here rather than inside `vite.config.js` for the same reason
 * `firmsCsv.js` does: this product has several traps that only a test against
 * a real captured payload will keep honest. The dev-server proxy imports
 * `projectVigilanceProduct`; nothing in the browser bundle does.
 *
 * The upstream JSON is 219 KB served without gzip; the globe needs about 6 KB
 * of it — one colour per domain per échéance.
 */

/**
 * `phenomenon_id` → the phenomenon's name, verbatim from the Météo-France
 * technical spec ("Valeurs du champ phenomenon_id").
 *
 * Note 2 is *pluie* and 4 is *crues* — 4 is river flooding specifically, the
 * SCHAPI/Vigicrues item, not rainfall. The set present is SEASONAL and never
 * all nine: an August payload carried {1,2,3,4,5,6,9} and a January one
 * {1,2,3,4,5,7,8,9}. A fixed nine-slot renderer shows blanks half the year.
 */
export const VIGILANCE_PHENOMENA = Object.freeze({
  1: 'Vent violent',
  2: 'Pluie-inondation',
  3: 'Orages',
  4: 'Crues',
  5: 'Neige-verglas',
  6: 'Canicule',
  7: 'Grand froid',
  8: 'Avalanches',
  9: 'Vagues-submersion',
});

/**
 * A phenomenon at or above this colour is a warning. Level 1 (vert) means
 * "nothing to report", so carrying it would be carrying the absence of news.
 */
export const VIGILANCE_WARNING_COLOR = 2;

/**
 * Coerce a colour field to an integer in 1..4, or null.
 *
 * The product mixes types on purpose-looking fields: `global_max_color_id` is
 * a JSON *string* while `max_color_id`, `phenomenon_max_color_id` and
 * `color_id` are ints, and `phenomenon_id` is a string here but an int in some
 * republications. Anything strict blows up on the first one.
 * @param {unknown} raw
 * @returns {number|null}
 */
export function vigilanceColorId(raw) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 4 ? value : null;
}

/**
 * Project one `CDP_CARTE_EXTERNE` product into the compact document the proxy
 * serves.
 *
 * Periods are keyed by their `echeance` value and NEVER read by array index:
 * between 00:00 and 06:00 Paris the product carries only a `J` block, so
 * `periods[1]` throws for six hours every night — the exact hours when a
 * night-time escalation matters most.
 *
 * Every domain is passed through, including the national `FRA`, the seven
 * `ZDF_*` defence zones, the 25 `dd10` coastal strips and Andorra's `99`.
 * Filtering happens on the client, against the 96 codes in the bundled
 * département polygons — a whitelist of real shapes, rather than a regex that
 * `99` would sail straight through.
 *
 * @param {object|null|undefined} payload Raw product JSON.
 * @param {string} source Human-readable origin, surfaced to the client.
 * @returns {{source:string, updateTime:string|null, reference:string|null,
 *   national:number|null, periods:Record<string, object>}}
 */
export function projectVigilanceProduct(payload, source) {
  const product = payload?.product || {};
  const periods = {};

  for (const period of Array.isArray(product.periods) ? product.periods : []) {
    const echeance = String(period?.echeance ?? '').trim().toUpperCase();
    if (echeance !== 'J' && echeance !== 'J1') continue;

    const domains = {};
    for (const domain of period?.timelaps?.domain_ids || []) {
      const id = String(domain?.domain_id ?? '').trim();
      if (!id) continue;
      const phenomena = [];
      for (const item of domain?.phenomenon_items || []) {
        const colorId = vigilanceColorId(item?.phenomenon_max_color_id);
        if (colorId === null || colorId < VIGILANCE_WARNING_COLOR) continue;
        const phenomenonId = String(item?.phenomenon_id ?? '').trim();
        if (!phenomenonId) continue;
        phenomena.push([phenomenonId, colorId]);
      }
      // Most severe first, so a client that shows only one shows the right one.
      phenomena.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      domains[id] = { c: vigilanceColorId(domain?.max_color_id), p: phenomena };
    }

    periods[echeance] = {
      // All timestamps are UTC even though the bulletin schedule is defined in
      // Paris local time, so "is this today?" is never a string slice.
      beginTime: String(period?.begin_validity_time ?? '').trim() || null,
      endTime: String(period?.end_validity_time ?? '').trim() || null,
      domains,
    };
  }

  return {
    source,
    updateTime: String(product.update_time ?? '').trim() || null,
    reference: String(payload?.meta?.snapshot_id ?? '').trim() || null,
    national: vigilanceColorId(product.global_max_color_id),
    periods,
  };
}
