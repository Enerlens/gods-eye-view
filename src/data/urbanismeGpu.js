import * as Cesium from 'cesium';
import { addressMarkerGlyph } from './addressMarkerIcons.js';
import { createAddressScanLayer } from './addressScanLayer.js';

/**
 * Géoportail de l'urbanisme — what may legally be built here, and what the
 * state has already encumbered this ground with.
 *
 * THE MOST DECISION-CHANGING LAYER OF THE SIX, AND THE LEAST LOOKED AT. A
 * listing shows the flat. It does not show that the car park opposite is zoned
 * for construction, that an airport noise-exposure plan covers the address, or
 * that a railway protection strip runs under the balcony. All three are
 * public, drawable, and read today — if at all — one PDF at a time.
 *
 * WHY THERE IS A MARKER AT THE SCAN POINT. Clamped polylines are drawn as
 * ground primitives and are NOT pickable in this scene — measured: 62 vertices
 * of one servitude ring on screen, `scene.pick` returning null at every one of
 * them. Widening the stroke did not change it. But aiming at a hairline was
 * always the wrong interaction anyway: a zoning rule and an easement describe
 * the GROUND UNDER THE ADDRESS, not a particular line on a map. So the layer
 * plants one marker at the point it scanned, carrying the whole answer, and the
 * outlines stay as the context that shows how far each rule reaches.
 *
 * DRAWN AS OUTLINES, AND SAYING SO. The measured upstream is 1,396,720 bytes
 * for one point, one feature of which is 759 polygons and 50,669 vertices
 * published to the millimetre. `gpuFeed.js` decimates that by 96%, and every
 * shape carries `simplified` so nothing here is mistaken for a surveyed limit.
 * The regulation URL rides along on each servitude: this layer points at the
 * legal document, it is not one.
 *
 * @module data/urbanismeGpu
 */

const UPDATE_INTERVAL_MS = 900_000;

/** Zoning kinds in the national PLU grammar. */
const ZONE_COLORS = Object.freeze({
  U: '#ff9d3d',   // urbaine — already built
  AU: '#ff5ac8',  // à urbaniser — the one that changes a view
  A: '#9ad14b',   // agricole
  N: '#3dd6c4',   // naturelle
});
const ZONE_FALLBACK = '#c9d4e0';
const SERVITUDE_COLOR = '#ff4d3d';

/** Servitude families worth pulling to the front of a reader's attention. */
const LOUD_SUP_CODES = new Set(['t1', 't4', 't5', 't7', 'i1', 'i3', 'i4', 'pm1', 'pm3']);

/**
 * Colour a zoning polygon by its national type letter.
 * @param {string|null} kind
 * @returns {string} CSS colour.
 */
export function zoneColorCss(kind) {
  return ZONE_COLORS[String(kind || '').toUpperCase()] || ZONE_FALLBACK;
}

/**
 * Add one outline per ring.
 * @param {object} dataSource
 * @param {string} idPrefix
 * @param {Array<Array<number[]>>} rings
 * @param {{css: string, width: number, name: string, description: string, properties: object}} style
 * @returns {number} Rings drawn.
 */
function drawRings(dataSource, idPrefix, rings, style) {
  let drawn = 0;
  for (const [index, ring] of (rings || []).entries()) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    dataSource.entities.add({
      id: `${idPrefix}:${index}`,
      name: style.name,
      description: style.description,
      properties: style.properties,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(ring.flat()),
        width: style.width,
        material: Cesium.Color.fromCssColorString(style.css).withAlpha(0.9),
        clampToGround: true,
      },
    });
    drawn += 1;
  }
  return drawn;
}

const urbanismeGpuLayer = createAddressScanLayer({
  id: 'urbanisme-gpu',
  name: 'Urbanisme (PLU & servitudes)',
  icon: '▦',
  source: 'Géoportail de l\'urbanisme — IGN',
  endpoint: '/api/gpu',
  updateInterval: UPDATE_INTERVAL_MS,

  render({ payload, dataSource, point }) {
    let drawn = 0;
    const zone = (payload.zones || [])[0] || null;
    const servitudes = payload.servitudes || [];
    if (point && (zone || servitudes.length)) {
      dataSource.entities.add({
        id: 'gpu:scan-point',
        position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat),
        billboard: {
          // A PLAN SHEET. A zoning rule is a drawing ABOUT ground rather than
          // an object standing on it, and the sheet is what tells this marker
          // apart from the euro, the DPE badge and the hazard triangle that
          // land on the same address.
          image: addressMarkerGlyph('plan'),
          width: 26,
          height: 26,
          color: Cesium.Color.fromCssColorString(zoneColorCss(zone?.kind)),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { kind: 'plu-scan-point' },
        name: zone ? `${zone.code || 'Zone'} — ${zone.label || 'zonage PLU'}` : 'Servitudes à cette adresse',
        description: [
          zone?.approvedOn ? `PLU approuvé le ${zone.approvedOn}` : null,
          zone?.regulationFile,
          servitudes.length
            ? `${servitudes.length} servitude${servitudes.length > 1 ? 's' : ''} : `
              + [...new Set(servitudes.map((entry) => entry.label))].join(', ')
            : 'aucune servitude relevée',
          servitudes.some((entry) => entry.simplified)
            ? 'contours simplifiés pour l\'affichage — voir le règlement' : null,
        ].filter(Boolean).join(' · '),
      });
      drawn += 1;
    }
    for (const zone of payload.zones || []) {
      drawn += drawRings(dataSource, `gpu:zone:${zone.id}`, zone.rings, {
        css: zoneColorCss(zone.kind),
        // 3 px, not 2. A clamped hairline is both hard to see against an
        // orthophoto and hard to HIT: picking a polyline needs the cursor on
        // the line itself, and at 2 px selecting a zoning boundary was a matter
        // of luck. Width is the only pick tolerance a Cesium polyline has.
        width: 3,
        name: `${zone.code || 'Zone'} — ${zone.label || 'zonage PLU'}`,
        properties: { kind: 'plu-zone', zoneKind: zone.kind, simplified: zone.simplified },
        description: [
          zone.label,
          zone.approvedOn ? `PLU approuvé le ${zone.approvedOn}` : null,
          zone.regulationFile,
          zone.simplified ? `contour simplifié (${zone.sourceVertices} sommets à l'amont)` : null,
        ].filter(Boolean).join(' · '),
      });
    }
    for (const servitude of payload.servitudes || []) {
      drawn += drawRings(dataSource, `gpu:sup:${servitude.id}`, servitude.rings, {
        css: SERVITUDE_COLOR,
        width: LOUD_SUP_CODES.has(servitude.code) ? 5 : 4,
        name: servitude.label || servitude.code || 'Servitude',
        properties: {
          kind: 'servitude',
          code: servitude.code,
          simplified: servitude.simplified,
          regulationUrl: servitude.regulationUrl,
        },
        description: [
          servitude.name,
          servitude.assietteType,
          servitude.bufferM ? `zone tampon de ${servitude.bufferM} m` : null,
          servitude.simplified
            ? `contour simplifié (${servitude.servedRings}/${servitude.sourceRings} anneaux, `
              + `${servitude.sourceVertices} sommets à l'amont)`
            : null,
          servitude.regulationUrl ? `règlement : ${servitude.regulationUrl}` : null,
        ].filter(Boolean).join(' · '),
      });
    }
    return drawn;
  },

  summarize(payload) {
    const servitudes = payload.servitudes || [];
    return {
      zones: (payload.zones || []).map((zone) => ({
        code: zone.code, kind: zone.kind, label: zone.label, approvedOn: zone.approvedOn,
      })),
      servitudeCount: servitudes.length,
      servitudeCodes: servitudes.map((entry) => entry.code).filter(Boolean),
      // The families a buyer would want named out loud rather than counted.
      notableServitudes: servitudes
        .filter((entry) => LOUD_SUP_CODES.has(entry.code))
        .map((entry) => entry.label),
      // True when any outline on screen is a decimation, not a boundary.
      simplified: [...(payload.zones || []), ...servitudes].some((entry) => entry.simplified),
      available: payload.available ?? null,
    };
  },
});

export default urbanismeGpuLayer;
