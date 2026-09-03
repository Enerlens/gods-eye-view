// Google 2D Map Tiles as a globe imagery stack.
//
// WHY THIS FILE EXISTS. The fork's cinematic default is Google Photorealistic
// 3D Tiles, and on an EEA billing address Google refuses to serve them: both
// `3dtiles/root.json` and `createSession mapType:satellite` answer 403
// PERMISSION_DENIED, keyed on the BILLING ADDRESS rather than on the key. The
// withdrawal is narrower than its error message suggests, though. Verified
// against the production key on 2026-09-03:
//
//   3dtiles/root.json                403 PERMISSION_DENIED
//   createSession satellite          403 PERMISSION_DENIED
//   createSession roadmap            200  -> real 256x256 PNG
//   createSession terrain            200  -> real 256x256 JPEG
//
// So Google's *cartography* is available to an EEA project even though its
// imagery is not. That is what this module ships: the Google roadmap and
// terrain basemaps, on the same key that cannot draw the 3D globe.
//
// Two details shape the design:
//
// - A 2D tile URL is invalid without a `session` token, and opening a session
//   is a POST that Cesium cannot make. The session is therefore brokered by
//   `/api/google/2d-session` (see vite.config.js) and only the tiles come
//   straight from the browser — same shape as OSM, IGN and ion.
// - Google's tiling is bit-for-bit Cesium's default `WebMercatorTilingScheme`
//   (256 px tiles, one tile at level 0), so no tiling scheme is passed here.
//   `2dtiles/{z}/{x}/{y}` maps onto Cesium's own template verbatim.

import * as Cesium from 'cesium';

const GOOGLE_2D_SESSION_URL = '/api/google/2d-session';
const GOOGLE_2D_TILE_URL = 'https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}';

// Google serves a 200 up to z=22, but the bodies collapse past z=20 (4 kB at
// 20, 1 kB at 22) and its own viewport endpoint reports maxZoom 19 for the
// world rectangle. Capping at 20 makes Cesium magnify the last real tile
// instead of billing for tiles that carry no more detail.
const GOOGLE_2D_MAX_LEVEL = 20;

// Google requires its cartography to be attributed where it is shown. This is
// the on-globe line; `/tile/v1/viewport` returns a per-region variant
// ("Données cartographiques ©2026 Google") that would have to be re-fetched on
// every camera move to stay accurate, which a static Cesium.Credit cannot do.
const GOOGLE_2D_CREDIT = 'Données cartographiques ©Google';

/**
 * Fetches (or re-uses) the brokered Map Tiles session for one stack.
 *
 * The token is shared by every visitor and valid for 14 days, so this is a
 * cache hit on the server in all but the first call after a deploy.
 * @param {string} mapType - `roadmap` or `terrain`.
 * @param {string} scale - `scaleFactor1x` or `scaleFactor2x`.
 * @returns {Promise<{session: string, tileWidth: number, tileHeight: number}>}
 */
export async function fetchGoogleTileSession(mapType, scale = 'scaleFactor1x') {
  const url = `${GOOGLE_2D_SESSION_URL}?mapType=${encodeURIComponent(mapType)}`
    + `&scale=${encodeURIComponent(scale)}`;
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.session) {
    // The proxy's message is Google's own where there is one, so the toast the
    // operator sees says whether this was a missing key, a dead billing
    // account or the regional withdrawal — not just "it failed".
    throw new Error(data.error || `Google tile session failed (HTTP ${response.status})`);
  }
  return data;
}

/**
 * Builds the imagery provider for a `google-2d` stack.
 *
 * @param {object} stack - A `google-2d` descriptor from `MAP_STACKS`.
 * @returns {Promise<Cesium.UrlTemplateImageryProvider>}
 */
export async function createGoogleMapTilesProvider(stack) {
  const { mapType, scale = 'scaleFactor1x' } = stack.google2d;
  const session = await fetchGoogleTileSession(mapType, scale);
  // The key rides in the tile URL because it is already in the bundle by
  // design (the `define` block inlines GOOGLE_MAPS_API_KEY for the 3D globe),
  // and SECURITY.md's answer to that is an HTTP-referrer restriction rather
  // than concealment. Proxying tiles to hide it would move every tile through
  // the origin for no gain the referrer restriction does not already give.
  const apiKey = import.meta.env.GOOGLE_MAPS_API_KEY;
  const url = `${GOOGLE_2D_TILE_URL}?session=${encodeURIComponent(session.session)}`
    + `&key=${encodeURIComponent(apiKey)}`;
  return new Cesium.UrlTemplateImageryProvider({
    url,
    // Google's own answer, not an assumption: scaleFactor2x sessions report
    // 512 px tiles and the provider must agree or Cesium mis-samples them.
    tileWidth: session.tileWidth,
    tileHeight: session.tileHeight,
    maximumLevel: GOOGLE_2D_MAX_LEVEL,
    credit: new Cesium.Credit(GOOGLE_2D_CREDIT, true),
  });
}
