import * as Cesium from 'cesium';
import { addressMarkerGlyph } from './addressMarkerIcons.js';
import { createAddressScanLayer } from './addressScanLayer.js';

/**
 * Géorisques — the state's own risk register, read from wherever the camera is
 * looking.
 *
 * WHAT MAKES THIS LAYER WORTH HAVING. The facts it draws are the same ones a
 * French seller is legally obliged to hand a buyer in the *état des risques* —
 * flood, clay shrinkage, seismicity, radon, industrial sites, polluted soil,
 * hazardous pipelines. That document normally arrives at the compromis, weeks
 * after the decision to buy. Read from a coordinate it arrives before the first
 * visit.
 *
 * WHAT IS DRAWN AND WHAT IS NOT. Classified installations (ICPE) have
 * coordinates, so they are drawn as points. The hazards do not: Géorisques
 * answers them as verdicts over the commune and over the address, with no
 * geometry attached. Inventing a circle for "this address is exposed to
 * flooding" would be drawing a flood zone that does not exist in the data, so
 * hazards are reported through `getStats()` and left to the panel.
 *
 * THE TWO VERDICTS ARE KEPT APART. `communeVerdict` and `addressVerdict` can
 * disagree — measured on the Paris 13e, ICPE reads "Risque Concerne" for the
 * commune and "Risque non Concerne" for the address. That is the difference
 * between "true anywhere around here" and "depends on your street", and the
 * upstream computed it, so the layer carries it rather than picking one.
 *
 * @module data/georisques
 */

/** Seveso sites first: the one distinction a reader must not have to hunt for. */
const COLOR_SEVESO = Cesium.Color.fromCssColorString('#ff4d3d');
const COLOR_ICPE = Cesium.Color.fromCssColorString('#ffa63d');
const COLOR_DECLASSIFIED = Cesium.Color.fromCssColorString('#7c8aa0');

/** Refresh cadence. The register is republished in weeks, not minutes. */
const UPDATE_INTERVAL_MS = 300_000;
/** Radius asked of the API, in metres. */
const SCAN_RADIUS_M = 1000;

/**
 * Colour and size one establishment by what it actually is.
 * @param {object} site
 * @returns {{color: object, pixelSize: number}}
 */
function icpeStyle(site) {
  if (site.seveso) return { color: COLOR_SEVESO, sizePx: 26 };
  if (site.regime === 'Non ICPE') return { color: COLOR_DECLASSIFIED, sizePx: 15 };
  return { color: COLOR_ICPE, sizePx: 20 };
}

const georisquesLayer = createAddressScanLayer({
  id: 'georisques',
  name: 'Risques (Géorisques)',
  icon: '⚠',
  source: 'Géorisques — BRGM / MTE',
  endpoint: '/api/georisques',
  updateInterval: UPDATE_INTERVAL_MS,
  params: () => ({ radius: String(SCAN_RADIUS_M) }),

  render({ payload, dataSource }) {
    let drawn = 0;
    for (const site of payload.icpe || []) {
      if (!Number.isFinite(site.lon) || !Number.isFinite(site.lat)) continue;
      const { color, sizePx } = icpeStyle(site);
      dataSource.entities.add({
        id: `georisques:icpe:${site.id}`,
        position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat),
        billboard: {
          // A HAZARD TRIANGLE, the one glyph in this family with a pointed
          // top — which is what carries it apart from the euro sign and the
          // DPE badge when three registers land on the same street. Severity
          // stays in the colour and the size, as before.
          image: addressMarkerGlyph('hazard'),
          width: sizePx,
          height: sizePx,
          color,
          // POSITIVE_INFINITY, not a distance. With a finite value the marker is
          // depth-tested as soon as the camera is further away than that, and
          // the terrain then eats the bottom half of every glyph — the reported
          // symptom was "the dots don't display properly", and at city zoom
          // they were rendering clipped by the ground under them. These are
          // annotations ON the world, not objects IN it.
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: {
          kind: 'icpe',
          regime: site.regime,
          seveso: site.seveso,
          distanceM: site.distanceM,
          updatedAt: site.updatedAt,
        },
        description: [
          site.address, site.commune,
          site.regime ? `Régime : ${site.regime}` : null,
          site.sevesoStatus ? `Seveso : ${site.sevesoStatus}` : null,
          site.distanceM !== null ? `${site.distanceM} m` : null,
        ].filter(Boolean).join(' · '),
        name: site.name,
      });
      drawn += 1;
    }
    return drawn;
  },

  summarize(payload) {
    const present = (list) => (list || []).filter((entry) => entry.present);
    const natural = present(payload.naturalRisks);
    const technological = present(payload.technologicalRisks);
    return {
      commune: payload.commune?.name ?? null,
      // 75056 for any Paris arrondissement — echoed as the API gives it.
      communeInsee: payload.commune?.inseeCode ?? null,
      naturalRisksPresent: natural.length,
      technologicalRisksPresent: technological.length,
      // The hazards whose verdict differs between the commune and the address:
      // the ones a reader should not generalise from.
      varyingByAddress: [...(payload.naturalRisks || []), ...(payload.technologicalRisks || [])]
        .filter((entry) => entry.variesByAddress).map((entry) => entry.id),
      radonClass: payload.radon?.class ?? null,
      icpeTotal: payload.icpeTotal ?? null,
      icpeTruncated: payload.icpeTruncated === true,
      // Which of the three upstreams answered. "No industrial site nearby" and
      // "the ICPE endpoint did not reply" must never look the same.
      available: payload.available ?? null,
      sourceUrl: payload.sourceUrl ?? null,
    };
  },
});

export default georisquesLayer;
