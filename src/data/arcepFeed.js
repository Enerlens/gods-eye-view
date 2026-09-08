/**
 * @module data/arcepFeed
 *
 * **Ma connexion internet** — what a fixed line at this address can actually
 * carry, from the ARCEP's own quarterly register.
 *
 * This is the one Cityscan theme where the fork was at zero. *Numérique* is
 * one of their ten, and everything this repository knew about connectivity was
 * ANFR's mast register — where the transmitters are, which is a different
 * question from what arrives at the door.
 *
 * ── The register, measured on 2026-09-08 against the live files ─────────────
 * `data.arcep.fr/fixe/maconnexioninternet/statistiques/last/commune/` serves
 * eight commune-level CSVs, edition **2026-03-31** (published quarterly),
 * UTF-8, semicolon-delimited, no key, no CORS obstacle. 34 877 communes —
 * Mayotte (976), Saint-Barthélemy (977) and Saint-Martin (978) included, which
 * is wider than the carte des loyers' own scope.
 *
 * Nationally, over **45 073 653 locaux**:
 *
 *   fibre (FTTH) éligible            42 277 843   93,8 %
 *   câble coaxial                     8 125 469   18,0 %
 *   cuivre encore raccordable        23 304 640   51,7 %
 *
 * ── THE TRAP THAT DECIDES WHICH FILE THIS MODULE READS ──────────────────────
 * `commune_debit.csv` says **100,0 % of French premises are eligible for
 * 30 Mbit/s**, and 100,0 % for 100 Mbit/s. That figure is true and it is
 * useless: it counts **satellite**, which is available essentially everywhere
 * and is not what anyone means by "the connection at this address".
 *
 * The ARCEP publishes the same table three times, and the three disagree by
 * exactly that:
 *
 *                       inéligible HD   ≥30 Mbit/s   ≥100 Mbit/s   ≥1 Gbit/s
 *   commune_debit            0,0 %        100,0 %      100,0 %       94,3 %
 *   …_debit_terrestre        0,0 %         99,9 %       94,5 %       94,3 %
 *   …_debit_filaire          1,7 %         95,4 %       94,5 %       94,3 %
 *
 * **This module reads `filaire`** — wired only, no satellite, no fixed 4G —
 * because that is the question a reader is asking, and because the difference
 * between 100 % and 95,4 % is 2,1 million premises that have no wired
 * high-speed line at all. A layer that published the 100 % would be repeating
 * a statistic that is technically correct and editorially false.
 *
 * ── The one file where each local is counted exactly once ───────────────────
 * The eligibility columns OVERLAP: a Paris local is counted under fibre AND
 * coax AND copper AND satellite, so they cannot be added up, and a card built
 * on them cannot say "how many people here have nothing better than copper".
 *
 * `commune_meilleure_techno_thd.csv` answers exactly that — each local under
 * its BEST available technology — and it partitions cleanly: measured over all
 * 34 877 communes, the eight technology columns sum to `nbr_elig_8` in **every
 * single row, with zero exceptions**. That is what this module reports as the
 * headline, because it is the only shape in the register that can be read as a
 * share.
 *
 * Nationally, by best technology: fibre 93,8 %, 4G fixe 4,6 %, cuivre ≥30
 * 0,8 %, coax 0,7 %, satellite 0,1 %.
 *
 * ── Copper is closing, and the register shows it happening ──────────────────
 * `elig_cu` is not a constant: **Ajaccio publishes 0** — every one of its
 * 46 329 premises has already lost its copper pair — while Paris still
 * publishes 1 667 159 of 1 667 292. Nationally copper reaches 51,7 % of
 * premises and falls every quarter. This is a live fact about an address that
 * a static address report cannot carry, and it is worth one line.
 *
 * ── Trap: `1 Gbit/s` can exceed `FTTH`, and it is not an error ──────────────
 * 409 communes publish more gigabit-eligible premises than fibre-eligible
 * ones. Coaxial cable also reaches a gigabit, so the two columns measure
 * different things. Reading `elig_thd1g` as "fibre" would overstate fibre in
 * 409 communes and hide the fact that the medium is cable.
 *
 * ── Trap: the register's own commune names are damaged ──────────────────────
 * 7 496 of 34 877 names carry accents correctly, and some do not: 97701 is
 * published as `Saint-Barthlemy`, with the é simply gone from the bytes. The
 * name on the card comes from the BAN, never from here.
 *
 * ── Trap: three cities are published only at commune level ──────────────────
 * Paris is ONE row of 1 667 292 premises; there are no arrondissements. So a
 * BAN citycode must be folded before it is looked up — `communeCode.js` — and
 * the card must not imply the figure describes the block.
 *
 * Dependency-free and side-effect-free: parsing and projection only. The
 * `/api/arcep-fr` proxy imports it; nothing in the browser bundle does.
 */

/** Attribution carried on every payload (see DATA_SOURCES.md). */
export const ARCEP_SOURCE = 'Ma connexion internet — ARCEP';
export const ARCEP_LICENCE = 'Licence Ouverte 2.0';

/** The `last/` alias always points at the newest quarterly edition. */
const ARCEP_BASE = 'https://data.arcep.fr/fixe/maconnexioninternet/statistiques/last/commune';

/**
 * The three files this module reads, and why each one is here.
 *
 * `debit` — the satellite-inflated variant — is deliberately NOT in this list.
 * See the module header.
 */
export const ARCEP_FILES = Object.freeze({
  /** Each local under its best available technology. Partitions exactly. */
  best: 'commune_meilleure_techno_thd.csv',
  /** Wired débit classes only: no satellite, no fixed 4G. */
  wired: 'commune_debit_filaire.csv',
  /** Raw eligibility, for the one column the other two do not carry: copper. */
  techno: 'commune_techno.csv',
});

/** @param {string} file @returns {string} */
export function arcepFileUrl(file) {
  return `${ARCEP_BASE}/${file}`;
}

/**
 * The technology columns of the best-technology file, worst last.
 *
 * Ordered by what the reader would rather have, so a share list reads top to
 * bottom as "how good is it here". `hdr`/`thdr` are fixed radio, `4gf` is
 * fixed 4G, `sat` is satellite.
 */
export const ARCEP_TECHNOLOGIES = Object.freeze([
  Object.freeze({ key: 'ftth', column: 'elig_ftth', label: 'fibre optique', wired: true }),
  Object.freeze({ key: 'coax', column: 'elig_coax', label: 'câble coaxial', wired: true }),
  Object.freeze({ key: 'cuivre30', column: 'elig_cu_30', label: 'cuivre à 30 Mbit/s ou plus', wired: true }),
  Object.freeze({ key: 'thdr', column: 'elig_thdr', label: 'radio très haut débit', wired: false }),
  Object.freeze({ key: 'cuivre8', column: 'elig_cu_8', label: 'cuivre entre 8 et 30 Mbit/s', wired: true }),
  Object.freeze({ key: '4gf', column: 'elig_4gf', label: '4G fixe', wired: false }),
  Object.freeze({ key: 'hdr', column: 'elig_hdr', label: 'radio haut débit', wired: false }),
  Object.freeze({ key: 'sat', column: 'elig_sat', label: 'satellite', wired: false }),
]);

/**
 * The wired débit classes, as `commune_debit_filaire.csv` publishes them.
 *
 * CUMULATIVE, not exclusive: `elig_thd100` premises are a subset of
 * `elig_thd30`. Reported as thresholds for that reason, never as a pie.
 */
export const ARCEP_SPEED_CLASSES = Object.freeze([
  Object.freeze({ key: 'gigabit', column: 'elig_thd1g', label: '1 Gbit/s ou plus', mbps: 1000 }),
  Object.freeze({ key: 'thd100', column: 'elig_thd100', label: '100 Mbit/s ou plus', mbps: 100 }),
  Object.freeze({ key: 'thd30', column: 'elig_thd30', label: '30 Mbit/s ou plus', mbps: 30 }),
  Object.freeze({ key: 'bhd8', column: 'elig_bhd8', label: '8 Mbit/s ou plus', mbps: 8 }),
  Object.freeze({ key: 'hd3', column: 'elig_hd3', label: '3 Mbit/s ou plus', mbps: 3 }),
]);

/**
 * Columns that stay TEXT even when they read as digits.
 *
 * `code_insee` is the one that matters and the bug it prevents was caught by a
 * unit test rather than in production: `01001` passes `/^\d+$/`, and coercing
 * it to a number then back to a string yields `1001`, which fails the
 * five-character INSEE pattern. Every commune of départements 01 to 09 — some
 * 6 000 of them — would have been silently dropped, while Paris and Lyon
 * looked fine. `code_dep` and `code_reg` carry the same hazard (`01`, `2A`).
 */
const ARCEP_TEXT_COLUMNS = new Set(['code_insee', 'nom_com', 'code_dep', 'code_reg', 'type', 'date']);

/**
 * Parse one ARCEP commune CSV into an index keyed on the INSEE code.
 *
 * Values stay as raw integers here; the projection turns them into shares,
 * because the denominator depends on which file the column came from.
 *
 * @param {string} text
 * @returns {{rows: Map<string, object>, header: string[], dropped: number, edition: ?string}}
 */
export function parseArcepCsv(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const header = (lines[0] || '').split(';').map((name) => name.trim());
  const rows = new Map();
  let dropped = 0;
  let edition = null;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split(';');
    if (parts.length !== header.length) { dropped += 1; continue; }
    const record = {};
    for (let c = 0; c < header.length; c += 1) {
      const name = header[c];
      const raw = parts[c].trim();
      record[name] = !ARCEP_TEXT_COLUMNS.has(name) && /^-?\d+$/.test(raw)
        ? Number.parseInt(raw, 10)
        : raw;
    }
    const code = String(record.code_insee || '').toUpperCase();
    if (!/^[0-9][0-9AB][0-9]{3}$/.test(code)) { dropped += 1; continue; }
    // A register that gained a second `type` would double every commune. The
    // published files carry `all` and nothing else — measured 34 877 rows,
    // 34 877 distinct codes — so a row of any other type is refused rather
    // than allowed to overwrite the one that matters.
    if (record.type && record.type !== 'all') { dropped += 1; continue; }
    if (!edition && typeof record.date === 'string') edition = record.date;
    rows.set(code, record);
  }
  return {
    rows, header, dropped, edition,
  };
}

/**
 * A share of a total, in percent to one decimal, or null.
 *
 * **A share below the whole never rounds up to 100.** Paris publishes
 * 1 667 159 copper-connectable premises out of 1 667 292: 99,992 %, which one
 * decimal rounds to 100,0 and a card then prints as "100 % encore raccordables
 * au cuivre". That is a claim the file does not make — 133 premises have
 * already lost their pair — and the same rounding would say "100 % éligibles à
 * la fibre" for a commune with a hundred homes that are not. The floor is
 * applied at 99,9 rather than by adding decimals, because the extra digits are
 * noise everywhere else.
 */
function share(part, total) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return null;
  const rounded = Math.round((part / total) * 1000) / 10;
  if (rounded >= 100 && part < total) return 99.9;
  if (rounded <= 0 && part > 0) return 0.1;
  return rounded;
}

/**
 * Project the three commune rows into one payload.
 *
 * @param {object} options
 * @param {string} options.code Folded commune code — see `communeCode.js`.
 * @param {?object} options.best Row from `commune_meilleure_techno_thd.csv`.
 * @param {?object} options.wired Row from `commune_debit_filaire.csv`.
 * @param {?object} options.techno Row from `commune_techno.csv`.
 * @returns {?object} Null when no file carried this commune at all.
 */
export function projectArcep({ code, best = null, wired = null, techno = null }) {
  const anchor = best || wired || techno;
  if (!anchor) return null;
  const premises = Number.isFinite(anchor.nbr) ? anchor.nbr : null;
  const missing = [];
  if (!best) missing.push('meilleure technologie');
  if (!wired) missing.push('débits filaires');
  if (!techno) missing.push('technologies');

  /** Each local under its best technology — the only column set that sums. */
  let technologies = null;
  let partitionsExactly = null;
  if (best) {
    const covered = Number.isFinite(best.nbr_elig_8) ? best.nbr_elig_8 : null;
    let sum = 0;
    technologies = ARCEP_TECHNOLOGIES.map((technology) => {
      const count = Number.isFinite(best[technology.column]) ? best[technology.column] : 0;
      sum += count;
      return {
        key: technology.key,
        label: technology.label,
        wired: technology.wired,
        premises: count,
        // Denominator is the WHOLE commune, not the covered subset: a reader
        // asking "how many here have fibre" is asking about the commune, and
        // the premises with nothing at all belong in that denominator.
        percent: share(count, premises),
      };
    }).filter((technology) => technology.premises > 0);
    partitionsExactly = covered === null ? null : sum === covered;
    // Premises the register does not place under any technology at all — the
    // real "nothing here" figure, and the reason the shares above do not add
    // up to 100.
    const unserved = covered === null || premises === null ? null : Math.max(0, premises - covered);
    if (unserved !== null && unserved > 0) {
      technologies.push({
        key: 'aucune',
        label: 'aucune offre à 8 Mbit/s',
        wired: false,
        premises: unserved,
        percent: share(unserved, premises),
      });
    }
  }

  /** Wired thresholds. Cumulative, so never drawn as a partition. */
  const speeds = wired
    ? ARCEP_SPEED_CLASSES.map((speed) => ({
      key: speed.key,
      label: speed.label,
      mbps: speed.mbps,
      premises: Number.isFinite(wired[speed.column]) ? wired[speed.column] : null,
      percent: share(wired[speed.column], premises),
    }))
    : null;

  const copper = techno && Number.isFinite(techno.elig_cu)
    ? { premises: techno.elig_cu, percent: share(techno.elig_cu, premises) }
    : null;

  return {
    commune: {
      code: String(code ?? anchor.code_insee ?? '').toUpperCase(),
      departement: anchor.code_dep ? String(anchor.code_dep) : null,
      region: anchor.code_reg ? String(anchor.code_reg) : null,
    },
    edition: anchor.date || null,
    premises,
    technologies,
    // Stated rather than assumed. The claim "these shares add up" is checked
    // against this edition's own arithmetic on every scan; a future edition
    // that stopped partitioning would say so instead of being drawn as a pie.
    partitionsExactly,
    speeds,
    // Wired-only, and the payload says so, because the same register's
    // satellite-inclusive variant answers 100 % to the same question.
    speedsBasis: 'filaire',
    copper,
    // Ineligible to any WIRED high-speed offer. 1,7 % nationally, against the
    // 0,0 % the satellite-inclusive file reports.
    wiredIneligible: wired && Number.isFinite(wired.inel_hd)
      ? { premises: wired.inel_hd, percent: share(wired.inel_hd, premises) }
      : null,
    missing,
    source: ARCEP_SOURCE,
    licence: ARCEP_LICENCE,
  };
}
