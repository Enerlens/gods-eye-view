// Keyless worldwide satellite imagery — the base layer under IGN Ortho.
//
// WHY THIS FILE EXISTS. A keyless build has no photography outside France.
// Google's satellite is withheld from any EEA billing address (see
// src/data/googleMapTiles.js), Bing needs an ion token, and IGN stops at the
// Channel. So `ign-ortho` used to composite France's 20 cm orthophoto over a
// world of OSM *line work* — a street map showing through under a photograph,
// which reads as a rendering fault the moment the camera crosses a border.
//
// This module supplies the two keyless worldwide photographic bases that fill
// that hole, in priority order. Both were probed over the same Paris tile on
// 2026-09-08, and both answer with real JPEG and open CORS:
//
//                      z=17     z=18     z=19     z=20
//   IGN Ortho          15.4 kB  11.6 kB   9.8 kB   404
//   Esri World Imagery 16.3 kB  14.1 kB  12.2 kB  2521 B ("no data" tile)
//
// Esri and IGN cap at the SAME z=19, which is what makes the composite safe:
// the world base never outruns the French layer above it, it only continues
// past its edge.
//
// THE LICENCE SPLIT, and why there are two providers rather than one. Esri's
// terms ask for an ArcGIS subscription for production use; the anonymous
// endpoint is open and is what leaflet-providers and QGIS ship by default, but
// that is a grey area for a MIT-licensed repo other people will fork. EOX's
// Sentinel-2 cloudless is the unambiguous alternative — except that its
// licence is declared PER VINTAGE, and only two of the eleven are usable
// commercially (read from its WMTSCapabilities, 2026-09-08):
//
//   s2cloudless_3857        (2016)   CC BY 4.0
//   s2cloudless-2017_3857   (2017)   CC BY 4.0
//   s2cloudless-2018 … 2025          CC BY-NC-SA 4.0   <- NonCommercial
//
// Hence 2017 and not the sharpest year: it is the most recent vintage a MIT
// fork can hand downstream users without a NonCommercial clause riding along.

import * as Cesium from 'cesium';

// XYZ, not WMTS: Esri's MapServer `tile/{z}/{y}/{x}` endpoint is row-then-column
// and is bit-for-bit Cesium's default WebMercatorTilingScheme (256 px, one tile
// at level 0), so no tiling scheme is passed here.
const ESRI_WORLD_IMAGERY_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

// Past 19 Esri answers 200 with a constant 2521-byte "no data" placeholder
// rather than a 404 — an error budget would never notice it. Capping makes
// Cesium magnify the last real tile instead of painting that placeholder.
const ESRI_MAX_LEVEL = 19;

const ESRI_CREDIT = 'Imagerie © Esri, Maxar, Earthstar Geographics';

// EOX WMTS RESTful: /{layer}/{style}/{tileMatrixSet}/{z}/{row}/{col}.jpg. The
// `g` matrix set is GoogleMapsCompatible — verified by asking for it directly:
// level 0 returns one tile, level 1 returns four.
const S2CLOUDLESS_URL =
  'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2017_3857/default/g/{z}/{y}/{x}.jpg';

// Sentinel-2 is 10 m/px. EOX serves 200s up to 16, but the bodies collapse
// past 14 (13 kB at 14, 6 kB at 16) — that is upsampling, not detail.
const S2CLOUDLESS_MAX_LEVEL = 14;

const S2CLOUDLESS_CREDIT =
  'Sentinel-2 cloudless 2017 © EOX — Copernicus, CC BY 4.0';

/**
 * Distinct failed tiles tolerated before Esri is declared down.
 *
 * Sized against what a real outage looks like rather than against a hunch: one
 * globe view requests roughly 30–90 tiles, so a service that is actually down
 * blows through six almost immediately, while the occasional single tile lost
 * to a flaky connection never gets there. Counted per DISTINCT tile, because
 * Cesium re-raises `errorEvent` on every retry of the same one.
 */
export const WORLD_IMAGERY_FAILURE_BUDGET = 6;

/**
 * Esri World Imagery — the preferred worldwide base.
 * @returns {Cesium.UrlTemplateImageryProvider}
 */
export function createEsriWorldImageryProvider() {
  return new Cesium.UrlTemplateImageryProvider({
    url: ESRI_WORLD_IMAGERY_URL,
    maximumLevel: ESRI_MAX_LEVEL,
    credit: new Cesium.Credit(ESRI_CREDIT, true),
  });
}

/**
 * Sentinel-2 cloudless 2017 — the CC BY 4.0 fallback.
 * @returns {Cesium.UrlTemplateImageryProvider}
 */
export function createS2CloudlessProvider() {
  return new Cesium.UrlTemplateImageryProvider({
    url: S2CLOUDLESS_URL,
    maximumLevel: S2CLOUDLESS_MAX_LEVEL,
    credit: new Cesium.Credit(S2CLOUDLESS_CREDIT, true),
  });
}

/**
 * Calls `onExhausted` once the provider has failed `budget` DISTINCT tiles.
 *
 * Optimistic degradation rather than a probe: probing Esri before building the
 * layer would put a network round-trip in front of every switch to satellite,
 * to answer a question that is "yes" almost always. Watching instead costs
 * nothing on the happy path and still reacts to an outage that starts
 * mid-session, which a boot-time probe cannot do.
 *
 * @param {Cesium.ImageryProvider} provider - Provider whose `errorEvent` to watch.
 * @param {number} budget - Distinct failed tiles tolerated.
 * @param {() => void} onExhausted - Called at most once, when the budget is spent.
 * @returns {() => void} Detaches the listener.
 */
export function watchTileFailures(provider, budget, onExhausted) {
  const failed = new Set();
  let fired = false;
  const listener = (error) => {
    if (fired) return;
    // A TileProviderError carries the tile it belongs to. Anything without one
    // is a provider-level failure (a bad `layer.json`, a DNS error) and counts
    // once under its own key rather than being dropped.
    const key = error && error.level != null
      ? `${error.level}/${error.x}/${error.y}`
      : 'provider';
    failed.add(key);
    if (failed.size < budget) return;
    fired = true;
    onExhausted();
  };
  provider.errorEvent.addEventListener(listener);
  return () => provider.errorEvent.removeEventListener(listener);
}
