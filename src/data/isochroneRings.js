import * as Cesium from 'cesium';
import { addressMarkerGlyph } from './addressMarkerIcons.js';
import { createAddressScanLayer } from './addressScanLayer.js';
import { ISOCHRONE_STEPS, equivalentRadiusM } from './isochroneFeed.js';

/**
 * Zone de chalandise — the ground you can actually reach, instead of a circle.
 *
 * WHY THIS LAYER EXISTS, AND WHY IT DID NOT UNTIL NOW. The `/api/isochrone`
 * proxy has been in this repository since 2026-09-01 and nothing has ever drawn
 * it: a service with no surface. The whole point of an isochrone is that it is
 * the one thing a circle cannot say — a circle at 800 m crosses railways,
 * rivers and motorways as if they were pavement, and the Géoplateforme runs
 * Valhalla over IGN's own BD TOPO network and answers the polygon actually
 * reachable. Measured over the Lyon Presqu'île on 2026-09-02: five minutes on
 * foot is 0.28 km², ten is 0.94, fifteen is 2.16.
 *
 * THE CYCLING RING IS MISSING ON PURPOSE, AND THE CHIP SAYS SO. The service
 * accepts `pedestrian` and `car` and rejects `bicycle` with HTTP 400. A third
 * chip is drawn anyway, disabled, carrying the reason — because the alternative
 * is a reader wondering why a cycling city has no cycling ring, and because
 * mapping `bike` onto `pedestrian` would draw a walking ring and label it
 * cycling. A missing answer stated is worth more than a plausible one invented.
 *
 * THE NUMBER THAT IS NOT ON ANY COMPETITOR'S MAP. In open ground a reachable
 * area grows with the SQUARE of time, so doubling the budget quadruples the
 * area. Every shortfall is the network — a river with one bridge, a railway, a
 * cul-de-sac. `ringExpansion()` reports the measured growth against that 4×,
 * per consecutive pair, and it needs no assumed walking speed and no model: it
 * is two measured areas divided by each other. A share of 84 % between 5 and
 * 10 minutes is a place fraying at its edges; a share above 100 % is a place
 * that opens up once you clear the first block.
 *
 * WHY THE FILLS STACK. The three rings are nested, drawn far to near, each at a
 * low alpha, so the centre is the sum of three and the outer band is one. That
 * gradient IS the reachability, and it is deliberate rather than an accident of
 * overlap. Each ring carries a DISTINCT colour, which also keeps Cesium from
 * batching two of them into one ground-classification primitive — a batch
 * colours its instances by bounding rectangle, and three concentric rings share
 * a rectangle almost exactly.
 *
 * @module data/isochroneRings
 */

/** Layer id — share-link registry key and voice-tool enum value. */
export const ISOCHRONE_LAYER_ID = 'isochrone-fr';
export const ISOCHRONE_LAYER_NAME = 'Zone de chalandise (isochrone)';

/**
 * Refresh cadence. A road network does not change in an afternoon; this exists
 * so a session left open overnight is not holding a ring cut from a BD TOPO
 * edition that has since been replaced.
 */
const UPDATE_INTERVAL_MS = 900_000;

/**
 * Above this the rings are smaller than a few pixels and the scan is noise.
 *
 * Lower than the shared address-scan ceiling of 12 km on purpose: a fifteen-
 * minute walk is about 2 km² — roughly 1.6 km across — and from 12 km up that
 * is a smudge. The layer says "descends" rather than drawing one.
 */
const MAX_ALTITUDE_M = 8_000;

/**
 * The three rings, near to far, with the colour each is drawn in.
 *
 * Bright teal at five minutes to deep indigo at fifteen: a single perceptual
 * ramp, so the nesting reads as one gradient rather than three unrelated
 * shapes. Alphas are low because they STACK — see the module header.
 */
export const ISOCHRONE_RING_STYLES = Object.freeze([
  Object.freeze({ seconds: 300, color: '#3ce0c8', fillAlpha: 0.22, widthPx: 3 }),
  Object.freeze({ seconds: 600, color: '#3b9ae0', fillAlpha: 0.16, widthPx: 3 }),
  Object.freeze({ seconds: 900, color: '#5560c8', fillAlpha: 0.12, widthPx: 3 }),
]);

const STYLE_BY_SECONDS = new Map(ISOCHRONE_RING_STYLES.map((style) => [style.seconds, style]));
const FALLBACK_STYLE = ISOCHRONE_RING_STYLES[ISOCHRONE_RING_STYLES.length - 1];

/**
 * The travel modes offered, and the one the service cannot answer.
 *
 * `bike` is `available: false` rather than absent. See the module header: the
 * refusal is the honest answer and it belongs on screen, not in a comment.
 */
export const ISOCHRONE_MODES = Object.freeze([
  Object.freeze({
    id: 'foot',
    label: 'PIÉTON',
    available: true,
    blurb: 'Marche, sur le réseau piéton et routier de la BD TOPO.',
  }),
  Object.freeze({
    id: 'car',
    label: 'VOITURE',
    available: true,
    blurb: 'Voiture, sur le réseau routier de la BD TOPO.',
  }),
  Object.freeze({
    id: 'bike',
    label: 'VÉLO',
    available: false,
    blurb: 'Indisponible : le service IGN refuse le profil vélo (HTTP 400). '
      + 'Dessiner un anneau piéton en l’appelant vélo serait une invention, pas une mesure.',
  }),
]);

/** The mode the layer opens on, and the one every share link without a token means. */
export const ISOCHRONE_DEFAULT_MODE = 'foot';

/** @type {string} The mode currently drawn. */
let _mode = ISOCHRONE_DEFAULT_MODE;

/**
 * Resolve a requested mode to one the service can answer.
 *
 * An unavailable mode is REFUSED, not silently downgraded: `setParams` returns
 * false and the drawn rings stay what they were. A share link carrying `bike`
 * — which no encoder can produce, but a hand-edited URL can — therefore shows
 * the walking rings it already had, rather than walking rings relabelled.
 *
 * @param {unknown} value
 * @returns {string|null} A supported mode id, or null.
 */
export function resolveMode(value) {
  const key = String(value ?? '').trim().toLowerCase();
  const mode = ISOCHRONE_MODES.find((entry) => entry.id === key);
  return mode?.available ? mode.id : null;
}

/** The style a duration is drawn in. */
export function ringStyle(seconds) {
  return STYLE_BY_SECONDS.get(seconds) || FALLBACK_STYLE;
}

/** Minutes, as a reader says them. */
export function minutesLabel(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

/** The verb that goes with the mode, for a card written in French. */
export function modeVerb(mode) {
  return mode === 'car' ? 'en voiture' : 'à pied';
}

/**
 * The vertex a ring's label is written on.
 *
 * The northernmost, so three nested labels never stack: the rings share a
 * centre and grow outward, so their north edges are always distinct points, and
 * picking the same compass direction on each keeps the three reading as one
 * scale rather than as three scattered tags.
 *
 * @param {Array<number[]>} ring `[lon, lat]` pairs.
 * @returns {number[]|null}
 */
export function ringLabelAnchor(ring) {
  if (!Array.isArray(ring) || !ring.length) return null;
  let best = null;
  for (const point of ring) {
    if (!Array.isArray(point) || point.length < 2) continue;
    if (!best || point[1] > best[1]) best = point;
  }
  return best;
}

/**
 * The expansion sentence for one ring, or null when there is nothing to say.
 *
 * Written out rather than printed as a bare percentage, because "84 %" alone
 * invites the reader to invent what it is 84 % OF.
 *
 * @param {object|null} step One entry of `expansion`.
 * @returns {string|null}
 */
export function expansionSentence(step) {
  if (!step || !Number.isFinite(step.share)) return null;
  const from = minutesLabel(step.fromSeconds);
  const to = minutesLabel(step.toSeconds);
  if (step.share >= 100) {
    return `${from} → ${to} : ${step.share} % de l’expansion libre — le réseau s’ouvre au-delà`;
  }
  return `${from} → ${to} : ${step.share} % de l’expansion libre `
    + `(×${step.ratio} au lieu de ×${step.freeSpaceRatio}) — le réseau freine`;
}

/**
 * Draw one ring: a clamped fill, a clamped outline, and a pickable label.
 *
 * The label is the ONLY pickable thing a ring has. A clamped polyline is
 * ground-classification geometry and `scene.pick` returns null on it — the
 * urbanism layer measured that at every one of 62 vertices of a ring on screen
 * — so a layer whose subject is an outline has to plant something with a
 * position on it, or its cards are unreachable.
 *
 * @param {object} dataSource
 * @param {object} ring Projected ring.
 * @param {object} context
 * @returns {number} Entities that carry a card.
 */
/**
 * The unreachable pockets inside the shape, as a sentence — or nothing.
 * @param {Array<{holes: Array<Array<number[]>>}>} parts
 * @returns {string|null}
 */
export function holesSentence(parts) {
  const holes = (parts || []).reduce((total, part) => total + (part.holes?.length || 0), 0);
  if (!holes) return null;
  return holes > 1
    ? `${holes} poches intérieures non atteignables, déjà retirées de la surface`
    : 'une poche intérieure non atteignable, déjà retirée de la surface';
}

/**
 * A catchment in several disconnected pieces, as a sentence — or nothing.
 * @param {Array<object>} parts
 * @returns {string|null}
 */
export function partsSentence(parts) {
  const count = (parts || []).length;
  return count > 1 ? `${count} morceaux disjoints — la surface est leur somme` : null;
}

/** One ring of `[lon, lat]` as Cesium positions, bad vertices dropped. */
function cartesianRing(ring) {
  return (Array.isArray(ring) ? ring : [])
    .filter((point) => Number.isFinite(point?.[0]) && Number.isFinite(point?.[1]))
    .map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
}

export function drawRing(dataSource, ring, {
  mode, expansion = [], classificationType, index = 0,
}) {
  const positions = cartesianRing(ring.ring);
  if (positions.length < 3) return 0;
  const style = ringStyle(ring.seconds);
  const css = Cesium.Color.fromCssColorString(style.color);
  const label = minutesLabel(ring.seconds);
  const radiusM = equivalentRadiusM(ring.areaKm2);
  const step = expansion.find((entry) => entry.toSeconds === ring.seconds) || null;

  // Every piece of the shape, holes and all. `parts` is present whenever the
  // service answered a MultiPolygon; a plain Polygon is one part, which is the
  // ordinary case and the loop's own default. Drawing only `ring` here while
  // the card printed an area computed over the whole thing would put a number
  // on screen that the picture contradicts.
  const parts = Array.isArray(ring.parts) && ring.parts.length
    ? ring.parts
    : [{ ring: ring.ring, holes: ring.holes || [] }];
  parts.forEach((part, partIndex) => {
    const outer = partIndex === 0 ? positions : cartesianRing(part.ring);
    if (outer.length < 3) return;
    const holes = (part.holes || [])
      .map((hole) => cartesianRing(hole))
      .filter((hole) => hole.length >= 3)
      .map((hole) => new Cesium.PolygonHierarchy(hole));
    const suffix = partIndex === 0 ? '' : `:${partIndex}`;
    dataSource.entities.add({
      id: `isochrone:${ring.seconds}:fill${suffix}`,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(outer, holes),
        material: css.withAlpha(style.fillAlpha),
        classificationType,
        outline: false,
      },
    });
    dataSource.entities.add({
      id: `isochrone:${ring.seconds}:outline${suffix}`,
      polyline: {
        positions: [...outer, outer[0]],
        width: style.widthPx,
        material: new Cesium.ColorMaterialProperty(css.withAlpha(0.95)),
        clampToGround: true,
        classificationType,
      },
    });
    // A hole gets its own outline, thinner: an unfilled patch inside a fill
    // reads as a rendering glitch unless something draws its edge.
    (part.holes || []).forEach((hole, holeIndex) => {
      const edge = cartesianRing(hole);
      if (edge.length < 3) return;
      dataSource.entities.add({
        id: `isochrone:${ring.seconds}:hole${suffix}:${holeIndex}`,
        polyline: {
          positions: [...edge, edge[0]],
          width: Math.max(1, style.widthPx - 1),
          material: new Cesium.ColorMaterialProperty(css.withAlpha(0.6)),
          clampToGround: true,
          classificationType,
        },
      });
    });
  });

  const anchor = ringLabelAnchor(ring.ring);
  if (!anchor) return 0;
  dataSource.entities.add({
    id: `isochrone:${ring.seconds}:label`,
    position: Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1]),
    label: {
      text: label,
      font: 'bold 13px "Roboto Mono", monospace',
      fillColor: css,
      // Black outline, not a lighter one: it survives over both a pale
      // orthophoto and the dark end of a stacked fill, and it is the same
      // discipline the urbanism zone codes use.
      outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      pixelOffset: new Cesium.Cartesian2(0, -6 - index * 2),
    },
    properties: { kind: 'isochrone-ring', seconds: ring.seconds },
    name: `${label} ${modeVerb(mode)}`,
    description: [
      `${ring.areaKm2} km² réellement atteignables`,
      // The circle this layer exists to refuse, printed beside the shape that
      // refutes it. A reader who only remembers one number remembers a radius,
      // so give them the honest one — the radius of the circle with the SAME
      // AREA — rather than letting them keep the straight-line one.
      `soit un cercle équivalent de ${radiusM} m — mais ce n’est pas un cercle`,
      expansionSentence(step),
      // Said out loud, because a hole is the one part of the shape a reader
      // cannot infer from the outline, and it is ground the area has ALREADY
      // been reduced by. Same for a shape in several pieces.
      holesSentence(parts),
      partsSentence(parts),
      ring.resourceVersion ? `BD TOPO ${ring.resourceVersion}` : null,
    ].filter(Boolean).join(' · '),
  });
  return 1;
}

const base = createAddressScanLayer({
  id: ISOCHRONE_LAYER_ID,
  name: ISOCHRONE_LAYER_NAME,
  icon: '◎',
  source: 'IGN Géoplateforme — Valhalla sur BD TOPO®',
  endpoint: '/api/isochrone',
  updateInterval: UPDATE_INTERVAL_MS,
  maxAltitudeM: MAX_ALTITUDE_M,
  params: () => ({ profile: _mode, seconds: ISOCHRONE_STEPS.join(',') }),
  // The rings are ground-classification geometry and a classification type is
  // read once, when the primitive is built. Switching to the Google photoreal
  // tileset hides the globe and a wash built for TERRAIN then draws nothing —
  // the layer looks switched off. Same reason the urbanism layer opts in.
  redrawOnMapStack: true,

  render({ payload, dataSource, point, viewer }) {
    const classificationType = viewer?.scene?.globe?.show === false
      ? Cesium.ClassificationType.CESIUM_3D_TILE
      : Cesium.ClassificationType.TERRAIN;
    const rings = Array.isArray(payload.rings) ? payload.rings : [];
    const mode = resolveMode(payload.profile) || _mode;
    let drawn = 0;

    // FAR TO NEAR. The fills stack, and the nearest ring has to land on top —
    // both so the gradient runs the right way and so the 5-minute outline is
    // not buried under two washes drawn after it.
    const ordered = [...rings].sort((a, b) => b.seconds - a.seconds);
    for (const [index, ring] of ordered.entries()) {
      drawn += drawRing(dataSource, ring, {
        mode, expansion: payload.expansion || [], classificationType, index,
      });
    }

    if (point) {
      const outer = rings[rings.length - 1] || null;
      dataSource.entities.add({
        id: 'isochrone:centre',
        position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat),
        billboard: {
          // A TARGET RING, not a pin. Every other address layer plants a glyph
          // for a thing standing on the ground — a sale, a diagnostic, a
          // hazard. This one marks the ORIGIN of a measurement, and the shape
          // is what tells the four apart when they land on the same address.
          image: addressMarkerGlyph('target'),
          width: 26,
          height: 26,
          color: Cesium.Color.fromCssColorString(ISOCHRONE_RING_STYLES[0].color),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { kind: 'isochrone-centre' },
        name: `Depuis ce point, ${modeVerb(mode)}`,
        description: [
          rings.length
            ? rings.map((ring) => `${minutesLabel(ring.seconds)} : ${ring.areaKm2} km²`).join(' · ')
            : 'aucun anneau renvoyé par le service',
          outer
            ? `cercle équivalent au plus grand anneau : ${equivalentRadiusM(outer.areaKm2)} m`
            : null,
          ...(payload.expansion || []).map(expansionSentence),
          // Said out loud: two rings out of three is a smaller catchment area
          // drawn with the same confidence as three, which is the one way this
          // layer could quietly mislead.
          payload.missing
            ? `${payload.missing} anneau${payload.missing > 1 ? 'x' : ''} non renvoyé${payload.missing > 1 ? 's' : ''} par le service`
            : null,
          'Vélo indisponible : le service IGN refuse ce profil',
        ].filter(Boolean).join(' · '),
      });
      drawn += 1;
    }
    return drawn;
  },

  summarize(payload) {
    const rings = Array.isArray(payload.rings) ? payload.rings : [];
    const outer = rings[rings.length - 1] || null;
    return {
      profile: payload.profile ?? null,
      ringsDrawn: rings.length,
      ringsMissing: payload.missing ?? 0,
      areasKm2: rings.map((ring) => ring.areaKm2),
      outerAreaKm2: outer?.areaKm2 ?? null,
      outerRadiusM: outer ? equivalentRadiusM(outer.areaKm2) : null,
      // The obstruction reading, as a single number a row can carry: the
      // expansion share of the LAST pair, which is the one describing the
      // outermost band.
      expansionShare: (payload.expansion || []).at(-1)?.share ?? null,
      resourceVersion: payload.resourceVersion ?? null,
    };
  },
});

/**
 * The layer, wrapping the shared address-scan factory with a mode control.
 *
 * Spread rather than subclassed: every method the factory returns is a closure
 * over its own state and none of them read `this`, so copying the references
 * onto a new object is exact. What is added is the three things the factory has
 * no opinion about — which travel mode is drawn, how that reaches a share link,
 * and the chips and legend that let a reader change it.
 */
const isochroneRingsLayer = {
  ...base,

  /**
   * Runtime params. Changing the mode CHANGES THE QUESTION, so unlike the
   * carroyage's indicator this one has to refetch: a driving ring is not a
   * recolouring of a walking ring.
   * @param {{profile?: string}} [params]
   * @returns {boolean}
   */
  setParams(params = {}) {
    if (params.profile === undefined) return false;
    const next = resolveMode(params.profile);
    // An unsupported mode is refused rather than downgraded — see `resolveMode`.
    if (!next || next === _mode) return false;
    _mode = next;
    void base.update();
    return true;
  },

  /**
   * The mode a share link has to carry.
   *
   * Without this the link would restore the walking rings whatever the sender
   * was looking at, and a driving catchment area is a different claim about the
   * same address.
   * @returns {{profile: string}}
   */
  getParams() {
    return { profile: _mode };
  },

  getRowControls() {
    const stats = base.getStats();
    const areas = Array.isArray(stats.areasKm2) ? stats.areasKm2 : [];
    const chips = ISOCHRONE_MODES.map((mode) => ({
      id: mode.id,
      label: mode.label,
      active: mode.available && _mode === mode.id,
      state: mode.available ? (_mode === mode.id ? 'active' : 'idle') : 'unavailable',
      // A chip that cannot be pressed, carrying the reason. The alternative is
      // a reader wondering why a cycling city has no cycling ring.
      disabled: !mode.available,
      title: mode.blurb,
      params: mode.available ? { profile: mode.id } : undefined,
    }));
    const legend = ISOCHRONE_RING_STYLES.map((style, index) => ({
      label: minutesLabel(style.seconds),
      color: style.color,
      // The COUNT column carries the area, because for this layer "how many"
      // has no meaning and "how big" is the entire subject. Rounded to a whole
      // number of hectares' worth of precision, which is what the source's own
      // vertex resolution supports.
      count: Number.isFinite(areas[index]) ? areas[index] : 0,
      blurb: `${minutesLabel(style.seconds)} ${modeVerb(_mode)} — surface réellement atteignable, en km²`,
    }));
    return { chips, legend };
  },

  getStats() {
    const stats = base.getStats();
    const result = {
      ...stats,
      mode: _mode,
      // Reported so the row can say the refusal without a reader opening a card.
      bikeUnavailable: true,
      feedSource: 'IGN Géoplateforme (Valhalla / BD TOPO®) — Licence Ouverte 2.0',
    };
    if (stats.dormant) {
      result.status = 'ok';
      result.loadingLabel = `Descends sous ${Math.round(MAX_ALTITUDE_M / 1000)} km `
        + 'pour mesurer une zone de chalandise';
    } else if (stats.ringsMissing) {
      result.degraded = true;
      result.loadingLabel = `${stats.ringsMissing} anneau(x) non renvoyé(s) par le service IGN`;
    }
    return result;
  },
};

/** @returns {string} The mode currently drawn. Test seam. */
export function _isochroneModeForTest() {
  return _mode;
}

/** Force the drawn mode without going through the manager. Test seam. */
export function _setIsochroneModeForTest(mode) {
  _mode = resolveMode(mode) || ISOCHRONE_DEFAULT_MODE;
}

/** @returns {object} The wrapped factory layer. Test seam. */
export function _isochroneBaseForTest() {
  return base;
}

export default isochroneRingsLayer;
