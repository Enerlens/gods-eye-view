/**
 * @module data/plantIdentity
 *
 * **Une centrale, une marque** — which of three registers speaks for a site
 * they all hold, and the exact keys that decide it.
 *
 * ── The defect, counted ─────────────────────────────────────────────────────
 *
 * Three layers draw French generating capacity and they overlap heavily.
 * Measured against the live proxies and the two bundled packs on 2026-09-09:
 *
 *   `edf-power-plants`  79 sites  — EDF's own fleet, nameplate per site
 *   `rte-generation`   108 sites  — every station ≥ 100 MW, all filières,
 *                                   171 units, and the only live output
 *   `fr-hydro-plants`  998 placed — the ODRÉ register's whole long tail
 *
 *   **69 of the 108 RTE sites are an EDF site.**
 *   **55 hydro plants are an RTE unit**, and 43 of those chain on to an EDF
 *   site as well — Grand-Maison is drawn three times.
 *
 * `docs/PLAN-CROISEMENTS.md` recorded the deduplication as owed and called it
 * "une colonne vertébrale à écrire (choisir quelle source fait foi pour la
 * position, laquelle pour la puissance)". The spine turned out to be already
 * built, and by the repository's own build scripts.
 *
 * ── The two keys, and neither of them is a heuristic ────────────────────────
 *
 * 1. **`placementRef`, for EDF ↔ RTE.** `scripts/build-rte-units-registry.mjs`
 *    places 69 of its 108 sites on EDF's published coordinate and RECORDS WHICH
 *    ONE: `placementRef: 'edf:nucleaire:GRAVELINES'`, against the EDF layer's
 *    own site id `nucleaire:GRAVELINES`. All 69 resolve; none is ambiguous.
 *    The position question the plan asked — which source makes foi — was
 *    therefore answered at build time, in EDF's favour, and this module only
 *    has to read the answer.
 * 2. **The EIC code, for RTE ↔ hydro.** Both packs come from the same ODRÉ
 *    register and both carry it: `17W100P100P02756` is Grand-Maison's group 7
 *    in one and `G.MAIH-CENTRALE HYDRAULIQUE DE GRAND-MAISON-7` in the other.
 *    55 exact matches.
 *
 * NO PROXIMITY RULE ANYWHERE, and the measurement is why: EDF's Grand-Maison
 * (1 714 MW) sits **540 m** from the hydro register's Le Verney (21.8 MW), and
 * Super-Bissorte (742 MW) sits 410 m from Orelle (71.7 MW) and 690 m from
 * Bissorte (76 MW). Those are different works on the same mountain. A 1 km
 * identity rule would have merged 80 pairs of which several are two plants,
 * and the map would have lost real generating capacity to a tidy-looking dot.
 *
 * ── Who draws, and why that order ───────────────────────────────────────────
 *
 * {@link PLANT_REGISTER_ORDER}, and it is not a ranking of the registers'
 * worth:
 *
 *   · **EDF first** because it is the row's PRIMARY after the 2026-09 fusion
 *     and because its coordinate is the one the other two borrowed — the mark
 *     that survives is the one every register agreed to stand on;
 *   · **RTE second** because it is the superset by coverage (108 against 79)
 *     and carries what neither other register has, the live output;
 *   · **the hydro register last** because its subject IS the long tail: of its
 *     998 placed plants, 55 are duplicates and 943 are the reason it exists.
 *
 * ── What withdrawal means, and what it does not ─────────────────────────────
 *
 * A layer that withdraws a site draws no mark for it. **Nothing is deleted**:
 * the record stays in its payload, its count still says what the register
 * holds, and the moment the higher layer goes off the mark comes back — the
 * offer only exists while that layer is drawing. `amenitiesFrance.js` does the
 * same thing for the médecin family, for the same reason.
 *
 * The surviving card gains what the withdrawal would otherwise have hidden:
 * the OTHER register's installed power, **when the two disagree**. Measured
 * over all 69 EDF↔RTE pairs, most do not: **43 agree to the megawatt** and 14
 * more are within 5 %, so a card that printed both figures every time would be
 * repeating itself 57 times to say something 12 times.
 *
 * And those 12 are findings rather than noise. `Flamanville` is EDF 2 660 MW
 * against RTE 4 280 — EDF's file predates the EPR and RTE counts it.
 * `Bouchain` is 585 against 1 063, because an RTE site is the sum of its units
 * ≥ 100 MW and an EDF site is one nameplate. `Brennilis` is 304 against 125.
 * By filière the split is clean: nuclear and hydro both have a median ratio of
 * ×1.000, thermal ×1.081.
 *
 * Pure: no fetch, no DOM, no Cesium. The layers do the offering.
 */

/**
 * Which register draws a site the others also hold, most senior first.
 *
 * Read by index: a layer withdraws a site when a layer EARLIER in this list is
 * currently drawing it.
 */
export const PLANT_REGISTER_ORDER = Object.freeze([
  'edf-power-plants',
  'rte-generation',
  'fr-hydro-plants',
]);

/** The join key each register offers what it draws under. */
export const PLANT_JOIN_KEYS = Object.freeze({
  /** `(edfSiteId) => {name, mw}` — offered by `edf-power-plants`. */
  edf: 'plants/edf',
  /** `(eic) => {siteId, name, mw, edfSiteId}` — offered by `rte-generation`. */
  eic: 'plants/eic',
  /**
   * `(edfSiteId) => {name, mw, units}` — offered by `rte-generation`, read by
   * `edf-power-plants`. The reverse of the `placementRef` link, so the mark
   * that SURVIVES can print the figure of the register that stood down.
   */
  rteByEdf: 'plants/rteByEdf',
});

/**
 * The EDF site id an RTE site was placed on, or null.
 *
 * `placementRef` is `edf:<filiere>:<NAME>` and the EDF layer's own site id is
 * `<filiere>:<NAME>` — the prefix is what says which register the reference
 * points into, and a reference into any other one is not an EDF identity.
 *
 * @param {?{placementRef?: string}} site An RTE pack site.
 * @returns {?string}
 */
export function edfSiteIdForRteSite(site) {
  const ref = String(site?.placementRef ?? '').trim();
  if (!ref.startsWith('edf:')) return null;
  const id = ref.slice(4);
  return id || null;
}

/**
 * Is this installed power meaningfully different from that one?
 *
 * A tolerance rather than an equality, because the two registers round
 * differently: EDF publishes Blénod at 427 MW and RTE at 450.5, Gennevilliers
 * at 203 against 240.7. Under {@link PLANT_MW_AGREEMENT} the difference is a
 * rounding and the card stays quiet; over it, it is the two registers counting
 * different things and the card says so.
 *
 * @param {?number} a @param {?number} b
 * @returns {boolean} False when either figure is missing — an absent number is
 *   not a disagreement.
 */
export function plantPowerDiffers(a, b) {
  const left = Number(a);
  const right = Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return false;
  const ratio = left > right ? left / right : right / left;
  return ratio > PLANT_MW_AGREEMENT;
}

/**
 * How far apart two registers' megawatts may be before it is worth a line.
 *
 * 1.05 — five per cent, and the distribution is why. Over the 69 EDF↔RTE
 * pairs: **43 at ×1.000**, 9 under ×1.02, 5 under ×1.05, then 12 spread from
 * ×1.05 to ×2.43. The cut keeps the 57 agreements quiet and prints the 12
 * disagreements, every one of which is a real difference between what the two
 * registers count rather than a rounding.
 */
export const PLANT_MW_AGREEMENT = 1.05;

/**
 * The card line naming another register's figure for the same site.
 *
 * @param {string} register Human name of the other register.
 * @param {?number} mw Its installed power, MW.
 * @param {?number} ownMw This card's own figure.
 * @param {?string} [why] One clause on why the two differ.
 * @returns {?string} Null when they agree, or when either is missing.
 */
export function plantCrossRegisterLine(register, mw, ownMw, why = null) {
  if (!plantPowerDiffers(mw, ownMw)) return null;
  const value = Math.round(Number(mw));
  return `⌁ ${register} : ${value.toLocaleString('fr-FR')} MW${why ? ` — ${why}` : ''}`;
}
