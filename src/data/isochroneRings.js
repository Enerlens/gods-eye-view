import * as Cesium from 'cesium';
import { addressMarkerGlyph } from './addressMarkerIcons.js';
import { createAddressScanLayer } from './addressScanLayer.js';
import { BIKE_ENVELOPE_BEARINGS, ISOCHRONE_STEPS, equivalentRadiusM } from './isochroneFeed.js';

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
 * THE CYCLING RING COMES FROM SOMEWHERE ELSE, AND IT IS DRAWN DIFFERENTLY. IGN
 * has no cycling cost model at any resource — re-probed 2026-09-02, still
 * `value should be one of car,pedestrian` — so a cycling ring is measured on
 * the OSM cycling network through the FOSSGIS OSRM table, along 36 spokes. It
 * is an ENVELOPE, not a polygon: every vertex is a real routed duration, and
 * the straight line between two neighbouring vertices is not. It is therefore
 * drawn with a DASHED outline and its area is called a majorant rather than a
 * surface. `isochroneFeed.js` carries the measured divergence — up to +69 % of
 * area in sparse rural networks — and the card prints it.
 *
 * WHY THE CEILING IS PER MODE, AND WHY A PIN HAS NONE. A fifteen-minute walk is
 * 1.9 km across and a fifteen-minute drive is up to 16.5 km (measured over five
 * French communes on 2026-09-02, rural Cantal being the widest). One ceiling
 * for both meant the driving catchment the layer had just measured was cleared
 * off the screen the moment the reader pulled back far enough to see it — the
 * layer refusing to show its own answer. So the ceiling now follows the mode.
 * And a reader who clicks the map PINS the centre, which removes the ceiling
 * altogether: the ceiling exists to stop a camera-driven layer from firing a
 * request per nudge across a country, and a pinned centre fires nothing when
 * the camera moves.
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
 * The altitude a camera-following scan gives up at, PER MODE.
 *
 * Derived from the ground the ring actually covers, measured against the live
 * services on 2026-09-02 over Ustaritz, Paris 11e, Lyon, Bordeaux and rural
 * Cantal, at fifteen minutes — the widest ring the layer draws:
 *
 *   walking   1.8 × 1.9 km at the widest (Lyon)
 *   cycling   4.1 × 7.2 km (Ustaritz), 5.2 × 5.6 (Paris)
 *   driving  16.5 × 14.1 km (Cantal), 10.2 × 13.2 (Ustaritz)
 *
 * Cesium's default frustum shows about 0.65 × altitude of ground on the SHORT
 * screen axis at nadir, and less than that at the pitch anyone actually flies
 * at. So the driving ceiling has to sit near 25 km before the widest ring even
 * fits, and 45 km is that with room for the pitch. The walking ceiling is
 * unchanged at 8 km, which was never the complaint.
 */
export const ISOCHRONE_MAX_ALTITUDE_M = Object.freeze({
  foot: 8_000,
  bike: 20_000,
  car: 45_000,
});

/**
 * How far the camera has to move before the same question is asked again, per
 * mode.
 *
 * The shared default of 250 m is right for a ring 1.8 km across and is noise
 * against one 16 km across — and at a 45 km ceiling a lazy pan clears 250 m
 * without the view meaningfully changing, which would spend a request per
 * nudge on exactly the upstream this layer is most careful with.
 */
export const ISOCHRONE_MIN_SHIFT_KM = Object.freeze({
  foot: 0.25,
  bike: 0.6,
  car: 1.5,
});

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
 * The travel modes offered, and which of them is a polygon and which an
 * envelope.
 *
 * `envelope` is not decoration: it changes the outline from solid to dashed,
 * changes "surface atteignable" to "majorant", and puts the divergence on the
 * card. Two rings drawn with the same confidence from two methods that do not
 * deserve the same confidence is the one way this layer could quietly mislead.
 */
export const ISOCHRONE_MODES = Object.freeze([
  Object.freeze({
    id: 'foot',
    label: 'PIÉTON',
    available: true,
    envelope: false,
    feed: 'IGN Géoplateforme — Valhalla sur BD TOPO®',
    blurb: 'Marche, sur le réseau piéton et routier de la BD TOPO. Polygone exact.',
  }),
  Object.freeze({
    id: 'car',
    label: 'VOITURE',
    available: true,
    envelope: false,
    feed: 'IGN Géoplateforme — Valhalla sur BD TOPO®',
    blurb: 'Voiture, sur le réseau routier de la BD TOPO. Polygone exact.',
  }),
  Object.freeze({
    id: 'bike',
    label: 'VÉLO',
    available: true,
    envelope: true,
    feed: 'OpenStreetMap — table OSRM cyclable (FOSSGIS)',
    blurb: 'Vélo, sur le réseau cyclable OSM (OSRM) : IGN ne publie aucun profil vélo. '
      + 'Enveloppe mesurée sur 36 directions — chaque sommet est un temps réel, '
      + 'le trait entre deux sommets ne l’est pas. Surface majorée.',
  }),
]);

const MODE_BY_ID = new Map(ISOCHRONE_MODES.map((mode) => [mode.id, mode]));

/** The descriptor for a mode id, or the default one. */
export function modeSpec(id) {
  return MODE_BY_ID.get(id) || MODE_BY_ID.get('foot');
}

/** The mode the layer opens on, and the one every share link without a token means. */
export const ISOCHRONE_DEFAULT_MODE = 'foot';

/** @type {string} The mode currently drawn. */
let _mode = ISOCHRONE_DEFAULT_MODE;

/**
 * Resolve a requested mode to one that can actually be measured.
 *
 * An unavailable mode is REFUSED, not silently downgraded: `setParams` returns
 * false and the drawn rings stay what they were. Nothing is unavailable today —
 * cycling stopped being so on 2026-09-02 — but the gate stays, because the day
 * an upstream withdraws a profile the right behaviour is to keep drawing the
 * ring the reader already had rather than relabel a different one.
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
  if (mode === 'car') return 'en voiture';
  if (mode === 'bike') return 'à vélo';
  return 'à pied';
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

/** A number as a French reader writes it. */
function fr(value, digits = 2) {
  return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: digits });
}

/**
 * What an ENVELOPE ring has to say about itself. Empty for an IGN polygon.
 *
 * Four sentences and every one of them is a caveat, because an envelope drawn
 * beside two exact polygons is the one thing on this layer a reader could take
 * for more than it is. The spoke count says how coarse it is, the reach spread
 * says how uneven, the clip count says when the drawn edge is a floor rather
 * than an edge, and the last line names the network — because a cycling ring
 * compared against a walking one is a comparison of two networks as well as two
 * speeds.
 *
 * @param {object|null} ring
 * @returns {string[]}
 */
export function envelopeSentences(ring) {
  if (!ring?.envelope) return [];
  const out = [];
  out.push(`enveloppe sur ${ring.bearings || BIKE_ENVELOPE_BEARINGS} directions — `
    + 'surface majorée, pas la surface exacte');
  if (ring.reachKm && Number.isFinite(ring.reachKm.min)) {
    out.push(`portée mesurée de ${fr(ring.reachKm.min)} à ${fr(ring.reachKm.max)} km `
      + `(médiane ${fr(ring.reachKm.median)} km)`);
  }
  if (ring.clippedBearings) {
    out.push(`${ring.clippedBearings} direction${ring.clippedBearings > 1 ? 's' : ''} `
      + 'au-delà de l’échantillonnage — cette portée est un plancher');
  }
  out.push('réseau cyclable OpenStreetMap via OSRM (FOSSGIS) — pas la BD TOPO');
  return out;
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
        // DASHED FOR AN ENVELOPE. The one visual difference that survives being
        // looked at from across the room, and the reason it is a line style
        // rather than a colour: the three colours are already carrying the
        // duration ramp, and overloading them would cost the gradient.
        material: ring.envelope
          ? new Cesium.PolylineDashMaterialProperty({
            color: css.withAlpha(0.95),
            dashLength: 18,
          })
          : new Cesium.ColorMaterialProperty(css.withAlpha(0.95)),
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
      ring.envelope
        ? `${fr(ring.areaKm2)} km² au plus — enveloppe, majorant`
        : `${fr(ring.areaKm2)} km² réellement atteignables`,
      // The circle this layer exists to refuse, printed beside the shape that
      // refutes it. A reader who only remembers one number remembers a radius,
      // so give them the honest one — the radius of the circle with the SAME
      // AREA — rather than letting them keep the straight-line one.
      `soit un cercle équivalent de ${radiusM} m — mais ce n’est pas un cercle`,
      expansionSentence(step),
      ...envelopeSentences(ring),
      // Said out loud, because a hole is the one part of the shape a reader
      // cannot infer from the outline, and it is ground the area has ALREADY
      // been reduced by. Same for a shape in several pieces.
      holesSentence(parts),
      partsSentence(parts),
      ring.resourceVersion ? `BD TOPO ${ring.resourceVersion}` : null,
      Number.isFinite(ring.snapM) && ring.snapM > 25
        ? `point rattaché au réseau à ${ring.snapM} m — la mesure part de là`
        : null,
    ].filter(Boolean).join(' · '),
  });
  return 1;
}

const base = createAddressScanLayer({
  id: ISOCHRONE_LAYER_ID,
  name: ISOCHRONE_LAYER_NAME,
  icon: '◎',
  source: 'IGN Géoplateforme (BD TOPO®) · OpenStreetMap / OSRM pour le vélo',
  endpoint: '/api/isochrone',
  updateInterval: UPDATE_INTERVAL_MS,
  // Functions, not constants: both depend on the mode, and the mode is a
  // runtime choice. See `ISOCHRONE_MAX_ALTITUDE_M`.
  maxAltitudeM: () => ISOCHRONE_MAX_ALTITUDE_M[_mode] ?? ISOCHRONE_MAX_ALTITUDE_M.foot,
  minShiftKm: () => ISOCHRONE_MIN_SHIFT_KM[_mode] ?? ISOCHRONE_MIN_SHIFT_KM.foot,
  // A click on bare globe, or on this layer's own wash, MOVES THE CENTRE. The
  // layer answers a question about one point and until now that point was
  // wherever the camera happened to look — which is fine for reading a street
  // and useless for "what does THIS door reach", the question the layer is for.
  groundClick: ({ lon, lat }) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    isochroneRingsLayer.setParams({ centre: `${lon},${lat}` });
    // Consumed whether or not the pin MOVED. A second click on the same spot
    // changes nothing and must still not fall through to the dismissal path,
    // or clicking the map twice would close the card the first click opened.
    return true;
  },
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
        name: point.pinned
          ? `Point fixé — ${modeVerb(mode)}`
          : `Depuis ce point, ${modeVerb(mode)}`,
        description: [
          rings.length
            ? rings.map((ring) => `${minutesLabel(ring.seconds)} : ${fr(ring.areaKm2)} km²`).join(' · ')
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
          payload.envelope
            ? 'Enveloppe OSM/OSRM sur 36 directions — surface majorée, pas le polygone IGN'
            : null,
          // Where the centre came from, on the marker that IS the centre. A
          // reader who does not know whether flying away will move the answer
          // cannot tell what they are looking at.
          point.pinned
            ? 'centre fixé par un clic — la caméra ne le déplace plus'
            : 'centre suivi par la caméra — cliquez la carte pour le figer',
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
      // Which of the two upstreams answered, and whether what is drawn is a
      // polygon or an envelope. Both are read by the row and by the QA harness,
      // and neither is derivable from the ring count.
      feed: payload.feed ?? null,
      envelope: payload.envelope === true,
      snapM: Number.isFinite(payload.snapM) ? payload.snapM : null,
    };
  },
});

/**
 * Parse the `centre` runtime parameter.
 *
 * Two spellings and nothing else. `camera` releases the pin; `lon,lat` sets it.
 * A malformed value is REFUSED rather than snapped to anything, for the same
 * reason an unknown mode is: the layer keeps answering the question it was
 * already answering instead of silently answering a different one.
 *
 * @param {unknown} value
 * @returns {{lat: number, lon: number}|'camera'|null} Null when unusable.
 */
export function resolveCentre(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (text === 'camera' || text === 'caméra' || text === 'auto') return 'camera';
  const parts = text.split(',');
  if (parts.length !== 2) return null;
  const lon = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  // Five decimals, matching every other coordinate this layer relays: two
  // clicks a metre apart must produce the same query, or the proxy cache never
  // hits for the one workload it exists for.
  return { lon: Math.round(lon * 1e5) / 1e5, lat: Math.round(lat * 1e5) / 1e5 };
}

/**
 * The layer, wrapping the shared address-scan factory with a mode control.
 *
 * Spread rather than subclassed: every method the factory returns is a closure
 * over its own state and none of them read `this`, so copying the references
 * onto a new object is exact. What is added is the four things the factory has
 * no opinion about — which travel mode is drawn, where the centre is, how those
 * reach a share link, and the chips and legend that let a reader change them.
 */
const isochroneRingsLayer = {
  ...base,

  /**
   * Runtime params.
   *
   * `profile` CHANGES THE QUESTION, so unlike the carroyage's indicator it has
   * to refetch: a driving ring is not a recolouring of a walking ring. `centre`
   * changes WHERE the question is asked, which the shell refetches for.
   *
   * Both are handled in one call and independently: a chip sends one key, and
   * a caller that sends both gets both, with the return value true when either
   * moved.
   *
   * @param {{profile?: string, centre?: string}} [params]
   * @returns {boolean}
   */
  setParams(params = {}) {
    let changed = false;
    if (params.profile !== undefined) {
      const next = resolveMode(params.profile);
      // An unsupported mode is refused rather than downgraded — see `resolveMode`.
      if (!next) return false;
      if (next !== _mode) {
        _mode = next;
        changed = true;
      }
    }
    if (params.centre !== undefined) {
      const centre = resolveCentre(params.centre);
      if (!centre) return false;
      if (base.setScanPin(centre === 'camera' ? null : centre)) changed = true;
    }
    if (!changed) return false;
    // `setScanPin` already rescans when it moved the pin; a mode change has to
    // ask for one, because nothing else in the shell knows the query changed.
    if (params.profile !== undefined) void base.update();
    return true;
  },

  /**
   * What a share link, and the panel, have to carry.
   *
   * `profile` is encoded (see `layerState.js`). `centre` is NOT — the option
   * encoders are enums and a coordinate is not one — so a shared link reopens
   * following the camera, which lands on the same view the sender was looking
   * at. Reported here anyway, because the row reads it to decide whether to
   * offer the release chip.
   *
   * @returns {{profile: string, centre: string}}
   */
  getParams() {
    const pin = base.getScanPin();
    return {
      profile: _mode,
      centre: pin ? `${pin.lon},${pin.lat}` : 'camera',
    };
  },

  getRowControls() {
    const stats = base.getStats();
    const areas = Array.isArray(stats.areasKm2) ? stats.areasKm2 : [];
    const pin = base.getScanPin();
    const chips = ISOCHRONE_MODES.map((mode) => ({
      id: mode.id,
      label: mode.label,
      active: mode.available && _mode === mode.id,
      state: mode.available ? (_mode === mode.id ? 'active' : 'idle') : 'unavailable',
      disabled: !mode.available,
      title: mode.blurb,
      params: mode.available ? { profile: mode.id } : undefined,
    }));
    // The release. Present ONLY while a pin is held, because a chip offering to
    // release nothing is a chip that teaches a reader the wrong thing about
    // what the layer is doing — and its absence is how the row says "this is
    // following the camera" without spending a word on it.
    if (pin) {
      chips.push({
        id: 'centre-camera',
        label: 'LIBÉRER',
        active: false,
        state: 'idle',
        disabled: false,
        title: `Centre fixé à ${fr(pin.lat, 5)}, ${fr(pin.lon, 5)} — `
          + 'relâcher pour resuivre la caméra.',
        params: { centre: 'camera' },
      });
    }
    const envelope = modeSpec(_mode).envelope;
    const legend = ISOCHRONE_RING_STYLES.map((style, index) => ({
      label: minutesLabel(style.seconds),
      color: style.color,
      // The COUNT column carries the area, because for this layer "how many"
      // has no meaning and "how big" is the entire subject. Rounded to a whole
      // number of hectares' worth of precision, which is what the source's own
      // vertex resolution supports.
      count: Number.isFinite(areas[index]) ? areas[index] : 0,
      blurb: `${minutesLabel(style.seconds)} ${modeVerb(_mode)} — `
        + `${envelope ? 'surface majorée de l’enveloppe' : 'surface réellement atteignable'}, en km²`,
    }));
    return { chips, legend };
  },

  getStats() {
    const stats = base.getStats();
    const spec = modeSpec(_mode);
    const ceilingM = ISOCHRONE_MAX_ALTITUDE_M[_mode] ?? ISOCHRONE_MAX_ALTITUDE_M.foot;
    const result = {
      ...stats,
      mode: _mode,
      // What the drawn shape IS, at the top level, so a reader of the row or of
      // the QA harness never has to open a ring to find out.
      envelope: spec.envelope,
      pinned: Boolean(stats.scanPin),
      maxAltitudeM: ceilingM,
      feedSource: spec.envelope
        ? 'OpenStreetMap via OSRM (FOSSGIS) — ODbL'
        : 'IGN Géoplateforme (Valhalla / BD TOPO®) — Licence Ouverte 2.0',
    };
    if (stats.dormant) {
      result.status = 'ok';
      // Both ways out, because there are now two and the second one is the
      // answer for a driving catchment too wide to fit under any ceiling.
      result.loadingLabel = `Descends sous ${Math.round(ceilingM / 1000)} km, `
        + 'ou clique un point pour l’y fixer';
    } else if (stats.ringsMissing) {
      result.degraded = true;
      result.loadingLabel = `${stats.ringsMissing} anneau(x) non renvoyé(s) par le service`;
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
