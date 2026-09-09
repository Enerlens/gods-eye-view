/**
 * @module data/buildingDossier
 *
 * **Le bâtiment comme pivot** — what a click on a volume can say once the RNB
 * has told it which ground it stands on.
 *
 * ── What was already there, and what was missing ────────────────────────────
 *
 * A BD TOPO volume already resolves to its RNB identity, its BAN addresses and
 * its cadastral parcels: `rnbPivot.js` does it in one keyless request the
 * click fires, and `bdtopoBuildings.js` republishes the card ~170 ms later
 * with those lines on it. What it could not then say is the three things a
 * reader looking at a building actually wants — **what it last sold for, what
 * has been authorised on it, and what the PLU allows there**.
 *
 * `docs/PLAN-CROISEMENTS.md` recorded this as blocked because the three
 * lookups are "des requêtes réseau déclenchées par une carte, ce que le dépôt
 * ne fait nulle part aujourd'hui". Two halves of that turned out to be wrong,
 * and finding out is what made this module small:
 *
 *  1. **The pattern exists.** `cadastreParcels.selectParcel` publishes its
 *     card immediately, fires two network lookups, caches by parcel key,
 *     aborts on re-selection and repaints only if the selection has not
 *     moved — and `bdtopoBuildings` itself already does the same for the RNB.
 *  2. **No network call is needed at all.** DVF, Sitadel and the GPU are three
 *     layers this application already loads for the same viewport. The sales
 *     carry `id_parcelle`, the permits carry the cadastral reference they were
 *     granted for, and the zoning is a polygon set with a point query. So the
 *     answer is a READ of what is already resident — which is the property the
 *     plan called an obstacle ("toutes ses cartes se composent sur de la
 *     donnée déjà résidente") and is in fact the solution.
 *
 * ── What that buys, and what it costs ───────────────────────────────────────
 *
 * The cost is that a line exists only while its layer is on. That is the
 * `layerJoins.js` contract — **absence is ordinary** — and it is the honest
 * shape here rather than a compromise: a card that fetched DVF behind the
 * reader's back would be a second scan of a register the reader chose not to
 * open, at the radius and the vintage that reader never picked.
 *
 * Each line therefore names its register, and a card with none of the three
 * layers on is exactly the card this repository drew before.
 *
 * ── The join key, and the one place it can slip ─────────────────────────────
 *
 * The 14-character cadastral parcel id — `75056000AB0123`, five for the
 * commune, three for the préfixe, two for the section, four for the number.
 * The RNB publishes it whole. DVF publishes it whole, as `id_parcelle`.
 * Sitadel publishes it **in pieces** and without the préfixe, which the
 * cadastre supplies when the permit is placed — so {@link cadastralParcelId}
 * assembles it, and a piece it does not have is a refusal rather than a
 * padded guess. A préfixe treated as `000` when it is `801` names a different
 * parcel in the same commune, and Toulouse publishes 46 of them.
 *
 * Pure: no fetch, no DOM, no Cesium, no clock.
 */

/**
 * Assemble a cadastral parcel id from its published pieces.
 *
 * @param {{commune?: string, prefixe?: string, section?: string, numero?: string}} parts
 * @returns {?string} `75056000AB0123`, or null when a piece is missing.
 */
export function cadastralParcelId({ commune, prefixe, section, numero } = {}) {
  const insee = String(commune ?? '').trim();
  const sec = String(section ?? '').trim().toUpperCase();
  const num = String(numero ?? '').trim();
  // Five characters, all digits — except Corsica, where the second is `A` or
  // `B` (`2A004`). The overseas départements are 971–976 and stay numeric.
  if (!/^(?:\d{5}|2[AB]\d{3})$/i.test(insee) || !sec || !num) return null;
  // A missing PRÉFIXE is `000` and that is not a guess: the cadastre's own
  // convention is that a commune with no absorbed territory has préfixe 000,
  // and the 14-character form is written with it. An unparseable one IS a
  // refusal — see the header.
  const raw = String(prefixe ?? '').trim();
  const pre = raw ? raw.padStart(3, '0') : '000';
  if (!/^[0-9]{3}$/.test(pre)) return null;
  if (sec.length > 2 || num.length > 4) return null;
  return `${insee}${pre}${sec.padStart(2, '0')}${num.padStart(4, '0')}`;
}

/** French thousands, matching every other card in the French packs. */
function fr(value) {
  return Number(value).toLocaleString('fr-FR');
}

/** `2024-03-18` → `mars 2024`. Never a day: see {@link dossierSaleLine}. */
export function dossierMonthLabel(iso) {
  const match = /^(\d{4})-(\d{2})/.exec(String(iso ?? ''));
  if (!match) return null;
  const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const month = months[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : match[1];
}

/**
 * The last sale recorded on this ground.
 *
 * A MONTH and not a day, and the reason is in `dvfFeed.js`: DVF is a fiscal
 * extract published twice a year, and a card that printed `18 mars 2024`
 * beside a live map would read as a transaction feed. The month is what the
 * register can stand behind.
 *
 * NO PRICE PER SQUARE METRE UNLESS DVF ITSELF COMPUTED ONE. `prixM2` is null
 * on every sale that is not exactly one dwelling with a published surface and
 * nothing else in the lot — the trap that module exists for — and dividing the
 * `valeur_fonciere` here would re-introduce it one line further down.
 *
 * @param {?object} sale A projected DVF mutation.
 * @returns {?string}
 */
export function dossierSaleLine(sale) {
  if (!sale) return null;
  const when = dossierMonthLabel(sale.date);
  const value = Number(sale.valeur);
  if (!when || !Number.isFinite(value) || value <= 0) return null;
  const parts = [`Vendu ${when} · ${fr(Math.round(value))} €`];
  if (Number.isFinite(sale.prixM2) && sale.prixM2 > 0) {
    parts.push(`${fr(Math.round(sale.prixM2))} €/m²`);
  }
  return `${parts.join(' · ')} — DVF, sur cette parcelle`;
}

/**
 * What has been authorised on this ground since 2013.
 *
 * The NEWEST permit and a count, never a list: a Paris parcel carries up to
 * 34 permits over thirteen years and a card is four lines wide. The count is
 * what says the newest one is not the only one.
 *
 * @param {?{count: number, newest: ?object}} permits
 * @returns {?string}
 */
export function dossierPermitLine(permits) {
  const count = Number(permits?.count) || 0;
  if (!count) return null;
  const newest = permits.newest || null;
  const when = dossierMonthLabel(newest?.date);
  const head = newest?.label
    ? `${newest.label}${when ? ` · ${when}` : ''}`
    : `${count} autorisation${count > 1 ? 's' : ''}`;
  const rest = count > 1 ? ` · +${count - 1} autre${count > 2 ? 's' : ''} depuis 2013` : '';
  return `Permis : ${head}${rest} — Sitadel, sur cette parcelle`;
}

/**
 * What the PLU says about this point.
 *
 * THE THREE ANSWERS ARE DIFFERENT AND THE LINE SAYS WHICH. "This ground is in
 * zone UA", "this ground is in no zone the document draws" and "the register
 * was never asked about this ground" are three different facts, and only the
 * first two are about the PLU — `urbanismeGpu.js` keeps `insideBox` for
 * exactly this reason.
 *
 * @param {?object} answer From `gpuAnswerAt`.
 * @returns {?string}
 */
export function dossierZoningLine(answer) {
  if (!answer) return null;
  if (!answer.insideBox) return null; // never asked about this ground
  const zones = Array.isArray(answer.zones) ? answer.zones : [];
  if (!zones.length) return 'PLU : aucun zonage publié sur ce point';
  const first = zones[0];
  const name = [first.code, first.label].filter(Boolean).join(' — ') || first.kind || null;
  if (!name) return null;
  // Two zonings on one point is not a bug: two communes digitise their shared
  // limit independently and the Géoportail stacks both documents.
  const also = zones.length > 1 ? ` · +${zones.length - 1} zonage${zones.length > 2 ? 's' : ''} sur ce point` : '';
  const sup = Array.isArray(answer.servitudes) && answer.servitudes.length
    ? ` · ${answer.servitudes.length} servitude${answer.servitudes.length > 1 ? 's' : ''}`
    : '';
  return `PLU : ${name}${also}${sup}`;
}

/**
 * The three lines, in reading order, for one selected volume.
 *
 * Ordered by what a reader asks first: what it is worth, what may be built on
 * it, what is allowed there. Any of the three may be absent and the card
 * simply says less.
 *
 * @param {{sale?: ?object, permits?: ?object, zoning?: ?object}} dossier
 * @returns {string[]} Zero to three lines.
 */
export function buildingDossierLines(dossier) {
  return [
    dossierSaleLine(dossier?.sale),
    dossierPermitLine(dossier?.permits),
    dossierZoningLine(dossier?.zoning),
  ].filter(Boolean);
}
