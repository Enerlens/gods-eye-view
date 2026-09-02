import * as Cesium from 'cesium';
import { addressMarkerGlyph } from './addressMarkerIcons.js';
import { createAddressScanLayer } from './addressScanLayer.js';
import { ADS_DEFAULT_MONTHS, ADS_DEFAULT_RADIUS_M } from './adsFeed.js';

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

  render({ payload, dataSource }) {
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
      // Certificats d'urbanisme found in the circle and deliberately not
      // drawn — an information note is not permission to build. Only Bordeaux
      // publishes them, so this is 0 everywhere else.
      certificates: summary.certificates ?? 0,
      // Rows the BAN could not place better than their commune, across the
      // WHOLE commune: an unplaced row has no position, so it cannot be
      // attributed to this circle or to any other.
      unplacedInCommune: payload.unplacedInCommune ?? 0,
      portals: (payload.portals || []).filter((portal) => portal.ok).map((portal) => portal.key),
    };
  },
});

export default adsUrbanismeLayer;
