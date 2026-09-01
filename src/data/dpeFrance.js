import * as Cesium from 'cesium';
import { DPE_LABELS } from './dpeFeed.js';
import { addressMarkerGlyph, dpeLetterKind } from './addressMarkerIcons.js';
import { createAddressScanLayer } from './addressScanLayer.js';

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
const COLOR_UNLABELLED = Cesium.Color.fromCssColorString('#7c8aa0');

/**
 * Colour one diagnostic by its published label.
 * @param {string|null} label
 * @returns {object} Cesium colour.
 */
export function dpeColor(label) {
  const css = DPE_COLORS[label];
  return css ? Cesium.Color.fromCssColorString(css) : COLOR_UNLABELLED;
}

const dpeFranceLayer = createAddressScanLayer({
  id: 'dpe-fr',
  name: 'Performance énergétique (DPE)',
  icon: '▤',
  source: 'ADEME — Observatoire DPE',
  endpoint: '/api/dpe',
  updateInterval: UPDATE_INTERVAL_MS,
  params: () => ({ radius: String(SCAN_RADIUS_M), limit: String(SCAN_LIMIT) }),

  render({ payload, dataSource }) {
    let drawn = 0;
    for (const entry of payload.entries || []) {
      if (!Number.isFinite(entry.lon) || !Number.isFinite(entry.lat)) continue;
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
          width: entry.etiquetteDpe ? SIZE_LABELLED_PX : SIZE_UNLABELLED_PX,
          height: entry.etiquetteDpe ? SIZE_LABELLED_PX : SIZE_UNLABELLED_PX,
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
        },
        name: entry.address || `DPE ${entry.id}`,
        description: [
          entry.etiquetteDpe ? `Énergie ${entry.etiquetteDpe}` : 'Étiquette non publiée',
          entry.etiquetteGes ? `GES ${entry.etiquetteGes}` : null,
          entry.surfaceM2 ? `${entry.surfaceM2} m²` : null,
          Number.isFinite(entry.annualCostEur)
            ? `${Math.round(entry.annualCostEur).toLocaleString('fr-FR')} €/an estimés` : null,
          entry.consoKwhM2 ? `${entry.consoKwhM2} kWh/m²/an` : null,
          entry.issuedOn ? `diagnostic du ${entry.issuedOn}` : null,
          entry.distanceM !== null ? `${entry.distanceM} m` : null,
        ].filter(Boolean).join(' · '),
      });
      drawn += 1;
    }
    return drawn;
  },

  summarize(payload) {
    const distribution = payload.distribution || {};
    const labelled = DPE_LABELS.reduce((sum, letter) => sum + (distribution[letter] || 0), 0);
    const poor = (distribution.F || 0) + (distribution.G || 0);
    return {
      // "2,805 diagnostics within 300 m" against "here are the 200 nearest".
      diagnosticsTotal: payload.total ?? null,
      diagnosticsServed: (payload.entries || []).length,
      truncated: payload.truncated === true,
      distribution,
      // Share of F and G — the *passoires thermiques* whose letting is being
      // phased out, and the single most decision-relevant cut of this register.
      poorCount: poor,
      poorShare: labelled ? Math.round((poor / labelled) * 100) : null,
      medianCoutAnnuel: payload.medianCoutAnnuel ?? null,
    };
  },
});

export default dpeFranceLayer;
