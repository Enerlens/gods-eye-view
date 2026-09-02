/**
 * @module petiteEnfanceDepartements
 *
 * The national regime: the CNAF's coverage rate painted on the 96 bundled
 * metropolitan département polygons.
 *
 * ── Why this one joins by CODE where the other three fold by geometry ───────
 * `schoolsDepartements.js`, `supDepartements.js` and `irveDepartements.js` all
 * run point-in-polygon, because all three start from a register of POINTS and
 * have to decide which département each point falls in. This layer does not
 * have points. It has one published number per département, keyed by the
 * INSEE code, so the join is a lookup — and the only question that matters is
 * whether the two code sets agree.
 *
 * They agree exactly. Verified 2026-09-01 against both files: the CNAF
 * publishes `01`–`95` unpadded, Corsica as `2A`/`2B`, and the four DOM as
 * `971`–`974`; the bundled polygons carry the same 96 metropolitan spellings
 * character for character. **96 of the CNAF's 102 rows find a polygon on the
 * first try, with no zero-padding rule and no Corsica special case.**
 *
 * That is worth stating because the neighbouring layer had the opposite
 * result: `schoolsDepartements.js` records that the Annuaire zero-pads to
 * three characters (`028`, `045`) and would miss EVERY row on a code join.
 * Two French public files, two conventions, and the difference decides the
 * whole algorithm.
 *
 * ── What the 96 polygons cannot hold, and why it is the finding ─────────────
 * They are METROPOLITAN, so **6 of the CNAF's 102 rows are not painted**:
 * Guyane (973) at 13,4, Saint-Martin (978) at 30,2, La Réunion (974) at 38,5,
 * Guadeloupe (971) at 44,1, Saint-Barthélemy (977) at 47,5 and Martinique
 * (972) at 55,2. Mayotte is absent from the file entirely, which is why the
 * national row calls its perimeter *FRANCE ENTIERE HORS MAYOTTE*.
 *
 * Those six are not dropped and not snapped — a code join has nothing to snap
 * — they are returned as `unpainted` with their rates intact, because they are
 * not a rounding error in this layer, they are its headline. **Every one of
 * them is below the national rate, and Guyane sits at 22% of it — the lowest
 * coverage in France by a factor of three.** Meanwhile not one metropolitan
 * département lands in the lowest band: measured over the 96 painted, the
 * `tres-bas` bucket is EMPTY. A map that quietly stopped at the coastline
 * would therefore not merely omit six rows, it would delete the entire bottom
 * of the distribution and leave the reader with a France whose worst case is
 * merely below average.
 *
 * ── What the fill means ─────────────────────────────────────────────────────
 * Not a quantile. The band is a RATIO to the national rate the CNAF publishes
 * for the same edition, so the colour means the same thing here as it does on
 * the EPCI and commune points — see `PE_BAND_RATIOS` in `petiteEnfanceFeed.js`
 * for why three scales make quantiles the wrong choice.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
 */

import {
  PE_BANDS,
  PE_MODES,
  PE_SOURCE,
  dominantMode,
} from './petiteEnfanceFeed.js';

/** An empty per-band tally, in ramp order. */
function emptyBands() {
  return Object.fromEntries(PE_BANDS.map((band) => [band, 0]));
}

/**
 * Fold the départemental areas onto the bundled polygons.
 *
 * @param {object} input
 * @param {Array<object>} input.areas Areas from `projectPeAreas({scale:'dep'})`.
 * @param {{list:Array<object>, byCode:Map}} input.index From `buildDepartementIndex`.
 * @param {?number} input.national The edition's national rate.
 * @param {number} input.year
 * @returns {object} National rollup.
 */
export function projectPeDepartements({
  areas, index, national = null, year = null,
} = {}) {
  // Filtered to real objects ONCE, at the door. Every pass below reads
  // `area.code` unguarded, and a single null in the array — which is what a
  // half-failed upstream fetch looks like — would otherwise take the whole
  // national view down rather than costing one département.
  const rows = (Array.isArray(areas) ? areas : [])
    .filter((area) => area && typeof area === 'object' && area.code);
  const byCode = new Map();
  for (const area of rows) {
    byCode.set(String(area.code).trim().toUpperCase(), area);
  }

  const bands = emptyBands();
  const departements = [];
  const seen = new Set();
  let painted = 0;
  let placesPainted = 0;

  for (const entry of index?.list || []) {
    const code = String(entry.code).trim().toUpperCase();
    const area = byCode.get(code) || null;
    if (area) {
      seen.add(code);
      painted += 1;
      if (area.band) bands[area.band] += 1;
      if (Number.isFinite(area.totalPlaces)) placesPainted += area.totalPlaces;
    }
    departements.push({
      code: entry.code,
      name: area?.name || entry.name,
      areaKm2: entry.areaKm2 || 0,
      rate: area?.rate ?? null,
      band: area?.band ?? null,
      ratio: area?.ratio ?? null,
      modes: area?.modes ?? null,
      subtotals: area?.subtotals ?? null,
      dominant: area?.dominant ?? null,
      places: area?.places ?? null,
      totalPlaces: area?.totalPlaces ?? null,
      region: area?.region ?? null,
    });
  }

  // Rows the CNAF published that no bundled polygon can carry. Kept whole —
  // the rate is the point, and Guyane is the finding.
  const unpainted = rows
    .filter((area) => !seen.has(String(area.code).trim().toUpperCase()))
    .map((area) => ({
      code: area.code,
      name: area.name,
      rate: area.rate,
      band: area.band,
      ratio: area.ratio,
      dominant: area.dominant,
      totalPlaces: area.totalPlaces,
    }))
    .sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0) || a.code.localeCompare(b.code));

  const rated = rows.map((area) => area.rate).filter((rate) => Number.isFinite(rate));
  rated.sort((a, b) => a - b);

  return {
    departements,
    bands,
    painted,
    published: rows.length,
    unpainted,
    national,
    year,
    placesPainted,
    // The published spread, over EVERY row including the ones no polygon can
    // hold, because a range that silently stopped at the coastline would
    // understate the country it is describing.
    spread: rated.length
      ? { min: rated[0], median: rated[Math.floor(rated.length / 2)], max: rated[rated.length - 1] }
      : null,
    dominantTally: tallyDominant(rows),
    source: PE_SOURCE,
  };
}

/** How many départements each mode dominates. The urban/rural split, counted. */
function tallyDominant(rows) {
  const tally = Object.fromEntries(PE_MODES.map((mode) => [mode, 0]));
  for (const area of rows) {
    const mode = area?.dominant || dominantMode(area?.modes);
    if (mode && tally[mode] !== undefined) tally[mode] += 1;
  }
  return tally;
}
