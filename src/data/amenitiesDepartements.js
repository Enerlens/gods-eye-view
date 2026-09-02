/**
 * @module amenitiesDepartements
 *
 * The national regime: 96 painted départements, and the one number this layer
 * is allowed to paint them with.
 *
 * ── Why the choropleth is a SHARE and not a count ───────────────────────────
 * `schools-fr`, `sup-fr` and `irve-fr` all paint counts, and for those three it
 * is the right choice. It is the wrong one here, and the measurement says so:
 * the raw count of everyday amenities per département runs from 186 (Territoire
 * de Belfort) and 221 (Lozère) to 3 560 (Nord) and 3 710 (Paris), and that
 * ordering is, to three significant figures, the ordering of the population. A map of where the pharmacies are is
 * a map of where the people are, and drawing it teaches a reader nothing they
 * did not already know about France.
 *
 * The question this layer actually exists to answer is *how far do you have to
 * go*, and there is a population-free way to ask it out of the same file. BPE
 * lists **34 915 distinct DEPCOM codes** — the commune, and for Paris, Lyon and
 * Marseille the municipal arrondissement — of which **34 778 fold onto a
 * metropolitan polygon**. So: in how many of a département's communes is there
 * at least one of the five families the BPE carries?
 *
 * Nationally the answer is **15 196 of 34 778 = 43.7%**, and it discriminates
 * where the count did not: Gers 21.6%, Hautes-Pyrénées 22.0%, Somme 22.5%,
 * Ardennes and Meuse 22.6% at the bottom; Paris, Hauts-de-Seine,
 * Seine-Saint-Denis and Val-de-Marne at 100%; median 48.8%. Two thirds of
 * French communes contain no doctor, no shop, no post office, no pool and no
 * gendarmerie, and that is the fact worth painting.
 *
 * ── What the share deliberately leaves out, and why ─────────────────────────
 * The two FINESS families — 19 216 pharmacies and 2 211 hospitals — are NOT in
 * the numerator, and the card says so. FINESS publishes `ligneacheminement`, a
 * postal routing line ("01440 VIRIAT"), and no INSEE commune code; a postal
 * code is not a commune code and pretending otherwise would mis-assign
 * thousands of rows. They are counted per département by point-in-polygon like
 * everything else and they appear in every card and in both point regimes —
 * they are simply not in the coverage ratio, because the denominator they would
 * need does not exist in their file.
 *
 * ── Nothing is joined on a département code ────────────────────────────────
 * Three vocabularies describe the same territories in the two registers alone:
 * BPE writes `971 972 973 974 976` and Corsica as `2A`/`2B`; FINESS writes
 * `9A 9B 9C 9D 9F`, plus `9E` for Saint-Pierre-et-Miquelon and `9J` for
 * Wallis-et-Futuna; the bundled IGN outlines use a third. So every point and
 * every commune here is placed by point-in-polygon against the drawn shapes,
 * with the shared 2 km coastal snap for the ones the simplified outlines leave
 * in the sea, exactly as `franceDepartements.js` prescribes.
 *
 * ── What the choropleth cannot show ────────────────────────────────────────
 * The bundled polygons are metropolitan: 96 features, no overseas geometry. So
 * **2 681 of the 95 406 dots** — Guadeloupe, Martinique, Guyane, La Réunion,
 * Mayotte, Saint-Pierre-et-Miquelon and Wallis-et-Futuna — cannot be painted,
 * and the card reports them rather than letting the choropleth imply France has
 * 92 725 everyday amenities. 307 more were two kilometres or less out to sea and
 * were snapped to the coast they belong to, which is the shared rule rather than
 * a new one. They are present in both point regimes, which draw
 * positions and not polygons.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
 */

import {
  countBin,
  countBins,
  locateDepartement,
  nearestDepartementWithin,
} from './franceDepartements.js';
import { AMENITY_FAMILIES, AMENITY_FAMILY_REGISTER } from './amenitiesFeed.js';

/**
 * Bins in the choropleth ramp. Six, matching `schools-fr` and `sup-fr`, so an
 * operator toggling between the three French national views reads the same
 * number of steps even though the quantities differ.
 */
export const AMENITIES_DEPARTEMENT_BINS = 6;

/** The families the coverage share is computed over — the ones BPE carries. */
export const AMENITIES_COVERAGE_FAMILIES = Object.freeze(
  AMENITY_FAMILIES.filter((family) => AMENITY_FAMILY_REGISTER[family] === 'bpe'),
);

/** Fold one point onto a polygon, snapping a near-miss to the coast. */
function assign(index, lat, lon) {
  const direct = locateDepartement(index, lat, lon);
  if (direct) return { code: direct, snapped: false };
  const near = nearestDepartementWithin(index, lat, lon);
  return near ? { code: near.code, snapped: true } : null;
}

/**
 * Build the national rollup.
 *
 * @param {object} input
 * @param {Array<object>} input.records Folded amenity records.
 * @param {Array<{depcom: string, lat: number, lon: number, covered: boolean}>}
 *   input.communes One representative point per BPE commune, and whether that
 *   commune holds at least one drawn BPE-family amenity.
 * @param {{list: Array<object>}} input.index From `buildDepartementIndex`.
 * @returns {object}
 */
export function projectAmenitiesDepartements({ records, communes, index }) {
  const rows = Array.isArray(records) ? records : [];
  const communeRows = Array.isArray(communes) ? communes : [];
  const byCode = new Map();
  const ensure = (code) => {
    let row = byCode.get(code);
    if (!row) {
      row = {
        code,
        name: index?.byCode?.get(code)?.name || code,
        areaKm2: Math.round(index?.byCode?.get(code)?.areaKm2 || 0),
        amenities: 0,
        families: Object.fromEntries(AMENITY_FAMILIES.map((family) => [family, 0])),
        communes: 0,
        covered: 0,
        share: 0,
        bin: -1,
      };
      byCode.set(code, row);
    }
    return row;
  };

  let assigned = 0;
  let snapped = 0;
  let unassigned = 0;
  for (const record of rows) {
    if (typeof record?.lat !== 'number' || typeof record?.lon !== 'number') continue;
    const hit = assign(index, record.lat, record.lon);
    if (!hit) { unassigned += 1; continue; }
    assigned += 1;
    if (hit.snapped) snapped += 1;
    const row = ensure(hit.code);
    row.amenities += 1;
    if (row.families[record.family] !== undefined) row.families[record.family] += 1;
  }

  let communesPlaced = 0;
  let communesUnplaced = 0;
  let communesCovered = 0;
  for (const commune of communeRows) {
    if (typeof commune?.lat !== 'number' || typeof commune?.lon !== 'number') {
      communesUnplaced += 1;
      continue;
    }
    const hit = assign(index, commune.lat, commune.lon);
    if (!hit) { communesUnplaced += 1; continue; }
    communesPlaced += 1;
    const row = ensure(hit.code);
    row.communes += 1;
    if (commune.covered) {
      row.covered += 1;
      communesCovered += 1;
    }
  }

  const departements = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  for (const row of departements) {
    // A département whose communes never made it through the fold has no
    // share, not a share of zero — the difference is the whole point of the
    // `-1` bin, which draws as absence instead of as the bottom of the ramp.
    row.share = row.communes > 0 ? Number(((100 * row.covered) / row.communes).toFixed(1)) : 0;
  }
  const thresholds = countBins(departements.map((row) => row.share), AMENITIES_DEPARTEMENT_BINS);
  let painted = 0;
  for (const row of departements) {
    row.bin = row.communes > 0 ? countBin(row.share, thresholds) : -1;
    if (row.bin >= 0) painted += 1;
  }

  return {
    departements,
    thresholds,
    painted,
    assigned,
    snapped,
    unassigned,
    communesPlaced,
    communesUnplaced,
    communesCovered,
    nationalShare: communesPlaced > 0
      ? Number(((100 * communesCovered) / communesPlaced).toFixed(1))
      : 0,
    coverageFamilies: [...AMENITIES_COVERAGE_FAMILIES],
  };
}

/**
 * Legend copy for the ramp — "21,6 – 31 %" and so on.
 *
 * Percent signs and a French decimal comma, because the quantity is a share and
 * a legend row reading "31 communes" would be the wrong noun entirely.
 *
 * @param {Array<number>} thresholds From `countBins`.
 * @param {number} [floor] The lowest share actually observed, for the first row.
 * @returns {Array<string>}
 */
export function amenitiesDepartementBinLabels(thresholds, floor = 0) {
  const bounds = Array.isArray(thresholds) ? thresholds : [];
  const pct = (value) => String(value).replace('.', ',');
  const labels = [];
  let low = floor;
  for (const bound of bounds) {
    labels.push(`${pct(low)} – ${pct(bound)} %`);
    low = bound;
  }
  labels.push(`> ${pct(low)} %`);
  return labels;
}
