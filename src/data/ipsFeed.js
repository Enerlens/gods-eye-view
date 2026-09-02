/**
 * @module ipsFeed
 *
 * The DEPP's *indice de position sociale* — read as an ATTRIBUTE of a school
 * the Annuaire already draws, never as a layer of its own.
 *
 * ── Why there is no `ips-fr` layer ──────────────────────────────────────────
 * IPS publishes no coordinate. Every one of its 43 322 rows is keyed on the
 * UAI and nothing else, so a layer would have to borrow its geometry from
 * `schools-fr` — which is another way of saying it IS `schools-fr`. The
 * register file already performs exactly this join four times over
 * (`SCHOOLS_ROLL_DATASETS` in `schoolsFeed.js`, one *effectifs* file per
 * level, all on the UAI); IPS is the fifth. It arrives as a card attribute and
 * a row readout, and it changes NEITHER of the layer's two map channels:
 * colour still means LEVEL, size still means ROLL.
 *
 * That restraint is deliberate and it is not timidity. The colour channel is
 * already spoken for, and a second meaning hidden behind a toggle would make
 * two screenshots of the same layer say different things with nothing on
 * screen to tell them apart. An index that exists to expose a gap should not
 * be the thing that makes the map ambiguous.
 *
 * ── THE HONEST HEADLINE ─────────────────────────────────────────────────────
 * Measured 2026-09-02 against the live files and the live Annuaire.
 * `schools-fr` draws 68 158 open geolocated rows over **68 083 distinct UAI**.
 * **62 857** of those can carry an index — 62 850 of a type IPS covers, plus 7
 * the register leaves untyped and the DEPP indexes anyway. Of them:
 *
 *   Ecole    48 169 drawn · 32 218 joined (66.9%) · 29 776 with a number (61.8%)
 *   Collège   9 055 drawn ·  7 042 joined (77.8%) ·  7 040 with a number (77.7%)
 *   Lycée     5 547 drawn ·  3 630 joined (65.4%) ·  3 629 with a number (65.4%)
 *   EREA         79 drawn ·     77 joined (97.5%) ·     77 with a number (97.5%)
 *   ───────────────────────────────────────────────────────────────────────────
 *   untyped      7 drawn ·      7 joined            ·      7 with a number
 *   ───────────────────────────────────────────────────────────────────────────
 *   TOTAL    62 857 drawn · 42 974 joined (68.4%) · 40 529 with a number (64.5%)
 *
 * The two columns are not the same fact and the gap between them is the point:
 * 2 445 schools ARE in the DEPP's files and still have no index, because the
 * file says so in writing (Trap 5). Coming the other way, the index holds
 * 43 322 UAI and **348 of them are not on this map at all** — closed, without a
 * coordinate, or absent from the open register: 1300023U is the Lycée Comte de
 * Foix in Andorra la Vella, and 9830313Y and 9830298G are New Caledonian, the
 * territory `schoolsFrance.js` already documents as partly uncoordinated.
 *
 * So roughly one school in three that COULD have an IPS does not have one on
 * this map, and a school with no published IPS must say so on its card. It is
 * never drawn, never coloured and never read as average. That is the whole
 * point of joining this file: an index of social position whose gaps are
 * invisible is worse than no index.
 *
 * ── Trap 1: four datasets, four DIFFERENT newest rentrées ───────────────────
 * The écoles file is a full year behind the other three. Measured from each
 * dataset's own `group_by=rentree_scolaire`:
 *
 *   fr-en-ips-ecoles-ap2022    2024-2025   32 494 rows
 *   fr-en-ips-colleges-ap2023  2025-2026    7 089 rows
 *   fr-en-ips-lycees-ap2023    2025-2026    3 662 rows
 *   fr-en-ips-erea-ap2022      2025-2026       77 rows
 *
 * A single global `max(rentree_scolaire)` returns 2025-2026 and silently drops
 * ALL 32 494 écoles — three quarters of the join, and the three quarters that
 * cover primary schooling. Each dataset therefore discovers its OWN newest
 * rentrée and is floored independently at the value this file was measured
 * against (`rentreeFloor`). A discovery older than the floor is a malformed
 * answer, not a new fact.
 *
 * The ap2022/ap2023 files are also CUMULATIVE — 97 080 école rows are three
 * school years stacked — so reading them unfiltered would triple every school
 * and average three different indices into one.
 *
 * ── Trap 2: lycées have no `ips` column at all ──────────────────────────────
 * Écoles publish `ips`. Collèges and EREA publish `ips` + `ecart_type_de_l_ips`.
 * Lycées publish **`ips_voie_gt`, `ips_voie_pro`, `ips_post_bac` and
 * `ips_etab`**, with `type_de_lycee` ∈ {LEGT, LPO, LP}. A join written against
 * `ips` drops every one of the 3 662.
 *
 * THE figure here is **`ips_etab`**, because it is the only column defined on
 * every lycée (3 661 of 3 662 — the exception is named below) and the only one
 * comparable across the three types. But it is an ESTABLISHMENT figure and the
 * card says so, then names the populations it blends, because the file
 * publishes them apart and they are far apart. Measured over the 931 LPO rows
 * that carry both voies: the median |GT − pro| gap is **18.1 IPS points**, the
 * 90th percentile 27.9, and the widest is 0312746S (lycée polyvalent
 * Marie-Louise Dissard Françoise, Toulouse) at **GT 140.1 against pro 92.4** —
 * 47.7 points inside one `ips_etab` of 126.3. Printing 126.3 alone would
 * describe neither half of that school.
 *
 * `ips_etab` is not a copy of a single voie even when only one voie is
 * published: 2 042 rows also carry `ips_post_bac`, which is folded into
 * `ips_etab` and into nothing else. 0020031Y publishes GT 97.4 and `ips_etab`
 * 95.4 for that reason.
 *
 * ── Trap 3: EREA misspells its own column ───────────────────────────────────
 * `fr-en-ips-erea-ap2022` names the establishment `nom_de_l_etablissment` —
 * no second 'e'. Every other file says `nom_de_l_etablissement`. This is not a
 * null column, it is a **whole-request failure**: a shared `select` list
 * returns HTTP 400 with
 * `ODSQL query is malformed: Unknown field: nom_de_l_etablissement.
 *  Clause(s) containing the error(s): select.`
 * (verified against the live endpoint 2026-09-02, both directions — the
 * correct spelling 400s on EREA and the misspelling 400s on the écoles file).
 * The `select` is therefore built PER DATASET from `nameField`, never shared.
 *
 * ── Trap 4: the reference values are per-type for lycées ────────────────────
 * Écoles, collèges and EREA publish `ips_national` / `ips_academique` /
 * `ips_departemental`. Lycées publish them split three ways —
 * `ips_national_legt`, `ips_national_lpo`, `ips_national_lp`, and the same for
 * académie and département. Comparing an LP to `ips_national_legt` is a wrong
 * number, and the spread between them is not small: nationally LEGT 120.2,
 * LPO 104.4, LP 89.9. So the baseline is selected from `type_de_lycee`.
 *
 * The académie baseline is fetched by nobody: a card that prints three
 * territories makes none of them the answer, and the département is the one a
 * reader of this map has in their head. The sector-split columns
 * (`_prive` / `_public`) are not fetched either — comparing a private school
 * only to private schools grades the gap on a curve, which is the one thing
 * this index exists to make visible. The card names the school's own secteur,
 * so a reader knows which population the dot belongs to.
 *
 * ── Trap 5: `NS` is a value, and `Number('NS')` is NaN ──────────────────────
 * Not in the brief, found by reading every value: the écoles file publishes
 * the literal string **`"NS"`** — *non significatif*, the DEPP's statistical
 * secrecy marker for a school with too few pupils to publish an index — in
 * **2 504 of its 32 494 rows (7.7%)**. A `Number(row.ips) || 0` turns every
 * one of them into an IPS of **0** on a scale whose measured range is
 * 54.9 – 162.7; a raw pass-through prints "NS" where a number belongs.
 *
 * They are read as a SENTINEL and reported as one: a school marked NS has
 * been examined and withheld, which is a different fact from a school the
 * DEPP never examined, and the card says which. The plausibility window
 * (`IPS_MIN_PLAUSIBLE` / `IPS_MAX_PLAUSIBLE`) catches the next sentinel that
 * happens to parse as a number.
 *
 * Two further blanks exist, both real: 2 collège rows publish `ips = null`
 * (9750025D Saint-Pierre-et-Miquelon, 0133827P Bouches-du-Rhône) and 1 lycée
 * row publishes every IPS column null (0754089M, Paris 11e). 94 collège rows
 * and 39 lycée rows publish no `ips_national` — the BASELINE itself can be
 * missing, so the comparison degrades rather than being invented.
 *
 * ── What the index costs the client, and the shape that was rejected ────────
 * Measured on the densest legal viewport in France (0.34° over Paris, 4 725
 * establishments) through the running proxy: the payload goes from
 * 2 794 171 bytes raw / 349 436 gzipped to **3 267 807 raw / 380 177 gzipped**
 * — **+473 636 raw (+17.0%) and +30 741 on the wire (+8.8%)**.
 *
 * Omitting the null keys of each record (`sentinel`, `lyceeType`, `voies` and
 * `spread` are null on most rows) was measured and rejected: it saves 131 821
 * bytes raw and **3 476 gzipped**. Three and a half kilobytes is what would
 * actually reach a reader, and the price is a record whose shape depends on
 * its contents — in a module whose entire job is to keep four kinds of absence
 * distinguishable from each other and from a value.
 *
 * The maillage carries none of this. That pack ships coordinates WITHOUT names
 * to stay at 1.66 MB against 5.42 MB, and an index per tuple would put it
 * straight back; the index rides the per-click register lookup the name
 * already pays for.
 *
 * ── Trap 6: three types for one measure, on one portal ──────────────────────
 * `ips` is TEXT in the écoles file ("119.5", and "72" for an integer),
 * DOUBLE in the collèges and EREA files (96.3), and every lycée column is
 * TEXT again ("125.1"). Same publisher, same portal, same measure. Everything
 * goes through one reader.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
 */

/** Portal all four datasets are published on — the same one the Annuaire uses. */
export const IPS_PORTAL = 'data.education.gouv.fr';

/** Attribution carried on every payload that contains an IPS (see DATA_SOURCES.md). */
export const IPS_SOURCE = 'Indice de position sociale (IPS) — DEPP '
  + '(data.education.gouv.fr)';

/**
 * Plausibility window for a published IPS.
 *
 * Measured across all four files at their newest rentrée, the extremes are
 * 54.9 (an école) and 162.7 (a collège). The window is deliberately far wider
 * than that: it is not a filter on real values, it is the guard that stops the
 * NEXT sentinel — a `0`, a `-1`, a `9999` — from being drawn as an index.
 * Anything outside it is reported as malformed, never plotted.
 */
export const IPS_MIN_PLAUSIBLE = 20;
export const IPS_MAX_PLAUSIBLE = 200;

/**
 * Plausibility ceiling for a published ÉCART-TYPE, which needs its OWN window.
 *
 * Reusing the index window here was a real bug, caught by measuring: the
 * within-school dispersion runs from **7.9** (0752954D, a Paris collège for
 * disabled pupils — a very homogeneous roll) to 46.2, and an `IPS_MIN_PLAUSIBLE`
 * of 20 silently discarded **162 published écarts-types** — 102 collèges,
 * 39 lycées and 21 of the 77 EREA. A spread is a different quantity from the
 * index it disperses and cannot borrow its bounds.
 */
export const IPS_SPREAD_MAX_PLAUSIBLE = 100;

/**
 * The four datasets, in the order they are folded into one index.
 *
 * Order is load-bearing only as a tie-break: measured 2026-09-02, the four
 * newest-rentrée slices hold 32 494 + 7 089 + 3 662 + 77 = 43 322 rows and
 * **43 322 distinct UAI**, so no UAI appears in two files today. `indexIps`
 * keeps the FIRST writer and counts any collision rather than letting a later
 * file silently overwrite an earlier one, because "these files do not overlap"
 * is a measurement and not a guarantee.
 *
 * Every field name is per-dataset. Nothing here may be hoisted into a shared
 * list — see Trap 3, where doing so is an HTTP 400 and not a null column.
 */
export const IPS_DATASETS = Object.freeze([
  Object.freeze({
    kind: 'ecole',
    dataset: 'fr-en-ips-ecoles-ap2022',
    // Measured newest rentrée 2026-09-02: 2024-2025, 32 494 rows. A FULL YEAR
    // behind the other three — this floor is the reason the discovery is
    // per-dataset (Trap 1).
    rentreeFloor: '2024-2025',
    nameField: 'nom_de_l_etablissement',
    valueField: 'ips',
    spreadField: null,
    typeField: null,
    voieFields: null,
    refFields: Object.freeze({ national: 'ips_national', departemental: 'ips_departemental' }),
  }),
  Object.freeze({
    kind: 'college',
    dataset: 'fr-en-ips-colleges-ap2023',
    // Measured 2026-09-02: 2025-2026, 7 089 rows.
    rentreeFloor: '2025-2026',
    nameField: 'nom_de_l_etablissement',
    valueField: 'ips',
    spreadField: 'ecart_type_de_l_ips',
    typeField: null,
    voieFields: null,
    refFields: Object.freeze({ national: 'ips_national', departemental: 'ips_departemental' }),
  }),
  Object.freeze({
    kind: 'lycee',
    dataset: 'fr-en-ips-lycees-ap2023',
    // Measured 2026-09-02: 2025-2026, 3 662 rows.
    rentreeFloor: '2025-2026',
    nameField: 'nom_de_l_etablissement',
    // NOT `ips` — that column does not exist here (Trap 2).
    valueField: 'ips_etab',
    spreadField: 'ecart_type_etablissement',
    typeField: 'type_de_lycee',
    voieFields: Object.freeze({ gt: 'ips_voie_gt', pro: 'ips_voie_pro', postBac: 'ips_post_bac' }),
    // Null on purpose: the baseline depends on `type_de_lycee` (Trap 4) and is
    // resolved through LYCEE_REF_FIELDS instead.
    refFields: null,
  }),
  Object.freeze({
    kind: 'erea',
    dataset: 'fr-en-ips-erea-ap2022',
    // Measured 2026-09-02: 2025-2026, 77 rows. The smallest of the four, and
    // proof that the dataset id says nothing about the newest rentrée: this
    // file and the écoles file are both `ap2022`, and they are a year apart.
    rentreeFloor: '2025-2026',
    // The misspelling is the source's, and it is copied verbatim (Trap 3).
    nameField: 'nom_de_l_etablissment',
    valueField: 'ips',
    spreadField: 'ecart_type_de_l_ips',
    typeField: null,
    voieFields: null,
    refFields: Object.freeze({ national: 'ips_national', departemental: 'ips_departemental' }),
  }),
]);

/** The four kinds, in `IPS_DATASETS` order. */
export const IPS_KINDS = Object.freeze(IPS_DATASETS.map((spec) => spec.kind));

/**
 * `type_de_lycee` → the suffix its reference columns carry.
 *
 * Measured over the 3 662 rows: LEGT 1 565, LP 1 097, LPO 1 000, and no other
 * value. National baselines at rentrée 2025-2026 are LEGT 120.2, LPO 104.4,
 * LP 89.9 — 30 points apart end to end, which is why picking the wrong one is
 * a wrong number and not a rounding difference.
 */
export const LYCEE_REF_FIELDS = Object.freeze({
  LEGT: Object.freeze({ national: 'ips_national_legt', departemental: 'ips_departemental_legt' }),
  LPO: Object.freeze({ national: 'ips_national_lpo', departemental: 'ips_departemental_lpo' }),
  LP: Object.freeze({ national: 'ips_national_lp', departemental: 'ips_departemental_lp' }),
});

/**
 * The Annuaire's `type_etablissement` values IPS covers, mapped to a kind.
 *
 * Keyed on the RAW published type and not on `schoolLevel()`'s five-band
 * ladder, because that ladder folds EREA into `adapte` together with 2 300
 * drawn médico-social establishments which publish no IPS at all. Counting
 * coverage over the band would put 2 379 in the denominator where the truth is
 * 79, and report EREA — the best-covered type in the whole join, 77 of 79 —
 * as 3.2%.
 */
export const IPS_TYPE_TO_KIND = Object.freeze({
  Ecole: 'ecole',
  'École': 'ecole',
  'Collège': 'college',
  'Lycée': 'lycee',
  EREA: 'erea',
});

/** Annuaire types the index applies to at all, in reading order. */
export const IPS_ELIGIBLE_TYPES = Object.freeze(['Ecole', 'Collège', 'Lycée', 'EREA']);

/**
 * The attribute stamped on a school whose IPS file did not load.
 *
 * One frozen object shared by every affected site rather than one per site:
 * on the degraded path the densest legal viewport stamps it 4 324 times
 * (measured), and 4 324 identical literals are 4 324 allocations to say one
 * thing. It exists at all because "the DEPP file is down" and "this school has
 * no published index" are different sentences, and a reader must never be
 * shown the second when the first is true.
 */
export const IPS_UNAVAILABLE = Object.freeze({ status: 'unavailable', value: null });

/**
 * The IPS kind for one Annuaire row's published type, or null.
 *
 * `null` means "this establishment is outside the index's scope" — a rectorat,
 * a CIO, a médico-social — and a card for one of those says NOTHING about IPS
 * rather than reporting a gap that was never a gap.
 * @param {?string} type The Annuaire's `type_etablissement`.
 * @returns {?string}
 */
export function ipsKindForType(type) {
  return IPS_TYPE_TO_KIND[String(type || '').trim()] || null;
}

/** Trimmed string, or null — so an empty upstream cell never reaches a card. */
function str(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

/**
 * Read one published IPS cell.
 *
 * Handles all three upstream types in one place (Trap 6) and separates the two
 * kinds of absence that matter:
 *
 *   `{ value: n, sentinel: null }`  — a number inside the plausibility window;
 *   `{ value: null, sentinel: 'NS' }` — published, and published as not a
 *       number: the DEPP examined this school and withheld the index;
 *   `{ value: null, sentinel: null }` — the cell is empty. Nothing was said.
 *
 * A number OUTSIDE the window comes back as a sentinel carrying its own digits,
 * so a source that starts writing `0` is reported rather than drawn.
 *
 * @param {*} raw The cell, as Opendatasoft returned it.
 * @returns {{value: ?number, sentinel: ?string}}
 */
export function readIpsValue(raw) {
  if (raw === null || raw === undefined) return { value: null, sentinel: null };
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { value: null, sentinel: null };
    return inWindow(raw) ? { value: raw, sentinel: null } : { value: null, sentinel: String(raw) };
  }
  const text = String(raw).trim();
  if (!text) return { value: null, sentinel: null };
  const parsed = Number(text);
  if (Number.isFinite(parsed)) {
    return inWindow(parsed) ? { value: parsed, sentinel: null } : { value: null, sentinel: text };
  }
  return { value: null, sentinel: text.toUpperCase() };
}

function inWindow(value) {
  return value >= IPS_MIN_PLAUSIBLE && value <= IPS_MAX_PLAUSIBLE;
}

/**
 * A published reference value, or null.
 *
 * The same reader as a school's own index, then the sentinel is discarded: a
 * baseline that is not a number is simply no baseline, and there is nothing on
 * a card to say "the département reference is NS".
 */
function ref(raw) {
  const { value } = readIpsValue(raw);
  return value;
}

/**
 * A published écart-type, or null. Its own window — see IPS_SPREAD_MAX_PLAUSIBLE.
 */
export function readIpsSpread(raw) {
  const parsed = typeof raw === 'string' ? Number(raw.trim() || NaN) : raw;
  if (!Number.isFinite(parsed)) return null;
  return parsed > 0 && parsed <= IPS_SPREAD_MAX_PLAUSIBLE ? parsed : null;
}

/**
 * The `select` list for one dataset.
 *
 * Built per spec and never shared — see Trap 3. Deliberately narrow, and the
 * narrowing is worth its own measurement (2026-09-02): the four full-column
 * exports are **33 040 379 bytes raw / 1 587 950 gzipped**, and these lists cut
 * that to **7 598 242 raw / 750 413 gzipped** — 77% off the wire — for a
 * document the proxy builds once per process. écoles is 4 841 947 of those
 * bytes on its own, lycées 1 557 447, collèges 1 183 500, EREA 15 348.
 *
 * `nameField` is the one column in these lists that no card reads, and it is
 * the expensive one: measured, it costs **2 602 114 bytes raw and 373 972
 * gzipped** — it doubles the gzipped fetch. It is kept for two reasons and
 * both are checkable. It turns the national "348 IPS establishments this map
 * does not draw" from a number into a list a reader can look up, and it is
 * what makes Trap 3 a property of the RUNNING request rather than a comment:
 * with the name in the select, a shared list is an HTTP 400 the first time
 * anyone tries it, and nobody ships the shared list by accident. Drop it and
 * you halve a once-per-process server-side fetch that costs no user anything.
 *
 * @param {object} spec One entry of IPS_DATASETS.
 * @returns {Array<string>}
 */
export function ipsSelectFields(spec) {
  const fields = ['uai', spec.nameField, spec.valueField];
  if (spec.typeField) fields.push(spec.typeField);
  if (spec.spreadField) fields.push(spec.spreadField);
  if (spec.voieFields) fields.push(...Object.values(spec.voieFields));
  if (spec.refFields) fields.push(...Object.values(spec.refFields));
  else for (const set of Object.values(LYCEE_REF_FIELDS)) fields.push(...Object.values(set));
  return fields;
}

/** ODSQL `where` for one dataset's chosen rentrée. */
export function ipsRentreeWhere(rentree) {
  return `rentree_scolaire="${String(rentree)}"`;
}

/**
 * The newest rentrée one dataset publishes, floored at what it was measured
 * against.
 *
 * String compare and not numeric: `rentree_scolaire` is TEXT upstream and
 * spelled `YYYY-YYYY`, so `Number()` gives NaN on every value and a
 * "max by number" would return the floor forever. Anything that is not exactly
 * `YYYY-YYYY` is ignored — a malformed grouping must not be able to move the
 * year at all.
 *
 * @param {Array<object>} rows Rows of the portal's own `group_by` answer, or
 *   any rows carrying `rentree_scolaire`.
 * @param {string} floor The value this module was measured against.
 * @returns {string}
 */
export function newestIpsRentree(rows, floor) {
  let best = String(floor);
  for (const row of Array.isArray(rows) ? rows : []) {
    const value = str(row?.rentree_scolaire);
    if (value && /^\d{4}-\d{4}$/.test(value) && value > best) best = value;
  }
  return best;
}

/**
 * Project one upstream row into the record a school's card reads.
 *
 * @param {object} row One row of `spec.dataset` at `rentree`.
 * @param {object} spec One entry of IPS_DATASETS.
 * @param {string} rentree The rentrée the row was read at.
 * @returns {?{uai:string, record:object}} `null` when the row has no UAI —
 *   there is nothing to join it to and it is counted, not guessed at.
 */
export function projectIpsRow(row, spec, rentree) {
  const uai = str(row?.uai);
  if (!uai) return null;

  const { value, sentinel } = readIpsValue(row?.[spec.valueField]);
  const lyceeType = spec.typeField
    ? (str(row?.[spec.typeField])?.toUpperCase() || null)
    : null;
  const refFields = spec.refFields || LYCEE_REF_FIELDS[lyceeType] || null;

  /** @type {object} */
  const record = {
    kind: spec.kind,
    rentree,
    // Three states a ROW can be in, and they are different claims:
    //   'ok'     — a number inside the plausibility window;
    //   'ns'     — published as a sentinel: examined and withheld (2 504 rows);
    //   'absent' — the row exists and the cell is empty (2 collèges, 1 lycée).
    // 'unavailable' is stamped by the projection when a whole upstream file is
    // missing, and never comes from a row.
    status: value !== null ? 'ok' : (sentinel ? 'ns' : 'absent'),
    value,
    sentinel: value === null ? (sentinel || null) : null,
    spread: spec.spreadField ? readIpsSpread(row?.[spec.spreadField]) : null,
    lyceeType,
    voies: null,
    national: refFields ? ref(row?.[refFields.national]) : null,
    departemental: refFields ? ref(row?.[refFields.departemental]) : null,
  };

  if (spec.voieFields) {
    // Only the voies the file actually published. An LP with no `ips_voie_gt`
    // has no general stream, which is a fact about the school; a `gt: null`
    // riding along on 1 148 rows would be that fact spelled as an absence.
    const voies = {};
    for (const [key, field] of Object.entries(spec.voieFields)) {
      const read = readIpsValue(row?.[field]);
      if (read.value !== null) voies[key] = read.value;
    }
    if (Object.keys(voies).length) record.voies = voies;
  }

  return { uai, record, name: str(row?.[spec.nameField]) };
}

/**
 * Fold the four per-dataset row sets into one `Map<uai, record>`.
 *
 * @param {Array<{spec:object, rentree:string, rows:Array<object>}>} batches One
 *   entry per dataset that LOADED. A dataset that failed is simply absent, and
 *   its kind lands in `missing` so the projection can say "unavailable" for
 *   those schools instead of "not published".
 * @returns {{index:Map<string,object>, names:Map<string,string>, rentrees:object,
 *   counts:object, collisions:number, missing:Array<string>, status:string}}
 */
export function indexIps(batches) {
  const index = new Map();
  const names = new Map();
  const rentrees = {};
  const counts = {};
  const loaded = new Set();
  let collisions = 0;

  for (const batch of Array.isArray(batches) ? batches : []) {
    const spec = batch?.spec;
    if (!spec?.kind) continue;
    loaded.add(spec.kind);
    const rentree = String(batch.rentree || spec.rentreeFloor);
    rentrees[spec.kind] = rentree;
    const tally = { rows: 0, valued: 0, sentinel: 0, blank: 0, noUai: 0 };

    for (const row of Array.isArray(batch.rows) ? batch.rows : []) {
      tally.rows += 1;
      const projected = projectIpsRow(row, spec, rentree);
      if (!projected) {
        tally.noUai += 1;
        continue;
      }
      if (projected.record.value !== null) tally.valued += 1;
      else if (projected.record.sentinel) tally.sentinel += 1;
      else tally.blank += 1;

      if (index.has(projected.uai)) {
        // Measured 2026-09-02: this never fires — the four newest-rentrée
        // slices share no UAI. It is counted rather than resolved because a
        // school that appears in two of these files would be a real editorial
        // question, not a merge.
        collisions += 1;
        continue;
      }
      index.set(projected.uai, projected.record);
      if (projected.name) names.set(projected.uai, projected.name);
    }
    counts[spec.kind] = tally;
  }

  const missing = IPS_KINDS.filter((kind) => !loaded.has(kind));
  return {
    index,
    names,
    rentrees,
    counts,
    collisions,
    missing,
    status: missing.length === 0 ? 'ok' : (missing.length === IPS_KINDS.length ? 'unavailable' : 'partial'),
  };
}

/**
 * What the index reaches, measured against the schools this layer actually
 * draws.
 *
 * The denominator is NOT "every row in the register", and it is not every row
 * in the SWEEP either. It is the DISTINCT UAI of an IPS-covered type that
 * carry a coordinate — the dots a reader can actually click. Both narrowings
 * are measured, not stylistic:
 *
 *   the sweep returns 68 158 open geolocated rows over **68 083 distinct UAI**
 *     — 70 UAIs are published twice and one three times, and `schoolsFrance.js`
 *     keys its records on the UAI, so it draws one dot for each of them;
 *   restricting to Ecole / Collège / Lycée / EREA takes 62 918 rows down to
 *     **62 850 distinct UAI**, and 7 untyped-but-indexed establishments join
 *     them for **62 857** — the number this rate is over.
 *
 * @param {object} options
 * @param {Array<object>} options.records Annuaire rows, already filtered to
 *   open and geolocated (the national sweep's own set).
 * @param {Map<string,object>|object} options.index UAI → IPS record.
 * @param {Map<string,string>} [options.names] UAI → the DEPP's own name, used
 *   only to make the unmatched count checkable.
 * @param {object} [options.rentrees] kind → rentrée read.
 * @param {Array<string>} [options.missing] kinds whose file did not load.
 * @param {string} [options.status]
 * @returns {object}
 */
export function summariseIpsCoverage({
  records, index, names = null, rentrees = {}, missing = [], status = 'ok',
} = {}) {
  const map = index instanceof Map ? index : new Map(Object.entries(index || {}));
  const nameMap = names instanceof Map ? names : new Map(Object.entries(names || {}));
  const rows = Array.isArray(records) ? records : [];

  const byType = {};
  for (const type of IPS_ELIGIBLE_TYPES) byType[type] = { drawn: 0, joined: 0, valued: 0 };

  const seen = new Set();
  const counted = new Set();
  let eligible = 0;
  let joined = 0;
  let valued = 0;
  let drawnOutsideScope = 0;

  for (const row of rows) {
    const uai = str(row?.identifiant_de_l_etablissement);
    const type = str(row?.type_etablissement);
    const bucket = type && byType[type] ? byType[type] : null;
    const record = uai ? map.get(uai) : undefined;
    if (uai && record) seen.add(uai);
    // In scope if the Annuaire types it as something IPS covers, OR if the
    // DEPP published an index for it anyway. The second clause is 7 rows
    // nationally — every one an establishment the register leaves with no
    // `type_etablissement` at all — and they are counted rather than
    // discarded, because a published index that the card stays silent about
    // is exactly the failure this whole join exists to prevent. They have no
    // per-type bucket, so `byType` sums to `eligible - drawnOutsideScope`.
    if (!bucket && !record) continue;
    // A UAI the register publishes twice is ONE dot, and must be one unit of
    // the denominator or the rate is over a population the map does not draw.
    if (!uai || counted.has(uai)) continue;
    counted.add(uai);
    if (bucket) bucket.drawn += 1;
    else drawnOutsideScope += 1;
    eligible += 1;
    if (!record) continue;
    if (bucket) bucket.joined += 1;
    joined += 1;
    if (record.value !== null) {
      if (bucket) bucket.valued += 1;
      valued += 1;
    }
  }

  let indexedValued = 0;
  for (const record of map.values()) if (record?.value !== null) indexedValued += 1;

  // Five of the unmatched, named, so the count above is a claim a reader can
  // go and check rather than a number they have to take. Insertion order, so
  // it is deterministic between builds.
  const unmatchedSample = [];
  for (const [uai, record] of map) {
    if (seen.has(uai)) continue;
    if (unmatchedSample.length >= 5) break;
    unmatchedSample.push({ uai, name: nameMap.get(uai) || null, kind: record?.kind || null });
  }

  return {
    eligible,
    joined,
    valued,
    byType,
    indexed: map.size,
    indexedValued,
    // IPS establishments this layer does not draw: closed in the Annuaire,
    // uncoordinated, or absent from the open register altogether.
    unmatched: map.size - seen.size,
    unmatchedSample,
    // Drawn, indexed, and of a type the Annuaire never named. Inside
    // `eligible` and outside every `byType` row, so the two can be reconciled.
    drawnOutsideScope,
    rentrees,
    missing,
    status,
    source: IPS_SOURCE,
  };
}

// --- Card copy ---------------------------------------------------------------

/** One IPS number, French-formatted to one decimal: 95.4 → "95,4". */
export function formatIps(value) {
  return Number(value).toLocaleString('fr-FR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** A signed écart: -7.8 → "−7,8", 12.8 → "+12,8". U+2212 for the minus. */
export function formatIpsDelta(delta) {
  const rounded = Math.round(Number(delta) * 10) / 10;
  const sign = rounded < 0 ? '−' : '+';
  return `${sign}${formatIps(Math.abs(rounded))}`;
}

/** French label for one lycée voie key. */
export const IPS_VOIE_LABELS = Object.freeze({
  gt: 'voie générale et technologique',
  pro: 'voie professionnelle',
  postBac: 'post-bac',
});

/** Reading order for the voies, general → professional → post-bac. */
export const IPS_VOIE_ORDER = Object.freeze(['gt', 'pro', 'postBac']);

/**
 * The IPS lines of a school's card.
 *
 * Every branch here is a different fact and they are never allowed to look
 * alike:
 *
 *   `undefined` → this establishment is outside the index's scope (a rectorat,
 *                 a CIO, a médico-social). The card says nothing at all.
 *   `null`      → the index was consulted and holds no row for this UAI. That
 *                 is one drawn school in three, and it is stated.
 *   unavailable → the DEPP file did not load. NOT the same claim as "not
 *                 published", and it names the difference.
 *   ns          → published, and published as withheld.
 *   ok          → the number, the population it describes, and the two
 *                 baselines the file itself supplies.
 *
 * @param {object|null|undefined} ips A site's `ips` attribute.
 * @returns {Array<string>} Zero to three lines, ready to join with '\n'.
 */
export function ipsCardLines(ips) {
  if (ips === undefined) return [];
  if (ips === null) return ['IPS non publié pour cet UAI'];
  if (ips.status === 'unavailable') {
    return ['Indice de position sociale indisponible — fichier DEPP injoignable'];
  }
  if (ips.status === 'ns') {
    return [ips.sentinel === 'NS'
      ? 'IPS non significatif (« NS ») — effectif trop faible pour que la DEPP publie l’indice'
      : `IPS publié comme « ${ips.sentinel} », pas comme un nombre`];
  }
  // 'absent' — a row exists for this UAI and its index cell is empty. That is
  // the same claim as no row at all, so it reads the same; the two are counted
  // apart in `indexIps`, where the difference is a fact about the FILE.
  if (!Number.isFinite(ips.value)) return ['IPS non publié pour cet UAI'];

  const lines = [];
  const spread = Number.isFinite(ips.spread) ? ` (écart-type ${formatIps(ips.spread)})` : '';
  // The lycée headline names the unit BEFORE the number, because `ips_etab`
  // is an establishment figure and the two voies underneath it can be 47.7
  // points apart (Trap 2).
  lines.push(ips.kind === 'lycee'
    ? `IPS ${formatIps(ips.value)}${spread} — établissement entier${ips.lyceeType ? ` (${ips.lyceeType})` : ''}, rentrée ${ips.rentree}`
    : `IPS ${formatIps(ips.value)}${spread} — rentrée ${ips.rentree}`);

  if (ips.voies) {
    const parts = IPS_VOIE_ORDER
      .filter((key) => Number.isFinite(ips.voies[key]))
      .map((key) => `${IPS_VOIE_LABELS[key]} ${formatIps(ips.voies[key])}`);
    if (parts.length) {
      lines.push(parts.length > 1
        ? `${parts.join(' · ')} — l’indice d’établissement mêle ces populations`
        : `${parts[0]} — seule voie publiée pour ce lycée`);
    }
  }

  const scope = ips.kind === 'lycee' && ips.lyceeType ? `Réf. ${ips.lyceeType}` : 'Réf.';
  const anchors = [];
  if (Number.isFinite(ips.departemental)) anchors.push(`département ${formatIps(ips.departemental)}`);
  if (Number.isFinite(ips.national)) anchors.push(`France ${formatIps(ips.national)}`);
  const baseline = ipsBaseline(ips);
  if (anchors.length) {
    lines.push(baseline
      ? `${scope} : ${anchors.join(' · ')} — écart ${formatIpsDelta(ips.value - baseline.value)} ${baseline.label}`
      : `${scope} : ${anchors.join(' · ')}`);
  }

  return lines;
}

/**
 * Which published reference the écart is measured against, and its name.
 *
 * The DÉPARTEMENT when there is one, because it is the tighter comparison and
 * the one that does not flatter a school in a rich area. Two things send it to
 * the national baseline instead, and both are measured rather than defensive:
 *
 *   the départemental reference is missing — 2 lycée LEGT rows, 10 LPO, 3 LP;
 *   the départemental reference EQUALS this school's own index, in which case
 *     it contains this school and little else and comparing them says nothing.
 *     184 rows nationally: **49 of the 77 EREA** (there is at most one EREA per
 *     département, so the "reference" IS the school), 88 écoles, 25 lycées and
 *     22 collèges.
 *
 * With neither baseline published — 94 collège rows and 39 lycée rows have no
 * `ips_national` — there is no écart and the card prints the references alone.
 *
 * @param {object} ips
 * @returns {?{value:number, label:string}}
 */
export function ipsBaseline(ips) {
  if (!Number.isFinite(ips?.value)) return null;
  if (Number.isFinite(ips.departemental) && ips.departemental !== ips.value) {
    return { value: ips.departemental, label: 'au département' };
  }
  if (Number.isFinite(ips.national) && ips.national !== ips.value) {
    return { value: ips.national, label: 'à la France' };
  }
  return null;
}

/**
 * The one clause a coverage readout gets.
 *
 * Reported as "published for N of M" and never as a bare percentage: the
 * denominator is the argument. M is the schools ON SCREEN that could have an
 * index, not every dot.
 *
 * @param {?object} coverage A `summariseIpsCoverage` result, or the per-box
 *   `{eligible, valued}` a viewport payload carries.
 * @returns {string} Empty when there is nothing true to say.
 */
export function ipsCoverageClause(coverage) {
  if (!coverage) return '';
  if (coverage.status === 'unavailable') return 'IPS indisponible';
  const eligible = Number(coverage.eligible) || 0;
  if (eligible <= 0) return '';
  const valued = Number(coverage.valued) || 0;
  const fr = (value) => Number(value).toLocaleString('fr-FR');
  const clause = `IPS publié pour ${fr(valued)} des ${fr(eligible)} établissements concernés`;
  return coverage.status === 'partial' ? `${clause} — index partiel` : clause;
}
