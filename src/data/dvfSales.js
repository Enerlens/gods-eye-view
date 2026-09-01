import * as Cesium from 'cesium';
import { addressMarkerGlyph } from './addressMarkerIcons.js';
import { createAddressScanLayer } from './addressScanLayer.js';

/**
 * DVF — what the flats around this point actually sold for.
 *
 * The register is the file a French buyer opens by hand, one commune at a time.
 * Drawn in place it answers the question that survey does not: not "what is the
 * average in the 13th" but "what did the three buildings I can see change hands
 * for, and when".
 *
 * WHY SO MANY DOTS ARE GREY. A price per square metre is a comparable only when
 * the sale bought exactly one dwelling. `dvfFeed.js` carries the measurement:
 * one captured mutation is a €32,000,000 building spread over 179 rows, and the
 * obvious arithmetic turns it into €1.28 million per square metre. Those sales
 * are still drawn — they happened — but grey, with no ratio. A colour would be
 * a claim the register does not support.
 *
 * @module data/dvfSales
 */

/** Refresh cadence. Editions are annual; this is about camera movement. */
const UPDATE_INTERVAL_MS = 600_000;
const SCAN_RADIUS_M = 300;

/**
 * Marker size, in CSS px. A sale with a comparable ratio is the one worth
 * reading, so it gets the pixels; a grey one still has to be visible enough to
 * click, because WHY it has no ratio is on its card.
 */
const SIZE_COMPARABLE_PX = 19;
const SIZE_NO_RATIO_PX = 15;

const COLOR_NO_RATIO = Cesium.Color.fromCssColorString('#7c8aa0');

/**
 * Colour a sale against the local median rather than an absolute scale.
 *
 * An absolute €/m² ramp would paint every Paris sale the same colour and every
 * rural one another, which says nothing. Against the median of what is on
 * screen, the outlier in the street becomes visible — which is the question a
 * buyer is actually asking.
 *
 * @param {number|null} prixM2
 * @param {number|null} median
 * @returns {object} Cesium colour.
 */
export function saleColor(prixM2, median) {
  if (prixM2 === null || !median) return COLOR_NO_RATIO;
  const ratio = prixM2 / median;
  if (ratio >= 1.25) return Cesium.Color.fromCssColorString('#ff6b4a');
  if (ratio >= 1.05) return Cesium.Color.fromCssColorString('#ffb03d');
  if (ratio >= 0.95) return Cesium.Color.fromCssColorString('#ffe066');
  if (ratio >= 0.75) return Cesium.Color.fromCssColorString('#7ed957');
  return Cesium.Color.fromCssColorString('#3dd6c4');
}

/** Format a euro amount the way a French reader expects to see it. */
function euros(value) {
  return Number.isFinite(value) ? `${value.toLocaleString('fr-FR')} €` : '—';
}

const dvfSalesLayer = createAddressScanLayer({
  id: 'dvf-sales',
  name: 'Ventes immobilières (DVF)',
  icon: '€',
  source: 'DVF — Etalab / DGFiP',
  endpoint: '/api/dvf',
  updateInterval: UPDATE_INTERVAL_MS,
  params: () => ({ radius: String(SCAN_RADIUS_M) }),

  render({ payload, dataSource }) {
    const median = payload.summary?.medianPrixM2 ?? null;
    let drawn = 0;
    for (const sale of payload.sales || []) {
      if (!Number.isFinite(sale.lon) || !Number.isFinite(sale.lat)) continue;
      const comparable = sale.prixM2 !== null;
      dataSource.entities.add({
        id: `dvf:${sale.id}`,
        position: Cesium.Cartesian3.fromDegrees(sale.lon, sale.lat),
        billboard: {
          // A EURO SIGN, not a disc. Turn this layer on with the DPE layer and
          // both used to draw coloured dots over the same roofs, with nothing
          // to say which register a dot came from — colour was already spent
          // on the price ratio here and on the A–G scale there, so the shape
          // is what carries the source. See `addressMarkerIcons.js`.
          image: addressMarkerGlyph('euro'),
          width: comparable ? SIZE_COMPARABLE_PX : SIZE_NO_RATIO_PX,
          height: comparable ? SIZE_COMPARABLE_PX : SIZE_NO_RATIO_PX,
          // The glyph is white line-art; this tint IS the price channel.
          color: saleColor(sale.prixM2, median),
          // POSITIVE_INFINITY, not a distance. With a finite value the marker is
          // depth-tested as soon as the camera is further away than that, and
          // the terrain then eats the bottom half of every glyph — the reported
          // symptom was "the dots don't display properly", and at city zoom
          // they were rendering clipped by the ground under them. These are
          // annotations ON the world, not objects IN it.
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: {
          kind: 'dvf-sale',
          prixM2: sale.prixM2,
          comparable,
          date: sale.date,
          nature: sale.nature,
          rowCount: sale.rowCount,
        },
        name: sale.address || sale.commune || 'Mutation',
        description: [
          sale.date,
          sale.nature,
          euros(sale.valeur),
          comparable ? `${sale.prixM2.toLocaleString('fr-FR')} €/m²`
            // Saying WHY there is no ratio is the point of drawing it grey.
            : sale.dwellingCount > 1 ? `${sale.dwellingCount} logements — pas de €/m² comparable`
              : 'pas de €/m² comparable',
          sale.dwellingSurface ? `${sale.dwellingSurface} m²` : null,
          `${sale.distanceM} m`,
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
      years: payload.years ?? null,
      salesFound: summary.count ?? 0,
      // The gap between these two is the honesty of the median above them.
      comparableCount: summary.comparableCount ?? 0,
      medianPrixM2: summary.medianPrixM2 ?? null,
      p25PrixM2: summary.p25PrixM2 ?? null,
      p75PrixM2: summary.p75PrixM2 ?? null,
      perYear: summary.perYear ?? null,
    };
  },
});

export default dvfSalesLayer;
