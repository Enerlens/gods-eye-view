import * as Cesium from 'cesium';
import { addressMarkerGlyph } from './addressMarkerIcons.js';
import { createAddressScanLayer } from './addressScanLayer.js';
import { ADS_DEFAULT_MONTHS, ADS_DEFAULT_RADIUS_M, ADS_MAX_MONTHS } from './adsFeed.js';
import { clearBuildingTheme, registerBuildingTheme } from './buildingTheme.js';
// The third urbanism layer takes the second one's surface rule rather than
// writing a third copy of it; `urbanismeGpu.test.mjs` already pins it.
import { gpuClassificationTypeForScene } from './urbanismeGpu.js';

/**
 * Autorisations d'urbanisme — what is about to be built on this block.
 *
 * The other French registers here describe what stands: the cadastre draws the
 * ground, BD TOPO the roofs, DPE their energy, DVF what they last sold for.
 * This one draws what does NOT stand yet — the permits granted, the cranes
 * open, and, in the three métropoles that publish it, the files still being
 * instructed at the counter this week.
 *
 * WHY COLOUR IS THE STATE AND NOT THE SIZE OF THE PROJECT. A permit's size is
 * already legible from the card, and most dossiers on any given block are a
 * new window or a fence. What a reader cannot get anywhere else is WHERE IN
 * THE PIPELINE each one sits — an application under instruction is a thing
 * that can still be objected to, an open chantier is a thing already making
 * noise, and a completed one is history. Those are different facts about the
 * same street and they get the colour channel.
 *
 * WHY SOME DOTS ARE PALE. `instruction` only ever comes from a métropole
 * portal — the national register contains granted permits only, by
 * construction (`adsFeed.js` quotes the SDES dictionary saying so). So outside
 * Paris, Bordeaux and Nantes there are no pale dots, and that is a property of
 * French open data rather than of the block being looked at. The layer says so
 * in its summary rather than letting the absence read as calm.
 *
 * ── The volumes, and the sentence a permit is allowed to say about them ─────
 *
 * `buildingTheme.js` lets one layer at a time repaint the BD TOPO volumes.
 * This one registers at `precedence` 30 and hands over the same colour it has
 * always used — the state of the dossier — so the ramp on the roofs and the
 * ramp on the cranes are the same ramp. Nothing about the colour choice moves.
 *
 * WHAT MOVES IS THE CLAIM, and it is not the same claim as the marker's. A
 * marker says "a dossier exists at this coordinate". Painting a VOLUME says
 * "this dossier is about THIS building" — and for a new build on bare ground
 * that sentence is false twice over: the permit is about a thing that does not
 * exist yet, and there is no volume under it to paint. So the theme is offered
 * only the dossiers that can be about something standing:
 *
 * • **declared works on an existing building** — `adsFeed.js` writes the SDES
 *   vocabulary verbatim into `purpose` (`NATURE_PROJET_DECLAREE`: `1 =
 *   nouvelle construction`, `2 = travaux sur construction existante`), so the
 *   distinction is READ, not guessed;
 * • **a permis de démolir** (`PD`), which by definition names something that
 *   stands;
 * • **a dossier whose nature is not published**, painted, and counted apart.
 *
 * Withheld, counted, and left as a crane only: a declared `nouvelle
 * construction`, and a **permis d'aménager** (`PA`), which authorises the
 * development of LAND and never a building.
 *
 * MEASURED, AND THE REASON THE THIRD BUCKET IS PAINTED AT ALL: this layer
 * merges SEVEN sources — the four `SITADEL_FILES` and the three
 * `LOCAL_ADS_PORTALS` — and exactly TWO of them ask for a nature column.
 * `NATURE_PROJET_DECLAREE` is in the `columns` of `logements` and `locaux` and
 * in neither `amenager` nor `demolir` (both of which the FAMILY rule above
 * settles anyway). The three métropole portals ask for none: `normaliseLocalRow`
 * fills `purpose` from the free-text `objet`/`details_du_projet`, and no portal
 * config declares a nature column. Refusing to
 * paint an unpublished nature would therefore switch the theme off entirely in
 * Paris, Bordeaux and Nantes — which are the only three places in France where
 * `instruction` exists at all. The trade taken is the other one: a point that
 * falls INSIDE a surveyed footprint is already evidence that something stands
 * there, the volume is painted, and the count of dossiers painted on that
 * evidence rather than on a declaration is published beside the count painted
 * on a declaration.
 *
 * WHY THE MARKER DOES NOT SHRINK UNDER A THEME. It was the obvious move and it
 * is an A3 violation: marker SIZE is already spoken for — 20 px for a file
 * still open or a chantier running, 17 px granted, 14 px history — and adding
 * "the volume under me is painted" to that channel would put two informations
 * on one variable. The marker is also the click surface and the card, and it
 * has to read the same when Bâti 3D is off. It is left alone.
 *
 * WHY THE UNPAINTED CITY IS NOT AN ADMISSION OF EMPTINESS. This layer scans a
 * DISC of {@link ADS_DEFAULT_RADIUS_M} m (0.50 km²) around the point the camera
 * is looking at. BD TOPO loads a BOX of up to `BDTOPO_MAX_BOX_DEG` = 0.08°,
 * which at 47°N is 8.90 × 6.04 km = 53.8 km² — 107 times the disc. So at most
 * about 1% of the volumes on screen were ever inside the question that was
 * asked, and the other 99% are washed because nobody looked, not because
 * nothing was filed. That is what the theme's "no data" row says, in those
 * words, rather than leaving a grey city to be read as a calm one (A4).
 *
 * WHERE THE `n peints / N connus` LEDGER LIVES. This layer publishes the OFFER
 * side — how many dossiers were handed over, how many were withheld and why,
 * how many carry no usable state — because those are the numbers only it can
 * know. The PAINT side (`themePainted` / `themeUnpainted` / points that landed
 * on no footprint) is published by the Bâti 3D row, which owns the join and
 * runs it against the volumes actually loaded. Running a second join here to
 * repeat those figures would produce two numbers, computed at two instants,
 * for one fact; one number in one place is the honest arrangement.
 *
 * @module data/adsUrbanisme
 */

/** Refresh cadence. Sitadel moves monthly; this is about camera movement. */
const UPDATE_INTERVAL_MS = 600_000;

/**
 * How far back a scan looks, as the three rungs a reader can choose between.
 *
 * THREE, AND THESE THREE, because each answers a different question and the
 * middle one exists for a measured reason rather than for symmetry:
 *
 * - **3 ans** is the default and it stays the default. A block's current
 *   pipeline — what is being instructed, what is granted, what has a crane on
 *   it — is a three-year story, and it is the window under which
 *   `ADS_MAX_PERMITS` does not bite in a dense arrondissement.
 * - **6 ans** is the shortest rung that reaches a FINISHED house. Ustaritz's
 *   `06454721B0009` was authorised 2021-07-20 and read 2026-09; at 36 months
 *   the floor is 2023-09-01 and the permit that built the house is invisible,
 *   at 72 it is not. A permit's chantier outlives the window that shows it.
 * - **13 ans** is the whole of Sitadel — `ADS_MAX_MONTHS`, the register's own
 *   2013 start — for reading a plot's entire paperwork history.
 *
 * NOT a free number, and `addressScanLayer.js` says why: everything reachable
 * here is reachable from a share link too.
 */
export const ADS_WINDOWS = Object.freeze([
  Object.freeze({ months: '36', label: '3 ANS' }),
  Object.freeze({ months: '72', label: '6 ANS' }),
  Object.freeze({ months: String(ADS_MAX_MONTHS), label: '13 ANS' }),
]);

/** The rung a reader who has chosen nothing is on. Unchanged from before. */
export const ADS_WINDOW_DEFAULT = String(ADS_DEFAULT_MONTHS);

/**
 * The three chips on the layer's row, and what each one warns about.
 *
 * THE ACTIVE CHIP CARRIES THE TRUNCATION, because widening the window is the
 * thing that causes it. `ADS_MAX_PERMITS` serves the 400 nearest dossiers, so
 * on a dense block a longer window does not add history — it TRADES the far
 * edge of the circle for it, and the swap is invisible on screen. The scan
 * already reports `found` against `count`; this is where a reader can see it
 * at the moment they are choosing.
 *
 * @param {?string} months The window in force.
 * @param {?object} summary The layer's own `summarize()` output, if any.
 * @returns {Array<object>} Chip descriptors for the manager's row renderer.
 */
export function adsWindowChips(months, summary = null) {
  const current = String(months ?? ADS_WINDOW_DEFAULT);
  return ADS_WINDOWS.map((window) => {
    const active = window.months === current;
    const years = Math.round(Number(window.months) / 12);
    let title = `Autorisations des ${years} dernières années`;
    if (active && summary?.truncated) {
      title += ` — ${summary.permitsFound} dossiers servis sur `
        + `${summary.permitsInRadius} dans le rayon, les plus proches d’abord`;
    } else if (active && Number.isFinite(summary?.permitsFound)) {
      title += ` — ${summary.permitsFound} dossiers sur ce bloc`;
    } else if (window.months === ADS_WINDOW_DEFAULT) {
      title += ' — le pipeline en cours';
    } else {
      title += ', chantiers achevés compris';
    }
    return {
      id: `months:${window.months}`,
      label: window.label,
      active,
      state: active ? 'active' : 'idle',
      title,
      params: { months: window.months },
    };
  });
}

/**
 * Marker size, in CSS px.
 *
 * The two states a reader is scanning for — a file still open at the counter,
 * and a chantier already running — get the pixels. A finished job is drawn
 * smaller because it is context, not news.
 */
const SIZE_LIVE_PX = 20;
const SIZE_GRANTED_PX = 17;
const SIZE_HISTORY_PX = 14;

/**
 * The pipeline, as colour.
 *
 * Cyan for what is still being decided, amber for granted-and-waiting, hot
 * orange for a chantier open right now, green for finished, grey for the two
 * ways a dossier dies. Deliberately NOT a single ramp: refused and annulled
 * are not "further along" than instruction, they are off the ladder, and a
 * ramp would rank them as though they were.
 */
const STATE_STYLE = Object.freeze({
  instruction: { color: '#3dd6c4', size: SIZE_LIVE_PX },
  depose: { color: '#3dd6c4', size: SIZE_LIVE_PX },
  accorde: { color: '#ffb03d', size: SIZE_GRANTED_PX },
  autorise: { color: '#ffb03d', size: SIZE_GRANTED_PX },
  commence: { color: '#ff6b4a', size: SIZE_LIVE_PX },
  termine: { color: '#7ed957', size: SIZE_HISTORY_PX },
  refuse: { color: '#8c93a3', size: SIZE_HISTORY_PX },
  annule: { color: '#8c93a3', size: SIZE_HISTORY_PX },
});

/**
 * How much ink one emprise puts on the ground.
 *
 * Lighter than the cadastre's 0.28, and deliberately: the cadastre draws
 * parcels because the parcels ARE the subject, while here the plot is the
 * ground under the news and the crane on top of it is the news. A wash this
 * pale still separates "somebody has filed on this plot" from the block around
 * it at street zoom, without competing with the marker it belongs to.
 */
const EMPRISE_FILL_ALPHA = 0.18;

/** The boundary, which is the part that survives being small. */
const EMPRISE_OUTLINE_ALPHA = 0.85;
const EMPRISE_OUTLINE_WIDTH_PX = 1.4;

/**
 * Which dossier's colour a shared plot wears.
 *
 * A plot is not in a state; the FILES on it are, and 76 of the 252 plots a
 * default Bordeaux scan draws carry more than one — 41 carry two, and one
 * carries nine. So one of them has to speak for the ground, and this is the
 * order it is chosen in.
 *
 * It is NOT the pipeline order, and it must not be read as one — `STATE_STYLE`
 * above says why a ramp would be a lie. This ranks by what a reader standing
 * on the pavement would want told first: a chantier open right now is the
 * loudest fact about a plot, then a file that can still be objected to, then
 * one granted and waiting, and only then the two kinds of history. A refusal
 * ranks last not because it matters least but because it is the one state that
 * says nothing will happen here.
 */
const EMPRISE_STATE_RANK = Object.freeze({
  commence: 6,
  instruction: 5,
  depose: 4,
  accorde: 3,
  autorise: 3,
  termine: 2,
  refuse: 1,
  annule: 1,
});

/** A dossier whose state neither register published. Drawn, never guessed at. */
const STATE_UNKNOWN = Object.freeze({ color: '#9fb0c6', size: SIZE_GRANTED_PX });

/**
 * Style for one dossier's published state.
 *
 * @param {?string} state Normalised state from `adsFeed.js`.
 * @returns {{color: string, size: number}}
 */
export function adsStateStyle(state) {
  return STATE_STYLE[String(state ?? '')] ?? STATE_UNKNOWN;
}

/** `2026-08-31` → `31/08/2026`, the way a French reader expects to read it. */
function frenchDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

/**
 * The date line: which date matters depends on where the dossier is.
 *
 * A file under instruction is about when it was DEPOSITED — that is what the
 * two-month objection window runs from. A granted one is about when it was
 * decided. An open chantier is about when the ground was broken. Printing all
 * four dates on every card would bury the one that is the news.
 *
 * @param {object} permit Normalised permit.
 * @returns {?string}
 */
export function adsDateLine(permit) {
  if (permit.completedOn) return `achevé le ${frenchDate(permit.completedOn)}`;
  if (permit.startedOn) return `chantier ouvert le ${frenchDate(permit.startedOn)}`;
  if (permit.state === 'instruction' || permit.state === 'depose') {
    return permit.depositedOn ? `déposé le ${frenchDate(permit.depositedOn)}` : null;
  }
  if (permit.decidedOn) return `décidé le ${frenchDate(permit.decidedOn)}`;
  return permit.depositedOn ? `déposé le ${frenchDate(permit.depositedOn)}` : null;
}

/**
 * How well this dot knows where it is.
 *
 * Said out loud on every dot that was not published with a coordinate, because
 * a permit geocoded to the middle of a street looks exactly as certain as one
 * placed on its own doorway, and the difference can be a whole building.
 *
 * @param {object} permit Normalised permit.
 * @returns {?string}
 */
export function adsPrecisionLine(permit) {
  if (permit.precision === 'published') return null;
  if (permit.precision === 'housenumber') return null;
  // The dossier named this parcel and the cadastre still has it. The shape
  // under the marker is the claim, and it needs no caveat.
  if (permit.precision === 'parcelle') return null;
  // AN INFERENCE, AND IT SAYS WHICH ONE. The parcel the dossier named has been
  // divided since, and this lot was picked out of the division — by the BAL's
  // own numbering, by being the only one that has been built on since, or by
  // being the only one there is. Which of the three is the difference between
  // a record and a deduction, so the basis is printed rather than averaged
  // into a single confident sentence.
  if (permit.precision === 'enfant') {
    const basis = permit.lineage?.basisLabel;
    return basis ? `lot déduit — ${basis}` : 'lot déduit après division de la parcelle';
  }
  // No lot could be told from its siblings: two thirds of divisions, measured.
  // The parent is drawn instead, which is a true statement about the ground.
  if (permit.precision === 'mere') {
    const siblings = permit.lineage?.siblings;
    return siblings > 1
      ? `emprise avant division — ${siblings} lots depuis, non départagés`
      : 'emprise avant division — le lot exact n’est pas déterminé';
  }
  if (permit.precision === 'street') return 'position approchée — géocodée à la rue';
  if (permit.precision === 'locality') return 'position approchée — géocodée au lieu-dit';
  return null;
}

/**
 * The state a shared plot is drawn in, and the dossier that lends it.
 *
 * @param {Array<object>} permits The dossiers standing on one emprise.
 * @returns {{color: string, size: number, state: ?string}}
 */
export function empriseStyle(permits) {
  let bestRank = -1;
  let bestState = null;
  for (const permit of permits || []) {
    const rank = EMPRISE_STATE_RANK[String(permit.state ?? '')] ?? 0;
    // Strictly greater, so a tie keeps the first — which is the nearest, since
    // `projectAdsPermits` served them sorted by distance. A plot must not
    // change colour because two dossiers on it were re-ordered.
    if (rank > bestRank) { bestRank = rank; bestState = permit.state ?? null; }
  }
  return { ...adsStateStyle(bestState), state: bestState };
}

/** `['063KE78', '063KE79']` → `parcelles 063KE78, 063KE79`. */
function parcelTitle(parcels) {
  const list = (parcels || []).filter(Boolean);
  if (!list.length) return 'Emprise du dossier';
  const shown = list.slice(0, 3).join(', ');
  const rest = list.length - 3;
  return `${list.length > 1 ? 'Parcelles' : 'Parcelle'} ${shown}${rest > 0 ? ` +${rest}` : ''}`;
}

/**
 * The card a plot opens, which is about the LAND and not about one file.
 *
 * The crane on top already says everything about its own dossier. What only
 * the plot can say is how much ground is involved and how many files are
 * stacked on it — the second being invisible on a map where nine markers sit
 * on one coordinate.
 *
 * @param {object} emprise One entry of `payload.emprises`.
 * @param {Array<object>} permits The dossiers on it.
 * @returns {{name: string, description: string}}
 */
export function empriseCard(emprise, permits) {
  const kinds = new Map();
  for (const permit of permits) {
    kinds.set(permit.kindLabel, (kinds.get(permit.kindLabel) ?? 0) + 1);
  }
  const tally = [...kinds].map(([label, n]) => (n > 1 ? `${n} × ${label}` : label)).join(', ');
  const latest = permits
    .map((permit) => permit.depositedOn)
    .filter(Boolean)
    .sort()
    .pop();
  return {
    name: parcelTitle(emprise.parcels),
    description: [
      permits.length > 1 ? `${permits.length} dossiers sur cette emprise` : null,
      // Measured off the outline drawn, not copied from the row — see
      // `liftEmprises`, and the parcel where the two differ by 120×.
      Number.isFinite(emprise.areaM2) && emprise.areaM2 > 0
        ? `${emprise.areaM2.toLocaleString('fr-FR')} m² au sol`
        : null,
      tally || null,
      latest ? `dernier dépôt le ${frenchDate(latest)}` : null,
      // Said out loud because it is the exception: this outline exists because
      // ONE portal in France publishes it, and every other dot in this layer
      // is a point because its register has nothing else to give.
      'emprise publiée par Bordeaux Métropole',
    ].filter(Boolean).join(' · '),
  };
}

/**
 * Positions for one ring, closed. Same helper the other two polygon layers
 * keep; three points is the least that encloses anything.
 *
 * @param {Array<number[]>} ring
 * @returns {?Array<object>}
 */
function ringPositions(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  return Cesium.Cartesian3.fromDegreesArray(ring.flat());
}

/**
 * Draw the plots, once each, under the cranes.
 *
 * The fill and the outline are separate entities because a ground-clamped
 * `polygon` cannot draw its own stroke in Cesium — `outline: true` is silently
 * ignored once the polygon is classified onto terrain. Both carry the same
 * name and description, so the edge of a plot opens the same card as its
 * middle rather than a card titled with an entity id.
 *
 * @param {object} dataSource
 * @param {object} payload Server payload.
 * @param {number} classificationType Cesium surface to clamp onto.
 * @returns {number} Emprises drawn.
 */
export function drawAdsEmprises(dataSource, payload, classificationType) {
  const emprises = payload.emprises || [];
  if (!emprises.length) return 0;
  const byEmprise = new Map();
  for (const permit of payload.permits || []) {
    if (!Number.isFinite(permit.empriseId)) continue;
    const list = byEmprise.get(permit.empriseId);
    if (list) list.push(permit); else byEmprise.set(permit.empriseId, [permit]);
  }
  let drawn = 0;
  for (const emprise of emprises) {
    const permits = byEmprise.get(emprise.id) || [];
    // An emprise whose every dossier fell outside the served cut is ground
    // with nothing standing on it. Not drawn: a wash with no crane reads as a
    // permit the card cannot open.
    if (!permits.length) continue;
    const style = empriseStyle(permits);
    const card = empriseCard(emprise, permits);
    const fill = Cesium.Color.fromCssColorString(style.color).withAlpha(EMPRISE_FILL_ALPHA);
    const stroke = Cesium.Color.fromCssColorString(style.color).withAlpha(EMPRISE_OUTLINE_ALPHA);
    // The card hangs on a point strictly inside the widest part, computed
    // server-side. A polygon entity has no position of its own, and
    // `cardFromEntity` needs one; giving it this one also means the card is
    // seated on terrain by the same pass that seats the markers.
    const anchor = emprise.anchor
      ? Cesium.Cartesian3.fromDegrees(emprise.anchor.lon, emprise.anchor.lat)
      : null;
    // The anchor goes to the first part actually DRAWN, not to part zero: a
    // part whose outer ring did not survive is skipped, and hanging the card
    // on it would leave the plot on screen with nothing to click.
    let anchored = false;
    for (const [index, rings] of emprise.parts.entries()) {
      const outer = ringPositions(rings[0]);
      if (!outer) continue;
      const holes = [];
      for (let h = 1; h < rings.length; h += 1) {
        const hole = ringPositions(rings[h]);
        // A courtyard is not part of the plot's ground. Filled in, the area on
        // the card stops describing the shape beside it.
        if (hole) holes.push(new Cesium.PolygonHierarchy(hole));
      }
      dataSource.entities.add({
        id: `ads-emprise:${emprise.id}:${index}`,
        // One card per plot, not one per fragment of it.
        position: anchored ? undefined : anchor,
        name: card.name,
        description: card.description,
        properties: {
          kind: 'ads-emprise',
          state: style.state,
          dossiers: permits.map((permit) => permit.dossier).filter(Boolean),
        },
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(outer, holes),
          material: fill,
          classificationType,
          outline: false,
        },
      });
      anchored = true;
      for (const [ringIndex, ring] of rings.entries()) {
        const positions = ringPositions(ring);
        if (!positions) continue;
        dataSource.entities.add({
          id: `ads-emprise:${emprise.id}:${index}:${ringIndex}`,
          name: card.name,
          description: card.description,
          polyline: {
            positions: [...positions, positions[0]],
            width: EMPRISE_OUTLINE_WIDTH_PX,
            material: new Cesium.ColorMaterialProperty(stroke),
            clampToGround: true,
            classificationType,
          },
        });
      }
    }
    drawn += 1;
  }
  return drawn;
}

/* ── The building theme ──────────────────────────────────────────────────── */

/** Registry key. Same string as the layer id, so the two are never out of step. */
export const ADS_BUILDING_THEME_ID = 'ads-fr';

/** Shown to the reader wherever the paint has to name its owner (D1). */
export const ADS_BUILDING_THEME_LABEL = 'Autorisations d’urbanisme';

/**
 * Lower wins. 30 puts this ahead of a €/m² or DPE theme on the same volumes:
 * what is ABOUT TO HAPPEN to a building outranks what it is worth or how it is
 * heated, because it is the only one of the three that can still change.
 */
export const ADS_BUILDING_THEME_PRECEDENCE = 30;

/**
 * The label on the "no data" row, and the whole reason it is not just
 * "sans dossier".
 *
 * The scan is a 400 m disc; the volumes are a box up to 53.8 km². A volume can
 * be unpainted because no dossier was filed on it, or because it sits outside
 * the circle this layer asked about — and those are different sentences (A4).
 * The row says both, in that order, because the second is the likelier one.
 */
export const ADS_BUILDING_THEME_UNKNOWN_LABEL = `hors du rayon de ${ADS_DEFAULT_RADIUS_M} m, ou sans dossier`;

/** What a permit can be about. */
export const ADS_TARGET_EXISTING = 'existing';
export const ADS_TARGET_NEW = 'new';
export const ADS_TARGET_UNKNOWN = 'unknown';

/**
 * `NATURE_PROJET_DECLAREE`, as `adsFeed.js` spells it into `purpose`.
 *
 * Read rather than re-derived: the feed owns the dictionary and this file owns
 * the drawing, so the two share a vocabulary and not a copy of the mapping.
 * `adsUrbanisme.test.mjs` pins both strings against `normaliseSitadelRow`, so a
 * wording change upstream fails a test here instead of silently reclassifying
 * every permit in France as "nature not published".
 */
const NATURE_EXISTING_TEXT = 'travaux sur construction existante';
const NATURE_NEW_TEXT = 'nouvelle construction';

/**
 * Is this dossier about a building that stands, or about ground that does not
 * carry one yet?
 *
 * Three answers and never a guess dressed as two. The declared nature wins when
 * there is one; failing that, the FAMILY of the authorisation settles the two
 * cases where the law already answers — a permis de démolir names something
 * standing, a permis d'aménager authorises the development of land and never a
 * building. Everything else is `unknown`, which is most of the three métropole
 * portals, and `unknown` is a value this module carries around rather than
 * rounding to one of its neighbours.
 *
 * @param {object} permit Normalised permit.
 * @returns {'existing'|'new'|'unknown'}
 */
export function adsPermitTarget(permit) {
  const purpose = String(permit?.purpose ?? '').toLowerCase();
  if (purpose.includes(NATURE_EXISTING_TEXT)) return ADS_TARGET_EXISTING;
  if (purpose.includes(NATURE_NEW_TEXT)) return ADS_TARGET_NEW;
  const kind = String(permit?.kind ?? '');
  if (kind === 'PD') return ADS_TARGET_EXISTING;
  if (kind === 'PA') return ADS_TARGET_NEW;
  return ADS_TARGET_UNKNOWN;
}

/**
 * The colour a volume takes for one dossier state — or null, meaning leave it
 * in the "no data" wash.
 *
 * NULL FOR AN UNPUBLISHED STATE, and that is a departure from the marker on
 * purpose. A crane whose state neither register published is drawn in
 * `STATE_UNKNOWN` grey-blue `#9fb0c6`, because a marker has to exist for every
 * dossier. A VOLUME is a value channel, and `#9fb0c6` measures ΔE76 11.2 from
 * the `#8c93a3` of "refusé ou annulé" — on a scale where 10 is where two
 * colours stop sharing a name. Two greys that close, on a surface the size of a
 * roof, would put "nobody published a decision" and "the decision was no" in the
 * same class. So the volume is not painted, the dossier keeps its crane, and the
 * row counts it.
 *
 * @param {?string} state Normalised state from `adsFeed.js`.
 * @returns {?string} CSS colour, or null.
 */
export function adsBuildingThemeColorFor(state) {
  const style = STATE_STYLE[String(state ?? '')];
  return style ? style.color : null;
}

/**
 * N dossiers on one volume → the one state the volume wears.
 *
 * The SAME rule the plot wash already uses, called through the same function:
 * a volume carrying several dossiers is exactly the shared-plot problem
 * `empriseStyle` was written for, and answering it twice with two rankings
 * would let a roof and the ground under it disagree about their own street.
 *
 * @param {Array<object>} permits Dossiers joined to one volume, nearest first.
 * @returns {?string} state
 */
export function adsBuildingThemeReduce(permits) {
  return empriseStyle(permits).state;
}

/**
 * The ramp, one row per COLOUR and not one per state.
 *
 * `instruction`/`depose` share a colour and so do `accorde`/`autorise`, and the
 * panel counts a legend row by matching its swatch against the colours actually
 * painted. Two rows with one colour would each claim the whole count.
 * Deliberately without counts: `resolveBuildingThemePaint` fills them in from
 * the volumes it really painted, which is the number a reader of the Bâti 3D
 * row needs — not the number of dossiers this layer holds.
 */
export const ADS_BUILDING_THEME_LEGEND = Object.freeze([
  Object.freeze({
    label: 'Déposé ou en instruction',
    color: '#3dd6c4',
    blurb: 'Le dossier est encore au guichet et peut encore faire l’objet d’un recours. '
      + 'Publié seulement par Paris, Bordeaux et Nantes : ailleurs cette classe est vide '
      + 'parce que le registre national ne contient que des permis déjà accordés.',
  }),
  Object.freeze({
    label: 'Accordé, chantier non ouvert',
    color: '#ffb03d',
    blurb: 'Autorisé, et aucune ouverture de chantier n’est remontée. Le bâtiment peint '
      + 'est celui qui existe aujourd’hui, pas celui que le permis décrit.',
  }),
  Object.freeze({
    label: 'Chantier ouvert',
    color: '#ff6b4a',
    blurb: 'Les travaux ont commencé sur ce volume.',
  }),
  Object.freeze({
    label: 'Travaux achevés',
    color: '#7ed957',
    blurb: 'Achèvement déclaré. Le volume BD TOPO peut être antérieur aux travaux : '
      + 'la peinture dit qu’un dossier s’est terminé ici, pas que le levé l’a vu.',
  }),
  Object.freeze({
    label: 'Refusé ou annulé',
    color: '#8c93a3',
    blurb: 'Le dossier a existé, le projet non. Peint parce que « rien ne changera ici » '
      + 'est une information sur le bâtiment ; la classe garde sa propre teinte et n’est '
      + 'pas fondue dans les volumes sans dossier.',
  }),
]);

/**
 * Split a served payload into what the theme may paint and what it may not.
 *
 * Every dossier leaves this function in exactly one bucket, and the buckets sum
 * to `total` — that is the A5 ledger, and the test asserts the sum rather than
 * the individual numbers, because a bucket that quietly swallows a dossier is
 * precisely the failure this is here to prevent.
 *
 * Order of refusal matters and is stated: a new build is withheld BEFORE the
 * coordinate and the state are looked at, because "this permit is not about a
 * building that stands" is a fact about the dossier and stays true whatever
 * else is missing from it.
 *
 * @param {?object} payload Served ADS payload.
 * @returns {{points: Array<object>, total: number, offered: number,
 *   offeredDeclared: number, offeredInferred: number, newBuild: number,
 *   land: number, unpublishedState: number, unplaced: number}}
 */
export function adsBuildingThemePoints(payload) {
  const ledger = {
    points: [],
    total: 0,
    offered: 0,
    offeredDeclared: 0,
    offeredInferred: 0,
    newBuild: 0,
    land: 0,
    unpublishedState: 0,
    unplaced: 0,
  };
  for (const permit of payload?.permits || []) {
    ledger.total += 1;
    const target = adsPermitTarget(permit);
    if (target === ADS_TARGET_NEW) {
      if (String(permit?.kind ?? '') === 'PA') ledger.land += 1;
      else ledger.newBuild += 1;
      continue;
    }
    // Zero by construction in a served payload — `projectAdsPermits` drops a
    // row with no coordinate before it applies the radius, and the rows the BAN
    // could not place arrive separately as `unplacedInCommune`. Kept because
    // the guard is one comparison and a payload shape is not a promise.
    if (!Number.isFinite(permit?.lon) || !Number.isFinite(permit?.lat)) {
      ledger.unplaced += 1;
      continue;
    }
    if (!adsBuildingThemeColorFor(permit?.state)) {
      ledger.unpublishedState += 1;
      continue;
    }
    ledger.points.push(permit);
    ledger.offered += 1;
    if (target === ADS_TARGET_EXISTING) ledger.offeredDeclared += 1;
    else ledger.offeredInferred += 1;
  }
  return ledger;
}

/** The ledger of the last payload handed to the registry, or null. */
let _themeLedger = null;

/**
 * Publish (or re-publish) the theme from the payload that was just drawn.
 *
 * Re-registering the same id is the data-changed signal: the registry keeps the
 * theme's original sequence number and fires its `update` notification, which is
 * the subscription `bdtopoBuildings.js` installs in `init()`. Calling
 * `applyBuildingTheme()` on top of that would run the join twice for one change.
 *
 * @param {?object} payload
 * @returns {object} the ledger.
 */
export function syncAdsBuildingTheme(payload) {
  const ledger = adsBuildingThemePoints(payload);
  _themeLedger = ledger;
  registerBuildingTheme({
    id: ADS_BUILDING_THEME_ID,
    label: ADS_BUILDING_THEME_LABEL,
    precedence: ADS_BUILDING_THEME_PRECEDENCE,
    points: ledger.points,
    reduce: adsBuildingThemeReduce,
    colorFor: adsBuildingThemeColorFor,
    legend: ADS_BUILDING_THEME_LEGEND,
    unknownLabel: ADS_BUILDING_THEME_UNKNOWN_LABEL,
  });
  return ledger;
}

/** Withdraw the theme — the layer is going off. */
export function clearAdsBuildingTheme() {
  _themeLedger = null;
  return clearBuildingTheme(ADS_BUILDING_THEME_ID);
}

/** The ledger, for the row line and the tests. */
export function adsBuildingThemeLedger() {
  return _themeLedger;
}

/** French thousands, matching the rest of the French packs. */
function fr(value) {
  return Number(value).toLocaleString('fr-FR');
}

/**
 * The one sentence the toggle row adds when the theme is on.
 *
 * The OFFER side of the ledger, in the order a reader needs it: how many
 * dossiers were handed to the volumes, then every reason a dossier was not.
 * The paint side is on the Bâti 3D row — said out loud, because a number that
 * lives on another row is worse than no number when nobody knows where it is.
 *
 * @param {?object} ledger
 * @returns {?string}
 */
export function adsBuildingThemeLine(ledger = _themeLedger) {
  if (!ledger || !ledger.total) return null;
  const held = [];
  if (ledger.newBuild) held.push(`${fr(ledger.newBuild)} en construction neuve`);
  if (ledger.land) held.push(`${fr(ledger.land)} permis d’aménager`);
  if (ledger.unpublishedState) held.push(`${fr(ledger.unpublishedState)} sans état publié`);
  if (ledger.unplaced) held.push(`${fr(ledger.unplaced)} sans coordonnée`);
  const head = `${fr(ledger.offered)} des ${fr(ledger.total)} dossiers peignent le bâti 3D`
    + (ledger.offeredInferred
      ? ` (dont ${fr(ledger.offeredInferred)} sur nature non publiée)`
      : '');
  const tail = held.length ? ` · retenus : ${held.join(', ')}` : '';
  return `${head}${tail} · compte des volumes peints sur la ligne Bâti 3D`;
}

/**
 * The layer's own colour key.
 *
 * Six rows, because the marker palette has six colours and the marker is what
 * this row is about — the volumes have their key on the Bâti 3D row, which is
 * where the paint is. The sixth row, "état non publié", is the one that has to
 * be here: it is a colour on screen that the theme deliberately does NOT paint,
 * and a reader has to be able to look it up.
 *
 * @param {?object} payload
 * @returns {{chips: Array<object>, legend: Array<object>}}
 */
export function adsRowControls(payload) {
  const counts = new Map();
  for (const permit of payload?.permits || []) {
    const color = adsStateStyle(permit?.state).color;
    counts.set(color, (counts.get(color) || 0) + 1);
  }
  const legend = ADS_BUILDING_THEME_LEGEND.map((entry) => ({
    label: entry.label,
    color: entry.color,
    count: counts.get(entry.color) || 0,
    blurb: entry.blurb,
  }));
  legend.push({
    label: 'État non publié',
    color: STATE_UNKNOWN.color,
    count: counts.get(STATE_UNKNOWN.color) || 0,
    blurb: 'Ni Sitadel ni le portail n’a publié d’état pour ce dossier. Le marqueur est '
      + 'dessiné, le volume ne l’est pas : ce gris est à ΔE 11 du gris de « refusé ou '
      + 'annulé » et une toiture peinte ne pourrait pas les distinguer.',
  });
  // The plot wash IS a ground-classified area fill, so on the photoreal stack it
  // climbs the façades and the manager's drape notice applies — but only where a
  // portal published a plot at all, which today is Bordeaux alone. Claimed only
  // when there is a wash to claim it for. The theme these colours also paint is
  // NOT a drape: extruded volumes are real geometry that the mesh occludes
  // instead of receiving (`surfaceFillNotice.js`).
  return {
    chips: [],
    legend,
    surfaceFill: (payload?.emprises?.length || 0) > 0,
  };
}

const adsScanLayer = createAddressScanLayer({
  id: ADS_BUILDING_THEME_ID,
  name: 'Autorisations d’urbanisme',
  icon: '⌂',
  source: 'Sitadel — SDES + portails ADS',
  endpoint: '/api/ads-fr',
  updateInterval: UPDATE_INTERVAL_MS,
  runtimeParams: {
    months: { values: ADS_WINDOWS.map((window) => window.months), defaultValue: ADS_WINDOW_DEFAULT },
  },
  rowControls: (runtime, summary) => ({ chips: adsWindowChips(runtime.months, summary) }),
  params: (point, viewer, runtime) => ({
    radius: String(ADS_DEFAULT_RADIUS_M),
    months: runtime.months ?? ADS_WINDOW_DEFAULT,
  }),

  // The layer's own colour key. Four of the five scan layers draw badge markers
  // whose shape is their caption; this one spends COLOUR on the state of the
  // dossier, and it now spends the same colour on whole roofs, so D1 makes the
  // key compulsory rather than optional.
  rowControls: adsRowControls,

  render({ payload, dataSource, viewer }) {
    // The volumes first, because the registry notifies the BD TOPO layer
    // synchronously and a repaint costs nothing while this data source is still
    // empty. Re-registering with the new points IS the data-changed signal.
    syncAdsBuildingTheme(payload);
    // The ground next, the news on top of it. Emprises are counted separately
    // from the returned total: the number this callback reports is what the
    // manager shows as the layer's count, and that has always been dossiers.
    drawAdsEmprises(dataSource, payload, gpuClassificationTypeForScene(viewer?.scene));
    let drawn = 0;
    for (const permit of payload.permits || []) {
      if (!Number.isFinite(permit.lon) || !Number.isFinite(permit.lat)) continue;
      const style = adsStateStyle(permit.state);
      dataSource.entities.add({
        id: `ads:${permit.id}`,
        position: Cesium.Cartesian3.fromDegrees(permit.lon, permit.lat),
        billboard: {
          // A CRANE, not a disc. Turn this layer on with DVF and DPE and all
          // three drew coloured dots over the same roofs; colour is already
          // spent on the pipeline state here, so the shape carries the
          // register. See `addressMarkerIcons.js`.
          image: addressMarkerGlyph('crane'),
          width: style.size,
          height: style.size,
          // The glyph is white line-art; this tint IS the state channel.
          color: Cesium.Color.fromCssColorString(style.color),
          // POSITIVE_INFINITY, not a distance: these are annotations ON the
          // world, not objects in it, and a finite value lets the terrain eat
          // the bottom half of every glyph at city zoom.
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: {
          kind: 'ads-permit',
          state: permit.state,
          family: permit.kind,
          housing: permit.housing,
          sources: permit.sources,
        },
        name: permit.address || permit.commune || permit.dossier,
        description: [
          permit.kindLabel,
          permit.stateLabel,
          adsDateLine(permit),
          Number.isFinite(permit.housing) && permit.housing > 0
            ? `${permit.housing} logement${permit.housing > 1 ? 's' : ''}`
            : null,
          Number.isFinite(permit.surfaceCreatedM2) && permit.surfaceCreatedM2 > 0
            ? `${permit.surfaceCreatedM2.toLocaleString('fr-FR')} m² créés`
            : null,
          permit.purpose,
          permit.parcels?.length ? `parcelle ${permit.parcels.join(', ')}` : null,
          // Only Bordeaux publishes the ground, so the outline under this
          // marker is the exception rather than the rule. Saying it on the
          // dossier's own card is what stops it reading as a shape this layer
          // drew rather than one the portal published.
          Number.isFinite(permit.empriseId) ? 'emprise publiée, dessinée au sol' : null,
          permit.applicant,
          adsPrecisionLine(permit),
          `${permit.distanceM} m`,
          permit.dossier,
        ].filter(Boolean).join(' · '),
      });
      drawn += 1;
    }
    return drawn;
  },

  summarize(payload) {
    const summary = payload.summary || {};
    return {
      commune: payload.commune?.name ?? null,
      communeCode: payload.commune?.code ?? null,
      since: payload.since ?? null,
      permitsFound: summary.count ?? 0,
      // The gap between these two is the honesty of the radius.
      permitsInRadius: summary.found ?? 0,
      truncated: summary.truncated ?? false,
      // The one thing the national register cannot say — and therefore the one
      // number that tells a reader whether this commune has a live portal.
      underInstruction: summary.underInstruction ?? 0,
      housing: summary.housing ?? 0,
      byKind: summary.byKind ?? null,
      byState: summary.byState ?? null,
      // Dossiers the two registers agreed were the same file.
      merged: payload.merged ?? 0,
      // Rows collapsed because one operation is listed in both permis-de-
      // construire files. Commune-wide, like the geocoding shortfall below.
      folded: payload.folded ?? 0,
      // Certificats d'urbanisme in the circle, deliberately not drawn — an
      // information note is not permission to build. Only Bordeaux publishes
      // them, so this is 0 everywhere else. NULL is a third answer: Bordeaux
      // is now asked to leave them out of the rows it sends and to count them
      // instead, and a count that did not come back is not a count of zero.
      certificates: summary.certificates ?? 0,
      certificatesCounted: Number.isFinite(summary.certificates),
      // Plots outlined on the ground, and dossiers standing on one. The gap
      // between `permitsFound` and `withEmprise` is Sitadel, Paris and Nantes,
      // none of which publish a shape at all.
      emprises: summary.empriseCount ?? 0,
      withEmprise: summary.withEmprise ?? 0,
      // Rows the BAN could not place better than their commune, across the
      // WHOLE commune: an unplaced row has no position, so it cannot be
      // attributed to this circle or to any other.
      unplacedInCommune: payload.unplacedInCommune ?? 0,
      // How much of the commune's register stands on published ground rather
      // than on a geocoded address. `divided` is the rows whose parcel has been
      // split since they were filed — 37% of Ustaritz's — and `resolved` is how
      // many of those the dated cadastre could still account for. The gap
      // between the two is the archive floor of 2017 and the per-scan budget,
      // both of which are limits of the method and are reported as such.
      onParcel: payload.cadastre?.placed ?? 0,
      dividedInCommune: payload.cadastre?.divided ?? 0,
      lineageResolved: payload.cadastre?.resolved ?? 0,
      lineageOnChild: payload.cadastre?.onChild ?? 0,
      lineageOnParent: payload.cadastre?.onParent ?? 0,
      lineageTruncated: payload.cadastre?.truncated ?? false,
      portals: (payload.portals || []).filter((portal) => portal.ok).map((portal) => portal.key),
    };
  },
});

/**
 * The layer module.
 *
 * The scan shell is wrapped rather than returned directly, for the one thing it
 * has no hook for: a theme that must be published while the layer is on and
 * withdrawn the moment it is off. `render()` republishes the points on every
 * scan; these three methods own the on/off edge, and they are the reason no
 * other module has to know this layer exists.
 *
 * A DORMANT SCAN NEEDS NO FOURTH HOOK, and the arithmetic says why. The shell
 * stops scanning above 12 000 m and does not call `render()`, so the theme
 * keeps the points of the last block it saw. It cannot paint anything with
 * them: `bdtopo-buildings` refuses a viewport wider than 0.08°, which a 60° FOV
 * camera reaches at 8 900 / (2 · tan 30°) = 7 707 m — a kilometre and a half
 * BELOW the scan ceiling. There is no altitude at which this layer is asleep
 * and there are volumes on screen to mis-paint.
 */
const adsUrbanismeLayer = {
  ...adsScanLayer,

  enable(viewer) {
    adsScanLayer.enable(viewer);
    // Registered empty rather than not at all: the row's key, the "no data"
    // wash and the count of unpainted volumes have to appear the moment the
    // layer is switched on, not one scan later. The first `render()` replaces
    // the points and keeps the sequence number.
    syncAdsBuildingTheme(null);
  },

  disable() {
    // The paint goes first. Whatever the shell does or fails to do while
    // tearing down its own listeners, the city must not be left wearing the
    // colours of a layer that is off.
    clearAdsBuildingTheme();
    adsScanLayer.disable();
  },

  destroy(viewer) {
    clearAdsBuildingTheme();
    adsScanLayer.destroy(viewer);
  },

  getStats() {
    const stats = adsScanLayer.getStats();
    const ledger = _themeLedger;
    if (!ledger) return stats;
    const line = adsBuildingThemeLine(ledger);
    return {
      ...stats,
      theme: ADS_BUILDING_THEME_ID,
      themeLabel: ADS_BUILDING_THEME_LABEL,
      // The OFFER ledger. Every dossier of the served payload is in exactly one
      // of these, and they sum to `themeTotal` — see `adsBuildingThemePoints`.
      themeTotal: ledger.total,
      themeOffered: ledger.offered,
      themeOfferedDeclared: ledger.offeredDeclared,
      themeOfferedInferred: ledger.offeredInferred,
      themeHeldNewBuild: ledger.newBuild,
      themeHeldLand: ledger.land,
      themeHeldNoState: ledger.unpublishedState,
      themeHeldUnplaced: ledger.unplaced,
      // The disc the question was asked over, against which the unpainted city
      // has to be read (A4).
      themeScanRadiusM: ADS_DEFAULT_RADIUS_M,
      // Appended rather than assigned: whatever the shell is already saying
      // about the scan itself comes first, because "this scan is incomplete"
      // outranks "this theme is incomplete".
      ...(line
        ? { loadingLabel: stats.loadingLabel ? `${stats.loadingLabel} · ${line}` : line }
        : {}),
    };
  },
};

export default adsUrbanismeLayer;
