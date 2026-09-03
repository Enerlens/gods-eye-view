import * as Cesium from 'cesium';
import { DPE_LABELS } from './dpeFeed.js';
import { addressMarkerGlyph, dpeLetterKind } from './addressMarkerIcons.js';
import { createAddressScanLayer } from './addressScanLayer.js';
import { bdtopoLoadedFootprints } from './bdtopoBuildings.js';
import {
  clearBuildingTheme,
  joinPointsToBuildings,
  registerBuildingTheme,
} from './buildingTheme.js';
import { governorRequestRender } from '../renderGovernor.js';

/**
 * ADEME DPE — the energy label of this building, and of every one around it.
 *
 * A diagnostic is compulsory for any French sale, so the register is close to a
 * census of what has changed hands since July 2021 — 15,476,290 rows, geocoded
 * against the BAN. A listing shows one letter. This shows the street's.
 *
 * THE COLOURS ARE THE OFFICIAL ONES. A to G on the state's own DPE scale, dark
 * green through dark red. Inventing a palette here would make the layer
 * unreadable to the only people who already know what the letters mean.
 *
 * NO NEIGHBOURHOOD GRADE. The distribution is reported; the mean is not. A DPE
 * describes one dwelling's envelope and boiler, and the average of a street's
 * letters is not a property of the street.
 *
 * ── The volumes carry the letter now (REPRESENTATION, piste 1) ──────────────
 *
 * `bdtopoBuildings.js` extrudes the BD TOPO footprints of the viewport, and
 * until now this layer drew a badge floating ABOVE the roof it was talking
 * about. It publishes a theme to `buildingTheme.js` instead: the volume takes
 * the diagnostic's own colour, and the badge stays as the handle and the card.
 * The badge is a SUPPLEMENT, never a replacement — with `Bâti 3D` switched off
 * nothing about this layer changes, byte for byte.
 *
 * • **Precedence 10** — ahead of the two other themes this seam is built for
 *   (€/m², permit state). Not because energy matters more, but because this is
 *   the densest register of the three (15.4 M rows against 4.4 M mutations) and
 *   the only one that grades the BUILDING rather than a transaction on it.
 *
 * • **The reduce rule is the MODE, and the mode is never invented.** Several
 *   diagnostics on one building is the normal case, not the edge case: a block
 *   of flats produces one per sale. The letter painted is the one held by the
 *   most diagnostics on that footprint — an observed value, present in the
 *   data, unlike a mean of letters, which would be an ordinal average of an
 *   ordinal scale whose classes are not evenly spaced (measured on the palette
 *   below: 21.1 to 53.1 ΔE76 between adjacent classes, a factor 2.5). The mode
 *   is also the one summary that survives the shape of the register: the
 *   envelope and the heating plant are SHARED by the whole building, so the
 *   letters of its flats genuinely cluster, and the cluster is the building.
 *
 *   Ties go to the WORSE letter — three C and three E paints E. A tie is a
 *   building the rule cannot summarise, and of the two readings the pessimistic
 *   one is the one that cannot mislead a reader into thinking a *passoire* is
 *   not there. It is also deterministic: the seven letters are distinct, so the
 *   answer never depends on the order the register returned its rows in.
 *
 *   Two rules that were considered and refused. **The most recent** diagnostic
 *   is a property of one flat that happened to sell last, not of the building.
 *   **The worst** turns one bad studio out of forty into a G on a whole block —
 *   the exact overstatement A1 exists to forbid, in the other direction.
 *
 * • **What the mode cannot see, stated.** The register publishes `numero_dpe`
 *   (per diagnostic) and `identifiant_ban` (per ADDRESS), and no dwelling key
 *   at all. A flat re-diagnosed in 2021 and again in 2024 therefore votes
 *   twice. De-duplicating on `(identifiant_ban, surface_habitable_logement)`
 *   was tried on paper and refused: in a French apartment block the same floor
 *   plan is stacked storey after storey, so identical surfaces at one address
 *   are the NORMAL case and that key would collapse a whole column of flats
 *   into a single vote. A double vote is a smaller error than a deleted one.
 *
 * • **A building whose diagnostics disagree must not look homogeneous.** The
 *   volume can only carry one colour, so the dispersion is carried by the
 *   badges: a badge goes QUIET (12 px instead of 20) when the volume under it
 *   already says its own letter, and keeps its full size otherwise. A unanimous
 *   block therefore falls silent and reads as one painted volume; a block whose
 *   diagnostics run B to F keeps every dissenting badge at full size on its
 *   roof, which is the sign that the colour underneath is a summary. One rule,
 *   one meaning (A3): the size of a badge is how much of it is NOT already said
 *   by the volume. A diagnostic with no published letter never agrees with
 *   anything, so it keeps its full 16 px — it is the one thing the paint cannot
 *   express. The card states the range in words on top of that.
 *
 * • **The palette is safe against "not measured", and fails the greyscale
 *   test.** Measured over the six BD TOPO usage hues, each washed by
 *   `unknownBuildingCss` and then darkened across the layer's whole height
 *   range: the closest any DPE class comes to any unjoined volume is ΔE76
 *   **58.5** (A `#319834` against a washed `Agricole`), against the 25 the seam
 *   asks for and the 2.3 of a just-noticeable difference. Nothing here can be
 *   read as an absence.
 *
 *   The honest half: converted to grey the official ramp is a HUMP, not a
 *   ladder — L* 55.4, 72.3, 92.8, 96.6, 83.8, 72.1, 52.7 for A to G. B and F
 *   land 0.2 L* apart and A and G 2.7 apart. The B4 test ("convert the ramp to
 *   greyscale, does the order survive?") fails, and it fails for the official
 *   French palette, not for ours. B4's own carve-out is why it is kept: a
 *   strong cultural code outranks Bertinian purity. What it costs is written
 *   down here — under a sensor pass, or for a deuteranope, the PAINTED VOLUME
 *   stops being readable while the BADGE, which draws the letter as a shape,
 *   does not. That is the second reason the badges stay.
 *
 * • **The scan is 200 m wide and the city is 9 km wide (A5, H1).** This layer
 *   asks the ADEME for the 200 nearest diagnostics within 200 m of the point
 *   the camera is looking at; the volumes on screen can span `BDTOPO_MAX_BOX_DEG`
 *   (0.08°, ~9 km). So the unpainted volumes are two different things at once —
 *   never diagnosed, and never asked about — and the theme's "no data" row says
 *   exactly that: *sans DPE dans le rayon scanné*. The row's coverage line
 *   carries the numbers that go with it: diagnostics served over diagnostics
 *   known within the radius (2,805 within 300 m of one Paris 13e point, so the
 *   200-row page is a truncation and says so), then volumes painted over
 *   volumes loaded.
 *
 * • **A theme with nothing to paint does not take the city's colours away.**
 *   When the scan comes back with no published letter at all — a rural point,
 *   or a camera above the scan ceiling — the theme is WITHDRAWN rather than
 *   registered empty. A grey city under an all-zero legend reads as a broken
 *   layer, and the wash only means anything as a contrast to a measurement that
 *   exists somewhere on screen.
 *
 * ── Why the join is run twice, and what it costs ────────────────────────────
 *
 * The seam runs its own join inside `bdtopoBuildings.js` to decide the colours.
 * This module runs a SECOND one, over `bdtopoLoadedFootprints()`, because the
 * badge and its card are drawn here and neither the badge size nor the card's
 * "immeuble : 12 DPE, de B à F" line can be written without knowing which
 * footprint a diagnostic landed on. Measured on this machine, best of nine,
 * with the ring copy included:
 *
 *     3 000 volumes × 200 diagnostics    0.6 ms copy + 0.9 ms join
 *     14 000 volumes (the cap) × 200     1.8 ms copy + 8.6 ms join
 *
 * — on a path already debounced 450 ms behind the camera settling, against the
 * 2 to 10 dropped frames the naive nested loop cost the seam. Both joins run
 * the same pure `dpeBuildingSummary()` over the same points, so they cannot
 * disagree about a building they both see.
 *
 * `registerBuildingTheme()` is not followed by an `applyBuildingTheme()` call
 * and the BD TOPO layer is not asked to repaint. Registering ALREADY notifies
 * it — it subscribes in its own `init()` — and the second call would be a
 * second full repaint of the batch per scan. In the one case where the
 * subscription does not exist yet, `Bâti 3D` never having been switched on, the
 * manager initialises layers lazily and an explicit call would find no records
 * either; the volumes are painted a moment later by the layer's own first
 * `drawRecords()`, which resolves the active theme before its first colour.
 *
 * The traffic runs the other way too — the volume layer reloads its tiles on
 * its own, without telling anyone — so this module treats a call to its own
 * `reduce()` as the signal that the city was repainted, and re-syncs the badges
 * on the microtask after it. That is the only notification the seam offers, and
 * it is what makes the badges quieten down when `Bâti 3D` comes on after this
 * layer, with no rescan and no request.
 *
 * @module data/dpeFrance
 */

const UPDATE_INTERVAL_MS = 600_000;
const SCAN_RADIUS_M = 200;
const SCAN_LIMIT = 200;

/**
 * Marker size, in CSS px. A letter needs more pixels than a dot did — 20 is
 * where A, B and G stop trading places at a glance, measured on the proof
 * sheet. A diagnostic with no published grade draws smaller: it is a marker
 * that something exists here, not a grade.
 */
const SIZE_LABELLED_PX = 20;
const SIZE_UNLABELLED_PX = 16;

/**
 * A badge whose volume already says its letter.
 *
 * Not hidden: it is still the click target and the only way to the card, and a
 * volume carries ONE letter while a block carries many diagnostics. 12 px is
 * above the 10 px this repo draws its smallest markers at (`datacentersPack`),
 * and a selection grows it back to 18 px, so the handle never gets smaller than
 * what is already shipped elsewhere.
 */
const SIZE_QUIET_PX = 12;

/** The official DPE scale, A (best) to G (worst). */
export const DPE_COLORS = Object.freeze({
  A: '#319834',
  B: '#33cc31',
  C: '#cbfc34',
  D: '#fbfe06',
  E: '#fbcc05',
  F: '#fc9935',
  G: '#fc0205',
});
const COLOR_UNLABELLED_CSS = '#7c8aa0';
const COLOR_UNLABELLED = Cesium.Color.fromCssColorString(COLOR_UNLABELLED_CSS);

/** The theme id published to the building registry — the layer's own id. */
export const DPE_THEME_ID = 'dpe-fr';

/**
 * Lowest of the three themes the seam is built for, so DPE paints when two are
 * on. See the header for why it wins rather than €/m².
 */
export const DPE_THEME_PRECEDENCE = 10;

/**
 * The energy axis of the 2021 classes, in kWh/m²/an of primary energy.
 *
 * The published class is the WORSE of two axes — energy and greenhouse gas —
 * so these bounds explain a class without predicting it, which is why the
 * blurbs say so. Arrêté du 31 mars 2021.
 */
const GRADE_ENERGY = Object.freeze({
  A: 'jusqu\'à 70 kWh/m²/an',
  B: '71 à 110 kWh/m²/an',
  C: '111 à 180 kWh/m²/an',
  D: '181 à 250 kWh/m²/an',
  E: '251 à 330 kWh/m²/an',
  F: '331 à 420 kWh/m²/an',
  G: 'plus de 420 kWh/m²/an',
});

/** French, and the same sentence in the row legend and on the volumes. */
const THEME_LABEL = 'Performance énergétique (DPE)';

/**
 * What an unpainted volume means here, in the theme's own words.
 *
 * Two causes in one phrase on purpose: a building inside the scanned disc with
 * no diagnostic, and a building the scan never reached, are both true readings
 * of it. Separating them would need a second wash colour, which A1 spends on
 * "measured / not measured" and cannot spend twice.
 */
const THEME_UNKNOWN_LABEL = 'sans DPE dans le rayon scanné';

/**
 * Colour one diagnostic by its published label.
 * @param {string|null} label
 * @returns {object} Cesium colour.
 */
export function dpeColor(label) {
  const css = DPE_COLORS[label];
  return css ? Cesium.Color.fromCssColorString(css) : COLOR_UNLABELLED;
}

/** A published letter, or null. Anything outside A–G is not a grade. */
function gradeOf(entry) {
  const letter = String(entry?.etiquetteDpe ?? '').toUpperCase();
  return DPE_LABELS.includes(letter) ? letter : null;
}

/**
 * Summarise every diagnostic that landed on one footprint.
 *
 * Pure, and the ONLY place the rule lives: the theme's `reduce()` and this
 * module's own join both call it, so the colour on a roof and the size of the
 * badge on top of it cannot come from two different answers.
 *
 * `grade` is the mode, ties to the worse letter (see the header). It is null
 * when no diagnostic on the building published a letter — the volume then stays
 * washed rather than being given a default grade, which is A1 applied to the
 * one thing this layer must never invent.
 *
 * @param {Array<object>} points Diagnostics on one building, any order.
 * @returns {{grade: ?string, votes: number, graded: number, ungraded: number,
 *   total: number, best: ?string, worst: ?string, spread: number,
 *   mixed: boolean, letters: Array<string>}}
 */
export function dpeBuildingSummary(points) {
  const counts = new Map();
  let graded = 0;
  let ungraded = 0;
  for (const point of points || []) {
    const letter = gradeOf(point);
    if (!letter) { ungraded += 1; continue; }
    graded += 1;
    counts.set(letter, (counts.get(letter) || 0) + 1);
  }
  let grade = null;
  let votes = 0;
  let best = null;
  let worst = null;
  // A to G, taking a tie: the LAST letter to match the running maximum wins,
  // and the labels are ordered worst-last, so a tie resolves pessimistically
  // without a second comparison.
  for (const letter of DPE_LABELS) {
    const n = counts.get(letter) || 0;
    if (!n) continue;
    if (best === null) best = letter;
    worst = letter;
    if (n >= votes) { votes = n; grade = letter; }
  }
  const letters = DPE_LABELS.filter((letter) => counts.has(letter));
  const spread = best === null ? 0 : DPE_LABELS.indexOf(worst) - DPE_LABELS.indexOf(best);
  return {
    grade,
    votes,
    graded,
    ungraded,
    total: graded + ungraded,
    best,
    worst,
    spread,
    mixed: letters.length > 1,
    letters,
  };
}

/**
 * How big a badge is drawn, given what the volume under it already says.
 *
 * @param {object} entry A drawn diagnostic.
 * @param {?string} paintedGrade The letter painted on its building, or null
 *   when no volume is painted for it — `Bâti 3D` off, footprint not loaded, or
 *   a building the theme declined to grade.
 * @returns {number} CSS px.
 */
export function dpeMarkerSizePx(entry, paintedGrade = null) {
  const letter = gradeOf(entry);
  if (!letter) return SIZE_UNLABELLED_PX;
  return paintedGrade === letter ? SIZE_QUIET_PX : SIZE_LABELLED_PX;
}

/** `12 diagnostics` / `1 diagnostic`, in French. */
function plural(n, singular, pluralForm = `${singular}s`) {
  return `${n.toLocaleString('fr-FR')} ${n > 1 ? pluralForm : singular}`;
}

/**
 * The card of one diagnostic, as the ` · `-separated string the scan shell
 * splits into card lines.
 *
 * The building line sits SECOND, right behind the grade, and pushes the
 * distance to the scan centre towards the six-line cap the overlay applies:
 * "this block is not unanimous" changes how the colour under the badge must be
 * read, and "37 m from where the camera is pointing" does not.
 *
 * @param {object} entry
 * @param {?object} summary Its building's summary, or null when unjoined.
 * @param {boolean} joinRan Whether any footprint was loaded at all — without
 *   one, "not on a building" is a statement about `Bâti 3D`, not about the DPE.
 * @returns {string}
 */
export function dpeCardDescription(entry, summary = null, joinRan = false) {
  let building = null;
  if (summary) {
    const head = `immeuble : ${plural(summary.total, 'DPE', 'DPE')}`;
    if (summary.mixed) {
      building = `${head}, de ${summary.best} à ${summary.worst}, volume peint ${summary.grade}`;
    } else if (summary.grade && summary.ungraded) {
      building = `${head}, ${summary.graded} en ${summary.grade}, `
        + `${summary.ungraded} sans étiquette`;
    } else if (summary.grade) {
      building = `${head}, tous ${summary.grade}`;
    } else {
      building = `${head}, aucune étiquette publiée`;
    }
  } else if (joinRan) {
    building = 'hors des emprises BD TOPO chargées';
  }
  return [
    entry.etiquetteDpe ? `Énergie ${entry.etiquetteDpe}` : 'Étiquette non publiée',
    building,
    entry.etiquetteGes ? `GES ${entry.etiquetteGes}` : null,
    entry.surfaceM2 ? `${entry.surfaceM2} m²` : null,
    Number.isFinite(entry.annualCostEur)
      ? `${Math.round(entry.annualCostEur).toLocaleString('fr-FR')} €/an estimés` : null,
    entry.consoKwhM2 ? `${entry.consoKwhM2} kWh/m²/an` : null,
    entry.issuedOn ? `diagnostic du ${entry.issuedOn}` : null,
    entry.distanceM !== null ? `${entry.distanceM} m` : null,
  ].filter(Boolean).join(' · ');
}

/**
 * The seven classes as a legend, always all seven.
 *
 * A frozen domain scale (C1): the DPE ladder is the state's, not this
 * viewport's, so a letter nobody drew is still printed at zero rather than
 * dropped. Removing D because no building on screen holds one would leave
 * A B C E F G, and a reader would decode the ramp against the wrong rungs.
 *
 * @param {Array<object>} values Building summaries the theme actually painted.
 * @returns {Array<{label: string, color: string, count: number, blurb: string}>}
 */
export function dpeThemeLegend(values) {
  const painted = new Map(DPE_LABELS.map((letter) => [letter, 0]));
  const disputed = new Map(DPE_LABELS.map((letter) => [letter, 0]));
  for (const value of values || []) {
    if (!value?.grade) continue;
    painted.set(value.grade, painted.get(value.grade) + 1);
    if (value.mixed) disputed.set(value.grade, disputed.get(value.grade) + 1);
  }
  return DPE_LABELS.map((letter) => {
    const mixed = disputed.get(letter);
    return {
      label: letter,
      color: DPE_COLORS[letter],
      count: painted.get(letter),
      blurb: `${GRADE_ENERGY[letter]} — la classe publiée est la pire des deux axes, `
        + 'énergie et gaz à effet de serre. Le volume porte l\'étiquette tenue par le plus '
        + 'de diagnostics du bâtiment, jamais leur moyenne.'
        + (mixed
          ? ` ${plural(mixed, 'immeuble')} peint${mixed > 1 ? 's' : ''} ${letter} `
            + `${mixed > 1 ? 'ne sont pas unanimes' : 'n\'est pas unanime'} : les diagnostics `
            + 'qui en diffèrent gardent leur badge à taille pleine sur le toit.'
          : ''),
    };
  });
}

/* ── the join this layer runs for itself ───────────────────────────────── */

/** The entities of the last draw, so a later repaint can resize its badges. */
let _dataSource = null;
/**
 * Every diagnostic of the last answer, drawable or not.
 *
 * The rows with no coordinate are kept in this list and handed to the theme,
 * because dropping them here would silently improve `unplacedPoints` — the A5
 * counter whose whole job is to say that a diagnostic exists and is painted
 * nowhere. They simply never get an entity.
 */
let _entries = [];
/** The last join: summaries by building, by point, and the honesty counters. */
let _join = null;
/** True while a badge re-sync is already queued behind a theme repaint. */
let _resyncQueued = false;
/**
 * Whether the answer changed since the theme was last published.
 *
 * The manager ticks this layer every ten minutes and the camera settles far
 * more often than that, and most of those passes find the scan centre inside
 * its 250 m threshold and refetch nothing. Re-registering an unchanged theme
 * would still notify the volume layer, which would repaint fourteen thousand
 * instances to arrive at the colours they already had.
 */
let _themeDirty = false;
/** Whether the manager has this layer switched on. */
let _enabled = false;
/** Pushed by the manager so a deferred re-sync can repaint the row. */
let _rowControlsListener = null;

/** The empty join — the shape every caller can read without a null check. */
function emptyJoin() {
  return {
    byPoint: new Map(),
    byBuilding: new Map(),
    buildings: 0,
    painted: 0,
    mixed: 0,
    matchedPoints: 0,
    unmatchedPoints: 0,
    unplacedPoints: 0,
    ungradedPoints: 0,
  };
}

/**
 * Join the drawn diagnostics onto the volumes currently loaded.
 *
 * `bdtopoLoadedFootprints()` hands back COPIES of the rings, so nothing here
 * can reach the objects the primitive was built from. With `Bâti 3D` off it
 * returns an empty list and every counter below is honestly zero.
 *
 * @param {Array<object>} entries
 * @returns {object} see {@link emptyJoin}.
 */
function computeJoin(entries) {
  const result = emptyJoin();
  for (const entry of entries || []) {
    if (!gradeOf(entry)) result.ungradedPoints += 1;
  }
  let footprints = [];
  try {
    footprints = bdtopoLoadedFootprints();
  } catch (error) {
    console.warn('[dpe-fr] building footprints unavailable:', error);
    return result;
  }
  if (!footprints.length || !entries?.length) return result;

  const join = joinPointsToBuildings(footprints, entries);
  result.buildings = join.buildings;
  result.matchedPoints = join.matchedPoints;
  result.unmatchedPoints = join.unmatchedPoints;
  result.unplacedPoints = join.unplacedPoints;
  for (const [buildingId, points] of join.byBuilding) {
    const summary = dpeBuildingSummary(points);
    result.byBuilding.set(buildingId, summary);
    if (summary.grade) {
      result.painted += 1;
      if (summary.mixed) result.mixed += 1;
    }
    for (const point of points) {
      if (point?.id !== undefined) result.byPoint.set(point.id, summary);
    }
  }
  return result;
}

/** Read a billboard number back off its Cesium property. */
function billboardNumber(property) {
  const value = property?.getValue?.(Cesium.JulianDate.now()) ?? property;
  return Number(value);
}

/**
 * Resize the badges and rewrite their cards from the current join.
 *
 * The SELECTED badge is skipped, for the same reason the volume layer skips the
 * selected volume: the operator enlarged it themselves, and the shell holds a
 * snapshot of its size to put back on Escape. Writing over that snapshot's
 * subject would restore the wrong size.
 *
 * @param {?string} selectedId The shell's currently selected entity id.
 * @returns {number} badges changed.
 */
function applyBadges(selectedId = null) {
  if (!_dataSource) return 0;
  let changed = 0;
  for (const entry of _entries) {
    const entityId = `dpe:${entry.id}`;
    if (entityId === selectedId) continue;
    const entity = _dataSource.entities.getById?.(entityId);
    if (!entity?.billboard) continue;
    const summary = _join?.byPoint.get(entry.id) || null;
    const size = dpeMarkerSizePx(entry, summary?.grade ?? null);
    entity.description = dpeCardDescription(entry, summary, Boolean(_join?.buildings));
    if (billboardNumber(entity.billboard.width) === size) continue;
    entity.billboard.width = size;
    entity.billboard.height = size;
    changed += 1;
  }
  if (changed) governorRequestRender('dpe-badges');
  return changed;
}

/**
 * Re-run the join and the badges on the microtask after a theme repaint.
 *
 * The volume layer repaints on its own schedule — a tile load, a camera settle,
 * another theme being withdrawn — and publishes no event for it. The one signal
 * that reaches this module is its own `reduce()` being called, which happens
 * once per building inside that repaint; a single deferred pass therefore
 * coalesces the whole batch into one join. It is also what makes turning
 * `Bâti 3D` ON after this layer work: the badges quieten down without a rescan.
 */
function queueBadgeResync() {
  if (_resyncQueued) return;
  _resyncQueued = true;
  queueMicrotask(() => {
    _resyncQueued = false;
    if (!_enabled || !_dataSource) return;
    _join = computeJoin(_entries);
    applyBadges(dpeScanLayer.getStats().selectedId);
    _rowControlsListener?.();
  });
}

/* ── the theme ─────────────────────────────────────────────────────────── */

/**
 * Publish, or withdraw, the building theme.
 *
 * Withdrawn rather than registered empty when nothing on screen carries a
 * letter: see the header. Re-registering the same id keeps the theme's place in
 * the precedence queue and notifies the volume layer, which is the whole repaint
 * path — no call into `bdtopoBuildings.js` is needed and none is made.
 *
 * @returns {boolean} whether a theme is now registered.
 */
function publishTheme() {
  const graded = _entries.some((entry) => gradeOf(entry));
  if (!_enabled || !graded) {
    _themeDirty = false;
    clearBuildingTheme(DPE_THEME_ID);
    return false;
  }
  _themeDirty = false;
  registerBuildingTheme({
    id: DPE_THEME_ID,
    label: THEME_LABEL,
    precedence: DPE_THEME_PRECEDENCE,
    unknownLabel: THEME_UNKNOWN_LABEL,
    // Every diagnostic, not only the graded ones: an ungraded diagnostic still
    // lands on a building, still counts as matched, and is still one of the
    // reasons a volume can be painted a letter that a badge on its roof
    // disagrees with. Dropping them here would silently improve the A5 counts.
    points: _entries,
    reduce(points) {
      // The signal the seam does not otherwise give: being asked to reduce
      // means the batch is being repainted right now.
      queueBadgeResync();
      const summary = dpeBuildingSummary(points);
      return summary.grade ? summary : null;
    },
    colorFor: (value) => DPE_COLORS[value?.grade] || null,
    legend: DPE_LABELS.map((letter) => ({ label: letter, color: DPE_COLORS[letter] })),
    legendFor: dpeThemeLegend,
  });
  return true;
}

/** Withdraw the theme and let the volumes go back to their usage colours. */
function withdrawTheme() {
  clearBuildingTheme(DPE_THEME_ID);
}

/* ── the row, and the stats ────────────────────────────────────────────── */

/**
 * The badge ramp, which is this layer's own channel.
 *
 * The seven letters count DIAGNOSTICS, because that is what this layer draws.
 * When the theme is painting, the `Bâti 3D` row publishes the same seven
 * colours counting VOLUMES — a different population of the same classes — and
 * the two are not merged: one legend per channel, and neither row invents a
 * count for a mark it does not draw.
 *
 * The eighth row is the one A1 has always been owed here: a diagnostic with no
 * published letter draws a grey badge and had no legend entry at all.
 *
 * @param {object} payload The answer that is actually on screen.
 * @returns {{legend: Array<object>}}
 */
export function dpeRowControls(payload) {
  const distribution = payload?.distribution || {};
  const legend = DPE_LABELS.map((letter) => ({
    label: letter,
    color: DPE_COLORS[letter],
    count: distribution[letter] || 0,
    blurb: `${GRADE_ENERGY[letter]} — la classe publiée est la pire des deux axes, `
      + 'énergie et gaz à effet de serre.',
  }));
  legend.push({
    label: 'étiquette non publiée',
    color: COLOR_UNLABELLED_CSS,
    count: _join?.ungradedPoints ?? 0,
    blurb: 'Diagnostic présent dans le registre sans étiquette exploitable. Il ne peut '
      + 'peindre aucun volume et n\'est jamais rapproché de la lettre la plus proche.',
  });
  return { legend };
}

/**
 * What this layer adds to `getStats()`.
 *
 * The A5 sentence goes in `coverage` rather than in `loadingLabel`, because the
 * manager prints coverage BEFORE the age and `loadingLabel` INSTEAD of it: the
 * boundary of the answer and the age of the answer both have to reach the row.
 *
 * @param {object} payload
 * @returns {object}
 */
export function dpeSummarize(payload) {
  const distribution = payload?.distribution || {};
  const labelled = DPE_LABELS.reduce((sum, letter) => sum + (distribution[letter] || 0), 0);
  const poor = (distribution.F || 0) + (distribution.G || 0);
  const served = (payload?.entries || []).length;
  const total = payload?.total ?? null;
  const join = _join || emptyJoin();
  const painting = Boolean(_enabled && join.painted);
  const scan = total !== null && total > served
    ? `${served.toLocaleString('fr-FR')} DPE servis sur ${total.toLocaleString('fr-FR')} `
      + `dans ${SCAN_RADIUS_M} m (les plus proches du centre)`
    : `${plural(served, 'DPE', 'DPE')} dans ${SCAN_RADIUS_M} m`;
  const paint = painting
    ? ` · ${plural(join.painted, 'volume')} peint${join.painted > 1 ? 's' : ''} `
      + `sur ${join.buildings.toLocaleString('fr-FR')} chargés`
    : '';
  return {
    // "2,805 diagnostics within 300 m" against "here are the 200 nearest".
    diagnosticsTotal: total,
    diagnosticsServed: served,
    truncated: payload?.truncated === true,
    distribution,
    // Share of F and G — the *passoires thermiques* whose letting is being
    // phased out, and the single most decision-relevant cut of this register.
    poorCount: poor,
    poorShare: labelled ? Math.round((poor / labelled) * 100) : null,
    medianCoutAnnuel: payload?.medianCoutAnnuel ?? null,
    coverage: `${scan}${paint}`,
    // A5, published rather than only printed: painted over loaded, and the two
    // ways a diagnostic can fail to reach a volume.
    themePainting: painting,
    themeBuildings: join.buildings,
    themePainted: join.painted,
    themeUnpainted: Math.max(0, join.buildings - join.painted),
    themeMixedBuildings: join.mixed,
    themeUnmatchedPoints: join.unmatchedPoints,
    themeUnplacedPoints: join.unplacedPoints,
    themeUngradedPoints: join.ungradedPoints,
  };
}

/* ── the layer ─────────────────────────────────────────────────────────── */

const dpeScanLayer = createAddressScanLayer({
  id: 'dpe-fr',
  name: THEME_LABEL,
  icon: '▤',
  source: 'ADEME — Observatoire DPE',
  endpoint: '/api/dpe',
  updateInterval: UPDATE_INTERVAL_MS,
  params: () => ({ radius: String(SCAN_RADIUS_M), limit: String(SCAN_LIMIT) }),

  render({ payload, dataSource }) {
    _dataSource = dataSource;
    _entries = payload.entries || [];
    // Before the first billboard: the badge's size and its card both depend on
    // which volume the diagnostic landed on, and a marker drawn at 20 px and
    // shrunk a frame later is a flicker the reader has to interpret.
    _join = computeJoin(_entries);
    _themeDirty = true;

    let drawn = 0;
    for (const entry of _entries) {
      if (!Number.isFinite(entry.lon) || !Number.isFinite(entry.lat)) continue;
      const summary = _join.byPoint.get(entry.id) || null;
      const size = dpeMarkerSizePx(entry, summary?.grade ?? null);
      dataSource.entities.add({
        id: `dpe:${entry.id}`,
        position: Cesium.Cartesian3.fromDegrees(entry.lon, entry.lat),
        billboard: {
          // THE LETTER ITSELF, framed. A DPE dot next to a DVF dot said
          // nothing about which register either came from, and the colour
          // channel was already spent on the official scale. Drawing the label
          // solves both at once: the shape says DPE, and the grade no longer
          // needs a click. See `addressMarkerIcons.js`.
          image: addressMarkerGlyph(`dpe:${dpeLetterKind(entry.etiquetteDpe)}`),
          // Size is one statement: how much of this diagnostic the volume under
          // it is not already making. Full when nothing is painted, when the
          // painted letter differs, or when no letter was published; quiet when
          // the roof already says exactly this.
          width: size,
          height: size,
          // The glyph is white line-art; this tint is the official A–G scale.
          color: dpeColor(entry.etiquetteDpe),
          // POSITIVE_INFINITY, not a distance. With a finite value the marker is
          // depth-tested as soon as the camera is further away than that, and
          // the terrain then eats the bottom half of every glyph — the reported
          // symptom was "the dots don't display properly", and at city zoom
          // they were rendering clipped by the ground under them. These are
          // annotations ON the world, not objects IN it.
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: {
          kind: 'dpe',
          etiquetteDpe: entry.etiquetteDpe,
          etiquetteGes: entry.etiquetteGes,
          issuedOn: entry.issuedOn,
          buildingGrade: summary?.grade ?? null,
        },
        name: entry.address || `DPE ${entry.id}`,
        description: dpeCardDescription(entry, summary, Boolean(_join.buildings)),
      });
      drawn += 1;
    }
    return drawn;
  },

  rowControls: (_runtime, _summary, payload) => dpeRowControls(payload),

  summarize: dpeSummarize,
});

/**
 * The scan layer, plus the theme lifecycle around it.
 *
 * Composition rather than a hook inside `addressScanLayer.js`: four sibling
 * layers share that shell and none of them paints a volume, so the seam belongs
 * to whichever layer opens it. The shell's own methods are kept by reference —
 * they close over its state, and none of them reads `this`.
 */
const dpeFranceLayer = {
  ...dpeScanLayer,

  // The lifecycle results are forwarded, not swallowed: the manager reads
  // `!== false` off each of these to decide whether a failed enable was cleanly
  // torn down, and a wrapper that returned its own `undefined` would answer for
  // a shell it did not ask.
  enable(...args) {
    _enabled = true;
    // Nothing is registered yet: the shell is about to force the next update to
    // rescan, and painting the city from a payload fetched three cities ago is
    // exactly the lie the wash is there to prevent.
    _entries = [];
    _join = null;
    _themeDirty = false;
    withdrawTheme();
    return dpeScanLayer.enable(...args);
  },

  disable(...args) {
    _enabled = false;
    _entries = [];
    _join = null;
    _themeDirty = false;
    // Before the shell hides the markers, so the volumes and the badges leave
    // together rather than the city staying painted by a layer that is off.
    withdrawTheme();
    return dpeScanLayer.disable(...args);
  },

  destroy(...args) {
    _enabled = false;
    _entries = [];
    _join = null;
    _themeDirty = false;
    _dataSource = null;
    _rowControlsListener = null;
    withdrawTheme();
    return dpeScanLayer.destroy(...args);
  },

  async update(...args) {
    const ok = await dpeScanLayer.update(...args);
    // The shell clears its draw when the camera climbs above the scan ceiling.
    // The theme has to go with it: a wash held over from 300 m up would claim
    // the whole region is undiagnosed on the strength of a 200 m disc.
    if (dpeScanLayer.getStats().dormant) {
      _entries = [];
      _join = null;
      _themeDirty = false;
      withdrawTheme();
      return ok;
    }
    if (_themeDirty) publishTheme();
    return ok;
  },

  /**
   * The manager pushes a repaint callback here so a row can update outside its
   * own refresh tick — which is what a deferred badge re-sync needs after the
   * volume layer repaints on its own schedule.
   * @param {?Function} listener
   */
  setRowControlsListener(listener) {
    _rowControlsListener = typeof listener === 'function' ? listener : null;
    dpeScanLayer.setRowControlsListener?.(listener);
  },
};

/* ── test seams ────────────────────────────────────────────────────────── */

/**
 * Drive the theme without a viewer: seed the drawn diagnostics, run the join
 * against whatever `bdtopoBuildings.js` currently holds, and publish.
 *
 * The same order the render path uses — join, then publish — so a test cannot
 * accidentally prove a sequence the layer never runs.
 *
 * @param {Array<object>} entries Diagnostics, with or without coordinates.
 * @param {{dataSource?: object, enabled?: boolean}} [options]
 * @returns {object} the join, in the shape `summarize()` reads.
 */
export function _seedDpeThemeForTest(entries, { dataSource = null, enabled = true } = {}) {
  _enabled = enabled;
  _dataSource = dataSource;
  _entries = entries || [];
  _join = computeJoin(_entries);
  _themeDirty = true;
  publishTheme();
  return _join;
}

/** Resize the badges of a seeded data source from the current join. */
export function _applyDpeBadgesForTest(selectedId = null) {
  return applyBadges(selectedId);
}

/** Forget everything this module remembers between tests. */
export function _resetDpeThemeForTest() {
  _enabled = false;
  _entries = [];
  _join = null;
  _themeDirty = false;
  _dataSource = null;
  _rowControlsListener = null;
  withdrawTheme();
}

export default dpeFranceLayer;
