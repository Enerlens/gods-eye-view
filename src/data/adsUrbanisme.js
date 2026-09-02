import * as Cesium from 'cesium';
import { addressMarkerGlyph } from './addressMarkerIcons.js';
import { createAddressScanLayer } from './addressScanLayer.js';
import { ADS_DEFAULT_MONTHS, ADS_DEFAULT_RADIUS_M } from './adsFeed.js';
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
 * @module data/adsUrbanisme
 */

/** Refresh cadence. Sitadel moves monthly; this is about camera movement. */
const UPDATE_INTERVAL_MS = 600_000;

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

const adsUrbanismeLayer = createAddressScanLayer({
  id: 'ads-fr',
  name: 'Autorisations d’urbanisme',
  icon: '⌂',
  source: 'Sitadel — SDES + portails ADS',
  endpoint: '/api/ads-fr',
  updateInterval: UPDATE_INTERVAL_MS,
  params: () => ({
    radius: String(ADS_DEFAULT_RADIUS_M),
    months: String(ADS_DEFAULT_MONTHS),
  }),

  render({ payload, dataSource, viewer }) {
    // The ground first, the news on top of it. Emprises are counted separately
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
      portals: (payload.portals || []).filter((portal) => portal.ok).map((portal) => portal.key),
    };
  },
});

export default adsUrbanismeLayer;
