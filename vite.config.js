/**
 * Vite configuration for God's Eye View — a cinematic geospatial app.
 *
 * Registers the dev-server proxy middlewares that bypass CORS and add
 * caching/auth for upstream APIs:
 *   1. OpenSky  — aircraft state vectors (OAuth / Basic / anon)
 *   2. CelesTrak — satellite TLE orbital elements
 *   3. Overpass  — OpenStreetMap road geometry queries
 *   4. GBFS     — bike-share station feeds
 *   5. CCTV     — traffic-camera frames, media streams, and fallback SVG
 *   6. adsb.lol — military aircraft tracking
 *   7. AIS live — AISStream websocket-backed live vessel positions
 *   8. Terrain heights — Re:Earth keyless point-height lookups (ellipsoidal ground)
 *   9. TomTom   — live traffic-flow vector tiles (budget-governed, keyless-degradable)
 *  10. NASA FIRMS — live active-fire detections (VIIRS ×3, trailing 24 h)
 *  11. Military-installation context — bounded, cached OpenStreetMap features
 *  11b. OSM mapped cameras — viewport-bounded, cached camera positions (opt-in)
 *  12. Regional briefing — cached place, weather, and recent location-matched news
 *  13. Weather effects — camera-local Open-Meteo observations without news/geocoding overhead
 *  14. Rocket launches — recent Launch Library 2 mission metadata
 *  15. Radio Browser — public-domain station directory and click counting
 *  16. transport.data.gouv.fr — French GTFS-RT live vehicle positions (PAN)
 *  17. transport.data.gouv.fr — French shared mobility (GBFS: bikes, scooters, cars)
 *  18. ODRÉ éCO2mix — French live electricity mix, national + 12 regions
 *  19. ODRÉ gas system — NaTran/Teréga transmission traces, gas power stations, biomethane injection
 *  20. Power grid — viewport-bounded OpenStreetMap high-voltage lines, substations and pylons
 *  21. Bison Futé DATEX II — live status, flow and speed on the French national road network
 *  22. Bison Futé Événementiel-DIR — the road events the DIRs declare on that same network
 *      (accidents, closures, roadworks, diversions)
 *  23. transport.data.gouv.fr / ODRÉ — French EV charge points (IRVE): per viewport,
 *      per département, and the thinned national mesh between the two
 *  24. IGN Api Carto — French cadastral parcels (PCI vecteur) joined to the scale
 *      of the sheet each one was drawn on
 *
 * Also exposes Cesium and Google 3D Tiles API keys to the
 * client via `import.meta.env.*` defines.
 *
 * @module vite.config
 */

import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import https from 'node:https';
import { lookup as lookupDns } from 'node:dns/promises';
import { directionToHeading } from './src/data/directionText.js';
import {
  osmCameraBboxQuery,
  osmCameraBoxKey,
  osmCameraFromElement,
  snapOsmCameraBox,
  validOsmCameraBox,
  OSM_CAMERA_MAX_BOX_DEG,
  OSM_CAMERA_QUERY_CAP,
} from './src/data/osmCameras.js';
import {
  isValidTileCoord as isValidTomTomTile,
  utcDayKey as tomtomUtcDayKey,
  normalizeBudget as normalizeTomTomBudget,
  isOverBudget as isTomTomOverBudget,
} from './src/data/tomtomTiles.js';
import {
  QTV_MEASUREMENTS_URL,
  ROAD_STATUS_MAX_BOX_DEG,
  ROAD_STATUS_MAX_SEGMENTS,
  TRAFICOLOR_INDEX_URL,
  agglomerationLabel,
  latestPublicationFile,
  parseIndexDirectories,
  parseQtvMeasurements,
  parseTraficolorStatuses,
  segmentIntersectsBox,
  validRoadStatusBox,
  worseRoadStatus,
} from './src/data/datexRoadStatus.js';
import { filterTrailing24h, parseFirmsCsv } from './src/data/firmsCsv.js';
import { projectVigicruesFeed } from './src/data/vigicruesFeed.js';
import { projectVigilanceProduct } from './src/data/meteoFranceVigilanceFeed.js';
import { projectEco2mix } from './src/data/eco2mixFeed.js';
import { projectGasNetwork, projectGasSites } from './src/data/gasFranceFeed.js';
import { EDF_DATASETS, projectEdfPlants } from './src/data/edfPlantsFeed.js';
import { projectRoadEvents } from './src/data/bisonFuteFeed.js';
import {
  indexCarriagewayPack,
  traceBetweenPr,
} from './scripts/lib/rrnCarriageway.mjs';
import { simplifyPolyline, CENTRELINE_SIMPLIFY_M } from './scripts/lib/rrnCentreline.mjs';
import { lambert93ToWgs84 } from './scripts/lib/lambert93.mjs';
import {
  powerGridBoxKey,
  powerGridIncludesTowers,
  powerGridQuery,
  projectPowerGrid,
  snapPowerGridBox,
  validPowerGridBox,
  POWER_GRID_MAX_BOX_DEG,
} from './src/data/powerGridFeed.js';
import {
  RTE_ACTUAL_GENERATIONS_PER_UNIT_URL,
  RTE_TOKEN_URL,
  projectActualGenerations,
  rteGenerationWindow,
} from './src/data/rteGenerationFeed.js';
// Address-scan feed projections. Each module is pure and unit-tested against a
// captured upstream response; the proxies below are the only importers.
import {
  buildGeorisquesUrls,
  clampRadius as clampGeorisquesRadius,
  projectGeorisques,
} from './src/data/georisquesFeed.js';
import {
  DVF_FIRST_YEAR,
  buildDvfUrl,
  clampDvfRadius,
  groupMutations,
  parseDvfCsv,
  selectNearbySales,
} from './src/data/dvfFeed.js';
import { buildDpeUrl, clampDpeRadius, projectDpe } from './src/data/dpeFeed.js';
import {
  buildIsochroneUrl,
  clampSeconds as clampIsochroneSeconds,
  projectIsochrone,
  resolveProfile as resolveIsochroneProfile,
} from './src/data/isochroneFeed.js';
import {
  GPU_BOX_STEP_DEG,
  GPU_REQUEST_MAX_BOX_DEG,
  GPU_UPSTREAM_LIMIT,
  buildGpuBoxUrl,
  buildGpuUrl,
  gpuTruncation,
  projectGeometry,
  projectGpu,
} from './src/data/gpuFeed.js';
import {
  IDFM_PAGE_LIMIT,
  buildLinesUrl,
  buildStopsBboxUrl,
  buildStopsRadiusUrl,
  projectLines,
  projectStops,
} from './src/data/idfmFeed.js';
import {
  alertIsActive,
  alertsFromBytes,
  boundsOfVehicles,
  tripUpdatesFromBytes,
  vehiclePositionsFromBytes,
} from './src/data/gtfsRealtime.js';
import { boundsOfPoints, boxKey, boxesIntersect, snapBoxOutward, validBox } from './src/data/viewportBox.js';
import { buildDepartementIndex } from './src/data/franceDepartements.js';
import {
  projectIrveDepartements,
  sweepStripeTruncated,
  IRVE_SWEEP_FIELDS,
  IRVE_SWEEP_LIMIT,
  IRVE_SWEEP_MIN_SPAN_DEG,
  IRVE_SWEEP_SEED_SPAN_DEG,
} from './src/data/irveDepartements.js';
import {
  irveBboxWhere,
  projectIrveSites,
  IRVE_BAND_KEYS,
  IRVE_BOX_STEP_DEG,
  IRVE_DATASET,
  IRVE_GROUP_FIELDS,
  IRVE_GROUP_LIMIT,
  IRVE_MAX_BOX_DEG,
  IRVE_SOURCE,
} from './src/data/irveFeed.js';
import {
  projectCadastreParcels,
  CADASTRE_API_BASE,
  CADASTRE_BOX_STEP_DEG,
  CADASTRE_DATASET_PAGE,
  CADASTRE_LICENCE,
  CADASTRE_MAX_BOX_DEG,
  CADASTRE_REQUEST_MAX_BOX_DEG,
  CADASTRE_SOURCE,
  CADASTRE_UPSTREAM_LIMIT,
} from './src/data/cadastreFeed.js';
import {
  SCHOOLS_BOX_STEP_DEG,
  SCHOOLS_DATASET,
  SCHOOLS_MAX_BOX_DEG,
  SCHOOLS_OPEN_WHERE,
  SCHOOLS_PORTAL,
  SCHOOLS_ROLL_DATASETS,
  SCHOOLS_ROLL_YEAR,
  SCHOOLS_SITE_FIELDS,
  SCHOOLS_SOURCE,
  SCHOOL_LEVELS,
  projectSchoolSites,
  schoolsBboxWhere,
} from './src/data/schoolsFeed.js';
import {
  SCHOOLS_SWEEP_FIELDS,
  projectSchoolsDepartements,
} from './src/data/schoolsDepartements.js';
import {
  SUP_ATLAS_FIELDS,
  SUP_DATASET,
  SUP_OFFER_DATASET,
  SUP_OFFER_FIELDS,
  SUP_PORTAL,
  SUP_RENTREE_FLOOR,
  SUP_SESSION_FLOOR,
  SUP_SOURCE,
  indexSupOffers,
  newestYear,
  projectSupSites,
  supAtlasWhere,
  supOfferWhere,
} from './src/data/supFeed.js';
import {
  COMPTAGES_BARRE_GROUP_BY,
  COMPTAGES_DATASET,
  COMPTAGES_GROUP_LIMIT,
  COMPTAGES_HOUR_BLOCKS,
  COMPTAGES_PORTAL,
  COMPTAGES_PROFILE_GROUP_BY,
  COMPTAGES_PROFILE_SELECT,
  COMPTAGES_SOURCE,
  COMPTAGES_WEEK_FLOOR,
  comptagesStampWhere,
  comptagesWeekWindows,
  comptagesWindowWhere,
  newestComptagesWeek,
  projectComptagesArcs,
} from './src/data/comptagesFeed.js';
import {
  DELINQUANCE_ATTRIBUTION,
  DELINQUANCE_DATASET,
  DELINQUANCE_DATASET_URL,
  DELINQUANCE_LICENCE,
  DELINQUANCE_SOURCE,
  DELINQUANCE_YEAR_FLOOR,
  createCommuneFold,
  delinquanceContoursUrl,
  joinCommuneCells,
  newestDelinquanceYear,
  parseSsmsiCsv,
  pickDelinquanceResources,
  projectCommuneContours,
  projectDelinquanceDepartements,
  selectDelinquanceChips,
} from './src/data/delinquanceFeed.js';
// Add to the top import block of vite.config.js, beside the other src/data feed
// imports. Nothing else is needed: this proxy reuses `makeRateLimiter`,
// `clientKey`, `readResponseJsonCapped`, `coalesceProxyRequest`,
// `installAddressRoute`, `addressPoint` and `addressCacheKey`, all already
// defined in the file.
import {
  BRUIT_SOURCE,
  buildBruitProbeUrl,
  projectBruit,
} from './src/data/bruitFeed.js';
import {
  BRUIT_ARRETE_FLOOR,
  BRUIT_NEAREST_MAX_KM,
  buildPebArreteIndexUrl,
  nearestArrete,
  projectPebArretes,
} from './src/data/bruitArretes.js';
import {
  IDFM_FREQ_BAND_WINDOWS,
  IDFM_FREQ_BOX_STEP_DEG,
  IDFM_FREQ_DATASET,
  IDFM_FREQ_EDITION_FLOOR,
  IDFM_FREQ_MAX_BOX_DEG,
  IDFM_FREQ_MAX_STOPS,
  IDFM_FREQ_PORTAL,
  IDFM_FREQ_SOURCE,
  buildIdentityUrl,
  buildMetadataUrl,
  buildProfileUrl,
  buildRegionBandsUrl,
  buildRegionStopsUrl,
  newestEdition,
  projectFrequencyStops,
} from './src/data/idfmFrequencyFeed.js';
import {
  IDFM_FREQ_BUCKETS,
  foldFrequencyRegion,
} from './src/data/idfmFrequencyDepartements.js';

import {
  SITADEL_DATASET_PAGE,
  SITADEL_DEMOLITION_COLUMNS,
  SITADEL_DEMOLITION_RID,
  SITADEL_DEMOLITION_TITLE,
  SITADEL_DIDO_BASE,
  SITADEL_DIDO_DATASET,
  SITADEL_HOUSING_COLUMNS,
  SITADEL_HOUSING_RID,
  SITADEL_HOUSING_TITLE,
  SITADEL_LICENCE,
  SITADEL_MILLESIME_FLOOR,
  SITADEL_SOURCE,
  cadastreCommuneUrl,
  communeCadastreCodes,
  discoverSitadelRid,
  geoCommuneUrl,
  indexCadastreParcels,
  newestCadastreEdition,
  newestMillesime,
  projectSitadelCommune,
  sitadelDatafileUrl,
} from './src/data/sitadelFeed.js';
import {
  FRAICHEUR_COVERAGE,
  FRAICHEUR_EQUIPMENT_DATASET,
  FRAICHEUR_EQUIPMENT_FIELDS,
  FRAICHEUR_FOUNTAIN_DATASET,
  FRAICHEUR_FOUNTAIN_FIELDS,
  FRAICHEUR_LICENCE,
  FRAICHEUR_LICENCE_URL,
  FRAICHEUR_PORTAL,
  FRAICHEUR_PUBLISHERS,
  FRAICHEUR_SOURCE,
  FRAICHEUR_SPACES_DATASET,
  FRAICHEUR_SPACE_FIELDS,
  projectFraicheurRefuges,
} from './src/data/fraicheurFeed.js';
import {
  FRAICHEUR_TREE_BOX_STEP_DEG,
  FRAICHEUR_TREE_BUDGET,
  FRAICHEUR_TREE_DATASET,
  FRAICHEUR_TREE_FIELDS,
  FRAICHEUR_TREE_REQUEST_MAX_BOX_DEG,
  FRAICHEUR_TREE_SOURCE,
  fraicheurTreeWhere,
  projectFraicheurTrees,
} from './src/data/fraicheurTrees.js';
import {
  ANFR_CATALOGUE_URL,
  ANFR_DAS_DATASET,
  ANFR_DAS_FIELDS,
  ANFR_DAS_RESOURCE_ID,
  ANFR_DATASET,
  ANFR_EXPOSURE_RADIUS_M,
  ANFR_HAUT,
  ANFR_ID,
  ANFR_LAT,
  ANFR_LIVE,
  ANFR_LON,
  ANFR_NAT,
  ANFR_OPS,
  ANFR_PLAN,
  ANFR_PORTAL,
  ANFR_REF_MEMBER,
  ANFR_REF_ZIP_URL,
  ANFR_SOURCE,
  ANFR_SVC,
  ANFR_SYS,
  CARTORADIO_BASE,
  anfrCsvColumns,
  anfrDecodeMask,
  anfrExposureBbox,
  parseAnfrNatureTable,
  pickAnfrObservatoire,
  projectAnfrDas,
  projectAnfrSupports,
  projectCartoradioAntennas,
  projectCartoradioExposure,
  projectCartoradioSupport,
  readAnfrCsvRow,
} from './src/data/anfrFeed.js';
import { buildAnfrMesh } from './src/data/anfrMesh.js';
import { readZipMember } from './scripts/lib/remoteZip.mjs';
import { delinquanceRateBins } from './src/data/delinquanceDepartements.js';
import { projectSupDepartements } from './src/data/supDepartements.js';
import {
  gbfsBoxKey,
  gbfsBoxContains,
  mergeGbfsBounds,
  padGbfsBox,
  parseGbfsStationStatus,
  parseGbfsStations,
  parseGbfsVehicles,
  selectSystemsForBox,
  snapGbfsBox,
  systemDrawsStations,
  validGbfsBox,
  vehicleKindLookup,
  GBFS_MAX_BOX_DEG,
  GBFS_MAX_OBJECTS,
} from './src/data/gbfsFeeds.js';
import {
  boxContains,
  mergeObservedBounds,
  padTransitBox,
  selectFeedsForBox,
  snapTransitBox,
  transitBoxKey,
  validTransitBox,
  PAN_DATASETS_URL,
  PAN_MAX_BOX_DEG,
  PAN_MAX_FEEDS_PER_REQUEST,
  PAN_MAX_VEHICLES,
} from './src/data/panFeeds.js';
import { partitionFeedsByHealth } from './src/data/panFeedHealth.js';
import { resolveVehicleKind } from './src/data/transitVehicleKind.js';
import {
  chooseTripShape,
  indexGtfsGeoJson,
  pathLengthMeters,
} from './src/data/transitRouteShape.js';
import {
  alertForVehicle,
  alertWireRecord,
  indexAlerts,
  indexTripUpdates,
  scheduleForVehicle,
  summarizeSchedule,
} from './src/data/transitSchedule.js';
import {
  filterFreshObservations,
  parseNdbcLatestObservations,
  summarizeObservations,
} from './src/data/ndbcObservations.js';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { defineConfig, loadEnv } from 'vite';
import cesium from 'vite-plugin-cesium';
import { normalizeRadioCountryInput } from './src/data/radioCountry.js';
import {
  normalizeRegionalArticles,
  normalizeRegionalPlace,
  normalizeRegionalWeather,
} from './src/data/regionalBrief.js';
import { normalizeAdsbLolPointResponse } from './src/data/adsbLolFallback.js';
import { createAisStreamAdapter, isRecognizedAisEnvelope } from './src/data/aisStreamAdapter.js';
import { parseSilenceTimeoutEnv } from './src/data/aisWatchdog.js';
import {
  fetchTerrainChunkWithRetry,
  parseTerrainPoints,
  resolveTerrainHeightRequest,
  terrainPointKey,
  validTerrainResult,
} from './src/data/terrainHeightsProxy.js';
import { VOICE_MODELS, isKnownVoiceTier, resolveVoiceModel } from './src/voice/voiceCost.js';

/** Resolve __dirname for ESM context. */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// OpenSky OAuth2 token + response cache state
// ---------------------------------------------------------------------------
/** @type {string|null} Current OAuth2 bearer token. */
let _openskyToken = null;
/** @type {number} Epoch-ms when the current token expires. */
let _openskyTokenExpiry = 0;
/** @type {Promise<string|null>|null} In-flight token refresh promise (coalesces concurrent callers). */
let _openskyTokenPromise = null;
/** @type {string|null} Cached upstream response body (JSON text). */
let _openskyCacheBody = null;
/** @type {number} HTTP status of the cached response. */
let _openskyCacheStatus = 0;
/** @type {number} Epoch-ms when the response was cached. */
let _openskyCacheTime = 0;
/** @type {{requestedMode:string,usedMode:string,reason:string}|null} Auth metadata for the cached response. */
let _openskyCacheMeta = null;
/** @type {number|null} Source snapshot epoch from the cached OpenSky body. */
let _openskyCacheSourceEpochMs = null;
/** TTL for the OpenSky response cache (ms). */
const OPENSKY_CACHE_MS = 9000;
// --- OpenSky credit governor (field-test fix 2026-07-06) -------------------
// The global /states/all this proxy fetches costs 4 CREDITS per call against
// OpenSky's ~4000/day authenticated budget — a day with the app open burned
// the whole quota in ~8h and the layer then hard-died until the daily reset
// ("rate limited for 48h" owner report; auth itself was fine). Three levers:
//  1. Adaptive TTL: OpenSky returns X-Rate-Limit-Remaining on success; as the
//     budget thins, the proxy stretches its cache TTL so a full day of
//     continuous use never exhausts it.
//  2. 429 cooldown: honor X-Rate-Limit-Retry-After-Seconds — no upstream
//     attempts until it passes (bounded 30 s … 30 min).
//  3. Serve-stale: while rate-limited/cooling, serve the last-good body (200 +
//     X-OpenSky-Stale) so the layer keeps rendering instead of dying.
/** @type {number} Current adaptive TTL (ms) — starts at the base cache TTL. */
let _openskyTtlMs = OPENSKY_CACHE_MS;
/** @type {number} Epoch-ms before which no upstream fetch is attempted. */
let _openskyCooldownUntil = 0;
/**
 * Picks the cache TTL from the remaining daily credit budget.
 * Client polls every 30 s, so tiers ≤30 s cost the same 480 credits/h; the
 * later tiers stretch the day: >2400 → ~3 h of full freshness, then 30 s
 * (~2.5 h), 90 s (~5 h), 300 s (~8 h) ≈ 18+ h of continuous use per day.
 * @param {number} remaining - X-Rate-Limit-Remaining header value.
 * @returns {number} TTL in ms.
 */
function openskyAdaptiveTtlMs(remaining) {
  if (!Number.isFinite(remaining)) return OPENSKY_CACHE_MS;
  if (remaining > 2400) return OPENSKY_CACHE_MS;
  if (remaining > 1200) return 30_000;
  if (remaining > 400) return 90_000;
  return 300_000;
}
/** @type {boolean} Guards duplicate auth-failure warnings in logs. */
let _openskyAuthWarned = false;
/** @type {boolean} Guards duplicate invalid-auth-mode warnings. */
let _openskyAuthModeWarned = false;
/** Default auth mode when OPENSKY_AUTH_MODE env is unset. */
const OPENSKY_AUTH_MODE_DEFAULT = 'oauth';
/** Set of valid OPENSKY_AUTH_MODE values. */
const OPENSKY_AUTH_MODE_SET = new Set(['basic', 'oauth', 'auto', 'anon']);
/** Regional civilian fallback cache, keyed by a coarse 0.25° view anchor. */
const _adsbLolPointCache = new Map();
/** Per-anchor single-flight map for concurrent regional fallback requests. */
const _adsbLolPointInFlight = new Map();
const ADSBLOL_POINT_CACHE_MS = 12000;
const ADSBLOL_POINT_CACHE_MAX = 80;
const ADSBLOL_POINT_RADIUS_NM = 250;
const ADSBLOL_POINT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
// A 200 response can still contain an old OpenSky snapshot. Past this point
// the viewport-scoped adsb.lol source is more honest and keeps local motion
// current instead of coasting a stale worldwide frame indefinitely.
const OPENSKY_SOURCE_STALE_MS = 120_000;
// ---------------------------------------------------------------------------
// Overpass API proxy constants and cache state
// ---------------------------------------------------------------------------
/** Ordered list of Overpass API mirrors; tried sequentially on failure/rate-limit. */
const OVERPASS_UPSTREAMS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  // Community full-planet instance (privateforge nonprofit) — added 2026-07-30
  // when all three mirrors above refused this IP (likely a dev-traffic rate
  // ban; refused connections fail in ms, so healthy mirrors above still win).
  // Verified: planet coverage (Texas query), CORS *, ~5-20 s cold latency.
  'https://overpass.private.coffee/api/interpreter',
];
/**
 * Agent string for every Overpass request.
 *
 * The OSM convention is `app/version (+contact)`, and it is not decorative:
 * overpass-api.de scores requests for abuse at its Apache front-end and answers
 * a bare `406 Not Acceptable` to the ones it dislikes. Measured 2026-09-01 from
 * one dev machine, same query, interleaved to control for server load: the old
 * `gods-eye-view-overpass-proxy/1.0` drew 406 on 8 of 11 attempts, this string
 * on 0 of 11. The rotation fix below is what makes a 406 survivable; this is
 * what makes it rare, and it gives the operators someone to contact instead of
 * an anonymous robot to ban.
 */
const OVERPASS_USER_AGENT = 'gods-eye-view/1.0 (+https://github.com/bilawalsidhu/gods-eye-view)';
/**
 * TTL for FRESH cached Overpass responses (ms). Road geometry is static for
 * months — the original 45 s TTL forced a public-mirror round-trip on nearly
 * every viewport revisit and left nothing to serve when the mirrors 502
 * (field-test 2026-07-17: all three mirrors down during US morning peak =
 * "traffic takes forever to load"). 24 h in memory; the disk layer below
 * keeps 7 days and also survives dev-server restarts.
 */
const OVERPASS_CACHE_MS = 86_400_000;
/** Disk-cache TTL for Overpass responses (ms) — 7 days. */
const OVERPASS_DISK_TTL_MS = 7 * 86_400_000;
/**
 * Disk-cache TTL for BOUNDARY-class queries (is_in / admin-relation pivots) — 30
 * days. Admin boundaries change ≈never, and their pivots are the most expensive
 * queries the app issues (multi-MB coastline geometry, 10–25 s on public mirrors —
 * field test 2026-07-23: outline latency + the Sicily miss). Keeping them a month
 * means each boundary is fetched roughly once per machine, ever.
 */
const OVERPASS_BOUNDARY_DISK_TTL_MS = 30 * 86_400_000;
/** Disk-cache directory for Overpass responses. */
const OVERPASS_DISK_DIR = path.join(process.cwd(), '.gev-cache', 'overpass');
/** Per-upstream fetch timeout (ms). */
const OVERPASS_TIMEOUT_MS = 22000;
/** Max entries in the Overpass response cache (LRU-like, oldest evicted first). */
const OVERPASS_CACHE_MAX_ENTRIES = 120;
/** @type {Map<string,{status:number,body:string,contentType:string,endpoint:string,cachedAt:number}>} */
const _overpassCache = new Map();
/** @type {Map<string,Promise>} In-flight Overpass requests keyed by normalized query body. */
const _overpassInFlight = new Map();

/**
 * Whether a normalized Overpass query is BOUNDARY-class (admin `is_in` lookups
 * and area→relation pivots) — the static, expensive geometry that earns the
 * 30-day disk TTL. The enclosing-compound sweep and road fetches keep the
 * default TTL. Exported for tests.
 */
export function isOverpassBoundaryQuery(cacheKey) {
  return /is_in\s*\(|\bpivot\b/i.test(String(cacheKey || ''));
}

/** Disk TTL for a query: boundary geometry keeps for a month, the rest 7 days. */
function overpassDiskTtlMs(cacheKey) {
  return isOverpassBoundaryQuery(cacheKey) ? OVERPASS_BOUNDARY_DISK_TTL_MS : OVERPASS_DISK_TTL_MS;
}

/** Iterative Douglas-Peucker on [{lat,lon},...] (planar-degree approx — fine at
 *  the ~44 m tolerance used here). Endpoints always kept. */
function douglasPeucker(points, toleranceDeg) {
  const n = points.length;
  if (n <= 2) return points;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const ax = points[a].lon;
    const ay = points[a].lat;
    const vx = points[b].lon - ax;
    const vy = points[b].lat - ay;
    const c2 = vx * vx + vy * vy;
    let worst = -1;
    let worstDist = toleranceDeg;
    for (let i = a + 1; i < b; i++) {
      const wx = points[i].lon - ax;
      const wy = points[i].lat - ay;
      let d;
      if (c2 === 0) {
        d = Math.hypot(wx, wy);
      } else {
        const t = Math.max(0, Math.min(1, (vx * wx + vy * wy) / c2));
        d = Math.hypot(wx - t * vx, wy - t * vy);
      }
      if (d > worstDist) {
        worstDist = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/** Simplify one element's geometry array in place if it is big enough. */
function simplifyElementGeometry(el, minPoints, toleranceDeg) {
  if (Array.isArray(el?.geometry) && el.geometry.length >= minPoints) {
    el.geometry = douglasPeucker(el.geometry, toleranceDeg);
  }
  if (Array.isArray(el?.members)) {
    for (const member of el.members) {
      if (Array.isArray(member?.geometry) && member.geometry.length >= minPoints) {
        member.geometry = douglasPeucker(member.geometry, toleranceDeg);
      }
    }
  }
}

/**
 * Server-side geometry simplification for large Overpass `out geom` payloads.
 * Region/state boundary pivots return multi-MB coastline rings whose fidelity
 * nothing downstream needs (the client re-simplifies for draw); decimating them
 * HERE shrinks the disk cache, the wire, and client parse time — and is what
 * makes the raised read cap safe. Anything unparseable or below the thresholds
 * passes through byte-identical. Exported for tests (opts override thresholds).
 *
 * @param {string} bodyText - Raw upstream JSON body.
 * @returns {string} Possibly-simplified JSON body.
 */
export function simplifyOverpassPayloadBody(bodyText, opts = {}) {
  const minBytes = opts.minBytes ?? OVERPASS_SIMPLIFY_MIN_BYTES;
  const minPoints = opts.minPoints ?? OVERPASS_SIMPLIFY_MIN_POINTS;
  const toleranceDeg = opts.toleranceDeg ?? OVERPASS_SIMPLIFY_TOLERANCE_DEG;
  if (typeof bodyText !== 'string' || bodyText.length < minBytes) return bodyText;
  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
  if (!Array.isArray(data?.elements)) return bodyText;
  for (const el of data.elements) simplifyElementGeometry(el, minPoints, toleranceDeg);
  try {
    return JSON.stringify(data);
  } catch {
    return bodyText;
  }
}

/** Normalized Overpass query -> stable disk-cache file path. */
function overpassDiskPath(cacheKey) {
  return path.join(OVERPASS_DISK_DIR, `${createHash('sha1').update(cacheKey).digest('hex')}.json`);
}

/**
 * Read a disk-cached Overpass payload. maxAgeMs Infinity = any age (the
 * serve-stale path when every mirror is down).
 * @returns {Promise<?Object>} Payload with cachedAt, or null.
 */
async function readOverpassDisk(cacheKey, maxAgeMs) {
  try {
    const raw = await fsp.readFile(overpassDiskPath(cacheKey), 'utf8');
    const payload = JSON.parse(raw);
    if (!payload || typeof payload.body !== 'string' || !Number.isFinite(payload.cachedAt)) return null;
    if (Date.now() - payload.cachedAt > maxAgeMs) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Fire-and-forget disk write for a successful Overpass payload. */
function writeOverpassDisk(cacheKey, payload) {
  fsp.mkdir(OVERPASS_DISK_DIR, { recursive: true })
    .then(() => fsp.writeFile(overpassDiskPath(cacheKey), JSON.stringify(payload)))
    .catch((err) => console.warn('[Overpass Proxy] disk cache write failed:', err?.message || err));
}

/**
 * Resolve every cache/coalescing layer before admitting a request to the local
 * upstream rate limiter. The injected limiter callback is invoked exactly once
 * for a complete cache miss and never for memory, in-flight, or disk hits.
 * Exported so the admission ordering can be tested without a Vite server.
 *
 * @param {object} options
 * @param {string} options.cacheKey
 * @param {Map<string, object>} options.memoryCache
 * @param {Map<string, Promise<object>>} options.inFlight
 * @param {()=>Promise<object|null>} options.readDisk
 * @param {()=>boolean} options.allowUpstream
 * @param {number} [options.now]
 * @param {number} [options.cacheMs]
 * @returns {Promise<{source:'HIT'|'INFLIGHT'|'DISK'|'UPSTREAM'|'RATE_LIMITED', payload:object|null}>}
 */
export async function resolveOverpassPreflight({
  cacheKey,
  memoryCache,
  inFlight,
  readDisk,
  allowUpstream,
  now = Date.now(),
  cacheMs = OVERPASS_CACHE_MS,
}) {
  const cached = memoryCache.get(cacheKey);
  if (cached && now - cached.cachedAt <= cacheMs) return { source: 'HIT', payload: cached };

  const pending = inFlight.get(cacheKey);
  if (pending) return { source: 'INFLIGHT', payload: await pending };

  const disk = await readDisk();
  if (disk) return { source: 'DISK', payload: disk };

  return allowUpstream()
    ? { source: 'UPSTREAM', payload: null }
    : { source: 'RATE_LIMITED', payload: null };
}
/** OSM routing (FOSSGIS OSRM) cache: profile|coords -> { payload, cachedAt }. */
const ROUTE_CACHE_MS = 600000;
const _routeCache = new Map();

// --- Abuse guards shared by the Overpass + route proxies --------------------
/** Max accepted POST body for the Overpass proxy (Overpass QL queries are tiny). */
const OVERPASS_MAX_BODY_BYTES = 24 * 1024; // 24 KB
/**
 * Hard cap on a single Overpass upstream response we will buffer into memory.
 * 32 MB (was 12 MB): a dense island/state admin boundary at full `out geom`
 * fidelity — Sicilia's Mediterranean coastline — can exceed 12 MB, and clipping
 * it read as a permanent "transient" failure (field test 2026-07-23, Sicily
 * never traced). The buffered payload is SIMPLIFIED server-side before it is
 * cached or sent (simplifyOverpassPayloadBody), so the raised cap does not
 * raise what clients receive or what the disk stores.
 */
const OVERPASS_MAX_RESPONSE_BYTES = 32 * 1024 * 1024; // 32 MB
/** Only payloads at least this large go through geometry simplification. */
const OVERPASS_SIMPLIFY_MIN_BYTES = 1_500_000;
/** Only per-element geometry arrays with at least this many points are simplified. */
const OVERPASS_SIMPLIFY_MIN_POINTS = 1200;
/**
 * Douglas-Peucker tolerance (degrees, ≈44 m of latitude). Region/state boundary
 * rings are drawn at regional camera scale and the client simplifies again for
 * draw, so ~44 m fidelity is invisible; building footprints never reach the
 * point threshold above and pass through untouched.
 */
const OVERPASS_SIMPLIFY_TOLERANCE_DEG = 0.0004;
/** Max concurrent in-flight upstream Overpass fetches across all distinct queries. */
const OVERPASS_MAX_CONCURRENT = 6;
let _overpassConcurrent = 0;
/** Hard cap on the OSRM route response we will buffer. */
const ROUTE_MAX_RESPONSE_BYTES = 8 * 1024 * 1024; // 8 MB
/** Reject routes whose straight-line spans are obviously abusive (km). */
const ROUTE_MAX_LEG_KM = 600;
const ROUTE_MAX_TOTAL_KM = 2500;

/**
 * Minimal fixed-window per-key rate limiter for the dev proxies. Not a hard
 * security boundary (dev-only), just a backstop so a runaway client can't hammer
 * the public Overpass / OSRM mirrors or exhaust this process.
 */
const RATE_LIMITER_MAX_KEYS = 2000;
function makeRateLimiter({ windowMs, max, globalMax }) {
  const hits = new Map(); // key -> number[] (timestamps within window)
  let globalTimes = []; // all hits in window, for the global backstop
  return function allow(key) {
    const now = Date.now();
    globalTimes = globalTimes.filter((t) => now - t < windowMs);
    if (globalMax && globalTimes.length >= globalMax) return false; // global backstop
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) { hits.set(key, recent); return false; }
    recent.push(now);
    hits.set(key, recent);
    globalTimes.push(now);
    // Hard key cap so a key-rotating caller can't grow the map without bound.
    if (hits.size > RATE_LIMITER_MAX_KEYS) {
      const oldest = hits.keys().next().value;
      if (oldest !== undefined) hits.delete(oldest);
    }
    if (hits.size > 256) {
      for (const [k, v] of hits) {
        if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
      }
    }
    return true;
  };
}
const _overpassRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 90, globalMax: 300 });
const _militaryInstallationsRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 90, globalMax: 300 });
const _routeRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 200 });

/**
 * Opt-in per-IP rate limiter for the cost-bearing API proxies (OpenAI / Google).
 * DEFAULT IS UNLIMITED: when the env var is unset, `0`, or non-numeric, this
 * returns `null` and the caller skips the check entirely — a runtime no-op that
 * preserves the original behavior. Only a positive integer N enables a fixed
 * 60s window of N requests/IP (built lazily once, then reused so its per-IP
 * window state persists across requests). The global backstop is set to a
 * generous multiple of the per-IP cap so a single host can't starve the rest.
 *
 * @param {string|undefined} envValue - Raw env value (requests/min/IP).
 * @returns {((key:string)=>boolean)|null} An `allow(key)` fn, or null when unlimited.
 */
function makeOptInRateLimiter(envValue) {
  const max = Number(envValue);
  if (!Number.isFinite(max) || max <= 0) return null; // unset/0/garbage -> unlimited
  return makeRateLimiter({ windowMs: 60_000, max: Math.floor(max), globalMax: Math.floor(max) * 20 });
}
// Built LAZILY on first request, NOT at module load: `.env` values are applied to process.env later
// (the plugin config hook calls loadEnv → process.env, AFTER this module is imported), so reading
// process.env here at import time would always see them unset and silently stay unlimited even when
// configured via .env. Building on first request (like the OPENAI_API_KEY reads) sees the loaded env;
// the result is cached so the limiter's per-IP window state persists. `null` = unlimited (default).
let _openAiRateLimiter; // undefined = not built yet; null = unlimited; fn = active limiter
let _googleRateLimiter;
/** OpenAI cost endpoints (realtime/token + hud-summary). Null = unlimited (default). */
function openAiRateLimiter() {
  if (_openAiRateLimiter === undefined) _openAiRateLimiter = makeOptInRateLimiter(process.env.GEV_RATELIMIT_OPENAI_PER_MIN);
  return _openAiRateLimiter;
}
/** Google cost endpoint (nearby-places). Null = unlimited (default). */
function googleRateLimiter() {
  if (_googleRateLimiter === undefined) _googleRateLimiter = makeOptInRateLimiter(process.env.GEV_RATELIMIT_GOOGLE_PER_MIN);
  return _googleRateLimiter;
}

/**
 * Apply an opt-in limiter to a request, writing a 429 when over the cap.
 * When `limiter` is null (unlimited, the default) this is a no-op returning
 * `true`, so the handler proceeds exactly as before.
 *
 * @param {((key:string)=>boolean)|null} limiter
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {boolean} True if the request may proceed; false if a 429 was sent.
 */
function enforceOptInRateLimit(limiter, req, res) {
  if (!limiter) return true; // unlimited (default) — no behavior change
  if (limiter(clientKey(req))) return true;
  res.statusCode = 429;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Retry-After', '5');
  res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
  return false;
}

/**
 * Client key for rate limiting. Uses the real socket peer address only — we do
 * NOT trust X-Forwarded-For (client-controlled; a rotating value would mint fresh
 * quota and grow the limiter map). This is a localhost dev proxy, so the socket
 * address is the real client.
 */
function clientKey(req) {
  return String(req.socket?.remoteAddress || 'local');
}

/** Server-side timeout ceiling (seconds) we allow inside an Overpass QL query. */
const OVERPASS_MAX_QL_TIMEOUT = 30;
/** Max `around:` radius (m) — every app caller uses <= 1800 m. */
const OVERPASS_MAX_AROUND_M = 50000;
/** Max bbox span (degrees) — app bboxes are small viewport tiles. */
const OVERPASS_MAX_BBOX_DEG = 12;
/**
 * Every Overpass element-type specifier, including the combined shortcuts
 * (nwr/nw/nr/wr) and `rel`. Shared by the selector + area-element-deny regexes so
 * they can't drift (a missing shortcut like `wr` was an area-scan bypass).
 */
const OVERPASS_ELEMENT_TYPES = 'node|way|relation|nwr|nw|nr|wr|rel';
/** Element-selector (incl. `area`) whose statements must be individually bounded. */
const OVERPASS_SELECTOR_RE = new RegExp(`\\b(?:${OVERPASS_ELEMENT_TYPES}|area)\\b`);
/** An element selector bounded BY an area — the country-scan abuse shape. */
const OVERPASS_AREA_ELEMENT_RE = new RegExp(`\\b(?:${OVERPASS_ELEMENT_TYPES})\\s*\\(\\s*area\\b`, 'i');
/** A single bbox 4-tuple `(s,w,n,e)` (non-global so it does not advance lastIndex). */
const OVERPASS_BBOX_RE = /\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/;

/**
 * Validate + clamp an Overpass form body. Defends the generic proxy against
 * planet-scale abuse: requires exactly one `data` query in which EVERY element
 * selector is individually spatially bounded (around / bbox / is_in / poly /
 * area-set / pivot), rejects oversized radii and world-sized bboxes, and clamps
 * every `[timeout:]` directive. Comments + quoted literals are stripped first so
 * a fake bound inside a tag value can't satisfy the check.
 *
 * Every real app caller passes (annotations/locations/cctv use `around:`/`is_in`/
 * `area.`/`pivot`; traffic uses a small `(s,w,n,e)` bbox); a mixed query that
 * pairs one bounded selector with a global one is rejected.
 *
 * @returns {{ok:true, body:string} | {ok:false, error:string}}
 */
/**
 * Single-pass lexer: blank out quoted literals (→ empty quotes) and strip line
 * and block comments — recognizing each in one walk so a comment marker INSIDE a
 * quoted string is treated as string content, not a comment (and vice versa).
 * Chained regex replaces get the ordering wrong (a quoted slash-slash would hide
 * the rest of the line), which is exactly the bypass this avoids.
 */
function stripOverpassNoise(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const quote = c;
      i += 1;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; } // escaped char
        if (src[i] === quote) { i += 1; break; } // closing quote
        i += 1;
      }
      out += quote + quote; // collapse the literal to empty quotes
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      out += ' ';
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < n && src[i] !== '\n') i += 1;
      out += ' ';
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function sanitizeOverpassBody(rawBody) {
  let params;
  try { params = new URLSearchParams(rawBody); } catch { return { ok: false, error: 'Malformed query body' }; }
  const all = params.getAll('data');
  if (all.length !== 1) return { ok: false, error: 'Exactly one data query is required' };
  const data = all[0];
  if (!data || !data.trim()) return { ok: false, error: 'Missing Overpass data query' };

  // Blank quoted literals + strip comments in one lexer pass so a fake bound or a
  // `//` inside a string can't hide an unbounded selector (or satisfy a bound).
  const stripped = stripOverpassNoise(data);

  // Reject oversized radii in EVERY around form — point `around:r,lat,lon` AND the
  // input-set form `around.set:r` — and parse the full numeric token so scientific
  // notation (`5e7`) can't slip a planet-scale radius past the cap.
  for (const m of stripped.matchAll(/around(?:\.\w+)?:\s*([\d.eE+-]+)/gi)) {
    const radius = Number(m[1]);
    if (!Number.isFinite(radius) || radius > OVERPASS_MAX_AROUND_M) {
      return { ok: false, error: 'Overpass around radius too large' };
    }
  }
  // Reject world-sized / oversized bboxes.
  for (const m of stripped.matchAll(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g)) {
    const s = Number(m[1]); const w = Number(m[2]); const n = Number(m[3]); const e = Number(m[4]);
    if (Math.abs(n - s) > OVERPASS_MAX_BBOX_DEG || Math.abs(e - w) > OVERPASS_MAX_BBOX_DEG) {
      return { ok: false, error: 'Overpass bbox too large' };
    }
  }

  // Reject control-flow constructs the app never uses — their set/bound semantics
  // are hard to validate statically. The app only uses plain selectors + is_in /
  // area / pivot / recursion, so this denylist closes loop/transform escape hatches.
  if (/\b(?:foreach|complete|retro|compare|convert|make)\b/i.test(stripped)) {
    return { ok: false, error: 'Unsupported Overpass construct' };
  }
  // `poly:` has unchecked extent and the app never uses it — reject outright
  // (position-independent, so tag filters can't hide it).
  if (/\bpoly\s*:/i.test(stripped)) {
    return { ok: false, error: 'Overpass poly filter not allowed' };
  }

  // Every selector statement must be individually bounded, WITH set provenance: a
  // set counts as a bound only if it was assigned (->.set) by an already-bounded
  // statement. So `way[...]->.a` (global assigned to a set) is rejected, while the
  // app's `is_in(...)->.a; area.a[...]` and `area(id)->.x; rel(pivot.x)` validate.
  const boundedSets = new Set();
  for (let stmt of stripped.split(';')) {
    stmt = stmt.trim();
    if (!stmt || stmt.startsWith('[') || /^out\b/.test(stmt)) continue;

    // Strip output-set assignments (NOT input bounds), then strip bracket tag
    // filters so a tag KEY/value (e.g. `way[is_in]`, `node[around]`) can never be
    // misread as a spatial bound. Bounds live in (...) / function calls / set
    // refs, never inside [...], so the probe loses nothing real.
    const outSets = [];
    const body = stmt.replace(/->\s*\.(\w+)/g, (_, name) => { outSets.push(name); return ' '; });
    const probe = body.replace(/\[[^\]]*\]/g, ' ');

    // Reject element-in-area scans on the TAG-STRIPPED probe, so a tag filter
    // between the selector and the area filter (way["highway"](area.a)) can't hide
    // it. An area has unbounded extent (could be a whole country); the app only
    // SELECTS admin areas (area.set) and pivots (rel(pivot.x)), never node/way/
    // relation(area...). The probe collapses tags so `way (area.a)` is caught.
    if (OVERPASS_AREA_ELEMENT_RE.test(probe)) {
      return { ok: false, error: 'Overpass area-bounded element selector not allowed' };
    }

    const hasSelector = OVERPASS_SELECTOR_RE.test(probe);
    const inputSets = [...probe.matchAll(/(?<!\d)\.([a-z_]\w*)/gi)].map((m) => m[1]);
    const directBound = /around:\s*\d/.test(probe)
      || OVERPASS_BBOX_RE.test(probe)
      || /is_in\s*\(/.test(probe)                 // is_in(lat,lon) — the function form only
      || /\barea\s*\(/.test(probe);               // area(id) — bounded as a set definition

    const setBound = inputSets.some((s) => boundedSets.has(s));
    const bounded = directBound || setBound;

    if (hasSelector && !bounded) {
      return { ok: false, error: 'Overpass query has an unbounded selector' };
    }
    // Only a bounded statement can mark its output sets as bounded.
    if (bounded) for (const name of outSets) boundedSets.add(name);
  }

  const clamped = data.replace(
    /\[timeout:\s*(\d+)\s*\]/gi,
    (_, n) => `[timeout:${Math.min(Number(n) || OVERPASS_MAX_QL_TIMEOUT, OVERPASS_MAX_QL_TIMEOUT)}]`,
  );
  return { ok: true, body: `data=${encodeURIComponent(clamped)}` };
}

/** Read a request body with a hard byte cap; throws { code:'BODY_TOO_LARGE' } past the cap. */
async function readRequestBodyCapped(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const err = new Error('Request body too large');
      err.code = 'BODY_TOO_LARGE';
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Read a fetch() Response body as text with a hard byte cap. Rejects early on an
 * oversized Content-Length, then streams with a running cap so a chunked or
 * length-omitted response cannot blow past the limit. Throws { code:'RESPONSE_TOO_LARGE' }.
 */
export async function readResponseTextCapped(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    const err = new Error('Upstream response too large');
    err.code = 'RESPONSE_TOO_LARGE';
    throw err;
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      const err = new Error('Upstream response too large');
      err.code = 'RESPONSE_TOO_LARGE';
      throw err;
    }
    return text;
  }
  const decoder = new TextDecoder();
  let out = '';
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* no-op */ }
      const err = new Error('Upstream response too large');
      err.code = 'RESPONSE_TOO_LARGE';
      throw err;
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

/** Parse a fetch() JSON response only after enforcing a hard byte cap. */
export async function readResponseJsonCapped(response, maxBytes) {
  return JSON.parse(await readResponseTextCapped(response, maxBytes));
}

/**
 * Return the existing promise for a cache key, or create one and remove it
 * only when that exact promise settles.
 */
export function coalesceProxyRequest(inFlight, key, create) {
  const existing = inFlight.get(key);
  if (existing) return { promise: existing, shared: true };
  let promise;
  promise = Promise.resolve()
    .then(create)
    .finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return { promise, shared: false };
}

// ---------------------------------------------------------------------------
// Radio Browser directory proxy
// ---------------------------------------------------------------------------
const RADIO_DIRECTORY_CACHE_MS = 45 * 60 * 1000;
const RADIO_DIRECTORY_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const RADIO_MIRROR_CACHE_MS = 6 * 60 * 60 * 1000;
const RADIO_FETCH_TIMEOUT_MS = 12_000;
const RADIO_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
const RADIO_DIRECTORY_LIMIT = 750;
const RADIO_CATALOG_MIN_SUCCESSFUL_QUERIES = 5;
const RADIO_CATALOG_HEALTHY_MIN_STATIONS = Math.ceil(RADIO_DIRECTORY_LIMIT / 2);
const RADIO_USER_AGENT = 'GodsEyeView/1.0 (Radio Browser directory client)';
const RADIO_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RADIO_FALLBACK_MIRRORS = Object.freeze([
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
]);

function cleanRadioText(value, maxLength) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength).trim();
}

function isNonGlobalIpv4(hostname) {
  const pieces = hostname.split('.');
  if (pieces.length !== 4 || pieces.some((piece) => !/^\d{1,3}$/.test(piece))) return false;
  const values = pieces.map(Number);
  if (values.some((value) => value > 255)) return true;
  const [a, b, c] = values;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);
}

/** Return a normalized public HTTPS URL, or null for local/private targets. */
export function publicRadioHttpsUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.username || url.password || !hostname) return null;
    if (
      hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname.endsWith('.local')
      || isNonGlobalIpv4(hostname)
      || hostname.includes(':')
    ) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

/** Normalize one Radio Browser station and omit favicons and unsafe streams. */
export function normalizeRadioBrowserStation(raw) {
  const id = cleanRadioText(raw?.stationuuid, 40).toLowerCase();
  const lat = raw?.geo_lat === null || raw?.geo_lat === '' ? null : Number(raw?.geo_lat);
  const lon = raw?.geo_long === null || raw?.geo_long === '' ? null : Number(raw?.geo_long);
  const codec = cleanRadioText(raw?.codec, 16).toUpperCase();
  const streamUrl = publicRadioHttpsUrl(raw?.url_resolved || raw?.url);
  if (
    !RADIO_UUID_RE.test(id)
    || Number(raw?.lastcheckok) !== 1
    || Number(raw?.hls) === 1
    || !Number.isFinite(lat) || lat < -90 || lat > 90
    || !Number.isFinite(lon) || lon < -180 || lon > 180
    || !/^(?:MP3|AAC(?:\+|-LC|-HE)?|HE-AAC)$/i.test(codec)
    || !streamUrl
  ) return null;

  const name = cleanRadioText(raw?.name, 140);
  if (!name) return null;
  const tags = String(raw?.tags ?? '')
    .split(',')
    .map((tag) => cleanRadioText(tag, 80).toLocaleLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((tag, index, all) => all.indexOf(tag) === index)
    .slice(0, 24);
  const languages = String(raw?.language ?? '')
    .split(',')
    .map((language) => cleanRadioText(language, 40))
    .filter(Boolean)
    .slice(0, 8);
  const rawCountryCode = cleanRadioText(raw?.countrycode, 2).toUpperCase();
  const normalizedCode = normalizeRadioCountryInput(rawCountryCode);
  const normalizedCountry = normalizedCode.valid && !normalizedCode.empty
    ? normalizedCode
    : normalizeRadioCountryInput(cleanRadioText(raw?.country, 80));
  const bitrate = Number(raw?.bitrate);
  return {
    id,
    name,
    lat,
    lon,
    streamUrl,
    homepage: publicRadioHttpsUrl(raw?.homepage),
    tags,
    languages,
    state: cleanRadioText(raw?.state, 80),
    country: normalizedCountry.valid && !normalizedCountry.empty
      ? normalizedCountry.name
      : cleanRadioText(raw?.country, 80),
    countryCode: normalizedCountry.valid ? normalizedCountry.code : '',
    metadataTrust: 'untrusted-community',
    codec,
    bitrate: Number.isInteger(bitrate) && bitrate >= 8 && bitrate <= 1024 ? bitrate : null,
    clickCount: Math.max(0, Math.min(10_000_000, Number(raw?.clickcount) || 0)),
  };
}

export function publicRadioStation(station) {
  return {
    id: station.id,
    name: station.name,
    lat: station.lat,
    lon: station.lon,
    streamUrl: station.streamUrl,
    homepage: station.homepage,
    tags: station.tags,
    languages: station.languages,
    state: station.state,
    country: station.country,
    countryCode: station.countryCode,
    metadataTrust: station.metadataTrust,
    codec: station.codec,
    bitrate: station.bitrate,
  };
}

function radioMirrorOrigin(value) {
  const hostname = String(value ?? '').toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9-]+\.api\.radio-browser\.info$/.test(hostname)) return null;
  return `https://${hostname}`;
}

/** Return whether a resolved Radio Browser address is safe for an outbound request. */
export function isPublicRadioAddress(value) {
  const address = String(value ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!address) return false;
  if (!address.includes(':')) {
    const ipv4 = address.split('.');
    return ipv4.length === 4
      && ipv4.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
      && !isNonGlobalIpv4(address);
  }
  const pieces = address.split('::');
  if (pieces.length > 2) return false;
  const left = pieces[0] ? pieces[0].split(':') : [];
  const right = pieces[1] ? pieces[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((pieces.length === 1 && missing !== 0) || (pieces.length === 2 && missing < 1)) return false;
  const groups = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return false;
  const numeric = groups.reduce((total, group) => (total << 16n) | BigInt(`0x${group}`), 0n);
  const inCidr = (base, prefix) => {
    const shift = 128n - BigInt(prefix);
    return (numeric >> shift) === (base >> shift);
  };
  const base = (text) => text.split(':').reduce(
    (total, group) => (total << 16n) | BigInt(`0x${group || '0'}`),
    0n,
  );
  const cidr = (text, prefix) => inCidr(base(text), prefix);
  return cidr('2000:0:0:0:0:0:0:0', 3)
    && !cidr('2001:0:0:0:0:0:0:0', 23)
    && !cidr('2001:db8:0:0:0:0:0:0', 32)
    && !cidr('2002:0:0:0:0:0:0:0', 16)
    && !cidr('3fff:0:0:0:0:0:0:0', 20);
}

function radioProxyDestination(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return null;
  }
  const origin = radioMirrorOrigin(url.hostname);
  if (
    !origin
    || url.origin !== origin
    || url.username
    || url.password
    || url.port
    || url.hash
  ) return null;
  const discovery = url.hostname.toLowerCase() === 'all.api.radio-browser.info'
    && url.pathname === '/json/servers'
    && !url.search;
  const directory = url.pathname === '/json/stations/search';
  const click = /^\/json\/url\/[0-9a-f-]+$/i.test(url.pathname) && !url.search;
  return discovery || directory || click ? url : null;
}

async function resolveRadioProxyAddresses(hostname, lookupImpl) {
  const resolved = await lookupImpl(hostname, { all: true, verbatim: true });
  const rows = Array.isArray(resolved) ? resolved : [resolved];
  const addresses = rows
    .map((row) => ({ address: String(row?.address || ''), family: Number(row?.family) || undefined }))
    .filter((row) => row.address);
  if (!addresses.length || addresses.some((row) => !isPublicRadioAddress(row.address))) {
    throw new Error('Radio Browser resolved to a forbidden address');
  }
  return addresses;
}

function fetchPinnedRadioResponse(url, options, addresses) {
  return new Promise((resolve, reject) => {
    const address = addresses[0];
    const request = https.request(url, {
      method: 'GET',
      headers: options.headers,
      signal: options.signal,
      lookup(_hostname, lookupOptions, callback) {
        if (lookupOptions?.all) callback(null, addresses);
        else callback(null, address.address, address.family);
      },
    }, (response) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
        else if (value !== undefined) headers.set(name, String(value));
      }
      resolve(new Response(Readable.toWeb(response), {
        status: response.statusCode || 500,
        statusText: response.statusMessage || '',
        headers,
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

async function mapRadioConcurrent(values, concurrency, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Create the testable Connect middleware backing `/api/radio`. */
export function createRadioProxyMiddleware({ fetchImpl = null, lookupImpl = lookupDns, now = Date.now } = {}) {
  let mirrorCache = { origins: [...RADIO_FALLBACK_MIRRORS], cachedAt: 0 };
  let mirrorPromise = null;
  let catalogCache = null;
  let catalogGeneration = 0;
  // The generation counter is process-local, so it restarts from 1 with the
  // server. The instance token scopes each generation sequence: a client that
  // sees a new instance must treat the catalog as a fresh sequence, never as a
  // repeat ("still generation 1") or a regression ("generation went backward").
  const catalogInstance = randomUUID();
  let servedStationIds = new Set();
  let refreshPromise = null;

  async function fetchJson(url, maxBytes = RADIO_RESPONSE_MAX_BYTES) {
    const destination = radioProxyDestination(url);
    if (!destination) throw new Error('Radio Browser destination is not permitted');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RADIO_FETCH_TIMEOUT_MS);
    try {
      const addresses = await resolveRadioProxyAddresses(destination.hostname, lookupImpl);
      const options = {
        headers: { Accept: 'application/json', 'User-Agent': RADIO_USER_AGENT },
        signal: controller.signal,
        redirect: 'manual',
      };
      const response = fetchImpl
        ? await fetchImpl(destination.href, options)
        : await fetchPinnedRadioResponse(destination, options, addresses);
      if (response.status >= 300 && response.status < 400) {
        try { await response.body?.cancel?.(); } catch { /* no-op */ }
        throw new Error('Radio Browser redirects are refused');
      }
      if (!response.ok) throw new Error(`Radio Browser returned ${response.status}`);
      const text = await readResponseTextCapped(response, maxBytes);
      return JSON.parse(text);
    } finally {
      clearTimeout(timer);
    }
  }

  async function mirrors() {
    if (now() - mirrorCache.cachedAt < RADIO_MIRROR_CACHE_MS) return mirrorCache.origins;
    if (!mirrorPromise) {
      mirrorPromise = (async () => {
        try {
          const rows = await fetchJson('https://all.api.radio-browser.info/json/servers', 256 * 1024);
          const discovered = [...new Set((Array.isArray(rows) ? rows : []).map((row) => radioMirrorOrigin(row?.name)).filter(Boolean))];
          if (discovered.length) {
            mirrorCache = { origins: [...discovered, ...RADIO_FALLBACK_MIRRORS.filter((origin) => !discovered.includes(origin))], cachedAt: now() };
          }
        } catch {
          mirrorCache = { ...mirrorCache, cachedAt: now() };
        }
        return mirrorCache.origins;
      })().finally(() => { mirrorPromise = null; });
    }
    return mirrorPromise;
  }

  async function fetchPath(pathname) {
    let lastError = null;
    for (const origin of await mirrors()) {
      try {
        return await fetchJson(`${origin}${pathname}`);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('No Radio Browser mirror is available');
  }

  async function refreshCatalog() {
    const queries = [null, 'news', 'talk', 'weather', 'emergency', 'scanner', 'aviation', 'marine', 'traffic'];
    const outcomes = await mapRadioConcurrent(queries, 3, async (tag, index) => {
      const params = new URLSearchParams({
        has_geo_info: 'true',
        is_https: 'true',
        hidebroken: 'true',
        order: 'clickcount',
        reverse: 'true',
        limit: index === 0 ? '1800' : '220',
      });
      if (tag) params.set('tag', tag);
      try {
        const rows = await fetchPath(`/json/stations/search?${params}`);
        if (!Array.isArray(rows)) throw new Error('Radio Browser catalog payload was not an array');
        if (!rows.every((row) => (
          row
          && typeof row === 'object'
          && !Array.isArray(row)
          && typeof row.stationuuid === 'string'
          && typeof row.name === 'string'
          && (typeof row.url_resolved === 'string' || typeof row.url === 'string')
        ))) throw new Error('Radio Browser catalog contained a malformed station row');
        const stations = rows.map(normalizeRadioBrowserStation).filter(Boolean);
        const requestedTag = cleanRadioText(tag, 80)
          .toLocaleLowerCase()
          .replace(/[_-]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const requestedTagCovered = !requestedTag || stations.some((station) => (
          station.tags.some((stationTag) => stationTag === requestedTag || stationTag.includes(requestedTag))
        ));
        return {
          // Query coverage is based on accepted rows, not merely a payload that
          // happens to match the upstream schema. Specialist responses must
          // also contain an accepted station tagged for the requested category.
          succeeded: stations.length > 0 && requestedTagCovered,
          stations,
        };
      } catch {
        return { succeeded: false, stations: [] };
      }
    });
    const resultSets = outcomes.map((outcome) => outcome.stations);

    const selected = [];
    const seen = new Set();
    const take = (station) => {
      if (!station || seen.has(station.id) || selected.length >= RADIO_DIRECTORY_LIMIT) return;
      seen.add(station.id);
      selected.push(station);
    };
    // Seed specialist station-tag queries before popularity fill so operational
    // categories remain represented even when global click charts skew musical.
    for (const rows of resultSets.slice(1)) rows.slice(0, 45).forEach(take);
    resultSets.flat().sort((a, b) => b.clickCount - a.clickCount || a.name.localeCompare(b.name)).forEach(take);
    const timestamp = now();
    const successfulQueries = outcomes.filter((outcome) => outcome.succeeded).length;
    const broadQueryHealthy = outcomes[0].succeeded && outcomes[0].stations.length > 0;
    const healthReasons = [];
    if (!broadQueryHealthy) healthReasons.push('broad-query-unhealthy');
    if (successfulQueries < RADIO_CATALOG_MIN_SUCCESSFUL_QUERIES) healthReasons.push('query-coverage-below-policy');
    if (selected.length < RADIO_CATALOG_HEALTHY_MIN_STATIONS) healthReasons.push('station-coverage-below-policy');
    const degraded = healthReasons.length > 0;
    const coverage = {
      successfulQueries,
      totalQueries: queries.length,
      stationCount: selected.length,
      healthyStationMinimum: RADIO_CATALOG_HEALTHY_MIN_STATIONS,
    };
    const nextCatalog = {
      cachedAt: timestamp,
      updatedAt: new Date(timestamp).toISOString(),
      stations: selected.map(publicRadioStation),
      stationIds: new Set(selected.map((station) => station.id)),
      degraded,
      degradedReason: degraded ? healthReasons.join(',') : null,
      coverage,
    };
    if (degraded && catalogCache) {
      const error = new Error('Radio Browser catalog refresh did not meet health policy');
      error.radioCatalogDegraded = true;
      error.radioDegradedReason = nextCatalog.degradedReason;
      error.radioCoverage = coverage;
      throw error;
    }
    if (degraded && !selected.length) {
      const error = new Error('Radio Browser catalog refresh returned no usable stations');
      error.radioCatalogDegraded = true;
      error.radioDegradedReason = nextCatalog.degradedReason;
      error.radioCoverage = coverage;
      throw error;
    }
    if (degraded) {
      servedStationIds = nextCatalog.stationIds;
      return { ...nextCatalog, acceptedGeneration: null };
    }
    catalogCache = {
      ...nextCatalog,
      acceptedGeneration: ++catalogGeneration,
    };
    servedStationIds = catalogCache.stationIds;
    return catalogCache;
  }

  async function getCatalog() {
    if (catalogCache && now() - catalogCache.cachedAt < RADIO_DIRECTORY_CACHE_MS) {
      return { ...catalogCache, stale: false };
    }
    if (!refreshPromise) {
      refreshPromise = refreshCatalog().finally(() => { refreshPromise = null; });
    }
    try {
      return { ...await refreshPromise, stale: false };
    } catch (error) {
      if (catalogCache && now() - catalogCache.cachedAt <= RADIO_DIRECTORY_STALE_MS) {
        return {
          ...catalogCache,
          stale: true,
          degraded: true,
          degradedReason: error?.radioDegradedReason || 'refresh-failed',
          coverage: error?.radioCoverage || catalogCache.coverage,
        };
      }
      throw error;
    }
  }

  function sendJson(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  return async function radioProxyMiddleware(req, res) {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    if (requestUrl.pathname === '/stations') {
      if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET', 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      try {
        const catalog = await getCatalog();
        sendJson(res, 200, {
          stations: catalog.stations,
          updatedAt: catalog.updatedAt,
          stale: catalog.stale,
          degraded: Boolean(catalog.degraded),
          degradedReason: catalog.degradedReason || null,
          coverage: catalog.coverage || null,
          acceptedGeneration: catalog.acceptedGeneration ?? null,
          catalogInstance,
        });
      } catch (error) {
        sendJson(res, 503, {
          error: 'Radio directory is temporarily unavailable',
          degraded: Boolean(error?.radioCatalogDegraded),
          degradedReason: error?.radioDegradedReason || null,
        });
      }
      return;
    }

    const clickMatch = requestUrl.pathname.match(/^\/click\/([0-9a-f-]+)$/i);
    if (clickMatch) {
      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST', 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      const id = clickMatch[1].toLowerCase();
      if (!RADIO_UUID_RE.test(id) || !servedStationIds.has(id)) {
        sendJson(res, 404, { error: 'Unknown radio station' });
        return;
      }
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      void fetchPath(`/json/url/${id}`).catch(() => {});
      return;
    }

    sendJson(res, 404, { error: 'Unknown radio route' });
  };
}

function radioBrowserProxy() {
  const middleware = createRadioProxyMiddleware();
  const install = (server) => {
    server.middlewares.use('/api/radio', middleware);
  };
  return {
    name: 'radio-browser-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
// ---------------------------------------------------------------------------
// GBFS (General Bikeshare Feed Specification) proxy constants
// ---------------------------------------------------------------------------
/** Upstream fetch timeout for GBFS requests (ms). */
const GBFS_PROXY_TIMEOUT_MS = 12000;
/** Allowlisted GBFS hostnames; wildcard *.publicbikesystem.net also accepted. */
const GBFS_ALLOWED_HOSTS = new Set([
  'gbfs.lyft.com',
  'gbfs.bluebikes.com',
  'gbfs.bcycle.com',
  'gbfs.biketownpdx.com',
  'gbfs.cogobikeshare.com',
  'austin.publicbikesystem.net',
  'hon.publicbikesystem.net',
  'chat.publicbikesystem.net',
  // France
  'velib-metropole-opendata.smovengo.cloud',
  'api.cyclocity.fr',
  'bdx.mecatran.com',
]);

// ---------------------------------------------------------------------------
// AISStream live vessel cache state
// ---------------------------------------------------------------------------
const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const AISSTREAM_DEFAULT_BBOXES = [[[-90, -180], [90, 180]]];
const AISSTREAM_DEFAULT_MESSAGE_TYPES = [
  'PositionReport',
  'StandardClassBPositionReport',
  'ExtendedClassBPositionReport',
  'ShipStaticData',
  'StaticDataReport',
];
const AISSTREAM_CACHE_MAX = 50000;
const AISSTREAM_STALE_MS = 30 * 60 * 1000;
// Per-MMSI recent-path ring buffers (PRD WS-F F3). Float32 lat/lon (~1m
// precision, fine for 25m thinning) + Uint32 epoch seconds ≈ 12B/sample;
// 64 samples × 50k MMSIs worst case ≈ 38MB. Tracks exist only while the dev
// server runs — this is "recent path", not voyage history.
const AIS_TRACK_SAMPLES = 64;
const AIS_TRACK_MIN_GAP_SEC = 30;
const AIS_TRACK_MIN_MOVE_M = 25;
// Watchdog budgets (policy lives in src/data/aisWatchdog.js). Silence is
// REPORTED quickly and ACTED ON slowly: a dead feed must read as dead within
// ~2 min, but recycling the socket is throttled so recovery can never become a
// reconnect cycle against AISStream's one-connection-per-key limit.
const AISSTREAM_SILENCE_REPORT_MS = 120_000;
/** Recycle threshold as a multiple of the report threshold. */
const AISSTREAM_RECYCLE_RATIO = 2.5;
const AISSTREAM_BACKOFF_MS = Object.freeze([5_000, 15_000, 60_000, 300_000]);
/** Slow retry cadence once the ladder is spent and the feed reads DOWN. */
const AISSTREAM_DOWN_RETRY_MS = 900_000;
/**
 * Probe cadence while AISStream is rejecting the key. Retrying cannot fix a
 * bad credential, so this exists only to recover from an upstream-side
 * mistake — it must never approach the ladder's pace.
 */
const AISSTREAM_AUTH_PROBE_MS = 3_600_000;
/** How often the watchdog re-evaluates without request traffic. */
const AISSTREAM_TICK_MS = 15_000;
// Sourced from the shared voice-model registry so the client's cost estimate
// can never be computed against a different model than the session runs on.
const OPENAI_REALTIME_MODEL_DEFAULT = VOICE_MODELS.standard.id;
const OPENAI_REALTIME_MODEL_MINI_DEFAULT = VOICE_MODELS.mini.id;
const OPENAI_REALTIME_VOICE_DEFAULT = 'marin';
const OPENAI_REALTIME_REASONING_DEFAULT = 'low';
const OPENAI_REALTIME_CONTEXT_TOKENS_DEFAULT = 3000;
const OPENAI_REALTIME_CONTEXT_RETENTION_DEFAULT = 0.5;
const OPENAI_HUD_SUMMARY_MODEL_DEFAULT = 'gpt-5-nano';
const REALTIME_DEBUG_LOG_DIR = path.join(__dirname, '.gev-logs');
const REALTIME_DEBUG_LOG_FILE = path.join(REALTIME_DEBUG_LOG_DIR, 'realtime-conversations.jsonl');
const REALTIME_DEBUG_LOG_MAX_BYTES = 8 * 1024 * 1024;

/**
 * @type {ReturnType<typeof createAisStreamAdapter>|null}
 * Module-lifetime: it owns the socket-generation namespace, which must never
 * restart across a dev-server reload (see aisStreamAdapter.js ownership rules).
 */
let _aisAdapter = null;
/** @type {{silenceWatch:boolean,reportMs:number,recycleMs:number,url:string}|null} */
let _aisWatchdogPolicy = null;
/** @type {number|null} */
let _aisStreamTickTimer = null;
/** Set by dispose so the next ensure() re-derives budgets from a reloaded .env. */
let _aisNeedsRearm = false;
/** @type {Function|null|undefined} `ws` constructor; null = unavailable, undefined = not yet probed. */
let _aisWebSocketImpl;
/** @type {Map<string,object>} */
const _aisStreamVessels = new Map();
/** @type {Map<string,object>} */
const _aisStreamStatic = new Map();
/** @type {Map<string,{lats:Float32Array,lons:Float32Array,times:Uint32Array,head:number,len:number}>} mmsi -> track ring buffer */
const _aisStreamTracks = new Map();
/** @type {Map<string,{lat:number,lon:number,epochSec:number}>} mmsi -> first fix awaiting second (lazy buffer allocation) */
const _aisStreamTrackPending = new Map();

/**
 * Obtain a valid OpenSky OAuth2 bearer token, refreshing if needed.
 *
 * Uses the client_credentials grant against the OpenSky Keycloak realm.
 * Concurrent callers share a single in-flight refresh promise so only
 * one token request is issued at a time.
 *
 * @returns {Promise<string|null>} Bearer token string, or null if unavailable.
 */
async function getOpenSkyToken() {
  const now = Date.now();
  // Return cached token if still valid (with 60 s safety margin)
  if (_openskyToken && now < _openskyTokenExpiry - 60000) return _openskyToken;

  // Coalesce concurrent refresh requests — if a refresh is already in-flight,
  // return the same promise instead of issuing a duplicate token request
  if (_openskyTokenPromise) return _openskyTokenPromise;

  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  // Wrap the async token fetch in a shared promise stored in _openskyTokenPromise
  _openskyTokenPromise = (async () => {
    try {
      const res = await fetch(
        'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`,
        }
      );

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      const accessToken = data?.access_token;
      const expiresIn = Number(data?.expires_in);
      if (!res.ok || !accessToken) {
        if (!_openskyAuthWarned) {
          const detail = data?.error_description || data?.error || `HTTP ${res.status}`;
          console.warn('[OpenSky] OAuth client_credentials failed:', detail);
          _openskyAuthWarned = true;
        }
        _openskyToken = null;
        _openskyTokenExpiry = 0;
        return null;
      }

      _openskyToken = accessToken;
      // Default to 1800 s (30 min) if expires_in is missing or non-finite
      _openskyTokenExpiry = Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 1800) * 1000;
      console.log('[OpenSky] OAuth token refreshed, expires in', Number.isFinite(expiresIn) ? expiresIn : 1800, 's');
      _openskyAuthWarned = false;
      return _openskyToken;
    } catch (err) {
      if (!_openskyAuthWarned) {
        console.warn('[OpenSky] OAuth token request failed:', err?.message || String(err));
        _openskyAuthWarned = true;
      }
      _openskyToken = null;
      _openskyTokenExpiry = 0;
      return null;
    } finally {
      // Clear the shared promise so the next caller can start a fresh refresh
      _openskyTokenPromise = null;
    }
  })();

  return _openskyTokenPromise;
}

/**
 * Validate and normalize the OPENSKY_AUTH_MODE env value.
 *
 * @param {string} value - Raw env value (e.g. 'basic', 'oauth', 'auto', 'anon').
 * @returns {string} One of the valid mode strings, or the default ('oauth').
 */
function normalizeOpenSkyAuthMode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return OPENSKY_AUTH_MODE_DEFAULT;
  if (OPENSKY_AUTH_MODE_SET.has(raw)) return raw;
  if (!_openskyAuthModeWarned) {
    console.warn(
      `[OpenSky] Invalid OPENSKY_AUTH_MODE="${raw}", defaulting to "${OPENSKY_AUTH_MODE_DEFAULT}"`
    );
    _openskyAuthModeWarned = true;
  }
  return OPENSKY_AUTH_MODE_DEFAULT;
}

/**
 * Build standard response headers for OpenSky proxy responses.
 *
 * Includes diagnostic X-OpenSky-* headers so the client can inspect
 * cache hit/miss status and which auth mode was actually used.
 *
 * @param {object} opts
 * @param {string} opts.cacheStatus - 'HIT', 'MISS', or 'STALE'.
 * @param {string} opts.requestedMode - The auth mode the config requested.
 * @param {string} opts.usedMode - The auth mode actually used for the upstream call.
 * @param {string} opts.reason - Human-readable reason string for diagnostics.
 * @returns {Record<string,string>} Header object.
 */
function buildOpenSkyHeaders({ cacheStatus, requestedMode, usedMode, reason, staleSeconds, retryAfterSeconds }) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-OpenSky-Cache': cacheStatus,
    'X-OpenSky-Auth': usedMode,
    'X-OpenSky-Auth-Mode-Requested': requestedMode,
    'X-OpenSky-Auth-Mode-Used': usedMode,
    'X-OpenSky-Auth-Reason': reason,
  };
  // Credit-governor extras (field-test fix 2026-07-06): the client can show a
  // STALE cue / countdown without parsing the body.
  if (Number.isFinite(staleSeconds)) headers['X-OpenSky-Stale-Seconds'] = String(Math.round(staleSeconds));
  if (Number.isFinite(retryAfterSeconds)) headers['X-OpenSky-Retry-After-Seconds'] = String(Math.round(retryAfterSeconds));
  return headers;
}

/**
 * Vite plugin: CelesTrak TLE proxy.
 *
 * CelesTrak does not send CORS headers, so this middleware fetches
 * satellite TLE data server-side and forwards it to the browser.
 * Upstream URL: https://celestrak.org/NORAD/elements/gp.php
 *
 * @returns {import('vite').Plugin}
 */
/**
 * CelesTrak GP/TLE proxy with a memory + disk cache.
 * Upstream: https://celestrak.org/NORAD/elements/gp.php?GROUP=<group>&FORMAT=tle
 * CelesTrak asks clients not to re-fetch GP data more than ~every 2 h and
 * throttles offenders; every dev reload used to refetch every group. Cache TTL
 * 6 h; on upstream failure the freshest stale copy is served (a stale TLE
 * beats an empty satellites layer). Pattern mirrors openSkyProxy's
 * cache+serve-stale. Adapted from skylight's TleStore (MIT).
 */
function celestrakProxy() {
  const TLE_TTL_MS = 6 * 3600_000;
  const CACHE_DIR = path.join(process.cwd(), '.gev-cache');
  const mem = new Map(); // group -> { at: epochMs, body: string }
  const inflight = new Map(); // group -> Promise<{at, body}|null>

  const diskPath = (group) => path.join(CACHE_DIR, `celestrak-${group}.json`);

  async function readDisk(group) {
    try {
      const parsed = JSON.parse(await fsp.readFile(diskPath(group), 'utf8'));
      if (typeof parsed?.body === 'string' && Number.isFinite(parsed?.at)) return parsed;
    } catch { /* no disk cache yet */ }
    return null;
  }

  async function writeDisk(group, entry) {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      await fsp.writeFile(diskPath(group), JSON.stringify(entry), 'utf8');
    } catch (err) {
      console.warn(`[celestrak-proxy] cache write failed for ${group}:`, err?.message || err);
    }
  }

  async function fetchUpstream(group) {
    const url = new URL('https://celestrak.org/NORAD/elements/gp.php');
    url.searchParams.set('GROUP', group);
    url.searchParams.set('FORMAT', 'tle');
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(20000),
      // CelesTrak 403s bulk groups (e.g. `active`) unless the request carries a
      // descriptive User-Agent with a contact point.
      headers: { 'User-Agent': 'gods-eye-view-celestrak-proxy/1.0 (+https://github.com/bilawalsidhu/gods-eye-view)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    // An upstream error page parses to zero TLEs — treat as failure, keep cache.
    if (!/^1 /m.test(body)) throw new Error('no TLE lines in response');
    return { at: Date.now(), body };
  }

  return {
    name: 'celestrak-proxy',
    configureServer(server) {
      server.middlewares.use('/api/celestrak', async (req, res) => {
        const group = String(req.url || '').replace(/^\//, '').split('?')[0];
        if (!/^[a-z0-9-]+$/i.test(group)) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('invalid group');
          return;
        }
        const send = (status, body, cacheStatus) => {
          // Guard against a double-send (e.g. a throw AFTER a response already
          // went out routing into the catch's send): writeHead after headersSent
          // throws "Cannot set headers after they are sent".
          if (res.headersSent) return;
          res.writeHead(status, { 'Content-Type': 'text/plain', 'x-tle-cache': cacheStatus });
          res.end(body);
        };
        try {
          const now = Date.now();
          let entry = mem.get(group);
          if (!entry) {
            entry = await readDisk(group);
            if (entry) mem.set(group, entry);
          }
          if (entry && now - entry.at < TLE_TTL_MS) {
            send(200, entry.body, 'HIT');
            return;
          }
          // Stale or missing → refresh, single-flight per group.
          if (!inflight.has(group)) {
            inflight.set(group, fetchUpstream(group)
              .then(async (fresh) => {
                mem.set(group, fresh);
                await writeDisk(group, fresh);
                return fresh;
              })
              .catch((err) => {
                console.warn(`[celestrak-proxy] ${group} refresh failed (${err?.message || err}) — serving cache if any`);
                return null;
              })
              .finally(() => inflight.delete(group)));
          }
          const fresh = await inflight.get(group);
          if (fresh) {
            send(200, fresh.body, 'MISS');
          } else if (entry) {
            send(200, entry.body, 'STALE-ERROR'); // upstream down — stale beats empty
          } else {
            send(502, 'celestrak fetch failed and no cache available', 'NONE');
          }
        } catch (err) {
          send(500, `celestrak proxy error: ${err?.message || err}`, 'ERROR');
        }
      });
    },
  };
}

export const LL2_CACHE_TTL_MS = 15 * 60_000;

/** Build LL2 request headers without exposing its optional token client-side. */
export function launchLibraryRequestHeaders(token = process.env.LL2_API_TOKEN) {
  const normalized = String(token || '').trim();
  return {
    Accept: 'application/json',
    ...(normalized ? { Authorization: `Token ${normalized}` } : {}),
  };
}

/** Proxy the public Launch Library 2 recent-launch feed server-side. */
function rocketLaunchesProxy() {
  const ttlMs = LL2_CACHE_TTL_MS;
  const maxResponseBytes = 12 * 1024 * 1024;
  const maxDiskCacheBytes = 24 * 1024 * 1024;
  const cachePath = path.join(process.cwd(), '.gev-cache', 'launch-library-2-v2.3.json');
  let cache = null;
  let diskLoaded = false;
  const inFlight = new Map();

  async function loadDiskCache() {
    if (diskLoaded) return;
    diskLoaded = true;
    try {
      const stat = await fsp.stat(cachePath);
      if (stat.size > maxDiskCacheBytes) throw new Error('cache file too large');
      const parsed = JSON.parse(await fsp.readFile(cachePath, 'utf8'));
      if (Number.isFinite(parsed?.at) && typeof parsed?.body === 'string') {
        const body = JSON.parse(parsed.body);
        if (Array.isArray(body?.results)) cache = parsed;
      }
    } catch { /* first run or invalid cache */ }
  }

  async function saveDiskCache(entry) {
    try {
      await fsp.mkdir(path.dirname(cachePath), { recursive: true });
      await fsp.writeFile(cachePath, JSON.stringify(entry), 'utf8');
    } catch (error) {
      console.warn(`[launch-library-proxy] cache write failed: ${error?.message || error}`);
    }
  }

  function send(res, status, body, cacheState) {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': status === 200 ? 'public, max-age=900' : 'no-store',
      'X-GEV-Cache': cacheState,
    });
    res.end(body);
  }

  async function refreshUpstream() {
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 86400000);
    const url = new URL('https://ll.thespacedevs.com/2.3.0/launches/');
    url.searchParams.set('net__gte', start.toISOString());
    url.searchParams.set('net__lte', end.toISOString());
    url.searchParams.set('limit', '100');
    url.searchParams.set('mode', 'detailed');
    const upstream = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: launchLibraryRequestHeaders(),
    });
    const body = await readResponseTextCapped(upstream, maxResponseBytes);
    if (!upstream.ok) {
      const error = new Error(`upstream HTTP ${upstream.status}`);
      error.upstreamStatus = upstream.status;
      error.upstreamBody = body;
      throw error;
    }
    const parsed = JSON.parse(body);
    if (!Array.isArray(parsed?.results)) throw new Error('malformed upstream response');
    const fresh = { at: Date.now(), body };
    cache = fresh;
    void saveDiskCache(fresh);
    return fresh;
  }

  function install(middlewares) {
    middlewares.use('/api/launches', async (req, res) => {
      if (req.method !== 'GET') {
        send(res, 405, JSON.stringify({ error: 'Method Not Allowed' }), 'NONE');
        return;
      }
      await loadDiskCache();
      const now = Date.now();
      if (cache && now - cache.at < ttlMs) {
        send(res, 200, cache.body, 'HIT');
        return;
      }
      const stale = cache;
      const request = coalesceProxyRequest(inFlight, 'recent-launches', refreshUpstream);
      try {
        const fresh = await request.promise;
        send(res, 200, fresh.body, request.shared ? 'INFLIGHT' : 'MISS');
      } catch (error) {
        if (stale) {
          if (!request.shared) console.warn(`[launch-library-proxy] refresh failed (${error?.message || error}) — serving stale cache`);
          send(res, 200, stale.body, 'STALE-ERROR');
          return;
        }
        send(
          res,
          Number.isInteger(error?.upstreamStatus) ? error.upstreamStatus : 502,
          error?.upstreamBody || JSON.stringify({ error: 'Launch Library 2 unavailable' }),
          'NONE',
        );
      }
    });
  }

  return {
    name: 'rocket-launches-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

/**
 * TomTom traffic-flow vector-tile proxy with a daily budget governor.
 *
 * Upstream: https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.pbf
 * (style `relative`; the response is an UNCOMPRESSED Mapbox Vector Tile, layer
 * "Traffic flow"). The key comes from TOMTOM_API_KEY server-side only — the
 * browser fetches same-origin `/api/tomtom/flow/{z}/{x}/{y}.pbf`.
 *
 * Cache: memory + disk (.gev-cache/tomtom/), TTL 120 s (traffic is fresh
 * data), single-flight per tile, serve-stale-on-failure — the celestrakProxy
 * pattern. Cache hits never count against the budget.
 *
 * Budget governor (mirrors the OpenSky credit-governor philosophy — last-good
 * data beats a dead layer): a persistent counter (.gev-cache/tomtom/budget.json,
 * keyed by UTC date, reset on day change) counts upstream fetch attempts
 * against a soft cap (TOMTOM_DAILY_TILE_BUDGET, default 40,000 of the free
 * tier's ~50k/day). Over the cap the proxy serves stale tiles when available,
 * else 429 {error:'budget'}.
 *
 * GET /api/tomtom/status → {hasKey, dailyCount, budget, date}. Keyless mode:
 * status reports hasKey:false and the tile endpoint 503s {error:'no_key'}
 * without touching upstream — the traffic layer then stays in simulation mode.
 *
 * @returns {import('vite').Plugin}
 */
function tomtomProxy() {
  const TILE_TTL_MS = 120_000;
  const CACHE_DIR = path.join(process.cwd(), '.gev-cache', 'tomtom');
  const BUDGET_PATH = path.join(CACHE_DIR, 'budget.json');
  const DEFAULT_DAILY_BUDGET = 40000;
  const MEM_MAX_ENTRIES = 256;
  const UPSTREAM_TIMEOUT_MS = 15000;

  /** @type {Map<string, {at:number, buf:Buffer}>} tile key `z/x/y` -> cached tile (kept past TTL for serve-stale). */
  const mem = new Map();
  /** @type {Map<string, Promise<{at:number, buf:Buffer}|null>>} single-flight per tile. */
  const inflight = new Map();

  /** @type {{date:string, count:number}|null} lazily-loaded persistent counter. */
  let budget = null;
  let budgetLoaded = false;

  function dailyBudgetLimit() {
    const raw = Number.parseInt(process.env.TOMTOM_DAILY_TILE_BUDGET || '', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_BUDGET;
  }

  async function loadBudgetOnce() {
    if (budgetLoaded) return;
    budgetLoaded = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(BUDGET_PATH, 'utf8'));
      if (parsed && typeof parsed.date === 'string' && Number.isFinite(parsed.count)) {
        budget = parsed;
      }
    } catch { /* no budget file yet */ }
  }

  async function persistBudget() {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      await fsp.writeFile(BUDGET_PATH, JSON.stringify(budget), 'utf8');
    } catch (err) {
      console.warn('[tomtom-proxy] budget write failed:', err?.message || err);
    }
  }

  /** Roll the counter to today (UTC) and return it. */
  function currentBudget() {
    budget = normalizeTomTomBudget(budget, tomtomUtcDayKey());
    return budget;
  }

  /** Count one upstream fetch attempt against today's budget (async persist). */
  function recordUpstreamFetch() {
    currentBudget().count += 1;
    void persistBudget();
  }

  const tilePath = (key) => path.join(CACHE_DIR, `flow-${key.replaceAll('/', '-')}.pbf`);

  /** Disk-cache read; tile age comes from the file's mtime. */
  async function readDiskTile(key) {
    try {
      const [stat, buf] = await Promise.all([
        fsp.stat(tilePath(key)),
        fsp.readFile(tilePath(key)),
      ]);
      return { at: stat.mtimeMs, buf };
    } catch { return null; }
  }

  async function writeDiskTile(key, buf) {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      await fsp.writeFile(tilePath(key), buf);
    } catch (err) {
      console.warn(`[tomtom-proxy] tile cache write failed for ${key}:`, err?.message || err);
    }
  }

  /** LRU-ish memory insert (Map preserves insertion order; evict the oldest). */
  function memSet(key, entry) {
    if (!mem.has(key) && mem.size >= MEM_MAX_ENTRIES) {
      const oldest = mem.keys().next().value;
      mem.delete(oldest);
    }
    mem.set(key, entry);
  }

  async function fetchUpstream(z, x, y) {
    const url = 'https://api.tomtom.com/traffic/map/4/tile/flow/relative/'
      + `${z}/${x}/${y}.pbf?key=${encodeURIComponent(process.env.TOMTOM_API_KEY)}`;
    recordUpstreamFetch(); // attempts count — upstream bills the request either way
    const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error('empty tile body');
    return buf;
  }

  return {
    name: 'tomtom-proxy',
    configureServer(server) {
      server.middlewares.use('/api/tomtom', async (req, res) => {
        // Sanitized responses only (proxy/security baseline): no upstream
        // error details, and never echo the key or the upstream URL.
        const sendJson = (status, obj, extraHeaders = {}) => {
          if (res.headersSent) return;
          res.writeHead(status, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            ...extraHeaders,
          });
          res.end(JSON.stringify(obj));
        };
        const sendTile = (buf, cacheStatus) => {
          if (res.headersSent) return;
          res.writeHead(200, {
            'Content-Type': 'application/x-protobuf',
            'Cache-Control': 'no-store',
            'x-tomtom-cache': cacheStatus,
          });
          res.end(buf);
        };

        try {
          await loadBudgetOnce();
          const urlPath = String(req.url || '').split('?')[0];

          if (urlPath === '/status') {
            const hasKey = Boolean(process.env.TOMTOM_API_KEY);
            const b = currentBudget();
            sendJson(200, { hasKey, dailyCount: b.count, budget: dailyBudgetLimit(), date: b.date });
            return;
          }

          const m = urlPath.match(/^\/flow\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
          if (!m) {
            sendJson(404, { error: 'not_found' });
            return;
          }
          const z = Number(m[1]);
          const x = Number(m[2]);
          const y = Number(m[3]);
          if (!isValidTomTomTile(z, x, y)) {
            sendJson(400, { error: 'invalid_tile' });
            return;
          }
          if (!process.env.TOMTOM_API_KEY) {
            sendJson(503, { error: 'no_key' });
            return;
          }

          const key = `${z}/${x}/${y}`;
          const now = Date.now();

          let entry = mem.get(key);
          if (!entry) {
            entry = await readDiskTile(key);
            if (entry) memSet(key, entry);
          }
          // Fresh cache hit — never counts against the budget.
          if (entry && now - entry.at < TILE_TTL_MS) {
            sendTile(entry.buf, 'HIT');
            return;
          }

          // Budget governor: over the soft cap, last-good data beats a dead layer.
          if (isTomTomOverBudget(currentBudget(), dailyBudgetLimit())) {
            if (entry) {
              sendTile(entry.buf, 'STALE-BUDGET');
            } else {
              sendJson(429, { error: 'budget' });
            }
            return;
          }

          // Stale or missing → refresh, single-flight per tile.
          if (!inflight.has(key)) {
            inflight.set(key, fetchUpstream(z, x, y)
              .then(async (buf) => {
                const fresh = { at: Date.now(), buf };
                memSet(key, fresh);
                await writeDiskTile(key, buf);
                return fresh;
              })
              .catch((err) => {
                console.warn(`[tomtom-proxy] ${key} fetch failed (${err?.message || err}) — serving stale if any`);
                return null;
              })
              .finally(() => inflight.delete(key)));
          }
          const fresh = await inflight.get(key);
          if (fresh) {
            sendTile(fresh.buf, 'MISS');
          } else if (entry) {
            sendTile(entry.buf, 'STALE-ERROR'); // upstream down — stale beats empty
          } else {
            sendJson(502, { error: 'upstream' });
          }
        } catch (err) {
          console.warn('[tomtom-proxy] error:', err?.message || err);
          sendJson(500, { error: 'proxy' });
        }
      });
    },
  };
}

/**
 * NASA FIRMS live active-fire proxy with a memory + disk cache.
 * Upstream: https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/{SOURCE}/world/2
 *
 * Merges three VIIRS NRT sources (NOAA-20, NOAA-21, Suomi-NPP — independent
 * satellites, no cross-source dedup) fetched sequentially with `days=2`
 * (`days=1` means "current UTC day", nearly empty just after 00:00Z) and
 * clamps to the trailing 24 h via src/data/firmsCsv.js. FIRMS quota is
 * 5,000 transactions / 10 min per MAP_KEY, so the cache is the point:
 * TTL 30 min, single-flight refresh, serve-stale-on-failure, and a
 * fresh-enough disk cache (.gev-cache/firms.json) prevents ANY upstream
 * fetch across dev-server restarts. Pattern mirrors celestrakProxy.
 *
 * Routes:
 *   GET /api/firms        → {fetchedAt, stale, ttlMs, sources, count, fires}
 *   GET /api/firms/status → {hasKey, lastFetch, count, stale, ttlMs, transactions}
 *
 * Keyless (no FIRMS_MAP_KEY): /api/firms → 503 {error:'no_key'}; status →
 * {hasKey:false}. Upstream is never touched without a key.
 *
 * @returns {import('vite').Plugin}
 */
function firmsProxy() {
  const TTL_MS = 30 * 60_000;
  const STATUS_TTL_MS = 5 * 60_000;
  const SOURCES = ['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'VIIRS_SNPP_NRT'];
  const CACHE_DIR = path.join(process.cwd(), '.gev-cache');
  const CACHE_PATH = path.join(CACHE_DIR, 'firms.json');

  /** @type {?{at: number, sources: Array<object>, fires: Array<object>}} */
  let mem = null;
  let diskChecked = false;
  /** @type {?Promise<?{at: number, sources: Array<object>, fires: Array<object>}>} single-flight refresh */
  let inflight = null;
  /** @type {?{at: number, transactions: ?{used: number, limit: number}}} mapkey_status cache */
  let statusCache = null;
  /** @type {?Promise<?{used: number, limit: number}>} */
  let statusInflight = null;

  const mapKey = () => String(process.env.FIRMS_MAP_KEY || '').trim();

  async function readDiskOnce() {
    if (diskChecked) return;
    diskChecked = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
      if (Number.isFinite(parsed?.at) && Array.isArray(parsed?.sources) && Array.isArray(parsed?.fires)) {
        mem = parsed;
      }
    } catch { /* no disk cache yet */ }
  }

  async function writeDisk(entry) {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      await fsp.writeFile(CACHE_PATH, JSON.stringify(entry), 'utf8');
    } catch (err) {
      console.warn('[firms-proxy] cache write failed:', err?.message || err);
    }
  }

  /**
   * Fetch + parse one FIRMS source. Throws on HTTP error or a non-CSV body
   * (FIRMS reports errors as HTML/plain text, never CSV). Never log the URL —
   * it embeds the MAP_KEY.
   */
  async function fetchSource(key, source) {
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${source}/world/2`;
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const records = parseFirmsCsv(await res.text());
    if (records === null) throw new Error('non-CSV upstream response');
    return records;
  }

  /**
   * Refresh all sources sequentially (quota courtesy — never in parallel).
   * Partial success (≥1 source ok) still produces a cacheable entry with the
   * failed sources marked ok:false; total failure throws so the caller can
   * serve stale.
   */
  async function refreshUpstream(key) {
    const now = Date.now();
    const sources = [];
    const fires = [];
    for (const source of SOURCES) {
      try {
        const records = filterTrailing24h(await fetchSource(key, source), now);
        sources.push({ source, count: records.length, ok: true });
        fires.push(...records);
      } catch (err) {
        console.warn(`[firms-proxy] ${source} fetch failed:`, err?.message || err);
        sources.push({ source, count: 0, ok: false });
      }
    }
    if (!sources.some((s) => s.ok)) throw new Error('all FIRMS sources failed');
    return { at: now, sources, fires };
  }

  /**
   * Cache entry → response payload. Fires are RE-filtered to the trailing
   * 24 h at serve time so a stale cache never serves >24h-old detections.
   */
  function buildPayload(entry, stale) {
    const fires = filterTrailing24h(entry.fires, Date.now());
    return {
      fetchedAt: entry.at,
      stale,
      ttlMs: TTL_MS,
      sources: entry.sources,
      count: fires.length,
      fires,
    };
  }

  /** mapkey_status transactions, cached 5 min, best-effort (null on failure). */
  function getTransactions(key) {
    const now = Date.now();
    if (statusCache && now - statusCache.at < STATUS_TTL_MS) {
      return Promise.resolve(statusCache.transactions);
    }
    if (!statusInflight) {
      statusInflight = (async () => {
        try {
          const url = `https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY=${encodeURIComponent(key)}`;
          const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = await res.json();
          const used = Number(body?.current_transactions);
          const limit = Number(body?.transaction_limit);
          return Number.isFinite(used) && Number.isFinite(limit) ? { used, limit } : null;
        } catch (err) {
          console.warn('[firms-proxy] mapkey status failed:', err?.message || err);
          return null;
        }
      })()
        .then((transactions) => {
          statusCache = { at: Date.now(), transactions };
          return transactions;
        })
        .finally(() => { statusInflight = null; });
    }
    return statusInflight;
  }

  return {
    name: 'firms-proxy',
    configureServer(server) {
      server.middlewares.use('/api/firms', async (req, res) => {
        const sendJson = (status, obj) => {
          if (res.headersSent) return;
          res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(obj));
        };
        try {
          const subPath = String(req.url || '').split('?')[0];
          const key = mapKey();
          await readDiskOnce();

          if (subPath === '/status') {
            if (!key) {
              sendJson(200, { hasKey: false, lastFetch: null, count: null, stale: false, ttlMs: TTL_MS, transactions: null });
              return;
            }
            const transactions = await getTransactions(key);
            sendJson(200, {
              hasKey: true,
              lastFetch: mem ? mem.at : null,
              count: mem ? mem.fires.length : null,
              stale: mem ? Date.now() - mem.at >= TTL_MS : false,
              ttlMs: TTL_MS,
              transactions,
            });
            return;
          }

          if (!key) {
            sendJson(503, { error: 'no_key' });
            return;
          }

          const entry = mem;
          if (entry && Date.now() - entry.at < TTL_MS) {
            sendJson(200, buildPayload(entry, false));
            return;
          }
          // Stale or missing → refresh, single-flight (concurrent requests
          // share one upstream pass). Capture the promise locally BEFORE
          // awaiting: the .finally() nulls `inflight` the moment it settles.
          if (!inflight) {
            inflight = refreshUpstream(key)
              .then(async (fresh) => {
                mem = fresh;
                await writeDisk(fresh);
                return fresh;
              })
              .catch((err) => {
                console.warn(`[firms-proxy] refresh failed (${err?.message || err}) — serving cache if any`);
                return null;
              })
              .finally(() => { inflight = null; });
          }
          const pending = inflight;
          const fresh = await pending;
          if (fresh) {
            sendJson(200, buildPayload(fresh, false));
          } else if (entry) {
            sendJson(200, buildPayload(entry, true)); // upstream down — stale beats empty
          } else {
            sendJson(502, { error: 'firms fetch failed and no cache available' });
          }
        } catch (err) {
          console.warn('[firms-proxy] error:', err?.message || err);
          sendJson(500, { error: 'firms proxy error' });
        }
      });
    },
  };
}

/**
 * NOAA NDBC marine-buoy proxy with a memory + disk cache.
 * Upstream: https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt
 *
 * One ~106 KB text file carries the latest observation from every reporting
 * station in the network (892 stations measured 2026-08-26), so unlike the
 * viewport-bounded proxies this one needs no bounding box: a single upstream
 * fetch serves the whole globe. Keyless — NDBC publishes without credentials.
 *
 * Courtesy, not quota, sets the cadence. NDBC stations report every 10–60
 * minutes and the observed spread of stamps in one file was 0.2–3.0 h
 * (median 0.8 h), so a 10-minute TTL already outpaces the data: polling
 * faster re-downloads bytes that cannot have changed. Disk cache survives
 * dev-server restarts, single-flight collapses concurrent refreshes, and a
 * failed upstream serves the last good report rather than an empty ocean.
 *
 * Routes:
 *   GET /api/ndbc        → {fetchedAt, stale, ttlMs, count, coverage, stations}
 *   GET /api/ndbc/status → {lastFetch, count, stale, ttlMs}
 *
 * @returns {import('vite').Plugin}
 */
function ndbcProxy() {
  const TTL_MS = 10 * 60_000;
  const UPSTREAM = 'https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt';
  const CACHE_DIR = path.join(process.cwd(), '.gev-cache');
  const CACHE_PATH = path.join(CACHE_DIR, 'ndbc.json');
  /** Observations older than this are dropped before they ever reach a client. */
  const MAX_AGE_MS = 12 * 3600_000;
  /**
   * Response-body ceiling. The real report is ~106 KB; 8 MB is a runaway
   * guard, not a size expectation.
   */
  const MAX_BYTES = 8 * 1024 * 1024;

  /** @type {?{at:number, stations:Array<object>, coverage:object}} */
  let mem = null;
  let diskChecked = false;
  /** @type {?Promise<?{at:number, stations:Array<object>, coverage:object}>} single-flight refresh */
  let inflight = null;

  async function readDiskOnce() {
    if (diskChecked) return;
    diskChecked = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
      if (Number.isFinite(parsed?.at) && Array.isArray(parsed?.stations)) {
        mem = parsed;
      }
    } catch { /* no disk cache yet */ }
  }

  async function writeDisk(entry) {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      await fsp.writeFile(CACHE_PATH, JSON.stringify(entry), 'utf8');
    } catch (err) {
      console.warn('[ndbc-proxy] cache write failed:', err?.message || err);
    }
  }

  /**
   * Fetch and parse the report.
   * Throws on HTTP error, oversized body, or a body that is not an NDBC
   * report — NDBC serves outage notices as HTML, which must never be cached
   * as "zero stations reporting".
   */
  async function refreshUpstream() {
    const now = Date.now();
    const res = await fetch(UPSTREAM, {
      signal: AbortSignal.timeout(30_000),
      headers: { Accept: 'text/plain' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      throw new Error(`oversized body (${declared} bytes)`);
    }
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('oversized body');

    const parsed = parseNdbcLatestObservations(text);
    if (parsed === null) throw new Error('upstream body is not an NDBC report');

    const stations = filterFreshObservations(parsed, now, MAX_AGE_MS);
    // A report that parsed but retained nothing is an upstream fault, not a
    // quiet ocean: every station in the network would have to fall silent at
    // once. Throwing here keeps the last good report in play.
    if (!stations.length) throw new Error('report retained no fresh stations');

    return { at: now, stations, coverage: summarizeObservations(stations) };
  }

  function buildPayload(entry, stale) {
    return {
      fetchedAt: entry.at,
      stale,
      ttlMs: TTL_MS,
      count: entry.stations.length,
      coverage: entry.coverage ?? summarizeObservations(entry.stations),
      source: 'NOAA NDBC',
      stations: entry.stations,
    };
  }

  return {
    name: 'gev-ndbc-proxy',
    configureServer(server) {
      server.middlewares.use('/api/ndbc', async (req, res) => {
        const sendJson = (status, obj) => {
          if (res.headersSent) return;
          res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(obj));
        };
        try {
          const subPath = String(req.url || '').split('?')[0];
          await readDiskOnce();

          if (subPath === '/status') {
            sendJson(200, {
              lastFetch: mem ? mem.at : null,
              count: mem ? mem.stations.length : null,
              stale: mem ? Date.now() - mem.at >= TTL_MS : false,
              ttlMs: TTL_MS,
            });
            return;
          }

          const entry = mem;
          if (entry && Date.now() - entry.at < TTL_MS) {
            sendJson(200, buildPayload(entry, false));
            return;
          }
          // Capture the promise locally BEFORE awaiting: .finally() nulls
          // `inflight` the moment it settles, so a later reader would
          // otherwise await a field that is already gone.
          if (!inflight) {
            inflight = refreshUpstream()
              .then(async (fresh) => {
                mem = fresh;
                await writeDisk(fresh);
                return fresh;
              })
              .catch((err) => {
                console.warn(`[ndbc-proxy] refresh failed (${err?.message || err}) — serving cache if any`);
                return null;
              })
              .finally(() => { inflight = null; });
          }
          const fresh = await inflight;
          if (fresh) {
            sendJson(200, buildPayload(fresh, false));
          } else if (entry) {
            sendJson(200, buildPayload(entry, true)); // upstream down — stale beats empty
          } else {
            sendJson(502, { error: 'NDBC fetch failed and no cache available' });
          }
        } catch (err) {
          console.warn('[ndbc-proxy] error:', err?.message || err);
          sendJson(500, { error: 'ndbc proxy error' });
        }
      });
    },
  };
}

/**
 * Vigicrues river-flood vigilance proxy with a memory + disk cache.
 * Upstream: https://www.vigicrues.gouv.fr/services/InfoVigiCru.geojson
 *
 * The upstream body is 2,245,691 bytes, served with NO gzip (the origin
 * ignores `Accept-Encoding`) and NO ETag or Last-Modified, so a conditional
 * GET is impossible and every poll would be a full 2.2 MB transfer. The map
 * itself changes twice a day (10:00 and 16:00 Paris, published ~5 min early),
 * more often during an episode. Polling that directly from the browser at any
 * useful cadence is indefensible, so this proxy splits the feed along its
 * real seam:
 *
 *   GET /api/vigicrues           → {fetchedAt, stale, ttlMs, updateTime,
 *                                   reference, geometryVersion, levels}
 *                                  ~10 KB: one integer per reach.
 *   GET /api/vigicrues/geometry  → {geometryVersion, reaches:[{id,name,parts}]}
 *                                  ~1.6 MB, fetched ONCE per session.
 *   GET /api/vigicrues/status    → {lastFetch, count, stale, ttlMs}
 *
 * The geometry is effectively static — the SCHAPI redraws reaches rarely — so
 * the client caches it against `geometryVersion` and re-fetches only when that
 * hash moves. Keyless: no credential is involved anywhere in this path.
 *
 * @returns {import('vite').Plugin}
 */
function vigicruesProxy() {
  const TTL_MS = 10 * 60_000;
  const UPSTREAM = 'https://www.vigicrues.gouv.fr/services/InfoVigiCru.geojson';
  const CACHE_DIR = path.join(process.cwd(), '.gev-cache');
  const CACHE_PATH = path.join(CACHE_DIR, 'vigicrues.json');

  /** @type {?{at:number, updateTime:?string, reference:?string, geometryVersion:string, levels:object, reaches:Array<object>}} */
  let mem = null;
  let diskChecked = false;
  /** @type {?Promise<?object>} single-flight refresh */
  let inflight = null;

  /**
   * Project the upstream FeatureCollection and stamp the fetch time.
   * The projection itself lives in `src/data/vigicruesFeed.js` so it can be
   * unit-tested against a real captured response — same split as firmsCsv.
   * @param {object} geojson
   * @returns {object}
   */
  function project(geojson) {
    return { at: Date.now(), ...projectVigicruesFeed(geojson) };
  }

  async function readDiskOnce() {
    if (diskChecked) return;
    diskChecked = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
      if (Number.isFinite(parsed?.at) && Array.isArray(parsed?.reaches)) mem = parsed;
    } catch { /* no disk cache yet */ }
  }

  async function writeDisk(entry) {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      await fsp.writeFile(CACHE_PATH, JSON.stringify(entry), 'utf8');
    } catch (err) {
      console.warn(`[vigicrues-proxy] cache write failed (${err?.message || err})`);
    }
  }

  async function refreshUpstream() {
    const response = await fetch(UPSTREAM, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
    const geojson = await response.json();
    if (!Array.isArray(geojson?.features)) throw new Error('upstream returned no features');
    return project(geojson);
  }

  return {
    name: 'vigicrues-proxy',
    configureServer(server) {
      server.middlewares.use('/api/vigicrues', async (req, res) => {
        const sendJson = (status, obj, cacheControl = 'no-store') => {
          if (res.headersSent) return;
          res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': cacheControl });
          res.end(JSON.stringify(obj));
        };
        try {
          const subPath = String(req.url || '').split('?')[0];
          await readDiskOnce();

          const entry = mem;
          const fresh = entry && Date.now() - entry.at < TTL_MS;
          let current = fresh ? entry : null;
          if (!current) {
            // Stale or missing → refresh, single-flight (concurrent requests
            // share one upstream pass). Capture the promise BEFORE awaiting:
            // .finally() nulls `inflight` the moment it settles.
            if (!inflight) {
              inflight = refreshUpstream()
                .then(async (next) => {
                  mem = next;
                  await writeDisk(next);
                  return next;
                })
                .catch((err) => {
                  console.warn(`[vigicrues-proxy] refresh failed (${err?.message || err}) — serving cache if any`);
                  return null;
                })
                .finally(() => { inflight = null; });
            }
            current = await inflight;
          }
          const served = current || entry;
          const stale = !current && Boolean(entry);

          if (subPath === '/status') {
            sendJson(200, {
              lastFetch: served ? served.at : null,
              count: served ? served.reaches.length : null,
              stale,
              ttlMs: TTL_MS,
            });
            return;
          }
          if (!served) {
            sendJson(502, { error: 'vigicrues fetch failed and no cache available' });
            return;
          }
          if (subPath === '/geometry') {
            sendJson(200, {
              geometryVersion: served.geometryVersion,
              reaches: served.reaches.map(({ id, name, updatedAt, parts }) => ({ id, name, updatedAt, parts })),
            });
            return;
          }
          sendJson(200, {
            fetchedAt: served.at,
            stale,
            ttlMs: TTL_MS,
            updateTime: served.updateTime,
            reference: served.reference,
            geometryVersion: served.geometryVersion,
            levels: served.levels,
          });
        } catch (err) {
          console.warn('[vigicrues-proxy] error:', err?.message || err);
          sendJson(500, { error: 'vigicrues proxy error' });
        }
      });
    },
  };
}

/**
 * Météo-France Vigilance proxy with a memory + disk cache.
 *
 * TWO upstreams, and the KEYLESS one is the default — which is the inverse of
 * what the API portal suggests:
 *
 *  1. `files.data.gouv.fr/meteofrance/data/vigilance/metropole/YYYY/MM/DD/HHMMSS/
 *     CDP_CARTE_EXTERNE.json` — Météo-France's own real-time mirror on
 *     data.gouv.fr, under Licence Ouverte 2.0, needing no credential at all. A
 *     run generated at 04:00:28Z carried `Last-Modified: 04:00:48 GMT`: a
 *     20-second publication lag, not an archive. There is no `latest` symlink,
 *     so the newest run is discovered by listing the day directory — 686 bytes
 *     of HTML — and taking the highest `HHMMSS` name. (Do NOT use
 *     `vigilance-hexagone-tree.json` for this: it is 959 KB.)
 *     It sends no CORS header, which is the only reason this proxy must exist.
 *  2. `public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours`
 *     when `METEOFRANCE_API_KEY` is set. Same product, contracted 99.9%
 *     availability, 60 req/min. Sent as an `apikey:` header — the portal's
 *     OAuth2 dance is not needed, and the key stays server-side either way.
 *
 * The upstream JSON is 219 KB and is served without gzip. The client needs
 * about 6 KB of it, so this proxy projects the product down to one colour per
 * département per échéance.
 *
 * Routes:
 *   GET /api/vigilance        → {fetchedAt, stale, ttlMs, source, updateTime,
 *                                reference, national, periods:{J,J1}}
 *   GET /api/vigilance/status → {source, hasKey, lastFetch, stale, ttlMs}
 *
 * @returns {import('vite').Plugin}
 */
function meteoFranceVigilanceProxy() {
  // 12 polls/hour is 0.3% of the authenticated 60 req/min budget and bounds
  // staleness to 5 minutes, which comfortably catches even the 38-runs-a-day
  // crisis pattern observed on 2026-01-08.
  const TTL_MS = 5 * 60_000;
  const MIRROR_BASE = 'https://files.data.gouv.fr/meteofrance/data/vigilance/metropole';
  const API_URL = 'https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours';
  const CACHE_DIR = path.join(process.cwd(), '.gev-cache');
  const CACHE_PATH = path.join(CACHE_DIR, 'meteofrance-vigilance.json');

  /** @type {?{at:number, source:string, updateTime:?string, reference:?string, national:?number, periods:object}} */
  let mem = null;
  let diskChecked = false;
  /** @type {?Promise<?object>} */
  let inflight = null;

  const apiKey = () => String(process.env.METEOFRANCE_API_KEY || '').trim();

  /**
   * Project the CDP_CARTE_EXTERNE product and stamp the fetch time.
   * The projection itself lives in `src/data/meteoFranceVigilanceFeed.js` so
   * it can be unit-tested against a real captured payload.
   * @param {object} payload
   * @param {string} source
   * @returns {object}
   */
  function project(payload, source) {
    return { at: Date.now(), ...projectVigilanceProduct(payload, source) };
  }

  /** UTC day path segment, e.g. "2026/08/26". The archive is keyed by UTC. */
  function dayPath(date) {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    return `${yyyy}/${mm}/${dd}`;
  }

  /**
   * Newest run directory for a UTC day, or null when the day has none yet.
   * The index is 686 bytes of nginx-style HTML; the run names are the only
   * six-digit tokens in it.
   * @param {Date} date
   * @returns {Promise<?string>}
   */
  async function latestRun(date) {
    const response = await fetch(`${MIRROR_BASE}/${dayPath(date)}/`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const html = await response.text();
    const runs = [...html.matchAll(/\b(\d{6})\b/g)].map((match) => match[1]);
    if (!runs.length) return null;
    return runs.sort().at(-1);
  }

  async function refreshFromMirror() {
    const now = new Date();
    // Just after 00:00 UTC today's directory may not exist yet, and the newest
    // bulletin is still filed under yesterday.
    for (const offsetDays of [0, 1]) {
      const day = new Date(now.getTime() - offsetDays * 86400_000);
      const run = await latestRun(day);
      if (!run) continue;
      const response = await fetch(`${MIRROR_BASE}/${dayPath(day)}/${run}/CDP_CARTE_EXTERNE.json`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) continue;
      const payload = await response.json();
      if (!payload?.product) continue;
      return project(payload, 'data.gouv.fr mirror');
    }
    throw new Error('no vigilance run found in the last two UTC days');
  }

  async function refreshFromApi(key) {
    const response = await fetch(API_URL, {
      headers: { apikey: key, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload?.product) throw new Error('upstream returned no product');
    return project(payload, 'public-api.meteofrance.fr');
  }

  /**
   * The authenticated API is the preferred source when a key is configured,
   * but a key problem must not take the layer down when a licence-clean
   * keyless mirror of the same product is one request away.
   */
  async function refreshUpstream() {
    const key = apiKey();
    if (key) {
      try {
        return await refreshFromApi(key);
      } catch (err) {
        console.warn(`[vigilance-proxy] keyed fetch failed (${err?.message || err}) — falling back to the data.gouv.fr mirror`);
      }
    }
    return refreshFromMirror();
  }

  async function readDiskOnce() {
    if (diskChecked) return;
    diskChecked = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
      if (Number.isFinite(parsed?.at) && parsed?.periods) mem = parsed;
    } catch { /* no disk cache yet */ }
  }

  async function writeDisk(entry) {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      await fsp.writeFile(CACHE_PATH, JSON.stringify(entry), 'utf8');
    } catch (err) {
      console.warn(`[vigilance-proxy] cache write failed (${err?.message || err})`);
    }
  }

  return {
    name: 'meteofrance-vigilance-proxy',
    configureServer(server) {
      server.middlewares.use('/api/vigilance', async (req, res) => {
        const sendJson = (status, obj) => {
          if (res.headersSent) return;
          res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(obj));
        };
        try {
          const subPath = String(req.url || '').split('?')[0];
          await readDiskOnce();

          const entry = mem;
          let current = entry && Date.now() - entry.at < TTL_MS ? entry : null;
          if (!current) {
            if (!inflight) {
              inflight = refreshUpstream()
                .then(async (next) => {
                  mem = next;
                  await writeDisk(next);
                  return next;
                })
                .catch((err) => {
                  console.warn(`[vigilance-proxy] refresh failed (${err?.message || err}) — serving cache if any`);
                  return null;
                })
                .finally(() => { inflight = null; });
            }
            current = await inflight;
          }
          const served = current || entry;
          const stale = !current && Boolean(entry);

          if (subPath === '/status') {
            sendJson(200, {
              hasKey: Boolean(apiKey()),
              source: served ? served.source : null,
              lastFetch: served ? served.at : null,
              stale,
              ttlMs: TTL_MS,
            });
            return;
          }
          if (!served) {
            sendJson(502, { error: 'vigilance fetch failed and no cache available' });
            return;
          }
          sendJson(200, {
            fetchedAt: served.at,
            stale,
            ttlMs: TTL_MS,
            source: served.source,
            updateTime: served.updateTime,
            reference: served.reference,
            national: served.national,
            periods: served.periods,
          });
        } catch (err) {
          console.warn('[vigilance-proxy] error:', err?.message || err);
          sendJson(500, { error: 'vigilance proxy error' });
        }
      });
    },
  };
}

/**
 * éCO2mix proxy (France's live electricity mix) with a memory + disk cache.
 *
 * ONE keyless upstream, and deliberately not the obvious one: RTE's own
 * `data.rte-france.com` API carries the same figures but requires an OAuth2
 * client-credentials account, while **ODRÉ** (Open Data Réseaux Énergies,
 * operated by RTE with GRTgaz and Teréga) republishes them on an Opendatasoft
 * instance with no credential at all, under Licence Ouverte 2.0. A layer that
 * works on `git clone` beats a layer that works after a registration form.
 *
 * Two datasets are fetched in PARALLEL and cached as one document:
 *   `eco2mix-national-tr`  — France hors Corse, 15-minute cadence
 *   `eco2mix-regional-tr`  — the 12 metropolitan regions, same cadence
 *
 * They are fetched with `Promise.allSettled`, not `Promise.all`: a regional
 * outage must not blank the national gauge, and vice versa. A half-failed
 * refresh is merged over the previous cache rather than replacing it, so the
 * surviving half keeps its last known good value instead of going null.
 *
 * MEASURED 2026-08-27: national 200 in 0.30 s / ~1 KB for limit=1; regional
 * 200 in 0.23 s; all 12 regions shared one `date_heure`; the newest measured
 * point was 07:45Z against a 07:53Z wall clock — an ~8 minute publication lag.
 *
 * WHY A PROXY when Opendatasoft does send CORS headers and a direct browser
 * fetch works: the anonymous ODRÉ quota is per-IP, so N open tabs would each
 * bill their own calls; the raw pair is ~25 KB against the ~4 KB the globe
 * needs; and `ORDER BY date_heure DESC` alone returns tomorrow's all-null
 * forecast padding, a trap best absorbed once, server-side, under test.
 *
 * Routes:
 *   GET /api/energy-fr        → {fetchedAt, stale, ttlMs, source, national, regions}
 *   GET /api/energy-fr/status → {source, lastFetch, stale, ttlMs, regionCount}
 *
 * @returns {import('vite').Plugin}
 */
function eco2mixProxy() {
  // The product publishes every 15 minutes with an ~8 minute lag, so a 4-minute
  // cache bounds staleness well inside one step while costing 720 upstream
  // calls a day — a rounding error against the anonymous Opendatasoft quota.
  const TTL_MS = 4 * 60_000;
  const BASE = 'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets';
  // `consommation IS NOT NULL` is the forecast-padding filter (see
  // `eco2mixFeed.js`, trap 1). The row limits are deliberately > 1: they cover
  // a late republication without a second round trip, and `projectNational` /
  // `projectRegional` pick the newest measured row themselves.
  const NATIONAL_URL = `${BASE}/eco2mix-national-tr/records`
    + '?limit=3&order_by=date_heure%20desc&where=consommation%20IS%20NOT%20NULL';
  // 36 rows = three 15-minute steps × 12 regions, so every region still resolves
  // when one of them lags a step or two behind the others.
  const REGIONAL_URL = `${BASE}/eco2mix-regional-tr/records`
    + '?limit=36&order_by=date_heure%20desc&where=consommation%20IS%20NOT%20NULL';
  const CACHE_DIR = path.join(process.cwd(), '.gev-cache');
  const CACHE_PATH = path.join(CACHE_DIR, 'eco2mix.json');
  const SOURCE = 'ODRÉ (odre.opendatasoft.com)';

  /** @type {?{at:number, source:string, national:?object, regions:Array<object>, regionCount:number}} */
  let mem = null;
  let diskChecked = false;
  /** @type {?Promise<?object>} */
  let inflight = null;

  async function fetchJson(url) {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload?.results)) throw new Error('upstream returned no results array');
    return payload;
  }

  /**
   * Refresh both halves, keeping whichever succeeded.
   * @param {?object} previous Last good document, merged under a partial refresh.
   */
  async function refreshUpstream(previous) {
    const [national, regional] = await Promise.allSettled([
      fetchJson(NATIONAL_URL),
      fetchJson(REGIONAL_URL),
    ]);
    for (const [label, settled] of [['national', national], ['regional', regional]]) {
      if (settled.status === 'rejected') {
        console.warn(`[eco2mix-proxy] ${label} fetch failed (${settled.reason?.message || settled.reason})`);
      }
    }
    if (national.status === 'rejected' && regional.status === 'rejected') {
      throw new Error('both éCO2mix datasets are unavailable');
    }
    const projected = projectEco2mix({
      national: national.status === 'fulfilled' ? national.value : null,
      regional: regional.status === 'fulfilled' ? regional.value : null,
    }, SOURCE);
    return {
      at: Date.now(),
      source: projected.source,
      // Merge, don't replace: the half that failed keeps its last good value
      // rather than reporting null, which would read as "France stopped".
      national: projected.national || previous?.national || null,
      regions: projected.regions.length ? projected.regions : (previous?.regions || []),
      regionCount: projected.regions.length || previous?.regionCount || 0,
    };
  }

  async function readDiskOnce() {
    if (diskChecked) return;
    diskChecked = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
      if (Number.isFinite(parsed?.at) && Array.isArray(parsed?.regions)) mem = parsed;
    } catch { /* no disk cache yet */ }
  }

  async function writeDisk(entry) {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      await fsp.writeFile(CACHE_PATH, JSON.stringify(entry), 'utf8');
    } catch (err) {
      console.warn(`[eco2mix-proxy] cache write failed (${err?.message || err})`);
    }
  }

  function install(middlewares) {
    middlewares.use('/api/energy-fr', async (req, res) => {
      const sendJson = (status, obj) => {
        if (res.headersSent) return;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(obj));
      };
      try {
        const subPath = String(req.url || '').split('?')[0];
        await readDiskOnce();

        const entry = mem;
        let current = entry && Date.now() - entry.at < TTL_MS ? entry : null;
        if (!current) {
          if (!inflight) {
            inflight = refreshUpstream(entry)
              .then(async (next) => {
                mem = next;
                await writeDisk(next);
                return next;
              })
              .catch((err) => {
                console.warn(`[eco2mix-proxy] refresh failed (${err?.message || err}) — serving cache if any`);
                return null;
              })
              .finally(() => { inflight = null; });
          }
          current = await inflight;
        }
        const served = current || entry;
        const stale = !current && Boolean(entry);

        if (subPath === '/status') {
          sendJson(200, {
            source: served ? served.source : null,
            lastFetch: served ? served.at : null,
            regionCount: served ? served.regionCount : 0,
            stale,
            ttlMs: TTL_MS,
          });
          return;
        }
        if (!served) {
          sendJson(502, { error: 'éCO2mix fetch failed and no cache available' });
          return;
        }
        sendJson(200, {
          fetchedAt: served.at,
          stale,
          ttlMs: TTL_MS,
          source: served.source,
          national: served.national,
          regions: served.regions,
        });
      } catch (err) {
        console.warn('[eco2mix-proxy] error:', err?.message || err);
        sendJson(500, { error: 'éCO2mix proxy error' });
      }
    });
  }

  return {
    name: 'eco2mix-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

// ---------------------------------------------------------------------------
// IRVE charge-point proxy (France's public EV charging register)
// ---------------------------------------------------------------------------
/**
 * The consolidation runs once a day, so a 6-hour cache costs nothing real and
 * a cold viewport is paid for at most four times a day.
 */
const IRVE_TTL_MS = 6 * 60 * 60 * 1000;
/** Serve-stale ceiling when ODRÉ is down. A register a week old is still a register. */
const IRVE_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const IRVE_TIMEOUT_MS = 30_000;
/** Byte cap on one grouped answer. The densest measured box (Paris, 0.35°) is 3.3 MB. */
const IRVE_MAX_BYTES = 24 * 1024 * 1024;
const IRVE_VIEWPORT_CACHE_MAX = 24;
const IRVE_RECORDS_URL = `https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/${IRVE_DATASET}/records`;
const IRVE_DISK_DIR = path.join(process.cwd(), '.gev-cache', 'irve');

/** box key -> {at:number, payload:object} */
const _irveViewportCache = new Map();
const _irveViewportInFlight = new Map();
const _irveRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 180 });

function trimIrveViewportCache() {
  while (_irveViewportCache.size > IRVE_VIEWPORT_CACHE_MAX) {
    const oldest = _irveViewportCache.keys().next().value;
    if (oldest === undefined) break;
    _irveViewportCache.delete(oldest);
  }
}

/** Snapped box key -> stable disk-cache file path. */
function irveDiskPath(key) {
  return path.join(IRVE_DISK_DIR, `${createHash('sha1').update(key).digest('hex')}.json`);
}

/** Read a disk-cached viewport answer. `maxAgeMs` Infinity = any age. */
async function readIrveDisk(key, maxAgeMs) {
  try {
    const entry = JSON.parse(await fsp.readFile(irveDiskPath(key), 'utf8'));
    if (!Number.isFinite(entry?.at) || !Array.isArray(entry?.payload?.sites)) return null;
    if (Date.now() - entry.at > maxAgeMs) return null;
    return entry;
  } catch {
    return null;
  }
}

/** Fire-and-forget disk write for a successful viewport answer. */
function writeIrveDisk(key, entry) {
  fsp.mkdir(IRVE_DISK_DIR, { recursive: true })
    .then(() => fsp.writeFile(irveDiskPath(key), JSON.stringify(entry)))
    .catch((err) => console.warn('[IRVE Proxy] disk cache write failed:', err?.message || err));
}

/** GET one Opendatasoft URL as JSON, under a timeout and a byte cap. */
async function fetchIrveJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(IRVE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
  return readResponseJsonCapped(response, IRVE_MAX_BYTES);
}

/**
 * Fetch one viewport and fold it into sites.
 *
 * The two calls run in PARALLEL and mean different things. The grouped call is
 * the answer; the `limit=0` call is the dataset's own count for the same box,
 * and exists only so `projectIrveSites` can prove the grouped answer was
 * complete. A silent aggregation cap is the one failure mode Opendatasoft
 * would not report as an error, and it would look exactly like a quiet city.
 *
 * @param {{south:number, west:number, north:number, east:number}} box Snapped box.
 * @returns {Promise<object>} Client payload.
 */
async function refreshIrveViewport(box) {
  const where = irveBboxWhere(box);
  const fields = IRVE_GROUP_FIELDS.join(',');
  const grouped = new URLSearchParams({
    where,
    group_by: fields,
    select: `${fields},count(*) as pdc`,
    limit: String(IRVE_GROUP_LIMIT),
  });
  const counted = new URLSearchParams({ where, limit: '0' });

  const [groupedResult, countResult] = await Promise.allSettled([
    fetchIrveJson(`${IRVE_RECORDS_URL}?${grouped}`),
    fetchIrveJson(`${IRVE_RECORDS_URL}?${counted}`),
  ]);
  if (groupedResult.status === 'rejected') {
    throw new Error(groupedResult.reason?.message || 'grouped query failed');
  }
  if (countResult.status === 'rejected') {
    // The count is a completeness PROOF, not the data. Losing it degrades the
    // guarantee to "unknown" rather than blanking a viewport that arrived.
    console.warn('[IRVE Proxy] box count unavailable:', countResult.reason?.message || countResult.reason);
  }

  const projected = projectIrveSites({
    groups: groupedResult.value?.results,
    totalCount: countResult.status === 'fulfilled' ? countResult.value?.total_count : null,
  });
  return {
    ...projected,
    box,
    dataset: IRVE_DATASET,
    maxBoxDeg: IRVE_MAX_BOX_DEG,
  };
}


/**
 * Bundled département polygons, read once from disk.
 *
 * The dev-server proxy reads the same file the browser layer fetches
 * (`src/data/local_data/france_departements/`), so the national rollup and the
 * shapes it is painted on can never come from two different vintages.
 */
let _irveDepartementIndex = null;
async function loadIrveDepartementIndex() {
  if (_irveDepartementIndex) return _irveDepartementIndex;
  const file = path.join(process.cwd(), 'src', 'data', 'local_data', 'france_departements', 'departements.geojson');
  _irveDepartementIndex = buildDepartementIndex(JSON.parse(await fsp.readFile(file, 'utf8')));
  return _irveDepartementIndex;
}

/** Grouped stripes are answered concurrently, but politely — this is one anonymous quota. */
const IRVE_SWEEP_CONCURRENCY = 5;
/** The national rollup is rebuilt daily upstream; a 24-hour cache matches it. */
const IRVE_NATIONAL_TTL_MS = 24 * 60 * 60 * 1000;
const IRVE_NATIONAL_CACHE_PATH = path.join(IRVE_DISK_DIR, 'departements.json');
/**
 * Shape version of the cached national rollup.
 *
 * Bump this whenever `projectIrveDepartements` changes what it returns. The
 * cache lives for a day on disk, so without it an edit to the projection is
 * invisible until tomorrow — and the version that caught this was a coastal
 * snap that the served payload silently did not have.
 */
const IRVE_NATIONAL_CACHE_VERSION = 3;

/** @type {?{at:number, payload:object}} */
let _irveNational = null;
/** @type {?Promise<object>} */
let _irveNationalInFlight = null;
let _irveNationalDiskChecked = false;

/** Fetch one latitude stripe of the national sweep, grouped. */
async function fetchIrveStripe(lo, hi) {
  const fields = IRVE_SWEEP_FIELDS.join(',');
  const params = new URLSearchParams({
    where: `consolidated_latitude>=${lo} AND consolidated_latitude<${hi}`,
    group_by: fields,
    select: `${fields},count(*) as pdc`,
    limit: String(IRVE_SWEEP_LIMIT),
  });
  const payload = await fetchIrveJson(`${IRVE_RECORDS_URL}?${params}`);
  return Array.isArray(payload?.results) ? payload.results : [];
}

/**
 * Sweep the whole dataset in latitude stripes, splitting any stripe that comes
 * back at the aggregation limit.
 *
 * The split is the only defence against a truncation Opendatasoft does not
 * report: an over-limit aggregated query returns exactly `limit` rows with
 * HTTP 200 and no error field, so "did this stripe reach the limit" is the
 * single available signal. `IRVE_SWEEP_MIN_SPAN_DEG` bounds the recursion,
 * because the value being split on is upstream-controlled; a stripe still at
 * the limit down there is returned as `stalled` and surfaces in the payload
 * rather than halving for ever.
 *
 * @returns {Promise<{rows:Array<object>, calls:number, stalled:Array<object>}>}
 */
async function sweepIrveNational() {
  let queue = [];
  for (let lo = -90; lo < 90; lo += IRVE_SWEEP_SEED_SPAN_DEG) {
    queue.push({ lo, hi: Math.min(90, lo + IRVE_SWEEP_SEED_SPAN_DEG) });
  }
  const rows = [];
  const stalled = [];
  let calls = 0;

  while (queue.length) {
    const batch = queue.splice(0, IRVE_SWEEP_CONCURRENCY);
    const answers = await Promise.all(batch.map(async (stripe) => {
      calls += 1;
      return { stripe, results: await fetchIrveStripe(stripe.lo, stripe.hi) };
    }));
    const next = [];
    for (const { stripe, results } of answers) {
      if (!sweepStripeTruncated(results.length)) {
        rows.push(...results);
        continue;
      }
      const span = stripe.hi - stripe.lo;
      if (span <= IRVE_SWEEP_MIN_SPAN_DEG) {
        // Keep what came back and say it is short, rather than pretend.
        rows.push(...results);
        stalled.push(stripe);
        continue;
      }
      const mid = stripe.lo + span / 2;
      next.push({ lo: stripe.lo, hi: mid }, { lo: mid, hi: stripe.hi });
    }
    queue = next.concat(queue);
  }
  return { rows, calls, stalled };
}

/** Build the national rollup: sweep, verify, then fold onto the polygons. */
async function refreshIrveNational() {
  const started = Date.now();
  const [index, counted, swept] = await Promise.all([
    loadIrveDepartementIndex(),
    fetchIrveJson(`${IRVE_RECORDS_URL}?${new URLSearchParams({ limit: '0' })}`)
      .catch((error) => {
        console.warn('[IRVE Proxy] national count unavailable:', error?.message || error);
        return null;
      }),
    sweepIrveNational(),
  ]);

  const projected = projectIrveDepartements({
    groups: swept.rows,
    index,
    totalCount: counted?.total_count ?? null,
  });
  if (projected.truncated || swept.stalled.length) {
    console.warn(
      `[IRVE Proxy] national sweep incomplete: ${projected.pdcSwept}/${projected.pdcTotal} charge points`
      + `${swept.stalled.length ? `, ${swept.stalled.length} stripe(s) still at the limit` : ''}`,
    );
  }
  // The two documents are cached together because one sweep builds both, and
  // served apart because they are read at different moments and at wildly
  // different sizes: the rollup is 18 KB and arrives with the layer, the mesh
  // is ~0.9 MB and is only fetched if the operator zooms past the choropleth.
  const { mesh, ...rollup } = projected;
  return {
    rollup: {
      ...rollup,
      stalledStripes: swept.stalled.length,
      upstreamCalls: swept.calls,
      sweptInMs: Date.now() - started,
      dataset: IRVE_DATASET,
      source: IRVE_SOURCE,
    },
    mesh: {
      sites: mesh,
      siteCount: mesh.length,
      pdc: rollup.pdcAssigned,
      bands: IRVE_BAND_KEYS,
      dataset: IRVE_DATASET,
      source: IRVE_SOURCE,
    },
  };
}

/** Load the national rollup from disk once, lazily. */
async function readIrveNationalDisk() {
  if (_irveNationalDiskChecked) return;
  _irveNationalDiskChecked = true;
  try {
    const entry = JSON.parse(await fsp.readFile(IRVE_NATIONAL_CACHE_PATH, 'utf8'));
    if (entry?.version === IRVE_NATIONAL_CACHE_VERSION
      && Number.isFinite(entry.at)
      && Array.isArray(entry.payload?.rollup?.departements)
      && Array.isArray(entry.payload?.mesh?.sites)) {
      _irveNational = entry;
    }
  } catch { /* no disk cache yet */ }
}

function writeIrveNationalDisk(entry) {
  fsp.mkdir(IRVE_DISK_DIR, { recursive: true })
    .then(() => fsp.writeFile(IRVE_NATIONAL_CACHE_PATH, JSON.stringify(entry)))
    .catch((err) => console.warn('[IRVE Proxy] national cache write failed:', err?.message || err));
}

/**
 * Vite plugin: viewport-bounded French charge-point proxy.
 *
 *   GET /api/irve-fr/sites?south&west&north&east — charging sites in one box
 *   GET /api/irve-fr/departements                — national rollup, 96 départements
 *   GET /api/irve-fr/mesh                        — the national point set, once
 *   GET /api/irve-fr/status                      — dataset provenance + cache state
 *
 * WHY A PROXY at all, when Opendatasoft sends CORS headers and a browser could
 * fetch this directly: the anonymous ODRÉ quota is per-IP, so N open tabs
 * would each bill their own calls; the traps in `irveFeed.js` are absorbed
 * once, server-side, under test, instead of in every client; and the shape
 * changes completely on the way through. The densest real viewport is 22 348
 * charge points, which Opendatasoft's own `group_by` collapses to 4 996 rows
 * (3.3 MB) and this proxy folds again to ~2 700 sites — the browser is served
 * the sites, never the 17 MB of charge points behind them.
 *
 * @returns {import('vite').Plugin}
 */
function irveFranceProxy() {
  function install(middlewares) {
    middlewares.use('/api/irve-fr', async (req, res) => {
      const json = (status, body, headers = {}) => {
        if (res.headersSent) return;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'GET') {
        json(405, { error: 'Method Not Allowed' });
        return;
      }
      if (!_irveRateLimiter(clientKey(req))) {
        json(429, { error: 'Rate limit exceeded' }, { 'Retry-After': '5' });
        return;
      }

      const url = new URL(req.url || '/', 'http://localhost');
      const route = url.pathname.replace(/\/+$/, '') || '/';

      if (route === '/status') {
        let newest = null;
        for (const entry of _irveViewportCache.values()) {
          if (!newest || entry.at > newest) newest = entry.at;
        }
        json(200, {
          source: IRVE_SOURCE,
          dataset: IRVE_DATASET,
          lastFetch: newest,
          cachedBoxes: _irveViewportCache.size,
          ttlMs: IRVE_TTL_MS,
          maxBoxDeg: IRVE_MAX_BOX_DEG,
          national: _irveNational
            ? {
              at: _irveNational.at,
              painted: _irveNational.payload.rollup.painted,
              pdc: _irveNational.payload.rollup.pdcAssigned,
              meshSites: _irveNational.payload.mesh.siteCount,
            }
            : null,
          nationalTtlMs: IRVE_NATIONAL_TTL_MS,
        }, { 'Cache-Control': 'public, max-age=60' });
        return;
      }
      if (route === '/departements') {
        await readIrveNationalDisk();
        const now = Date.now();
        if (_irveNational && now - _irveNational.at <= IRVE_NATIONAL_TTL_MS) {
          json(200, { ..._irveNational.payload.rollup, fetchedAt: _irveNational.at, stale: false }, { 'X-IRVE-FR': 'HIT' });
          return;
        }
        if (!_irveNationalInFlight) {
          _irveNationalInFlight = refreshIrveNational()
            .then((payload) => {
              const entry = { version: IRVE_NATIONAL_CACHE_VERSION, at: Date.now(), payload };
              _irveNational = entry;
              writeIrveNationalDisk(entry);
              return entry;
            })
            .finally(() => { _irveNationalInFlight = null; });
        }
        try {
          const entry = await _irveNationalInFlight;
          json(200, { ...entry.payload.rollup, fetchedAt: entry.at, stale: false }, { 'X-IRVE-FR': 'MISS' });
        } catch (error) {
          console.warn('[IRVE Proxy] national rollup unavailable:', error?.message || error);
          // A rollup a week old is still a true picture of a register that is
          // rebuilt daily — serving it beats blanking the national view.
          if (_irveNational) {
            json(200, { ..._irveNational.payload.rollup, fetchedAt: _irveNational.at, stale: true }, { 'X-IRVE-FR': 'STALE' });
            return;
          }
          json(503, { error: 'French charge-point register is temporarily unavailable' });
        }
        return;
      }
      if (route === '/mesh') {
        // The whole national point set, once. It is served entire and thinned
        // in the CLIENT (`irveMesh.js`) rather than per request, because the
        // thinning is a function of the viewport and a round trip on every
        // pan would make the middle regime feel worse than either of the two
        // it sits between. ~0.9 MB, cached for a day, fetched at most once a
        // session — and only if the operator leaves the choropleth.
        await readIrveNationalDisk();
        const now = Date.now();
        if (_irveNational && now - _irveNational.at <= IRVE_NATIONAL_TTL_MS) {
          json(200, { ..._irveNational.payload.mesh, fetchedAt: _irveNational.at, stale: false }, { 'X-IRVE-FR': 'HIT' });
          return;
        }
        if (!_irveNationalInFlight) {
          _irveNationalInFlight = refreshIrveNational()
            .then((payload) => {
              const entry = { version: IRVE_NATIONAL_CACHE_VERSION, at: Date.now(), payload };
              _irveNational = entry;
              writeIrveNationalDisk(entry);
              return entry;
            })
            .finally(() => { _irveNationalInFlight = null; });
        }
        try {
          const entry = await _irveNationalInFlight;
          json(200, { ...entry.payload.mesh, fetchedAt: entry.at, stale: false }, { 'X-IRVE-FR': 'MISS' });
        } catch (error) {
          console.warn('[IRVE Proxy] national mesh unavailable:', error?.message || error);
          if (_irveNational) {
            json(200, { ..._irveNational.payload.mesh, fetchedAt: _irveNational.at, stale: true }, { 'X-IRVE-FR': 'STALE' });
            return;
          }
          json(503, { error: 'French charge-point register is temporarily unavailable' });
        }
        return;
      }
      if (route !== '/sites') {
        json(404, { error: 'Unknown IRVE endpoint' });
        return;
      }

      const requested = validBox({
        south: url.searchParams.get('south'),
        west: url.searchParams.get('west'),
        north: url.searchParams.get('north'),
        east: url.searchParams.get('east'),
      }, IRVE_MAX_BOX_DEG);
      if (!requested) {
        json(400, {
          error: `A non-dateline bbox no larger than ${IRVE_MAX_BOX_DEG} degrees is required`,
          maxBoxDeg: IRVE_MAX_BOX_DEG,
        });
        return;
      }

      const box = snapBoxOutward(requested, IRVE_BOX_STEP_DEG);
      const key = boxKey(box);
      const now = Date.now();

      const cached = _irveViewportCache.get(key);
      if (cached && now - cached.at <= IRVE_TTL_MS) {
        json(200, { ...cached.payload, fetchedAt: cached.at, stale: false }, { 'X-IRVE-FR': 'HIT' });
        return;
      }
      const onDisk = await readIrveDisk(key, IRVE_TTL_MS);
      if (onDisk) {
        _irveViewportCache.set(key, onDisk);
        trimIrveViewportCache();
        json(200, { ...onDisk.payload, fetchedAt: onDisk.at, stale: false }, { 'X-IRVE-FR': 'DISK' });
        return;
      }

      const request = coalesceProxyRequest(_irveViewportInFlight, key, async () => {
        const payload = await refreshIrveViewport(box);
        const entry = { at: Date.now(), payload };
        _irveViewportCache.set(key, entry);
        trimIrveViewportCache();
        writeIrveDisk(key, entry);
        return entry;
      });
      try {
        const entry = await request.promise;
        json(200, { ...entry.payload, fetchedAt: entry.at, stale: false }, {
          'X-IRVE-FR': request.shared ? 'INFLIGHT' : 'MISS',
        });
      } catch (error) {
        console.warn('[IRVE Proxy] viewport unavailable:', error?.message || error);
        const stale = cached || await readIrveDisk(key, IRVE_STALE_MS);
        if (stale) {
          json(200, { ...stale.payload, fetchedAt: stale.at, stale: true }, { 'X-IRVE-FR': 'STALE' });
          return;
        }
        json(503, { error: 'French charge-point register is temporarily unavailable' });
      }
    });
  }

  return {
    name: 'irve-france-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

/**
 * Annuaire de l'éducation proxy — keyless, Licence Ouverte 2.0.
 *
 *   GET /api/schools-fr/sites?south&west&north&east — schools in one box
 *   GET /api/schools-fr/departements                — national rollup, 96 départements
 *   GET /api/schools-fr/mesh                        — the national point set, once
 *   GET /api/schools-fr/status                      — dataset provenance + cache state
 *
 * WHY A PROXY, when data.education.gouv.fr sends CORS headers and a direct
 * browser fetch works: the roll is not in the register. Sizing a school by its
 * pupils means joining FOUR further datasets on the UAI, and doing that in the
 * client would mean every open tab downloading four national files and
 * re-deriving the same map. The join happens once, on a server, under test
 * (`schoolsFeed.js`, `schoolsDepartements.js`), and is cached for a day beside
 * the rollup the same sweep already builds.
 *
 * WHY `exports/json` AND NOT `records`: the Explore v2.1 `records` endpoint
 * caps a page at 100 rows, so the densest viewport (Paris at 0.35°, 5 506
 * schools — measured) would be 56 round trips. `exports/json` streams the
 * whole filtered set in one: 3.26 MB in 0.57 s for that same box. `records` is
 * still called alongside it, with `limit=0`, purely for its `total_count` —
 * that number is the completeness proof, and a short export is the one failure
 * Opendatasoft returns as HTTP 200.
 */
const SCHOOLS_BASE = `https://${SCHOOLS_PORTAL}/api/explore/v2.1/catalog/datasets`;
const SCHOOLS_RECORDS_URL = `${SCHOOLS_BASE}/${SCHOOLS_DATASET}/records`;
const SCHOOLS_EXPORT_URL = `${SCHOOLS_BASE}/${SCHOOLS_DATASET}/exports/json`;
/** The register is rebuilt daily; a cold viewport is paid for at most 4× a day. */
const SCHOOLS_TTL_MS = 6 * 60 * 60 * 1000;
/** Serve-stale ceiling. A register a week old is still a register. */
const SCHOOLS_STALE_MS = 7 * 24 * 60 * 60 * 1000;
/** The national rollup is rebuilt daily upstream; a 24-hour cache matches it. */
const SCHOOLS_NATIONAL_TTL_MS = 24 * 60 * 60 * 1000;
const SCHOOLS_TIMEOUT_MS = 45_000;
/** The national export is 8.5 MB; the densest viewport 3.3 MB. */
const SCHOOLS_MAX_BYTES = 64 * 1024 * 1024;
const SCHOOLS_VIEWPORT_CACHE_MAX = 24;
const SCHOOLS_DISK_DIR = path.join(process.cwd(), '.gev-cache', 'schools-fr');
const SCHOOLS_NATIONAL_CACHE_PATH = path.join(SCHOOLS_DISK_DIR, 'departements.json');
/**
 * Shape version of the cached national rollup. Bump whenever
 * `projectSchoolsDepartements` changes what it returns — the cache lives for a
 * day on disk, so without it a projection edit is invisible until tomorrow.
 */
const SCHOOLS_NATIONAL_CACHE_VERSION = 1;

/** box key -> {at:number, payload:object} */
const _schoolsViewportCache = new Map();
const _schoolsViewportInFlight = new Map();
const _schoolsRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 180 });

/** @type {?{at:number, payload:object}} */
let _schoolsNational = null;
/** @type {?Promise<object>} */
let _schoolsNationalInFlight = null;
let _schoolsNationalDiskChecked = false;
/** @type {?Promise<Map<string, number>>} UAI → pupils, built once per process. */
let _schoolsRollsPromise = null;

function trimSchoolsViewportCache() {
  while (_schoolsViewportCache.size > SCHOOLS_VIEWPORT_CACHE_MAX) {
    const oldest = _schoolsViewportCache.keys().next().value;
    if (oldest === undefined) break;
    _schoolsViewportCache.delete(oldest);
  }
}

function schoolsDiskPath(key) {
  return path.join(SCHOOLS_DISK_DIR, `${createHash('sha1').update(key).digest('hex')}.json`);
}

async function readSchoolsDisk(key, maxAgeMs) {
  try {
    const entry = JSON.parse(await fsp.readFile(schoolsDiskPath(key), 'utf8'));
    if (!Number.isFinite(entry?.at) || !Array.isArray(entry?.payload?.sites)) return null;
    if (Date.now() - entry.at > maxAgeMs) return null;
    return entry;
  } catch {
    return null;
  }
}

function writeSchoolsDisk(key, entry) {
  fsp.mkdir(SCHOOLS_DISK_DIR, { recursive: true })
    .then(() => fsp.writeFile(schoolsDiskPath(key), JSON.stringify(entry)))
    .catch((err) => console.warn('[Schools Proxy] disk cache write failed:', err?.message || err));
}

/** GET one Opendatasoft URL as JSON, under a timeout and a byte cap. */
async function fetchSchoolsJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(SCHOOLS_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
  return readResponseJsonCapped(response, SCHOOLS_MAX_BYTES);
}

/**
 * Build the UAI → pupils map from the four per-level roll datasets.
 *
 * Fetched once per process and never invalidated: a rentrée's rolls are
 * published once and do not move during a school year, so re-reading them on
 * the register's daily cadence would be four national downloads a day for a
 * file that changes in September.
 *
 * A level that fails to load is WARNED and skipped rather than failing the
 * whole join — losing the lycée rolls should cost lycée dot sizes, not the
 * entire layer. The count that survives travels to the client so the shortfall
 * is visible instead of looking like a country of small schools.
 */
async function loadSchoolsRolls() {
  if (_schoolsRollsPromise) return _schoolsRollsPromise;
  _schoolsRollsPromise = (async () => {
    const rolls = new Map();
    const results = await Promise.allSettled(SCHOOLS_ROLL_DATASETS.map(async (spec) => {
      const params = new URLSearchParams({
        select: `${spec.key},${spec.total}`,
        where: `year(rentree_scolaire)=${SCHOOLS_ROLL_YEAR}`,
        limit: '-1',
      });
      const rows = await fetchSchoolsJson(`${SCHOOLS_BASE}/${spec.dataset}/exports/json?${params}`);
      return { spec, rows: Array.isArray(rows) ? rows : [] };
    }));
    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn('[Schools Proxy] roll dataset unavailable:', result.reason?.message || result.reason);
        continue;
      }
      const { spec, rows } = result.value;
      for (const row of rows) {
        const uai = String(row?.[spec.key] || '').trim();
        const total = Number(row?.[spec.total]);
        if (!uai || !Number.isFinite(total)) continue;
        // Last writer wins, and the order is fixed by SCHOOLS_ROLL_DATASETS:
        // a lycée polyvalent appears in BOTH lycée files, and the professional
        // roll is the one that lands second. That is a real ambiguity in the
        // upstream and it is resolved deterministically rather than by
        // whichever request happened to finish first.
        rolls.set(uai, total);
      }
    }
    return rolls;
  })().catch((error) => {
    console.warn('[Schools Proxy] roll join failed:', error?.message || error);
    _schoolsRollsPromise = null;
    return new Map();
  });
  return _schoolsRollsPromise;
}

/**
 * Fetch one viewport and project it.
 *
 * The two calls run in PARALLEL and mean different things. The export is the
 * answer; the `limit=0` call is the dataset's own count for the same `where`,
 * and exists only so `projectSchoolSites` can prove the export was complete.
 */
async function refreshSchoolsViewport(box) {
  const where = schoolsBboxWhere(box);
  const exportParams = new URLSearchParams({
    select: SCHOOLS_SITE_FIELDS.join(','),
    where,
    limit: '-1',
  });
  const countParams = new URLSearchParams({ where, limit: '0' });

  const [exported, counted, rolls] = await Promise.all([
    fetchSchoolsJson(`${SCHOOLS_EXPORT_URL}?${exportParams}`),
    fetchSchoolsJson(`${SCHOOLS_RECORDS_URL}?${countParams}`).catch((error) => {
      // The count is a completeness PROOF, not the data. Losing it degrades
      // the guarantee to "unknown" rather than blanking a viewport.
      console.warn('[Schools Proxy] box count unavailable:', error?.message || error);
      return null;
    }),
    loadSchoolsRolls(),
  ]);

  const projected = projectSchoolSites({
    records: Array.isArray(exported) ? exported : [],
    rolls,
    totalCount: counted?.total_count ?? null,
  });
  return {
    ...projected,
    box,
    maxBoxDeg: SCHOOLS_MAX_BOX_DEG,
  };
}

/**
 * Bundled département polygons, read once from disk.
 *
 * The dev-server proxy reads the same file the browser layer fetches, so the
 * national rollup and the shapes it is painted on can never come from two
 * different vintages.
 */
let _schoolsDepartementIndex = null;
async function loadSchoolsDepartementIndex() {
  if (_schoolsDepartementIndex) return _schoolsDepartementIndex;
  const file = path.join(process.cwd(), 'src', 'data', 'local_data', 'france_departements', 'departements.geojson');
  _schoolsDepartementIndex = buildDepartementIndex(JSON.parse(await fsp.readFile(file, 'utf8')));
  return _schoolsDepartementIndex;
}

/**
 * Build the national rollup: one export, the roll join, then fold onto the
 * polygons.
 *
 * No latitude striping and no truncation recursion, unlike the charge-point
 * sweep next door: this is not a grouped query, so Opendatasoft applies no
 * aggregation cap to it and the whole filtered register arrives in one
 * response. The completeness check is therefore a direct comparison against
 * the portal's own count rather than a per-stripe limit probe.
 */
async function refreshSchoolsNational() {
  const started = Date.now();
  const exportParams = new URLSearchParams({
    select: SCHOOLS_SWEEP_FIELDS.join(','),
    where: SCHOOLS_OPEN_WHERE,
    limit: '-1',
  });
  const [index, counted, exported, rolls] = await Promise.all([
    loadSchoolsDepartementIndex(),
    fetchSchoolsJson(`${SCHOOLS_RECORDS_URL}?${new URLSearchParams({ where: SCHOOLS_OPEN_WHERE, limit: '0' })}`)
      .catch((error) => {
        console.warn('[Schools Proxy] national count unavailable:', error?.message || error);
        return null;
      }),
    fetchSchoolsJson(`${SCHOOLS_EXPORT_URL}?${exportParams}`),
    loadSchoolsRolls(),
  ]);

  const projected = projectSchoolsDepartements({
    records: Array.isArray(exported) ? exported : [],
    index,
    rolls,
    totalCount: counted?.total_count ?? null,
  });
  if (projected.truncated) {
    console.warn(
      `[Schools Proxy] national export short: ${projected.schoolsSwept}/${projected.schoolsTotal} rows`,
    );
  }
  // The two documents are cached together because one sweep builds both, and
  // served apart because they are read at different moments and at different
  // sizes: the rollup is ~20 KB and arrives with the layer, the mesh is
  // ~0.7 MB gzipped and is only fetched if the operator leaves the choropleth.
  const { mesh, ...rollup } = projected;
  return {
    rollup: {
      ...rollup,
      sweptInMs: Date.now() - started,
    },
    mesh: {
      sites: mesh,
      siteCount: mesh.length,
      levels: SCHOOL_LEVELS,
      dataset: SCHOOLS_DATASET,
      source: SCHOOLS_SOURCE,
    },
  };
}

async function readSchoolsNationalDisk() {
  if (_schoolsNationalDiskChecked) return;
  _schoolsNationalDiskChecked = true;
  try {
    const entry = JSON.parse(await fsp.readFile(SCHOOLS_NATIONAL_CACHE_PATH, 'utf8'));
    if (entry?.version === SCHOOLS_NATIONAL_CACHE_VERSION
      && Number.isFinite(entry.at)
      && Array.isArray(entry.payload?.rollup?.departements)
      && Array.isArray(entry.payload?.mesh?.sites)) {
      _schoolsNational = entry;
    }
  } catch { /* no disk cache yet */ }
}

function writeSchoolsNationalDisk(entry) {
  fsp.mkdir(SCHOOLS_DISK_DIR, { recursive: true })
    .then(() => fsp.writeFile(SCHOOLS_NATIONAL_CACHE_PATH, JSON.stringify(entry)))
    .catch((err) => console.warn('[Schools Proxy] national cache write failed:', err?.message || err));
}

/** Shared national build, so `/departements` and `/mesh` never sweep twice. */
function ensureSchoolsNational() {
  if (!_schoolsNationalInFlight) {
    _schoolsNationalInFlight = refreshSchoolsNational()
      .then((payload) => {
        const entry = { version: SCHOOLS_NATIONAL_CACHE_VERSION, at: Date.now(), payload };
        _schoolsNational = entry;
        writeSchoolsNationalDisk(entry);
        return entry;
      })
      .finally(() => { _schoolsNationalInFlight = null; });
  }
  return _schoolsNationalInFlight;
}

/**
 * Vite plugin: viewport-bounded French school-register proxy.
 * @returns {import('vite').Plugin}
 */
function schoolsFranceProxy() {
  function install(middlewares) {
    middlewares.use('/api/schools-fr', async (req, res) => {
      const json = (status, body, headers = {}) => {
        if (res.headersSent) return;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'GET') {
        json(405, { error: 'Method Not Allowed' });
        return;
      }
      if (!_schoolsRateLimiter(clientKey(req))) {
        json(429, { error: 'Rate limit exceeded' }, { 'Retry-After': '5' });
        return;
      }

      const url = new URL(req.url || '/', 'http://localhost');
      const route = url.pathname.replace(/\/+$/, '') || '/';

      if (route === '/status') {
        let newest = null;
        for (const entry of _schoolsViewportCache.values()) {
          if (!newest || entry.at > newest) newest = entry.at;
        }
        json(200, {
          source: SCHOOLS_SOURCE,
          dataset: SCHOOLS_DATASET,
          lastFetch: newest,
          cachedBoxes: _schoolsViewportCache.size,
          ttlMs: SCHOOLS_TTL_MS,
          maxBoxDeg: SCHOOLS_MAX_BOX_DEG,
          rollYear: SCHOOLS_ROLL_YEAR,
          national: _schoolsNational
            ? {
              at: _schoolsNational.at,
              painted: _schoolsNational.payload.rollup.painted,
              schools: _schoolsNational.payload.rollup.assigned,
              unassigned: _schoolsNational.payload.rollup.unassigned,
              meshSites: _schoolsNational.payload.mesh.siteCount,
            }
            : null,
          nationalTtlMs: SCHOOLS_NATIONAL_TTL_MS,
        }, { 'Cache-Control': 'public, max-age=60' });
        return;
      }

      if (route === '/departements' || route === '/mesh') {
        const pick = (payload) => (route === '/mesh' ? payload.mesh : payload.rollup);
        await readSchoolsNationalDisk();
        const now = Date.now();
        if (_schoolsNational && now - _schoolsNational.at <= SCHOOLS_NATIONAL_TTL_MS) {
          json(200, { ...pick(_schoolsNational.payload), fetchedAt: _schoolsNational.at, stale: false }, { 'X-SCHOOLS-FR': 'HIT' });
          return;
        }
        try {
          const entry = await ensureSchoolsNational();
          json(200, { ...pick(entry.payload), fetchedAt: entry.at, stale: false }, { 'X-SCHOOLS-FR': 'MISS' });
        } catch (error) {
          console.warn('[Schools Proxy] national build unavailable:', error?.message || error);
          // A rollup a week old is still a true picture of a register that is
          // rebuilt daily — serving it beats blanking the national view.
          if (_schoolsNational) {
            json(200, { ...pick(_schoolsNational.payload), fetchedAt: _schoolsNational.at, stale: true }, { 'X-SCHOOLS-FR': 'STALE' });
            return;
          }
          json(503, { error: 'French school register is temporarily unavailable' });
        }
        return;
      }

      if (route !== '/sites') {
        json(404, { error: 'Unknown schools endpoint' });
        return;
      }

      const requested = validBox({
        south: url.searchParams.get('south'),
        west: url.searchParams.get('west'),
        north: url.searchParams.get('north'),
        east: url.searchParams.get('east'),
      }, SCHOOLS_MAX_BOX_DEG);
      if (!requested) {
        json(400, {
          error: `A non-dateline bbox no larger than ${SCHOOLS_MAX_BOX_DEG} degrees is required`,
          maxBoxDeg: SCHOOLS_MAX_BOX_DEG,
        });
        return;
      }

      const box = snapBoxOutward(requested, SCHOOLS_BOX_STEP_DEG);
      const key = boxKey(box);
      const now = Date.now();

      const fresh = _schoolsViewportCache.get(key);
      if (fresh && now - fresh.at <= SCHOOLS_TTL_MS) {
        json(200, { ...fresh.payload, fetchedAt: fresh.at, stale: false }, { 'X-SCHOOLS-FR': 'HIT' });
        return;
      }
      const onDisk = await readSchoolsDisk(key, SCHOOLS_TTL_MS);
      if (onDisk) {
        _schoolsViewportCache.set(key, onDisk);
        trimSchoolsViewportCache();
        json(200, { ...onDisk.payload, fetchedAt: onDisk.at, stale: false }, { 'X-SCHOOLS-FR': 'DISK' });
        return;
      }

      let pending = _schoolsViewportInFlight.get(key);
      if (!pending) {
        pending = refreshSchoolsViewport(box)
          .then((payload) => {
            const entry = { at: Date.now(), payload };
            _schoolsViewportCache.set(key, entry);
            trimSchoolsViewportCache();
            writeSchoolsDisk(key, entry);
            return entry;
          })
          .finally(() => { _schoolsViewportInFlight.delete(key); });
        _schoolsViewportInFlight.set(key, pending);
      }

      try {
        const entry = await pending;
        json(200, { ...entry.payload, fetchedAt: entry.at, stale: false }, { 'X-SCHOOLS-FR': 'MISS' });
      } catch (error) {
        console.warn('[Schools Proxy] viewport unavailable:', error?.message || error);
        const stale = _schoolsViewportCache.get(key) || await readSchoolsDisk(key, SCHOOLS_STALE_MS);
        if (stale) {
          json(200, { ...stale.payload, fetchedAt: stale.at, stale: true }, { 'X-SCHOOLS-FR': 'STALE' });
          return;
        }
        json(503, { error: 'French school register is temporarily unavailable' });
      }
    });
  }

  return {
    name: 'schools-france-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

/**
 * French higher-education proxy — keyless, Licence Ouverte 2.0.
 *
 *   GET /api/sup-fr/sites        — the whole national register, once
 *   GET /api/sup-fr/departements — national rollup, 96 départements
 *   GET /api/sup-fr/status       — dataset provenance + cache state
 *
 * WHY A PROXY, when the portal sends CORS headers and a direct browser fetch
 * works: this layer is a JOIN of two files that disagree about their unit. The
 * register publishes one row per (établissement × composante × degré) and
 * geolocates only 80% of them; the Parcoursup cartography publishes one row per
 * formation and geolocates all of them. Resolving 22 068 + 25 831 rows into
 * 6 914 sites in the client would mean every open tab downloading both
 * national files and re-deriving the same map. The join happens once, on a
 * server, under test (`supFeed.js`, `supDepartements.js`).
 *
 * WHY THERE IS NO VIEWPORT ENDPOINT, unlike `/api/schools-fr/sites` next door:
 * the resolved register is 6 914 sites and **0.62 MB gzipped with every name
 * on it**. A bbox query would be a round trip to avoid a download the size of
 * the one the schools maillage already makes. The browser gets the register.
 *
 * WHY THE YEARS ARE DISCOVERED AND NOT PINNED: the Atlas gains a rentrée every
 * spring and Parcoursup a session every winter. Hard-coding either would serve
 * a quietly stale map forever, so both are read from the portal's own grouping
 * and floored at the values this was measured against — a discovery that comes
 * back OLDER than the floor is a malformed answer, not a new fact.
 */
const SUP_BASE = `https://${SUP_PORTAL}/api/explore/v2.1/catalog/datasets`;
/**
 * The register is published ONCE A YEAR. A week in memory is already four
 * hundred times faster than the data changes; the disk cache below is what
 * actually spares the portal across restarts.
 */
const SUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Serve-stale ceiling. A register a month old is still this year's register. */
const SUP_STALE_MS = 30 * 24 * 60 * 60 * 1000;
const SUP_TIMEOUT_MS = 60_000;
/** The Atlas export is ~9 MB, the cartography ~15 MB. */
const SUP_MAX_BYTES = 64 * 1024 * 1024;
const SUP_DISK_DIR = path.join(process.cwd(), '.gev-cache', 'sup-fr');
const SUP_CACHE_PATH = path.join(SUP_DISK_DIR, 'register.json');
/**
 * Shape version of the cached register. Bump whenever `projectSupSites` or
 * `projectSupDepartements` changes what it returns — the cache lives for a
 * WEEK on disk, so without it a projection edit is invisible until next month.
 */
const SUP_CACHE_VERSION = 1;

/** @type {?{version:number, at:number, payload:object}} */
let _supRegister = null;
/** @type {?Promise<object>} */
let _supInFlight = null;
let _supDiskChecked = false;
const _supRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 30, globalMax: 90 });

/** GET one Opendatasoft URL as JSON, under a timeout and a byte cap. */
async function fetchSupJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(SUP_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
  return readResponseJsonCapped(response, SUP_MAX_BYTES);
}

/**
 * Newest published year for one dataset's year column.
 *
 * A failed discovery is not a failed build: it falls back to the floor, which
 * is the year this layer was measured against and is guaranteed to exist.
 */
async function discoverSupYear(dataset, field, floor) {
  try {
    const params = new URLSearchParams({
      select: field, group_by: field, order_by: `${field} desc`, limit: '1',
    });
    const body = await fetchSupJson(`${SUP_BASE}/${dataset}/records?${params}`);
    return newestYear(body?.results, field, floor);
  } catch (error) {
    console.warn(`[Sup Proxy] ${field} discovery failed:`, error?.message || error);
    return floor;
  }
}

/**
 * Build the whole layer: two exports, one join, one fold onto the polygons.
 *
 * The three upstream calls run in PARALLEL and mean different things. The
 * Atlas export is the register; the `limit=0` call is the portal's own count
 * for the same `where`, and exists only so `projectSupSites` can prove the
 * export was not silently short; the cartography is the complement.
 *
 * The cartography failing is NOT fatal and is deliberately not treated as
 * such: losing it costs the 977 borrowed coordinates, the names and the
 * formation lists, and the layer degrades to the register alone — which is
 * still 95.7% of French students. Losing the register itself is fatal,
 * because there is nothing left to draw.
 */
async function refreshSupRegister() {
  const started = Date.now();
  const [rentree, session] = await Promise.all([
    discoverSupYear(SUP_DATASET, 'rentree', SUP_RENTREE_FLOOR),
    discoverSupYear(SUP_OFFER_DATASET, 'annee', SUP_SESSION_FLOOR),
  ]);

  const atlasWhere = supAtlasWhere(rentree);
  const atlasParams = new URLSearchParams({
    select: SUP_ATLAS_FIELDS.join(','), where: atlasWhere, limit: '-1',
  });
  const offerParams = new URLSearchParams({
    select: SUP_OFFER_FIELDS.join(','), where: supOfferWhere(session), limit: '-1',
  });
  const countParams = new URLSearchParams({ where: atlasWhere, limit: '0' });

  const [index, exported, counted, offered] = await Promise.all([
    loadSchoolsDepartementIndex(),
    fetchSupJson(`${SUP_BASE}/${SUP_DATASET}/exports/json?${atlasParams}`),
    fetchSupJson(`${SUP_BASE}/${SUP_DATASET}/records?${countParams}`).catch((error) => {
      // The count is a completeness PROOF, not the data. Losing it degrades
      // the guarantee to "unknown" rather than blanking the layer.
      console.warn('[Sup Proxy] register count unavailable:', error?.message || error);
      return null;
    }),
    fetchSupJson(`${SUP_BASE}/${SUP_OFFER_DATASET}/exports/json?${offerParams}`).catch((error) => {
      console.warn('[Sup Proxy] Parcoursup cartography unavailable:', error?.message || error);
      return null;
    }),
  ]);

  const projected = projectSupSites({
    records: Array.isArray(exported) ? exported : [],
    offers: indexSupOffers(Array.isArray(offered) ? offered : []),
    rentree,
    session,
    totalCount: counted?.total_count ?? null,
  });
  if (!projected.complete) {
    console.warn(`[Sup Proxy] register export short: ${projected.rowsSwept}/${projected.rowsTotal} rows`);
  }

  const rollup = projectSupDepartements({ sites: projected.sites, index });
  // The two documents are cached together because one build makes both, and
  // served apart because they are read at different moments and at different
  // sizes: the rollup is ~30 KB and arrives with the layer, the register is
  // 0.62 MB gzipped and is only fetched if the operator leaves the choropleth.
  const { sites, ...summary } = projected;
  return {
    register: { ...summary, sites, complementAvailable: Array.isArray(offered) },
    rollup: {
      ...rollup,
      rentree,
      session,
      builtInMs: Date.now() - started,
    },
  };
}

async function readSupDisk() {
  if (_supDiskChecked) return;
  _supDiskChecked = true;
  try {
    const entry = JSON.parse(await fsp.readFile(SUP_CACHE_PATH, 'utf8'));
    if (entry?.version === SUP_CACHE_VERSION
      && Number.isFinite(entry.at)
      && Array.isArray(entry.payload?.register?.sites)
      && Array.isArray(entry.payload?.rollup?.departements)) {
      _supRegister = entry;
    }
  } catch { /* no disk cache yet */ }
}

function writeSupDisk(entry) {
  fsp.mkdir(SUP_DISK_DIR, { recursive: true })
    .then(() => fsp.writeFile(SUP_CACHE_PATH, JSON.stringify(entry)))
    .catch((err) => console.warn('[Sup Proxy] cache write failed:', err?.message || err));
}

/** Shared build, so `/sites` and `/departements` never sweep twice. */
function ensureSupRegister() {
  if (!_supInFlight) {
    _supInFlight = refreshSupRegister()
      .then((payload) => {
        const entry = { version: SUP_CACHE_VERSION, at: Date.now(), payload };
        _supRegister = entry;
        writeSupDisk(entry);
        return entry;
      })
      .finally(() => { _supInFlight = null; });
  }
  return _supInFlight;
}

/**
 * Vite plugin: French higher-education register proxy.
 * @returns {import('vite').Plugin}
 */
function supFranceProxy() {
  function install(middlewares) {
    middlewares.use('/api/sup-fr', async (req, res) => {
      const json = (status, body, headers = {}) => {
        if (res.headersSent) return;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'GET') {
        json(405, { error: 'Method Not Allowed' });
        return;
      }
      if (!_supRateLimiter(clientKey(req))) {
        json(429, { error: 'Rate limit exceeded' }, { 'Retry-After': '5' });
        return;
      }

      const url = new URL(req.url || '/', 'http://localhost');
      const route = url.pathname.replace(/\/+$/, '') || '/';

      if (route === '/status') {
        await readSupDisk();
        json(200, {
          source: SUP_SOURCE,
          dataset: SUP_DATASET,
          offerDataset: SUP_OFFER_DATASET,
          ttlMs: SUP_TTL_MS,
          register: _supRegister
            ? {
              at: _supRegister.at,
              rentree: _supRegister.payload.rollup.rentree,
              session: _supRegister.payload.rollup.session,
              sites: _supRegister.payload.register.count,
              establishments: _supRegister.payload.register.establishments,
              students: _supRegister.payload.register.students,
              borrowed: _supRegister.payload.register.borrowed,
              unplaced: _supRegister.payload.register.unplaced,
              painted: _supRegister.payload.rollup.painted,
              unassigned: _supRegister.payload.rollup.unassigned,
              complementAvailable: _supRegister.payload.register.complementAvailable,
            }
            : null,
        }, { 'Cache-Control': 'public, max-age=60' });
        return;
      }

      if (route !== '/sites' && route !== '/departements') {
        json(404, { error: 'Unknown higher-education endpoint' });
        return;
      }

      const pick = (payload) => (route === '/sites' ? payload.register : payload.rollup);
      await readSupDisk();
      const now = Date.now();
      if (_supRegister && now - _supRegister.at <= SUP_TTL_MS) {
        json(200, { ...pick(_supRegister.payload), fetchedAt: _supRegister.at, stale: false }, { 'X-SUP-FR': 'HIT' });
        return;
      }
      try {
        const entry = await ensureSupRegister();
        json(200, { ...pick(entry.payload), fetchedAt: entry.at, stale: false }, { 'X-SUP-FR': 'MISS' });
      } catch (error) {
        console.warn('[Sup Proxy] register build unavailable:', error?.message || error);
        // A register a month old is still a true picture of a file that is
        // rebuilt once a year — serving it beats blanking the layer.
        if (_supRegister && now - _supRegister.at <= SUP_STALE_MS) {
          json(200, { ...pick(_supRegister.payload), fetchedAt: _supRegister.at, stale: true }, { 'X-SUP-FR': 'STALE' });
          return;
        }
        json(503, { error: 'French higher-education register is temporarily unavailable' });
      }
    });
  }

  return {
    name: 'sup-france-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

/**
 * Paris permanent road-count proxy — keyless, ODbL.
 *
 *   GET /api/comptages-fr/arcs   — the whole measured week, one document
 *   GET /api/comptages-fr/status — edition + cache state
 *
 * WHY A PROXY, when opendata.paris.fr sends `access-control-allow-origin: *`
 * and a browser could call it directly: the answer this layer draws is a fold
 * of **500 136 hourly rows** into 2 977 arcs, and it takes TEN upstream calls
 * to assemble — one to discover the edition, one GeoJSON export for geometry
 * and names, eight grouped aggregations for the day profiles, and one for the
 * open/closed state. Doing that in the client would mean every open tab
 * re-deriving the same 24-hour profile from the same 27.7-million-row dataset.
 * The fold happens once, on a server, under test (`comptagesFeed.js`).
 *
 * WHY THE EDITION IS A WEEK, NOT A TIMESTAMP: the feed is J-2 (a nightly batch
 * that lands the day before yesterday), so it has no "now" worth drawing. The
 * unit is the last COMPLETE local Monday–Sunday week, DISCOVERED from
 * `max(t_1h)` and floored at `COMPTAGES_WEEK_FLOOR` — the week this was
 * measured against. A discovery older than the floor is a malformed answer,
 * not a new fact, so the floor is used.
 *
 * WHY THE CLOCK IS SPLIT INTO FOUR BLOCKS: the grouped endpoint caps
 * `offset + limit` at 30 000 and one day-type is 2 977 arcs x 24 h = 71 448
 * cells. Six hours at a time is 17 862 — inside the ceiling with room for the
 * network to grow by two thirds before a block has to be split again.
 */
const COMPTAGES_BASE = `https://${COMPTAGES_PORTAL}/api/explore/v2.1/catalog/datasets`;
/**
 * Six hours. The upstream is rebuilt ONCE A NIGHT and is already two days
 * behind, so anything faster re-asks a question whose answer cannot have
 * changed. The disk cache below is what actually spares the portal the
 * ten-call sweep across restarts.
 */
const COMPTAGES_TTL_MS = 6 * 60 * 60 * 1000;
/** Serve-stale ceiling. Last week's measured week is still a true week. */
const COMPTAGES_STALE_MS = 14 * 24 * 60 * 60 * 1000;
const COMPTAGES_TIMEOUT_MS = 90_000;
/** The GeoJSON export is ~1.67 MB raw; the eight grouped calls ~10.2 MB total. */
const COMPTAGES_MAX_BYTES = 48 * 1024 * 1024;
const COMPTAGES_DISK_DIR = path.join(process.cwd(), '.gev-cache', 'comptages-fr');
const COMPTAGES_CACHE_PATH = path.join(COMPTAGES_DISK_DIR, 'week.json');
/**
 * Shape version of the cached fold. Bump whenever `projectComptagesArcs`
 * changes what it returns — the cache lives for six hours in memory but two
 * weeks on disk, so without it a projection edit stays invisible.
 */
const COMPTAGES_CACHE_VERSION = 1;

/** @type {?{version:number, at:number, payload:object}} */
let _comptagesWeek = null;
/** @type {?Promise<object>} */
let _comptagesInFlight = null;
let _comptagesDiskChecked = false;
const _comptagesRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 30, globalMax: 90 });

/** GET one Opendatasoft URL as JSON, under a timeout and a byte cap. */
async function fetchComptagesJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(COMPTAGES_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
  return readResponseJsonCapped(response, COMPTAGES_MAX_BYTES);
}

/**
 * Newest complete local week, discovered from the dataset's own newest stamp.
 *
 * A failed discovery is not a failed build: it falls back to the floor, which
 * is the week this layer was measured against and is guaranteed to exist.
 */
async function discoverComptagesWeek() {
  try {
    const params = new URLSearchParams({ select: 'max(t_1h) as newest', limit: '1' });
    const body = await fetchComptagesJson(`${COMPTAGES_BASE}/${COMPTAGES_DATASET}/records?${params}`);
    return newestComptagesWeek(body?.results?.[0]?.newest);
  } catch (error) {
    console.warn('[Comptages Proxy] week discovery failed:', error?.message || error);
    return newestComptagesWeek(null);
  }
}

/** One grouped aggregation page. */
async function fetchComptagesGroup(where, groupBy, select) {
  const params = new URLSearchParams({
    select, where, group_by: groupBy, limit: String(COMPTAGES_GROUP_LIMIT),
  });
  const body = await fetchComptagesJson(`${COMPTAGES_BASE}/${COMPTAGES_DATASET}/records?${params}`);
  return Array.isArray(body?.results) ? body.results : [];
}

/** Every (arc x hour) cell for one window, four calls over the clock. */
async function fetchComptagesProfile(window) {
  const blocks = await Promise.all(COMPTAGES_HOUR_BLOCKS.map((block) => fetchComptagesGroup(
    comptagesWindowWhere(window, block),
    COMPTAGES_PROFILE_GROUP_BY,
    COMPTAGES_PROFILE_SELECT,
  )));
  return blocks.flat();
}

/**
 * Build the whole layer: geometry from the measurement itself, then the week.
 *
 * The geometry deliberately does NOT come from `referentiel-comptages-routiers`
 * — see Trap 1 in `comptagesFeed.js`: the referential holds 3 739 rows for only
 * 3 348 distinct `iu_ac`, misses 31 arcs that ARE counting and carries 402 that
 * are not. The counts export carries its own `geo_shape` on every row, one row
 * per arc, fresher, and faster.
 *
 * The `etat_barre` roll-up failing is NOT fatal: it costs the reason a silent
 * arc is silent, and the layer degrades to "silent, reason unpublished" rather
 * than blanking. Losing the geometry export IS fatal — there is nothing to draw.
 */
async function refreshComptagesWeek() {
  const week = await discoverComptagesWeek();
  const windows = comptagesWeekWindows(week);

  const geoParams = new URLSearchParams({ where: comptagesStampWhere(windows.stamp) });
  const [features, weekday, weekend, barre] = await Promise.all([
    fetchComptagesJson(`${COMPTAGES_BASE}/${COMPTAGES_DATASET}/exports/geojson?${geoParams}`),
    fetchComptagesProfile(windows.weekday),
    fetchComptagesProfile(windows.weekend),
    fetchComptagesGroup(
      comptagesWindowWhere(windows.week),
      COMPTAGES_BARRE_GROUP_BY,
      'count(*) as n',
    ).catch((error) => {
      console.warn('[Comptages Proxy] etat_barre roll-up unavailable:', error?.message || error);
      return [];
    }),
  ]);

  return projectComptagesArcs({
    features: Array.isArray(features?.features) ? features.features : [],
    weekday,
    weekend,
    barre,
    week,
    source: COMPTAGES_SOURCE,
  });
}

async function readComptagesDisk() {
  if (_comptagesDiskChecked) return;
  _comptagesDiskChecked = true;
  try {
    const entry = JSON.parse(await fsp.readFile(COMPTAGES_CACHE_PATH, 'utf8'));
    if (entry?.version === COMPTAGES_CACHE_VERSION
      && Number.isFinite(entry.at)
      && Array.isArray(entry.payload?.arcs)) {
      _comptagesWeek = entry;
    }
  } catch { /* no disk cache yet */ }
}

function writeComptagesDisk(entry) {
  fsp.mkdir(COMPTAGES_DISK_DIR, { recursive: true })
    .then(() => fsp.writeFile(COMPTAGES_CACHE_PATH, JSON.stringify(entry)))
    .catch((err) => console.warn('[Comptages Proxy] cache write failed:', err?.message || err));
}

/** Single-flight, so two tabs opening at once cost one ten-call sweep. */
function ensureComptagesWeek() {
  if (!_comptagesInFlight) {
    _comptagesInFlight = refreshComptagesWeek()
      .then((payload) => {
        const entry = { version: COMPTAGES_CACHE_VERSION, at: Date.now(), payload };
        _comptagesWeek = entry;
        writeComptagesDisk(entry);
        return entry;
      })
      .finally(() => { _comptagesInFlight = null; });
  }
  return _comptagesInFlight;
}

/**
 * Vite plugin: Paris permanent road-count proxy.
 * @returns {import('vite').Plugin}
 */
function comptagesParisProxy() {
  function install(middlewares) {
    middlewares.use('/api/comptages-fr', async (req, res) => {
      const json = (status, body, headers = {}) => {
        if (res.headersSent) return;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'GET') {
        json(405, { error: 'Method Not Allowed' });
        return;
      }
      if (!_comptagesRateLimiter(clientKey(req))) {
        json(429, { error: 'Rate limit exceeded' }, { 'Retry-After': '5' });
        return;
      }

      const url = new URL(req.url || '/', 'http://localhost');
      const route = url.pathname.replace(/\/+$/, '') || '/';

      if (route === '/status') {
        await readComptagesDisk();
        json(200, {
          source: COMPTAGES_SOURCE,
          dataset: COMPTAGES_DATASET,
          portal: COMPTAGES_PORTAL,
          weekFloor: COMPTAGES_WEEK_FLOOR,
          ttlMs: COMPTAGES_TTL_MS,
          week: _comptagesWeek
            ? {
              at: _comptagesWeek.at,
              week: _comptagesWeek.payload.week,
              arcs: _comptagesWeek.payload.count,
              states: _comptagesWeek.payload.states,
              unplaced: _comptagesWeek.payload.unplaced,
              unplacedMeasuring: _comptagesWeek.payload.unplacedMeasuring,
              duplicates: _comptagesWeek.payload.duplicates,
              phantom: _comptagesWeek.payload.phantom,
            }
            : null,
        }, { 'Cache-Control': 'public, max-age=60' });
        return;
      }

      if (route !== '/arcs') {
        json(404, { error: 'Unknown comptages endpoint' });
        return;
      }

      await readComptagesDisk();
      const now = Date.now();
      if (_comptagesWeek && now - _comptagesWeek.at <= COMPTAGES_TTL_MS) {
        json(200, { ..._comptagesWeek.payload, fetchedAt: _comptagesWeek.at, stale: false }, { 'X-COMPTAGES-FR': 'HIT' });
        return;
      }
      try {
        const entry = await ensureComptagesWeek();
        json(200, { ...entry.payload, fetchedAt: entry.at, stale: false }, { 'X-COMPTAGES-FR': 'MISS' });
      } catch (error) {
        console.warn('[Comptages Proxy] week build unavailable:', error?.message || error);
        // A fortnight-old measured week is still a true picture of a feed that
        // is already two days behind — serving it beats blanking the layer.
        if (_comptagesWeek && now - _comptagesWeek.at <= COMPTAGES_STALE_MS) {
          json(200, { ..._comptagesWeek.payload, fetchedAt: _comptagesWeek.at, stale: true }, { 'X-COMPTAGES-FR': 'STALE' });
          return;
        }
        json(503, { error: 'Paris road-count week is temporarily unavailable' });
      }
    });
  }

  return {
    name: 'comptages-paris-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

/**
 * SSMSI recorded-crime proxy — keyless, Licence Ouverte 2.0.
 *
 *   GET /api/delinquance-fr/departements   — the whole DEP base + the national census
 *   GET /api/delinquance-fr/communes/:dep  — one département's communes, joined to contours
 *   GET /api/delinquance-fr/status         — edition, licence and cache state
 *
 * WHY A PROXY. The commune base is a **39.9 MB gzipped CSV of 5.24 million
 * rows** and it is not optional: the DEP base carries no `est_diffuse` column
 * at all, so SUPPRESSION — the one thing this layer must never get wrong —
 * only exists at commune grain. The fold streams that file ONCE, keeps the
 * three cell states apart, and builds in the same pass the two things a browser
 * holding one département cannot compute: the national census of published /
 * zero / suppressed cells, and the national list of published rates the
 * quantile ramp is cut from. Re-deriving that per tab is not a possibility.
 *
 * WHY THE COMMUNE PACK IS PER-DÉPARTEMENT. Contours come from geo.api.gouv.fr
 * one département at a time, and the browser only ever draws the few it is
 * looking at. The fold is held in memory whole; the pack is cut from it.
 *
 * WHAT IT REFUSES TO DO. It never fills a suppressed cell. A suppressed commune
 * travels to the browser as the suppressed STATE plus, separately, the
 * departmental mean the publisher attaches to it — hoisted out of the cell so
 * that a departmental constant can never be read as a commune measurement.
 */
const DELINQUANCE_TTL_MS = 24 * 60 * 60 * 1000;
/** Serve-stale ceiling. The base is republished about once a year. */
const DELINQUANCE_STALE_MS = 120 * 24 * 60 * 60 * 1000;
const DELINQUANCE_TIMEOUT_MS = 300_000;
const DELINQUANCE_CONTOUR_TIMEOUT_MS = 60_000;
/** The COM csv.gz is 39.9 MB compressed and inflates to roughly 1.1 GB of text. */
const DELINQUANCE_MAX_BYTES = 96 * 1024 * 1024;
const DELINQUANCE_CONTOUR_MAX_BYTES = 48 * 1024 * 1024;
const DELINQUANCE_DISK_DIR = path.join(process.cwd(), '.gev-cache', 'delinquance-fr');
const DELINQUANCE_CACHE_PATH = path.join(DELINQUANCE_DISK_DIR, 'base.json');
/**
 * Shape version of the cached fold. Bump whenever `projectDelinquanceDepartements`
 * or `createCommuneFold` changes what it returns — the cache lives for four
 * months on disk, so without it a projection edit is invisible until next year.
 */
const DELINQUANCE_CACHE_VERSION = 1;

/** @type {?{version:number, at:number, payload:object}} */
let _delinquanceBase = null;
/** @type {?Promise<object>} */
let _delinquanceInFlight = null;
let _delinquanceDiskChecked = false;
/** dep -> projected contour list, memoized for the process. */
const _delinquanceContours = new Map();
/** dep -> in-flight contour promise, so ten tabs cost one fetch. */
const _delinquanceContourInFlight = new Map();
const _delinquanceRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 180 });

/** GET one URL as JSON, under a timeout and a byte cap. */
async function fetchDelinquanceJson(url, { timeout = DELINQUANCE_TIMEOUT_MS, cap = DELINQUANCE_MAX_BYTES } = {}) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
  return readResponseJsonCapped(response, cap);
}

/** GET one URL as text, under a timeout and a byte cap. */
async function fetchDelinquanceText(url) {
  const response = await fetch(url, {
    headers: { Accept: 'text/csv, text/plain' },
    signal: AbortSignal.timeout(DELINQUANCE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
  return readResponseTextCapped(response, DELINQUANCE_MAX_BYTES);
}

/**
 * Stream the gzipped commune base through the fold, one line at a time.
 *
 * Never buffered whole: the file inflates to roughly a gigabyte of text, and
 * the fold only ever needs one line at a time. `zlib.createGunzip` does the
 * decompression and the remainder is carried across chunk boundaries, because
 * a chunk boundary lands mid-line about five million times.
 */
async function streamDelinquanceCommunes(url, fold) {
  const response = await fetch(url, { signal: AbortSignal.timeout(DELINQUANCE_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
  if (!response.body) throw new Error('commune base returned no body');

  const gunzip = zlib.createGunzip();
  Readable.fromWeb(response.body).pipe(gunzip);

  let remainder = '';
  const decoder = new TextDecoder('utf-8');
  for await (const chunk of gunzip) {
    const text = remainder + decoder.decode(chunk, { stream: true });
    const lines = text.split('\n');
    // The last element is a partial line unless the chunk ended exactly on a
    // newline; either way it is correct to carry it.
    remainder = lines.pop() ?? '';
    for (const line of lines) fold.push(line.endsWith('\r') ? line.slice(0, -1) : line);
  }
  if (remainder) fold.push(remainder.endsWith('\r') ? remainder.slice(0, -1) : remainder);
  return fold.finish();
}

/**
 * Build the whole base: the département table, then the commune fold.
 *
 * The two are NOT parallel. The département pass establishes the newest year
 * present, and the commune fold is cut to that one year — folding ten years of
 * 5.24 million rows to throw nine away would be minutes of work for nothing.
 */
async function refreshDelinquanceBase() {
  const started = Date.now();
  const dataset = await fetchDelinquanceJson(DELINQUANCE_DATASET_URL, { cap: 8 * 1024 * 1024 });
  const picked = pickDelinquanceResources(dataset);

  const depText = await fetchDelinquanceText(picked.departements.url);
  const departements = projectDelinquanceDepartements({ rows: parseSsmsiCsv(depText) });
  const year = newestDelinquanceYear(departements.years, DELINQUANCE_YEAR_FLOOR);

  const communes = await streamDelinquanceCommunes(
    picked.communes.url, createCommuneFold({ year }),
  );

  // Cut ONCE, over every published commune rate in France, and then handed
  // unchanged to every département pack. Re-cutting per pack would rebin a
  // quiet département against its own quiet neighbours and paint it like a
  // busy one — the same colour would stop meaning the same rate as soon as the
  // camera moved.
  const thresholds = Object.fromEntries(
    [...communes.rates].map(([slug, values]) => [slug, delinquanceRateBins(values)]),
  );

  return {
    departements: departements.departements,
    years: departements.years,
    newestYear: year,
    thresholds,
    // The chip set is DERIVED from what the commune base actually publishes,
    // not from a constant, so an indicator the SSMSI stops publishing stops
    // being offered instead of becoming an empty map.
    chips: selectDelinquanceChips(communes.census),
    census: communes.census,
    censusByDepartement: communes.censusByDepartement,
    communes: communes.communeCount,
    edition: picked.edition,
    staleEdition: picked.staleEdition,
    licence: picked.licence,
    lastUpdate: picked.lastUpdate,
    documentation: picked.documentation?.url || null,
    source: DELINQUANCE_SOURCE,
    attribution: DELINQUANCE_ATTRIBUTION,
    rowsSwept: communes.rowsSwept,
    rowsKept: communes.rowsKept,
    slowLines: communes.slowLines,
    zeroPopulation: communes.zeroPopulation,
    unknownIndicators: communes.unknownIndicators,
    builtInMs: Date.now() - started,
    // Kept OUT of the wire payload by the handler below — it is the raw fold,
    // the whole of France, and only the per-département cut is ever served.
    _cells: communes.communes,
    _rates: communes.rates,
    _means: communes.departementMeans,
  };
}

async function readDelinquanceDisk() {
  if (_delinquanceDiskChecked) return;
  _delinquanceDiskChecked = true;
  try {
    const entry = JSON.parse(await fsp.readFile(DELINQUANCE_CACHE_PATH, 'utf8'));
    if (entry?.version === DELINQUANCE_CACHE_VERSION
      && Number.isFinite(entry.at)
      && Array.isArray(entry.payload?.departements)
      && Array.isArray(entry.payload?.cells)) {
      // `_cells` is a Map in memory and an array of pairs on disk.
      entry.payload._cells = new Map(entry.payload.cells);
      delete entry.payload.cells;
      _delinquanceBase = entry;
    }
  } catch { /* no disk cache yet */ }
}

function writeDelinquanceDisk(entry) {
  // The fold is a Map keyed by commune code; JSON cannot hold one, so it goes
  // to disk as pairs and is rebuilt on read.
  const { _cells, _rates, ...rest } = entry.payload;
  const serialisable = {
    version: entry.version,
    at: entry.at,
    payload: { ...rest, cells: [..._cells] },
  };
  fsp.mkdir(DELINQUANCE_DISK_DIR, { recursive: true })
    .then(() => fsp.writeFile(DELINQUANCE_CACHE_PATH, JSON.stringify(serialisable)))
    .catch((err) => console.warn('[Delinquance Proxy] cache write failed:', err?.message || err));
}

/** Single-flight, so two tabs opening at once cost one 5.24-million-row sweep. */
function ensureDelinquanceBase() {
  if (!_delinquanceInFlight) {
    _delinquanceInFlight = refreshDelinquanceBase()
      .then((payload) => {
        const entry = { version: DELINQUANCE_CACHE_VERSION, at: Date.now(), payload };
        _delinquanceBase = entry;
        writeDelinquanceDisk(entry);
        return entry;
      })
      .finally(() => { _delinquanceInFlight = null; });
  }
  return _delinquanceInFlight;
}

/**
 * Commune contours for one département, memoized and coalesced.
 *
 * `coalesceProxyRequest` returns `{ promise, shared }` and NOT a promise, so
 * the `.promise` is unwrapped here — awaiting the wrapper yields the wrapper
 * itself, whose `.communes` is `undefined`, and `joinCommuneCells` then reports
 * every commune in the département as `unshaped`. That reads exactly like an
 * upstream data problem and is not one.
 */
async function ensureDelinquanceContours(dep) {
  if (_delinquanceContours.has(dep)) return _delinquanceContours.get(dep);
  const request = coalesceProxyRequest(_delinquanceContourInFlight, dep, async () => {
    const geojson = await fetchDelinquanceJson(delinquanceContoursUrl(dep), {
      timeout: DELINQUANCE_CONTOUR_TIMEOUT_MS,
      cap: DELINQUANCE_CONTOUR_MAX_BYTES,
    });
    // `projectCommuneContours` returns `{ communes, vertices, simplified,
    // droppedParts }` — the SHAPES are `.communes`, and `joinCommuneCells`
    // wants that array. Handing it the wrapper joins nothing and reports every
    // commune as `unshaped`, which reads like a data problem and is not one.
    const projected = projectCommuneContours(geojson);
    _delinquanceContours.set(dep, projected);
    return projected;
  });
  return request.promise;
}

/** The wire payload for `/departements` — the fold's internals stripped off. */
function delinquanceBasePayload(entry, stale) {
  const { _cells, _rates, _means, ...wire } = entry.payload;
  return { ...wire, fetchedAt: entry.at, stale };
}

/**
 * Vite plugin: SSMSI recorded-crime proxy.
 * @returns {import('vite').Plugin}
 */
function delinquanceFranceProxy() {
  function install(middlewares) {
    middlewares.use('/api/delinquance-fr', async (req, res) => {
      const json = (status, body, headers = {}) => {
        if (res.headersSent) return;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'GET') {
        json(405, { error: 'Method Not Allowed' });
        return;
      }
      if (!_delinquanceRateLimiter(clientKey(req))) {
        json(429, { error: 'Rate limit exceeded' }, { 'Retry-After': '5' });
        return;
      }

      const url = new URL(req.url || '/', 'http://localhost');
      const route = url.pathname.replace(/\/+$/, '') || '/';

      if (route === '/status') {
        await readDelinquanceDisk();
        json(200, {
          source: DELINQUANCE_SOURCE,
          dataset: DELINQUANCE_DATASET,
          licence: DELINQUANCE_LICENCE,
          attribution: DELINQUANCE_ATTRIBUTION,
          ttlMs: DELINQUANCE_TTL_MS,
          base: _delinquanceBase
            ? {
              at: _delinquanceBase.at,
              edition: _delinquanceBase.payload.edition,
              staleEdition: _delinquanceBase.payload.staleEdition,
              newestYear: _delinquanceBase.payload.newestYear,
              departements: _delinquanceBase.payload.departements.length,
              communes: _delinquanceBase.payload.communes,
              rowsSwept: _delinquanceBase.payload.rowsSwept,
              builtInMs: _delinquanceBase.payload.builtInMs,
            }
            : null,
        }, { 'Cache-Control': 'public, max-age=60' });
        return;
      }

      const communeMatch = /^\/communes\/([0-9][0-9ABab]|97[1-6])$/.exec(route);
      if (route !== '/departements' && !communeMatch) {
        json(404, { error: 'Unknown delinquance endpoint' });
        return;
      }

      await readDelinquanceDisk();
      const now = Date.now();
      let entry = _delinquanceBase && now - _delinquanceBase.at <= DELINQUANCE_TTL_MS
        ? _delinquanceBase
        : null;
      let stale = false;
      if (!entry) {
        try {
          entry = await ensureDelinquanceBase();
        } catch (error) {
          console.warn('[Delinquance Proxy] base build unavailable:', error?.message || error);
          // A four-month-old edition is still THIS edition — the base is
          // republished about once a year — so serving it beats blanking.
          if (_delinquanceBase && now - _delinquanceBase.at <= DELINQUANCE_STALE_MS) {
            entry = _delinquanceBase;
            stale = true;
          } else {
            json(503, { error: 'French recorded-crime base is temporarily unavailable' });
            return;
          }
        }
      }

      if (!communeMatch) {
        json(200, delinquanceBasePayload(entry, stale), { 'X-DELINQUANCE-FR': stale ? 'STALE' : 'HIT' });
        return;
      }

      const dep = communeMatch[1].toUpperCase();
      try {
        const contours = await ensureDelinquanceContours(dep);
        const joined = joinCommuneCells({
          contours: contours.communes,
          cells: entry.payload._cells,
          departement: dep,
        });
        json(200, {
          departement: dep,
          year: entry.payload.newestYear,
          // The departmental means a suppressed row carries, kept OUT of the
          // cells: they are a departmental constant, and a card that printed
          // one inside a commune's row would be publishing a number about a
          // place that never published one.
          means: entry.payload._means?.[dep] || {},
          // National, not per-pack — see `refreshDelinquanceBase`.
          thresholds: entry.payload.thresholds,
          census: entry.payload.censusByDepartement?.[dep] || {},
          ...joined,
          // Geometry cost, reported rather than hidden: rings are decimated to
          // ~11 m and multi-part communes are capped, so the payload says how
          // much was simplified and how many parts were dropped.
          vertices: contours.vertices,
          simplified: contours.simplified,
          droppedParts: contours.droppedParts,
          fetchedAt: entry.at,
          stale,
        }, { 'X-DELINQUANCE-FR': stale ? 'STALE' : 'HIT' });
      } catch (error) {
        console.warn(`[Delinquance Proxy] commune pack ${dep} unavailable:`, error?.message || error);
        json(503, { error: `Commune contours for département ${dep} are temporarily unavailable` });
      }
    });
  }

  return {
    name: 'delinquance-france-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

/**
 * ANFR mobile-network observatory proxy — keyless, Licence Ouverte 2.0.
 *
 * A proxy is not an optimisation here, it is the only option: measured with
 * real GETs carrying `Origin: http://localhost:4173`, neither `data.anfr.fr`
 * nor `www.cartoradio.fr` sends any `access-control-allow-origin` header at
 * all. Only `static.data.gouv.fr` does (`*`).
 *
 * ONE build, three answers. The whole layer comes out of a single sweep of the
 * 826 418-row weekly observatoire, and the three routes are three views of it:
 *
 *   /api/anfr-fr/mesh                — 72 700 `[lat, lon, operators, band]`
 *                                      tuples plus the national totals.
 *                                      Measured on the live build: 1 666 693
 *                                      bytes raw, 394 030 gzipped.
 *   /api/anfr-fr/supports?box        — every support inside a box ≤ 0.35°,
 *                                      with its operator names, its system
 *                                      labels and its nature resolved. The
 *                                      fullest possible box (48.6725 N,
 *                                      2.19556 E) is 6 462 rows and 112 831
 *                                      bytes gzipped; central Paris is 726
 *                                      rows and 13 106. The same route answers
 *                                      a maillage click, at a 0.001° box that
 *                                      returned exactly 1 row and 423 bytes.
 *   /api/anfr-fr/support/<sup_id>    — the Cartoradio card for ONE mast, on
 *                                      demand: address, owner, the categories
 *                                      this layer does not draw, the per-emitter
 *                                      frequency pairs, and the nearest
 *                                      published exposure measurement. 3 544
 *                                      bytes for support 449714.
 *
 * WHY THE 182 MB CSV AND NOT THE DATASTORE. Both serve the same 826 418 rows.
 * The CSV is one static GET; the `/d4c/api/records/2.0/search/` route needs six
 * paged calls totalling ~231 MB. The CSV URL is not guessed — the D4C
 * catalogue publishes it as `extras.file_csv`, and republishes it under a new
 * build stamp every week, which is why it is discovered and not pinned.
 *
 * WHY A BUFFER READ AND NOT `readResponseTextCapped`. That helper is right for
 * every JSON body here and all of them go through `readResponseJsonCapped`.
 * It is wrong for this one: it materialises the 182 MB file as a single
 * 180-million-character JS string, and the whole build then peaks at 1 274 MB
 * RSS. Reading into a Buffer and yielding rows out of it with a generator —
 * so `projectAnfrSupports` never sees more than one row object at a time —
 * measured 517 MB peak for the same build. Both were measured on the live file
 * on 2026-09-02.
 *
 * BUILD COST, MEASURED LIVE. 36.4 s wall for the whole thing, of which 34 s is
 * `fetch()` reading the 182 MB body (`curl` reads the same bytes in 3.5 s and
 * `node:https` in 3.1 s — undici is the bottleneck, not the server). Parsing
 * and folding 826 418 rows is 1.5 s and the mesh is 17 ms. That is why the TTL
 * is six hours against a WEEKLY upstream, the disk cache is 5.2 MB on disk, and
 * a failed refresh serves stale for a fortnight instead of blanking the layer.
 */
const ANFR_DAS_URL = `https://${ANFR_PORTAL}/d4c/api/records/2.0/search/`
  + `?resource_id=${ANFR_DAS_RESOURCE_ID}&limit=2000&fields=${ANFR_DAS_FIELDS}`;
/** Six hours against a weekly upstream — the build is 36 s and 517 MB. */
const ANFR_TTL_MS = 6 * 60 * 60_000;
/** A fortnight. The edition is a whole week, so a stale one is still that week. */
const ANFR_STALE_MS = 14 * 24 * 60 * 60_000;
const ANFR_TIMEOUT_MS = 30_000;
/** The 182 MB read took 34.4 s on a 58 MB/s link. Four minutes is the ceiling. */
const ANFR_CSV_TIMEOUT_MS = 240_000;
const ANFR_MAX_BYTES = 8 * 1024 * 1024;
/** 260 MB — 1.43× the 181 988 412-byte file, so a bigger edition still lands. */
const ANFR_CSV_MAX_BYTES = 260 * 1024 * 1024;
/** Widest box `/supports` will answer. Matches ANFR_MAX_BOX_DEG in anfrFrance.js. */
const ANFR_MAX_BOX_DEG = 0.35;
/** Above the 6 462 of the fullest possible box, so it never bites in practice. */
const ANFR_MAX_SUPPORTS = 8000;
/** A mast's Cartoradio card does not change between two clicks. */
const ANFR_DETAIL_TTL_MS = 24 * 60 * 60_000;
const ANFR_DETAIL_MAX = 400;
const ANFR_DISK_DIR = path.join(process.cwd(), '.gev-cache', 'anfr-fr');
const ANFR_CACHE_PATH = path.join(ANFR_DISK_DIR, 'register.json');
/** BUMP THIS whenever the projection changes shape — the disk cache outlives the edit. */
const ANFR_CACHE_VERSION = 1;

/** @type {?{version:number, at:number, payload:object}} */
let _anfrRegister = null;
let _anfrInFlight = null;
let _anfrDiskChecked = false;
/** SUP_ID -> {at, payload}. Cartoradio is courtesy access; ask once per mast. */
const _anfrDetails = new Map();
const _anfrDetailInFlight = new Map();
const _anfrRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 180 });

async function fetchAnfrJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(ANFR_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
  return readResponseJsonCapped(response, ANFR_MAX_BYTES);
}

/**
 * The observatoire CSV as bytes, capped, never as one giant string.
 *
 * See the header: the string form costs 757 MB of extra RSS for a body that is
 * consumed one line at a time.
 */
async function fetchAnfrCsvBuffer(url) {
  const response = await fetch(url, {
    headers: { Accept: 'text/csv' },
    signal: AbortSignal.timeout(ANFR_CSV_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > ANFR_CSV_MAX_BYTES) {
    const err = new Error('Upstream response too large');
    err.code = 'RESPONSE_TOO_LARGE';
    throw err;
  }
  const reader = response.body?.getReader?.();
  if (!reader) return Buffer.from(await response.arrayBuffer());
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > ANFR_CSV_MAX_BYTES) {
      try { await reader.cancel(); } catch { /* no-op */ }
      const err = new Error('Upstream response too large');
      err.code = 'RESPONSE_TOO_LARGE';
      throw err;
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(chunks, total);
}

/**
 * Rows out of the CSV buffer, one at a time.
 *
 * The file is LF-only (verified byte by byte over all 181 988 412 of them —
 * zero `\r`, unlike the CRLF 5W tables next door) and opens with a UTF-8 BOM,
 * both of which `anfrCsvColumns` handles. A generator rather than an array so
 * `projectAnfrSupports` folds 826 418 rows without ever holding two.
 */
function* anfrCsvRows(buffer) {
  const firstBreak = buffer.indexOf(0x0a);
  if (firstBreak < 0) return;
  const columns = anfrCsvColumns(buffer.toString('utf8', 0, firstBreak));
  let start = firstBreak + 1;
  for (;;) {
    const end = buffer.indexOf(0x0a, start);
    const stop = end < 0 ? buffer.length : end;
    if (stop > start) {
      const row = readAnfrCsvRow(buffer.toString('utf8', start, stop), columns);
      if (row) yield row;
    }
    if (end < 0) break;
    start = end + 1;
  }
}

/**
 * `nat_id` -> nature, from the 4 805-byte reference archive.
 *
 * Whole-body, not ranged: three range requests to save 4 KB is arithmetic
 * nobody needs. `static.data.gouv.fr` is the one ANFR-adjacent host that sends
 * `access-control-allow-origin: *`, and this is the only member of the archive
 * this layer reads (`SUP_NATURE.txt`, 785 bytes, 38 rows).
 */
async function fetchAnfrNatures() {
  const response = await fetch(ANFR_REF_ZIP_URL, { signal: AbortSignal.timeout(ANFR_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const member = readZipMember(archive, ANFR_REF_MEMBER);
  if (!member) throw new Error(`${ANFR_REF_MEMBER} missing from the reference archive`);
  return parseAnfrNatureTable(member.toString('utf8'));
}

/**
 * Build the whole layer: discover the week, sweep it, fold it, thin it.
 *
 * Only the CSV is fatal. Losing the catalogue costs the discovered URL and the
 * completeness proof and falls back to the floor; losing the reference archive
 * costs the card the word "Pylône autostable" and leaves `natureAvailable`
 * false; losing the DAS register costs one national readout that was never on
 * the map anyway — it has no coordinate of any kind. Each of those degrades
 * with a warning rather than failing a build that still has 72 700 masts in it.
 */
async function refreshAnfrRegister() {
  const started = Date.now();
  const catalogue = await fetchAnfrJson(ANFR_CATALOGUE_URL).catch((error) => {
    console.warn('[ANFR Proxy] catalogue unavailable:', error?.message || error);
    return null;
  });
  const observatoire = pickAnfrObservatoire(catalogue || {});

  const [natures, das, buffer] = await Promise.all([
    fetchAnfrNatures().catch((error) => {
      console.warn('[ANFR Proxy] nature table unavailable:', error?.message || error);
      return null;
    }),
    fetchAnfrJson(ANFR_DAS_URL).then(projectAnfrDas).catch((error) => {
      console.warn('[ANFR Proxy] DAS register unavailable:', error?.message || error);
      return null;
    }),
    fetchAnfrCsvBuffer(observatoire.csvUrl),
  ]);

  const projected = projectAnfrSupports({
    rows: anfrCsvRows(buffer),
    natures,
    edition: observatoire.edition,
    totalCount: observatoire.rowsTotal,
  });
  if (!projected.complete) {
    console.warn(`[ANFR Proxy] observatoire short: ${projected.rowsSwept}/${projected.rowsTotal} rows`);
  }

  const { supports, ...summary } = projected;
  const national = {
    count: summary.count,
    live: summary.live,
    projectOnly: summary.projectOnly,
    plannedUpgrades: summary.plannedUpgrades,
    bands: summary.bands,
    generations: summary.generations,
  };
  // The two documents are built once and served apart because they are read at
  // different moments and at different sizes: the maillage arrives with the
  // layer at 394 KB gzipped, and a viewport slice is only asked for once the
  // camera is inside 0.32 degrees.
  return {
    supports,
    mesh: {
      mesh: buildAnfrMesh(supports),
      ...summary,
      licence: observatoire.licence,
      discovered: observatoire.discovered,
      das,
      builtInMs: Date.now() - started,
    },
    national,
    vocab: { operators: summary.operators, systems: summary.systems, natures: summary.natures },
    edition: summary.edition,
    source: summary.source,
    licence: observatoire.licence,
    natureAvailable: summary.natureAvailable,
  };
}

async function readAnfrDisk() {
  if (_anfrDiskChecked) return;
  _anfrDiskChecked = true;
  try {
    const entry = JSON.parse(await fsp.readFile(ANFR_CACHE_PATH, 'utf8'));
    if (entry?.version === ANFR_CACHE_VERSION
      && Number.isFinite(entry.at)
      && Array.isArray(entry.payload?.supports)
      && Array.isArray(entry.payload?.mesh?.mesh)) {
      _anfrRegister = entry;
    }
  } catch { /* no disk cache yet */ }
}

function writeAnfrDisk(entry) {
  fsp.mkdir(ANFR_DISK_DIR, { recursive: true })
    .then(() => fsp.writeFile(ANFR_CACHE_PATH, JSON.stringify(entry)))
    .catch((err) => console.warn('[ANFR Proxy] cache write failed:', err?.message || err));
}

/** Shared build, so `/mesh` and `/supports` never sweep 826 418 rows twice. */
function ensureAnfrRegister() {
  if (!_anfrInFlight) {
    _anfrInFlight = refreshAnfrRegister()
      .then((payload) => {
        const entry = { version: ANFR_CACHE_VERSION, at: Date.now(), payload };
        _anfrRegister = entry;
        writeAnfrDisk(entry);
        return entry;
      })
      .finally(() => { _anfrInFlight = null; });
  }
  return _anfrInFlight;
}

/** The requested box, or null when it is malformed or wider than the ceiling. */
function anfrBoxFrom(url) {
  const south = Number(url.searchParams.get('south'));
  const west = Number(url.searchParams.get('west'));
  const north = Number(url.searchParams.get('north'));
  const east = Number(url.searchParams.get('east'));
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (south >= north || west >= east) return null;
  if (north - south > ANFR_MAX_BOX_DEG || east - west > ANFR_MAX_BOX_DEG) return null;
  return { south, west, north, east };
}

/**
 * Every support in the box, with its masks decoded to labels.
 *
 * Resolved here rather than on the client because a viewport answer has to be
 * self-contained: an operator who opens the app already zoomed into a city
 * never fetches `/mesh`, and a card that said `ops: 9` would be waiting on a
 * vocabulary it has no reason to have. The cost is measured and small — the
 * fullest possible box is 112 831 bytes gzipped resolved against 96 004 as
 * bare tuples.
 */
function anfrSupportsInBox(payload, box) {
  const { operators, systems, natures } = payload.vocab;
  const rows = [];
  let inBox = 0;
  for (const tuple of payload.supports) {
    const lat = tuple[ANFR_LAT];
    const lon = tuple[ANFR_LON];
    if (lat < box.south || lat > box.north || lon < box.west || lon > box.east) continue;
    inBox += 1;
    if (rows.length >= ANFR_MAX_SUPPORTS) continue;
    rows.push({
      id: tuple[ANFR_ID],
      lat,
      lon,
      svc: tuple[ANFR_SVC],
      live: tuple[ANFR_LIVE],
      plan: tuple[ANFR_PLAN],
      operators: anfrDecodeMask(tuple[ANFR_OPS], operators),
      systems: anfrDecodeMask(tuple[ANFR_SYS], systems),
      nature: natures[String(tuple[ANFR_NAT])] || null,
      heightM: tuple[ANFR_HAUT],
    });
  }
  return { supports: rows, count: rows.length, inBox, truncated: inBox > rows.length, box };
}

/**
 * One Cartoradio body.
 *
 * `/api/v1/statistiques/operateur` answers HTTP 200 with a ZERO-byte body, so
 * an empty response is treated as a failure here rather than being handed to
 * `JSON.parse`, which would throw a parse error where a status error belongs.
 */
async function fetchCartoradio(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(ANFR_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
  const text = await readResponseTextCapped(response, ANFR_MAX_BYTES);
  if (!text) throw new Error('empty upstream body');
  return JSON.parse(text);
}

/**
 * The on-demand card for ONE mast: four Cartoradio calls, worst case.
 *
 * The Cartoradio REST API is the undocumented backend of ANFR's own map. The
 * DATA it serves is the same Licence Ouverte data, but nothing grants the
 * right to hammer the endpoint: it carries no rate-limit headers and no
 * licence statement of its own. So this is one build per mast, cached for a
 * day, coalesced per SUP_ID, and never a viewport loop.
 *
 * Every leg degrades on its own and says which one failed, because they mean
 * different things: no site is no address, no antennas is no frequency pairs
 * and no equipment date, and no measurement is no exposure readout — but any
 * one of the three still leaves a card worth showing.
 */
async function buildAnfrDetail(supId, position) {
  const degraded = [];
  const [siteBody, antennaBody] = await Promise.all([
    fetchCartoradio(`${CARTORADIO_BASE}/sites/${supId}`).catch((error) => {
      degraded.push(`fiche support (${error?.message || error})`);
      return null;
    }),
    fetchCartoradio(`${CARTORADIO_BASE}/sites/${supId}/antennes`).catch((error) => {
      degraded.push(`antennes (${error?.message || error})`);
      return null;
    }),
  ]);
  const site = siteBody ? projectCartoradioSupport(siteBody) : null;
  const antennas = antennaBody ? projectCartoradioAntennas(antennaBody) : null;
  // Cartoradio's own coordinate when it answered, the register's otherwise —
  // and never an invented one.
  const lat = Number.isFinite(site?.lat) ? site.lat : position?.lat;
  const lon = Number.isFinite(site?.lon) ? site.lon : position?.lon;

  let exposure = null;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    // All seven parameters are mandatory: omitting any one returns HTTP 500
    // with the body `{}`, which is the worst possible failure signature —
    // the status looks like an outage and the body parses fine.
    const bbox = anfrExposureBbox(lat, lon, ANFR_EXPOSURE_RADIUS_M);
    const listed = await fetchCartoradio(
      `${CARTORADIO_BASE}/mesures?stationsRadioelec=true&objetsCom=true`
      + `&anciennete=99999&format=geojson&bbox=${bbox}`,
    ).catch((error) => {
      degraded.push(`mesures (${error?.message || error})`);
      return null;
    });
    if (listed) {
      // The list carries no V/m — its properties are only
      // `{objet_communicant}` — so the nearest point is located first and only
      // that one report is fetched.
      const near = projectCartoradioExposure({ mesures: listed, lat, lon });
      const report = near.nearest
        ? await fetchCartoradio(`${CARTORADIO_BASE}/mesures/${near.nearest.id}`).catch((error) => {
          degraded.push(`rapport ${near.nearest.id} (${error?.message || error})`);
          return null;
        })
        : null;
      exposure = projectCartoradioExposure({
        mesures: listed, report, lat, lon, newestService: antennas?.newestService || null,
      });
    }
  }
  return { supId, site, antennas, exposure, degraded, source: 'Cartoradio — ANFR' };
}

function ensureAnfrDetail(supId, position) {
  const cached = _anfrDetails.get(supId);
  if (cached && Date.now() - cached.at <= ANFR_DETAIL_TTL_MS) return Promise.resolve(cached.payload);
  const { promise } = coalesceProxyRequest(_anfrDetailInFlight, String(supId), async () => {
    const payload = await buildAnfrDetail(supId, position);
    _anfrDetails.set(supId, { at: Date.now(), payload });
    if (_anfrDetails.size > ANFR_DETAIL_MAX) {
      const oldest = _anfrDetails.keys().next().value;
      if (oldest !== undefined) _anfrDetails.delete(oldest);
    }
    return payload;
  });
  return promise;
}

/**
 * Vite plugin: ANFR mobile-network observatory proxy.
 * @returns {import('vite').Plugin}
 */
function anfrFranceProxy() {
  function install(middlewares) {
    middlewares.use('/api/anfr-fr', async (req, res) => {
      const json = (status, body, headers = {}) => {
        if (res.headersSent) return;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'GET') {
        json(405, { error: 'Method Not Allowed' });
        return;
      }
      if (!_anfrRateLimiter(clientKey(req))) {
        json(429, { error: 'Rate limit exceeded' }, { 'Retry-After': '5' });
        return;
      }

      const url = new URL(req.url || '/', 'http://localhost');
      const route = url.pathname.replace(/\/+$/, '') || '/';

      if (route === '/status') {
        await readAnfrDisk();
        json(200, {
          source: ANFR_SOURCE,
          portal: ANFR_PORTAL,
          dataset: ANFR_DATASET,
          dasDataset: ANFR_DAS_DATASET,
          cartoradio: CARTORADIO_BASE,
          ttlMs: ANFR_TTL_MS,
          maxBoxDeg: ANFR_MAX_BOX_DEG,
          register: _anfrRegister
            ? {
              at: _anfrRegister.at,
              edition: _anfrRegister.payload.edition,
              licence: _anfrRegister.payload.licence,
              discovered: _anfrRegister.payload.mesh.discovered,
              supports: _anfrRegister.payload.national.count,
              live: _anfrRegister.payload.national.live,
              projectOnly: _anfrRegister.payload.national.projectOnly,
              plannedUpgrades: _anfrRegister.payload.national.plannedUpgrades,
              rowsSwept: _anfrRegister.payload.mesh.rowsSwept,
              rowsTotal: _anfrRegister.payload.mesh.rowsTotal,
              complete: _anfrRegister.payload.mesh.complete,
              natureAvailable: _anfrRegister.payload.natureAvailable,
              builtInMs: _anfrRegister.payload.mesh.builtInMs,
            }
            : null,
          detailsCached: _anfrDetails.size,
        }, { 'Cache-Control': 'public, max-age=60' });
        return;
      }

      // ── One mast's Cartoradio card ─────────────────────────────────────────
      const detailMatch = /^\/support\/(\d{1,9})$/.exec(route);
      if (detailMatch) {
        const supId = Number(detailMatch[1]);
        await readAnfrDisk();
        // The register's own position for the mast, so the exposure box can be
        // built even when Cartoradio's site call is the leg that failed.
        let position = null;
        for (const tuple of _anfrRegister?.payload?.supports || []) {
          if (tuple[ANFR_ID] === supId) {
            position = { lat: tuple[ANFR_LAT], lon: tuple[ANFR_LON] };
            break;
          }
        }
        try {
          const payload = await ensureAnfrDetail(supId, position);
          json(200, { ...payload, fetchedAt: Date.now() }, { 'X-ANFR-FR': 'DETAIL' });
        } catch (error) {
          console.warn(`[ANFR Proxy] Cartoradio detail ${supId} failed:`, error?.message || error);
          json(503, { error: 'Cartoradio is temporarily unavailable for this support' });
        }
        return;
      }

      if (route !== '/mesh' && route !== '/supports') {
        json(404, { error: 'Unknown ANFR endpoint' });
        return;
      }

      let box = null;
      if (route === '/supports') {
        box = anfrBoxFrom(url);
        if (!box) {
          json(400, {
            error: `A bounding box of at most ${ANFR_MAX_BOX_DEG}° is required `
              + '(south, west, north, east)',
          });
          return;
        }
      }

      const pick = (payload) => (route === '/mesh'
        ? payload.mesh
        : {
          ...anfrSupportsInBox(payload, box),
          national: payload.national,
          edition: payload.edition,
          source: payload.source,
          licence: payload.licence,
          natureAvailable: payload.natureAvailable,
        });

      await readAnfrDisk();
      const now = Date.now();
      if (_anfrRegister && now - _anfrRegister.at <= ANFR_TTL_MS) {
        json(200, { ...pick(_anfrRegister.payload), fetchedAt: _anfrRegister.at, stale: false }, { 'X-ANFR-FR': 'HIT' });
        return;
      }
      try {
        const entry = await ensureAnfrRegister();
        json(200, { ...pick(entry.payload), fetchedAt: entry.at, stale: false }, { 'X-ANFR-FR': 'MISS' });
      } catch (error) {
        console.warn('[ANFR Proxy] register build unavailable:', error?.message || error);
        // The edition is a whole week and the file is republished weekly, so a
        // register a fortnight old is still a true map of French masts.
        // Serving it beats blanking the country.
        if (_anfrRegister && now - _anfrRegister.at <= ANFR_STALE_MS) {
          json(200, { ...pick(_anfrRegister.payload), fetchedAt: _anfrRegister.at, stale: true }, { 'X-ANFR-FR': 'STALE' });
          return;
        }
        json(503, { error: 'The ANFR mobile-network register is temporarily unavailable' });
      }
    });
  }

  return {
    name: 'anfr-france-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

/**
 * Paris cool-islands proxy — keyless, ODbL, three registers and a tree register.
 *
 *   GET /api/fraicheur-fr/refuges                       — the whole city, once
 *   GET /api/fraicheur-fr/arbres?south&west&north&east  — one snapped box of trees
 *   GET /api/fraicheur-fr/status                        — provenance and cache state
 *
 * WHY A PROXY AT ALL. `opendata.paris.fr` answers `access-control-allow-origin:
 * *` on both `records` and `exports`, so the browser could call it directly.
 * Two measurements say not to. First, the day budget: the portal publishes
 * `x-ratelimit-limit: 10000` per day, resetting at midnight UTC, and this layer
 * asks a question per camera settle — a single busy afternoon of panning would
 * spend a shared allowance no other tab can get back. Second, the fold: the
 * three refuge registers cost **9 929 649 B decoded** across three parallel
 * calls (2 454 ms wall, measured 2026-09-02) and the browser needs **3 451 189 B
 * of JSON, 643 107 B gzipped** out of them. Doing that once on a server and
 * serving it from a one-hour cache is the difference between 3 upstream calls an
 * hour and 3 per tab per reload.
 *
 * WHY TWO ROUTES AND NOT THREE OR ONE. `/refuges` takes no viewport parameter
 * at all: the answer is the same 643 KB whatever the camera is doing, the three
 * registers are read together, and splitting them would make the layer's first
 * paint three round trips. `/arbres` cannot join it — the tree register is
 * 219 432 rows and 111 MB decoded whole — so it is the one bbox route.
 *
 * WHY THE PROBE COMES FIRST. `records?where=in_bbox(...)&limit=0&select=count(*)
 * as n` answers "how many trees are in this box" in **36 bytes and 99 ms**,
 * measured. Over {@link FRAICHEUR_TREE_BUDGET} the export is never bought and
 * the true count is returned instead: on the densest grid-aligned box in Paris
 * (48.816,2.346 -> 48.836,2.366, the 13e) the probe answers 10 571 and the
 * export that would have followed is 3 368 281 B and 1 733 ms.
 *
 * The three refuge calls fan out with `Promise.all` and each one CATCHES: losing
 * the fountains costs 1 323 taps and keeps 984 parks, and `projectFraicheurRefuges`
 * reports which of the three answered in `payload.available`.
 */
const FRAICHEUR_BASE = `https://${FRAICHEUR_PORTAL}/api/explore/v2.1/catalog/datasets`;
/**
 * One hour on the city pack. The equipment register was rebuilt
 * 2026-09-01T05:45:08Z and the fountains 2026-08-31T07:42:08Z — daily — and
 * `horaires_periode` on the equipment is a one-WEEK validity window, while
 * `statut_ouverture` on a brumisateur ("Eteint"/"Ouvert") can move inside a day.
 * 24 refreshes a day is 72 upstream calls against a 10 000/day allowance.
 */
const FRAICHEUR_TTL_MS = 60 * 60 * 1000;
/** Serve-stale ceiling. Last week's park is still a park. */
const FRAICHEUR_STALE_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Six hours per tree box. `les-arbres` was last modified 2026-08-28T08:35:28Z
 * and moves in weeks, so a box re-asked inside six hours cannot have changed.
 */
const FRAICHEUR_TREE_TTL_MS = 6 * 60 * 60 * 1000;
const FRAICHEUR_TIMEOUT_MS = 90_000;
/** Largest single upstream body is the green-space export at 9 216 103 B. */
const FRAICHEUR_MAX_BYTES = 24 * 1024 * 1024;
/** The densest box measured 3 368 281 B decoded for 10 571 trees. */
const FRAICHEUR_TREE_MAX_BYTES = 16 * 1024 * 1024;
const FRAICHEUR_TREE_CACHE_MAX = 48;
const FRAICHEUR_DISK_DIR = path.join(process.cwd(), '.gev-cache', 'fraicheur-fr');
const FRAICHEUR_CACHE_PATH = path.join(FRAICHEUR_DISK_DIR, 'refuges.json');
const FRAICHEUR_TREE_DISK_DIR = path.join(FRAICHEUR_DISK_DIR, 'arbres');
/**
 * Shape version of both cached folds. Bump whenever `projectFraicheurRefuges`
 * or `projectFraicheurTrees` changes what it returns — the memory cache lives
 * for an hour but the disk cache outlives the edit by a week otherwise.
 */
const FRAICHEUR_CACHE_VERSION = 1;

/** @type {?{version:number, at:number, payload:object}} */
let _fraicheurRefuges = null;
/** @type {?Promise<{version:number, at:number, payload:object}>} */
let _fraicheurInFlight = null;
let _fraicheurDiskChecked = false;
/** @type {Map<string, {version:number, at:number, payload:object}>} LRU by box key. */
const _fraicheurTreeCache = new Map();
/** @type {Map<string, Promise<object>>} */
const _fraicheurTreeInFlight = new Map();
/**
 * 60/min per client and 180/min globally, matching `cadastreFranceProxy`: this
 * layer is viewport-chatty on `/arbres` in exactly the way the cadastre is, and
 * `comptages-fr`'s 30 would throttle an operator simply walking down a street.
 */
const _fraicheurRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 180 });

/** GET one Opendatasoft URL as JSON, under a timeout and a byte cap. */
async function fetchFraicheurJson(url, maxBytes = FRAICHEUR_MAX_BYTES) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FRAICHEUR_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
  return readResponseJsonCapped(response, maxBytes);
}

/**
 * One `exports/geojson` URL.
 *
 * `limit=-1` is the portal's "no limit" and `exports/*` is subject to neither
 * of the caps `records` carries — 100 rows a page (`limit=101` -> HTTP 400) and
 * `offset + limit <= 10000` (HTTP 400, *"Invalid value for sum of offset +
 * limit API parameter: 10099 was found but <= 10000 is expected."*). The geo
 * field is deliberately absent from every `select`: the export emits the
 * geometry regardless and naming it ships the coordinates twice, measured at
 * 81 148 B against 61 794 B on the fountains.
 */
function fraicheurExportUrl(dataset, fields, where = null) {
  const params = new URLSearchParams({ select: fields.join(','), limit: '-1' });
  if (where) params.set('where', where);
  return `${FRAICHEUR_BASE}/${dataset}/exports/geojson?${params}`;
}

/** The 36-byte population probe for one bbox. */
function fraicheurTreeProbeUrl(where) {
  const params = new URLSearchParams({ where, limit: '0', select: 'count(*) as n' });
  return `${FRAICHEUR_BASE}/${FRAICHEUR_TREE_DATASET}/records?${params}`;
}

/**
 * Build the whole-city pack.
 *
 * Each of the three is caught on its own, so a register that fails degrades the
 * pack instead of failing it — `payload.available` names which answered and the
 * layer's row says so.
 */
async function refreshFraicheurRefuges() {
  const warn = (name) => (error) => {
    console.warn(`[Fraicheur Proxy] ${name} register unavailable:`, error?.message || error);
    return null;
  };
  const [spaces, equipment, fountains] = await Promise.all([
    fetchFraicheurJson(fraicheurExportUrl(FRAICHEUR_SPACES_DATASET, FRAICHEUR_SPACE_FIELDS)).catch(warn('green-space')),
    fetchFraicheurJson(fraicheurExportUrl(FRAICHEUR_EQUIPMENT_DATASET, FRAICHEUR_EQUIPMENT_FIELDS)).catch(warn('equipment')),
    fetchFraicheurJson(fraicheurExportUrl(FRAICHEUR_FOUNTAIN_DATASET, FRAICHEUR_FOUNTAIN_FIELDS)).catch(warn('fountain')),
  ]);
  // All three down is a failure, not a degraded pack: an empty document would
  // paint an empty Paris and claim it was true.
  if (!spaces && !equipment && !fountains) throw new Error('all three registers unavailable');
  return projectFraicheurRefuges({ spaces, equipment, fountains, source: FRAICHEUR_SOURCE });
}

/**
 * Build one box of trees. The probe decides whether the export is bought at all.
 */
async function refreshFraicheurTrees(box) {
  const where = fraicheurTreeWhere(box);
  const probe = await fetchFraicheurJson(fraicheurTreeProbeUrl(where), 64 * 1024);
  const total = Number(probe?.total_count);
  if (Number.isFinite(total) && total > FRAICHEUR_TREE_BUDGET) {
    // Refused before the download. This is the whole point of the probe.
    return projectFraicheurTrees({ features: null, totalInBox: total, box });
  }
  const features = await fetchFraicheurJson(
    fraicheurExportUrl(FRAICHEUR_TREE_DATASET, FRAICHEUR_TREE_FIELDS, where),
    FRAICHEUR_TREE_MAX_BYTES,
  );
  return projectFraicheurTrees({ features, totalInBox: Number.isFinite(total) ? total : null, box });
}

async function readFraicheurDisk() {
  if (_fraicheurDiskChecked) return;
  _fraicheurDiskChecked = true;
  try {
    const entry = JSON.parse(await fsp.readFile(FRAICHEUR_CACHE_PATH, 'utf8'));
    if (entry?.version === FRAICHEUR_CACHE_VERSION
      && Number.isFinite(entry.at)
      && Array.isArray(entry.payload?.spaces)
      && Array.isArray(entry.payload?.equipment)) {
      _fraicheurRefuges = entry;
    }
  } catch { /* no disk cache yet */ }
}

function writeFraicheurDisk(entry) {
  fsp.mkdir(FRAICHEUR_DISK_DIR, { recursive: true })
    .then(() => fsp.writeFile(FRAICHEUR_CACHE_PATH, JSON.stringify(entry)))
    .catch((err) => console.warn('[Fraicheur Proxy] cache write failed:', err?.message || err));
}

function fraicheurTreeDiskPath(key) {
  return path.join(FRAICHEUR_TREE_DISK_DIR, `${createHash('sha1').update(key).digest('hex')}.json`);
}

async function readFraicheurTreeDisk(key) {
  try {
    const entry = JSON.parse(await fsp.readFile(fraicheurTreeDiskPath(key), 'utf8'));
    if (entry?.version !== FRAICHEUR_CACHE_VERSION) return null;
    if (!Number.isFinite(entry.at) || !Array.isArray(entry.payload?.trees)) return null;
    if (Date.now() - entry.at > FRAICHEUR_TREE_TTL_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

function writeFraicheurTreeDisk(key, entry) {
  fsp.mkdir(FRAICHEUR_TREE_DISK_DIR, { recursive: true })
    .then(() => fsp.writeFile(fraicheurTreeDiskPath(key), JSON.stringify(entry)))
    .catch((err) => console.warn('[Fraicheur Proxy] tree cache write failed:', err?.message || err));
}

function trimFraicheurTreeCache() {
  while (_fraicheurTreeCache.size > FRAICHEUR_TREE_CACHE_MAX) {
    const oldest = _fraicheurTreeCache.keys().next().value;
    if (oldest === undefined) break;
    _fraicheurTreeCache.delete(oldest);
  }
}

/** Single-flight, so two tabs opening at once cost one three-call sweep. */
function ensureFraicheurRefuges() {
  if (!_fraicheurInFlight) {
    _fraicheurInFlight = refreshFraicheurRefuges()
      .then((payload) => {
        const entry = { version: FRAICHEUR_CACHE_VERSION, at: Date.now(), payload };
        _fraicheurRefuges = entry;
        writeFraicheurDisk(entry);
        return entry;
      })
      .finally(() => { _fraicheurInFlight = null; });
  }
  return _fraicheurInFlight;
}

/**
 * Per-box single-flight: two tabs asking for the same box cost one sweep.
 * `coalesceProxyRequest` returns `{ promise, shared }`, not a promise — the
 * `shared` flag is what lets the response header say INFLIGHT rather than MISS.
 */
function ensureFraicheurTrees(key, box) {
  return coalesceProxyRequest(_fraicheurTreeInFlight, key, async () => {
    const payload = await refreshFraicheurTrees(box);
    const entry = { version: FRAICHEUR_CACHE_VERSION, at: Date.now(), payload };
    _fraicheurTreeCache.set(key, entry);
    trimFraicheurTreeCache();
    writeFraicheurTreeDisk(key, entry);
    return entry;
  });
}

/**
 * Vite plugin: Paris cool-islands, green spaces, fountains and street trees.
 * @returns {import('vite').Plugin}
 */
function fraicheurParisProxy() {
  function install(middlewares) {
    middlewares.use('/api/fraicheur-fr', async (req, res) => {
      const json = (status, body, headers = {}) => {
        if (res.headersSent) return;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'GET') {
        json(405, { error: 'Method Not Allowed' });
        return;
      }
      if (!_fraicheurRateLimiter(clientKey(req))) {
        json(429, { error: 'Rate limit exceeded' }, { 'Retry-After': '5' });
        return;
      }

      const url = new URL(req.url || '/', 'http://localhost');
      const route = url.pathname.replace(/\/+$/, '') || '/';

      if (route === '/status') {
        await readFraicheurDisk();
        json(200, {
          source: FRAICHEUR_SOURCE,
          portal: FRAICHEUR_PORTAL,
          licence: FRAICHEUR_LICENCE,
          licenceUrl: FRAICHEUR_LICENCE_URL,
          publishers: FRAICHEUR_PUBLISHERS,
          treeSource: FRAICHEUR_TREE_SOURCE,
          ttlMs: FRAICHEUR_TTL_MS,
          treeTtlMs: FRAICHEUR_TREE_TTL_MS,
          treeBudget: FRAICHEUR_TREE_BUDGET,
          treeMaxBoxDeg: FRAICHEUR_TREE_REQUEST_MAX_BOX_DEG,
          cachedTreeBoxes: _fraicheurTreeCache.size,
          refuges: _fraicheurRefuges
            ? {
              at: _fraicheurRefuges.at,
              spaces: _fraicheurRefuges.payload.spaces.length,
              equipment: _fraicheurRefuges.payload.equipment.length,
              fountains: _fraicheurRefuges.payload.fountains.length,
              available: _fraicheurRefuges.payload.available,
              unplaced: _fraicheurRefuges.payload.unplaced,
              geometry: _fraicheurRefuges.payload.geometry,
              refReuse: _fraicheurRefuges.payload.refReuse,
            }
            : null,
        }, { 'Cache-Control': 'public, max-age=60' });
        return;
      }

      if (route === '/refuges') {
        await readFraicheurDisk();
        const now = Date.now();
        if (_fraicheurRefuges && now - _fraicheurRefuges.at <= FRAICHEUR_TTL_MS) {
          json(200, { ..._fraicheurRefuges.payload, fetchedAt: _fraicheurRefuges.at, stale: false }, { 'X-FRAICHEUR-FR': 'HIT' });
          return;
        }
        try {
          const entry = await ensureFraicheurRefuges();
          json(200, { ...entry.payload, fetchedAt: entry.at, stale: false }, { 'X-FRAICHEUR-FR': 'MISS' });
        } catch (error) {
          console.warn('[Fraicheur Proxy] city pack unavailable:', error?.message || error);
          // A week-old pack still describes the same 984 parks and the same
          // 1 323 taps; only the timetables age, and the layer says which
          // window each one came from.
          if (_fraicheurRefuges && now - _fraicheurRefuges.at <= FRAICHEUR_STALE_MS) {
            json(200, { ..._fraicheurRefuges.payload, fetchedAt: _fraicheurRefuges.at, stale: true }, { 'X-FRAICHEUR-FR': 'STALE' });
            return;
          }
          json(503, { error: 'Paris cool-island registers are temporarily unavailable' });
        }
        return;
      }

      if (route !== '/arbres') {
        json(404, { error: 'Unknown fraicheur endpoint' });
        return;
      }

      const requested = validBox({
        south: url.searchParams.get('south'),
        west: url.searchParams.get('west'),
        north: url.searchParams.get('north'),
        east: url.searchParams.get('east'),
      }, FRAICHEUR_TREE_REQUEST_MAX_BOX_DEG);
      if (!requested) {
        json(400, {
          error: `A non-dateline bbox no larger than ${FRAICHEUR_TREE_REQUEST_MAX_BOX_DEG} degrees is required`,
          maxBoxDeg: FRAICHEUR_TREE_REQUEST_MAX_BOX_DEG,
        });
        return;
      }
      // Snapped OUTWARD onto the same grid the client snaps on, so the two
      // agree on the cache key. A client box is already aligned and this is a
      // no-op for it; a hand-built request is aligned here instead.
      const box = snapBoxOutward(requested, FRAICHEUR_TREE_BOX_STEP_DEG);
      // `les-arbres` describes exactly one city. A box outside it is answered
      // with an empty payload and ZERO upstream calls rather than spending a
      // request from a shared 10 000/day allowance to be told nothing.
      if (!boxesIntersect(box, FRAICHEUR_COVERAGE)) {
        json(200, {
          ...projectFraicheurTrees({ features: null, totalInBox: 0, box }),
          fetchedAt: Date.now(), stale: false, offCoverage: true,
        }, { 'X-FRAICHEUR-FR': 'OFF-COVERAGE' });
        return;
      }

      const key = boxKey(box, 3);
      const now = Date.now();
      const cached = _fraicheurTreeCache.get(key);
      if (cached && now - cached.at <= FRAICHEUR_TREE_TTL_MS) {
        json(200, { ...cached.payload, fetchedAt: cached.at, stale: false }, { 'X-FRAICHEUR-FR': 'HIT' });
        return;
      }
      const onDisk = await readFraicheurTreeDisk(key);
      if (onDisk) {
        _fraicheurTreeCache.set(key, onDisk);
        trimFraicheurTreeCache();
        json(200, { ...onDisk.payload, fetchedAt: onDisk.at, stale: false }, { 'X-FRAICHEUR-FR': 'DISK' });
        return;
      }
      try {
        const request = ensureFraicheurTrees(key, box);
        const entry = await request.promise;
        json(200, { ...entry.payload, fetchedAt: entry.at, stale: false },
          { 'X-FRAICHEUR-FR': request.shared ? 'INFLIGHT' : 'MISS' });
      } catch (error) {
        console.warn('[Fraicheur Proxy] tree box unavailable:', error?.message || error);
        if (cached) {
          json(200, { ...cached.payload, fetchedAt: cached.at, stale: true }, { 'X-FRAICHEUR-FR': 'STALE' });
          return;
        }
        json(503, { error: 'Paris tree register is temporarily unavailable for this view' });
      }
    });
  }

  return {
    name: 'fraicheur-paris-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

/**
 * Sitadel — one commune of building permits, joined to its own cadastral
 * parcels, because the file publishes no coordinate at all.
 *
 * Three upstreams, and the ORDER of the constants below is the order they are
 * called in:
 *
 *   1. `geo.api.gouv.fr/communes?lat=&lon=` — which commune is under the point.
 *      This is the only service entitled to answer that question, and it is why
 *      the layer has no coverage rectangle: Sitadel and the Etalab cadastre both
 *      cover the DROM (Saint-Denis de La Réunion, 97411, answers with 2 849
 *      permits and a 10 449 654-byte parcel file), so a metropolitan box would
 *      have refused them while claiming national coverage.
 *   2. DiDo `/datafiles/<rid>/json?COMM=eq:<insee>&columns=…` — the permits.
 *   3. `cadastre.data.gouv.fr/.../latest/...json.gz` — the parcels to join to.
 *      Not browser-reachable: the 302 from `latest` carries no
 *      `access-control-allow-origin`, so this has to be server-side. Its target
 *      does serve CORS, but the Fetch spec applies the check to the redirect.
 *
 * ── The measurement that shapes this whole file ─────────────────────────────
 *
 * **DiDo refuses a fourth simultaneous request.** Measured 2026-09-02: six
 * parallel queries returned three HTTP 200 and three HTTP 429 within 145 ms,
 * body `max connections reached: 3` — 26 bytes of plain text, with no
 * `content-type`, no `retry-after` and no `access-control-allow-origin`. Three
 * at once are all served, across different datafiles, so the cap is per client
 * and not per file. `withSitadelDidoSlot` is a global semaphore of
 * {@link SITADEL_DIDO_CONCURRENCY} = 2, which leaves one slot of headroom for
 * anything else sharing this egress address, and it is why the two permit
 * queries of one build cannot collide with the two of another.
 *
 * The 429 body is not JSON, so it is detected on the status code BEFORE any
 * parse: `readResponseJsonCapped` on it would report a SyntaxError and the
 * degraded sentence would name the wrong problem.
 *
 * ── Why the cache is a day and the stale window a month ─────────────────────
 *
 * DiDo publishes monthly: dataset 6513f0189d7d312c80ec5b5b returns
 * `frequency: "monthly"` and `frequency_date: "2026-09-29"`, and the four
 * datafiles all carry `millesime: "2026-08"`. The Etalab cadastre republishes
 * about quarterly — `latest` resolved to the 2026-06-01 edition on 2026-09-02.
 * Nothing in this pack can move inside a day, and a month-old pack is still the
 * same commune, so a failure serves stale rather than blanking a city.
 *
 * ── Cold-build cost, measured end to end on 2026-09-02 ──────────────────────
 *
 *   Nantes  44109  6 567 ms  — geocode 270, meta 1 089, permits 4 008
 *                              (2 049 + 1 587 rows), 1 cadastre file
 *                              5 176 390 B gz, index 21 ms, project 59 ms;
 *                              payload 2 085 427 B / 461 277 B gzipped
 *   Paris   75056  5 870 ms  — geocode 46, meta 855, permits 4 204
 *                              (3 595 + 1 609 rows), 20 cadastre files
 *                              6 306 789 B gz in 663 ms, index 18 ms,
 *                              project 21 ms; payload 3 144 667 B / 676 149 B
 *
 * The 4 s is DiDo scanning an 889 MB CSV and is size-independent: a
 * single-column probe of the same commune took 3.57 s. Everything this proxy
 * does itself is under 100 ms.
 */
const SITADEL_GEO_BASE = 'https://geo.api.gouv.fr';
/** A day. DiDo is monthly and the cadastre quarterly; see the header. */
const SITADEL_TTL_MS = 24 * 60 * 60 * 1000;
/** Serve-stale ceiling — a month-old pack is still the same commune. */
const SITADEL_STALE_MS = 30 * 24 * 60 * 60 * 1000;
/** Rid + millésime discovery. Six hours: the next publication is 2026-09-29. */
const SITADEL_META_TTL_MS = 6 * 60 * 60 * 1000;
/** Reverse geocode. A commune boundary moves on 1 January and not otherwise. */
const SITADEL_GEO_TTL_MS = 24 * 60 * 60 * 1000;
/** A cold build is 5.9–6.6 s and DiDo alone owns 4 of them. */
const SITADEL_TIMEOUT_MS = 120_000;
/** Largest measured permit answer: Toulouse, 2 067 554 B for 3 846 rows. */
const SITADEL_PERMITS_MAX_BYTES = 24 * 1024 * 1024;
/** Largest measured single decompressed parcel file: Nantes, 36 468 916 B. */
const SITADEL_CADASTRE_MAX_BYTES = 96 * 1024 * 1024;
/** The DiDo dataset record is 143 422 B; the geocode with a contour, 153 821 B for Marseille. */
const SITADEL_META_MAX_BYTES = 4 * 1024 * 1024;
/**
 * Etalab files fetched at once. 20 for Paris and 16 for Marseille came back in
 * 663 ms at full fan-out; 8 is polite to a mirror that is doing us a favour and
 * still finishes the widest commune in three waves.
 */
const SITADEL_CADASTRE_CONCURRENCY = 8;
/**
 * Simultaneous DiDo requests. Three is the documented ceiling (measured, see
 * the header); two leaves one slot of headroom.
 */
const SITADEL_DIDO_CONCURRENCY = 2;
/**
 * Communes kept in memory. Paris' pack is 3 144 667 B, so eight is at most
 * ~25 MB and covers a session that walks a metropolitan area; the rest is on
 * disk, one file per INSEE code.
 */
const SITADEL_COMMUNE_CACHE_MAX = 8;
/** Commune answers per lat/lon cell kept in memory, including the negative ones. */
const SITADEL_GEO_CACHE_MAX = 512;
/** Decimals the reverse-geocode cache key is rounded to. 4 ≈ 11 m. */
const SITADEL_GEO_KEY_DECIMALS = 4;
const SITADEL_DISK_DIR = path.join(process.cwd(), '.gev-cache', 'sitadel-fr');
const SITADEL_COMMUNE_DISK_DIR = path.join(SITADEL_DISK_DIR, 'communes');
/**
 * Shape version of the cached fold. Bump whenever `projectSitadelCommune`
 * changes what it returns, or whenever the column projection changes — the
 * memory cache lives for a day but the disk cache outlives the edit by a month
 * otherwise, and a pack whose `permits[].px` no longer indexes `parcels[]`
 * draws the wrong plots rather than failing.
 */
const SITADEL_CACHE_VERSION = 1;

/** @type {Map<string, {version:number, at:number, payload:object}>} LRU by INSEE. */
const _sitadelCommunes = new Map();
/** @type {Map<string, Promise<object>>} */
const _sitadelInFlight = new Map();
/** @type {Map<string, {at:number, commune:?object}>} LRU by rounded lat/lon; null is a real answer. */
const _sitadelGeo = new Map();
/** @type {?{at:number, housingRid:string, demolitionRid:string, millesime:string}} */
let _sitadelMeta = null;
/** @type {?Promise<object>} */
let _sitadelMetaInFlight = null;
/** Cadastre edition named by the last `latest` redirect that answered. */
let _sitadelCadastreEdition = null;
/** DiDo semaphore. See the header — a fourth concurrent request is a 429. */
let _sitadelDidoActive = 0;
/** @type {Array<() => void>} */
const _sitadelDidoWaiting = [];
/**
 * 60/min per client and 180/min globally, matching `cadastreFranceProxy` and
 * `fraicheurParisProxy`. The layer asks once per 0.01° camera cell and most of
 * those answers are the 200-byte `unchanged` reply, so an operator walking a
 * city never approaches this; a script sweeping communes does.
 */
const _sitadelRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 180 });

/**
 * Run one DiDo request under the global concurrency semaphore.
 *
 * FIFO, so a request that has been waiting is not starved by a fresh one, and
 * the slot is released in a `finally`, because a thrown fetch that kept its
 * slot would deadlock the proxy after two failures.
 *
 * The slot is HANDED OVER rather than decremented and re-taken: when somebody
 * is waiting the counter never drops, so the cap cannot depend on microtask
 * ordering at all. The decrement-first spelling looks like it could let a fresh
 * caller slip into the window between `next()` and the woken waiter resuming —
 * I could NOT build an interleaving where it actually does, because a fresh
 * caller only ever arrives from an I/O macrotask and the microtask queue has
 * drained by then, and both spellings held at 2 over 200 staggered tasks with
 * 29 synthetic throws. This one is written the way that needs no such argument.
 * Verified against three simultaneous commune builds — six DiDo queries,
 * Toulouse + Ustaritz + Beaupréau-en-Mauges: peak concurrency 2, no refusal,
 * 10.5 s, and the counter back at zero.
 * @param {() => Promise<any>} task
 * @returns {Promise<any>}
 */
async function withSitadelDidoSlot(task) {
  if (_sitadelDidoActive >= SITADEL_DIDO_CONCURRENCY) {
    // Woken by a releasing task that handed its slot over; already counted.
    await new Promise((resolve) => { _sitadelDidoWaiting.push(resolve); });
  } else {
    _sitadelDidoActive += 1;
  }
  try {
    return await task();
  } finally {
    const next = _sitadelDidoWaiting.shift();
    if (next) next();
    else _sitadelDidoActive -= 1;
  }
}

/**
 * GET one JSON body under a timeout and a byte cap.
 *
 * The 429 is named explicitly: DiDo answers it with 26 bytes of plain text
 * (`max connections reached: 3`) and no content-type, so parsing first would
 * turn a concurrency refusal into "malformed JSON" and send the operator
 * looking in the wrong place.
 * @param {string} url
 * @param {number} maxBytes
 * @returns {Promise<any>}
 */
async function fetchSitadelJson(url, maxBytes) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(SITADEL_TIMEOUT_MS),
  });
  if (response.status === 429) {
    const error = new Error('DiDo concurrency limit (max connections reached: 3)');
    error.code = 'DIDO_BUSY';
    throw error;
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  return readResponseJsonCapped(response, maxBytes);
}

/**
 * The rids and the millésime, from DiDo's own dataset record.
 *
 * ONE request answers both: `datafiles[].title` carries the rid discovery and
 * `datafiles[].millesimes[].millesime` the edition. Pinned rids are the
 * fallback and never the reverse — a discovery that returns nothing keeps the
 * layer on the rids every measurement in `sitadelFeed.js` was made against.
 * @returns {Promise<{housingRid:string, demolitionRid:string, millesime:string}>}
 */
async function refreshSitadelMeta() {
  let datafiles = [];
  try {
    const dataset = await withSitadelDidoSlot(() => fetchSitadelJson(
      `${SITADEL_DIDO_BASE}/datasets/${SITADEL_DIDO_DATASET}`, SITADEL_META_MAX_BYTES,
    ));
    datafiles = Array.isArray(dataset?.datafiles) ? dataset.datafiles : [];
  } catch (error) {
    // Not fatal. The pinned rids and the millésime floor are what this layer
    // was measured against, so a discovery failure costs the edition label and
    // nothing else.
    console.warn('[Sitadel Proxy] datafile discovery failed, using pinned rids:', error?.message || error);
  }
  return {
    housingRid: discoverSitadelRid(datafiles, SITADEL_HOUSING_TITLE, SITADEL_HOUSING_RID),
    demolitionRid: discoverSitadelRid(datafiles, SITADEL_DEMOLITION_TITLE, SITADEL_DEMOLITION_RID),
    millesime: newestMillesime(
      datafiles.flatMap((file) => (file?.millesimes || []).map((entry) => entry?.millesime)),
      SITADEL_MILLESIME_FLOOR,
    ),
  };
}

/** Single-flight, TTL'd rid/millésime discovery. */
function ensureSitadelMeta() {
  const now = Date.now();
  if (_sitadelMeta && now - _sitadelMeta.at <= SITADEL_META_TTL_MS) return Promise.resolve(_sitadelMeta);
  if (!_sitadelMetaInFlight) {
    _sitadelMetaInFlight = refreshSitadelMeta()
      .then((meta) => {
        _sitadelMeta = { ...meta, at: Date.now() };
        return _sitadelMeta;
      })
      .finally(() => { _sitadelMetaInFlight = null; });
  }
  return _sitadelMetaInFlight;
}

/**
 * The commune under one point, or null when there is no French commune there.
 *
 * `null` is a REAL answer and it is cached as one: `geo.api.gouv.fr` returns
 * `[]` over Lausanne and over the sea, and re-asking every time the camera
 * crosses a cell out there would be a request per pan for an answer that
 * cannot change.
 *
 * The `contour` field is also the input guard. Measured 2026-09-02, an
 * out-of-range latitude on this exact URL answers HTTP 400 with the plain-text
 * body *"This endpoint does not support an unfiltered API call with a geojson
 * format output or a field with contour"* rather than the whole 34 945-commune
 * list — but the numeric validation below happens first anyway, because the
 * cheapest upstream call is the one not made.
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<?object>}
 */
async function locateSitadelCommune(lat, lon) {
  const key = `${lat.toFixed(SITADEL_GEO_KEY_DECIMALS)},${lon.toFixed(SITADEL_GEO_KEY_DECIMALS)}`;
  const cached = _sitadelGeo.get(key);
  if (cached && Date.now() - cached.at <= SITADEL_GEO_TTL_MS) return cached.commune;
  const communes = await fetchSitadelJson(geoCommuneUrl(lat, lon), SITADEL_META_MAX_BYTES);
  // A point falls in one commune. Anything longer than a handful is not an
  // answer to "what is here", it is an unfiltered listing, and taking [0] of it
  // would put the operator in L'Abergement-Clémenciat.
  const commune = Array.isArray(communes) && communes.length > 0 && communes.length <= 4
    ? communes[0] : null;
  _sitadelGeo.set(key, { at: Date.now(), commune: commune || null });
  while (_sitadelGeo.size > SITADEL_GEO_CACHE_MAX) {
    const oldest = _sitadelGeo.keys().next().value;
    if (oldest === undefined) break;
    _sitadelGeo.delete(oldest);
  }
  return commune || null;
}

/**
 * One Etalab parcel file, decompressed.
 *
 * The body is raw gzip served as `application/octet-stream` with no
 * `content-encoding`, so `fetch` does NOT decompress it and `zlib` has to.
 * A 404 is a real answer — Etalab publishes no parcels for Saint-Barthélemy
 * (97701) — and it returns null so the build proceeds with a smaller cadastre
 * and honestly counts the permits as `missing`. Any other failure throws,
 * because a partial cadastre silently converts placed permits into missing ones.
 * @param {string} insee
 * @returns {Promise<?object>}
 */
async function fetchSitadelParcels(insee) {
  const response = await fetch(cadastreCommuneUrl(insee), {
    signal: AbortSignal.timeout(SITADEL_TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status} from cadastre.data.gouv.fr for ${insee}`);
  // `latest` is a symlink and the redirect names the real edition — the
  // cheapest possible discovery, because it costs the request we were making.
  _sitadelCadastreEdition = newestCadastreEdition(response.url, _sitadelCadastreEdition || undefined);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > SITADEL_CADASTRE_MAX_BYTES) {
    throw new Error(`Parcel file for ${insee} too large`);
  }
  const gz = Buffer.from(await response.arrayBuffer());
  const raw = zlib.gunzipSync(gz, { maxOutputLength: SITADEL_CADASTRE_MAX_BYTES });
  return JSON.parse(raw.toString('utf8'));
}

/** Fetch the commune's parcel files, at most SITADEL_CADASTRE_CONCURRENCY at a time. */
async function fetchSitadelCadastre(codes) {
  const collections = [];
  const served = [];
  for (let i = 0; i < codes.length; i += SITADEL_CADASTRE_CONCURRENCY) {
    const wave = codes.slice(i, i + SITADEL_CADASTRE_CONCURRENCY);
    const answers = await Promise.all(wave.map(async (code) => [code, await fetchSitadelParcels(code)]));
    for (const [code, collection] of answers) {
      if (!collection) continue;
      served.push(code);
      collections.push(collection);
    }
  }
  return { collections, served };
}

/**
 * Build one commune's pack.
 *
 * The housing register IS the layer, so its failure fails the build. The
 * demolition file is not: losing it costs the fifth band, and
 * `demolitionAvailable: false` puts that on the row rather than showing a
 * commune that never knocks anything down.
 * @param {object} commune From `geo.api.gouv.fr`.
 * @returns {Promise<object>}
 */
async function refreshSitadelCommune(commune) {
  const insee = String(commune.code);
  const meta = await ensureSitadelMeta();
  const [housing, demolition] = await Promise.all([
    withSitadelDidoSlot(() => fetchSitadelJson(
      sitadelDatafileUrl(meta.housingRid, insee, SITADEL_HOUSING_COLUMNS), SITADEL_PERMITS_MAX_BYTES,
    )),
    withSitadelDidoSlot(() => fetchSitadelJson(
      sitadelDatafileUrl(meta.demolitionRid, insee, SITADEL_DEMOLITION_COLUMNS), SITADEL_PERMITS_MAX_BYTES,
    )).catch((error) => {
      console.warn('[Sitadel Proxy] demolition file unavailable:', error?.message || error);
      return null;
    }),
  ]);
  if (!Array.isArray(housing)) throw new Error('DiDo returned no housing permits');

  const codes = communeCadastreCodes(insee);
  const { collections, served } = await fetchSitadelCadastre(codes);
  const { index, parcels } = indexCadastreParcels(collections);
  return projectSitadelCommune({
    housing,
    demolition: Array.isArray(demolition) ? demolition : [],
    index,
    commune,
    // The scope of the answer, decimated by the same reader the PLU zones use.
    // The layer says "contour communal simplifié" on its own row.
    outline: projectGeometry(commune.contour),
    millesime: meta.millesime,
    cadastreEdition: _sitadelCadastreEdition || undefined,
    cadastreCommunes: served,
    cadastreParcels: parcels,
    demolitionAvailable: Array.isArray(demolition),
  });
}

function sitadelDiskPath(insee) {
  return path.join(SITADEL_COMMUNE_DISK_DIR, `${createHash('sha1').update(insee).digest('hex')}.json`);
}

async function readSitadelDisk(insee) {
  try {
    const entry = JSON.parse(await fsp.readFile(sitadelDiskPath(insee), 'utf8'));
    if (entry?.version !== SITADEL_CACHE_VERSION) return null;
    if (!Number.isFinite(entry.at)) return null;
    if (!Array.isArray(entry.payload?.permits) || !Array.isArray(entry.payload?.parcels)) return null;
    if (entry.payload.insee !== insee) return null;
    if (Date.now() - entry.at > SITADEL_STALE_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

function writeSitadelDisk(insee, entry) {
  fsp.mkdir(SITADEL_COMMUNE_DISK_DIR, { recursive: true })
    .then(() => fsp.writeFile(sitadelDiskPath(insee), JSON.stringify(entry)))
    .catch((err) => console.warn('[Sitadel Proxy] cache write failed:', err?.message || err));
}

function trimSitadelCache() {
  while (_sitadelCommunes.size > SITADEL_COMMUNE_CACHE_MAX) {
    const oldest = _sitadelCommunes.keys().next().value;
    if (oldest === undefined) break;
    _sitadelCommunes.delete(oldest);
  }
}

/**
 * Per-commune single-flight: two tabs on the same city cost one 6 s build.
 * `coalesceProxyRequest` returns `{ promise, shared }` and NOT a promise — the
 * `shared` flag is what lets the response header say INFLIGHT rather than MISS.
 */
function ensureSitadelCommune(commune) {
  const insee = String(commune.code);
  return coalesceProxyRequest(_sitadelInFlight, insee, async () => {
    const payload = await refreshSitadelCommune(commune);
    const entry = { version: SITADEL_CACHE_VERSION, at: Date.now(), payload };
    _sitadelCommunes.set(insee, entry);
    trimSitadelCache();
    writeSitadelDisk(insee, entry);
    return entry;
  });
}

/**
 * Vite plugin: French building and demolition permits, on the parcels they
 * were granted for.
 * @returns {import('vite').Plugin}
 */
function sitadelFranceProxy() {
  function install(middlewares) {
    middlewares.use('/api/sitadel-fr', async (req, res) => {
      const json = (status, body, headers = {}) => {
        if (res.headersSent) return;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'GET') {
        json(405, { error: 'Method Not Allowed' });
        return;
      }
      if (!_sitadelRateLimiter(clientKey(req))) {
        json(429, { error: 'Rate limit exceeded' }, { 'Retry-After': '5' });
        return;
      }

      const url = new URL(req.url || '/', 'http://localhost');
      const route = url.pathname.replace(/\/+$/, '') || '/';

      if (route === '/status') {
        json(200, {
          source: SITADEL_SOURCE,
          licence: SITADEL_LICENCE,
          datasetPage: SITADEL_DATASET_PAGE,
          portal: SITADEL_DIDO_BASE,
          millesime: _sitadelMeta?.millesime || SITADEL_MILLESIME_FLOOR,
          housingRid: _sitadelMeta?.housingRid || SITADEL_HOUSING_RID,
          demolitionRid: _sitadelMeta?.demolitionRid || SITADEL_DEMOLITION_RID,
          cadastreEdition: _sitadelCadastreEdition,
          ttlMs: SITADEL_TTL_MS,
          staleMs: SITADEL_STALE_MS,
          didoConcurrency: SITADEL_DIDO_CONCURRENCY,
          didoActive: _sitadelDidoActive,
          didoWaiting: _sitadelDidoWaiting.length,
          cachedCommunes: [..._sitadelCommunes.entries()].map(([insee, entry]) => ({
            insee,
            commune: entry.payload.commune,
            at: entry.at,
            permits: entry.payload.summary?.permits ?? null,
            placed: entry.payload.summary?.placed ?? null,
            parcels: entry.payload.parcels.length,
          })),
          cachedPoints: _sitadelGeo.size,
        }, { 'Cache-Control': 'public, max-age=60' });
        return;
      }

      if (route !== '/commune') {
        json(404, { error: 'Unknown sitadel endpoint' });
        return;
      }

      const lat = Number(url.searchParams.get('lat'));
      const lon = Number(url.searchParams.get('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)
        || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        json(400, { error: 'lat and lon are required, in degrees' });
        return;
      }

      let commune = null;
      try {
        commune = await locateSitadelCommune(lat, lon);
      } catch (error) {
        console.warn('[Sitadel Proxy] commune lookup failed:', error?.message || error);
        json(503, { error: 'Le référentiel des communes est momentanément indisponible' });
        return;
      }
      if (!commune?.code) {
        // Not an error. The operator is over the sea, over a neighbour, or over
        // a lake. Said explicitly so the layer clears its map instead of
        // leaving the last commune's permits drawn over ground they do not
        // cover.
        json(200, { insee: null, reason: 'off-coverage' }, { 'X-SITADEL-FR': 'NO-COMMUNE' });
        return;
      }
      const insee = String(commune.code);

      // The client already holds this commune. 200 bytes instead of 676 149,
      // and not one upstream call — this is what makes panning free.
      if (url.searchParams.get('have') === insee) {
        json(200, { insee, commune: commune.nom, unchanged: true }, { 'X-SITADEL-FR': 'UNCHANGED' });
        return;
      }

      const now = Date.now();
      const cached = _sitadelCommunes.get(insee) || await readSitadelDisk(insee);
      if (cached && !_sitadelCommunes.has(insee)) {
        _sitadelCommunes.set(insee, cached);
        trimSitadelCache();
      }
      if (cached && now - cached.at <= SITADEL_TTL_MS) {
        json(200, { ...cached.payload, fetchedAt: cached.at, stale: false }, { 'X-SITADEL-FR': 'HIT' });
        return;
      }

      try {
        const request = ensureSitadelCommune(commune);
        const entry = await request.promise;
        json(200, { ...entry.payload, fetchedAt: entry.at, stale: false },
          { 'X-SITADEL-FR': request.shared ? 'INFLIGHT' : 'MISS' });
      } catch (error) {
        const busy = error?.code === 'DIDO_BUSY';
        console.warn('[Sitadel Proxy] commune build failed:', error?.message || error);
        // A month-old pack still describes the same commune: DiDo publishes
        // monthly and a parcel outlives most of the people who own it.
        if (cached && now - cached.at <= SITADEL_STALE_MS) {
          json(200, { ...cached.payload, fetchedAt: cached.at, stale: true }, { 'X-SITADEL-FR': 'STALE' });
          return;
        }
        json(busy ? 429 : 503, {
          error: busy
            ? 'DiDo n’accepte que 3 requêtes simultanées — réessaie dans quelques secondes'
            : `Les autorisations d’urbanisme de ${commune.nom} sont momentanément indisponibles`,
          insee,
        }, busy ? { 'Retry-After': '5' } : {});
      }
    });
  }

  return {
    name: 'sitadel-france-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

/**
 * Île-de-France service-frequency proxy — keyless, Licence Ouverte v2.0.
 *
 *   GET /api/idfm-frequency/stops?south=&west=&north=&east=
 *                                — one viewport, full 7 × 24 profiles
 *   GET /api/idfm-frequency/region — the région folded onto 8 départements
 *   GET /api/idfm-frequency/status — provenance + cache state
 *
 * WHY A PROXY, when the portal sends `access-control-allow-origin: *` and a
 * browser could call it directly (measured 2026-09-02, with
 * `x-ratelimit-limit: 1000000` a day): both products are FOLDS of several calls
 * that no client should re-derive.
 *
 * The viewport product is FIVE upstream calls. One identity call (which stop,
 * where, what name, what mode) and FOUR profile pages, because a stop's 24
 * bands are 24 ROWS — Opendatasoft's aggregate grammar takes arithmetic but not
 * conditionals, so the band axis cannot be pivoted into columns
 * (`sum(if(tranche_horaire=8,…))` is HTTP 400 `ODSQLSyntaxError`) — and
 * `offset + limit <= 20000` is a hard cap under `group_by`. Measured on the
 * 4 km Châtelet box: **3 303 162 bytes in 2.42 s** upstream, folding to
 * **540 404 bytes raw / 87 143 gzipped** for 805 stops. Every open tab doing
 * that itself would move 3.3 MB to publish 87 KB.
 *
 * The regional product is EIGHTEEN calls: one grouped aggregate over all
 * 1 311 578 rows (**356 rows, 73 723 bytes, 0.62 s**) and seventeen stop
 * enumerations for the divisor (**36 502 stops, 3 582 652 bytes, 3.67 s**). It
 * folds to **14 719 bytes raw / 5 864 gzipped** in 54 ms. A 244-to-1 reduction
 * is exactly what a proxy is for.
 *
 * WHY THE DIVISOR IS ENUMERATED AND NOT COUNTED: Opendatasoft's
 * `count(distinct id_arret)` is an estimator. It answers **3 452** for
 * département 75 where enumerating returns **3 506**, and 37 078 region-wide
 * against 36 502. A 1.5 % error in the divisor is a 1.5 % error in every colour
 * on the choropleth, so the lists are walked.
 *
 * WHY A DENSE BOX IS REFUSED AFTER ONE CALL: the identity query asks for
 * `IDFM_FREQ_MAX_STOPS + 1` rows precisely so a full page is the signal that
 * the box is too dense. Measured at Châtelet, the densest part of the network,
 * on square boxes by side length: 1.2 km 87 stops, 2 km 204, 3 km 436, 4 km
 * 802, 5 km 1 133 (1 139 rows), and from 5.5 km up the page comes back at
 * exactly 1 201 rows however wide the box gets. Saturated, this answers 200
 * with `tooDense` and the count it can honestly claim rather than buying four
 * heavy pages for a stop list the API already truncated.
 *
 * WHY ONE FAILED PROFILE PAGE IS NOT A FAILED BUILD: losing one of the four
 * windows is a hole in the DAY, not a hole in the map. The build reports
 * `windows: {asked, answered}` and the layer names the hole on the row and on
 * the card, because an unnamed hole reads as "no service between 16:00 and
 * 21:00". Losing the identity call IS fatal: there is nothing left to place.
 *
 * WHY THE EDITION IS DISCOVERED AND FLOORED: the dataset id is stable, so the
 * edition is the portal's own `data_processed` timestamp. It is read at build
 * time and floored at `IDFM_FREQ_EDITION_FLOOR` — the edition this layer was
 * measured against — because a discovery OLDER than the floor is a malformed
 * answer, not a new fact, and the card prints it as provenance.
 */
const IDFM_FREQ_STOPS_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Serve-stale ceiling. The file is a yearly average of a term-time week that
 * the publisher reprocesses a few times a year (`data_processed`
 * 2026-08-18T15:54:55+00:00 against `modified` 2026-03-31T13:43:29+00:00), so a
 * month-old fold is still a true picture of the same week.
 */
const IDFM_FREQ_STALE_MS = 30 * 24 * 60 * 60 * 1000;
/** The régional product is rebuilt weekly; its inputs change even less often. */
const IDFM_FREQ_REGION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Slowest measured build is the régional one at 4.8 s; 60 s is 12× headroom. */
const IDFM_FREQ_TIMEOUT_MS = 60_000;
/**
 * Per-response byte cap. The largest single upstream response measured is
 * 906 342 B (one profile window on a 4 km box); an 8 km box pushes one page to
 * roughly 3 MB. 24 MB refuses a runaway without ever refusing a real answer.
 */
const IDFM_FREQ_MAX_BYTES = 24 * 1024 * 1024;
/**
 * Viewport packs held in memory. Twelve × ~540 KB at the 4 km worst case is
 * about 6.5 MB, and twelve snapped boxes is more panning than one session does.
 */
const IDFM_FREQ_BOX_CACHE = 12;
const IDFM_FREQ_DISK_DIR = path.join(process.cwd(), '.gev-cache', 'idfm-frequency');
const IDFM_FREQ_REGION_CACHE_PATH = path.join(IDFM_FREQ_DISK_DIR, 'region.json');
/**
 * Shape version of everything cached under `.gev-cache/idfm-frequency/`. BUMP
 * IT whenever `projectFrequencyStops` or `foldFrequencyRegion` changes what it
 * returns: the régional document lives for a WEEK on disk and a viewport pack
 * for a DAY, so without a bump a projection edit is invisible until the cache
 * expires on its own.
 */
const IDFM_FREQ_CACHE_VERSION = 1;

/** @type {Map<string, {version:number, at:number, payload:object}>} LRU by insertion. */
const _idfmFreqBoxes = new Map();
/** @type {Map<string, Promise<object>>} */
const _idfmFreqInFlight = new Map();
/** @type {?{version:number, at:number, payload:object}} */
const _idfmFreqRegionState = { entry: null };
/** @type {?Promise<object>} */
let _idfmFreqRegionInFlight = null;
let _idfmFreqRegionDiskChecked = false;
/**
 * 30 requests a minute per client. A MISS costs five upstream calls, so the
 * worst case is 150 upstream requests a minute against a published daily quota
 * of 1 000 000 — and every HIT costs zero.
 */
const _idfmFreqRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 30, globalMax: 90 });

/** GET one Opendatasoft URL as JSON, under a timeout and a byte cap. */
async function fetchIdfmFreqJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(IDFM_FREQ_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
  return readResponseJsonCapped(response, IDFM_FREQ_MAX_BYTES);
}

/**
 * The portal's own edition stamp, floored.
 *
 * A failed discovery is not a failed build: it falls back to the floor, which
 * is the edition this layer was measured against and is guaranteed to exist.
 */
async function discoverIdfmFreqEdition() {
  try {
    const body = await fetchIdfmFreqJson(buildMetadataUrl({}));
    return newestEdition(body);
  } catch (error) {
    console.warn('[IDFM Fréquence Proxy] edition discovery failed:', error?.message || error);
    return newestEdition(null);
  }
}

/**
 * Build one viewport: the identity call, then four profile pages.
 *
 * The identity call goes FIRST and ALONE for two reasons measured on the 4 km
 * Châtelet box: it is the exact stop count, so a box over the whole of Paris is
 * refused after one cheap call instead of after five expensive ones; and taking
 * the seven identity columns out of the profile `group_by` is what makes the
 * profile rows small — carrying identity inside the band grouping cost
 * 6 313 751 bytes in 2.66 s against 3 291 332 in 1.84 s for the same answer.
 */
async function refreshIdfmFreqBox(box) {
  const started = Date.now();
  const [edition, identity] = await Promise.all([
    discoverIdfmFreqEdition(),
    fetchIdfmFreqJson(buildIdentityUrl({ box })),
  ]);

  const identityRows = Array.isArray(identity?.results) ? identity.results : [];
  const stopsInBox = new Set(identityRows.map((row) => String(row?.id_arret ?? ''))).size;
  // A FULL PAGE is the refusal signal, not the distinct count, and the
  // difference is not pedantry. `buildIdentityUrl` asks for MAX + 1 rows, so a
  // box holding 1 300 stops and a box holding 30 000 both come back as exactly
  // 1 201 rows, and the DISTINCT count of a saturated page is always under the
  // ceiling — 1 194 to 1 198 in every saturated box measured. Testing the
  // distinct count would therefore never refuse anything and would buy four
  // heavy pages for a stop list the API already truncated. Measured at
  // Châtelet on square boxes: 4 km → 802 rows, 5 km → 1 139, and every box
  // from 5.5 km up → exactly 1 201.
  if (identityRows.length > IDFM_FREQ_MAX_STOPS) {
    // Refused, with the number it can honestly claim, before the four heavy
    // pages are bought.
    return {
      stops: [],
      count: 0,
      stopsInBox,
      stopsAtLeast: true,
      refused: stopsInBox,
      tooDense: true,
      maxStops: IDFM_FREQ_MAX_STOPS,
      windows: { asked: IDFM_FREQ_BAND_WINDOWS.length, answered: 0 },
      box: { ...box },
      dataset: IDFM_FREQ_DATASET,
      edition: edition.edition,
      editionDiscovered: edition.discovered,
      licence: edition.licence,
      source: IDFM_FREQ_SOURCE,
      builtInMs: Date.now() - started,
    };
  }

  const profiles = await Promise.all(IDFM_FREQ_BAND_WINDOWS.map(([bandLo, bandHi]) => (
    fetchIdfmFreqJson(buildProfileUrl({ box, bandLo, bandHi })).catch((error) => {
      // A hole in the DAY, not a hole in the map. The fold survives it and
      // `windows` is what lets the layer say so out loud.
      console.warn(`[IDFM Fréquence Proxy] band window ${bandLo}-${bandHi} unavailable:`, error?.message || error);
      return null;
    })
  )));
  const answered = profiles.filter(Boolean);

  const projected = projectFrequencyStops({
    identity,
    profiles: answered,
    box,
    maxStops: IDFM_FREQ_MAX_STOPS,
    edition: edition.edition,
    source: IDFM_FREQ_SOURCE,
  });
  return {
    ...projected,
    tooDense: false,
    stopsAtLeast: false,
    maxStops: IDFM_FREQ_MAX_STOPS,
    windows: { asked: IDFM_FREQ_BAND_WINDOWS.length, answered: answered.length },
    editionDiscovered: edition.discovered,
    licence: edition.licence,
    builtInMs: Date.now() - started,
  };
}

/**
 * Build the whole région: one aggregate, seventeen enumerations, one fold.
 *
 * A bucket whose enumeration fails is NOT fatal and is deliberately not treated
 * as such: `foldFrequencyRegion` gives it `stops: null`, which produces no rate
 * and no fill, rather than a divisor of zero that would paint it as the busiest
 * place in France. Losing the aggregate itself is fatal — there is nothing left
 * to divide.
 */
async function refreshIdfmFreqRegion() {
  const started = Date.now();
  const [edition, index, bands, ...enumerations] = await Promise.all([
    discoverIdfmFreqEdition(),
    // THE shared loader. The proxy reads the same 96 polygons the browser
    // layer fetches, memoized once for the whole process.
    loadSchoolsDepartementIndex(),
    fetchIdfmFreqJson(buildRegionBandsUrl({})),
    ...IDFM_FREQ_BUCKETS.map((code) => (
      fetchIdfmFreqJson(buildRegionStopsUrl({ code })).catch((error) => {
        console.warn(`[IDFM Fréquence Proxy] stop census ${code ?? 'null'} unavailable:`, error?.message || error);
        return null;
      })
    )),
  ]);

  const stops = IDFM_FREQ_BUCKETS
    .map((code, i) => ({ code, envelope: enumerations[i] }))
    .filter((bucket) => bucket.envelope);

  const folded = foldFrequencyRegion({
    bands,
    stops,
    index,
    edition: edition.edition,
    licence: edition.licence,
    source: IDFM_FREQ_SOURCE,
  });
  if (stops.length < IDFM_FREQ_BUCKETS.length) {
    console.warn(`[IDFM Fréquence Proxy] stop census short: ${stops.length}/${IDFM_FREQ_BUCKETS.length} buckets`);
  }
  return {
    ...folded,
    editionDiscovered: edition.discovered,
    census: { asked: IDFM_FREQ_BUCKETS.length, answered: stops.length },
    builtInMs: Date.now() - started,
  };
}

function idfmFreqBoxDiskPath(key) {
  return path.join(IDFM_FREQ_DISK_DIR, `box-${createHash('sha1').update(key).digest('hex')}.json`);
}

/** Read one cached viewport pack. Any shape mismatch is a miss, never a crash. */
async function readIdfmFreqBoxDisk(key) {
  try {
    const entry = JSON.parse(await fsp.readFile(idfmFreqBoxDiskPath(key), 'utf8'));
    if (entry?.version === IDFM_FREQ_CACHE_VERSION
      && Number.isFinite(entry.at)
      && Array.isArray(entry.payload?.stops)) {
      return entry;
    }
  } catch { /* no disk cache yet */ }
  return null;
}

function writeIdfmFreqBoxDisk(key, entry) {
  fsp.mkdir(IDFM_FREQ_DISK_DIR, { recursive: true })
    .then(() => fsp.writeFile(idfmFreqBoxDiskPath(key), JSON.stringify(entry)))
    .catch((err) => console.warn('[IDFM Fréquence Proxy] box cache write failed:', err?.message || err));
}

async function readIdfmFreqRegionDisk() {
  if (_idfmFreqRegionDiskChecked) return;
  _idfmFreqRegionDiskChecked = true;
  try {
    const entry = JSON.parse(await fsp.readFile(IDFM_FREQ_REGION_CACHE_PATH, 'utf8'));
    if (entry?.version === IDFM_FREQ_CACHE_VERSION
      && Number.isFinite(entry.at)
      && Array.isArray(entry.payload?.departements)) {
      _idfmFreqRegionState.entry = entry;
    }
  } catch { /* no disk cache yet */ }
}

function writeIdfmFreqRegionDisk(entry) {
  fsp.mkdir(IDFM_FREQ_DISK_DIR, { recursive: true })
    .then(() => fsp.writeFile(IDFM_FREQ_REGION_CACHE_PATH, JSON.stringify(entry)))
    .catch((err) => console.warn('[IDFM Fréquence Proxy] region cache write failed:', err?.message || err));
}

/** Keep the newest `IDFM_FREQ_BOX_CACHE` packs; Map preserves insertion order. */
function rememberIdfmFreqBox(key, entry) {
  _idfmFreqBoxes.delete(key);
  _idfmFreqBoxes.set(key, entry);
  while (_idfmFreqBoxes.size > IDFM_FREQ_BOX_CACHE) {
    const oldest = _idfmFreqBoxes.keys().next().value;
    if (oldest === undefined) break;
    _idfmFreqBoxes.delete(oldest);
  }
}

/**
 * One build per box, however many tabs ask at once.
 *
 * `coalesceProxyRequest` returns `{promise, shared}` and NOT a promise — the
 * `.promise` unwrap is the whole point of reusing it, and forgetting it awaits
 * an object that resolves instantly to itself.
 */
function ensureIdfmFreqBox(key, box) {
  const { promise } = coalesceProxyRequest(_idfmFreqInFlight, key, async () => {
    const payload = await refreshIdfmFreqBox(box);
    const entry = { version: IDFM_FREQ_CACHE_VERSION, at: Date.now(), payload };
    rememberIdfmFreqBox(key, entry);
    writeIdfmFreqBoxDisk(key, entry);
    return entry;
  });
  return promise;
}

/** Shared régional build, so a cold start with several tabs sweeps once. */
function ensureIdfmFreqRegion() {
  if (!_idfmFreqRegionInFlight) {
    _idfmFreqRegionInFlight = refreshIdfmFreqRegion()
      .then((payload) => {
        const entry = { version: IDFM_FREQ_CACHE_VERSION, at: Date.now(), payload };
        _idfmFreqRegionState.entry = entry;
        writeIdfmFreqRegionDisk(entry);
        return entry;
      })
      .finally(() => { _idfmFreqRegionInFlight = null; });
  }
  return _idfmFreqRegionInFlight;
}

/**
 * Vite plugin: Île-de-France service-frequency proxy.
 * @returns {import('vite').Plugin}
 */
function idfmFrequencyProxy() {
  function install(middlewares) {
    middlewares.use('/api/idfm-frequency', async (req, res) => {
      const json = (status, body, headers = {}) => {
        if (res.headersSent) return;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'GET') {
        json(405, { error: 'Method Not Allowed' });
        return;
      }
      if (!_idfmFreqRateLimiter(clientKey(req))) {
        json(429, { error: 'Rate limit exceeded' }, { 'Retry-After': '5' });
        return;
      }

      const url = new URL(req.url || '/', 'http://localhost');
      const route = url.pathname.replace(/\/+$/, '') || '/';

      if (route === '/status') {
        await readIdfmFreqRegionDisk();
        const region = _idfmFreqRegionState.entry;
        json(200, {
          source: IDFM_FREQ_SOURCE,
          portal: IDFM_FREQ_PORTAL,
          dataset: IDFM_FREQ_DATASET,
          editionFloor: IDFM_FREQ_EDITION_FLOOR,
          maxStops: IDFM_FREQ_MAX_STOPS,
          maxBoxDeg: IDFM_FREQ_MAX_BOX_DEG,
          boxStepDeg: IDFM_FREQ_BOX_STEP_DEG,
          stopsTtlMs: IDFM_FREQ_STOPS_TTL_MS,
          regionTtlMs: IDFM_FREQ_REGION_TTL_MS,
          boxesCached: _idfmFreqBoxes.size,
          region: region
            ? {
              at: region.at,
              edition: region.payload.edition,
              editionDiscovered: region.payload.editionDiscovered,
              painted: region.payload.paintedCodes?.length ?? null,
              fringe: region.payload.fringeCodes?.length ?? null,
              stops: region.payload.totals?.stops ?? null,
              placed: region.payload.totals?.placed ?? null,
              unplaced: region.payload.totals?.unplaced ?? null,
              crosscheck: region.payload.crosscheck ?? null,
              census: region.payload.census ?? null,
            }
            : null,
        }, { 'Cache-Control': 'public, max-age=60' });
        return;
      }

      if (route === '/region') {
        await readIdfmFreqRegionDisk();
        const now = Date.now();
        const cached = _idfmFreqRegionState.entry;
        if (cached && now - cached.at <= IDFM_FREQ_REGION_TTL_MS) {
          json(200, { ...cached.payload, fetchedAt: cached.at, stale: false }, { 'X-IDFM-FREQUENCY': 'HIT' });
          return;
        }
        try {
          const entry = await ensureIdfmFreqRegion();
          json(200, { ...entry.payload, fetchedAt: entry.at, stale: false }, { 'X-IDFM-FREQUENCY': 'MISS' });
        } catch (error) {
          console.warn('[IDFM Fréquence Proxy] region build unavailable:', error?.message || error);
          if (cached && now - cached.at <= IDFM_FREQ_STALE_MS) {
            json(200, { ...cached.payload, fetchedAt: cached.at, stale: true }, { 'X-IDFM-FREQUENCY': 'STALE' });
            return;
          }
          json(503, { error: 'L’offre régionale Île-de-France Mobilités est momentanément indisponible' });
        }
        return;
      }

      if (route !== '/stops') {
        json(404, { error: 'Unknown IDFM frequency endpoint' });
        return;
      }

      // A MISSING parameter must not become a coordinate. `searchParams.get`
      // answers `null` for an absent key and `Number(null)` is 0, which is a
      // perfectly valid latitude off the coast of Ghana — so the parse refuses
      // an absent or blank value outright and lets NaN reach `validBox`.
      const coord = (name) => {
        const raw = url.searchParams.get(name);
        return raw === null || raw.trim() === '' ? NaN : Number(raw);
      };
      // Snapped OUTWARD onto the same 0.005° grid the browser layer snaps to,
      // so a pan of a few streets reuses one cache entry and a cached answer
      // always covers at least what was asked for.
      const box = validBox(snapBoxOutward({
        south: coord('south'),
        west: coord('west'),
        north: coord('north'),
        east: coord('east'),
      }, IDFM_FREQ_BOX_STEP_DEG), IDFM_FREQ_MAX_BOX_DEG);
      if (!box) {
        json(400, {
          error: `A bounding box is required, no wider than ${IDFM_FREQ_MAX_BOX_DEG}° on either axis`,
        });
        return;
      }

      const key = boxKey(box, 4);
      const now = Date.now();
      const cached = _idfmFreqBoxes.get(key) || await readIdfmFreqBoxDisk(key);
      if (cached && now - cached.at <= IDFM_FREQ_STOPS_TTL_MS) {
        rememberIdfmFreqBox(key, cached);
        json(200, { ...cached.payload, fetchedAt: cached.at, stale: false }, { 'X-IDFM-FREQUENCY': 'HIT' });
        return;
      }
      try {
        const entry = await ensureIdfmFreqBox(key, box);
        json(200, { ...entry.payload, fetchedAt: entry.at, stale: false }, { 'X-IDFM-FREQUENCY': 'MISS' });
      } catch (error) {
        console.warn('[IDFM Fréquence Proxy] viewport build unavailable:', error?.message || error);
        // A month-old fold of a yearly average is still a true picture of the
        // same week — serving it beats blanking the map.
        if (cached && now - cached.at <= IDFM_FREQ_STALE_MS) {
          json(200, { ...cached.payload, fetchedAt: cached.at, stale: true }, { 'X-IDFM-FREQUENCY': 'STALE' });
          return;
        }
        json(503, { error: 'L’offre horaire Île-de-France Mobilités est momentanément indisponible' });
      }
    });
  }

  return {
    name: 'idfm-frequency-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

// ---------------------------------------------------------------------------
// Aircraft-noise plans (PEB / PGS) proxy — keyless DGAC via the Géoplateforme
// ---------------------------------------------------------------------------
/**
 * `GET /api/bruit-fr?lat=&lon=`  — the two plans under one point, plus the
 *                                  nearest aerodrome that has one.
 * `GET /api/bruit-fr/index`      — the national arrêté register, 224 points.
 * `GET /api/bruit-fr/status`     — provenance and cache state.
 *
 * WHY A PROXY AT ALL, when `data.geopf.fr` answers `access-control-allow-origin:
 * *` and needs no key. Three measurements, all taken on 2026-09-02.
 *
 *  1. **THE SERVICE RATE-LIMITS, AND IT DOES IT IN HTML.** Sweeping a 240-point
 *     grid over Île-de-France at three concurrent requests, 190 of 240 came back
 *     **HTTP 429 with `content-type: text/html` and a 134-byte nginx page**
 *     (`<html>\r\n<head><title>429 Too Many Requests</title>…`). In the browser
 *     that is `response.json()` throwing `Unexpected token '<'`, from a layer
 *     that is doing nothing more aggressive than following a camera. The same
 *     sweep with one retry per point and a 1.5 s back-off completed 240 of 240.
 *     A per-address cache in front of it is what turns a pan back over the same
 *     block into zero upstream calls.
 *  2. **ONE SCAN IS THREE FACTS FROM TWO PROTOCOLS.** The PEB polygons and the
 *     PGS polygons are two WMS GetFeatureInfo calls on two different layers, and
 *     "the nearest aerodrome that HAS a plan" comes from a WFS index that is a
 *     different service entirely. Fanned out here, that is one round trip for
 *     the browser instead of three, and the register is fetched once per week
 *     rather than once per tab.
 *  3. **THE REGISTER IS A DISK ARTEFACT.** 66,355 bytes, `numberMatched` 224,
 *     and the arrêtés it lists move on the order of a handful a year — 8 in the
 *     whole of the 2020s, 3 in 2022. Re-downloading it per process start is
 *     waste; it belongs on disk with a version stamp.
 *
 * WHAT IS DELIBERATELY NOT HERE. No CBS (carte de bruit stratégique): the EU
 * directive's isophones are not on the Géoplateforme at all — grepping the
 * wms-v, wms-r and wfs capabilities for bruit/noise/classement returns these
 * four DGAC aviation layers and nothing else — and the real thing is ~76
 * per-DDT Géo-IDE ATOM shapefile zips with no CORS header, EPSG:2154,
 * ISO-8859-1, four distinct HTTP-200 failure modes on the live OGC services and
 * one département (Tarn) shipping MapInfo TAB with no shapefile inside. That is
 * a server-side harvest of several hundred archives and it is out of scope for
 * this route. No Bruitparif either: `raster.bruitparif.fr` is technically
 * perfect and its mentions légales forbid exactly this ("l'utilisation d'un
 * système ou d'un logiciel automatique pour extraire des données de ce site web
 * … est interdit"), so it needs a written convention, not a client.
 */
const BRUIT_WMS_HOST = 'data.geopf.fr';
/** The scan answer is cheap to rebuild and the plans move once a decade. */
const BRUIT_SCAN_TTL_MS = 6 * 60 * 60 * 1000;
/** The national arrêté register, on disk. */
const BRUIT_INDEX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * How stale a register may get before it stops being served at all.
 *
 * 90 days. The register gained 8 arrêtés in six years, so a three-month-old
 * copy is materially the same document — and the alternative to serving it is
 * dropping the one sentence that makes an empty probe honest ("the nearest
 * aerodrome that has a plan is 12.4 km away").
 */
const BRUIT_INDEX_STALE_MS = 90 * 24 * 60 * 60 * 1000;
const BRUIT_TIMEOUT_MS = 20_000;
/**
 * Byte cap.
 *
 * Measured: the heaviest single probe in the whole 224-airport sweep is 15,041
 * bytes (Le Bourget, where Roissy's 664-vertex zone D overlaps) and the national
 * register is 66,355. 2 MB is two orders of magnitude of headroom, which means
 * anything past it is a changed upstream and not a big answer.
 */
const BRUIT_MAX_BYTES = 2 * 1024 * 1024;
/**
 * Retries on the HTML 429, and the back-off between them.
 *
 * Measured: at three concurrent probes the service starts refusing after a few
 * hundred requests and recovers within a couple of seconds. Two extra attempts
 * at 1.5 s and 3 s cleared 240 of 240 points; a third would only lengthen a
 * scan the camera has already moved away from.
 */
const BRUIT_RETRY_ATTEMPTS = 3;
const BRUIT_RETRY_BASE_MS = 1500;
const BRUIT_DISK_DIR = path.join(process.cwd(), '.gev-cache', 'bruit-fr');
const BRUIT_CACHE_PATH = path.join(BRUIT_DISK_DIR, 'arretes.json');
/**
 * BUMP THIS whenever `projectPebArretes` changes the shape it returns. The disk
 * cache outlives the edit otherwise, and a 90-day stale window is a long time
 * to serve a projection nothing reads any more.
 */
const BRUIT_CACHE_VERSION = 1;

/** @type {?{version: number, at: number, payload: object}} */
let _bruitIndex = null;
let _bruitIndexInFlight = null;
let _bruitDiskChecked = false;
const _bruitInFlight = new Map();
/**
 * Its own limiter, not the shared address one.
 *
 * The four address layers answer about a building and are hit once per camera
 * settle; this one is hit twice (PEB and PGS) and its upstream is the single
 * host that has been measured refusing. 40 a minute per client is roughly one
 * scan every three seconds, which is faster than a human can settle a camera,
 * and 150 globally keeps one tab from spending the whole allowance.
 */
const _bruitRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 40, globalMax: 150 });

/**
 * One Géoplateforme JSON read, with the two failure modes this host actually
 * has.
 *
 * `fetchAddressSource` is not used here for one reason: it swallows the status
 * code, and a 429 from this host must be RETRIED while a 400 must not. It also
 * calls `JSON.parse` on whatever came back, and what comes back from an
 * overloaded `data.geopf.fr` is a 134-byte HTML page — the content-type check
 * below is what turns that into a retry rather than a `SyntaxError` in a log.
 *
 * @param {string} url
 * @returns {Promise<object|null>} null when the upstream did not answer usefully.
 */
async function fetchBruitJson(url) {
  for (let attempt = 1; attempt <= BRUIT_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(BRUIT_TIMEOUT_MS),
      });
      if (response.status === 429 || response.status >= 500) {
        // "Not now", not "not this". Back off and come back.
        if (attempt < BRUIT_RETRY_ATTEMPTS) {
          await new Promise((resolve) => { setTimeout(resolve, BRUIT_RETRY_BASE_MS * attempt); });
          continue;
        }
        console.warn(`[Bruit Proxy] ${response.status} from ${BRUIT_WMS_HOST} after ${attempt} attempts`);
        return null;
      }
      if (!response.ok) {
        console.warn(`[Bruit Proxy] ${response.status} from ${BRUIT_WMS_HOST}`);
        return null;
      }
      // The rate limiter's page is HTML with an HTTP 200 in some paths and a
      // 429 in others; either way it is not JSON, and parsing it is how a
      // throttle turns into a stack trace.
      const contentType = String(response.headers.get('content-type') || '');
      if (!/json/i.test(contentType)) {
        console.warn(`[Bruit Proxy] non-JSON ${contentType || 'body'} from ${BRUIT_WMS_HOST}`);
        if (attempt < BRUIT_RETRY_ATTEMPTS) {
          await new Promise((resolve) => { setTimeout(resolve, BRUIT_RETRY_BASE_MS * attempt); });
          continue;
        }
        return null;
      }
      return await readResponseJsonCapped(response, BRUIT_MAX_BYTES);
    } catch (error) {
      const cause = error?.cause?.code || error?.cause?.message || null;
      console.warn(`[Bruit Proxy] ${BRUIT_WMS_HOST}: ${error?.message || error}${cause ? ` (${cause})` : ''}`);
      // A parse failure is not worth a second go; a socket reset is.
      if (error instanceof SyntaxError || attempt === BRUIT_RETRY_ATTEMPTS) return null;
      await new Promise((resolve) => { setTimeout(resolve, BRUIT_RETRY_BASE_MS * attempt); });
    }
  }
  return null;
}

/** Read the register off disk once per process, and only if it is well formed. */
async function readBruitDisk() {
  if (_bruitDiskChecked) return;
  _bruitDiskChecked = true;
  try {
    const entry = JSON.parse(await fsp.readFile(BRUIT_CACHE_PATH, 'utf8'));
    if (entry?.version === BRUIT_CACHE_VERSION
      && Number.isFinite(entry.at)
      && Array.isArray(entry.payload?.airports)
      && entry.payload.airports.length > 0) {
      _bruitIndex = entry;
    }
  } catch { /* no disk cache yet */ }
}

function writeBruitDisk(entry) {
  fsp.mkdir(BRUIT_DISK_DIR, { recursive: true })
    .then(() => fsp.writeFile(BRUIT_CACHE_PATH, JSON.stringify(entry)))
    .catch((err) => console.warn('[Bruit Proxy] cache write failed:', err?.message || err));
}

/**
 * The national arrêté register, from memory, then disk, then the WFS.
 *
 * A refusal NEVER clears what is already held. The register is the only thing
 * that can tell an empty probe ("no plan covers this ground") apart from a
 * broken one, and losing it to a five-minute outage would make every scan in
 * France answer "aucun plan" with nothing to qualify it.
 *
 * @returns {Promise<?{version: number, at: number, payload: object}>}
 */
async function ensureBruitIndex() {
  await readBruitDisk();
  if (_bruitIndex && Date.now() - _bruitIndex.at < BRUIT_INDEX_TTL_MS) return _bruitIndex;
  if (!_bruitIndexInFlight) {
    _bruitIndexInFlight = (async () => {
      const raw = await fetchBruitJson(buildPebArreteIndexUrl());
      if (!raw) return _bruitIndex;
      const payload = projectPebArretes(raw);
      if (!payload.airports.length) {
        console.warn('[Bruit Proxy] arrêté index came back empty; keeping the previous copy');
        return _bruitIndex;
      }
      if (payload.short) {
        // Kept and USED, but the flag rides all the way to the card: a short
        // register still answers "the nearest aerodrome", just not reliably.
        console.warn(`[Bruit Proxy] arrêté index short: ${payload.airports.length} rows against a floor of ${BRUIT_ARRETE_FLOOR}`);
      }
      const entry = { version: BRUIT_CACHE_VERSION, at: Date.now(), payload };
      _bruitIndex = entry;
      writeBruitDisk(entry);
      return entry;
    })().finally(() => { _bruitIndexInFlight = null; });
  }
  return _bruitIndexInFlight;
}

/**
 * Build one scan: both plans, plus what the register says about the emptiness.
 *
 * The two probes are fanned out with `Promise.all` and each carries its own
 * `catch` inside `fetchBruitJson`, so a PGS outage degrades ONE field and the
 * PEB answer still lands. `available` is what the layer reads to tell "no zone
 * here" from "no answer here" — the two look identical downstream, and getting
 * that wrong turns an outage into a clean bill of health.
 *
 * @param {{lat: number, lon: number}} point
 * @returns {Promise<object|null>}
 */
async function buildBruitScan(point) {
  const [peb, pgs, index] = await Promise.all([
    fetchBruitJson(buildBruitProbeUrl('peb', point)),
    fetchBruitJson(buildBruitProbeUrl('pgs', point)),
    ensureBruitIndex().catch((err) => {
      console.warn('[Bruit Proxy] arrêté index:', err?.message || err);
      return null;
    }),
  ]);
  // Both halves down is not an answer at all. One down is a degraded answer and
  // the card says which half.
  if (!peb && !pgs) return null;
  const register = index?.payload ?? null;
  const nearest = register
    ? nearestArrete(register.airports, point.lat, point.lon, BRUIT_NEAREST_MAX_KM)
    : null;
  return {
    ...projectBruit({ peb, pgs, point, nearest }),
    source: BRUIT_SOURCE,
    register: register
      ? {
        count: register.count,
        total: register.total,
        short: register.short,
        truncated: register.truncated,
        psophique: register.psophique,
        lden: register.lden,
        oldest: register.oldest,
        newest: register.newest,
        // The register's own age, so a 90-day-old copy can say so rather than
        // passing as today's.
        fetchedAt: index?.at ?? null,
      }
      : null,
    // `null` and `false` are different states and the layer prints them
    // differently: no register at all, against a register that answered.
    nearestReach: register ? BRUIT_NEAREST_MAX_KM : null,
  };
}

/**
 * Vite plugin: French aircraft-noise plans proxy.
 * @returns {import('vite').Plugin}
 */
function bruitFranceProxy() {
  function install(middlewares) {
    // MOUNTED FIRST, and the order is load-bearing: connect matches by prefix,
    // so `/api/bruit-fr` installed ahead of this would swallow
    // `/api/bruit-fr/index` and try to read a lat/lon off it.
    middlewares.use('/api/bruit-fr/index', async (req, res) => {
      const json = (status, body, headers = {}) => {
        if (res.headersSent) return;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'GET') { json(405, { error: 'Method Not Allowed' }); return; }
      if (!_bruitRateLimiter(clientKey(req))) {
        json(429, { error: 'Rate limit exceeded' }, { 'Retry-After': '5' });
        return;
      }
      try {
        // `coalesceProxyRequest` returns `{ promise, shared }` and NOT a
        // promise — awaiting the object itself resolves to the object.
        const { promise } = coalesceProxyRequest(_bruitInFlight, 'index', ensureBruitIndex);
        const entry = await promise;
        if (!entry) {
          json(503, {
            error: 'Le registre des arrêtés PEB (Géoplateforme WFS) n’a pas répondu et aucune copie locale n’existe.',
          });
          return;
        }
        const age = Date.now() - entry.at;
        if (age > BRUIT_INDEX_STALE_MS) {
          json(503, {
            error: `La copie locale du registre des arrêtés PEB a ${Math.round(age / 86_400_000)} jours et l’amont ne répond pas.`,
          });
          return;
        }
        json(200, {
          ...entry.payload,
          source: BRUIT_SOURCE,
          fetchedAt: entry.at,
          stale: age > BRUIT_INDEX_TTL_MS,
        }, {
          'X-BRUIT-FR': age > BRUIT_INDEX_TTL_MS ? 'STALE' : 'HIT',
          'Cache-Control': 'public, max-age=3600',
        });
      } catch (error) {
        console.error('[Bruit Proxy] /index', error?.message || error);
        json(502, { error: 'bruit-fr index proxy error' });
      }
    });

    // The scan itself, on the shared address-route machinery: the per-point
    // memory cache, the serve-stale-on-failure branch, the `/status` route and
    // the `{ fetchedAt, stale }` envelope are the same ones the four sibling
    // address layers already answer with, and a second copy of them here would
    // be a second place for the same bug.
    installAddressRoute(middlewares, '/api/bruit-fr', (url) => {
      const point = addressPoint(url.searchParams);
      if (!point) return null;
      return {
        // Four decimals, ~11 m: two nudges of the same camera share one entry.
        // The probe geometry is PINNED, so nothing else varies the answer and
        // nothing else belongs in the key.
        key: addressCacheKey('bruit-fr', point),
        load: () => buildBruitScan(point),
      };
    }, { ttlMs: BRUIT_SCAN_TTL_MS });
  }
  return {
    name: 'bruit-fr-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

/**
 * ODRÉ French gas-system proxy — keyless, Licence Ouverte 2.0.
 *
 * Four datasets on the same Opendatasoft instance as éCO2mix, fetched through
 * the `exports/json` endpoint (the whole file, not a paged query) because all
 * four are small national inventories that only change a few times a year:
 *
 *   `trace-du-reseau-grt-250`   NaTran (ex-GRTgaz) trace   11 615 rows, 4.93 MB
 *   `terega-trace-du-reseau`    Teréga trace                1 298 rows, 0.55 MB
 *   `prod-elec-gaz-naturel-fr`  gas-fired power stations       98 rows, 29 KB
 *   `points-dinjection-de-biomethane-en-france`
 *                               methane injection points      854 rows, 684 KB
 *
 * MEASURED 2026-08-27, cold: 200 in 1.35 s / 0.34 s / 0.23 s / 0.31 s.
 *
 * WHY A PROXY, when Opendatasoft sends CORS headers and a direct browser fetch
 * works: the raw four are 6.2 MB and the globe needs 1.26 MB of it, the
 * anonymous ODRÉ quota is per-IP so every open tab would bill its own copy of
 * that, and the projection that makes those two numbers differ — dropping
 * Teréga's meaningless third ordinate, chaining published segments that share
 * an endpoint, and collapsing seven annual editions of the same 14 power
 * stations down to one — is exactly the work that should happen once, on a
 * server, under test (`src/data/gasFranceFeed.js`).
 *
 * The split is along the real seam, the same one the Vigicrues proxy uses: a
 * ~930 KB geometry document that is fetched ONCE per session and a ~330 KB
 * register document that is polled. The traces are republished about once a
 * year, so their cache TTL is a week; the registers move monthly, so theirs is
 * twelve hours.
 *
 * Routes:
 *   GET /api/gas-fr/network → {fetchedAt, stale, ttlMs, source, operators, groups, strokes, stats}
 *   GET /api/gas-fr/sites   → {fetchedAt, stale, ttlMs, source, plants, injections, stats}
 *   GET /api/gas-fr/status  → {source, lastFetch, stale, ttlMs, strokes, plants, injections}
 *
 * @returns {import('vite').Plugin}
 */
function gasFranceProxy() {
  const BASE = 'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets';
  const exportUrl = (dataset) => `${BASE}/${dataset}/exports/json?limit=-1`;
  // The traces carry a "MAJ 2024" / "MAJ 2023" year in their own titles; a week
  // is already far more often than they change.
  const NETWORK_TTL_MS = 7 * 24 * 3600_000;
  // The injection register gains sites monthly and the power-station file gains
  // one edition a year.
  const SITES_TTL_MS = 12 * 3600_000;
  const CACHE_DIR = path.join(process.cwd(), '.gev-cache', 'gas-fr');
  const NETWORK_CACHE_PATH = path.join(CACHE_DIR, 'network.json');
  const SITES_CACHE_PATH = path.join(CACHE_DIR, 'sites.json');
  const SOURCE = 'ODRÉ (odre.opendatasoft.com)';
  // 4.93 MB over an anonymous connection: generous, and still bounded.
  const UPSTREAM_TIMEOUT_MS = 60_000;

  /** @type {{network: ?object, sites: ?object}} */
  const mem = { network: null, sites: null };
  const diskChecked = { network: false, sites: false };
  /** @type {{network: ?Promise<?object>, sites: ?Promise<?object>}} */
  const inflight = { network: null, sites: null };

  async function fetchRows(dataset) {
    const response = await fetch(exportUrl(dataset), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`${dataset} HTTP ${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : payload?.results;
    if (!Array.isArray(rows)) throw new Error(`${dataset} returned no rows`);
    return rows;
  }

  /**
   * Refresh the two traces. Settled, not all-or-nothing: Teréga is 4 686 km of
   * a 36 106 km system, and losing it must not blank NaTran.
   * @param {?object} previous Last good document, merged under a partial refresh.
   */
  async function refreshNetwork(previous) {
    const [natran, terega] = await Promise.allSettled([
      fetchRows('trace-du-reseau-grt-250'),
      fetchRows('terega-trace-du-reseau'),
    ]);
    for (const [label, settled] of [['natran', natran], ['terega', terega]]) {
      if (settled.status === 'rejected') {
        console.warn(`[gas-fr-proxy] ${label} trace failed (${settled.reason?.message || settled.reason})`);
      }
    }
    if (natran.status === 'rejected' && terega.status === 'rejected') {
      throw new Error('both gas transmission traces are unavailable');
    }
    const projected = projectGasNetwork({
      natran: natran.status === 'fulfilled' ? natran.value : [],
      terega: terega.status === 'fulfilled' ? terega.value : [],
    }, SOURCE);
    // A half-failed refresh keeps the last good WHOLE rather than shipping a
    // half-drawn network that looks like an operator went away — re-stamped,
    // so one operator being unreachable does not turn every later request into
    // another 4.93 MB attempt. These traces are republished about once a year;
    // last week's whole beats this second's half.
    const keepPrevious = previous?.strokes?.length
      && (!projected.strokes.length
        || natran.status === 'rejected'
        || terega.status === 'rejected');
    if (keepPrevious) return { ...previous, at: Date.now() };
    return { at: Date.now(), ...projected };
  }

  /** Refresh the two registers, on the same settled rule. */
  async function refreshSites(previous) {
    const [plants, injections] = await Promise.allSettled([
      fetchRows('prod-elec-gaz-naturel-fr'),
      fetchRows('points-dinjection-de-biomethane-en-france'),
    ]);
    for (const [label, settled] of [['plants', plants], ['injections', injections]]) {
      if (settled.status === 'rejected') {
        console.warn(`[gas-fr-proxy] ${label} register failed (${settled.reason?.message || settled.reason})`);
      }
    }
    if (plants.status === 'rejected' && injections.status === 'rejected') {
      throw new Error('both gas registers are unavailable');
    }
    const projected = projectGasSites({
      plants: plants.status === 'fulfilled' ? plants.value : [],
      injections: injections.status === 'fulfilled' ? injections.value : [],
    }, SOURCE);
    return {
      at: Date.now(),
      source: projected.source,
      plants: projected.plants.length ? projected.plants : (previous?.plants || []),
      injections: projected.injections.length
        ? projected.injections
        : (previous?.injections || []),
      stats: projected.stats,
    };
  }

  async function readDiskOnce(kind, cachePath, validate) {
    if (diskChecked[kind]) return;
    diskChecked[kind] = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(cachePath, 'utf8'));
      if (Number.isFinite(parsed?.at) && validate(parsed)) mem[kind] = parsed;
    } catch { /* no disk cache yet */ }
  }

  async function writeDisk(cachePath, entry) {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      await fsp.writeFile(cachePath, JSON.stringify(entry), 'utf8');
    } catch (err) {
      console.warn(`[gas-fr-proxy] cache write failed (${err?.message || err})`);
    }
  }

  /**
   * Serve-or-refresh one half, single-flighted so N tabs opening at once cost
   * one 4.93 MB upstream fetch rather than N.
   * @returns {Promise<{served: ?object, stale: boolean}>}
   */
  async function resolve(kind, { cachePath, ttlMs, refresh, validate }) {
    await readDiskOnce(kind, cachePath, validate);
    const entry = mem[kind];
    let current = entry && Date.now() - entry.at < ttlMs ? entry : null;
    if (!current) {
      if (!inflight[kind]) {
        inflight[kind] = refresh(entry)
          .then(async (next) => {
            mem[kind] = next;
            await writeDisk(cachePath, next);
            return next;
          })
          .catch((err) => {
            console.warn(`[gas-fr-proxy] ${kind} refresh failed (${err?.message || err}) — serving cache if any`);
            return null;
          })
          .finally(() => { inflight[kind] = null; });
      }
      current = await inflight[kind];
    }
    return { served: current || entry, stale: !current && Boolean(entry) };
  }

  function install(middlewares) {
    middlewares.use('/api/gas-fr', async (req, res) => {
      const sendJson = (status, obj) => {
        if (res.headersSent) return;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(obj));
      };
      try {
        const subPath = String(req.url || '').split('?')[0];

        if (subPath === '/network') {
          const { served, stale } = await resolve('network', {
            cachePath: NETWORK_CACHE_PATH,
            ttlMs: NETWORK_TTL_MS,
            refresh: refreshNetwork,
            validate: (parsed) => Array.isArray(parsed?.strokes),
          });
          if (!served) {
            sendJson(502, { error: 'gas transmission trace fetch failed and no cache available' });
            return;
          }
          sendJson(200, {
            fetchedAt: served.at,
            stale,
            ttlMs: NETWORK_TTL_MS,
            source: served.source,
            operators: served.operators,
            groups: served.groups,
            strokes: served.strokes,
            stats: served.stats,
          });
          return;
        }

        if (subPath === '/sites') {
          const { served, stale } = await resolve('sites', {
            cachePath: SITES_CACHE_PATH,
            ttlMs: SITES_TTL_MS,
            refresh: refreshSites,
            validate: (parsed) => Array.isArray(parsed?.plants) && Array.isArray(parsed?.injections),
          });
          if (!served) {
            sendJson(502, { error: 'gas registers fetch failed and no cache available' });
            return;
          }
          sendJson(200, {
            fetchedAt: served.at,
            stale,
            ttlMs: SITES_TTL_MS,
            source: served.source,
            plants: served.plants,
            injections: served.injections,
            stats: served.stats,
          });
          return;
        }

        if (subPath === '/status') {
          // Status reports what is already cached; it never triggers a 4.93 MB
          // upstream fetch of its own.
          await readDiskOnce('network', NETWORK_CACHE_PATH, (p) => Array.isArray(p?.strokes));
          await readDiskOnce('sites', SITES_CACHE_PATH, (p) => Array.isArray(p?.plants));
          const network = mem.network;
          const sites = mem.sites;
          sendJson(200, {
            source: SOURCE,
            network: network
              ? {
                lastFetch: network.at,
                stale: Date.now() - network.at >= NETWORK_TTL_MS,
                ttlMs: NETWORK_TTL_MS,
                strokes: network.stats?.strokes ?? 0,
                lengthKm: network.stats?.lengthKm ?? 0,
              }
              : null,
            sites: sites
              ? {
                lastFetch: sites.at,
                stale: Date.now() - sites.at >= SITES_TTL_MS,
                ttlMs: SITES_TTL_MS,
                plants: sites.plants?.length ?? 0,
                injections: sites.injections?.length ?? 0,
              }
              : null,
          });
          return;
        }

        sendJson(404, { error: 'unknown gas-fr route' });
      } catch (err) {
        console.warn('[gas-fr-proxy] error:', err?.message || err);
        sendJson(500, { error: 'gas-fr proxy error' });
      }
    });
  }

  return {
    name: 'gas-fr-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}


/**
 * Bison Futé proxy (the road events France's DIRs declare) with a memory + disk
 * cache and a conditional-GET refresh.
 *
 * ONE keyless upstream, published by Tipi for the DGITM under Licence Ouverte
 * 2.0, covering the réseau routier national **non concédé** only:
 *   `Evenementiel-DIR/grt/RRN/content.xml` — every incident, roadworks order,
 *     closure, diversion and restriction the DIRs have declared, DATEX II v2
 *
 * The SIBLING product on the same host — QTV-DIR's six-minute speed and flow
 * snapshot — has its own proxy in `roadStatusFranceProxy()`, which also serves
 * Traficolor to the `road-status-fr` layer. Two proxies rather than one
 * deliberately: they poll on different clocks (hourly against six-minutely) and
 * one shared cache would tie the slower product's TTL to the faster one's.
 *
 * WHY A PROXY when the origin sends no CORS restriction a dev server cannot work
 * around: the document is 3.3 MB, and every open tab would parse it for itself.
 * Projected once, server-side, under test, it becomes ~190 KB of JSON the globe
 * can draw directly — and the DATEX II parsing lives in `bisonFuteFeed.js` where
 * a unit test can point at a real captured response instead of at a browser.
 *
 * WHY CONDITIONAL GET and not a plain poll. MEASURED 2026-08-31: the origin
 * serves `ETag`, `Last-Modified` AND gzip (3,365,501 → 165,296 bytes) and
 * answers `If-None-Match` with a 304. The aggregate is republished HOURLY at
 * HH:13, so a naive 5-minute poll would re-download and re-parse an unchanged
 * 3.3 MB document eleven times an hour. With `If-None-Match` the same cadence
 * costs one 304 per poll, and the projection runs only when the file has
 * genuinely moved — which is what makes the layer affordable at a cadence worth
 * having.
 *
 * Routes:
 *   GET /api/bison-fute/events → {fetchedAt, stale, publishedAt, events, counts}
 *   GET /api/bison-fute/status → the cache state
 *
 * @returns {import('vite').Plugin}
 */
/**
 * The RRN carriageway pack, read once per process.
 *
 * `config/rrn_centreline.json` is 3.16 MB and turns a road event's two
 * point-repère addresses into the stretch of tarmac they name. It is loaded
 * HERE and not in the browser for the obvious reason: shipping 3 MB to every
 * tab to save 48 KB on a 200 KB response is backwards, and the projection this
 * feeds already runs server-side on every serve.
 *
 * A missing or broken pack is not fatal. `traceCarriageway` then returns null
 * for every event and the layer draws exactly what it drew before — a chord —
 * which is the same graceful floor `loadRoadStatusSites` gives its sibling.
 */
const RRN_CENTRELINE_PATH = path.join(process.cwd(), 'config', 'rrn_centreline.json');
let _rrnCarriageway = null;
let _rrnCarriagewayPromise = null;
let _rrnCarriagewayFailed = false;

function loadRrnCarriageway() {
  if (_rrnCarriageway || _rrnCarriagewayFailed) return Promise.resolve(_rrnCarriageway);
  if (!_rrnCarriagewayPromise) {
    _rrnCarriagewayPromise = fsp.readFile(RRN_CENTRELINE_PATH, 'utf8')
      .then((text) => {
        const parsed = JSON.parse(text);
        if (!parsed?.posts || !parsed?.lines) throw new Error('pack has no posts/lines');
        _rrnCarriageway = indexCarriagewayPack(parsed);
        console.log(
          `[bison-fute-proxy] RRN carriageway pack: ${parsed.stats?.posts ?? '?'} posts,`
          + ` ${parsed.stats?.carriageways ?? '?'} carriageways`
          + ` (bornage ${parsed.bornageEdition}, liaisons ${parsed.centrelineEdition})`,
        );
        return _rrnCarriageway;
      })
      .catch((error) => {
        // Once, then never again: a rebuild is a restart, and retrying a
        // missing file on every serve would log the same line hourly forever.
        _rrnCarriagewayFailed = true;
        console.warn(
          `[bison-fute-proxy] no RRN carriageway pack (${error?.message || error})`
          + ' — segments stay chords. Run `npm run rrn:pack`.',
        );
        return null;
      });
  }
  return _rrnCarriagewayPromise;
}

/**
 * The tracer handed to `projectRoadEvents`, or null when there is no pack.
 * @param {object|null} index
 * @returns {?(request: object) => object}
 */
function carriagewayTracer(index) {
  if (!index) return null;
  return (request) => traceBetweenPr(index, {
    ...request,
    toWgs84: lambert93ToWgs84,
    simplify: simplifyPolyline,
    toleranceM: CENTRELINE_SIMPLIFY_M,
  });
}

function bisonFuteProxy() {
  const BASE = 'https://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR';
  const EVENTS_URL = `${BASE}/Evenementiel-DIR/grt/RRN/content.xml`;
  // Bounded well inside the product's own cadence, because a 304 is nearly
  // free: the file moves hourly, and this catches a republication within five
  // minutes for the cost of eleven conditional GETs an hour.
  const EVENTS_TTL_MS = 5 * 60_000;
  // 3.3 MB gzipped to 165 KB, from a government origin: generous, still bounded.
  const UPSTREAM_TIMEOUT_MS = 45_000;
  const CACHE_DIR = path.join(process.cwd(), '.gev-cache', 'bison-fute');
  const SOURCE = 'Bison Futé / Tipi (tipi.bison-fute.gouv.fr)';

  /**
   * One conditionally-refreshed upstream document.
   *
   * `etag` and `lastModified` are what make the poll cheap; `body` is retained
   * so a 304 can re-run the projection without a download — which matters
   * because `state` is time-dependent even when the document is not: roadworks
   * ordered for 08:30 become active at 08:30 whether or not the file moved.
   */
  const makeSlot = () => ({ etag: null, lastModified: null, body: null, at: 0 });
  const upstream = { events: makeSlot() };

  /** @type {{events: ?object}} */
  const mem = { events: null };
  const diskChecked = { events: false };
  /** @type {{events: ?Promise<?object>}} */
  const inflight = { events: null };

  /**
   * Conditionally fetch one upstream document into its slot.
   *
   * Returns whether the body CHANGED, so a caller can skip re-projecting an
   * unchanged document. A 304 refreshes the slot's timestamp and nothing else.
   * @param {string} url
   * @param {{etag:?string,lastModified:?string,body:?string,at:number}} slot
   * @returns {Promise<boolean>} True when a new body was read.
   */
  async function refreshDocument(url, slot) {
    const headers = { Accept: 'application/xml,text/csv,*/*' };
    // Only offer validators when there is a body they could validate: after a
    // cache eviction an `If-None-Match` hit would leave nothing to project.
    if (slot.body !== null) {
      if (slot.etag) headers['If-None-Match'] = slot.etag;
      if (slot.lastModified) headers['If-Modified-Since'] = slot.lastModified;
    }
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (response.status === 304) {
      slot.at = Date.now();
      return false;
    }
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    const body = await response.text();
    if (!body.trim()) throw new Error(`${url} returned an empty body`);
    slot.etag = response.headers.get('etag');
    slot.lastModified = response.headers.get('last-modified');
    slot.body = body;
    slot.at = Date.now();
    return true;
  }

  /** Refresh and project the road-event document. */
  async function refreshEvents(previous) {
    const changed = await refreshDocument(EVENTS_URL, upstream.events);
    // Loaded before the projection, not during it: `traceBetweenPr` is
    // synchronous by design, so the pack has to be in hand first. After the
    // first serve this is a resolved promise.
    const carriageway = await loadRrnCarriageway();
    // Unchanged upstream, but `state` is time-dependent: roadworks ordered for
    // 08:30 become active at 08:30 whether or not the file moved. Re-project
    // from the retained body rather than serving a stale "planned".
    const projected = projectRoadEvents(upstream.events.body, {
      traceCarriageway: carriagewayTracer(carriageway),
    });
    if (!changed && previous) {
      return { ...previous, at: Date.now(), ...projected };
    }
    return { at: Date.now(), source: SOURCE, ...projected };
  }

  const cachePath = (key) => path.join(CACHE_DIR, `${key}.json`);

  async function readDiskOnce(key, valid) {
    if (diskChecked[key]) return;
    diskChecked[key] = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(cachePath(key), 'utf8'));
      if (Number.isFinite(parsed?.at) && valid(parsed)) mem[key] = parsed;
    } catch { /* no disk cache yet */ }
  }

  async function writeDisk(key, entry) {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      await fsp.writeFile(cachePath(key), JSON.stringify(entry), 'utf8');
    } catch (err) {
      console.warn(`[bison-fute-proxy] ${key} cache write failed (${err?.message || err})`);
    }
  }

  /**
   * Serve one of the two documents, refreshing it when its TTL has expired and
   * falling back to the last good copy when the origin is down.
   * @param {'events'} key
   * @param {number} ttlMs
   * @param {(previous:?object)=>Promise<object>} refresh
   * @returns {Promise<{served:?object, stale:boolean}>}
   */
  async function serve(key, ttlMs, refresh) {
    const entry = mem[key];
    let current = entry && Date.now() - entry.at < ttlMs ? entry : null;
    if (!current) {
      if (!inflight[key]) {
        inflight[key] = refresh(entry)
          .then(async (next) => {
            mem[key] = next;
            await writeDisk(key, next);
            return next;
          })
          .catch((err) => {
            console.warn(`[bison-fute-proxy] ${key} refresh failed (${err?.message || err}) — serving cache if any`);
            return null;
          })
          .finally(() => { inflight[key] = null; });
      }
      current = await inflight[key];
    }
    return { served: current || entry, stale: !current && Boolean(entry) };
  }

  function install(middlewares) {
    middlewares.use('/api/bison-fute', async (req, res) => {
      const sendJson = (status, obj) => {
        if (res.headersSent) return;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(obj));
      };
      try {
        const subPath = String(req.url || '').split('?')[0];
        await readDiskOnce('events', (parsed) => Array.isArray(parsed?.events));

        if (subPath === '/status') {
          sendJson(200, {
            source: SOURCE,
            events: mem.events
              ? { lastFetch: mem.events.at, publishedAt: mem.events.publishedAt, count: mem.events.events.length }
              : null,
            ttlMs: EVENTS_TTL_MS,
          });
          return;
        }

        if (subPath === '/events' || subPath === '/events/') {
          const { served, stale } = await serve('events', EVENTS_TTL_MS, refreshEvents);
          if (!served) { sendJson(502, { error: 'Bison Futé events fetch failed and no cache available' }); return; }
          sendJson(200, {
            fetchedAt: served.at,
            stale,
            ttlMs: EVENTS_TTL_MS,
            source: served.source,
            publishedAt: served.publishedAt,
            publishedAtMs: served.publishedAtMs,
            supplier: served.supplier,
            counts: served.counts,
            events: served.events,
          });
          return;
        }

        sendJson(404, { error: 'unknown Bison Futé route' });
      } catch (err) {
        console.warn('[bison-fute-proxy] error:', err?.message || err);
        sendJson(500, { error: 'Bison Futé proxy error' });
      }
    });
  }

  return {
    name: 'bison-fute-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

/**
 * EDF generating-fleet proxy (hydraulic + nuclear + fossil-fired) with a
 * memory + disk cache.
 *
 * THREE keyless upstreams on one portal. EDF publishes the location and
 * installed power of its own fleet as three Licence Ouverte 2.0 datasets, and
 * they are the answer to "where is France's generating capacity", not "how
 * much is it generating" — that question belongs to `/api/energy-fr`.
 *
 *   `…-nucleaire-edf`            56 rows, one per REACTOR  → 18 sites
 *   `…-hydraulique-de-edf-sa`    51 rows, one per PLANT    → 51 sites
 *   `…-thermique-a-flamme-…`     19 rows, one per UNIT     → 10 sites
 *
 * WHICH API, and why not the obvious one: opendata.edf.fr used to be an
 * Opendatasoft portal and has migrated to Koumoul's data-fair. The ODS
 * compatibility layer still answers `/api/explore/v2.1/…/records`, but its
 * catalog, facets and v1 search routes now return 410 or the SPA's HTML 404
 * (measured 2026-08-27). The native data-fair routes are therefore the ones
 * used here — and they carry the dataset DESCRIPTOR as well as the rows, which
 * is what lets the layer report each file's own reference date and licence
 * instead of hard-coding a date that will silently rot.
 *
 * Each dataset is fetched as a (descriptor, rows) pair, and the three pairs run
 * in PARALLEL with `Promise.allSettled`: one filière failing must not blank the
 * other two. A half-failed refresh is merged per filière over the previous
 * cache, so a missing nuclear file leaves the previous 18 sites in place rather
 * than reporting that France has no reactors.
 *
 * MEASURED 2026-08-27: six requests, 200 in 0.21–0.33 s each, ~159 KB raw,
 * projected to one ~36 KB document of 79 sites / 80 094 MW.
 *
 * WHY A PROXY when the portal does send `Access-Control-Allow-Origin: *`: the
 * six raw bodies are ~159 KB against the ~36 KB the globe needs, N open tabs
 * would each pay for their own six round trips, and the row-to-site grouping,
 * the two incompatible coordinate shapes and the three different vintages are
 * traps best absorbed once, server-side, under test (`edfPlantsFeed.js`).
 *
 * Routes:
 *   GET /api/edf-plants        → {fetchedAt, stale, ttlMs, source, sites, datasets, totals}
 *   GET /api/edf-plants/status → {source, lastFetch, stale, ttlMs, siteCount}
 *
 * @returns {import('vite').Plugin}
 */
function edfPlantsProxy() {
  // The three files are updated ANNUALLY (`frequency: 'annual'`, and the newest
  // `dataUpdatedAt` at the time of writing was four months old). A day of cache
  // is still two orders of magnitude fresher than the data, and it makes a cold
  // page load cost nothing after the first one of the day.
  const TTL_MS = 24 * 3600_000;
  const BASE = 'https://opendata.edf.fr/data-fair/api/v1/datasets';
  // The largest file holds 56 rows; 1 000 is headroom, not a page size to tune.
  // If EDF ever publishes more than that, `truncated` says so rather than the
  // layer quietly drawing a partial fleet.
  const PAGE_SIZE = 1000;
  const CACHE_DIR = path.join(process.cwd(), '.gev-cache');
  const CACHE_PATH = path.join(CACHE_DIR, 'edf-plants.json');
  const SOURCE = 'EDF Open Data (opendata.edf.fr)';

  /** @type {?{at:number, source:string, sites:Array<object>, datasets:Array<object>, totals:object}} */
  let mem = null;
  let diskChecked = false;
  /** @type {?Promise<?object>} */
  let inflight = null;

  async function fetchJson(url) {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
    // The portal serves its SPA's HTML 404 for an unknown dataset slug, so a
    // body that is not JSON is an error rather than an empty fleet.
    const payload = await response.json();
    if (!payload || typeof payload !== 'object') throw new Error('upstream returned no object');
    return payload;
  }

  /**
   * Fetch one dataset's rows and descriptor.
   *
   * The rows are required; the descriptor is not. A descriptor that fails to
   * load costs the reference date and the licence string — which the client
   * then reports as unknown — but it must not cost the 56 reactors.
   * @param {{slug:string}} spec
   */
  async function fetchDataset(spec) {
    const [lines, meta] = await Promise.allSettled([
      fetchJson(`${BASE}/${spec.slug}/lines?size=${PAGE_SIZE}`),
      fetchJson(`${BASE}/${spec.slug}`),
    ]);
    if (lines.status === 'rejected') throw lines.reason;
    if (!Array.isArray(lines.value?.results)) throw new Error('upstream returned no results array');
    if (meta.status === 'rejected') {
      console.warn(`[edf-plants-proxy] ${spec.key} descriptor unavailable (${meta.reason?.message || meta.reason})`);
    }
    return { lines: lines.value, meta: meta.status === 'fulfilled' ? meta.value : null };
  }

  /**
   * Refresh all three filières, keeping whichever succeeded.
   * @param {?object} previous Last good document, merged under a partial refresh.
   */
  async function refreshUpstream(previous) {
    const settled = await Promise.allSettled(EDF_DATASETS.map(fetchDataset));
    /** @type {Record<string, object>} */
    const payloads = {};
    const failed = [];
    EDF_DATASETS.forEach((spec, index) => {
      const result = settled[index];
      if (result.status === 'fulfilled') payloads[spec.key] = result.value;
      else {
        failed.push(spec.key);
        console.warn(`[edf-plants-proxy] ${spec.key} fetch failed (${result.reason?.message || result.reason})`);
      }
    });
    if (failed.length === EDF_DATASETS.length) {
      throw new Error('all three EDF datasets are unavailable');
    }

    const projected = projectEdfPlants(payloads, SOURCE);
    // Merge per filière, not per document: the half that failed keeps its last
    // good sites rather than reporting none, which would read as "these plants
    // were demolished".
    const sites = projected.sites.slice();
    const datasets = projected.datasets.slice();
    for (const key of failed) {
      for (const site of previous?.sites || []) {
        if (site?.filiere === key) sites.push(site);
      }
      const descriptor = (previous?.datasets || []).find((entry) => entry?.key === key);
      if (descriptor) datasets.push({ ...descriptor, stale: true });
    }
    sites.sort((a, b) => (b.mw ?? 0) - (a.mw ?? 0) || String(a.id).localeCompare(String(b.id)));
    return {
      at: Date.now(),
      source: SOURCE,
      sites,
      datasets,
      totals: projected.totals,
    };
  }

  async function readDiskOnce() {
    if (diskChecked) return;
    diskChecked = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
      if (Number.isFinite(parsed?.at) && Array.isArray(parsed?.sites)) mem = parsed;
    } catch { /* no disk cache yet */ }
  }

  async function writeDisk(entry) {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      await fsp.writeFile(CACHE_PATH, JSON.stringify(entry), 'utf8');
    } catch (err) {
      console.warn(`[edf-plants-proxy] cache write failed (${err?.message || err})`);
    }
  }

  function install(middlewares) {
    middlewares.use('/api/edf-plants', async (req, res) => {
      const sendJson = (status, obj) => {
        if (res.headersSent) return;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(obj));
      };
      try {
        const subPath = String(req.url || '').split('?')[0];
        await readDiskOnce();

        const entry = mem;
        let current = entry && Date.now() - entry.at < TTL_MS ? entry : null;
        if (!current) {
          if (!inflight) {
            inflight = refreshUpstream(entry)
              .then(async (next) => {
                mem = next;
                await writeDisk(next);
                return next;
              })
              .catch((err) => {
                console.warn(`[edf-plants-proxy] refresh failed (${err?.message || err}) — serving cache if any`);
                return null;
              })
              .finally(() => { inflight = null; });
          }
          current = await inflight;
        }
        const served = current || entry;
        const stale = !current && Boolean(entry);

        if (subPath === '/status') {
          sendJson(200, {
            source: served ? served.source : null,
            lastFetch: served ? served.at : null,
            siteCount: served ? served.sites.length : 0,
            stale,
            ttlMs: TTL_MS,
          });
          return;
        }
        if (!served) {
          sendJson(502, { error: 'EDF Open Data fetch failed and no cache available' });
          return;
        }
        sendJson(200, {
          fetchedAt: served.at,
          stale,
          ttlMs: TTL_MS,
          source: served.source,
          sites: served.sites,
          datasets: served.datasets,
          totals: served.totals,
        });
      } catch (err) {
        console.warn('[edf-plants-proxy] error:', err?.message || err);
        sendJson(500, { error: 'EDF plants proxy error' });
      }
    });
  }

  return {
    name: 'edf-plants-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

/**
 * Vite plugin: RTE per-unit generation proxy (OAuth2 client-credentials).
 *
 * Upstream: `actual_generation/v1/actual_generations_per_unit` on RTE's
 * developer portal — what every French generating unit of 100 MW or more
 * actually produced, hour by hour. It is the ONE source on this globe that
 * needs an account and it is free: create one at
 * https://data.rte-france.com/create_account, attach the **Actual Generation**
 * API to an application, and put the pair in `.env` as `RTE_CLIENT_ID` /
 * `RTE_CLIENT_SECRET` (or the ready-made base64 pair as `RTE_BASE64_KEY`).
 *
 * ── This route answers 200 with no credentials, deliberately ────────────────
 *
 * `auth: "missing"` and an empty unit list is a legitimate, complete answer,
 * not an error. The layer ships the whole 171-unit fleet as a file and draws
 * it keyless; RTE's contribution is the number that moves. Returning 502 here
 * would make a working keyless layer look broken.
 *
 * ── Why the request is tried twice ──────────────────────────────────────────
 *
 * The dated window (`rteGenerationWindow`: Paris yesterday 00:00 → tomorrow
 * 00:00) is what this layer wants — it always contains the last published hour
 * and it carries the ~24 hours of history the cards draw. But this build could
 * not verify against the live service that a 48-hour range is inside the
 * resource's accepted span, and RTE answers an out-of-range window with 400.
 * So a non-2xx dated attempt falls back to the BARE call, which is the
 * documented default window and is what every published client of this
 * resource uses. Whichever answered is reported in `window.mode`, so the
 * fallback is visible rather than silent.
 *
 * Auth is refreshed on 401 exactly once per request: a token that expired
 * between the cache check and the call is a race, not a credential problem.
 *
 * Routes:
 *   GET /api/rte-generation        → {fetchedAt, stale, ttlMs, source, auth, window, units, stats}
 *   GET /api/rte-generation/status → {source, auth, lastFetch, stale, ttlMs, units, reporting, totalMw}
 *
 * @returns {import('vite').Plugin}
 */
function rteGenerationProxy() {
  // The resource publishes hourly. Five minutes bounds staleness to a twelfth
  // of a step while costing 288 upstream calls a day against a free account.
  const TTL_MS = 5 * 60_000;
  const CACHE_DIR = path.join(process.cwd(), '.gev-cache');
  const CACHE_PATH = path.join(CACHE_DIR, 'rte-generation.json');
  const SOURCE = 'RTE (digital.iservices.rte-france.com)';
  const UPSTREAM_TIMEOUT_MS = 60_000;
  /** Refresh this long before the token actually expires. */
  const TOKEN_SAFETY_MS = 60_000;
  /** Fallback lifetime when RTE omits `expires_in`. Its tokens run ~2 h. */
  const TOKEN_DEFAULT_S = 7200;

  /** @type {?{at:number, auth:string, window:object, units:Array<object>, stats:object}} */
  let mem = null;
  let diskChecked = false;
  /** @type {?Promise<?object>} */
  let inflight = null;

  let token = null;
  let tokenExpiry = 0;
  /** @type {?Promise<?string>} */
  let tokenPromise = null;
  let authWarned = false;
  let lastAuthDetail = null;

  /**
   * The HTTP Basic credential, base64 of `client_id:client_secret`.
   *
   * RTE's application dashboard shows the pair AND an already-encoded key, and
   * people copy whichever is in front of them — so both are accepted, with the
   * pre-encoded one winning because it needs no assembly and cannot be
   * assembled wrong.
   * @returns {?string}
   */
  function basicCredential() {
    const encoded = String(process.env.RTE_BASE64_KEY || '').trim();
    if (encoded) return encoded;
    const id = String(process.env.RTE_CLIENT_ID || '').trim();
    const secret = String(process.env.RTE_CLIENT_SECRET || '').trim();
    if (!id || !secret) return null;
    return Buffer.from(`${id}:${secret}`, 'utf8').toString('base64');
  }

  /**
   * A valid bearer token, refreshing when needed.
   *
   * Concurrent callers share one in-flight refresh — the same coalescing the
   * OpenSky token path uses, for the same reason: N tabs opening at once must
   * cost one token, not N.
   * @param {boolean} [force=false] Discard a cached token first (401 recovery).
   * @returns {Promise<?string>}
   */
  async function getToken(force = false) {
    if (force) { token = null; tokenExpiry = 0; }
    if (token && Date.now() < tokenExpiry - TOKEN_SAFETY_MS) return token;
    if (tokenPromise) return tokenPromise;

    const credential = basicCredential();
    if (!credential) { lastAuthDetail = 'no RTE_CLIENT_ID / RTE_CLIENT_SECRET'; return null; }

    tokenPromise = (async () => {
      try {
        const response = await fetch(RTE_TOKEN_URL, {
          method: 'POST',
          headers: {
            // RTE's token endpoint reads the credential from the Basic header
            // and takes NO body. Sending `grant_type=client_credentials` as a
            // form body without the header is answered `invalid_client`.
            Authorization: `Basic ${credential}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          signal: AbortSignal.timeout(30_000),
        });
        let data = null;
        try { data = await response.json(); } catch { data = null; }
        const accessToken = data?.access_token;
        if (!response.ok || !accessToken) {
          lastAuthDetail = data?.error_description || data?.error || `HTTP ${response.status}`;
          if (!authWarned) {
            console.warn(`[rte-generation-proxy] OAuth client_credentials failed: ${lastAuthDetail}`);
            authWarned = true;
          }
          token = null;
          tokenExpiry = 0;
          return null;
        }
        const expiresIn = Number(data?.expires_in);
        token = accessToken;
        tokenExpiry = Date.now() + (Number.isFinite(expiresIn) ? expiresIn : TOKEN_DEFAULT_S) * 1000;
        lastAuthDetail = null;
        authWarned = false;
        console.log(
          '[rte-generation-proxy] OAuth token refreshed, expires in',
          Number.isFinite(expiresIn) ? expiresIn : TOKEN_DEFAULT_S, 's',
        );
        return token;
      } catch (err) {
        lastAuthDetail = err?.message || String(err);
        if (!authWarned) {
          console.warn(`[rte-generation-proxy] OAuth token request failed: ${lastAuthDetail}`);
          authWarned = true;
        }
        token = null;
        tokenExpiry = 0;
        return null;
      } finally {
        tokenPromise = null;
      }
    })();
    return tokenPromise;
  }

  /** One authenticated GET, refreshing the token once on 401. */
  async function authorizedGet(url) {
    let bearer = await getToken();
    if (!bearer) return { status: 0, body: null };
    let response = await fetch(url, {
      headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (response.status === 401) {
      bearer = await getToken(true);
      if (!bearer) return { status: 401, body: null };
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    }
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    return { status: response.status, body };
  }

  /** Fetch and project one refresh. Never throws for a missing credential. */
  async function refreshUpstream() {
    if (!basicCredential()) {
      return {
        at: Date.now(),
        auth: 'missing',
        authDetail: 'set RTE_CLIENT_ID and RTE_CLIENT_SECRET in .env — free account at data.rte-france.com',
        window: { mode: 'none' },
        units: [],
        stats: { units: 0, reporting: 0, totalMw: 0 },
      };
    }

    const span = rteGenerationWindow(new Date());
    const dated = `${RTE_ACTUAL_GENERATIONS_PER_UNIT_URL}`
      + `?start_date=${encodeURIComponent(span.startDate)}`
      + `&end_date=${encodeURIComponent(span.endDate)}`;

    let attempt = await authorizedGet(dated);
    let mode = 'dated';
    // `status: 0` means the token itself never arrived. Retrying the same call
    // on a different window would fail identically and would report the auth
    // problem as a window problem, which is a worse error message.
    if (attempt.status !== 0 && (attempt.status < 200 || attempt.status >= 300)) {
      const detail = attempt.body?.error_description || attempt.body?.error || `HTTP ${attempt.status}`;
      console.warn(
        `[rte-generation-proxy] dated window ${span.startDate} → ${span.endDate} refused (${detail})`
        + ' — retrying on the default window',
      );
      attempt = await authorizedGet(RTE_ACTUAL_GENERATIONS_PER_UNIT_URL);
      mode = 'default';
    }

    if (attempt.status < 200 || attempt.status >= 300 || !attempt.body) {
      const detail = attempt.body?.error_description || attempt.body?.error
        || (attempt.status ? `HTTP ${attempt.status}` : lastAuthDetail || 'no token');
      throw new Error(detail);
    }

    const projected = projectActualGenerations(attempt.body);
    return {
      at: Date.now(),
      auth: 'ok',
      authDetail: null,
      window: mode === 'dated'
        ? { mode, startDate: span.startDate, endDate: span.endDate }
        // The default window is RTE's, not ours; reporting our own dates for it
        // would be a claim about a request we did not make.
        : { mode },
      units: projected.units,
      stats: projected.stats,
    };
  }

  async function readDiskOnce() {
    if (diskChecked) return;
    diskChecked = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
      if (Number.isFinite(parsed?.at) && Array.isArray(parsed?.units)) mem = parsed;
    } catch { /* no disk cache yet */ }
  }

  async function writeDisk(entry) {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      await fsp.writeFile(CACHE_PATH, JSON.stringify(entry), 'utf8');
    } catch (err) {
      console.warn(`[rte-generation-proxy] cache write failed (${err?.message || err})`);
    }
  }

  /** Serve-or-refresh, single-flighted. */
  async function resolve() {
    await readDiskOnce();
    const entry = mem;
    let current = entry && Date.now() - entry.at < TTL_MS ? entry : null;
    if (!current) {
      if (!inflight) {
        inflight = refreshUpstream()
          .then(async (next) => {
            mem = next;
            // A credential-less answer is not worth a disk round trip, and
            // caching it would survive the user adding their key.
            if (next.auth === 'ok') await writeDisk(next);
            return next;
          })
          .catch((err) => {
            console.warn(`[rte-generation-proxy] refresh failed (${err?.message || err}) — serving cache if any`);
            return null;
          })
          .finally(() => { inflight = null; });
      }
      current = await inflight;
    }
    return { served: current || entry, stale: !current && Boolean(entry) };
  }

  function install(middlewares) {
    middlewares.use('/api/rte-generation', async (req, res) => {
      const sendJson = (status, obj) => {
        if (res.headersSent) return;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(obj));
      };
      try {
        const subPath = String(req.url || '').split('?')[0];

        if (subPath === '/status') {
          // Reports what is cached; never triggers an upstream call of its own.
          await readDiskOnce();
          sendJson(200, {
            source: SOURCE,
            auth: basicCredential()
              ? (mem?.auth || (lastAuthDetail ? 'failed' : 'unknown'))
              : 'missing',
            authDetail: lastAuthDetail,
            ttlMs: TTL_MS,
            lastFetch: mem?.at ?? null,
            stale: mem ? Date.now() - mem.at >= TTL_MS : null,
            window: mem?.window || null,
            units: mem?.stats?.units ?? 0,
            reporting: mem?.stats?.reporting ?? 0,
            totalMw: mem?.stats?.totalMw ?? 0,
            latestAt: mem?.stats?.latestAt ?? null,
          });
          return;
        }

        if (subPath === '/' || subPath === '') {
          const { served, stale } = await resolve();
          if (!served) {
            // 200, not 502. The layer draws 93.5 GW of French generating
            // capacity from a file; this route only ever adds the numbers that
            // move. Answering 5xx would turn "your key is wrong" into "the
            // layer is broken", and the reason is right here in the payload.
            sendJson(200, {
              fetchedAt: Date.now(),
              stale: false,
              ttlMs: TTL_MS,
              source: SOURCE,
              auth: 'failed',
              authDetail: lastAuthDetail || 'RTE actual_generations_per_unit is unavailable',
              window: { mode: 'none' },
              units: [],
              stats: { units: 0, reporting: 0, totalMw: 0 },
            });
            return;
          }
          sendJson(200, {
            fetchedAt: served.at,
            stale,
            ttlMs: TTL_MS,
            source: SOURCE,
            auth: served.auth,
            authDetail: served.authDetail || null,
            window: served.window,
            units: served.units,
            stats: served.stats,
          });
          return;
        }

        sendJson(404, { error: 'unknown rte-generation route' });
      } catch (err) {
        console.warn('[rte-generation-proxy] error:', err?.message || err);
        sendJson(500, { error: 'rte-generation proxy error' });
      }
    });
  }

  return {
    name: 'rte-generation-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

/**
 * Re:Earth terrain point-height proxy: batched lon/lat → ellipsoidal height
 * lookups, keyless. Upstream: https://terrain.reearth.land/heights.json
 * (≤256 points per call). Terrain doesn't move, so results are cached to
 * disk with a long TTL (30 days) — mirrors celestrakProxy's memory+disk
 * cache and serve-stale shape. Cache entries and stale fallback are keyed per
 * 5dp point, so reordered and partially overlapping batches reuse prior work.
 * Only missing/stale points go upstream; the response is rebuilt in exact
 * request order. Oversized requests (>256 points) are chunked sequentially.
 */
function terrainHeightsProxy() {
  const TTL_MS = 30 * 24 * 3600_000;
  const CACHE_DIR = path.join(process.cwd(), '.gev-cache');
  const CACHE_PATH = path.join(CACHE_DIR, 'terrain-heights.json');
  const UPSTREAM_CHUNK = 256;
  const MAX_POINTS = 2000;

  /** @type {Map<string, {at:number, result:object}>} keyed by canonical 5dp lon/lat. */
  const mem = new Map();
  /** @type {Map<string, Promise<Array<object>>>} single-flight per missing-point subset. */
  const inflight = new Map();
  let diskLoaded = false;
  let diskDirty = false;

  /** Load the on-disk cache into memory once, lazily (first request only). */
  async function loadDiskOnce() {
    if (diskLoaded) return;
    diskLoaded = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
      const pointEntries = parsed?.version === 2 && parsed.points && typeof parsed.points === 'object'
        ? parsed.points
        : null;
      if (pointEntries) {
        for (const [key, entry] of Object.entries(pointEntries)) {
          if (entry && Number.isFinite(entry.at) && validTerrainResult(entry.result)) {
            mem.set(key, entry);
          }
        }
      } else if (parsed && typeof parsed === 'object') {
        // One-time migration from the former raw-batch cache. Zip only real,
        // positionally present results; an absent value never becomes height 0.
        for (const [rawPoints, entry] of Object.entries(parsed)) {
          const points = parseTerrainPoints(rawPoints);
          if (!points || !entry || !Number.isFinite(entry.at) || !Array.isArray(entry.results)) continue;
          for (let i = 0; i < points.length; i += 1) {
            const result = entry.results[i];
            if (!validTerrainResult(result)) continue;
            const key = terrainPointKey(points[i]);
            const existing = mem.get(key);
            if (!existing || entry.at > existing.at) mem.set(key, { at: entry.at, result });
          }
        }
        diskDirty = mem.size > 0;
      }
    } catch { /* no disk cache yet */ }
    // Periodic flush, same shape as adsbdbProxy: coalesce writes instead of
    // hitting disk on every request.
    setInterval(async () => {
      if (!diskDirty) return;
      diskDirty = false;
      try {
        await fsp.mkdir(CACHE_DIR, { recursive: true });
        const obj = { version: 2, points: Object.fromEntries(mem.entries()) };
        await fsp.writeFile(CACHE_PATH, JSON.stringify(obj), 'utf8');
      } catch (err) {
        diskDirty = true; // retry next tick
        console.warn('[terrain-heights-proxy] cache write failed:', err?.message || err);
      }
    }, 15_000).unref?.();
  }

  /**
   * Fetch all missing chunks sequentially (upstream caps each call at 256).
   *
   * The first try keeps its empirically required 30s timeout; network errors,
   * 429, and 5xx receive up to three jittered retries sharing a 10s added-time
   * budget, with Retry-After honored within that bound.
   * @param {Array<[number, number]>} points
   * @returns {Promise<Array<object>>}
   */
  async function fetchUpstreamAll(points) {
    const results = [];
    for (let i = 0; i < points.length; i += UPSTREAM_CHUNK) {
      const chunk = points.slice(i, i + UPSTREAM_CHUNK);
      const chunkResults = await fetchTerrainChunkWithRetry(chunk);
      // Keep later chunks aligned even if a malformed upstream response omits
      // trailing positions. The resolver will reject each null individually.
      for (let j = 0; j < chunk.length; j += 1) results.push(chunkResults[j] ?? null);
    }
    return results;
  }

  /** Coalesce concurrent requests for the same canonical missing-point list. */
  function fetchMissingSingleFlight(points) {
    const key = points.map(terrainPointKey).join(';');
    if (!inflight.has(key)) {
      const request = fetchUpstreamAll(points)
        .finally(() => {
          if (inflight.get(key) === request) inflight.delete(key);
        });
      inflight.set(key, request);
    }
    return inflight.get(key);
  }

  return {
    name: 'terrain-heights-proxy',
    configureServer(server) {
      server.middlewares.use('/api/terrain/heights', async (req, res) => {
        const send = (status, bodyObj) => {
          if (res.headersSent) return;
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(bodyObj));
        };
        try {
          await loadDiskOnce();
          const parsedUrl = new URL(req.url || '', 'http://internal');
          const rawPoints = parsedUrl.searchParams.get('points');
          const points = parseTerrainPoints(rawPoints);
          if (!points) {
            send(400, { error: 'invalid points parameter — expected "lon,lat;lon,lat;…" with finite numbers' });
            return;
          }
          if (points.length > MAX_POINTS) {
            send(500, { error: `too many points (${points.length}); max ${MAX_POINTS} per request` });
            return;
          }

          const outcome = await resolveTerrainHeightRequest({
            points,
            cache: mem,
            fetchMissing: fetchMissingSingleFlight,
            ttlMs: TTL_MS,
          });
          if (outcome.cacheChanged) diskDirty = true;
          if (outcome.upstreamError) {
            console.warn(
              `[terrain-heights-proxy] refresh incomplete (${outcome.upstreamError?.message || outcome.upstreamError})`
              + ' — serving stale points when available'
            );
          }
          send(outcome.status, outcome.body);
        } catch (err) {
          send(500, { error: `terrain heights proxy error: ${err?.message || err}` });
        }
      });
    },
  };
}

/**
 * adsbdb.com enrichment proxy: callsign → route (airline + origin/destination
 * airports) and hex → aircraft type/registration. Free community API — cached
 * aggressively: ONE upstream request per new key ever (404s negative-cached),
 * persisted to disk so restarts don't re-hammer it. Adapted from skylight
 * (MIT) server/src/enrich/routes.ts.
 */
function adsbdbProxy() {
  const TTL_MS = 24 * 3600_000;
  const CACHE_PATH = path.join(process.cwd(), '.gev-cache', 'adsbdb.json');
  let cache = { routes: {}, aircraft: {} };
  let dirty = false;
  let loaded = false;
  const inflight = new Map();

  async function loadOnce() {
    if (loaded) return;
    loaded = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
      cache = { routes: parsed.routes ?? {}, aircraft: parsed.aircraft ?? {} };
    } catch { /* first run */ }
    setInterval(async () => {
      if (!dirty) return;
      dirty = false;
      try {
        await fsp.mkdir(path.dirname(CACHE_PATH), { recursive: true });
        await fsp.writeFile(CACHE_PATH, JSON.stringify(cache), 'utf8');
      } catch { dirty = true; } // retry next tick
    }, 15_000).unref?.();
  }

  const fresh = (e) => e && Date.now() - e.at < TTL_MS;

  function parseRoute(json) {
    const fr = json?.response?.flightroute;
    if (!fr?.origin || !fr?.destination) return null;
    const airport = (a) => ({
      code: a.iata_code || a.icao_code || '',
      name: a.municipality || a.name || '',
      lat: Number.isFinite(a.latitude) ? a.latitude : null,
      lon: Number.isFinite(a.longitude) ? a.longitude : null,
    });
    return { airline: fr.airline?.name || null, origin: airport(fr.origin), destination: airport(fr.destination) };
  }

  function parseAircraft(json) {
    const a = json?.response?.aircraft;
    if (!a) return null;
    return {
      typeCode: a.icao_type || null, // ICAO designator, e.g. "B738" — feeds classifyAircraft
      typeName: a.manufacturer && a.type ? `${a.manufacturer} ${a.type}` : (a.type || null),
      registration: a.registration || null,
    };
  }

  function lookup(kind, key) {
    const store = kind === 'route' ? cache.routes : cache.aircraft;
    if (fresh(store[key])) return Promise.resolve(store[key].data);
    const ik = `${kind}:${key}`;
    if (!inflight.has(ik)) {
      inflight.set(ik, (async () => {
        try {
          const url = kind === 'route'
            ? `https://api.adsbdb.com/v0/callsign/${encodeURIComponent(key)}`
            : `https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(key)}`;
          const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (res.ok) {
            const data = kind === 'route' ? parseRoute(await res.json()) : parseAircraft(await res.json());
            store[key] = { at: Date.now(), data }; // data may be null — negative cache
            dirty = true;
            return data;
          }
          if (res.status === 404) {
            store[key] = { at: Date.now(), data: null }; // known-missing — cache the miss
            dirty = true;
          }
          // other statuses: leave uncached so we retry later
          return fresh(store[key]) ? store[key].data : null;
        } catch {
          return fresh(store[key]) ? store[key].data : null; // network error → stale if any
        } finally {
          inflight.delete(ik);
        }
      })());
    }
    return inflight.get(ik);
  }

  return {
    name: 'adsbdb-proxy',
    configureServer(server) {
      server.middlewares.use('/api/adsbdb', async (req, res) => {
        await loadOnce();
        const send = (status, obj) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(obj));
        };
        try {
          const [, kind, rawKey] = String(req.url || '').split('?')[0].split('/');
          if (kind === 'route') {
            const cs = String(rawKey || '').toUpperCase();
            if (!/^[A-Z0-9]{2,8}$/.test(cs)) return send(400, { error: 'invalid callsign' });
            const data = await lookup('route', cs);
            return send(200, data ? { found: true, ...data } : { found: false });
          }
          if (kind === 'type') {
            const hex = String(rawKey || '').toLowerCase();
            if (!/^[0-9a-f]{6}$/.test(hex)) return send(400, { error: 'invalid hex' });
            const data = await lookup('aircraft', hex);
            return send(200, data ? { found: true, ...data } : { found: false });
          }
          return send(404, { error: 'unknown endpoint' });
        } catch (err) {
          return send(500, { error: String(err?.message || err) });
        }
      });
    },
  };
}

/**
 * Detect whether an Overpass API response body indicates rate-limiting.
 *
 * Checks for known rate-limit phrases in the body text regardless of
 * HTTP status code, since some mirrors return 200 with an error payload.
 *
 * @param {string} bodyText - Upstream response body.
 * @returns {boolean} True if the body looks rate-limited.
 */
function overpassLooksRateLimited(bodyText) {
  const text = String(bodyText || '').toLowerCase();
  return text.includes('rate_limited')
    || text.includes('quota of your ip address')
    || text.includes('dispatcher_client::request_read_and_idx::rate_limited')
    || text.includes('too many requests');
}

/**
 * Detect an Overpass HTTP-200 body that is actually a runtime FAILURE (server-side
 * timeout / out-of-memory) via its `remark`. These are transient upstream failures,
 * not authoritative empty results, so they must not be returned or cached.
 */
function overpassLooksRuntimeError(bodyText) {
  const text = String(bodyText || '').toLowerCase();
  return text.includes('runtime error')
    || text.includes('timed out')
    || text.includes('out of memory');
}

/** Evict oldest Overpass cache entries until size is within the cap. */
function trimOverpassCache() {
  while (_overpassCache.size > OVERPASS_CACHE_MAX_ENTRIES) {
    const oldestKey = _overpassCache.keys().next().value;
    if (!oldestKey) break;
    _overpassCache.delete(oldestKey);
  }
}

/**
 * Write a completed Overpass payload to the HTTP response.
 *
 * @param {import('http').ServerResponse} res - Node HTTP response.
 * @param {{status:number,body:string,contentType:string,endpoint:string}} payload
 * @param {string} [cacheStatus='MISS'] - 'HIT', 'MISS', or 'INFLIGHT'.
 */
function sendOverpassResponse(res, payload, cacheStatus = 'MISS') {
  res.writeHead(payload.status, {
    'Content-Type': payload.contentType || 'application/json',
    'Cache-Control': 'public, max-age=15',
    'X-Overpass-Cache': cacheStatus,
    'X-Overpass-Upstream': payload.endpoint || 'unknown',
  });
  res.end(payload.body || '');
}

/**
 * What one mirror's answer means for the rotation: keep it, or try the next.
 *
 * A 4xx is a MIRROR verdict, not a query verdict. overpass-api.de's front-end
 * answers `406 Not Acceptable` to requests its abuse filter dislikes — a plain
 * Apache HTML page, matching neither the rate-limit nor the runtime-error
 * sniffer — and field test 2026-09-01 caught it doing so on the majority of
 * requests carrying the old `…-overpass-proxy/1.0` agent. Accepting that as a
 * terminal answer stopped the rotation dead at mirror 1 and handed the caller a
 * 406, which is exactly what "Sites militaires — Error loading" was: the layer
 * treats `status >= 400` as a failure, while three healthy mirrors sat untried
 * below. The cameras and power-grid probes already rotate on `>= 400`; this is
 * the same rule, and it is why those layers kept working through the same
 * outage.
 *
 * A genuinely malformed query still surfaces: every mirror rejects it, no
 * rate-limit answer exists to outrank it, and the caller gets the 4xx back.
 * @param {{status:number, rateLimited:boolean, runtimeError:boolean}} attempt
 * @returns {'accept'|'rate-limited'|'runtime-error'|'server-error'|'client-error'}
 */
export function overpassAttemptDisposition({ status, rateLimited, runtimeError }) {
  if (rateLimited) return 'rate-limited';
  // A 200 body carrying a runtime error / timeout is a transient upstream
  // failure — skip to the next mirror rather than returning or caching it.
  if (runtimeError) return 'runtime-error';
  if (status >= 500) return 'server-error';
  if (status >= 400) return 'client-error';
  return 'accept';
}

/**
 * Try each Overpass upstream in order until one succeeds.
 *
 * Skips rate-limited, 4xx and 5xx responses and falls through to the next
 * mirror. If all mirrors fail, returns the last rate-limited payload, else the
 * last 4xx payload, else throws the last error.
 *
 * @param {string} body - URL-encoded Overpass QL query body.
 * @param {number} [maxResponseBytes] Endpoint-specific response cap.
 * @param {object} [deps] Injection seam for tests.
 * @param {Array<string>} [deps.endpoints] Mirrors to try, in order.
 * @param {typeof fetch} [deps.fetchImpl] Fetch implementation.
 * @returns {Promise<{status:number,body:string,contentType:string,endpoint:string,rateLimited:boolean}>}
 */
export async function fetchOverpassPayload(
  body,
  maxResponseBytes = OVERPASS_MAX_RESPONSE_BYTES,
  { endpoints = OVERPASS_UPSTREAMS, fetchImpl = fetch } = {},
) {
  let lastError = null;
  let lastRateLimitPayload = null;
  let lastClientErrorPayload = null;

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);

    try {
      const upstream = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': OVERPASS_USER_AGENT,
        },
        body,
        signal: controller.signal,
      });

      const responseBody = await readResponseTextCapped(upstream, maxResponseBytes);
      const contentType = upstream.headers.get('content-type') || 'application/json';
      const status = upstream.status;
      const rateLimited = status === 429 || overpassLooksRateLimited(responseBody);
      const runtimeError = overpassLooksRuntimeError(responseBody);
      const payload = {
        status,
        body: responseBody,
        contentType,
        endpoint,
        rateLimited,
        runtimeError,
      };

      const disposition = overpassAttemptDisposition(payload);
      if (disposition === 'rate-limited') {
        lastRateLimitPayload = payload;
        continue;
      }
      if (disposition === 'runtime-error') {
        lastError = new Error(`Overpass runtime error (${endpoint})`);
        continue;
      }
      if (disposition === 'client-error') {
        lastClientErrorPayload = payload;
        lastError = new Error(`Overpass upstream refused with ${status} (${endpoint})`);
        continue;
      }
      if (disposition === 'server-error') {
        lastError = new Error(`Overpass upstream returned ${status} (${endpoint})`);
        continue;
      }

      // Success: decimate giant boundary geometry before it reaches the cache,
      // the disk, or the client (what makes the 32 MB read cap safe to hold).
      payload.body = simplifyOverpassPayloadBody(payload.body);
      return payload;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Every mirror refused. A rate-limit answer is the most actionable thing the
  // caller can be told; a 4xx is next (it is the only shape that can carry a
  // real query error); a bare throw is the last resort.
  if (lastRateLimitPayload) return lastRateLimitPayload;
  if (lastClientErrorPayload) return lastClientErrorPayload;
  throw lastError || new Error('All Overpass upstreams failed');
}

/**
 * Vite plugin: Overpass API proxy with response caching and request coalescing.
 *
 * Accepts POST requests at /api/overpass, normalizes the query body for
 * cache keying, and fans out to multiple Overpass mirrors with per-upstream
 * timeout and rate-limit detection. Successful responses are cached for
 * OVERPASS_CACHE_MS. Concurrent identical queries share a single upstream
 * request via the in-flight map.
 *
 * @returns {import('vite').Plugin}
 */
function overpassProxy() {
  return {
    name: 'overpass-proxy',
    configureServer(server) {
      server.middlewares.use('/api/overpass', async (req, res) => {
        // Hoisted out of the try so the catch's serve-stale lookup can see it
        // (a body-read failure would otherwise hit an out-of-scope reference).
        let cacheKey = null;
        try {
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method Not Allowed' }));
            return;
          }

          // Collect POST body with a hard byte cap (Overpass QL queries are small)
          let body;
          try {
            body = (await readRequestBodyCapped(req, OVERPASS_MAX_BODY_BYTES)).toString();
          } catch (err) {
            if (err?.code === 'BODY_TOO_LARGE') {
              res.writeHead(413, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Overpass query too large' }));
              return;
            }
            throw err;
          }
          if (!body) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing Overpass query body' }));
            return;
          }

          // Validate + clamp the QL: reject unbounded/global queries and cap the
          // server-side timeout so a tiny body can't request planet-scale work.
          const sanitized = sanitizeOverpassBody(body);
          if (!sanitized.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: sanitized.error }));
            return;
          }
          const safeBody = sanitized.body;

          // Normalize whitespace so semantically identical Overpass QL queries share cache entries
          cacheKey = safeBody.replace(/\s+/g, ' ').trim();
          const preflight = await resolveOverpassPreflight({
            cacheKey,
            memoryCache: _overpassCache,
            inFlight: _overpassInFlight,
            // Fresh-enough disk entries survive restarts and skip the public
            // mirrors; boundary-class queries keep their month-long TTL.
            readDisk: () => readOverpassDisk(cacheKey, overpassDiskTtlMs(cacheKey)),
            allowUpstream: () => _overpassRateLimiter(clientKey(req)),
          });
          if (preflight.source === 'RATE_LIMITED') {
            res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '5' });
            res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
            return;
          }
          if (preflight.source !== 'UPSTREAM') {
            if (preflight.source === 'DISK') {
              _overpassCache.set(cacheKey, preflight.payload);
              trimOverpassCache();
            }
            sendOverpassResponse(res, preflight.payload, preflight.source);
            return;
          }

          // From here onward the request is genuinely upstream-bound and has
          // consumed one local limiter slot. Cache and dedupe hits above do not.
          if (_overpassConcurrent >= OVERPASS_MAX_CONCURRENT) {
            res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '2' });
            res.end(JSON.stringify({ error: 'Overpass proxy busy — try again shortly' }));
            return;
          }
          _overpassConcurrent += 1;
          const requestPromise = fetchOverpassPayload(safeBody)
            .then((payload) => {
              // Cache SUCCESS only. The old `< 500` test admitted 4xx, so a
              // front-end refusal (the 406 above) was written to memory AND to
              // disk under a 7-to-30-day TTL — one bad minute upstream took
              // every Overpass-backed layer down for a month, and re-serving it
              // as a HIT meant the mirrors were never even asked again.
              if (payload.status < 400 && !payload.rateLimited && !payload.runtimeError) {
                const entry = { ...payload, cachedAt: Date.now() };
                _overpassCache.set(cacheKey, entry);
                trimOverpassCache();
                writeOverpassDisk(cacheKey, entry);
              }
              return payload;
            })
            .finally(() => {
              _overpassConcurrent -= 1;
              _overpassInFlight.delete(cacheKey);
            });

          _overpassInFlight.set(cacheKey, requestPromise);
          const payload = await requestPromise;
          // Degraded upstream (rate-limited on every mirror / 4xx / 5xx /
          // runtime error): last-good roads beat an empty layer — serve stale
          // from memory or disk at ANY age before surfacing the failure.
          if (payload.rateLimited || payload.runtimeError || payload.status >= 400) {
            const stale = _overpassCache.get(cacheKey) || await readOverpassDisk(cacheKey, Infinity);
            if (stale) {
              sendOverpassResponse(res, stale, 'STALE');
              return;
            }
          }
          sendOverpassResponse(res, payload, 'MISS');
        } catch (e) {
          // Every mirror threw (network-level). Same serve-stale rule.
          const stale = cacheKey
            ? (_overpassCache.get(cacheKey) || await readOverpassDisk(cacheKey, Infinity).catch(() => null))
            : null;
          if (stale) {
            sendOverpassResponse(res, stale, 'STALE');
            return;
          }
          console.error('[Overpass Proxy]', e.message);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Overpass proxy error' }));
        }
      });

      // Real OSM routing via the public FOSSGIS OSRM servers (foot/car/bike).
      // GET /api/route?profile=foot|car|bike&coords=lon,lat;lon,lat[;...]
      server.middlewares.use('/api/route', async (req, res) => {
        const fail = (msg) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: msg }));
        };
        try {
          if (!_routeRateLimiter(clientKey(req))) {
            res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '5' });
            res.end(JSON.stringify({ ok: false, error: 'rate limited' }));
            return;
          }
          const url = new URL(req.url, 'http://localhost');
          const raw = (url.searchParams.get('profile') || 'foot').toLowerCase();
          const profile = (raw === 'car' || raw === 'driving') ? 'car'
            : (raw === 'bike' || raw === 'cycling' || raw === 'bicycle') ? 'bike'
              : (raw === 'foot' || raw === 'walking' || raw === 'walk') ? 'foot'
                : null;
          if (!profile) return fail('invalid profile');
          const osrmProfile = profile === 'car' ? 'driving' : profile;
          const pairs = (url.searchParams.get('coords') || '').split(';').map((s) => s.trim()).filter(Boolean);
          if (pairs.length < 2 || pairs.length > 12) return fail('need 2-12 coordinates');
          const clean = [];
          const pts = [];
          for (const pr of pairs) {
            const parts = pr.split(',');
            if (parts.length !== 2) return fail('invalid coordinate');
            const lon = Number(parts[0]);
            const lat = Number(parts[1]);
            if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
              return fail('invalid coordinate');
            }
            clean.push(`${lon},${lat}`);
            pts.push([lon, lat]);
          }
          // Reject obviously-abusive spans — a real walking/driving route is local,
          // so a cross-continent request is either a bug or an attempt to drive
          // heavy upstream OSRM work.
          let totalKm = 0;
          for (let i = 1; i < pts.length; i += 1) {
            // pts are [lon, lat]; existing haversineKm takes (lat1, lon1, lat2, lon2).
            const legKm = haversineKm(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
            if (legKm > ROUTE_MAX_LEG_KM) return fail('route leg too long');
            totalKm += legKm;
          }
          if (totalKm > ROUTE_MAX_TOTAL_KM) return fail('route too long');
          const coords = clean.join(';');
          const cacheKey = `${profile}|${coords}`;
          const now = Date.now();
          const cached = _routeCache.get(cacheKey);
          if (cached && now - cached.cachedAt <= ROUTE_CACHE_MS) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(cached.payload));
            return;
          }
          const upstream = `https://routing.openstreetmap.de/routed-${profile}/route/v1/${osrmProfile}/${coords}?overview=full&geometries=geojson&alternatives=false&steps=false`;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 12000);
          let osrm;
          try {
            const upstreamRes = await fetch(upstream, {
              signal: controller.signal,
              headers: { 'User-Agent': 'gods-eye-view/dev (local)' },
            });
            if (!upstreamRes.ok) return fail('no route found');
            const ctype = upstreamRes.headers.get('content-type') || '';
            if (!ctype.includes('json')) return fail('no route found');
            const text = await readResponseTextCapped(upstreamRes, ROUTE_MAX_RESPONSE_BYTES);
            osrm = JSON.parse(text);
          } finally {
            clearTimeout(timer);
          }
          const route = osrm?.routes?.[0];
          if (osrm?.code !== 'Ok' || !route?.geometry?.coordinates?.length) return fail('no route found');
          const payload = {
            ok: true,
            profile,
            distanceM: Math.round(route.distance),
            durationS: Math.round(route.duration),
            geometry: route.geometry.coordinates,
          };
          _routeCache.set(cacheKey, { payload, cachedAt: now });
          if (_routeCache.size > 200) _routeCache.delete(_routeCache.keys().next().value);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload));
        } catch (e) {
          console.error('[Route Proxy]', e?.message || e);
          fail('route proxy error');
        }
      });
    },
  };
}

export function adsbLolFallbackAnchor(req) {
  const incoming = new URL(req?.url || '', 'http://localhost');
  const latitude = requiredFiniteQueryNumber(incoming.searchParams, 'lat');
  const longitude = requiredFiniteQueryNumber(incoming.searchParams, 'lon');
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

async function fetchAdsbLolPointFallback(req) {
  const anchor = adsbLolFallbackAnchor(req);
  if (!anchor) return null;
  const roundedLat = Math.round(anchor.latitude * 4) / 4;
  const roundedLon = Math.round(anchor.longitude * 4) / 4;
  const cacheKey = `${roundedLat.toFixed(2)},${roundedLon.toFixed(2)}`;
  const cached = _adsbLolPointCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.cachedAt < ADSBLOL_POINT_CACHE_MS) {
    return { ...cached, cacheStatus: 'HIT' };
  }

  const request = coalesceProxyRequest(_adsbLolPointInFlight, cacheKey, async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const upstream = await fetch(
        `https://api.adsb.lol/v2/lat/${roundedLat}/lon/${roundedLon}/dist/${ADSBLOL_POINT_RADIUS_NM}`,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'gods-eye-view-adsblol-regional-fallback/1.0',
          },
          signal: controller.signal,
        },
      );
      if (!upstream.ok) throw new Error(`upstream HTTP ${upstream.status}`);
      const payload = await readResponseJsonCapped(upstream, ADSBLOL_POINT_MAX_RESPONSE_BYTES);
      const normalized = normalizeAdsbLolPointResponse(payload);
      const record = {
        body: JSON.stringify(normalized),
        cachedAt: Date.now(),
        count: normalized.states.length,
      };
      _adsbLolPointCache.delete(cacheKey);
      _adsbLolPointCache.set(cacheKey, record);
      while (_adsbLolPointCache.size > ADSBLOL_POINT_CACHE_MAX) {
        _adsbLolPointCache.delete(_adsbLolPointCache.keys().next().value);
      }
      return record;
    } finally {
      clearTimeout(timeoutId);
    }
  });
  try {
    const record = await request.promise;
    return { ...record, cacheStatus: request.shared ? 'INFLIGHT' : 'MISS' };
  } catch (error) {
    if (!request.shared && error?.name !== 'AbortError') {
      console.warn('[adsb.lol Flights Fallback]', error?.message || error);
    }
    return cached ? { ...cached, cacheStatus: 'STALE' } : null;
  }
}

async function serveAdsbLolPointFallback(req, res, requestedMode, reason) {
  const fallback = await fetchAdsbLolPointFallback(req);
  if (!fallback) return false;
  res.writeHead(200, {
    ...buildOpenSkyHeaders({
      cacheStatus: fallback.cacheStatus,
      requestedMode,
      usedMode: 'adsblol-regional',
      reason,
    }),
    'X-Flight-Source': 'adsb.lol',
    'X-Flight-Coverage': `${ADSBLOL_POINT_RADIUS_NM}nm regional fallback`,
    'X-Flight-Count': String(fallback.count),
  });
  res.end(fallback.body);
  return true;
}

function openSkySourceEpochMs(body) {
  try {
    const seconds = Number(JSON.parse(body)?.time);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
  } catch {
    return null;
  }
}

function openSkySourceIsStale(sourceEpochMs, now = Date.now()) {
  return Number.isFinite(sourceEpochMs)
    && now - sourceEpochMs > OPENSKY_SOURCE_STALE_MS;
}

/**
 * Vite plugin: OpenSky Network proxy with multi-mode auth and response caching.
 *
 * Supports four auth modes controlled by OPENSKY_AUTH_MODE env:
 *   - 'oauth'  (default) — client_credentials bearer token
 *   - 'basic'  — HTTP Basic with OPENSKY_USERNAME / OPENSKY_PASSWORD
 *   - 'auto'   — try OAuth first, fall back to Basic, then anon
 *   - 'anon'   — no credentials
 *
 * Successful responses are cached for OPENSKY_CACHE_MS (~9 s). On
 * upstream failure the proxy serves a stale cached response if available, or
 * a bounded 250 nm adsb.lol point snapshot around the current view anchor.
 *
 * @returns {import('vite').Plugin}
 */
function openSkyProxy() {
  return {
    name: 'opensky-proxy',
    configureServer(server) {
      server.middlewares.use('/api/opensky', async (req, res) => {
        try {
          const requestedMode = normalizeOpenSkyAuthMode(process.env.OPENSKY_AUTH_MODE);
          const now = Date.now();
          const inCooldown = now < _openskyCooldownUntil;
          // Fresh-enough cache (adaptive TTL) OR any cache during a 429
          // cooldown: serve it without touching upstream. Stale-during-cooldown
          // is deliberate (credit governor): last-good planes beat a dead layer.
          if (_openskyCacheBody && (now - _openskyCacheTime < _openskyTtlMs || inCooldown)) {
            if (
              openSkySourceIsStale(_openskyCacheSourceEpochMs, now)
              && await serveAdsbLolPointFallback(
                req,
                res,
                requestedMode,
                'opensky_snapshot_stale_regional_fallback',
              )
            ) {
              return;
            }
            const cachedMeta = _openskyCacheMeta || {
              requestedMode,
              usedMode: 'unknown',
              reason: 'cached',
            };
            const isStale = now - _openskyCacheTime >= _openskyTtlMs;
            res.writeHead(
              _openskyCacheStatus || 200,
              buildOpenSkyHeaders({
                cacheStatus: isStale ? 'STALE' : 'HIT',
                requestedMode: cachedMeta.requestedMode || requestedMode,
                usedMode: cachedMeta.usedMode || 'unknown',
                reason: isStale ? 'rate_limited_serving_stale' : (cachedMeta.reason || 'cached'),
                staleSeconds: isStale ? (now - _openskyCacheTime) / 1000 : undefined,
                retryAfterSeconds: inCooldown ? (_openskyCooldownUntil - now) / 1000 : undefined,
              })
            );
            res.end(_openskyCacheBody);
            return;
          }
          // Cooling down with nothing cached (cold start into a rate limit):
          // synthesize the 429 locally — hammering upstream mid-cooldown can't
          // succeed and just burns goodwill.
          if (inCooldown) {
            if (await serveAdsbLolPointFallback(req, res, requestedMode, 'opensky_cooldown_regional_fallback')) return;
            res.writeHead(429, buildOpenSkyHeaders({
              cacheStatus: 'COOLDOWN',
              requestedMode,
              usedMode: 'none',
              reason: 'rate_limited',
              retryAfterSeconds: (_openskyCooldownUntil - now) / 1000,
            }));
            res.end(JSON.stringify({ error: 'OpenSky rate limited; proxy cooling down.' }));
            return;
          }

          const basicUser = process.env.OPENSKY_USERNAME || '';
          const basicPass = process.env.OPENSKY_PASSWORD || '';
          const hasBasicCreds = Boolean(basicUser && basicPass);
          const headers = { 'Accept': 'application/json' };
          let usedMode = 'anon';
          let reason = 'forced_anonymous';

          if (requestedMode === 'basic') {
            if (hasBasicCreds) {
              headers.Authorization = `Basic ${Buffer.from(`${basicUser}:${basicPass}`).toString('base64')}`;
              usedMode = 'basic';
              reason = 'basic_credentials';
            } else {
              reason = 'missing_basic_creds';
            }
          } else if (requestedMode === 'oauth') {
            const token = await getOpenSkyToken();
            if (token) {
              headers.Authorization = `Bearer ${token}`;
              usedMode = 'oauth';
              reason = 'oauth_token';
            } else {
              reason = 'oauth_invalid_or_missing';
            }
          } else if (requestedMode === 'auto') {
            const token = await getOpenSkyToken();
            if (token) {
              headers.Authorization = `Bearer ${token}`;
              usedMode = 'oauth';
              reason = 'oauth_token';
            } else if (hasBasicCreds) {
              headers.Authorization = `Basic ${Buffer.from(`${basicUser}:${basicPass}`).toString('base64')}`;
              usedMode = 'basic';
              reason = 'oauth_unavailable_fallback_basic';
            } else {
              reason = 'missing_oauth_and_basic_creds';
            }
          }

          let upstream = await fetch('https://opensky-network.org/api/states/all?extended=1', { headers });
          // Auto-mode fallback: if OAuth was rejected, retry with Basic credentials
          if (
            (upstream.status === 401 || upstream.status === 403) &&
            requestedMode === 'auto' &&
            usedMode === 'oauth' &&
            hasBasicCreds
          ) {
            const retryHeaders = {
              Accept: 'application/json',
              Authorization: `Basic ${Buffer.from(`${basicUser}:${basicPass}`).toString('base64')}`,
            };
            upstream = await fetch('https://opensky-network.org/api/states/all?extended=1', { headers: retryHeaders });
            usedMode = 'basic';
            reason = 'oauth_rejected_fallback_basic';
          }

          let body = await upstream.text();
          const sourceEpochMs = upstream.ok ? openSkySourceEpochMs(body) : null;
          if (
            upstream.ok
            && openSkySourceIsStale(sourceEpochMs, now)
            && await serveAdsbLolPointFallback(
              req,
              res,
              requestedMode,
              'opensky_snapshot_stale_regional_fallback',
            )
          ) {
            // Keep the last global snapshot available as a fail-soft cache,
            // but do not label or render it as a fresh live result.
            _openskyCacheBody = body;
            _openskyCacheStatus = upstream.status;
            _openskyCacheTime = now;
            _openskyCacheSourceEpochMs = sourceEpochMs;
            _openskyCacheMeta = { requestedMode, usedMode, reason };
            return;
          }
          if (upstream.status === 429) {
            reason = 'rate_limited';
            // Credit governor: honor OpenSky's retry-after (bounded 30 s … 30 min;
            // 2 min when the header is absent) — no upstream attempts until then.
            const retryAfterSec = Number(upstream.headers.get('x-rate-limit-retry-after-seconds'));
            const cooldownMs = Math.min(
              Math.max(Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : 120_000, 30_000),
              30 * 60_000
            );
            _openskyCooldownUntil = now + cooldownMs;
            // Serve the last-good body instead of the 429 when we have one —
            // the layer keeps rendering (STALE-cued) instead of dying.
            if (_openskyCacheBody && _openskyCacheStatus === 200) {
              res.writeHead(200, buildOpenSkyHeaders({
                cacheStatus: 'STALE',
                requestedMode,
                usedMode,
                reason: 'rate_limited_serving_stale',
                staleSeconds: (now - _openskyCacheTime) / 1000,
                retryAfterSeconds: cooldownMs / 1000,
              }));
              res.end(_openskyCacheBody);
              return;
            }
          }

          if (!upstream.ok && !_openskyCacheBody) {
            const servedFallback = await serveAdsbLolPointFallback(
              req,
              res,
              requestedMode,
              `opensky_http_${upstream.status}_regional_fallback`,
            );
            if (servedFallback) return;
          }

          if (upstream.status === 401 || upstream.status === 403) {
            if (requestedMode === 'basic' && !hasBasicCreds) {
              body = JSON.stringify({
                error: 'OpenSky auth missing. Basic mode requires OPENSKY_USERNAME and OPENSKY_PASSWORD.',
              });
              reason = 'missing_basic_creds';
            } else if (requestedMode === 'oauth' && usedMode !== 'oauth') {
              body = JSON.stringify({
                error: 'OpenSky auth invalid. OAuth mode requires valid OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET.',
              });
              reason = 'oauth_invalid_or_missing';
            } else if (usedMode === 'basic') {
              body = JSON.stringify({
                error: 'OpenSky auth invalid. Username/password were rejected.',
              });
              reason = 'basic_invalid_credentials';
            } else if (usedMode === 'oauth') {
              body = JSON.stringify({
                error: 'OpenSky auth invalid. OAuth client credentials were rejected.',
              });
              reason = 'oauth_invalid_credentials';
            } else if (requestedMode === 'auto' && !hasBasicCreds) {
              body = JSON.stringify({
                error: 'OpenSky auth missing. Provide basic credentials or valid OAuth client credentials.',
              });
              reason = 'missing_oauth_and_basic_creds';
            } else {
              body = JSON.stringify({
                error: 'OpenSky auth required.',
              });
              reason = 'auth_required';
            }
          }

          // Refine the reason string to reflect the actual outcome
          if (upstream.ok && reason === 'forced_anonymous') {
            reason = 'anonymous_ok';
          } else if (upstream.ok && usedMode === 'basic' && reason === 'basic_credentials') {
            reason = 'basic_ok';
          } else if (upstream.ok && usedMode === 'oauth' && reason === 'oauth_token') {
            reason = 'oauth_ok';
          }

          // Only cache successful responses — error responses (401/403/429/5xx)
          // should not be served from cache on subsequent requests
          if (upstream.ok) {
            _openskyCacheBody = body;
            _openskyCacheStatus = upstream.status;
            _openskyCacheTime = now;
            _openskyCacheSourceEpochMs = sourceEpochMs;
            _openskyCacheMeta = {
              requestedMode,
              usedMode,
              reason,
            };
            // Credit governor: adapt the cache TTL to the remaining daily
            // budget so a continuously-open app stretches its polls instead of
            // exhausting the quota mid-day. Success also clears any cooldown.
            const remaining = Number(upstream.headers.get('x-rate-limit-remaining'));
            _openskyTtlMs = openskyAdaptiveTtlMs(remaining);
            _openskyCooldownUntil = 0;
          }

          res.writeHead(
            upstream.status,
            buildOpenSkyHeaders({
              cacheStatus: 'MISS',
              requestedMode,
              usedMode,
              reason,
            })
          );
          res.end(body);
        } catch (e) {
          console.error('[OpenSky Proxy]', e.message);
          if (_openskyCacheBody) {
            const cachedMeta = _openskyCacheMeta || {
              requestedMode: normalizeOpenSkyAuthMode(process.env.OPENSKY_AUTH_MODE),
              usedMode: 'unknown',
              reason: 'cached_stale',
            };
            res.writeHead(
              _openskyCacheStatus || 200,
              buildOpenSkyHeaders({
                cacheStatus: 'STALE',
                requestedMode: cachedMeta.requestedMode || OPENSKY_AUTH_MODE_DEFAULT,
                usedMode: cachedMeta.usedMode || 'unknown',
                reason: cachedMeta.reason || 'cached_stale',
              })
            );
            res.end(_openskyCacheBody);
            return;
          }
          const requestedMode = normalizeOpenSkyAuthMode(process.env.OPENSKY_AUTH_MODE);
          if (await serveAdsbLolPointFallback(req, res, requestedMode, 'opensky_proxy_error_regional_fallback')) return;
          res.writeHead(
            502,
            buildOpenSkyHeaders({
              cacheStatus: 'MISS',
              requestedMode,
              usedMode: 'error',
              reason: 'proxy_error',
            })
          );
          res.end(JSON.stringify({ error: 'OpenSky proxy error' }));
        }
      });
    },
  };
}

/**
 * Check whether a hostname is in the GBFS allowlist.
 *
 * Also accepts any subdomain of publicbikesystem.net.
 *
 * @param {string} hostname
 * @returns {boolean}
 */
function isAllowedGbfsHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return false;
  if (GBFS_ALLOWED_HOSTS.has(host)) return true;
  return host.endsWith('.publicbikesystem.net');
}

/**
 * Only allow station_information.json and station_status.json endpoints.
 *
 * @param {string} pathname
 * @returns {boolean}
 */
function isAllowedGbfsPath(pathname) {
  return /\/station_(information|status)\.json$/i.test(String(pathname || ''));
}

/**
 * Return an appropriate Cache-Control header for a GBFS endpoint.
 *
 * station_information is semi-static (5 min cache); station_status is
 * real-time (no-store).
 *
 * @param {string} pathname
 * @returns {string} Cache-Control header value.
 */
function gbfsCacheControl(pathname) {
  if (/\/station_information\.json$/i.test(String(pathname || ''))) {
    return 'public, max-age=300';
  }
  return 'no-store';
}

/**
 * Vite plugin: GBFS bike-share proxy with host allowlisting and size limits.
 *
 * Accepts GET /api/gbfs/<encoded-upstream-URL> and proxies the request
 * to the upstream GBFS provider. Validates hostname against an allowlist,
 * restricts to station_information/station_status paths, enforces HTTPS,
 * and caps response body at 5 MB.
 *
 * @returns {import('vite').Plugin}
 */
function gbfsProxy() {
  return {
    name: 'gbfs-proxy',
    configureServer(server) {
      server.middlewares.use('/api/gbfs', async (req, res) => {
        try {
          if (req.method !== 'GET') {
            res.writeHead(405, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ error: 'Method Not Allowed' }));
            return;
          }

          const url = new URL(req.url || '/', 'http://localhost');
          const encodedTarget = url.pathname.replace(/^\/+/, '');
          if (!encodedTarget) {
            res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ error: 'Missing GBFS upstream target' }));
            return;
          }

          let decodedTarget = '';
          try {
            decodedTarget = decodeURIComponent(encodedTarget);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ error: 'Invalid GBFS target encoding' }));
            return;
          }

          let upstreamUrl = null;
          try {
            upstreamUrl = new URL(decodedTarget);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ error: 'Invalid GBFS upstream URL' }));
            return;
          }

          if (upstreamUrl.protocol !== 'https:') {
            res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ error: 'Only https GBFS targets are allowed' }));
            return;
          }

          if (!isAllowedGbfsHost(upstreamUrl.hostname)) {
            res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ error: 'GBFS host not allowed' }));
            return;
          }

          if (!isAllowedGbfsPath(upstreamUrl.pathname)) {
            res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ error: 'Only station_information/station_status endpoints are allowed' }));
            return;
          }

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), GBFS_PROXY_TIMEOUT_MS);
          let upstream;
          try {
            upstream = await fetch(upstreamUrl.toString(), {
              method: 'GET',
              headers: {
                Accept: 'application/json',
                'User-Agent': 'gods-eye-view-gbfs-proxy/1.0',
              },
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timeoutId);
          }

          // Limit response size to prevent memory exhaustion from malicious upstream
          const GBFS_MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB
          const contentLength = Number(upstream.headers.get('content-length'));
          if (Number.isFinite(contentLength) && contentLength > GBFS_MAX_BODY_BYTES) {
            res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ error: 'GBFS upstream response too large' }));
            return;
          }
          const body = await upstream.text();
          if (body.length > GBFS_MAX_BODY_BYTES) {
            res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ error: 'GBFS upstream response too large' }));
            return;
          }
          const contentType = upstream.headers.get('content-type') || 'application/json';
          res.writeHead(upstream.status, {
            'Content-Type': contentType,
            'Cache-Control': gbfsCacheControl(upstreamUrl.pathname),
            'X-GBFS-Upstream': upstreamUrl.hostname,
            'X-GBFS-Cache': 'MISS',
          });
          res.end(body);
        } catch (error) {
          if (error?.name === 'AbortError') {
            res.writeHead(504, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ error: 'GBFS upstream timeout' }));
            return;
          }
          console.error('[GBFS Proxy]', error?.message || String(error));
          res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'GBFS proxy error' }));
        }
      });
    },
  };
}

// ---------------------------------------------------------------------------
// transport.data.gouv.fr — French GTFS-Realtime vehicle positions, and the
// delays and disruptions published alongside them
// ---------------------------------------------------------------------------
/**
 * Shipped feed index (see `scripts/build-pan-gtfs-rt-index.mjs`). Read once per
 * server, never sent to the browser whole — the client asks for a viewport.
 */
const PAN_INDEX_PATH = path.join(process.cwd(), 'config', 'pan_gtfs_rt_feeds.json');
/**
 * `route_id → route_type` per feed, from `scripts/build-pan-route-types.mjs`.
 *
 * GTFS-Realtime carries no vehicle class, so without this the layer can only
 * colour by the NETWORK's declared service class and Bordeaux's 77 trams, 3
 * river shuttles and 372 buses are one amber swarm. Optional on purpose: a
 * checkout that has never run the builder still serves vehicles, they just
 * arrive with `kindSource: 'network'`.
 */
const PAN_ROUTE_TYPES_PATH = path.join(process.cwd(), 'config', 'pan_route_types.json');
/** Footprints learned at runtime, merged over the shipped ones on next boot. */
const PAN_BOUNDS_PATH = path.join(process.cwd(), '.gev-cache', 'pan-transit-bounds.json');
/**
 * Per-feed body cache. French GTFS-RT feeds republish every 10–60 s, so a
 * shorter TTL would just re-download the same bytes; this is also the shared
 * floor that keeps two overlapping viewports from double-polling a network.
 */
const PAN_FEED_CACHE_MS = 12_000;
/** Per-viewport answer cache; below the client's own poll interval. */
const PAN_VIEWPORT_CACHE_MS = 8_000;
/** A dead feed is not retried on every poll. */
const PAN_FEED_BACKOFF_MS = 90_000;
/** Last-good positions are served this long after a refresh starts failing. */
const PAN_FEED_STALE_MS = 90_000;
const PAN_FEED_TIMEOUT_MS = 9_000;
const PAN_FEED_MAX_BYTES = 8 * 1024 * 1024;
/**
 * Trip-update body cache, ms — shared by the viewport pass and the click.
 *
 * Four times the position cache, and deliberately: a trip update is the
 * operator's PREDICTION, recomputed every 20-60 s and rarely by more than a
 * few seconds; TBM's body is 1.2 MB against 37 KB for its positions, so
 * refreshing it on the position cadence would spend 32x the bandwidth to
 * restate the same "4 min late". A delay 45 s old is still that delay.
 *
 * One window for both surfaces, because they read the same bytes: a click on
 * a bus whose fleet was just enriched answers from the entry that enrichment
 * populated, instead of re-downloading a megabyte the server already has.
 */
const PAN_TRIP_CACHE_MS = 45_000;
/**
 * Alert body cache, ms. An alert is written by a person and lives for hours or
 * days; five minutes is already far finer than the thing it describes changes.
 */
const PAN_ALERT_CACHE_MS = 5 * 60_000;
/**
 * Timeout for one companion body, ms — shorter than the position timeout on
 * purpose. Positions are the layer; delays are an enrichment, and a slow
 * trip-update server must never be able to hold up the fleet behind it.
 */
const PAN_COMPANION_TIMEOUT_MS = 6_000;
/** A companion that just failed is left alone for this long. */
const PAN_COMPANION_BACKOFF_MS = 120_000;
/**
 * Ceiling on one companion body. Trip updates are the largest GTFS-RT bodies
 * a French network publishes — TBM's is 1.2 MB — and the cap is four times the
 * position cap so that an aggregate régional feed has room to grow into it.
 */
const PAN_COMPANION_MAX_BYTES = 32 * 1024 * 1024;
/** Margin kept around the viewport so vehicles enter from off-screen. */
const PAN_VIEWPORT_PAD_DEG = 0.06;
/** How often learned footprints are flushed to disk. */
const PAN_BOUNDS_FLUSH_MS = 30_000;
const PAN_USER_AGENT = 'gods-eye-view/0.1 (+https://github.com/bilawalsidhu/gods-eye-view; transport.data.gouv.fr GTFS-RT client)';

/** @type {?{feeds: Array<Object>, generatedAt: string, source: string}} */
let _panIndex = null;
let _panIndexPromise = null;
/** feedId -> {routes, uniformKind}; empty when the route-type index is absent. */
let _panRouteTypes = new Map();
/**
 * feedId -> {at, vehicles, trips, alerts, error, failedAt}. `trips`/`alerts`
 * are set only for the 63 feeds whose companion IS this body.
 */
const _panFeedCache = new Map();
const _panFeedInFlight = new Map();
/**
 * Companion body cache, keyed `kind:url`.
 *
 * By URL and not by feed id, because a dataset can point several position
 * feeds at one trip-update resource — Astuce's three operator feeds do — and
 * because 63 feeds read their companion out of their OWN body, which never
 * reaches this map at all.
 *
 * @type {Map<string, {at:number, value:Array, error:?string, failedAt:?number}>}
 */
const _panCompanionCache = new Map();
const _panCompanionInFlight = new Map();
/**
 * Cap on cached companion bodies.
 *
 * Lower than it looks: one viewport touches at most
 * {@link PAN_MAX_FEEDS_PER_REQUEST} feeds, and a decoded trip-update body is
 * the biggest thing this proxy holds — TBM's is 900 trips of 36 stops each.
 * The map is kept in least-recently-USED order (a refresh re-inserts its key)
 * so panning across France evicts the city that was left behind, not the one
 * on screen.
 */
const PAN_COMPANION_CACHE_MAX = 32;

function trimPanCompanionCache() {
  while (_panCompanionCache.size > PAN_COMPANION_CACHE_MAX) {
    const oldest = _panCompanionCache.keys().next().value;
    if (oldest === undefined) break;
    _panCompanionCache.delete(oldest);
  }
}
/** viewport key -> {at:number, payload:object} */
const _panViewportCache = new Map();
const _panViewportInFlight = new Map();
let _panBoundsDirty = false;
let _panBoundsFlushedAt = 0;
let _panRotation = 0;
const _panRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 90, globalMax: 240 });

/** Cap on cached viewport answers (each is a few hundred KB at worst). */
const PAN_VIEWPORT_CACHE_MAX = 24;

function trimPanViewportCache() {
  while (_panViewportCache.size > PAN_VIEWPORT_CACHE_MAX) {
    const oldest = _panViewportCache.keys().next().value;
    if (oldest === undefined) break;
    _panViewportCache.delete(oldest);
  }
}

/**
 * Load the shipped index once and fold in any footprints learned on earlier
 * runs. A missing/corrupt bounds file is not an error — it only costs the
 * server the chance to skip a few feeds until it re-learns them.
 */
async function loadPanIndex() {
  if (_panIndex) return _panIndex;
  if (_panIndexPromise) return _panIndexPromise;
  _panIndexPromise = (async () => {
    const raw = JSON.parse(await fsp.readFile(PAN_INDEX_PATH, 'utf8'));
    const feeds = Array.isArray(raw?.feeds) ? raw.feeds : [];
    let learned = {};
    try {
      const disk = JSON.parse(await fsp.readFile(PAN_BOUNDS_PATH, 'utf8'));
      if (disk && typeof disk.bounds === 'object') learned = disk.bounds;
    } catch { /* first run, or a partial write we simply ignore */ }
    for (const feed of feeds) {
      const merged = mergeObservedBounds(feed.bbox, learned[feed.id]);
      if (merged) feed.bbox = merged;
    }
    _panIndex = { ...raw, feeds };

    const { selectable, duplicates, quarantined } = partitionFeedsByHealth(feeds);
    console.log(
      `[PAN Transit] ${feeds.length} GTFS-RT vehicle-position feeds `
      + `(${feeds.filter((feed) => feed.bbox).length} with a footprint, ${selectable.length} queryable — `
      + `${duplicates} duplicate, ${quarantined} quarantined), index built ${raw?.generatedAt || 'unknown'}`,
    );
    const withTrips = feeds.filter((feed) => feed.tripUpdates?.url).length;
    const shared = feeds.filter((feed) => feed.tripUpdates?.sameResource).length;
    console.log(
      `[PAN Transit] schedule companions: ${withTrips} feeds carry trip updates `
      + `(${shared} in the same body, so free), ${feeds.filter((feed) => feed.alerts?.url).length} carry alerts`,
    );

    await loadPanRouteTypes();
    return _panIndex;
  })().catch((error) => {
    _panIndexPromise = null;
    throw error;
  });
  return _panIndexPromise;
}

/**
 * Load the route-type index, if the builder has ever been run here.
 *
 * Absence is a normal state, not an error: `npm run transit:route-types` is a
 * network-bound build step, and a clone that has not run it must still serve
 * live vehicles. It loses only the vehicle CLASS, and every wire record says
 * so through `kindSource`.
 */
async function loadPanRouteTypes() {
  try {
    const raw = JSON.parse(await fsp.readFile(PAN_ROUTE_TYPES_PATH, 'utf8'));
    _panRouteTypes = new Map(Object.entries(raw?.feeds || {}));
    const typed = [..._panRouteTypes.values()].filter((entry) => entry?.uniformKind).length;
    console.log(
      `[PAN Transit] route types for ${_panRouteTypes.size} feeds `
      + `(${raw?.routeCount || 0} routes, ${typed} single-class networks), built ${raw?.generatedAt || 'unknown'}`,
    );
  } catch {
    _panRouteTypes = new Map();
    console.log(
      '[PAN Transit] no route-type index — vehicles will report their network\'s '
      + 'service class instead of a vehicle type. Run `npm run transit:route-types`.',
    );
  }
}

/** Persist learned footprints, at most once per PAN_BOUNDS_FLUSH_MS. */
async function flushPanBounds(force = false) {
  if (!_panBoundsDirty || !_panIndex) return;
  const now = Date.now();
  if (!force && now - _panBoundsFlushedAt < PAN_BOUNDS_FLUSH_MS) return;
  _panBoundsDirty = false;
  _panBoundsFlushedAt = now;
  const bounds = {};
  for (const feed of _panIndex.feeds) {
    if (feed.bbox) bounds[feed.id] = feed.bbox;
  }
  const temp = `${PAN_BOUNDS_PATH}.${process.pid}.tmp`;
  try {
    await fsp.mkdir(path.dirname(PAN_BOUNDS_PATH), { recursive: true });
    await fsp.writeFile(temp, JSON.stringify({ updatedAt: new Date(now).toISOString(), bounds }));
    await fsp.rename(temp, PAN_BOUNDS_PATH);
  } catch (error) {
    console.warn('[PAN Transit] bounds cache write failed:', error?.message || error);
    await fsp.rm(temp, { force: true }).catch(() => {});
  }
}

/**
 * Fetch and decode ONE feed, with a shared body cache, a failure backoff and a
 * bounded serve-stale window.
 *
 * @param {Object} feed Index entry.
 * @returns {Promise<{vehicles: Array<Object>, at: number, error: ?string, stale: boolean}>}
 */
async function panFeedVehicles(feed) {
  const now = Date.now();
  const cached = _panFeedCache.get(feed.id);
  if (cached && now - cached.at <= PAN_FEED_CACHE_MS) {
    return {
      vehicles: cached.vehicles, trips: cached.trips, alerts: cached.alerts,
      at: cached.at, error: cached.error, stale: false,
    };
  }
  // A feed that just failed is left alone; its last-good fixes keep serving
  // until they age out, then it reports empty with the reason attached.
  if (cached?.failedAt && now - cached.failedAt < PAN_FEED_BACKOFF_MS) {
    const stale = now - cached.at <= PAN_FEED_STALE_MS;
    return {
      vehicles: stale ? cached.vehicles : [],
      trips: stale ? cached.trips : null,
      alerts: stale ? cached.alerts : null,
      at: cached.at,
      error: cached.error,
      stale: stale && cached.vehicles.length > 0,
    };
  }

  const request = coalesceProxyRequest(_panFeedInFlight, feed.id, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PAN_FEED_TIMEOUT_MS);
    try {
      const response = await fetch(feed.url, {
        headers: {
          Accept: 'application/x-protobuf,application/octet-stream;q=0.9,*/*;q=0.8',
          'User-Agent': PAN_USER_AGENT,
        },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > PAN_FEED_MAX_BYTES) {
        throw new Error('feed body too large');
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > PAN_FEED_MAX_BYTES) throw new Error('feed body too large');
      const { vehicles } = vehiclePositionsFromBytes(bytes, { feedId: feed.id });
      // 63 of the 150 feeds publish positions, predictions and alerts as one
      // `FeedMessage` under one resource id. For those the delay of every bus
      // on screen is already in hand — the same bytes read a second way, at no
      // extra request. `sameResource` was measured by the index builder.
      const trips = feed.tripUpdates?.sameResource ? tripUpdatesFromBytes(bytes).trips : null;
      const alerts = feed.alerts?.sameResource ? alertsFromBytes(bytes).alerts : null;
      // Learn the footprint from what actually arrived. Bounds only grow, and
      // junk fixes are fenced out before they can widen a city into a country.
      const observed = boundsOfVehicles(vehicles, { rejectOutliers: true });
      const merged = mergeObservedBounds(feed.bbox, observed);
      if (merged && JSON.stringify(merged) !== JSON.stringify(feed.bbox)) {
        feed.bbox = merged;
        _panBoundsDirty = true;
      }
      const entry = { at: Date.now(), vehicles, trips, alerts, error: null, failedAt: null };
      _panFeedCache.set(feed.id, entry);
      return {
        vehicles: entry.vehicles, trips: entry.trips, alerts: entry.alerts,
        at: entry.at, error: null, stale: false,
      };
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'timeout' : (error?.message || String(error));
      const previous = _panFeedCache.get(feed.id);
      const keepStale = previous && Date.now() - previous.at <= PAN_FEED_STALE_MS;
      const entry = {
        at: keepStale ? previous.at : Date.now(),
        vehicles: keepStale ? previous.vehicles : [],
        trips: keepStale ? previous.trips : null,
        alerts: keepStale ? previous.alerts : null,
        error: message,
        failedAt: Date.now(),
      };
      _panFeedCache.set(feed.id, entry);
      return {
        vehicles: entry.vehicles,
        trips: entry.trips,
        alerts: entry.alerts,
        at: entry.at,
        error: message,
        stale: keepStale && entry.vehicles.length > 0,
      };
    } finally {
      clearTimeout(timer);
    }
  });
  return request.promise;
}

/**
 * Fetch and decode ONE companion body — a network's trip updates or its alerts.
 *
 * Keyed by URL rather than by feed so a resource shared by several position
 * feeds is downloaded once, and given a cache window of its own because the
 * two answer questions that change at different speeds (see
 * {@link PAN_TRIP_CACHE_MS} and {@link PAN_ALERT_CACHE_MS}).
 *
 * Never throws and never serves stale: a failure returns an empty list with
 * the reason attached, and the vehicles simply arrive without a delay on them.
 * The enrichment is allowed to be absent; the fleet is not.
 *
 * @param {string} url Companion resource URL.
 * @param {'trips'|'alerts'} kind Which decoder to run.
 * @param {number} cacheMs Freshness window for this kind.
 * @returns {Promise<{value: Array<Object>, at: number, error: ?string}>}
 */
async function panCompanionBody(url, kind, cacheMs) {
  const key = `${kind}:${url}`;
  const now = Date.now();
  const cached = _panCompanionCache.get(key);
  if (cached && now - cached.at <= cacheMs) {
    // Re-insert to mark it as the most recently used; Map preserves insertion
    // order and a plain `get` does not move it.
    _panCompanionCache.delete(key);
    _panCompanionCache.set(key, cached);
    return { value: cached.value, at: cached.at, headerMs: cached.headerMs, error: cached.error };
  }
  if (cached?.failedAt && now - cached.failedAt < PAN_COMPANION_BACKOFF_MS) {
    return { value: cached.value || [], at: cached.at, headerMs: cached.headerMs, error: cached.error };
  }

  const request = coalesceProxyRequest(_panCompanionInFlight, key, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PAN_COMPANION_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/x-protobuf,application/octet-stream;q=0.9,*/*;q=0.8',
          'User-Agent': PAN_USER_AGENT,
        },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > PAN_COMPANION_MAX_BYTES) {
        throw new Error('companion body too large');
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > PAN_COMPANION_MAX_BYTES) throw new Error('companion body too large');
      const decoded = kind === 'trips' ? tripUpdatesFromBytes(bytes) : alertsFromBytes(bytes);
      const value = kind === 'trips' ? decoded.trips : decoded.alerts;
      // The publisher's own stamp on the body, which the click endpoint reports
      // beside the stop times so a viewer can see how old the prediction is.
      const entry = {
        at: Date.now(), value, headerMs: decoded.headerTimestampMs || null, error: null, failedAt: null,
      };
      _panCompanionCache.delete(key);
      _panCompanionCache.set(key, entry);
      trimPanCompanionCache();
      return { value: entry.value, at: entry.at, headerMs: entry.headerMs, error: null };
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'timeout' : (error?.message || String(error));
      // Keep the last good body rather than blanking it: a prediction 90 s old
      // beats no prediction, and the error travels with it.
      const previous = _panCompanionCache.get(key);
      _panCompanionCache.delete(key);
      _panCompanionCache.set(key, {
        at: previous?.at || Date.now(),
        value: previous?.value || [],
        headerMs: previous?.headerMs || null,
        error: message,
        failedAt: Date.now(),
      });
      trimPanCompanionCache();
      return { value: previous?.value || [], at: previous?.at || Date.now(), headerMs: previous?.headerMs || null, error: message };
    } finally {
      clearTimeout(timer);
    }
  });
  return request.promise;
}

/**
 * The schedule context for one feed: its trips indexed by join key, and its
 * active alerts indexed by what they inform.
 *
 * Reads the companion out of the position body when the index measured them to
 * be the same resource, and otherwise fetches it. Both are optional — a feed
 * with no measured companion, or a companion that failed, yields empty indexes
 * and the vehicles render exactly as they did before this existed.
 *
 * @param {Object} feed Index entry.
 * @param {Object} outcome The result of {@link panFeedVehicles} for this feed.
 * @returns {Promise<Object>} Indexes plus the provenance the summary reports.
 */
async function panFeedSchedule(feed, outcome) {
  const nowMs = Date.now();
  let trips = outcome?.trips || null;
  let tripsError = null;
  if (!trips && feed.tripUpdates?.url) {
    const body = await panCompanionBody(feed.tripUpdates.url, 'trips', PAN_TRIP_CACHE_MS);
    trips = body.value;
    tripsError = body.error;
  }

  let alerts = outcome?.alerts || null;
  let alertsError = null;
  if (!alerts && feed.alerts?.url) {
    const body = await panCompanionBody(feed.alerts.url, 'alerts', PAN_ALERT_CACHE_MS);
    alerts = body.value;
    alertsError = body.error;
  }

  return {
    nowMs,
    tripIndex: trips?.length ? indexTripUpdates(trips) : null,
    tripCount: trips?.length || 0,
    alertIndex: alerts?.length ? indexAlerts(alerts, { nowMs, isActive: alertIsActive }) : null,
    // The count BEFORE the active-period filter, so "12 published, 3 in force"
    // stays sayable rather than collapsing to one number.
    alertsPublished: alerts?.length || 0,
    error: tripsError || alertsError || null,
  };
}

/** Trim a decoded record to the fields the layer renders, dropping empties. */
function panWireVehicle(vehicle, feed, schedule = null) {
  // `mode` is the NETWORK's declared service class (urban, school, …).
  // `kind` is the VEHICLE's class, joined from the network's static GTFS.
  // They answer different questions and both are sent, with the provenance of
  // the second attached so the card never has to guess which it is showing.
  const { kind, source } = resolveVehicleKind(vehicle.routeId, _panRouteTypes.get(feed.id));
  const wire = {
    id: vehicle.id,
    feed: feed.id,
    lat: Number(vehicle.lat.toFixed(5)),
    lon: Number(vehicle.lon.toFixed(5)),
    mode: feed.modes?.[0] || 'urban',
    kindSource: source,
  };
  if (kind) wire.kind = kind;
  if (vehicle.bearing !== null) wire.bearing = Number(vehicle.bearing.toFixed(1));
  if (vehicle.speedMps !== null) wire.speedMps = Number(vehicle.speedMps.toFixed(2));
  if (vehicle.route) wire.route = vehicle.route;
  // The raw ids, alongside the display label: `route` is unwrapped from its
  // NeTEx envelope for reading, and the geometry and trip-stop joins need the
  // key the operator actually published. Both are small and both are the only
  // way a click can ask "which line is this, and where does this run go".
  if (vehicle.routeId) wire.routeId = vehicle.routeId;
  if (vehicle.tripId) wire.tripId = vehicle.tripId;
  // Where the operator says the vehicle is ON its run. This is what makes the
  // approached stop the approached stop, rather than the first one whose
  // predicted time has not yet passed.
  if (Number.isFinite(vehicle.stopSequence)) wire.stopSequence = vehicle.stopSequence;
  if (vehicle.stopId) wire.stopId = vehicle.stopId;
  if (vehicle.label) wire.label = vehicle.label;
  if (vehicle.status) wire.status = vehicle.status;
  if (vehicle.occupancy) wire.occupancy = vehicle.occupancy;
  if (vehicle.timestampMs) wire.timestampMs = vehicle.timestampMs;

  // --- The enrichment -------------------------------------------------------
  // Everything below is a claim from the operator's OWN prediction for the run
  // this vehicle is on, joined HERE and not in the browser: the companion body
  // it is joined against is up to 1.2 MB, and it would have to cross the wire
  // once per client to answer a question that is the same for all of them.
  // Every field is omitted when the feed said nothing; none is defaulted.
  const state = scheduleForVehicle(vehicle, schedule?.tripIndex, { nowMs: schedule?.nowMs });
  if (state) {
    if (Number.isFinite(state.delaySec)) {
      wire.delaySec = state.delaySec;
      wire.delayFrom = state.delayFrom;
    }
    if (state.awaitingDeparture) {
      wire.awaitingDeparture = true;
      if (state.scheduledDepartureMs) wire.scheduledDepartureMs = state.scheduledDepartureMs;
    }
    if (state.tripState) wire.tripState = state.tripState;
    if (state.skippedStops) {
      wire.skippedStops = state.skippedStops;
      wire.skippedAhead = state.skippedAhead;
    }
    if (state.nextStopEtaMs) wire.nextStopEtaMs = state.nextStopEtaMs;
    if (state.matchedBy) wire.tripMatch = state.matchedBy;
  }
  const alert = schedule?.alertIndex ? alertForVehicle(vehicle, schedule.alertIndex) : null;
  if (alert) {
    wire.alert = alertWireRecord(alert.alert, alert.scope);
    if (alert.count > 1) wire.alertCount = alert.count;
  }
  return wire;
}

/** Build one viewport answer: select feeds, fetch them, clip, cap. */
async function refreshPanViewport(box, key) {
  const index = await loadPanIndex();
  const rotation = _panRotation++;
  const selection = selectFeedsForBox(index.feeds, box, { rotation });
  const clip = padTransitBox(box, PAN_VIEWPORT_PAD_DEG);

  const results = await Promise.all(selection.selected.map(async (feed) => {
    const outcome = await panFeedVehicles(feed);
    const inBox = outcome.vehicles.filter((vehicle) => boxContains(clip, vehicle.lat, vehicle.lon));
    // The delay fetch is gated on the box, not on the selection. A feed earns
    // a slot by OVERLAPPING the viewport, which is not the same as having a
    // bus in it — and TBM's trip updates are 1.2 MB, which is not a thing to
    // download because the camera is near Bordeaux.
    const schedule = inBox.length ? await panFeedSchedule(feed, outcome) : null;
    const vehicles = inBox.map((vehicle) => panWireVehicle(vehicle, feed, schedule));
    return { feed, outcome, vehicles, schedule };
  }));

  const vehicles = [];
  const feeds = [];
  let vehiclesTruncated = false;
  for (const { feed, outcome, vehicles: inBox, schedule } of results) {
    for (const vehicle of inBox) {
      if (vehicles.length >= PAN_MAX_VEHICLES) { vehiclesTruncated = true; break; }
      vehicles.push(vehicle);
    }
    feeds.push({
      id: feed.id,
      network: feed.network,
      area: feed.area,
      modes: feed.modes,
      licence: feed.licenceLabel,
      publisher: feed.publisher,
      pageUrl: feed.pageUrl,
      datasetUrl: feed.datasetUrl,
      inView: inBox.length,
      reported: outcome.vehicles.length,
      retrievedAt: outcome.at ? new Date(outcome.at).toISOString() : null,
      stale: outcome.stale || false,
      error: outcome.error || null,
      // How much of this network's fleet the schedule feed could speak for.
      // `delayed` counts vehicles that got a NUMBER, not vehicles running late.
      trips: schedule?.tripCount || 0,
      delayed: inBox.filter((vehicle) => Number.isFinite(vehicle.delaySec)).length,
      alertsPublished: schedule?.alertsPublished || 0,
      alertsActive: schedule?.alertIndex?.count || 0,
      scheduleError: schedule?.error || null,
    });
  }

  const failed = feeds.filter((feed) => feed.error).length;
  const payload = {
    status: failed && failed === feeds.length && feeds.length > 0 ? 'degraded' : 'ready',
    retrievedAt: new Date().toISOString(),
    box,
    vehicles,
    feeds,
    feedsMatched: selection.matched,
    feedsFetched: feeds.length,
    feedsFailed: failed,
    // Honest truncation flags: more feeds intersect this viewport than were
    // polled, or the vehicle cap cut the answer.
    feedsTruncated: selection.truncated,
    vehiclesTruncated,
    // Punctuality of what is actually being returned, so the layer can say
    // what is happening without every client re-tallying the same array.
    schedule: summarizeSchedule(vehicles),
    indexGeneratedAt: index.generatedAt || null,
  };

  _panViewportCache.set(key, { at: Date.now(), payload });
  trimPanViewportCache();
  void flushPanBounds();
  return payload;
}


// ---------------------------------------------------------------------------
// The line under a vehicle: its trace, and the stops of the run it is on
// ---------------------------------------------------------------------------
/**
 * Companion resources per live feed — the TripUpdates sibling and the PAN's
 * GeoJSON conversion of the static GTFS (see
 * `scripts/build-pan-static-index.mjs`). URLs only; the geometry itself is
 * fetched on demand and cached under `.gev-cache/`.
 */
const PAN_STATIC_INDEX_PATH = path.join(process.cwd(), 'config', 'pan_gtfs_static.json');
const PAN_GEO_CACHE_DIR = path.join(process.cwd(), '.gev-cache', 'pan-gtfs-geo');
/**
 * Ceiling on one conversion body.
 *
 * Measured 2026-08-31 the largest of the 148 is Normandy's aggregate at
 * 68.9 MB and the median is 1.4 MB, so the cap refuses nothing that exists
 * today; it is here so that a publisher who one day serves something
 * pathological gets an error rather than the dev server's heap.
 */
const PAN_GEOJSON_MAX_BYTES = 96 * 1024 * 1024;
const PAN_GEOJSON_TIMEOUT_MS = 45_000;
/**
 * How long an indexed conversion is served from disk before it is re-fetched.
 *
 * French networks republish their static GTFS every few days — Bordeaux's was
 * 26 hours old when this was written — but the shape of a line changes with a
 * timetable, not with a bus. A week is short enough that a re-routed line
 * corrects itself without anyone clearing a cache, and long enough that a
 * fortnight of clicking costs two fetches.
 */
const PAN_GEO_DISK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Indexed networks held in memory. Bordeaux's index is 2.4 MB. */
const PAN_GEO_MEMORY_MAX = 3;

/** @type {?{feeds: Object, generatedAt: string}} */
let _panStaticIndex = null;
let _panStaticIndexPromise = null;
/** feedId -> {index, source, fetchedAt} — insertion-ordered, oldest evicted. */
const _panGeoMemory = new Map();
const _panGeoInFlight = new Map();

/**
 * Load the companion index once. Absent is not fatal: the layer keeps drawing
 * vehicles and only the line panel goes dark, with the build command named.
 */
async function loadPanStaticIndex() {
  if (_panStaticIndex) return _panStaticIndex;
  if (_panStaticIndexPromise) return _panStaticIndexPromise;
  _panStaticIndexPromise = (async () => {
    const raw = JSON.parse(await fsp.readFile(PAN_STATIC_INDEX_PATH, 'utf8'));
    _panStaticIndex = { feeds: raw?.feeds || {}, generatedAt: raw?.generatedAt || null };
    return _panStaticIndex;
  })().finally(() => { _panStaticIndexPromise = null; });
  return _panStaticIndexPromise;
}

/**
 * The static resource whose conversion should be tried for a feed.
 *
 * Same rule as the builder's: a conversion that answered the build-time probe
 * wins, then one that was never probed; a conversion known dead is skipped
 * rather than fetched to rediscover that it is dead.
 */
function panGeoResource(entry) {
  const statics = Array.isArray(entry?.statics) ? entry.statics : [];
  const usable = statics.filter((resource) => resource?.geojson?.url);
  return usable.find((resource) => resource.geojson.reachable === true)
    || usable.find((resource) => resource.geojson.reachable !== false)
    || null;
}

/** Disk path for one network's indexed geometry. */
function panGeoCachePath(feedId) {
  return path.join(PAN_GEO_CACHE_DIR, `${String(feedId).replace(/[^\w.-]/g, '_')}.json`);
}

/** Keep the newest {@link PAN_GEO_MEMORY_MAX} networks resident. */
function trimPanGeoMemory() {
  while (_panGeoMemory.size > PAN_GEO_MEMORY_MAX) {
    const oldest = _panGeoMemory.keys().next().value;
    if (oldest === undefined) break;
    _panGeoMemory.delete(oldest);
  }
}

/**
 * One network's line geometry, indexed: memory, then disk, then the PAN.
 *
 * The network fetch is the expensive one — 13 MB and ~0.7 s for Bordeaux, of
 * which 0.2 s is parsing and indexing — and it happens at most once a week per
 * network per checkout. Concurrent clicks on two buses of the same network
 * share one fetch.
 *
 * @param {string} feedId
 * @param {Object} entry Companion-index entry for the feed.
 * @returns {Promise<{index: Object, source: Object, fetchedAt: number}>}
 */
async function panRouteGeometry(feedId, entry) {
  const resident = _panGeoMemory.get(feedId);
  if (resident) return resident;

  const resource = panGeoResource(entry);
  if (!resource) {
    const error = new Error('this network publishes no converted line geometry');
    error.code = 'NO_GEOMETRY';
    throw error;
  }

  const request = coalesceProxyRequest(_panGeoInFlight, feedId, async () => {
    const cachePath = panGeoCachePath(feedId);
    try {
      const cached = JSON.parse(await fsp.readFile(cachePath, 'utf8'));
      const fresh = Date.now() - Number(cached.fetchedAt || 0) < PAN_GEO_DISK_TTL_MS;
      // The conversion timestamp is the PAN's own statement about the archive
      // behind it: a cache built from an older conversion is rebuilt even when
      // it is inside the TTL.
      const sameConversion = (cached.source?.checkedAt || null) === (resource.geojson.checkedAt || null);
      if (fresh && sameConversion && cached.index?.routes && cached.index?.stops) {
        const record = { index: cached.index, source: cached.source, fetchedAt: cached.fetchedAt };
        _panGeoMemory.set(feedId, record);
        trimPanGeoMemory();
        return record;
      }
    } catch { /* no usable cache — fetch it */ }

    const startedAt = Date.now();
    const response = await fetch(resource.geojson.url, {
      // `Accept: */*` deliberately. The conversion URL is a redirect the PAN
      // serves from its own application, and asking it for
      // `application/geo+json` makes it answer HTTP 500 — measured against
      // resource 83024 on 2026-08-31, where the same request with `*/*`
      // returns the file.
      headers: { Accept: '*/*', 'User-Agent': PAN_USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(PAN_GEOJSON_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`conversion HTTP ${response.status}`);
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > PAN_GEOJSON_MAX_BYTES) {
      await response.arrayBuffer().catch(() => {});
      throw new Error('converted geometry exceeds the size cap');
    }
    const document = await readResponseJsonCapped(response, PAN_GEOJSON_MAX_BYTES);
    const index = indexGtfsGeoJson(document);
    const source = {
      url: resource.geojson.url,
      resourceId: resource.resourceId,
      pageUrl: resource.pageUrl || null,
      declared: resource.geojson.declared === true,
      checkedAt: resource.geojson.checkedAt || null,
      bytes: Number.isFinite(resource.geojson.bytes) ? resource.geojson.bytes : null,
    };
    const record = { index, source, fetchedAt: Date.now() };
    console.log(
      `[PAN Transit] ${feedId} line geometry — ${index.stats.routeCount} routes, `
      + `${index.stats.shapeCount} traces, ${index.stats.stopCount} stops, `
      + `${index.stats.rawPoints} points kept as ${index.stats.keptPoints} in ${Date.now() - startedAt} ms`,
    );

    _panGeoMemory.set(feedId, record);
    trimPanGeoMemory();
    try {
      await fsp.mkdir(PAN_GEO_CACHE_DIR, { recursive: true });
      await fsp.writeFile(cachePath, JSON.stringify(record), 'utf8');
    } catch (error) {
      // A cache that cannot be written costs a re-fetch, nothing else.
      console.warn('[PAN Transit] geometry cache write failed:', error?.message || error);
    }
    return record;
  });
  return request.promise;
}

/**
 * One network's live trip updates, keyed by `trip_id`.
 *
 * The body is fetched by {@link panCompanionBody}, which is also what the
 * VIEWPORT pass uses to put a delay on every vehicle on screen — so a click on
 * a Bordeaux bus normally costs nothing at all: the 1.2 MB its network
 * publishes was already read for the fleet the viewer is looking at, and both
 * surfaces answer from one cache entry.
 *
 * WHICH resource is asked for is the measured one. `pan_gtfs_rt_feeds.json`
 * records the trip-update companion whose trips actually JOIN each feed's own
 * vehicles (see `scripts/build-pan-gtfs-rt-index.mjs`); the companion index's
 * first declared resource is the fallback for a feed that predates that
 * measurement. It matters: Rouen Astuce publishes three position feeds and
 * four trip-update feeds on interleaved ids, and the declared order pairs them
 * wrongly.
 *
 * @param {string} feedId
 * @param {Object} entry Companion-index entry for the feed.
 * @returns {Promise<{byTrip: Map<string, Object>, at: number, headerMs: ?number, error: ?string}>}
 */
async function panTripUpdates(feedId, entry) {
  let measured = null;
  try {
    const index = await loadPanIndex();
    measured = index.feeds.find((feed) => feed.id === feedId)?.tripUpdates?.url || null;
  } catch { /* the live index is optional here; the companion index answers */ }
  const url = measured || (Array.isArray(entry?.tripUpdates) ? entry.tripUpdates : [])[0]?.url;
  if (!url) {
    return { byTrip: new Map(), at: Date.now(), headerMs: null, error: 'no trip-update feed published' };
  }

  const body = await panCompanionBody(url, 'trips', PAN_TRIP_CACHE_MS);
  const byTrip = new Map();
  for (const trip of body.value) byTrip.set(trip.tripId, trip);
  return { byTrip, at: body.at, headerMs: body.headerMs || null, error: body.error };
}

/**
 * Build the answer for one click: the line, its trace, and the ordered stops
 * of the run the vehicle is on.
 *
 * The three come from three different places and each is reported with its
 * own provenance, because a viewer is entitled to know that the trace is
 * yesterday's timetable and the stop times are ninety seconds old:
 *
 *   - the LINE and its TRACE from the network's static GTFS, via the PAN's
 *     GeoJSON conversion of it;
 *   - the STOPS of this run, in order, from the live TripUpdates feed;
 *   - each stop's POSITION from the same conversion, joined on `stop_id`.
 *
 * @param {Object} params
 * @returns {Promise<Object>} Wire document for `/api/transit-fr/trip`.
 */
async function buildPanTripAnswer({ feedId, tripId, routeId }) {
  const index = await loadPanStaticIndex();
  const entry = index.feeds?.[feedId];
  if (!entry) {
    const error = new Error('unknown transit feed');
    error.code = 'UNKNOWN_FEED';
    throw error;
  }

  const notes = [];
  const [geometry, updates] = await Promise.all([
    panRouteGeometry(feedId, entry).catch((error) => {
      notes.push(error?.code === 'NO_GEOMETRY'
        ? 'This network publishes no converted line geometry, so no trace is drawn.'
        : `Line geometry unavailable: ${error?.message || error}`);
      return null;
    }),
    tripId
      ? panTripUpdates(feedId, entry)
      : Promise.resolve({ byTrip: new Map(), at: Date.now(), headerMs: null, error: null }),
  ]);

  const trip = tripId ? geometryTripUpdate(updates, tripId) : null;
  if (tripId && !trip) {
    notes.push(updates.error
      ? `The network's trip-update feed is unavailable (${updates.error}), so this run's stops are not listed.`
      : 'The trip-update feed does not carry this run, so its stops are not listed.');
  }

  // The vehicle's own route id wins; a trip update that carries one is only
  // the fallback, because the two come from the same operator and the vehicle
  // feed is the one the contact on screen was drawn from.
  const resolvedRouteId = routeId || trip?.routeId || null;
  const route = resolvedRouteId ? geometry?.index.routes?.[resolvedRouteId] || null : null;
  if (resolvedRouteId && geometry && !route) {
    notes.push(`The static feed publishes no route "${resolvedRouteId}", so no trace is drawn.`);
  }

  const stops = [];
  let unlocated = 0;
  for (const stop of trip?.stops || []) {
    const point = stop.stopId ? geometry?.index.stops?.[stop.stopId] : null;
    if (!point) {
      unlocated += 1;
      continue;
    }
    stops.push({
      id: stop.stopId,
      name: point[2] || stop.stopId,
      code: point[3] || null,
      lon: point[0],
      lat: point[1],
      sequence: stop.sequence,
      arrivalMs: stop.arrivalMs,
      departureMs: stop.departureMs,
      delaySec: stop.delaySec,
      relationship: stop.relationship,
    });
  }
  if (unlocated) {
    notes.push(`${unlocated} stop${unlocated === 1 ? '' : 's'} of this run `
      + `${unlocated === 1 ? 'is' : 'are'} not in the static feed and cannot be placed.`);
  }

  // Which of the line's traces this run is on, decided against this run's own
  // stops. With no stops there is no evidence, so every variant is returned
  // and the answer says so.
  const variants = route?.shapes || [];
  const match = stops.length
    ? chooseTripShape(variants, stops.map((stop) => [stop.lon, stop.lat]))
    : { index: null, maxDeviationM: null, medianDeviationM: null };
  const shapes = match.index === null ? variants : [variants[match.index]];
  if (variants.length > 1 && match.index === null && stops.length) {
    notes.push(`None of the ${variants.length} published traces for this line holds every `
      + 'stop of this run, so the whole line is drawn rather than one run of it.');
  }

  return {
    status: 'ready',
    feed: feedId,
    network: entry.network || null,
    licence: entry.licenceLabel || null,
    datasetUrl: entry.datasetUrl || null,
    route: route
      ? {
        id: resolvedRouteId,
        shortName: route.shortName,
        longName: route.longName,
        color: route.color,
        textColor: route.textColor,
        variantCount: variants.length,
      }
      : (resolvedRouteId ? { id: resolvedRouteId, shortName: null, longName: null, color: null, textColor: null, variantCount: 0 } : null),
    shapes,
    shapeLengthM: shapes.length === 1 ? Math.round(pathLengthMeters(shapes[0])) : null,
    shapeMatch: {
      matched: match.index !== null,
      variants: variants.length,
      maxDeviationM: match.maxDeviationM,
      medianDeviationM: match.medianDeviationM,
    },
    trip: trip
      ? {
        id: trip.tripId,
        headsign: trip.vehicleLabel,
        directionId: trip.directionId,
        startDate: trip.startDate,
        startTime: trip.startTime,
        delaySec: trip.delaySec,
        timestampMs: trip.timestampMs,
      }
      : (tripId ? { id: tripId, headsign: null, directionId: null, startDate: null, startTime: null, delaySec: null, timestampMs: null } : null),
    stops,
    stopsSource: stops.length ? 'trip_updates' : 'none',
    stopsReported: trip?.stops?.length || 0,
    tripUpdatesAt: updates.headerMs || updates.at || null,
    geometry: geometry
      ? { ...geometry.source, fetchedAt: new Date(geometry.fetchedAt).toISOString() }
      : null,
    notes,
    retrievedAt: new Date().toISOString(),
  };
}

/** The trip a click asked about, or null when the feed is not carrying it. */
function geometryTripUpdate(updates, tripId) {
  return updates?.byTrip?.get(String(tripId)) || null;
}

/**
 * Vite plugin: viewport-bounded French real-time transit proxy.
 *
 *   GET /api/transit-fr/feeds                          — index summary
 *   GET /api/transit-fr/vehicles?south&west&north&east — live positions in box,
 *       each carrying the operator's own delay and disruption for the run it
 *       is on
 *   GET /api/transit-fr/trip?feed&trip&route           — one vehicle's line:
 *       its trace, the ordered stops of the run it is on, and when the
 *       operator expects it at each of them
 *
 * The browser never talks to transport.data.gouv.fr directly, for three
 * reasons: the feeds are Protocol Buffers (decoded here, so the client bundle
 * gains no protobuf dependency), most publishers send no CORS header, and one
 * viewport can touch a dozen networks whose bodies are worth sharing across
 * clients and across overlapping viewports rather than re-fetching per tab.
 *
 * Every feed is public and keyless under Licence Ouverte 2.0 or ODbL 1.0, as
 * declared per dataset in the catalog and carried through to the client.
 *
 * @returns {import('vite').Plugin}
 */
function panTransitProxy() {
  function install(middlewares) {
    middlewares.use('/api/transit-fr', async (req, res) => {
      const json = (status, body, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'GET') {
        json(405, { error: 'Method Not Allowed' });
        return;
      }
      if (!_panRateLimiter(clientKey(req))) {
        json(429, { error: 'Rate limit exceeded' }, { 'Retry-After': '5' });
        return;
      }

      const url = new URL(req.url || '/', 'http://localhost');
      const route = url.pathname.replace(/\/+$/, '') || '/';

      let index;
      try {
        index = await loadPanIndex();
      } catch (error) {
        console.warn('[PAN Transit] feed index unavailable:', error?.message || error);
        json(503, {
          error: 'French transit feed index is missing — run `node scripts/build-pan-gtfs-rt-index.mjs`',
          missingIndex: true,
        });
        return;
      }

      if (route === '/feeds') {
        // Licences are counted over the QUERYABLE set: a licence that only
        // appears on a quarantined duplicate is not a licence this proxy is
        // serving anyone under.
        const { selectable, duplicates, quarantined } = partitionFeedsByHealth(index.feeds);
        const licences = {};
        for (const feed of selectable) {
          const label = feed.licenceLabel || 'Licence non précisée';
          licences[label] = (licences[label] || 0) + 1;
        }
        json(200, {
          source: index.source || PAN_DATASETS_URL,
          generatedAt: index.generatedAt || null,
          feedCount: index.feeds.length,
          feedsWithBounds: index.feeds.filter((feed) => feed.bbox).length,
          // Which of the queryable feeds can answer "how late is this bus",
          // and how many of those cost no second request to ask.
          feedsWithTripUpdates: selectable.filter((feed) => feed.tripUpdates?.url).length,
          feedsWithAlerts: selectable.filter((feed) => feed.alerts?.url).length,
          feedsSharingOneBody: selectable.filter((feed) => feed.tripUpdates?.sameResource).length,
          // Shipped ≠ queryable, and the difference is named rather than hidden.
          feedsQueryable: selectable.length,
          feedsDuplicate: duplicates,
          feedsQuarantined: quarantined,
          licences,
          maxBoxDeg: PAN_MAX_BOX_DEG,
          maxFeedsPerRequest: PAN_MAX_FEEDS_PER_REQUEST,
        }, { 'Cache-Control': 'public, max-age=300' });
        return;
      }

      if (route === '/trip') {
        // What line is this, where does it go, and which stops does this run
        // serve. Three sources, one answer — see `buildPanTripAnswer`.
        const feedId = String(url.searchParams.get('feed') || '').trim();
        const tripId = String(url.searchParams.get('trip') || '').trim();
        const routeId = String(url.searchParams.get('route') || '').trim();
        if (!feedId || (!tripId && !routeId)) {
          json(400, { error: 'A feed id and at least one of trip / route is required' });
          return;
        }
        try {
          const payload = await buildPanTripAnswer({
            feedId,
            tripId: tripId || null,
            routeId: routeId || null,
          });
          json(200, payload);
        } catch (error) {
          if (error?.code === 'UNKNOWN_FEED') {
            json(404, { error: 'Unknown transit feed' });
            return;
          }
          if (error?.code === 'ENOENT' || /pan_gtfs_static/.test(error?.message || '')) {
            json(503, {
              error: 'The line-geometry index is missing — run `node scripts/build-pan-static-index.mjs`',
              missingIndex: true,
            });
            return;
          }
          console.warn('[PAN Transit] line unavailable:', error?.message || error);
          json(503, { error: 'Line geometry is temporarily unavailable' });
        }
        return;
      }

      if (route !== '/vehicles') {
        json(404, { error: 'Unknown transit endpoint' });
        return;
      }

      const requested = validTransitBox({
        south: url.searchParams.get('south'),
        west: url.searchParams.get('west'),
        north: url.searchParams.get('north'),
        east: url.searchParams.get('east'),
      });
      if (!requested) {
        json(400, {
          error: `A non-dateline bbox no larger than ${PAN_MAX_BOX_DEG} degrees is required`,
          maxBoxDeg: PAN_MAX_BOX_DEG,
        });
        return;
      }

      // Query the SNAPPED box so neighbouring viewports share one cache entry;
      // the snap only ever grows, so a hit always covers what was asked for.
      const box = snapTransitBox(requested);
      const key = transitBoxKey(box);
      const now = Date.now();
      const cached = _panViewportCache.get(key);
      if (cached && now - cached.at <= PAN_VIEWPORT_CACHE_MS) {
        json(200, { ...cached.payload, status: 'cached' }, { 'X-Transit-FR': 'HIT' });
        return;
      }

      const request = coalesceProxyRequest(_panViewportInFlight, key, () => refreshPanViewport(box, key));
      try {
        const payload = await request.promise;
        json(200, payload, { 'X-Transit-FR': request.shared ? 'INFLIGHT' : 'MISS' });
      } catch (error) {
        console.warn('[PAN Transit] viewport unavailable:', error?.message || error);
        if (cached) {
          json(200, { ...cached.payload, status: 'stale' }, { 'X-Transit-FR': 'STALE' });
          return;
        }
        json(503, { error: 'Live French transit positions are temporarily unavailable' });
      }
    });
  }

  return {
    name: 'pan-transit-proxy',
    configureServer(server) {
      install(server.middlewares);
      server.httpServer?.on('close', () => { void flushPanBounds(true); });
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

// ---------------------------------------------------------------------------
// transport.data.gouv.fr — French shared mobility (GBFS)
// ---------------------------------------------------------------------------
/** Shipped system index (see `scripts/build-gbfs-fr-index.mjs`). */
const GBFS_FR_INDEX_PATH = path.join(process.cwd(), 'config', 'gbfs_fr_systems.json');
/** Footprints learned at runtime, merged over the shipped ones on next boot. */
const GBFS_FR_BOUNDS_PATH = path.join(process.cwd(), '.gev-cache', 'gbfs-fr-bounds.json');
/**
 * Per-feed body cache. GBFS declares its own `ttl`, but the spec's own ceiling
 * for a near-realtime endpoint is 5 minutes and several French systems sit at
 * 8-15 minutes anyway, so a 30 s floor costs freshness nobody actually has.
 */
const GBFS_FR_STATUS_CACHE_MS = 30_000;
/** Station POSITIONS barely move; their availability is what changes. */
const GBFS_FR_INFO_CACHE_MS = 6 * 60 * 60 * 1000;
const GBFS_FR_VIEWPORT_CACHE_MS = 15_000;
const GBFS_FR_BACKOFF_MS = 120_000;
const GBFS_FR_STALE_MS = 10 * 60 * 1000;
const GBFS_FR_TIMEOUT_MS = 10_000;
const GBFS_FR_MAX_BYTES = 24 * 1024 * 1024;
const GBFS_FR_VIEWPORT_PAD_DEG = 0.03;
const GBFS_FR_BOUNDS_FLUSH_MS = 60_000;
const GBFS_FR_USER_AGENT = 'gods-eye-view/0.1 (+https://github.com/bilawalsidhu/gods-eye-view; transport.data.gouv.fr GBFS client)';
const GBFS_FR_VIEWPORT_CACHE_MAX = 24;

let _gbfsFrIndex = null;
let _gbfsFrIndexPromise = null;
/** feed url -> {at:number, value:*, failedAt:?number, error:?string} */
const _gbfsFrFeedCache = new Map();
const _gbfsFrFeedInFlight = new Map();
const _gbfsFrViewportCache = new Map();
const _gbfsFrViewportInFlight = new Map();
let _gbfsFrBoundsDirty = false;
let _gbfsFrBoundsFlushedAt = 0;
const _gbfsFrRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 90, globalMax: 240 });

function trimGbfsFrViewportCache() {
  while (_gbfsFrViewportCache.size > GBFS_FR_VIEWPORT_CACHE_MAX) {
    const oldest = _gbfsFrViewportCache.keys().next().value;
    if (oldest === undefined) break;
    _gbfsFrViewportCache.delete(oldest);
  }
}

/** Load the shipped index once and fold in footprints learned on earlier runs. */
async function loadGbfsFrIndex() {
  if (_gbfsFrIndex) return _gbfsFrIndex;
  if (_gbfsFrIndexPromise) return _gbfsFrIndexPromise;
  _gbfsFrIndexPromise = (async () => {
    const raw = JSON.parse(await fsp.readFile(GBFS_FR_INDEX_PATH, 'utf8'));
    const systems = Array.isArray(raw?.systems) ? raw.systems : [];
    let learned = {};
    try {
      const disk = JSON.parse(await fsp.readFile(GBFS_FR_BOUNDS_PATH, 'utf8'));
      if (disk && typeof disk.bounds === 'object') learned = disk.bounds;
    } catch { /* first run */ }
    for (const system of systems) {
      const merged = mergeGbfsBounds(system.bbox, learned[system.id]);
      if (merged) system.bbox = merged;
    }
    _gbfsFrIndex = { ...raw, systems };
    const live = systems.filter((s) => !s.redundant && !s.probeError);
    console.log(
      `[GBFS FR] ${raw.catalogResourceCount ?? systems.length} catalog resources → ${live.length} distinct systems `
      + `(${systems.filter((s) => s.redundant).length} redundant, ${systems.filter((s) => s.probeError).length} unreachable), `
      + `index built ${raw?.generatedAt || 'unknown'}`,
    );
    return _gbfsFrIndex;
  })().catch((error) => {
    _gbfsFrIndexPromise = null;
    throw error;
  });
  return _gbfsFrIndexPromise;
}

async function flushGbfsFrBounds(force = false) {
  if (!_gbfsFrBoundsDirty || !_gbfsFrIndex) return;
  const now = Date.now();
  if (!force && now - _gbfsFrBoundsFlushedAt < GBFS_FR_BOUNDS_FLUSH_MS) return;
  _gbfsFrBoundsDirty = false;
  _gbfsFrBoundsFlushedAt = now;
  const bounds = {};
  for (const system of _gbfsFrIndex.systems) if (system.bbox) bounds[system.id] = system.bbox;
  const temp = `${GBFS_FR_BOUNDS_PATH}.${process.pid}.tmp`;
  try {
    await fsp.mkdir(path.dirname(GBFS_FR_BOUNDS_PATH), { recursive: true });
    await fsp.writeFile(temp, JSON.stringify({ updatedAt: new Date(now).toISOString(), bounds }));
    await fsp.rename(temp, GBFS_FR_BOUNDS_PATH);
  } catch (error) {
    console.warn('[GBFS FR] bounds cache write failed:', error?.message || error);
    await fsp.rm(temp, { force: true }).catch(() => {});
  }
}

/**
 * Fetch and parse ONE GBFS feed file, with a shared cache, a failure backoff
 * and a bounded serve-stale window.
 *
 * @param {string} url Resolved feed URL.
 * @param {number} ttlMs How long a good answer stays fresh.
 * @param {(payload:*) => *} parse Pure parser applied to the JSON body.
 */
async function gbfsFrFeed(url, ttlMs, parse) {
  if (!url) return { value: null, at: 0, error: null, stale: false };
  const now = Date.now();
  const cached = _gbfsFrFeedCache.get(url);
  if (cached && !cached.error && now - cached.at <= ttlMs) {
    return { value: cached.value, at: cached.at, error: null, stale: false };
  }
  if (cached?.failedAt && now - cached.failedAt < GBFS_FR_BACKOFF_MS) {
    const stale = cached.value !== null && now - cached.at <= GBFS_FR_STALE_MS;
    return { value: stale ? cached.value : null, at: cached.at, error: cached.error, stale };
  }

  const request = coalesceProxyRequest(_gbfsFrFeedInFlight, url, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GBFS_FR_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': GBFS_FR_USER_AGENT },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > GBFS_FR_MAX_BYTES) throw new Error('feed body too large');
      const value = parse(await readResponseJsonCapped(response, GBFS_FR_MAX_BYTES));
      const entry = { at: Date.now(), value, error: null, failedAt: null };
      _gbfsFrFeedCache.set(url, entry);
      return { value, at: entry.at, error: null, stale: false };
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'timeout' : (error?.message || String(error));
      const previous = _gbfsFrFeedCache.get(url);
      const keepStale = previous?.value !== undefined && previous?.value !== null
        && Date.now() - previous.at <= GBFS_FR_STALE_MS;
      const entry = {
        at: keepStale ? previous.at : Date.now(),
        value: keepStale ? previous.value : null,
        error: message,
        failedAt: Date.now(),
      };
      _gbfsFrFeedCache.set(url, entry);
      return { value: entry.value, at: entry.at, error: message, stale: keepStale };
    } finally {
      clearTimeout(timer);
    }
  });
  return request.promise;
}

/**
 * How far outside its OWN observed footprint a system may still place an
 * object, in degrees (~55 km). A real network expanding into the next town
 * stays inside this; a Villefranche-sur-Saône scooter reported over Nantes,
 * 450 km away, does not.
 */
const GBFS_FR_FOOTPRINT_SLACK_DEG = 0.5;

/** Intersection of two boxes, or null when they are disjoint. */
function intersectBoxes(a, b) {
  if (!a || !b) return a || b || null;
  const box = {
    south: Math.max(a.south, b.south),
    west: Math.max(a.west, b.west),
    north: Math.min(a.north, b.north),
    east: Math.min(a.east, b.east),
  };
  return (box.south < box.north && box.west < box.east) ? box : null;
}

/** Read one system and return the objects it reports inside `clip`. */
async function gbfsFrSystemObjects(system, clip) {
  const feeds = system.feeds || {};
  // Clip to the viewport AND to where this system has actually been observed
  // to operate. Without the second bound, one junk fix per feed lands a stray
  // dot in whatever city the operator does not serve.
  const scoped = system.bbox
    ? intersectBoxes(clip, padGbfsBox(system.bbox, GBFS_FR_FOOTPRINT_SLACK_DEG))
    : clip;
  const [info, status, fleet, types] = await Promise.all([
    gbfsFrFeed(feeds.station_information, GBFS_FR_INFO_CACHE_MS, parseGbfsStations),
    gbfsFrFeed(feeds.station_status, GBFS_FR_STATUS_CACHE_MS, parseGbfsStationStatus),
    gbfsFrFeed(feeds.vehicle_status, GBFS_FR_STATUS_CACHE_MS, (payload) => payload),
    gbfsFrFeed(feeds.vehicle_types, GBFS_FR_INFO_CACHE_MS, vehicleKindLookup),
  ]);

  const kinds = types.value || {};
  const stations = [];
  const observed = [];
  // A system whose "stations" are municipal bays every operator republishes,
  // or a whole-city sentinel row, contributes its FLEET and not its stations —
  // otherwise Paris gets three near-identical dots on every bay in the city.
  const drawStations = system.drawStations !== undefined
    ? system.drawStations === true
    : systemDrawsStations(system);
  for (const station of info.value || []) {
    observed.push(station);
    if (!drawStations) continue;
    if (!scoped || !gbfsBoxContains(scoped, station.lat, station.lon)) continue;
    const availability = status.value?.get(station.id) || null;
    stations.push({
      id: `${system.id}:${station.id}`,
      system: system.id,
      lat: Number(station.lat.toFixed(5)),
      lon: Number(station.lon.toFixed(5)),
      name: station.name || null,
      available: availability?.available ?? null,
      docks: availability?.docks ?? null,
      capacity: station.capacity ?? null,
      renting: availability ? availability.renting : null,
      byKind: availability?.byKind && Object.keys(availability.byKind).length ? availability.byKind : null,
    });
  }

  const vehicles = [];
  for (const vehicle of parseGbfsVehicles(fleet.value, kinds)) {
    observed.push(vehicle);
    if (!scoped || !gbfsBoxContains(scoped, vehicle.lat, vehicle.lon)) continue;
    vehicles.push({
      id: vehicle.id ? `${system.id}:${vehicle.id}` : null,
      system: system.id,
      lat: Number(vehicle.lat.toFixed(5)),
      lon: Number(vehicle.lon.toFixed(5)),
      kind: vehicle.kind,
      rangeMeters: vehicle.rangeMeters,
      lastReported: vehicle.lastReported,
    });
  }

  // Learn the footprint from what actually arrived; bounds only grow, and the
  // junk fixes are fenced out first so one of them cannot permanently widen a
  // city system into a national one.
  const merged = mergeGbfsBounds(system.bbox, boundsOfPoints(observed, { rejectOutliers: true }));
  if (merged && JSON.stringify(merged) !== JSON.stringify(system.bbox)) {
    system.bbox = merged;
    _gbfsFrBoundsDirty = true;
  }

  const errors = [info.error, status.error, fleet.error].filter(Boolean);
  const stationsSuppressed = drawStations ? 0 : (info.value?.length || 0);
  const timestamps = [info.at, status.at, fleet.at].filter((value) => value > 0);
  return {
    stations,
    vehicles,
    stationsSuppressed,
    stale: info.stale || status.stale || fleet.stale,
    error: errors[0] || null,
    retrievedAt: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null,
  };
}

/** Build one viewport answer: select systems, read them, clip, cap. */
async function refreshGbfsFrViewport(box, key) {
  const index = await loadGbfsFrIndex();
  const selection = selectSystemsForBox(index.systems, box);
  const clip = padGbfsBox(box, GBFS_FR_VIEWPORT_PAD_DEG);

  const results = await Promise.all(selection.selected.map(async (system) => ({
    system,
    outcome: await gbfsFrSystemObjects(system, clip),
  })));

  const stations = [];
  const vehicles = [];
  const systems = [];
  let truncated = false;
  // Fair share, not first-come-first-served: Lime alone reports ~6,000
  // vehicles over Paris, and a sequential fill would spend the whole budget on
  // whichever system happened to rank first, leaving the other operators with
  // nothing and the map looking like a monopoly. Systems under their share
  // hand the remainder back, so the cap is never wasted.
  const shares = new Map();
  let remaining = GBFS_MAX_OBJECTS;
  let claimants = results.length;
  for (const { system, outcome } of [...results].sort(
    (a, b) => (a.outcome.stations.length + a.outcome.vehicles.length)
      - (b.outcome.stations.length + b.outcome.vehicles.length),
  )) {
    const wanted = outcome.stations.length + outcome.vehicles.length;
    const share = Math.min(wanted, Math.floor(remaining / Math.max(1, claimants)));
    shares.set(system.id, share);
    remaining -= share;
    claimants -= 1;
  }

  for (const { system, outcome } of results) {
    let budget = shares.get(system.id) ?? 0;
    const room = () => budget > 0;
    for (const station of outcome.stations) {
      if (!room()) { truncated = true; break; }
      stations.push(station);
      budget -= 1;
    }
    for (const vehicle of outcome.vehicles) {
      if (!room()) { truncated = true; break; }
      vehicles.push(vehicle);
      budget -= 1;
    }
    systems.push({
      id: system.id,
      name: system.name,
      area: system.area,
      kind: system.kind,
      licence: system.licenceLabel,
      publisher: system.publisher,
      pageUrl: system.pageUrl,
      datasetUrl: system.datasetUrl,
      stationsInView: outcome.stations.length,
      vehiclesInView: outcome.vehicles.length,
      // Honest about what this system contributes and what it withholds.
      stationsSuppressed: outcome.stationsSuppressed,
      retrievedAt: outcome.retrievedAt,
      stale: outcome.stale,
      error: outcome.error,
    });
  }

  const failed = systems.filter((s) => s.error).length;
  const payload = {
    status: failed && failed === systems.length && systems.length > 0 ? 'degraded' : 'ready',
    retrievedAt: new Date().toISOString(),
    box,
    stations,
    vehicles,
    systems,
    systemsMatched: selection.matched,
    systemsFetched: systems.length,
    systemsFailed: failed,
    systemsTruncated: selection.truncated,
    objectsTruncated: truncated,
    // Provenance for the "why is my city not doubled" question.
    redundantSystems: index.redundantCount ?? 0,
    indexGeneratedAt: index.generatedAt || null,
  };

  _gbfsFrViewportCache.set(key, { at: Date.now(), payload });
  trimGbfsFrViewportCache();
  void flushGbfsFrBounds();
  return payload;
}

/**
 * Vite plugin: viewport-bounded French shared-mobility proxy.
 *
 *   GET /api/shared-mobility-fr/systems             — index summary
 *   GET /api/shared-mobility-fr/objects?south&…     — stations + vehicles in box
 *
 * Separate from the older `/api/gbfs` proxy on purpose. That one answers a
 * fixed registry of `station_*.json` URLs on an allow-list of eight hosts,
 * which is the right shape for the layer it serves and the wrong shape here:
 * 150 of the 172 French catalog entries point at a `gbfs.json` auto-discovery
 * document, on ~30 different publisher hosts, and half the objects are
 * free-floating vehicles with no station at all. Rather than loosen the older
 * proxy's allow-list into something that no longer bounds anything, this one
 * derives its allow-list FROM the shipped index — a host is reachable only
 * because a probe already resolved a feed there.
 *
 * @returns {import('vite').Plugin}
 */
function gbfsFranceProxy() {
  function install(middlewares) {
    middlewares.use('/api/shared-mobility-fr', async (req, res) => {
      const json = (status, body, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'GET') {
        json(405, { error: 'Method Not Allowed' });
        return;
      }
      if (!_gbfsFrRateLimiter(clientKey(req))) {
        json(429, { error: 'Rate limit exceeded' }, { 'Retry-After': '5' });
        return;
      }

      const url = new URL(req.url || '/', 'http://localhost');
      const route = url.pathname.replace(/\/+$/, '') || '/';

      let index;
      try {
        index = await loadGbfsFrIndex();
      } catch (error) {
        console.warn('[GBFS FR] system index unavailable:', error?.message || error);
        json(503, {
          error: 'French shared-mobility index is missing — run `node scripts/build-gbfs-fr-index.mjs`',
          missingIndex: true,
        });
        return;
      }

      if (route === '/systems') {
        const live = index.systems.filter((s) => !s.redundant && !s.probeError);
        const licences = {};
        const kinds = {};
        for (const system of live) {
          const label = system.licenceLabel || 'Licence non précisée';
          licences[label] = (licences[label] || 0) + 1;
          kinds[system.kind || 'unknown'] = (kinds[system.kind || 'unknown'] || 0) + 1;
        }
        json(200, {
          source: index.source || PAN_DATASETS_URL,
          generatedAt: index.generatedAt || null,
          catalogResourceCount: index.catalogResourceCount ?? index.systems.length,
          distinctSystemCount: live.length,
          redundantCount: index.systems.filter((s) => s.redundant).length,
          unreachableCount: index.systems.filter((s) => s.probeError).length,
          licences,
          kinds,
          maxBoxDeg: GBFS_MAX_BOX_DEG,
        }, { 'Cache-Control': 'public, max-age=300' });
        return;
      }

      if (route !== '/objects') {
        json(404, { error: 'Unknown shared-mobility endpoint' });
        return;
      }

      const requested = validGbfsBox({
        south: url.searchParams.get('south'),
        west: url.searchParams.get('west'),
        north: url.searchParams.get('north'),
        east: url.searchParams.get('east'),
      });
      if (!requested) {
        json(400, {
          error: `A non-dateline bbox no larger than ${GBFS_MAX_BOX_DEG} degrees is required`,
          maxBoxDeg: GBFS_MAX_BOX_DEG,
        });
        return;
      }

      const box = snapGbfsBox(requested);
      const key = gbfsBoxKey(box);
      const now = Date.now();
      const cached = _gbfsFrViewportCache.get(key);
      if (cached && now - cached.at <= GBFS_FR_VIEWPORT_CACHE_MS) {
        json(200, { ...cached.payload, status: 'cached' }, { 'X-Shared-Mobility-FR': 'HIT' });
        return;
      }

      const request = coalesceProxyRequest(_gbfsFrViewportInFlight, key, () => refreshGbfsFrViewport(box, key));
      try {
        const payload = await request.promise;
        json(200, payload, { 'X-Shared-Mobility-FR': request.shared ? 'INFLIGHT' : 'MISS' });
      } catch (error) {
        console.warn('[GBFS FR] viewport unavailable:', error?.message || error);
        if (cached) {
          json(200, { ...cached.payload, status: 'stale' }, { 'X-Shared-Mobility-FR': 'STALE' });
          return;
        }
        json(503, { error: 'French shared-mobility data is temporarily unavailable' });
      }
    });
  }

  return {
    name: 'gbfs-france-proxy',
    configureServer(server) {
      install(server.middlewares);
      server.httpServer?.on('close', () => { void flushGbfsFrBounds(true); });
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

/**
 * FNV-1a 32-bit hash of a string, used to derive deterministic pseudo-random
 * values (e.g. hue for synthetic SVG billboards, fallback heading angles).
 *
 * @param {string} text
 * @returns {number} Unsigned 32-bit hash.
 */
function hashSeed(text) {
  let h = 2166136261 >>> 0; // FNV offset basis
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619); // FNV prime
  }
  return h >>> 0;
}

/**
 * Escape special XML/HTML characters for safe embedding in SVG text nodes.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Canonicalize a CCTV feed type string to one of:
 * 'image', 'mjpeg', 'mp4', 'webm', 'hls', or pass-through.
 *
 * @param {string} value - Raw feed type (e.g. 'jpeg', 'mjpg', 'video', 'stream').
 * @returns {string} Normalized feed type.
 */
function normalizeFeedType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'image';
  if (raw === 'jpeg' || raw === 'jpg' || raw === 'png') return 'image';
  if (raw === 'mjpg') return 'mjpeg';
  if (raw === 'video') return 'mp4';
  if (raw === 'stream') return 'hls';
  return raw;
}

/**
 * Check whether a normalized feed type represents streaming video.
 *
 * @param {string} feedType
 * @returns {boolean}
 */
function isVideoFeedType(feedType) {
  return feedType === 'mp4' || feedType === 'webm' || feedType === 'hls';
}

// ---------------------------------------------------------------------------
// CCTV proxy constants and source cache state
// ---------------------------------------------------------------------------
/** Path to the optional static CCTV source list (JSON array). */
const DEFAULT_CCTV_SOURCE_FILE = 'config/cctv_sources.austin.json';
/** Austin Open Data portal endpoint for traffic camera records. */
const DEFAULT_AUSTIN_ROWS_URL = 'https://data.austintexas.gov/api/views/b4k4-adkb/rows.json?accessType=DOWNLOAD';
/** Default cap on Austin cameras after distance-based prioritization. */
const DEFAULT_AUSTIN_MAX_SOURCES = 250;
/** Global cap on total CCTV sources served by the proxy. */
const DEFAULT_CCTV_MAX_SOURCES = 900;
/** Reference point for Austin camera prioritization (Congress & 6th). */
const AUSTIN_DOWNTOWN = { lat: 30.2672, lon: -97.7431 };
/** Caltrans CCTV: one JSON feed per district, identical schema statewide. */
const CALTRANS_CCTV_URL = (district) =>
  `https://cwwp2.dot.ca.gov/data/d${district}/cctv/cctvStatusD${String(district).padStart(2, '0')}.json`;
/** Districts fetched by default: SF Bay (4), LA (7), San Diego (11), Sacramento (3). */
const DEFAULT_CALTRANS_DISTRICTS = '4,7,11,3';
const DEFAULT_CALTRANS_MAX_SOURCES = 300;
/** Prioritization anchors: downtown cores of the four default metros. */
const CALTRANS_ANCHORS = [
  { lat: 37.7793, lon: -122.4193 }, // San Francisco
  { lat: 34.0537, lon: -118.2428 }, // Los Angeles
  { lat: 32.7157, lon: -117.1611 }, // San Diego
  { lat: 38.5816, lon: -121.4944 }, // Sacramento
];
/** TfL JamCams: one keyless list endpoint; frames live on a public S3 bucket. */
const TFL_JAMCAM_URL = 'https://api.tfl.gov.uk/Place/Type/JamCam';
const TFL_IMAGE_ORIGIN = 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/';
const DEFAULT_TFL_MAX_SOURCES = 250;
const LONDON_CENTER = { lat: 51.5074, lon: -0.1278 };
/**
 * Métropole de Lyon "Caméras Web Criter": one keyless JSON list endpoint on the
 * Grand Lyon open-data portal. Each row carries the camera's WGS-84 position and
 * the URL of its still frame, which the Criter traffic-control system re-extracts
 * from the live video roughly once a minute (the same frames Onlymoov publishes).
 */
const GRANDLYON_CCTV_URL = 'https://data.grandlyon.com/fr/datapusher/ws/rdata/pvo_patrimoine_voirie.pvocameracriter/all.json?maxfeatures=-1&start=1';
/** Official frame origin — the catalog's own `url` field must live under it. */
const GRANDLYON_IMAGE_ORIGIN = 'https://download.data.grandlyon.com/files/rdata/pvo_patrimoine_voirie.pvocameracriter/';
/** Headroom over the ~15 rows the Métropole publishes today. */
const DEFAULT_LYON_MAX_SOURCES = 60;
const LYON_CENTER = { lat: 45.7578, lon: 4.8320 }; // Place Bellecour
/**
 * The catalog has no in-service flag — only `last_update`, stamped each time
 * Criter refreshes the frame. A row that has not moved in half a day is a dead
 * camera whose frame URL would resolve to a frozen (or missing) image, so it is
 * dropped the same way Austin drops non-`TURNED_ON` and Caltrans drops
 * `inService !== true`. Half a day clears a night of darkness or maintenance.
 */
const GRANDLYON_MAX_FRAME_AGE_MS = 12 * 60 * 60 * 1000;
/**
 * How often Criter actually republishes a frame. Measured 2026-08-26 by hashing
 * one camera's JPEG every 20 s for three minutes: three distinct images, 62 s
 * apart. Served to the client as `upstreamCadenceMs` so the active-camera poll
 * matches the publisher instead of re-fetching the same picture five times out
 * of six (the same waste the 2026-07-30 field note recorded for London/Austin).
 */
const GRANDLYON_UPSTREAM_CADENCE_MS = 60 * 1000;
/**
 * SHA-256 of the "Image indisponible" graphic the Métropole serves in place of
 * a frame when a Criter camera is down (a 300x200, 22,966-byte drawing of
 * traffic cones). Verified byte-identical across repeated fetches on
 * 2026-08-26, on CWL7033.
 *
 * It has to be caught by CONTENT, because none of the usual signals work: the
 * catalog has no in-service flag, the row's `last_update` keeps advancing every
 * minute while the placeholder is being served, and the response is a perfectly
 * valid HTTP 200 image. Without this the panel would report SNAPSHOT · OK over
 * a picture of road cones.
 *
 * Fails OPEN: if the Métropole ever redraws the graphic this stops matching and
 * the frame is served unchanged — never the reverse.
 */
/**
 * How far back from the end to look for the JPEG EOI marker.
 *
 * Bounded at both ends on purpose. Too small and a camera that appends
 * trailing metadata after EOI is condemned as truncated — a false positive
 * sends a healthy camera to Street View forever, which is the expensive
 * mistake. Too large (scanning the whole file) and an EXIF thumbnail's OWN
 * end-of-image marker, which sits near the start of the file, would be
 * mistaken for the real one and a genuinely truncated frame would pass. These
 * frames run 64 KB to 600 KB, so 4 KB clears any realistic trailer while
 * staying far from the thumbnail.
 */
const JPEG_EOI_SCAN_BYTES = 4096;
const CCTV_PLACEHOLDER_FRAME_SHA256 = Object.freeze([
  '8be14bdafb0b8b688651206d02fad0656c0be2095c0e18c36945f74a8f598bdd',
]);
/** Camera CATALOGS change rarely; 15 min keeps multi-megabyte upstream list refetches (Austin rows.json + 4 Caltrans districts + TfL + Grand Lyon) infrequent. Frames are fetched per-request and are unaffected. */
const CCTV_SOURCE_CACHE_MS = 15 * 60 * 1000;
/** Per-provider catalog-fetch timeout. Bounds the worst-case refresh so one
 * stalled upstream can't leave getCctvSources (and thus every CCTV route)
 * pending forever — a hung fetch aborts, the loader returns [], and
 * serve-stale/other packs take over. */
const CCTV_SOURCE_FETCH_TIMEOUT_MS = 15 * 1000;
/** Individual CCTV image fetches must settle before the active 10-second
 * client refresh cadence. A bounded miss can fall through to Street View or
 * the synthetic frame instead of leaving the browser preview pending. */
export const CCTV_FRAME_FETCH_TIMEOUT_MS = 8 * 1000;
/** @type {Array<object>} Cached merged + normalized CCTV source list. */
let _cctvSourceCache = [];
/** @type {number} Epoch-ms when the source cache was last refreshed. */
let _cctvSourceCacheAt = 0;
/** @type {Promise<Array<object>>|null} In-flight refresh, shared by concurrent
 * callers so a post-TTL burst launches ONE refetch, not one per request. */
let _cctvSourceInflight = null;

/**
 * Coerce a value to a finite number, returning fallback if NaN/Infinity.
 *
 * @param {*} value
 * @param {number} [fallback=NaN]
 * @returns {number}
 */
function toFiniteNumber(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * Normalize a column/field name to a lowercase snake_case key.
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeKey(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Load CCTV sources from a local JSON file (CCTV_SOURCES_FILE env or default).
 *
 * @returns {Array<object>} Array of raw source objects, or [] on error.
 */
function loadSourcesFromFile() {
  const sourceFile = process.env.CCTV_SOURCES_FILE || DEFAULT_CCTV_SOURCE_FILE;
  const resolved = path.isAbsolute(sourceFile)
    ? sourceFile
    : path.resolve(__dirname, sourceFile);
  try {
    if (!fs.existsSync(resolved)) return [];
    const raw = fs.readFileSync(resolved, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[CCTV] failed to read source file:', resolved, error?.message || error);
    return [];
  }
}

/**
 * Load CCTV sources from the CCTV_SOURCES_JSON env variable (inline JSON).
 *
 * @returns {Array<object>} Array of raw source objects, or [] if unset/invalid.
 */
function loadSourcesFromEnv() {
  const raw = process.env.CCTV_SOURCES_JSON;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}


/**
 * Parse a WKT POINT string (e.g. "POINT(-97.74 30.27)") into lat/lon.
 *
 * WKT uses (lon lat) order; returned object uses {lat, lon}.
 *
 * @param {string} value
 * @returns {{lat:number, lon:number}}
 */
function parsePointString(value) {
  const match = String(value || '').match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
  if (!match) return { lat: NaN, lon: NaN };
  return {
    lon: toFiniteNumber(match[1]),
    lat: toFiniteNumber(match[2]),
  };
}

/**
 * Extract lat/lon from a variety of coordinate representations.
 *
 * Handles WKT POINT strings, and objects with latitude/lat/y or
 * longitude/lon/lng/x properties (various casing).
 *
 * @param {string|object|null} value
 * @returns {{lat:number, lon:number}}
 */
function coerceLatLon(value) {
  if (!value) return { lat: NaN, lon: NaN };

  if (typeof value === 'string') {
    return parsePointString(value);
  }

  if (typeof value !== 'object') {
    return { lat: NaN, lon: NaN };
  }

  const lat = toFiniteNumber(
    value.latitude ?? value.lat ?? value.y ?? value.Latitude ?? value.Lat,
    NaN
  );
  const lon = toFiniteNumber(
    value.longitude ?? value.lon ?? value.lng ?? value.x ?? value.Longitude ?? value.Lon,
    NaN
  );
  return { lat, lon };
}

/**
 * Extract geographic coordinates from an Austin Open Data camera record.
 *
 * Tries several candidate fields (location, coordinates, the_geom,
 * point, geocoded_column) via coerceLatLon, then falls back to
 * explicit latitude/longitude scalar fields.
 *
 * @param {object} record - Flattened camera record.
 * @returns {{lat:number, lon:number}}
 */
function extractAustinCoords(record) {
  const candidates = [
    record.location,
    record.coordinates,
    record.the_geom,
    record.point,
    record.geocoded_column,
  ];
  for (const candidate of candidates) {
    const parsed = coerceLatLon(candidate);
    if (Number.isFinite(parsed.lat) && Number.isFinite(parsed.lon)) return parsed;
  }

  const lat = toFiniteNumber(
    record.latitude ?? record.lat ?? record.camera_latitude ?? record.location_latitude,
    NaN
  );
  const lon = toFiniteNumber(
    record.longitude ?? record.lon ?? record.lng ?? record.camera_longitude ?? record.location_longitude,
    NaN
  );
  return { lat, lon };
}

/**
 * Extract a numeric camera ID from an Austin Open Data record.
 *
 * Tries well-known field names first, then scans any field whose key
 * contains "camera"/"cam"/"device" + "id".
 *
 * @param {object} record - Flattened camera record.
 * @returns {string} Numeric ID string, or '' if none found.
 */
function extractAustinCameraId(record) {
  const preferredKeys = [
    'camera_id',
    'cameraid',
    'cam_id',
    'device_id',
    'intersection_id',
    'id',
  ];
  for (const key of preferredKeys) {
    const value = record[key];
    if (value == null) continue;
    const asText = String(value).trim();
    if (!asText) continue;
    if (/^\d+$/.test(asText)) return asText;
  }

  for (const [key, value] of Object.entries(record)) {
    if (!/camera|cam|device/.test(key)) continue;
    if (!/id/.test(key)) continue;
    const asText = String(value || '').trim();
    if (!asText) continue;
    if (/^\d+$/.test(asText)) return asText;
  }

  return '';
}

/**
 * Extract a human-readable camera name from an Austin record.
 *
 * @param {object} record - Flattened camera record.
 * @param {string} cameraId - Fallback identifier if no name field found.
 * @returns {string}
 */
function extractAustinName(record, cameraId) {
  const preferredKeys = [
    'camera_name',
    'location_name',
    'intersection_name',
    'location',
    'cross_street',
    'description',
    'name',
  ];
  for (const key of preferredKeys) {
    const value = record[key];
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (text) return text;
  }
  return `Austin Camera ${cameraId}`;
}

/**
 * Extract camera heading (compass bearing) from an Austin record.
 *
 * Tries explicit numeric heading fields first, then direction-keyword
 * fields, then infers from the camera name/description text.
 *
 * @param {object} record - Flattened camera record.
 * @returns {number} Heading in degrees [0..360), or NaN if unknown.
 */
function extractAustinHeading(record) {
  const direct = toFiniteNumber(record.heading_deg ?? record.heading ?? record.bearing, NaN);
  if (Number.isFinite(direct)) return ((direct % 360) + 360) % 360;

  // Dedicated direction fields: bare cardinal words ("West") are real facings.
  const directionKeys = ['direction', 'travel_direction', 'facing', 'facing_direction'];
  for (const key of directionKeys) {
    const heading = directionToHeading(record[key], true);
    if (Number.isFinite(heading)) return heading;
  }

  // Free-form name/intersection text: only explicit travel forms ("WESTBOUND"/
  // "WB") count — a bare "West" here is a street name ("5TH ST / WEST AVE"), not
  // a facing, and must not promote the camera to a false high-confidence heading.
  const nameProbe = [
    record.camera_name,
    record.location_name,
    record.intersection_name,
    record.location,
    record.cross_street,
    record.description,
    record.name,
  ].filter(Boolean).join(' ');
  const inferred = directionToHeading(nameProbe);
  if (Number.isFinite(inferred)) return inferred;

  return NaN;
}

/**
 * Bounding-box sanity check: is this coordinate plausibly in the Austin metro area?
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {boolean}
 */
function isLikelyAustinCoordinate(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return lat >= 30.02 && lat <= 30.58 && lon >= -98.12 && lon <= -97.40;
}

/**
 * Bounding-box sanity check: is this coordinate plausibly inside the Métropole
 * de Lyon? Generous enough to cover all 59 communes (Givors in the south to
 * Neuville in the north), tight enough to reject a swapped lat/lon pair or a
 * null-island row.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {boolean}
 */
function isLikelyLyonCoordinate(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return lat >= 45.55 && lat <= 46.00 && lon >= 4.55 && lon <= 5.20;
}

/**
 * Derive a deterministic fallback heading from a camera ID hash.
 *
 * Produces one of 16 evenly-spaced compass directions (0, 22.5, 45, ...).
 *
 * @param {string} cameraId
 * @returns {number} Heading in degrees [0..360).
 */
function fallbackHeadingFromId(cameraId) {
  return (hashSeed(String(cameraId)) % 16) * 22.5;
}

/**
 * Convert a Socrata rows.json array row into a keyed object using column metadata.
 *
 * @param {Array} row - Array of cell values from the Socrata payload.
 * @param {Array<{fieldName?:string, name?:string}>} columns - Column descriptors.
 * @returns {object} Keyed record with normalized snake_case keys.
 */
function rowArrayToObject(row, columns) {
  const record = {};
  for (let idx = 0; idx < columns.length; idx++) {
    const col = columns[idx];
    const key = normalizeKey(col.fieldName || col.name || `col_${idx}`);
    if (!key) continue;
    record[key] = row[idx];
  }
  return record;
}

/**
 * Haversine great-circle distance between two WGS-84 points.
 *
 * @param {number} lat1 - Latitude of point A (degrees).
 * @param {number} lon1 - Longitude of point A (degrees).
 * @param {number} lat2 - Latitude of point B (degrees).
 * @param {number} lon2 - Longitude of point B (degrees).
 * @returns {number} Distance in kilometers.
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Distance-prioritizes cameras to a cap: keeps the maxCount cameras closest
 * to ANY of the given anchor points (min distance over anchors), tie-broken
 * by original array order. Used by every live source pack (Austin: one
 * downtown anchor; Caltrans: one anchor per major CA metro; TfL: central
 * London) so a cap always keeps the densest, most interesting cores.
 *
 * @param {Array<object>} cameras - Normalized camera source objects.
 * @param {number} maxCount - Cap (<=0 or >= length disables).
 * @param {Array<{lat:number,lon:number}>} anchors - At least one anchor.
 * @returns {Array<object>} Capped, priority-ordered camera list.
 */
function prioritizeSources(cameras, maxCount, anchors) {
  const list = Array.isArray(cameras) ? cameras : [];
  const anchorList = (Array.isArray(anchors) ? anchors : []).filter(
    (a) => Number.isFinite(a?.lat) && Number.isFinite(a?.lon)
  );
  if (!Number.isFinite(maxCount) || maxCount <= 0 || list.length <= maxCount || !anchorList.length) {
    return list;
  }

  const scored = list.map((camera, idx) => {
    const lat = Number(camera?.lat);
    const lon = Number(camera?.lon);
    const distKm = Number.isFinite(lat) && Number.isFinite(lon)
      ? Math.min(...anchorList.map((a) => haversineKm(lat, lon, a.lat, a.lon)))
      : Number.POSITIVE_INFINITY;
    return { camera, idx, distKm };
  });

  scored.sort((a, b) => {
    if (a.distKm !== b.distKm) return a.distKm - b.distKm;
    return a.idx - b.idx;
  });

  return scored.slice(0, maxCount).map((entry) => entry.camera);
}

/**
 * Fetch and parse Austin traffic camera records from the city Open Data portal.
 *
 * Downloads the Socrata rows.json payload, converts each row to a keyed
 * record, extracts camera ID / coords / heading / name, validates against
 * the Austin bounding box, deduplicates by ID, then distance-prioritizes
 * to stay within CCTV_AUSTIN_MAX_SOURCES.
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
async function loadAustinSourcesFromOpenData() {
  const endpoint = process.env.CCTV_AUSTIN_ROWS_URL || DEFAULT_AUSTIN_ROWS_URL;
  try {
    const resp = await fetch(endpoint, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS) });
    if (!resp.ok) {
      console.warn('[CCTV] Austin source download failed:', resp.status);
      return [];
    }
    const payload = await resp.json();
    const columns = Array.isArray(payload?.meta?.view?.columns) ? payload.meta.view.columns : [];
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    if (!columns.length || !rows.length) return [];

    const cameras = [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const record = rowArrayToObject(row, columns);
      const cameraId = extractAustinCameraId(record);
      if (!cameraId) continue;

      // Only live cameras: the dataset carries DESIRED (planned, not built),
      // REMOVED and VOID rows whose frame URLs never resolve — those cameras
      // would render as permanent Street View / synthetic fallbacks. Tolerate
      // a missing column (keep the row) so a schema change fails open.
      const status = String(record.camera_status || '').trim().toUpperCase();
      if (status && status !== 'TURNED_ON') continue;

      const { lat, lon } = extractAustinCoords(record);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (!isLikelyAustinCoordinate(lat, lon)) continue;

      const extractedHeading = extractAustinHeading(record);
      const hasHeading = Number.isFinite(extractedHeading);
      const headingDeg = hasHeading ? extractedHeading : fallbackHeadingFromId(cameraId);
      cameras.push({
        id: cameraId,
        name: extractAustinName(record, cameraId),
        city: 'Austin',
        cityId: 'austin',
        provider: 'Austin Transportation & Public Works',
        lat,
        lon,
        headingDeg,
        headingConfidence: hasHeading ? 'high' : 'low',
        pitchDeg: hasHeading ? -24 : -18,
        fovDeg: hasHeading ? 56 : 44,
        rangeM: hasHeading ? 210 : 145,
        mountHeightM: hasHeading ? 10 : 8,
        groundElevationM: 150,
        feedType: 'image',
        url: `https://cctv.austinmobility.io/image/${encodeURIComponent(cameraId)}.jpg`,
        snapshotUrl: `https://cctv.austinmobility.io/image/${encodeURIComponent(cameraId)}.jpg`,
        sourceKind: 'austin-open-data',
        license: 'Public city traffic camera frame',
      });
    }

    const unique = Array.from(new Map(cameras.map((camera) => [camera.id, camera])).values());
    const maxRaw = Number(process.env.CCTV_AUSTIN_MAX_SOURCES || DEFAULT_AUSTIN_MAX_SOURCES);
    const maxCount = Number.isFinite(maxRaw) ? Math.max(8, Math.min(300, Math.floor(maxRaw))) : DEFAULT_AUSTIN_MAX_SOURCES;
    const prioritized = prioritizeSources(unique, maxCount, [AUSTIN_DOWNTOWN]);
    if (prioritized.length < unique.length) {
      console.log(`[CCTV] Loaded Austin camera sources: ${unique.length} (using nearest ${prioritized.length})`);
    } else {
      console.log('[CCTV] Loaded Austin camera sources:', prioritized.length);
    }
    return prioritized;
  } catch (error) {
    console.warn('[CCTV] Austin source download error:', error?.message || error);
    return [];
  }
}

/**
 * Fetch Caltrans CCTV cameras for the configured districts (CCTV_CALTRANS_DISTRICTS,
 * comma-separated 1..12; empty string disables the pack). One official JSON feed per
 * district, identical schema statewide; keyless. Only inService cameras with finite
 * coords and a cwwp2.dot.ca.gov https image URL are kept (the image-URL origin check
 * is defense-in-depth: the proxy only ever fetches catalog URLs, and this pins the
 * catalog to the official host). Districts fetch in parallel and fail independently
 * (Promise.allSettled) — one district outage never darkens the others.
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
async function loadCaltransSourcesFromOpenData() {
  const districtsRaw = process.env.CCTV_CALTRANS_DISTRICTS ?? DEFAULT_CALTRANS_DISTRICTS;
  const districts = String(districtsRaw)
    .split(',')
    .map((token) => Number(token.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
  if (!districts.length) return [];

  const settled = await Promise.allSettled(
    districts.map(async (district) => {
      const resp = await fetch(CALTRANS_CCTV_URL(district), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS) });
      if (!resp.ok) throw new Error(`D${district} HTTP ${resp.status}`);
      const payload = await resp.json();
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      return { district, rows };
    })
  );

  const cameras = [];
  for (const result of settled) {
    if (result.status !== 'fulfilled') {
      console.warn('[CCTV] Caltrans district fetch failed:', result.reason?.message || result.reason);
      continue;
    }
    const { district, rows } = result.value;
    for (const row of rows) {
      const cctv = row?.cctv;
      if (!cctv || String(cctv.inService).toLowerCase() !== 'true') continue;
      const loc = cctv.location || {};
      const lat = toFiniteNumber(loc.latitude);
      const lon = toFiniteNumber(loc.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const imageUrl = String(cctv.imageData?.static?.currentImageURL || '');
      // Official-host pin (see JSDoc). Also drops records with no still image.
      if (!imageUrl.startsWith('https://cwwp2.dot.ca.gov/')) continue;

      const locationName = String(loc.locationName || '').trim();
      // Leading token of locationName is the stable camera code ("TV102 -- I-580 : …").
      const codeMatch = /^([A-Za-z0-9_-]+)\s*--/.exec(locationName);
      const code = (codeMatch ? codeMatch[1] : `x${cameras.length}`).toLowerCase();
      const cameraId = `ca-d${district}-${code}`;

      // loc.direction is a dedicated field ("West", "South") → allow bare words.
      const heading = directionToHeading(loc.direction, true);
      const hasHeading = Number.isFinite(heading);
      const label = locationName.replace(/^([A-Za-z0-9_-]+)\s*--\s*/, '') || `Caltrans D${district} ${code}`;
      cameras.push({
        id: cameraId,
        name: loc.nearbyPlace ? `${label} (${loc.nearbyPlace})` : label,
        city: String(loc.nearbyPlace || `Caltrans D${district}`),
        cityId: `ca-d${district}`,
        provider: 'Caltrans',
        lat,
        lon,
        headingDeg: hasHeading ? heading : fallbackHeadingFromId(cameraId),
        headingConfidence: hasHeading ? 'high' : 'low',
        // Same two fabricated pose personalities as Austin (design §1a): these are
        // RAW PRIOR starting points; the client's one-shot ground snap + manual
        // calibration own the truth.
        pitchDeg: hasHeading ? -24 : -18,
        fovDeg: hasHeading ? 56 : 44,
        rangeM: hasHeading ? 210 : 145,
        mountHeightM: hasHeading ? 10 : 8,
        // loc.elevation is reported in FEET (verified: D3 maxes at 7427 ft ≈
        // 2264 m for the Sierra passes — as metres that would top Mt Whitney).
        // Convert to metres and clamp to a sane CA-roads range so an occasional
        // garbage upstream value can't fling a camera kilometres up. Prior only:
        // the client one-shot snap corrects it on 3D-tile stacks — but on a
        // no-tileset stack (keyless OSM) the snap misses and this height freezes,
        // so it must be right-ish on its own.
        groundElevationM: (() => {
          const ft = toFiniteNumber(loc.elevation, NaN);
          return Number.isFinite(ft) ? Math.max(-100, Math.min(4000, ft * 0.3048)) : 150;
        })(),
        feedType: 'image',
        url: imageUrl,
        snapshotUrl: imageUrl,
        sourceKind: 'caltrans-open-data',
        license: 'Public Caltrans highway camera frame',
      });
    }
  }

  const maxRaw = Number(process.env.CCTV_CALTRANS_MAX_SOURCES || DEFAULT_CALTRANS_MAX_SOURCES);
  const maxCount = Number.isFinite(maxRaw) ? Math.max(8, Math.min(600, Math.floor(maxRaw))) : DEFAULT_CALTRANS_MAX_SOURCES;
  const prioritized = prioritizeSources(cameras, maxCount, CALTRANS_ANCHORS);
  console.log(`[CCTV] Loaded Caltrans camera sources: ${cameras.length} inService (using nearest ${prioritized.length})`);
  return prioritized;
}

/**
 * Fetch TfL JamCams (London). Keyless: the optional TFL_APP_KEY only raises the
 * list-endpoint rate limit (frames come from TfL's public S3 bucket, which is not
 * rate-limited); the 15-min source cache keeps list hits far below anonymous
 * limits anyway. Only `available === "true"` cameras with finite coords and an
 * image URL on the official bucket are kept. Attribution: "Powered by TfL Open
 * Data" (registered in src/data/dataCredits.js).
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
async function loadTflSourcesFromOpenData() {
  try {
    const appKey = String(process.env.TFL_APP_KEY || '').trim();
    const url = appKey ? `${TFL_JAMCAM_URL}?app_key=${encodeURIComponent(appKey)}` : TFL_JAMCAM_URL;
    const resp = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS) });
    if (!resp.ok) {
      console.warn('[CCTV] TfL JamCam download failed:', resp.status);
      return [];
    }
    const places = await resp.json();
    if (!Array.isArray(places)) return [];

    const cameras = [];
    for (const place of places) {
      const props = {};
      for (const p of place?.additionalProperties || []) {
        if (p?.key) props[p.key] = p.value;
      }
      if (String(props.available).toLowerCase() !== 'true') continue;
      const lat = toFiniteNumber(place?.lat);
      const lon = toFiniteNumber(place?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const imageUrl = String(props.imageUrl || '');
      if (!imageUrl.startsWith(TFL_IMAGE_ORIGIN)) continue; // official-bucket pin

      // "JamCams_00002.00865" → "tfl-00002.00865" (provider-stable id).
      const rawId = String(place?.id || '').replace(/^JamCams_/, '');
      if (!rawId) continue;
      const cameraId = `tfl-${rawId}`;

      cameras.push({
        id: cameraId,
        name: String(place?.commonName || `JamCam ${rawId}`),
        city: 'London',
        cityId: 'london',
        provider: 'Transport for London',
        lat,
        lon,
        // No heading signal at all in JamCam data → id-hash fallback, low
        // confidence personality (same as headingless Austin cameras).
        headingDeg: fallbackHeadingFromId(cameraId),
        headingConfidence: 'low',
        pitchDeg: -18,
        fovDeg: 44,
        rangeM: 145,
        mountHeightM: 8,
        groundElevationM: 15, // Thames-basin prior; one-shot snap corrects.
        feedType: 'image', // stills-first (product rule); props.videoUrl deliberately unused
        url: imageUrl,
        snapshotUrl: imageUrl,
        sourceKind: 'tfl-open-data',
        license: 'Powered by TfL Open Data',
      });
    }

    const maxRaw = Number(process.env.CCTV_TFL_MAX_SOURCES || DEFAULT_TFL_MAX_SOURCES);
    const maxCount = Number.isFinite(maxRaw) ? Math.max(8, Math.min(600, Math.floor(maxRaw))) : DEFAULT_TFL_MAX_SOURCES;
    const prioritized = prioritizeSources(cameras, maxCount, [LONDON_CENTER]);
    console.log(`[CCTV] Loaded TfL JamCam sources: ${cameras.length} available (using nearest ${prioritized.length})`);
    return prioritized;
  } catch (error) {
    console.warn('[CCTV] TfL JamCam download error:', error?.message || error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// OSM mapped cameras — opt-in, viewport-bounded OpenStreetMap camera positions
// ---------------------------------------------------------------------------
/** Memory-cache TTL for one snapped viewport box. */
const OSM_CAMERA_CACHE_MS = 5 * 60_000;
/** In-memory cache ceiling (boxes), evicted oldest-first. */
const OSM_CAMERA_MAX_CACHE = 120;
/** Disk-cache directory for mapped camera boxes. */
const OSM_CAMERA_DISK_DIR = path.join(process.cwd(), '.gev-cache', 'osm-cameras');
/**
 * Disk TTL (7 days). Mapped camera nodes change on a survey timescale, not a
 * session one, and the in-memory tier dies with the dev server — the same
 * reasoning the mapped-installation proxy applies, so re-visiting a city next
 * week costs the public Overpass mirrors nothing.
 */
const OSM_CAMERA_DISK_TTL_MS = 7 * 86_400_000;
/** Bump when the cached row shape changes so old entries are ignored, not misread. */
const OSM_CAMERA_CACHE_VERSION = 'v1';
/** Read cap for one box probe (400 tagged nodes is far under this). */
const OSM_CAMERA_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/**
 * Wall-clock budget for one box refresh, shared by all mirror attempts. Sized
 * so the documented 5-20 s cold latency of the community fallback mirror still
 * fits after the faster mirrors have had their turn.
 */
const OSM_CAMERA_REFRESH_BUDGET_MS = 20_000;
/**
 * Floor on one mirror attempt's share of that budget.
 *
 * Field-observed 2026-08-26, twice. First: with a whole-budget timeout, one
 * mirror that accepts the connection and then stalls consumed the entire
 * window, and the healthy fallback below it never got a turn — while the
 * refused mirrors above it had failed in milliseconds. Each attempt now gets a
 * fair share of what is LEFT, so fast failures hand their unused time forward.
 * Then: an even split across four mirrors gave the PRIMARY one only 5 s and cut
 * it off mid-answer, while the two that were going to fail returned 502 in
 * about a second. This floor is sized to a realistic Overpass latency for a
 * street-scale box (measured 1-3 s warm, ~8 s under load), so a mirror that is
 * genuinely working is not aborted to preserve a turn for one that is not. The
 * overall deadline still caps the request.
 */
const OSM_CAMERA_MIN_ATTEMPT_MS = 8_000;
const _osmCameraCache = new Map();
const _osmCameraInFlight = new Map();
const _osmCameraRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 40, globalMax: 120 });

/** Whether the opt-in OSM mapped-camera source is enabled for this server. */
function osmCamerasEnabled() {
  return String(process.env.CCTV_OSM_CAMERAS_ENABLED || '').trim() === '1';
}

/** Cache key -> stable disk-cache file path. */
function osmCameraDiskPath(cacheKey) {
  return path.join(OSM_CAMERA_DISK_DIR, `${createHash('sha1').update(cacheKey).digest('hex')}.json`);
}

/**
 * Read a disk-cached box at ANY age. Freshness is the caller's decision: an
 * expired box is still the right answer while Overpass is down (serve-stale
 * beats an empty viewport).
 *
 * @param {string} cacheKey
 * @returns {Promise<?{cachedAt:number, payload:object}>}
 */
async function readOsmCameraDisk(cacheKey) {
  try {
    const entry = JSON.parse(await fsp.readFile(osmCameraDiskPath(cacheKey), 'utf8'));
    if (!Number.isFinite(entry?.cachedAt) || !Array.isArray(entry?.payload?.cameras)) return null;
    return entry;
  } catch {
    return null;
  }
}

/**
 * Persist one box ATOMICALLY (temp sibling + rename), so a crash mid-write
 * leaves the previous entry — and serve-stale — intact.
 *
 * @param {string} cacheKey
 * @param {{cachedAt:number, payload:object}} entry
 * @returns {Promise<boolean>}
 */
async function writeOsmCameraDisk(cacheKey, entry) {
  const target = osmCameraDiskPath(cacheKey);
  const temp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fsp.mkdir(OSM_CAMERA_DISK_DIR, { recursive: true });
    await fsp.writeFile(temp, JSON.stringify(entry));
    await fsp.rename(temp, target);
    return true;
  } catch (error) {
    console.warn('[OSM Cameras] disk cache write failed:', error?.message || error);
    await fsp.rm(temp, { force: true }).catch(() => {});
    return false;
  }
}

/**
 * One bounded Overpass probe: try mirrors in order until one answers or the
 * deadline passes, ABORTING each attempt rather than letting a slow or wedged
 * mirror hold the request open. Rate-limited, runtime-error, and non-JSON
 * (HTML/XML error page) responses fall through to the next mirror.
 *
 * @param {string} ql - Overpass QL for one box.
 * @param {number} deadline - Epoch-ms after which no further attempt starts.
 * @returns {Promise<Array<object>>} Raw Overpass elements.
 */
async function fetchOsmCameraElements(ql, deadline) {
  // Per-mirror outcomes, aggregated into the thrown error. Keeping only the
  // LAST failure made an outage unreadable: "aborted due to timeout" said
  // nothing about whether the mirrors above it were rate-limited, refused, or
  // simply never tried because the budget ran out.
  const outcomes = [];
  for (let index = 0; index < OVERPASS_UPSTREAMS.length; index++) {
    const endpoint = OVERPASS_UPSTREAMS[index];
    const host = new URL(endpoint).host;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    const attemptMs = Math.max(
      OSM_CAMERA_MIN_ATTEMPT_MS,
      Math.floor(remainingMs / (OVERPASS_UPSTREAMS.length - index)),
    );
    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': OVERPASS_USER_AGENT,
        },
        body: `data=${encodeURIComponent(ql)}`,
        signal: AbortSignal.timeout(Math.min(remainingMs, attemptMs)),
      });
      const body = await readResponseTextCapped(upstream, OSM_CAMERA_MAX_RESPONSE_BYTES);
      const rateLimited = overpassLooksRateLimited(body);
      if (upstream.status >= 400 || rateLimited || overpassLooksRuntimeError(body)) {
        const why = rateLimited ? 'rate limited' : `HTTP ${upstream.status}`;
        outcomes.push(`${host}: ${why}`);
        continue;
      }
      const elements = JSON.parse(body)?.elements;
      if (!Array.isArray(elements)) {
        outcomes.push(`${host}: no element list`);
        continue;
      }
      return elements;
    } catch (error) {
      const reason = /timeout|abort/i.test(String(error?.message)) ? `timed out after ${attemptMs} ms` : (error?.message || 'failed');
      outcomes.push(`${host}: ${reason}`);
    }
  }
  const skipped = OVERPASS_UPSTREAMS.length - outcomes.length;
  throw new Error(
    `no Overpass mirror answered inside the request budget — ${outcomes.join('; ')}`
    + (skipped > 0 ? `; ${skipped} not tried (budget spent)` : ''),
  );
}

function trimOsmCameraCache() {
  while (_osmCameraCache.size > OSM_CAMERA_MAX_CACHE) {
    const oldest = _osmCameraCache.keys().next().value;
    if (oldest === undefined) break;
    _osmCameraCache.delete(oldest);
  }
}

/**
 * Vite plugin: viewport-bounded OpenStreetMap mapped-camera proxy.
 *
 *   GET /api/osm-cameras?south&west&north&east — camera POSITIONS in that box
 *
 * OPT-IN (`CCTV_OSM_CAMERAS_ENABLED=1`) and off by default, because OSM maps
 * camera positions and never their imagery: every row is served with no
 * upstream URL, so each frame request falls through to a billable Street View
 * still or the synthetic `NO UPSTREAM CONFIGURED` placeholder.
 *
 * Like the mapped-installation proxy, this deliberately does not expose
 * arbitrary Overpass QL to the browser: it answers one allow-listed tag query
 * inside a box no wider than OSM_CAMERA_MAX_BOX_DEG, snapped OUTWARD onto a
 * shared grid so neighbouring viewports share one cache entry (and a cached
 * answer always covers more than was asked for). Disabled installs answer 503
 * with `disabled: true` so the client stops asking instead of retrying.
 *
 * @returns {import('vite').Plugin}
 */
function osmCamerasProxy() {
  async function refresh(box, key) {
    const ql = osmCameraBboxQuery(box, { elementCap: OSM_CAMERA_QUERY_CAP });
    const elements = await fetchOsmCameraElements(ql, Date.now() + OSM_CAMERA_REFRESH_BUDGET_MS);
    const cameras = [];
    for (const element of elements) {
      const camera = osmCameraFromElement(element, { fallbackHeading: fallbackHeadingFromId });
      if (camera) cameras.push(camera);
    }
    const payload = {
      cameras,
      // Honest truncation flag: Overpass cut the result, so the box holds more
      // cameras than were served. The client shows the count it actually has.
      saturated: elements.length >= OSM_CAMERA_QUERY_CAP,
      elementCap: OSM_CAMERA_QUERY_CAP,
      retrievedAt: new Date().toISOString(),
      status: 'ready',
    };
    const entry = { cachedAt: Date.now(), payload };
    _osmCameraCache.set(key, entry);
    trimOsmCameraCache();
    writeOsmCameraDisk(key, entry);
    return payload;
  }

  function install(middlewares) {
    middlewares.use('/api/osm-cameras', async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        return;
      }
      if (!osmCamerasEnabled()) {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'OSM mapped cameras are disabled', disabled: true }));
        return;
      }
      if (!_osmCameraRateLimiter(clientKey(req))) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '5' });
        res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
        return;
      }
      const url = new URL(req.url, 'http://localhost');
      const requested = validOsmCameraBox({
        south: url.searchParams.get('south'),
        west: url.searchParams.get('west'),
        north: url.searchParams.get('north'),
        east: url.searchParams.get('east'),
      });
      if (!requested) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `A non-dateline bbox no larger than ${OSM_CAMERA_MAX_BOX_DEG} degrees is required` }));
        return;
      }
      // Query the SNAPPED box, not the raw viewport: neighbouring views share
      // one cache entry, and an outward snap always covers what was asked for.
      const box = snapOsmCameraBox(requested);
      const key = `${OSM_CAMERA_CACHE_VERSION}|${osmCameraBoxKey(box)}`;
      const now = Date.now();
      const cached = _osmCameraCache.get(key);
      if (cached && now - cached.cachedAt <= OSM_CAMERA_CACHE_MS) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'X-OSM-Cameras': 'HIT' });
        res.end(JSON.stringify({ ...cached.payload, status: 'cached' }));
        return;
      }
      if (!_osmCameraInFlight.has(key)) {
        const disk = await readOsmCameraDisk(key);
        if (disk && now - disk.cachedAt <= OSM_CAMERA_DISK_TTL_MS) {
          _osmCameraCache.set(key, disk);
          trimOsmCameraCache();
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'X-OSM-Cameras': 'DISK' });
          res.end(JSON.stringify({ ...disk.payload, status: 'cached' }));
          return;
        }
      }
      const request = coalesceProxyRequest(_osmCameraInFlight, key, () => refresh(box, key));
      try {
        const payload = await request.promise;
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
          'X-OSM-Cameras': request.shared ? 'INFLIGHT' : 'MISS',
        });
        res.end(JSON.stringify(payload));
      } catch (error) {
        // Overpass is down: last-good positions at ANY age beat an empty
        // viewport (the same serve-stale rule the Overpass proxy applies).
        const stale = await readOsmCameraDisk(key);
        if (stale) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-OSM-Cameras': 'STALE-DISK' });
          res.end(JSON.stringify({ ...stale.payload, status: 'stale' }));
          return;
        }
        console.warn('[OSM Cameras] box unavailable:', error?.message || error);
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Mapped camera positions are temporarily unavailable' }));
      }
    });
  }

  return {
    name: 'osm-cameras-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

/**
 * Hand-derived compass headings for the Grand Lyon cameras, keyed by
 * maintenance code. Degrees clockwise from true north.
 *
 * WHY THIS EXISTS: the catalog publishes no bearing. Its `observation` field
 * names a DESTINATION ("Direction : Porte de Gerland"), not a facing, so every
 * Lyon camera would otherwise take the id-hash fallback and point somewhere
 * arbitrary — which makes the 3D monitor plane and the FOCUS flight land on
 * geometry the frame does not show.
 *
 * HOW EACH VALUE WAS DERIVED (2026-08-26), in two independent halves:
 *   1. ANGLE — the azimuth of the carriageway under the camera, computed from
 *      OpenStreetMap way geometry inside a 200 m box around the published
 *      position (`.context/road-bearings.mjs`). A camera over a road looks
 *      along it, which pins the heading to two candidates 180° apart.
 *   2. SIGN — which of the two. The destination in `observation` was geocoded
 *      and the camera→destination bearing computed; where that was ambiguous
 *      or the geocoder resolved the wrong place, the published frame itself
 *      decided, using landmarks (the Part-Dieu skyline, the Tassin clock) and
 *      solar shadow direction for the capture time.
 *
 * These are careful human estimates from public geometry and imagery, NOT
 * surveyed values and NOT published by the Métropole. They are served as
 * `poseSource: 'curated'` so the panel badge reads CAL · CURATED rather than
 * claiming a measurement, and the gizmo still overrides them. The two marked
 * "weak" below are junction cameras whose road axis and destination bearing
 * disagree by more than 30°; they are still far better than a hash, but they
 * are the first ones worth dragging.
 *
 * A camera absent from this table keeps the id-hash fallback and stays
 * low-confidence — see CWL7033, which publishes a placeholder graphic instead
 * of a frame, so there is nothing to calibrate against.
 */
const GRANDLYON_CURATED_HEADINGS = Object.freeze({
  // Pont Clemenceau, looking east across the Saône toward the Croix-Rousse
  // tunnel portal. Road axis 90/100°, tunnel bearing 97°.
  CWL9018: 98,
  // A6/A7 at the Fourvière tunnel, toward Perrache. Axis 144/324°, Perrache 133°.
  // NOTE: this one is a high hillside panorama, not a pole over a lane — the
  // frame looks down on the tunnel mouth and across the Saône to the Presqu'île.
  // The heading is right, but the shared 10 m / 210 m pose prior is far too
  // short and low for it, so its monitor plane stops short of the motorway.
  // Height and range are the things to drag on this camera, not the bearing.
  CWL5801: 144,
  // Cours Albert Thomas eastbound toward Grange Blanche. Axis 115/295°,
  // Grange Blanche 116° — the closest agreement in the set.
  CWL3005: 115,
  // Boulevard Stalingrad northbound toward Caluire (336°). Two axes run through
  // this junction: the boulevard the camera actually sits on (184/4°, a 70 m
  // segment at 0 m) and the adjacent Voie Nouvelle Stalingrad-Vitton (168/348°).
  // The boulevard wins on the cap-lands-on-the-road check below: 4 m against
  // 54 m for 348°.
  CWL6165: 4,
  // Avenue de Böhlen westbound toward Carré de Soie. Axis 255/75°, La Soie 257°.
  CWVV011: 255,
  // Boulevard Pinel eastbound toward the A43. Axis 102/282°; the A43 leaves
  // Lyon east, and this is the eastbound twin of CW2L8114 at the same junction.
  CW1L8114: 102,
  // Same junction, westbound toward Lyon centre. Axis 115/295°, Bellecour 305°.
  // The frame shows the T2/T6 tram alignment running away toward the centre.
  CW2L8114: 295,
  // WEAK. Avenue du Général de Gaulle at the Bd des Droits de l'Homme junction.
  // Road axis 116/296°, but Eurexpo geocodes to 79° — a 37° disagreement that
  // the roundabout geometry does not resolve. Axis taken, sign from Eurexpo.
  CWBR044: 116,
  // Pont Poincaré looking south toward Villeurbanne. The bridge deck runs
  // 184/4° and the Part-Dieu towers — visible in the frame — bear 184-189° from
  // here, so both agree on 184°. (An earlier 172°, read off the towers sitting
  // right of frame centre, put the monitor plane 29 m off the deck; the deck
  // axis puts it 5 m on.)
  CW3CL005: 184,
  // WEAK. Boulevard de l'Université toward Porte des Alpes. Longest nearby
  // segment axis 139/319°, Porte des Alpes 107° — 32° apart.
  CWBR043: 139,
  // Bonnevay slip road at Croix-Luizet toward Porte de La Doua. Axis 241/61°,
  // La Doua 252°.
  CWVL802: 241,
  // Place Vauboin (the Tassin clock) toward Porte de Valvert. Road axis 40/220°.
  // Nominatim resolves "Valvert" to a street WEST of Tassin, which would give
  // 279° and contradict the road; the A6 access of that name is NORTH-EAST at
  // ~32°, and the shadow direction in the frame (sun ~118°, shadows falling to
  // frame-left) independently puts the camera in the 40-66° band.
  CWTA006: 40,
  // Pont de la Mulatière southbound toward the M7. Axis 167/347°,
  // Pierre-Bénite 167° — exact agreement.
  CWML005: 167,
  // A6 north of the Fourvière tunnel toward Paris. Axis 313/133°, Écully 305°.
  // The frame shows the tunnel portal behind-left and the motorway running away
  // to the north-west.
  CWL9801: 313,
});

/**
 * Convert one Grand Lyon "Caméras Web Criter" catalog row into a normalized CCTV
 * source, or null when the row is unusable.
 *
 * Rejects rows without a maintenance code (the stable per-camera key, and the
 * basename of the frame URL), without finite coordinates inside the Métropole,
 * with a frame URL off the official open-data origin (defense in depth: the
 * proxy only ever fetches catalog URLs, and this pins the catalog to the
 * published host), or whose frame stopped refreshing (see
 * GRANDLYON_MAX_FRAME_AGE_MS).
 *
 * The catalog's `observation` field reads "Direction : Porte de Gerland" — a
 * destination place name, not a compass bearing — so there is no heading signal
 * to read anywhere in the row. Two outcomes follow:
 *
 *   - A camera listed in GRANDLYON_CURATED_HEADINGS takes that hand-derived
 *     bearing, is flagged `poseSource: 'curated'` so the panel badge says so,
 *     and earns the tighter high-confidence pose personality (the same one
 *     Austin and Caltrans give a row that publishes a real direction field).
 *   - Any other camera falls back to the id-hash heading and the wide
 *     low-confidence personality, exactly like a headingless Austin row or any
 *     TfL JamCam.
 *
 * Either way the pose is a PRIOR, not a measurement: the client's one-shot
 * ground snap and the calibration gizmo still own the truth.
 *
 * @param {object} record - One entry from the catalog's `values` array.
 * @param {number} [nowMs=Date.now()] - Clock seam for the staleness check.
 * @returns {object|null} Normalized camera source, or null if rejected.
 */
export function normalizeGrandLyonCamera(record, nowMs = Date.now()) {
  if (!record || typeof record !== 'object') return null;

  const code = String(record.numeromaintenance || '').trim();
  if (!code) return null;
  const cameraId = `lyon-${code.toLowerCase()}`;

  const lat = toFiniteNumber(record.lat);
  const lon = toFiniteNumber(record.lon);
  if (!isLikelyLyonCoordinate(lat, lon)) return null;

  const imageUrl = String(record.url || '');
  if (!imageUrl.startsWith(GRANDLYON_IMAGE_ORIGIN)) return null; // official-origin pin

  // Fail open on a missing or unparseable stamp — a schema change upstream must
  // not blank the whole pack. Drop only a stamp that reads cleanly AND is stale.
  const stampedAt = Date.parse(String(record.last_update || '').replace(' ', 'T'));
  if (Number.isFinite(stampedAt) && nowMs - stampedAt > GRANDLYON_MAX_FRAME_AGE_MS) return null;

  // `libellelong` is where the camera stands ("Pont Clemenceau"); `nom` is what
  // it looks toward ("Tunnel Croix Rousse"). Show both when they differ.
  const site = String(record.libellelong || '').trim();
  const facing = String(record.nom || '').trim();
  const name = site && facing && site !== facing
    ? `${site} (dir. ${facing})`
    : (site || facing || `Caméra Criter ${code}`);

  const curatedHeading = GRANDLYON_CURATED_HEADINGS[code.toUpperCase()];
  const hasHeading = Number.isFinite(curatedHeading);

  return {
    id: cameraId,
    name,
    city: 'Lyon',
    cityId: 'lyon',
    provider: 'Métropole de Lyon (Criter)',
    lat,
    lon,
    headingDeg: hasHeading ? curatedHeading : fallbackHeadingFromId(cameraId),
    headingConfidence: hasHeading ? 'high' : 'low',
    // The same two pose personalities Austin and Caltrans use: a known facing
    // earns a narrower, longer, more steeply pitched frustum; a fabricated one
    // stays wide and short so it claims less ground than it can support.
    pitchDeg: hasHeading ? -24 : -18,
    fovDeg: hasHeading ? 56 : 44,
    rangeM: hasHeading ? 210 : 145,
    mountHeightM: hasHeading ? 10 : 8,
    groundElevationM: 170, // Rhône/Saône plain prior; the one-shot snap corrects.
    feedType: 'image',
    url: imageUrl,
    snapshotUrl: imageUrl,
    sourceKind: 'grandlyon-open-data',
    upstreamCadenceMs: GRANDLYON_UPSTREAM_CADENCE_MS,
    poseSource: hasHeading ? 'curated' : undefined,
    license: 'Licence Ouverte / Open Licence 2.0 — Métropole de Lyon',
  };
}

/**
 * Fetch the Métropole de Lyon "Caméras Web Criter" catalog (Lyon). Keyless: one
 * JSON list endpoint on the Grand Lyon open-data portal — no token, no quota —
 * and the frames sit on the same public host. Every rejection rule lives in
 * normalizeGrandLyonCamera; survivors are deduplicated by maintenance code and
 * distance-prioritized around Place Bellecour, so a lowered CCTV_LYON_MAX_SOURCES
 * keeps the city core rather than an arbitrary slice.
 *
 * Attribution: "Métropole de Lyon", Licence Ouverte / Open Licence 2.0
 * (registered in src/data/dataCredits.js).
 *
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl] - Injectable fetch for tests.
 * @param {number} [options.nowMs] - Clock seam, threaded into the row staleness check.
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
export async function loadLyonSourcesFromOpenData({ fetchImpl = fetch, nowMs = null } = {}) {
  try {
    const resp = await fetchImpl(GRANDLYON_CCTV_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.warn('[CCTV] Grand Lyon camera download failed:', resp.status);
      return [];
    }
    const payload = await resp.json();
    const rows = Array.isArray(payload?.values) ? payload.values : [];
    if (!rows.length) return [];

    const clock = Number.isFinite(nowMs) ? nowMs : Date.now();
    const cameras = [];
    for (const row of rows) {
      const camera = normalizeGrandLyonCamera(row, clock);
      if (camera) cameras.push(camera);
    }
    const unique = Array.from(new Map(cameras.map((camera) => [camera.id, camera])).values());

    const maxRaw = Number(process.env.CCTV_LYON_MAX_SOURCES || DEFAULT_LYON_MAX_SOURCES);
    const maxCount = Number.isFinite(maxRaw)
      ? Math.max(8, Math.min(300, Math.floor(maxRaw)))
      : DEFAULT_LYON_MAX_SOURCES;
    const prioritized = prioritizeSources(unique, maxCount, [LYON_CENTER]);
    console.log(`[CCTV] Loaded Grand Lyon camera sources: ${unique.length} live (using nearest ${prioritized.length})`);
    return prioritized;
  } catch (error) {
    console.warn('[CCTV] Grand Lyon camera download error:', error?.message || error);
    return [];
  }
}

/** Upstream cadences outside 1 s..5 min are treated as unset. */
const MIN_UPSTREAM_CADENCE_MS = 1_000;
const MAX_UPSTREAM_CADENCE_MS = 5 * 60 * 1000;

/**
 * Clamp a declared upstream frame cadence, or return null when absent/invalid.
 *
 * @param {*} value
 * @returns {number|null}
 */
function boundedUpstreamCadenceMs(value) {
  const ms = toFiniteNumber(value, NaN);
  if (!Number.isFinite(ms) || ms < MIN_UPSTREAM_CADENCE_MS) return null;
  return Math.min(MAX_UPSTREAM_CADENCE_MS, Math.round(ms));
}

/**
 * Normalize a raw CCTV source item into a canonical shape with safe defaults.
 *
 * @param {object} item - Raw source from file, env, or a live open-data pack.
 * @returns {object} Normalized source with all expected fields populated.
 */
function normalizeSourceItem(item) {
  return {
    id: String(item.id || '').trim(),
    name: String(item.name || item.id || '').trim(),
    city: String(item.city || ''),
    cityId: String(item.cityId || ''),
    provider: String(item.provider || 'Configured CCTV Source'),
    lat: toFiniteNumber(item.lat),
    lon: toFiniteNumber(item.lon),
    headingDeg: toFiniteNumber(item.headingDeg),
    headingConfidence: String(item.headingConfidence || item.headingSource || '').toLowerCase(),
    pitchDeg: toFiniteNumber(item.pitchDeg),
    fovDeg: toFiniteNumber(item.fovDeg),
    rangeM: toFiniteNumber(item.rangeM),
    mountHeightM: toFiniteNumber(item.mountHeightM),
    groundElevationM: toFiniteNumber(item.groundElevationM),
    feedType: normalizeFeedType(item.feedType || item.type || ''),
    url: typeof item.url === 'string' ? item.url : '',
    snapshotUrl: typeof item.snapshotUrl === 'string' ? item.snapshotUrl : '',
    license: String(item.license || item.licenseNote || ''),
    sourceKind: String(item.sourceKind || item.kind || 'configured'),
    // How often the PUBLISHER produces a new frame (not how often the client
    // polls). Absent for packs whose cadence has not been measured; bounded so
    // a bad catalog value cannot stall a feed for minutes. Consumers derive
    // their own poll rate from it — see activeFrameRefreshMs in cctv.js.
    upstreamCadenceMs: boundedUpstreamCadenceMs(item.upstreamCadenceMs),
    // Optional CAL badge input (cctv-v2 design §3b/§9.2): a source may declare
    // poseSource:'curated' so the panel badge can distinguish a hand-authored
    // pose from a raw automated prior (Austin Open Data never sets this field).
    // Hand-authored file/env entries use it, and so does the Grand Lyon pack for
    // the cameras in GRANDLYON_CURATED_HEADINGS. Passed through as-is.
    poseSource: item.poseSource === 'curated' ? 'curated' : undefined,
  };
}

/**
 * Assemble and cache the merged CCTV source list.
 *
 * Merges the live open-data packs (Austin, Caltrans, TfL, Grand Lyon) with the
 * local file and env packs, deduplicates by ID, applies the global max cap, and
 * caches for CCTV_SOURCE_CACHE_MS.
 *
 * @returns {Promise<Array<object>>} Deduplicated, capped source list.
 */
async function getCctvSources() {
  const now = Date.now();
  if (_cctvSourceCache.length && now - _cctvSourceCacheAt <= CCTV_SOURCE_CACHE_MS) {
    return _cctvSourceCache;
  }
  // Single-flight: a burst of requests arriving past the TTL shares ONE refresh
  // instead of each launching the full multi-provider refetch. The `.finally`
  // clears the ref so the next post-TTL cycle starts fresh.
  if (_cctvSourceInflight) return _cctvSourceInflight;
  _cctvSourceInflight = refreshCctvSources().finally(() => { _cctvSourceInflight = null; });
  return _cctvSourceInflight;
}

/**
 * Assemble and cache the merged CCTV source list from file/env + live packs.
 * Always resolves (loaders self-catch to []); on a fully-empty refresh with a
 * good prior catalog it serves stale rather than blanking the CCTV layer.
 *
 * @returns {Promise<Array<object>>} Deduplicated, capped source list.
 */
async function refreshCctvSources() {
  const fromFile = loadSourcesFromFile();
  const fromEnv = loadSourcesFromEnv();

  const forceAustin = String(process.env.CCTV_FORCE_AUSTIN || '').trim() === '1';
  const preferAustin = String(process.env.CCTV_PREFER_AUSTIN || '1').trim() !== '0';
  // Live open-data packs (Austin + Caltrans + TfL + Grand Lyon) load unless a
  // file/env pack is configured and live packs aren't forced — same gate that
  // governed the Austin-only fetch, now governing all four. Each pack fails
  // independently.
  const needsLiveSources = forceAustin || ((fromFile.length + fromEnv.length) === 0 && preferAustin);
  const tflEnabled = String(process.env.CCTV_TFL_ENABLED || '1').trim() !== '0';
  const lyonEnabled = String(process.env.CCTV_LYON_ENABLED || '1').trim() !== '0';

  let fromAustin = [];
  let fromCaltrans = [];
  let fromTfl = [];
  let fromLyon = [];
  if (needsLiveSources) {
    const [austinResult, caltransResult, tflResult, lyonResult] = await Promise.allSettled([
      loadAustinSourcesFromOpenData(),
      loadCaltransSourcesFromOpenData(),
      tflEnabled ? loadTflSourcesFromOpenData() : Promise.resolve([]),
      lyonEnabled ? loadLyonSourcesFromOpenData() : Promise.resolve([]),
    ]);
    fromAustin = austinResult.status === 'fulfilled' ? austinResult.value : [];
    fromCaltrans = caltransResult.status === 'fulfilled' ? caltransResult.value : [];
    fromTfl = tflResult.status === 'fulfilled' ? tflResult.value : [];
    fromLyon = lyonResult.status === 'fulfilled' ? lyonResult.value : [];
  }

  // OSM mapped cameras are deliberately NOT in this catalog: they carry no
  // frames, and they are loaded per viewport through /api/osm-cameras and merged
  // into the live layer, so this stays the set of packs that do carry frames.
  // Live sources first so file/env overrides win on duplicate IDs (Map last-write).
  const merged = [...fromAustin, ...fromCaltrans, ...fromTfl, ...fromLyon, ...fromFile, ...fromEnv];

  // Deduplicate by camera ID (last-write wins because of Map.set)
  const byId = new Map();
  for (const item of merged) {
    if (!item || typeof item !== 'object') continue;
    const normalized = normalizeSourceItem(item);
    if (!normalized.id) continue;
    byId.set(normalized.id, normalized);
  }

  const mergedSources = Array.from(byId.values());
  const maxRaw = Number(process.env.CCTV_MAX_SOURCES || DEFAULT_CCTV_MAX_SOURCES);
  const maxCount = Number.isFinite(maxRaw) ? Math.max(8, Math.min(1200, Math.floor(maxRaw))) : DEFAULT_CCTV_MAX_SOURCES;
  if (mergedSources.length > maxCount) {
    console.warn(`[CCTV] source catalog ${mergedSources.length} exceeds cap ${maxCount}; keeping the first ${maxCount} (raise CCTV_MAX_SOURCES or lower a per-pack cap to change which).`);
  }
  const capped = mergedSources.length > maxCount ? mergedSources.slice(0, maxCount) : mergedSources;
  if (capped.length > 0 || _cctvSourceCache.length === 0) {
    _cctvSourceCache = capped;
  } else {
    // Every source came back empty (all live packs timed out / upstream outage)
    // but a good catalog is already cached — serve it stale rather than blanking
    // every CCTV route. Advancing the timestamp waits one TTL before retrying,
    // which (with single-flight) bounds load on a persistently-down upstream.
    console.warn(`[CCTV] source refresh returned empty; serving ${_cctvSourceCache.length} stale cameras`);
  }
  _cctvSourceCacheAt = Date.now();
  return _cctvSourceCache;
}

/**
 * Generate a synthetic SVG billboard image for a CCTV camera placeholder.
 *
 * Produces a 960x540 SVG with a deterministic gradient (hue derived from
 * camera ID hash), scanline overlay, HUD-style grid, and text labels
 * showing camera name, city, ID, status, and current timestamp. Used
 * when no upstream image or Street View fallback is available.
 *
 * @param {object} opts
 * @param {string} opts.cameraId
 * @param {string} opts.label
 * @param {string} [opts.city]
 * @param {string} [opts.status]
 * @returns {string} SVG markup string.
 */
function buildSyntheticCctvSvg({ cameraId, label, city, status }) {
  const seed = hashSeed(`${cameraId}:${label}:${city}`);
  const hue = seed % 360;
  const hue2 = (hue + 46) % 360;
  const now = new Date();
  const ts = now.toISOString().replace('T', ' ').replace('Z', 'Z').slice(0, 20);
  const safeLabel = escapeXml(label);
  const safeCity = escapeXml(city || 'GLOBAL GRID');
  const safeId = escapeXml(cameraId);
  const safeStatus = escapeXml(status || 'SYNTHETIC');

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue}, 35%, 10%)" />
      <stop offset="60%" stop-color="hsl(${hue2}, 42%, 6%)" />
      <stop offset="100%" stop-color="#020509" />
    </linearGradient>
    <radialGradient id="flare" cx="0.22" cy="0.24" r="0.78">
      <stop offset="0%" stop-color="hsla(${hue2}, 100%, 65%, 0.35)" />
      <stop offset="100%" stop-color="hsla(${hue2}, 100%, 40%, 0)" />
    </radialGradient>
    <pattern id="scan" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill="transparent" />
      <rect y="0" width="8" height="1" fill="rgba(255,255,255,0.08)" />
      <rect y="4" width="8" height="1" fill="rgba(255,255,255,0.05)" />
    </pattern>
  </defs>
  <rect width="960" height="540" fill="url(#bg)" />
  <rect width="960" height="540" fill="url(#flare)" />
  <rect width="960" height="540" fill="url(#scan)" />
  <g stroke="rgba(123,233,255,0.25)" stroke-width="1" fill="none">
    <path d="M60 460 Q300 300 520 420 T900 320" />
    <path d="M100 160 Q340 40 620 130 T920 90" />
    <path d="M20 280 Q220 230 390 270 T760 250" />
  </g>
  <g fill="none" stroke="rgba(180,248,255,0.2)" stroke-width="1">
    <rect x="70" y="80" width="820" height="380" rx="8" />
    <line x1="70" y1="270" x2="890" y2="270" />
    <line x1="480" y1="80" x2="480" y2="460" />
  </g>
  <g fill="#9cefff" font-family="JetBrains Mono, monospace" text-transform="uppercase">
    <text x="74" y="54" font-size="16" letter-spacing="2">CCTV FEED PLACEHOLDER</text>
    <text x="74" y="512" font-size="14" letter-spacing="1.5">${safeLabel} · ${safeCity}</text>
    <text x="646" y="512" font-size="13" letter-spacing="1.2">${safeId}</text>
    <text x="704" y="54" font-size="15" letter-spacing="2">${escapeXml(ts)}</text>
    <text x="74" y="486" font-size="13" letter-spacing="1.3">${safeStatus}</text>
  </g>
</svg>`.trim();
}

/**
 * Coerce a fetch() response body to a Node.js Readable stream.
 *
 * Handles both Node-native streams (.pipe) and web ReadableStreams (.getReader).
 *
 * @param {ReadableStream|NodeJS.ReadableStream|null} body
 * @returns {import('stream').Readable|null}
 */
function toReadable(body) {
  if (!body) return null;
  if (typeof body.pipe === 'function') return body;
  if (typeof body.getReader === 'function') {
    return Readable.fromWeb(body);
  }
  return null;
}

/**
 * Pipe an upstream fetch Response (image or video) to the client HTTP response.
 *
 * Forwards Content-Type, Content-Length, Content-Range, Accept-Ranges, and
 * Cache-Control headers from the upstream. Falls back to buffered arrayBuffer
 * if the body is not streamable.
 *
 * @param {import('http').ServerResponse} res
 * @param {Response} upstream - fetch() Response object.
 * @param {object} [opts]
 * @param {string} [opts.sourceHeader='upstream'] - Value for X-CCTV-Source header.
 */
/**
 * Read a fetch Response body as text while enforcing a hard byte cap during
 * the read — so a malicious or buggy upstream that streams an unbounded body
 * (no/oversized Content-Length, chunked) can't OOM the proxy. Returns
 * { tooLarge, text }. Cancels the stream as soon as the cap is crossed.
 * @param {Response} upstream - fetch() response.
 * @param {number} maxBytes - hard ceiling on decoded bytes.
 * @returns {Promise<{tooLarge: boolean, text: string}>}
 */
async function readCappedResponseText(upstream, maxBytes) {
  const declared = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    try { await upstream.body?.cancel(); } catch { /* no-op */ }
    return { tooLarge: true, text: '' };
  }
  if (!upstream.body || typeof upstream.body[Symbol.asyncIterator] !== 'function') {
    const text = await upstream.text();
    return text.length > maxBytes ? { tooLarge: true, text: '' } : { tooLarge: false, text };
  }
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  for await (const chunk of upstream.body) {
    total += chunk.length;
    if (total > maxBytes) {
      try { await upstream.body.cancel(); } catch { /* no-op */ }
      return { tooLarge: true, text: '' };
    }
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return { tooLarge: false, text };
}

async function proxyMediaResponse(res, upstream, { sourceHeader = 'upstream' } = {}) {
  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const cacheControl = upstream.headers.get('cache-control') || 'no-store';
  const contentLength = upstream.headers.get('content-length');
  const contentRange = upstream.headers.get('content-range');
  const acceptRanges = upstream.headers.get('accept-ranges');
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
    'X-CCTV-Source': sourceHeader,
  };
  if (contentLength) headers['Content-Length'] = contentLength;
  if (contentRange) headers['Content-Range'] = contentRange;
  if (acceptRanges) headers['Accept-Ranges'] = acceptRanges;

  // Cheap defense: reject an upstream that DECLARES an oversized fixed body.
  // Live MJPEG/HLS streams are unbounded by design and send no content-length,
  // so they pipe normally (piping streams to the client, never buffering).
  const MEDIA_DECLARED_CAP_BYTES = 64 * 1024 * 1024;
  if (Number.isFinite(Number(contentLength)) && Number(contentLength) > MEDIA_DECLARED_CAP_BYTES) {
    res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'Upstream media exceeds size cap' }));
    try { await upstream.body?.cancel(); } catch { /* no-op */ }
    return;
  }

  res.writeHead(upstream.status, headers);

  const stream = toReadable(upstream.body);
  if (!stream) {
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
    return;
  }

  stream.on('error', () => {
    if (!res.writableEnded) res.end();
  });
  stream.pipe(res);
}

/**
 * Fetch one upstream CCTV image within the frame-refresh budget.
 *
 * A timeout is treated like every other upstream miss so the caller can
 * continue through the Street View and synthetic fallback chain. `fetchImpl`
 * and `timeoutMs` are injectable only to keep the timeout contract unit-testable.
 *
 * @param {string} url - Server-registered upstream image URL.
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl=fetch] - Fetch implementation.
 * @param {number} [options.timeoutMs=CCTV_FRAME_FETCH_TIMEOUT_MS] - Abort timeout.
 * @returns {Promise<{ok:true,body:Buffer,contentType:string}|null>}
 */
/**
 * Is this JPEG body cut off before the end of its scan data?
 *
 * Nothing in the response says so: a valid HTTP 200, no Content-Length to fall
 * short of (the host answers chunked), no error status, and the SOF header
 * still declares the full frame size. The browser decodes the rows it received
 * and leaves the rest transparent — which is how a 1920x1440 camera renders as
 * a thin strip of sky.
 *
 * Measured on CWL5801, the largest frame in the Grand Lyon pack: 12 fetches
 * 7 s apart, 0 complete. The byte count was STABLE within each publication
 * minute (141,620 B five times, then 306,600 B seven times) and changed only
 * when a new frame was published, so this is not a read-while-write race that a
 * retry would win — the file the Métropole publishes for that camera is itself
 * incomplete, every cycle. libjpeg rejects it outright: "premature end of JPEG
 * image". Hence: no retry, straight to the fallback chain.
 *
 * The test is the JPEG end-of-image marker, scanned across the tail of the file
 * (see JPEG_EOI_SCAN_BYTES) so a camera that appends trailing metadata is not
 * called truncated. Anything that is not a JPEG is left alone — this fails OPEN
 * in every direction.
 *
 * @param {Buffer|Uint8Array|null} body
 * @returns {boolean}
 */
export function isTruncatedJpegFrame(body) {
  if (!body || body.length < 4) return false;
  if (body[0] !== 0xFF || body[1] !== 0xD8) return false; // not a JPEG: not our call
  const from = Math.max(2, body.length - JPEG_EOI_SCAN_BYTES);
  for (let i = body.length - 2; i >= from; i -= 1) {
    if (body[i] === 0xFF && body[i + 1] === 0xD9) return false;
  }
  return true;
}

/**
 * Is this frame body a known provider "camera unavailable" placeholder rather
 * than a real capture?
 *
 * @param {Buffer|Uint8Array|null} body
 * @returns {boolean}
 */
export function isPlaceholderCctvFrame(body) {
  if (!body || !body.length) return false;
  const digest = createHash('sha256').update(body).digest('hex');
  return CCTV_PLACEHOLDER_FRAME_SHA256.includes(digest);
}

export async function fetchCctvImageFromUpstream(url, {
  fetchImpl = fetch,
  timeoutMs = CCTV_FRAME_FETCH_TIMEOUT_MS,
} = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException('CCTV upstream frame fetch timed out', 'TimeoutError'));
  }, timeoutMs);
  try {
    const upstream = await fetchImpl(url, {
      headers: { 'User-Agent': 'gods-eye-view-cctv-proxy/1.0' },
      signal: controller.signal,
    });
    const contentType = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !contentType.startsWith('image/')) return null;
    return {
      ok: true,
      body: Buffer.from(await upstream.arrayBuffer()),
      contentType,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Vite plugin: CCTV camera proxy with source registry, frame/media serving,
 * fallback chain (upstream -> Street View -> synthetic SVG), and health tracking.
 *
 * Endpoints:
 *   GET /api/cctv/sources        — list all registered camera sources
 *   GET /api/cctv/health         — per-camera health/status report
 *   GET /api/cctv/stream/:id     — stream info (feedType, URLs) for a camera
 *   GET /api/cctv/media/:id      — proxy live video/image media from upstream
 *   GET /api/cctv/frame/:id      — single frame with fallback chain
 *
 * @returns {import('vite').Plugin}
 */
function cctvProxy() {
  /** @type {Map<string,{id:string,status:string,sourceKind:string,label:string,message:string,updatedAt:number}>} */
  const health = new Map();
  /** Cap on health map entries to prevent unbounded growth. Sized to cover the
   * full served catalog (CCTV_MAX_SOURCES hard-bounds at 1200) so health/status
   * observability isn't silently evicted for a default 800-camera catalog. */
  const HEALTH_MAX_ENTRIES = 1200;

  /** Update the health entry for a camera, evicting the oldest entry if at capacity. */
  const setHealth = (cameraId, patch) => {
    // Evict oldest entries if the health map grows beyond the cap
    if (!health.has(cameraId) && health.size >= HEALTH_MAX_ENTRIES) {
      const oldest = health.keys().next().value;
      health.delete(oldest);
    }
    const prev = health.get(cameraId) || {};
    health.set(cameraId, {
      id: cameraId,
      status: patch.status || prev.status || 'unknown',
      sourceKind: patch.sourceKind || prev.sourceKind || 'unknown',
      label: patch.label || prev.label || '',
      message: patch.message || prev.message || '',
      updatedAt: Date.now(),
    });
  };

  /** Snapshot all camera health entries as an array. */
  const listHealth = () => Array.from(health.values());

  /** Build a JSON payload describing stream info (feedType, URLs) for a camera. */
  const buildStreamPayload = (source, cameraId) => {
    const feedType = normalizeFeedType(source?.feedType || 'image');
    return {
      id: cameraId,
      feedType,
      mediaUrl: isVideoFeedType(feedType)
        ? `/api/cctv/media/${encodeURIComponent(cameraId)}`
        : null,
      frameUrl: `/api/cctv/frame/${encodeURIComponent(cameraId)}`,
      provider: source?.provider || '',
      sourceKind: source?.sourceKind || (source?.url ? 'configured' : 'fallback'),
    };
  };

  /** Fetch a Google Street View static image as a fallback frame. Requires GOOGLE_MAPS_API_KEY. */
  const streetViewFallback = async ({ lat, lon, heading, fov, pitch }) => {
    const streetViewKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!streetViewKey || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    try {
      const sv = new URL('https://maps.googleapis.com/maps/api/streetview');
      sv.searchParams.set('size', '960x540');
      sv.searchParams.set('location', `${lat},${lon}`);
      sv.searchParams.set('heading', String(Number.isFinite(heading) ? heading : 0));
      sv.searchParams.set('fov', String(Number.isFinite(fov) ? Math.max(20, Math.min(120, fov)) : 80));
      sv.searchParams.set('pitch', String(Number.isFinite(pitch) ? Math.max(-40, Math.min(20, pitch)) : 0));
      sv.searchParams.set('source', 'outdoor');
      sv.searchParams.set('return_error_code', 'true');
      sv.searchParams.set('key', streetViewKey);

      const svResp = await fetch(sv.toString(), {
        headers: { 'User-Agent': 'gods-eye-view-cctv-proxy/1.0' },
        signal: AbortSignal.timeout(CCTV_FRAME_FETCH_TIMEOUT_MS),
      });
      const svType = svResp.headers.get('content-type') || '';
      if (!svResp.ok || !svType.startsWith('image/')) return null;

      return {
        ok: true,
        body: Buffer.from(await svResp.arrayBuffer()),
        contentType: svType,
      };
    } catch {
      return null;
    }
  };

  return {
    name: 'cctv-proxy',
    configureServer(server) {
      server.middlewares.use('/api/cctv', async (req, res) => {
        try {
          const sources = await getCctvSources();
          const sourceById = new Map(sources.map((source) => [source.id, source]));
          const url = new URL(req.url || '/', 'http://localhost');

          if (url.pathname === '/sources') {
            const body = {
              sources: sources.map((source) => ({
                id: source.id,
                name: source.name,
                city: source.city,
                cityId: source.cityId,
                provider: source.provider,
                lat: source.lat,
                lon: source.lon,
                headingDeg: source.headingDeg,
                headingConfidence: source.headingConfidence || '',
                pitchDeg: source.pitchDeg,
                fovDeg: source.fovDeg,
                rangeM: source.rangeM,
                mountHeightM: source.mountHeightM,
                groundElevationM: source.groundElevationM,
                feedType: normalizeFeedType(source.feedType),
                sourceKind: source.sourceKind || (source.url ? 'configured' : 'fallback'),
                upstreamCadenceMs: source.upstreamCadenceMs,
                poseSource: source.poseSource,
                license: source.license,
              })),
            };
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(body));
            return;
          }

          if (url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ cameras: listHealth() }));
            return;
          }

          if (url.pathname.startsWith('/stream/')) {
            const cameraId = decodeURIComponent(url.pathname.replace('/stream/', '').trim()) || 'camera';
            const source = sourceById.get(cameraId);
            const payload = buildStreamPayload(source, cameraId);
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(payload));
            return;
          }

          if (url.pathname.startsWith('/media/')) {
            const cameraId = decodeURIComponent(url.pathname.replace('/media/', '').trim()) || 'camera';
            const source = sourceById.get(cameraId);
            const mediaUrl = source?.url || '';
            const feedType = normalizeFeedType(source?.feedType || 'image');

            if (!mediaUrl || !/^https?:\/\//i.test(mediaUrl)) {
              setHealth(cameraId, {
                status: 'degraded',
                sourceKind: 'fallback',
                label: source?.provider || 'No upstream URL',
                message: 'No stream URL configured',
              });
              res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
              res.end(JSON.stringify({ error: 'No media URL configured for this camera' }));
              return;
            }

            try {
              const upstreamHeaders = { 'User-Agent': 'gods-eye-view-cctv-proxy/1.0' };
              const requestRange = req.headers?.range;
              if (requestRange) upstreamHeaders.Range = requestRange;
              const upstream = await fetch(mediaUrl, {
                headers: upstreamHeaders,
              });
              const contentType = upstream.headers.get('content-type') || '';
              if (!upstream.ok) {
                setHealth(cameraId, {
                  status: 'degraded',
                  sourceKind: 'upstream',
                  label: source?.provider || 'Configured source',
                  message: `Upstream HTTP ${upstream.status}`,
                });
                res.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                res.end(JSON.stringify({ error: `Upstream returned ${upstream.status}` }));
                return;
              }

              if (isVideoFeedType(feedType) && !(contentType.startsWith('video/') || contentType.includes('mpegurl'))) {
                setHealth(cameraId, {
                  status: 'degraded',
                  sourceKind: 'upstream',
                  label: source?.provider || 'Configured source',
                  message: `Unexpected media type ${contentType || 'unknown'}`,
                });
              } else {
                setHealth(cameraId, {
                  status: 'ok',
                  sourceKind: isVideoFeedType(feedType) ? 'live' : 'snapshot',
                  label: source?.provider || 'Configured source',
                  message: isVideoFeedType(feedType) ? 'Live stream connected' : 'Snapshot feed connected',
                });
              }

              await proxyMediaResponse(res, upstream, {
                sourceHeader: isVideoFeedType(feedType) ? 'live-media' : 'upstream-image',
              });
              return;
            } catch (error) {
              setHealth(cameraId, {
                status: 'degraded',
                sourceKind: 'upstream',
                label: source?.provider || 'Configured source',
                message: error?.message || 'Media fetch failed',
              });
              res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
              res.end(JSON.stringify({ error: 'Media proxy failed' }));
              return;
            }
          }

          if (!url.pathname.startsWith('/frame/')) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'not found' }));
            return;
          }

          const cameraId = decodeURIComponent(url.pathname.replace('/frame/', '').trim()) || 'camera';
          const source = sourceById.get(cameraId);
          const label = url.searchParams.get('label') || source?.name || cameraId;
          const city = url.searchParams.get('city') || source?.city || '';
          const lat = Number(url.searchParams.get('lat') || source?.lat);
          const lon = Number(url.searchParams.get('lon') || source?.lon);
          const heading = Number(url.searchParams.get('heading') || source?.headingDeg);
          const fov = Number(url.searchParams.get('fov') || source?.fovDeg);
          const pitch = Number(url.searchParams.get('pitch') || source?.pitchDeg);

          // Only use server-registered upstream URLs — never accept client-supplied URLs
          // (prevents SSRF via ?upstream= query parameter)
          const upstreamCandidate =
            source?.snapshotUrl
            || (!isVideoFeedType(normalizeFeedType(source?.feedType)) ? source?.url : '');

          const fetched = await fetchCctvImageFromUpstream(upstreamCandidate);
          // A placeholder is a valid 200 image of "no camera here". Treating it
          // as a failed fetch drops it into the same Street View / synthetic
          // chain a timeout uses, and keeps the health line honest.
          // Two ways a 200 OK can still not be a frame: the provider's "camera
          // unavailable" graphic, and a JPEG published incomplete. Both are
          // treated as a failed fetch so they drop into the same Street View /
          // synthetic chain a timeout uses.
          const servedPlaceholder = fetched?.ok && isPlaceholderCctvFrame(fetched.body);
          const servedTruncated = fetched?.ok && !servedPlaceholder && isTruncatedJpegFrame(fetched.body);
          const upstreamImage = (servedPlaceholder || servedTruncated) ? null : fetched;
          // Carried into whichever fallback answers, so the panel says WHY the
          // real frame is missing instead of just naming its replacement.
          const placeholderNote = servedPlaceholder
            ? ' — provider is serving an "image unavailable" placeholder'
            : servedTruncated
              ? ' — provider frame is incomplete (JPEG ends before its scan data)'
              : '';
          if (upstreamImage?.ok) {
            setHealth(cameraId, {
              status: 'ok',
              sourceKind: 'snapshot',
              label: source?.provider || 'Configured source',
              message: 'Upstream snapshot active',
            });
            res.writeHead(200, {
              'Content-Type': upstreamImage.contentType,
              'Cache-Control': 'no-store',
              'X-CCTV-Source': 'upstream-image',
            });
            res.end(upstreamImage.body);
            return;
          }

          const sv = await streetViewFallback({ lat, lon, heading, fov, pitch });
          if (sv?.ok) {
            setHealth(cameraId, {
              status: 'degraded',
              sourceKind: 'streetview',
              label: 'Google Street View',
              message: `Fallback Street View frame${placeholderNote}`,
            });
            res.writeHead(200, {
              'Content-Type': sv.contentType,
              'Cache-Control': 'no-store',
              'X-CCTV-Source': 'streetview',
            });
            res.end(sv.body);
            return;
          }

          const svg = buildSyntheticCctvSvg({
            cameraId,
            label,
            city,
            status: source?.url ? 'UPSTREAM UNAVAILABLE' : 'NO UPSTREAM CONFIGURED',
          });

          setHealth(cameraId, {
            status: 'degraded',
            sourceKind: 'synthetic',
            label: source?.provider || 'Synthetic fallback',
            message: (source?.url ? 'Upstream unavailable' : 'No source configured') + placeholderNote,
          });

          res.writeHead(200, {
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'no-store',
            'X-CCTV-Source': 'synthetic',
          });
          res.end(svg);
        } catch (error) {
          console.error('[CCTV Proxy]', error?.message || String(error));
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'CCTV proxy error' }));
        }
      });
    },
  };
}

/**
 * Vite plugin: adsb.lol military aircraft proxy with 12 s response cache.
 *
 * Proxies GET /api/adsblol/mil to https://api.adsb.lol/v2/mil. On upstream
 * failure, serves a stale cached response if one exists.
 *
 * @returns {import('vite').Plugin}
 */
function adsbLolProxy() {
  /** @type {string|null} Cached upstream JSON body. */
  let _cache = null;
  /** @type {number} Epoch-ms when the cache was populated. */
  let _cacheAt = 0;
  /** Response cache TTL (ms). */
  const CACHE_MS = 12000;
  return {
    name: 'adsblol-proxy',
    configureServer(server) {
      server.middlewares.use('/api/adsblol/mil', async (req, res) => {
        try {
          const now = Date.now();
          if (_cache && now - _cacheAt < CACHE_MS) {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-ADS-B-Cache': 'HIT' });
            res.end(_cache);
            return;
          }
          const upstream = await fetch('https://api.adsb.lol/v2/mil', {
            headers: { 'User-Agent': 'gods-eye-view-adsblol-proxy/1.0' },
          });
          const body = await upstream.text();
          if (upstream.ok) {
            _cache = body;
            _cacheAt = now;
          }
          res.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-ADS-B-Cache': 'MISS' });
          res.end(body);
        } catch (e) {
          console.error('[adsb.lol Proxy]', e.message);
          if (_cache) {
            res.writeHead(200, { 'Content-Type': 'application/json', 'X-ADS-B-Cache': 'STALE' });
            res.end(_cache);
            return;
          }
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'ADS-B proxy error' }));
        }
      });
    },
  };
}

/**
 * Vite plugin: AISStream live vessel cache.
 *
 * AISStream does not support browser CORS and requires a private API key, so
 * the Vite server keeps one backend websocket open and exposes a same-origin
 * JSON snapshot to the Cesium layer.
 */
function aisLiveProxy() {
  function install(middlewares) {
    middlewares.use('/api/ais-live', async (req, res) => {
      try {
        ensureAisStreamConnection();
        const incoming = new URL(req.url || '', 'http://localhost');

        // Track sub-route MUST be handled before the rows snapshot — this
        // mount prefix-matches every subpath, so without this branch
        // /api/ais-live/track would be silently answered with vessel rows.
        if (incoming.pathname === '/track' || incoming.pathname.startsWith('/track/')) {
          const mmsi = String(incoming.searchParams.get('mmsi') || '').trim();
          res.statusCode = /^\d{5,10}$/.test(mmsi) ? 200 : 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          if (res.statusCode !== 200) {
            res.end(JSON.stringify({ error: 'mmsi query param required', samples: [] }));
            return;
          }
          res.end(JSON.stringify({
            mmsi,
            samples: readAisTrack(mmsi),
            source: 'AISStream (accumulated since server start)',
            retainedSec: Math.floor(AISSTREAM_STALE_MS / 1000),
          }));
          return;
        }

        const maxRows = clampInt(incoming.searchParams.get('maxRows'), 1, AISSTREAM_CACHE_MAX, AISSTREAM_CACHE_MAX);
        const rows = aisStreamRows(maxRows);

        const feed = aisStreamStatusSnapshot();

        res.statusCode = process.env.AISSTREAM_API_KEY ? 200 : 503;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({
          rows,
          source: 'AISStream',
          status: feed.status,
          error: feed.error,
          refreshing: feed.status !== 'live',
          newestPositionAt: newestAisPositionAt(rows),
          lastMessageAt: feed.lastMessageAt,
          // Honest-failure metadata: how long the feed has been quiet, which
          // recovery attempt we are on, and when the next one lands.
          silentForMs: feed.silentForMs,
          reconnectAttempt: feed.reconnectAttempt,
          nextAttemptAt: feed.nextAttemptAt,
          staleAfterMs: feed.staleAfterMs,
          watchdog: feed.watchdog,
        }));
      } catch (error) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ error: error?.message || 'AIS live stream error', rows: [] }));
      }
    });
  }

  return {
    name: 'ais-live-proxy',
    configureServer(server) {
      install(server.middlewares);
      startAisStreamWatchdogTick();
      // Vite restarts the server in-process on a config change while this
      // module's state survives; without teardown each reload stacks another
      // interval and another socket.
      server.httpServer?.on('close', disposeAisStream);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
      startAisStreamWatchdogTick();
      server.httpServer?.on('close', disposeAisStream);
    },
    // Middleware-mode backstop: there is no httpServer to hang 'close' on.
    closeBundle() {
      disposeAisStream();
    },
  };
}

/**
 * Vite plugin: aircraft track-history backfill proxies (PRD WS-F F1/F2).
 *
 * /api/opensky-track?icao24=<hex6> — OpenSky GET /tracks/all (experimental;
 *   own credit bucket, 4 credits per call on the free tier). OAuth via the
 *   shared coalesced token. 60s per-icao cache; 404/429 forwarded so the
 *   client can fall back to its accumulated trail silently.
 * /api/adsblol/trace?hex=<hex> — adsb.lol tar1090 readsb trace
 *   (undocumented but live; no browser CORS, hence this proxy). Up to ~24h
 *   of real history per aircraft. Treat as best-effort; data is ODbL —
 *   credit "adsb.lol (ODbL)" in the UI.
 */
function trackBackfillProxies() {
  const TRACK_CACHE_MS = 60000;
  const TRACK_CACHE_MAX = 200;
  const RESPONSE_CAP_BYTES = 5 * 1024 * 1024;
  /** @type {Map<string, {at:number,status:number,body:string}>} */
  const cache = new Map();

  function cachePut(key, entry) {
    cache.set(key, entry);
    if (cache.size > TRACK_CACHE_MAX) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) cache.delete(oldest[0]);
    }
  }

  async function proxyJson(res, key, upstreamUrl, headers = {}) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < TRACK_CACHE_MS) {
      res.statusCode = cached.status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(cached.body);
      return;
    }
    const upstream = await fetch(upstreamUrl, { headers, signal: AbortSignal.timeout(12000) });
    const { tooLarge, text } = await readCappedResponseText(upstream, RESPONSE_CAP_BYTES);
    let body;
    if (tooLarge) {
      body = JSON.stringify({ error: 'Upstream track response too large' });
    } else if (!upstream.ok) {
      // Sanitize upstream error surface; status code is signal enough
      body = JSON.stringify({ error: `Track source HTTP ${upstream.status}` });
    } else {
      body = text;
    }
    cachePut(key, { at: Date.now(), status: upstream.status, body });
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  }

  function install(middlewares) {
    middlewares.use('/api/opensky-track', async (req, res) => {
      try {
        const incoming = new URL(req.url || '', 'http://localhost');
        const icao24 = String(incoming.searchParams.get('icao24') || '').trim().toLowerCase();
        if (!/^[0-9a-f]{6}$/.test(icao24)) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'icao24 must be a 6-char hex string' }));
          return;
        }
        const token = await getOpenSkyToken();
        await proxyJson(
          res,
          `osky:${icao24}`,
          `https://opensky-network.org/api/tracks/all?icao24=${icao24}&time=0`,
          token ? { Authorization: `Bearer ${token}` } : {}
        );
      } catch (error) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'OpenSky track fetch failed' }));
      }
    });

    middlewares.use('/api/adsblol/trace', async (req, res) => {
      try {
        const incoming = new URL(req.url || '', 'http://localhost');
        const hex = String(incoming.searchParams.get('hex') || '').trim().toLowerCase();
        if (!/^[0-9a-f~]{6,7}$/.test(hex)) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'hex must be a 6-7 char hex string' }));
          return;
        }
        await proxyJson(
          res,
          `lol:${hex}`,
          `https://adsb.lol/data/traces/${hex.slice(-2)}/trace_full_${hex}.json`
        );
      } catch (error) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'adsb.lol trace fetch failed' }));
      }
    });
  }

  return {
    name: 'track-backfill-proxies',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

/**
 * Vite plugin: OpenAI Realtime ephemeral client secret.
 *
 * Keeps OPENAI_API_KEY server-side while the browser connects to the
 * Realtime API over WebRTC with a short-lived secret.
 */
function openAiRealtimeProxy() {
  function install(middlewares) {
    middlewares.use('/api/openai/hud-summary', async (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      // Opt-in per-IP throttle (GEV_RATELIMIT_OPENAI_PER_MIN). No-op when unset.
      if (!enforceOptInRateLimit(openAiRateLimiter(), req, res)) return;

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'OPENAI_API_KEY is not set' }));
        return;
      }

      try {
        const body = await readRequestBody(req, 64 * 1024);
        const context = JSON.parse(body || '{}');
        const response = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: process.env.OPENAI_HUD_SUMMARY_MODEL || OPENAI_HUD_SUMMARY_MODEL_DEFAULT,
            instructions: [
              "Write one concise intelligence-HUD summary for God's Eye View.",
              'Use only the supplied place, street, nearby-place, and enabled-layer text labels.',
              'Prefer the clearest named place and include a relevant enabled layer only when useful.',
              'Do not infer from coordinates or invent a place.',
              'Output exactly five words with no title, punctuation, markdown, or introductory phrase.',
            ].join(' '),
            input: JSON.stringify(context),
            reasoning: { effort: 'minimal' },
            max_output_tokens: 100,
          }),
        });
        const data = await response.json().catch(() => ({}));
        const summary = toFiveWordHudSummary(extractOpenAiResponseText(data));
        res.statusCode = response.ok && summary ? 200 : response.status || 502;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({
          summary: summary || null,
          error: response.ok ? null : data.error?.message || 'OpenAI HUD summary request failed',
        }));
      } catch (error) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: error?.message || 'OpenAI HUD summary request failed' }));
      }
    });

    middlewares.use('/api/realtime/debug-log', async (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      try {
        const body = await readRequestBody(req, REALTIME_DEBUG_LOG_MAX_BYTES);
        const record = JSON.parse(body || '{}');
        fs.mkdirSync(REALTIME_DEBUG_LOG_DIR, { recursive: true });
        fs.appendFileSync(REALTIME_DEBUG_LOG_FILE, `${JSON.stringify({
          loggedAt: new Date().toISOString(),
          ...record,
        })}\n`);
        res.statusCode = 204;
        res.end();
      } catch (error) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: error?.message || 'Failed to write Realtime debug log' }));
      }
    });

    middlewares.use('/api/realtime/token', async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      // Opt-in per-IP throttle (GEV_RATELIMIT_OPENAI_PER_MIN). No-op when unset.
      if (!enforceOptInRateLimit(openAiRateLimiter(), req, res)) return;

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'OPENAI_API_KEY is not set' }));
        return;
      }

      // Voice model tier, requested by the client as ?tier=standard|mini.
      // resolveVoiceModel is total: an unknown, empty, or hostile value
      // resolves to `standard` instead of reaching OpenAI as a model id, so a
      // bad querystring degrades to a normal session rather than a dead mic.
      // The env overrides stay authoritative per tier (see .env.example) —
      // a wrong upstream model id is then a config fix, not a code change.
      const requestedTier = (() => {
        try {
          return new URL(req.url || '', 'http://localhost').searchParams.get('tier');
        } catch {
          return null;
        }
      })();
      const tier = resolveVoiceModel(requestedTier).tier;
      const model =
        tier === 'mini'
          ? process.env.OPENAI_REALTIME_MODEL_MINI || OPENAI_REALTIME_MODEL_MINI_DEFAULT
          : process.env.OPENAI_REALTIME_MODEL || OPENAI_REALTIME_MODEL_DEFAULT;
      const voice = process.env.OPENAI_REALTIME_VOICE || OPENAI_REALTIME_VOICE_DEFAULT;
      const effort = process.env.OPENAI_REALTIME_REASONING_EFFORT || OPENAI_REALTIME_REASONING_DEFAULT;
      const contextTokenLimit = Math.round(Math.max(
        1000,
        Math.min(12000, Number(process.env.OPENAI_REALTIME_CONTEXT_TOKENS) || OPENAI_REALTIME_CONTEXT_TOKENS_DEFAULT)
      ));
      const contextRetentionRatio = Math.max(
        0.1,
        Math.min(1, Number(process.env.OPENAI_REALTIME_CONTEXT_RETENTION) || OPENAI_REALTIME_CONTEXT_RETENTION_DEFAULT)
      );
      const sessionConfig = {
        session: {
          type: 'realtime',
          model,
          reasoning: { effort },
          truncation: {
            type: 'retention_ratio',
            retention_ratio: contextRetentionRatio,
            token_limits: {
              post_instructions: contextTokenLimit,
            },
          },
          audio: {
            input: {
              noise_reduction: { type: 'near_field' },
              turn_detection: {
                type: 'semantic_vad',
                eagerness: 'low',
                create_response: true,
                interrupt_response: false,
              },
            },
            output: { voice },
          },
          instructions: [
            "You are GEV Voice Control, a concise voice controller for a Cesium geospatial app called God's Eye View.",
            'Have a natural spoken conversation with the user while the mic session is active.',
            'Do not require a wake phrase. Treat direct commands like "zoom into London" or "open datacenters" as GEV control requests.',
            'Only control the app by calling the provided tools. Never invent tool names or arguments.',
            'Call tools only for clear GEV control, navigation, visual-style, layer, or app-state requests. For ordinary conversation, answer normally without tools.',
            'For requests to open, show, reveal, or focus a menu/panel, call set_panel_open or show_data_layers_menu. "Open Context" means only set_panel_open{panelId:"global-context-panel",open:true}; it does not activate a Context sub-mode. "Open Contacts" means set_context_mode{mode:"contacts"}; that action expands the parent Context panel before activating Contacts.',
            'For requests like "show me the datacenter layers", open the data layers menu and focus the matching layer row; do not enable the layer unless the user asks to turn it on.',
            'For questions like "what am I looking at?", "what is in view?", "what is this?", "that selected thing", nearby datacenter, dam, cable, ship, or current view contents, call get_entity_context first, then answer from the returned scene/entity context.',
            'For "what is this aircraft?" answers, read the callsign, operator, registration, type, and route only from get_entity_context selected.properties. Treat route, routeOrigin, and routeDestination as the only authoritative route fields. Every aircraft identity answer MUST explicitly cover operator, type, and route. When a route is present, repeat its endpoint codes exactly; do not expand airport codes into city names. For a missing field say exactly "Operator details are unavailable", "Aircraft type is unavailable", or "Route details are unavailable" as applicable. Never silently omit missing enrichment or infer it from the callsign.',
            'While a camera motion or route flight is active, a bare "stop" means move_camera{motion:stop} — NOT control_scene and NOT stop_tracking (those need explicit words like "stop the scene" / "stop tracking"). If move_camera stop returns stopped:false and an entity is being tracked, call stop_tracking next — the user means "stop whatever is moving". Flying somewhere while tracking automatically stops the tracking (the result says so): mention it briefly.',
            'For camera-motion requests — "orbit around this", "pan left", "tilt up", "stop moving" — call move_camera. For "fly the route" over a drawn route, call fly_route. Confirm with the RESULTING state ("Orbiting slowly", "Flying the route").',
            'analyst_query ANSWERS questions; it never moves the camera or starts tracking. For requests to FOLLOW or TRACK a specific aircraft/ship, call track_entity (get_entity_context first when the target is ambiguous), never analyst_query as the final or only action. For "follow/track the nearest aircraft", first call analyst_query with the aircraft layer(s), sortBy=distance, and limit=1, then call track_entity with the returned aircraft identity in the same turn. The lookup alone does not fulfill a follow/track command.',
            'For a request to enable an aircraft layer and SELECT or FIND the nearest/closest aircraft near a named place — for example, "Turn on flights and select the closest aircraft to Austin" — call select_nearest_aircraft once. It atomically turns on the requested aircraft layer first, waits for location arrival, refreshes that layer for the destination viewport, filters out landed/on-ground records, and selects the nearest airborne result. A healthy fallback feed is valid data: report the returned feed source briefly, never call it an enable failure. Do not also call fly_to_location, set_layer_visibility, analyst_query, track_entity, set_context_mode, or control_cockpit for the same request. SELECT/FIND never implies Contacts or Cockpit unless the user explicitly asks for either mode.',
            'For ANALYTICAL questions about layer data — how many / which / fastest / highest / biggest / nearest flights, ships, fires, or earthquakes ("how many flights over Texas", "biggest fire near LA", "which ships are headed to Oakland", "anything above 40,000 feet") — call analyst_query, not get_entity_context. Narrate the count plus two or three notable examples by name, and reflect the result\'s coverage note honestly: the answer covers data loaded by enabled layers, not the whole world. If the needed layer is disabled, say so and offer to enable it. For follow-ups about the same set ("which of THOSE is closest?"), call analyst_query with followUp=true and only the new filter/sort.',
            'COUNTING CONTRACT — what "near" means. (1) While Contacts is ACTIVE, "near / nearby / how many aircraft" means the Contacts window: answer from contactsWindow in the tool result — those are the exact numbers on the user\'s panel. set_context_mode, analyst_query, and get_current_view_state carry it after Contacts settles. For "Open Contacts and tell me how many aircraft are within 250 km", call set_context_mode{mode:"contacts"} first and answer from contactsWindow.aircraft; do not answer from a pre-Contacts analyst query. analyst_query\'s own count measures currently-loaded records and is usually lower; never give it as the window count. CENTER PRECEDENCE for a nearby/how-many ask, in order: an explicit place in the question ("over Texas", "near Austin") always wins and ignores Contacts state; else the CONTACTS SUBJECT when Contacts is active and has one — a selected datacenter, dam, fire, or cable does NOT silently become the center; else an entity the user explicitly names ("around this datacenter"); else the current view, said aloud ("nothing is selected, so this is the current view"). With Contacts active but NO subject yet, use the view and say so; never read an empty panel. (2) With Contacts OFF, "nearby" means in view; "near <place>" means a radius around that place. (3) EVERY count names its scope in words — "42 in your window", "8 in view", "about 30 within 250 km of Austin" — never a bare number; analyst_query returns scopeLabel for exactly this. Two different numbers with named scopes are not a contradiction; say both if asked. (4) State counts VERBATIM — never estimate, round, or hedge ("a few", "less than a dozen"): if a tool returns 46, say 46. (5) When it matters, add once: counts cover loaded data, and the flights layer loads where you look.',
            'While Cockpit is active, navigate with control_cockpit (next/previous, optionally targetLayer or aircraftClass). track_entity and fly_to_location are REFUSED by design while Cockpit owns the camera — that refusal is correct, not an error to retry. To go somewhere else, exit Cockpit first. control_cockpit enter establishes Contacts itself, so do not call set_context_mode before or after it.',
            'When the target layer is unknown, OMIT layerId in track_entity so it searches all enabled layers. Passing the wrong layerId ("flights" for a military contact) returns "Nothing matched" even though the contact is loaded.',
            'If get_entity_context has no selected object or overlay entities, use its basemap context: Google Photorealistic 3D Tiles/Cesium source, center target coordinates, reverse-geocoded place, camera altitude, active style, and enabled layers. Do not say there is nothing unless the basemap target is also unavailable.',
            'If basemap context includes knownLandmarks, prefer the nearest known landmark by name for "what am I looking at" answers. For example, if knownLandmarks includes Eiffel Tower, say Eiffel Tower.',
            'At local zoom, use basemap nearbyPlaces, place.labels, viewportPlaces.visibleLabels, and viewportPlaces.streetLabels to identify the building, premises, roads, and named places visible around the screen target.',
            'If basemap context includes viewportPlaces, prefer dominantCountry, dominantRegion, and dominantLocality over raw coordinates.',
            'When basemap context includes viewportSamples or an inferred country, trust that over a single reverse-geocoded address. If most samples indicate Iran, say Iran, not the United States.',
            'When a viewport screenshot is attached after get_entity_context, read clearly legible street, building, and place labels from it and combine them with structured label context. Respect scene viewScale: at global/continental/regional scale, avoid naming a precise street/city from one center pixel.',
            'Do not mention disabled layers or stale selections.',
            'When a request requires a tool call, do not speak in the same response as the tool call. Call the tool first.',
            'When a single user request contains MULTIPLE changes (e.g. "switch to operator layout, use balanced detection at density 50, and switch to Bing aerial"), call ALL the corresponding tools — multiple tool calls in sequence — before speaking. Never confirm a partial subset. If a later tool fails, say which parts succeeded and which failed.',
            'After receiving tool output, speak exactly one short confirmation. Do not repeat the confirmation.',
            'For "show/open/turn on" layer requests, enable the matching layer. For "hide/close/turn off", disable it.',
            // INSTRUCTION-ONLY mapping for the two globe-scale named views.
            //
            // Both are BROADER than the first-run tiles on purpose. A person
            // naming layers out loud has chosen them; a tile is a first
            // impression handed to a stranger. So voice keeps fires in the
            // environmental view and keeps infrastructure entirely, while the
            // launcher's ENVIRONMENTAL tile is quakes-only and has no
            // infrastructure tile at all. See src/firstRunExperience.js for why.
            //
            // Fully expressible with tools that already exist, so
            // GEV_REALTIME_TOOLS is deliberately untouched — deleting this one
            // string is the whole rollback.
            'NAMED VIEWS are shorthand for tool calls you already have — there is no "mode" tool for them. Treat ONLY these as the shorthand: "infrastructure mode" / "the infrastructure view" / "show me global infrastructure" means three set_layer_visibility calls (local-datacenters, local-dams, telegeography-submarine-cables) plus zoom_to_globe; "environmental mode" / "earth watch" / "active events", said as the name of a view, means set_layer_visibility for local-firms and earthquakes plus zoom_to_globe. Anything vaguer is NOT this shorthand — an open-ended question about the world or the news is an ordinary question: answer it, or use analyst_query over the layers already on. Never switch a whole view on to answer a question nobody asked to see. When you do run one, make every call before speaking, then give one confirmation naming the resulting state; if the fires layer comes back unavailable because no FIRMS key is configured, say so plainly — the earthquakes still loaded. "Live contacts" and "space missions" are NOT this pattern: they stay set_context_mode{mode:"contacts"} and set_context_mode{mode:"space-missions"}.',
            'For visual filter requests, call set_visual_style with one of the allowed style IDs.',
            'Disambiguation table — basemap vs layer vs style: basemap switching requires an explicit stack name — "Bing aerial" means set_map_stack bing-aerial, "aerial with labels" means bing-labels, "OSM"/"road map" means osm, "Google 3D"/"photorealistic" means photoreal. Any mention of "satellite" or "satellites" ALWAYS means the satellites DATA LAYER via set_layer_visibility, never a basemap. "surveillance"/"night vision"/"thermal" are visual STYLES via set_visual_style.',
            'HUD requests ("hud on/off", "switch to operator/minimal/tactical layout") use set_hud. Detection requests ("detection on", "dense mode", "balanced mode", "sparse mode", "set density to 25", "use weighted allocation") use set_detection. Density snaps to 0/25/50/75/100 and derives Sparse/Balanced/Dense; panoptic is a legacy alias for Dense.',
            'Bloom/sharpen requests use set_post_processing. Scene requests ("play orbital watch", "stop the scene", "what scenes are there") use control_scene. CCTV camera requests ("next camera", "nearest camera", "select the Congress camera", "show coverage") use control_cctv — the CCTV layer must be enabled first.',
            'Radio playback requests use control_radio. "Turn on/start the radio" means action=play; action=enable only reveals Radio markers and must be reserved for explicit "show/enable the Radio layer/markers" requests. After a prepared playback result, briefly confirm any other completed actions and say "Turning on the radio"—never claim it is already playing. The client keeps Radio muted until playback is verified, then closes voice before restoring Radio volume. Examples: "play news near Austin" → select category=news locationId=austin; "play US news" → select category=news country=US; "Radio volume 30" → volume; pause/resume/stop/next/previous use the matching action. Radio selection never moves the camera.',
            '"Track/follow <something specific>" (a callsign, ship name, satellite name) uses track_entity. "Take me to the biggest fire" uses track_entity with query "biggest fire" (the fires layer must be enabled). Bare "orbit" means camera orbit of the current landmark. "Stop following/tracking" uses stop_tracking.',
            '"Show me which planes are overhead"/"frame the ships"/"show me the satellites above" use frame_overhead with the matching target.',
            "After frame_overhead, speak ONLY from the tool result's count field — e.g. 'Framed fourteen aircraft, labels on'; never reassess or second-guess the count aloud.",
            'Confirmations echo the RESULTING state, never the request: "HUD operator layout", "Density twenty-five percent", "Bing aerial imagery", "Tracking UAL428", "Framed fourteen aircraft". On ok=false, state the failure plainly: "Nothing matched UAL999", "No ships within 120 kilometers". Never claim an action without ok=true in the tool result.',
            'For destination requests such as "take me to Italy", "go to NYC", or "show me the Eiffel Tower", call fly_to_location. Prefer known city IDs when available; otherwise pass the plain place query.',
            'Navigation-only requests ("take me to X", "go to X", "fly to X") are NOT descriptions: call fly_to_location alone and do NOT also call annotate_map, unless the user explicitly asks to mark the place or you go on to explain specific places there. Never drop a point pin on a region-scale natural feature (a mountain range, desert, sea, or forest) — a single point in the middle of the Rockies is meaningless. If the user explicitly asks to mark such a region, prefer type=area.',
            'For country and city destinations, omit rangeM so GEV frames the whole country or city in view. For landmarks and buildings, omit rangeM so GEV chooses a close landmark view.',
            'Only supply rangeM when the user asks for a particular numeric height, distance, closer view, or wider view.',
            'For relative requests such as "zoom out a little", "pull back", "zoom in more", or "get closer", always call adjust_camera_zoom. But "globe view", "whole earth", "the whole planet", or "zoom all the way out" is an ABSOLUTE framing: call zoom_to_globe once instead — repeated adjust_camera_zoom calls can never reach the globe. Never claim the camera moved without the tool returning ok=true.',
            'Keep spoken confirmations short, e.g. "Opening datacenters" or "Flying to London".',
            'WHITEBOARD THE WORLD: whenever you describe or explain a specific place, building, campus, district, boundary, or a spatial relationship between places, call annotate_map to mark it visually as you talk — like sketching on the map. To call out a specific building, campus, compound, park, or district, use type=area (it traces and encloses the real footprint — a building gets a glowing volume, a district gets a draped outline). Use type=highlight only for a transient pulse on a precise spot that has no meaningful footprint, and type=pin to drop a labeled marker. Examples: "what is the Palace of Fine Arts?" → an AREA on it; "the old military base next to it" → an AREA on the Presidio; "ILM is right here" → a pin; "it sits next to the Marina" → an arrow from one to the other. Prefer place NAMES so the app resolves real positions and outlines; never invent coordinates or pixel locations.',
            'On every annotation, also set entityKind to what the thing IS when you know it: building (one structure), compound (campus/grounds/mall/park), district (neighborhood/area of a city), street (a named road), or point_feature (a monument, statue, memorial, plaque, fountain, or other small point landmark). entityKind is a FACT about the target, independent of the mark type you chose — monuments and statues are point_feature even when you use type=area; the app then anchors them as precise points instead of guessing at a footprint.',
            'Use a single annotate_map call with several annotations when you are describing multiple related places at once. Set flyTo true only when the user is not already looking at the place; if every mark in a call lands off-screen the app auto-frames them, so when unsure leave flyTo false. Do NOT say out loud that you are drawing, highlighting, or annotating — just speak naturally about the places while the marks appear. ANNOTATIONS ACCUMULATE AND PERSIST — keep adding marks as you explore; you can fly around, change topic, and jump between far-apart places and the marks STAY, so the user can build up the map and show people things. Do NOT clear on your own initiative: never pass clearPrevious, and call clear_annotations ONLY when the user EXPLICITLY asks to clear or reset the map.',
            'If an annotate_map result has partial:true or any failedLabels, do not pretend those places appeared — briefly work into your narration that you could not pinpoint them (e.g. "I couldn\'t place X"). If a route comes back as a direct line (no street route was found), describe it as a straight-line distance, not a walking/driving time. If an annotate_map result has capped:true, the map is full — ASK the user whether to clear before drawing more; do not clear unprompted. outlinePending:true is NOT a failure, but it is also NOT an outline: the anchor mark is placed and the boundary is still being traced in the background. Narrate it in progress — e.g. "tracing the boundary now" — and NEVER state the outline is already drawn or visible; it may yet come back as just a point. A later system item of type map_annotation_outline reports the final outcome per mark (status resolved or failed, with its label): use it to quietly confirm, or to correct yourself if you implied a boundary that stayed a point — an honest miss beats a misleading guess.',
            'PREFER NAMES. Only when you cannot name or geocode a place but you can clearly SEE the exact spot in the most recent viewport screenshot, fall back to screenX/screenY (normalized 0..1 from that image) to point at it; the app converts the pixel to a real world point. Never use screenX/screenY for something you could name.',
            'PATHS vs DISTANCES: for "walking/driving route from A to B" (or through several stops), use type=route with the ordered points and the matching mode (walking/driving/cycling) — the app draws the real street-following path on the map and reports distance and travel time, which you can read aloud. For "how far is X from Y", "is it nearby", or "X is next to Y", use type=arrow between the two — it draws a floating connector and shows the straight-line distance. Do NOT use route for a simple distance/proximity question.',
          ].join('\n'),
          tools: GEV_REALTIME_TOOLS,
          tool_choice: 'auto',
        },
      };

      try {
        const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'OpenAI-Safety-Identifier': 'gev-local-dev',
          },
          body: JSON.stringify(sessionConfig),
        });
        const body = await response.text();
        res.statusCode = response.status;
        res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
        // Which tier/model this secret was actually minted for. The upstream
        // body is passed through untouched (the client parses it verbatim), so
        // these headers are the authoritative echo — including the case where a
        // bogus ?tier= was silently downgraded to standard.
        res.setHeader('X-GEV-Voice-Tier', tier);
        res.setHeader('X-GEV-Voice-Model', model);
        if (requestedTier && !isKnownVoiceTier(requestedTier)) {
          res.setHeader('X-GEV-Voice-Tier-Fallback', '1');
        }
        res.end(body);
      } catch (error) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: error?.message || 'Failed to create Realtime token' }));
      }
    });
  }

  return {
    name: 'openai-realtime-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

function extractOpenAiResponseText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }
  if (!Array.isArray(data?.output)) return '';
  return data.output
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .map((part) => part?.text || part?.output_text || '')
    .join(' ')
    .trim();
}

function toFiveWordHudSummary(value) {
  return String(value || '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(' ');
}

function readRequestBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error(`Request body exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Vite plugin: nearby Google place labels for Realtime scene context.
 *
 * The Photorealistic 3D Tiles mesh does not expose rendered map labels as
 * Cesium feature metadata. Nearby Search supplies the names around the actual
 * screen-space target without exposing the Google API key in the request.
 */
function googlePlacesContextProxy() {
  function install(middlewares) {
    middlewares.use('/api/google/nearby-places', async (req, res) => {
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Method not allowed', places: [] }));
        return;
      }

      // Opt-in per-IP throttle (GEV_RATELIMIT_GOOGLE_PER_MIN). No-op when unset.
      // Inlined (not the shared helper) so the 429 body keeps this endpoint's
      // `places: []` contract that the client expects on every error response.
      const _grl = googleRateLimiter();
      if (_grl && !_grl(clientKey(req))) {
        res.statusCode = 429;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Retry-After', '5');
        res.end(JSON.stringify({ error: 'Rate limit exceeded', places: [] }));
        return;
      }

      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'GOOGLE_MAPS_API_KEY is not set', places: [] }));
        return;
      }

      const requestUrl = new URL(req.url || '', 'http://localhost');
      const latitude = Number(requestUrl.searchParams.get('lat'));
      const longitude = Number(requestUrl.searchParams.get('lon'));
      const radiusM = Math.max(25, Math.min(5000, Number(requestUrl.searchParams.get('radiusM')) || 250));
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Valid lat and lon are required', places: [] }));
        return;
      }

      try {
        const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': [
              'places.id',
              'places.displayName',
              'places.formattedAddress',
              'places.shortFormattedAddress',
              'places.location',
              'places.primaryType',
              'places.primaryTypeDisplayName',
              'places.types',
            ].join(','),
          },
          body: JSON.stringify({
            maxResultCount: 20,
            rankPreference: 'DISTANCE',
            locationRestriction: {
              circle: {
                center: { latitude, longitude },
                radius: radiusM,
              },
            },
          }),
        });
        const data = await response.json().catch(() => ({}));
        const seenPlaces = new Set();
        const places = Array.isArray(data.places) ? data.places
          .map((place) => {
            const placeLatitude = place.location?.latitude ?? null;
            const placeLongitude = place.location?.longitude ?? null;
            const types = Array.isArray(place.types) ? place.types.slice(0, 8) : [];
            return {
              id: place.id || null,
              name: place.displayName?.text || null,
              address: place.shortFormattedAddress || place.formattedAddress || null,
              latitude: placeLatitude,
              longitude: placeLongitude,
              distanceM: approximateDistanceM(latitude, longitude, placeLatitude, placeLongitude),
              primaryType: place.primaryTypeDisplayName?.text || place.primaryType || null,
              types,
              contextPriority: placeContextPriority(types),
            };
          })
          .filter((place) => {
            const key = `${place.name}:${place.address || ''}`.toLowerCase();
            if (!place.name || seenPlaces.has(key)) return false;
            seenPlaces.add(key);
            return true;
          })
          .sort((a, b) => b.contextPriority - a.contextPriority || a.distanceM - b.distanceM)
          .map(({ contextPriority, ...place }) => place)
          .slice(0, 20) : [];

        res.statusCode = response.ok ? 200 : response.status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.end(JSON.stringify({
          places,
          error: response.ok ? null : data.error?.message || 'Google Places request failed',
        }));
      } catch (error) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: error?.message || 'Google Places request failed', places: [] }));
      }
    });

    // Text Search: resolve a named landmark/POI to a real coordinate, biased to
    // the view. Geocoding scatters obscure monument/POI names across the city;
    // a view-biased Text Search lands on the actual feature. Same key, field
    // mask, throttle, and `places: []` error contract as nearby-places above.
    middlewares.use('/api/google/text-search', async (req, res) => {
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Method not allowed', places: [] }));
        return;
      }

      // Opt-in per-IP throttle (GEV_RATELIMIT_GOOGLE_PER_MIN). No-op when unset.
      // Inlined (like nearby-places) so the 429 body keeps the `places: []`
      // contract the client expects on every error response.
      const _grl = googleRateLimiter();
      if (_grl && !_grl(clientKey(req))) {
        res.statusCode = 429;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Retry-After', '5');
        res.end(JSON.stringify({ error: 'Rate limit exceeded', places: [] }));
        return;
      }

      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'GOOGLE_MAPS_API_KEY is not set', places: [] }));
        return;
      }

      const requestUrl = new URL(req.url || '', 'http://localhost');
      const textQuery = String(requestUrl.searchParams.get('q') || '').trim();
      const latitude = Number(requestUrl.searchParams.get('lat'));
      const longitude = Number(requestUrl.searchParams.get('lon'));
      const radiusM = Math.max(50, Math.min(50000, Number(requestUrl.searchParams.get('radiusM')) || 4000));
      if (!textQuery || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'q, lat and lon are required', places: [] }));
        return;
      }

      try {
        const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': [
              'places.id',
              'places.displayName',
              'places.formattedAddress',
              'places.location',
              'places.viewport',
              'places.primaryType',
              'places.types',
            ].join(','),
          },
          body: JSON.stringify({
            textQuery,
            locationBias: {
              circle: {
                center: { latitude, longitude },
                radius: radiusM,
              },
            },
            maxResultCount: 5,
          }),
        });
        const data = await response.json().catch(() => ({}));
        const places = Array.isArray(data.places) ? data.places
          .map((place) => {
            const placeLatitude = place.location?.latitude ?? null;
            const placeLongitude = place.location?.longitude ?? null;
            const types = Array.isArray(place.types) ? place.types.slice(0, 8) : [];
            // Places returns a lat/lng bounding box (low/high corners) framing the
            // place — no polygon, but enough to SIZE a fallback grounds disc to the
            // real feature instead of a blind constant. Normalize to plain numbers.
            const vp = place.viewport;
            const viewport = (
              Number.isFinite(vp?.low?.latitude) && Number.isFinite(vp?.low?.longitude)
              && Number.isFinite(vp?.high?.latitude) && Number.isFinite(vp?.high?.longitude)
            ) ? {
              low: { latitude: vp.low.latitude, longitude: vp.low.longitude },
              high: { latitude: vp.high.latitude, longitude: vp.high.longitude },
            } : null;
            return {
              id: place.id || null,
              name: place.displayName?.text || null,
              address: place.formattedAddress || null,
              latitude: placeLatitude,
              longitude: placeLongitude,
              distanceM: approximateDistanceM(latitude, longitude, placeLatitude, placeLongitude),
              primaryType: place.primaryType || null,
              types,
              viewport,
            };
          })
          .filter((place) => place.name) : [];

        res.statusCode = response.ok ? 200 : response.status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.end(JSON.stringify({
          places,
          error: response.ok ? null : data.error?.message || 'Google Places request failed',
        }));
      } catch (error) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: error?.message || 'Google Places request failed', places: [] }));
      }
    });
  }

  return {
    name: 'google-places-context-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

function placeContextPriority(types) {
  const typeSet = new Set(types);
  if (typeSet.has('historical_landmark') || typeSet.has('monument')) return 100;
  if (typeSet.has('tourist_attraction') || typeSet.has('museum')) return 90;
  if (typeSet.has('premise') || typeSet.has('street_address')) return 75;
  if (typeSet.has('point_of_interest')) return 60;
  if (typeSet.has('public_bathroom')) return 10;
  return 40;
}

function approximateDistanceM(latA, lonA, latB, lonB) {
  if (![latA, lonA, latB, lonB].every(Number.isFinite)) return Number.MAX_SAFE_INTEGER;
  const latitudeScale = 111320;
  const longitudeScale = latitudeScale * Math.cos((latA * Math.PI) / 180);
  return Math.round(Math.hypot(
    (latB - latA) * latitudeScale,
    (lonB - lonA) * longitudeScale
  ));
}

const GEV_REALTIME_TOOLS = [
  {
    type: 'function',
    name: 'fly_to_location',
    description: "Fly the God's Eye View camera to a known city, geocoded country/region/city/landmark, or explicit WGS84 coordinate. Countries/cities frame the whole place; landmarks/buildings use close framing.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        locationId: {
          type: 'string',
          enum: ['austin', 'sf', 'nyc', 'tokyo', 'london', 'paris', 'dubai', 'dc'],
          description: 'Known city preset ID. Use when the requested place matches one of these cities.',
        },
        query: {
          type: 'string',
          description: 'Plain place search query, e.g. "London", "Eiffel Tower", or "Dubai Marina".',
        },
        latitude: { type: 'number', minimum: -90, maximum: 90 },
        longitude: { type: 'number', minimum: -180, maximum: 180 },
        viewMode: {
          type: 'string',
          enum: ['close', 'overview'],
          description: 'Optional framing intent. Usually omit this; GEV infers whole-place framing for countries/cities and close framing for landmarks.',
        },
        rangeM: {
          type: 'number',
          minimum: 100,
          maximum: 20000000,
          description: 'Optional camera range from the target in meters. Omit it for automatic whole-country/whole-city or close-landmark framing; provide it only when the user explicitly requests a numeric height or distance.',
        },
        waitForArrival: {
          type: 'boolean',
          description: 'Set true when a later tool depends on the destination viewport. The result then waits for the camera flight and returns arrived=true; cancellation returns ok=false.',
        },
      },
    },
  },
  {
    type: 'function',
    name: 'select_nearest_aircraft',
    description: 'Atomically fly to a place, wait for arrival, enable and load Flights or Military Flights in that viewport, exclude on-ground records, and select/follow the nearest airborne aircraft. Healthy fallback feeds remain usable and are reported in the result. This does not open Contacts or Cockpit.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        layerId: {
          type: 'string',
          enum: ['flights', 'military'],
          description: 'Aircraft layer to enable and search. Use flights unless the user explicitly asks for military aircraft.',
        },
        locationId: {
          type: 'string',
          enum: ['austin', 'sf', 'nyc', 'tokyo', 'london', 'paris', 'dubai', 'dc'],
          description: 'Known city preset ID when the place matches one of these cities.',
        },
        locationQuery: {
          type: 'string',
          maxLength: 160,
          description: 'Free-form destination when no locationId matches.',
        },
        latitude: { type: 'number', minimum: -90, maximum: 90 },
        longitude: { type: 'number', minimum: -180, maximum: 180 },
      },
      required: ['layerId'],
    },
  },
  {
    type: 'function',
    name: 'adjust_camera_zoom',
    description: 'Move the current Cesium camera closer to or farther from what it is presently looking at. Use for relative zoom requests without changing location.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        direction: {
          type: 'string',
          enum: ['in', 'out'],
        },
        amount: {
          type: 'string',
          enum: ['little', 'medium', 'lot'],
          description: 'Use little for phrases like "a bit" or "a little", medium for ordinary zoom requests, and lot for "way out/in".',
        },
      },
      required: ['direction', 'amount'],
    },
  },
  {
    type: 'function',
    name: 'zoom_to_globe',
    description: 'Pull the camera out to an ABSOLUTE full-Earth globe view (~18,000 km altitude, the whole planet in frame), keeping the current region centered. Use for "globe view", "whole earth", "see the planet", "zoom all the way out". Never use adjust_camera_zoom for these — its relative steps cannot reach the globe.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    type: 'function',
    name: 'set_layer_visibility',
    description: "Enable or disable one registered God's Eye View data layer.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        layerId: {
          type: 'string',
          description:
            'Common-name mapping for the non-obvious ids: space mission(s) → rocket-launches; fires/wildfires/active fires → local-firms (NASA FIRMS); ships/vessels/boats → ais-live-vessels; undersea/submarine cables → telegeography-submarine-cables; datacenters → local-datacenters; dams → local-dams; ports/harbors/seaports → local-ports; airports/aerodromes/airfields/aéroports → local-airports; buoys/sea state/wave height → marine-buoys; bikes/bike share → bikeshare; street traffic/congestion → traffic; traffic cameras → cctv; internet radio/stations → radio.',
          enum: [
            'flights',
            'military',
            'earthquakes',
            'satellites',
            'rocket-launches',
            'traffic',
            'cctv',
            'radio',
            'bikeshare',
            'ais-live-vessels',
            'local-datacenters',
            'local-dams',
            'local-ports',
            'local-airports',
            'telegeography-submarine-cables',
            'local-firms',
            'marine-buoys',
          ],
        },
        enabled: { type: 'boolean' },
      },
      required: ['layerId', 'enabled'],
    },
  },
  {
    type: 'function',
    name: 'show_data_layers_menu',
    description: 'Open the data layers dropdown/menu and optionally scroll to a specific layer row without toggling it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        layerId: {
          type: 'string',
          enum: [
            'flights',
            'military',
            'earthquakes',
            'satellites',
            'traffic',
            'cctv',
            'radio',
            'bikeshare',
            'ais-live-vessels',
            'local-datacenters',
            'local-dams',
            'local-ports',
            'local-airports',
            'telegeography-submarine-cables',
            'local-firms',
            'marine-buoys',
          ],
          description: 'Optional layer row to scroll into view and highlight.',
        },
      },
    },
  },
  {
    type: 'function',
    name: 'set_panel_open',
    description: 'Open or close a GEV UI panel/dropdown.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        panelId: {
          type: 'string',
          enum: ['data-panel', 'location-bar', 'control-panel', 'cctv-panel', 'radio-panel', 'scene-panel', 'pp-toggles', 'global-context-panel'],
        },
        open: { type: 'boolean' },
      },
      required: ['panelId', 'open'],
    },
  },
  {
    type: 'function',
    name: 'set_context_mode',
    description: 'Enter or exit the Global Context sub-mode used by Contacts and Space Missions. Use Contacts only when the user explicitly requests Contacts, and Space Missions only when explicitly requested. A request to open the parent Context panel alone uses set_panel_open and must not activate either sub-mode. Selecting an aircraft does not imply Context.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: {
          type: 'string',
          enum: ['off', 'contacts', 'flights', 'space-missions', 'missions'],
          description: 'Use off to exit context mode.',
        },
      },
      required: ['mode'],
    },
  },
  {
    type: 'function',
    name: 'control_cockpit',
    description: 'Read or control Cockpit when the user explicitly requests Cockpit: establish Contacts and enter from a selected or tracked aircraft; exit; or navigate nearby Contacts with optional filters. Selecting or viewing an aircraft alone must not enter Cockpit.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['enter', 'exit', 'previous', 'next', 'prev', 'status'],
          description: 'previous/next (or prev) navigates through nearby contacts in Cockpit context.',
        },
        targetLayer: {
          type: 'string',
          enum: ['flights', 'military', 'ais-live-vessels', 'military-installations'],
          description: 'Optional contact layer filter for next/previous (for example military for a military-only cycle).',
        },
        aircraftClass: {
          type: 'string',
          description: 'Optional aircraft class filter (for example helicopter) when using next/previous navigation.',
        },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'set_visual_style',
    description: "Set the active God's Eye View visual filter/style.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        style: {
          type: 'string',
          enum: ['normal', 'retro', 'surveillance', 'thermal', 'anime', 'noir', 'snow'],
        },
      },
      required: ['style'],
    },
  },
  {
    type: 'function',
    name: 'get_entity_context',
    description: 'Get current GEV scene context, including basemap/3D-tile target context, selected entity metadata if active, and entities currently visible in the camera view.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        scope: {
          type: 'string',
          enum: ['auto', 'selected', 'in_view'],
          description: 'Use auto by default. selected returns the clicked/selected entity; in_view returns visible entities near the screen center.',
        },
        layerId: {
          type: 'string',
          enum: [
            'local-datacenters',
            'local-dams',
            'local-ports',
            'local-airports',
            'telegeography-submarine-cables',
            'local-firms',
          ],
          description: 'Optional layer filter for visible entity context.',
        },
        limit: {
          type: 'number',
          minimum: 1,
          maximum: 12,
        },
      },
    },
  },
  {
    type: 'function',
    name: 'get_current_view_state',
    description: 'Read the current camera, style, Context, Cockpit, HUD, detection, map stack, post-processing, scene-playback, tracked-entity, and layer state before choosing another action.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    type: 'function',
    name: 'set_hud',
    description: 'Control the intelligence HUD overlay: visibility and/or layout variant.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        visible: { type: 'string', enum: ['on', 'off', 'auto'], description: 'auto restores style-driven show/hide.' },
        layout: { type: 'string', enum: ['tactical', 'operator', 'minimal'] },
      },
    },
  },
  {
    type: 'function',
    name: 'set_detection',
    description: 'Control the detection overlay: on/off, density-derived Sparse/Balanced/Dense profile, and Elastic/Weighted layer allocation.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean', description: 'false turns detection OFF; true restores the current density-derived profile.' },
        mode: { type: 'string', enum: ['sparse', 'balanced', 'dense'] },
        densityPct: { type: 'number', description: 'Density snaps to 0, 25, 50, 75, or 100 and derives the active profile.' },
        allocationStrategy: { type: 'string', enum: ['elastic', 'weighted'], description: 'Elastic splits evenly then lends unused slots; Weighted follows demand and semantic weight.' },
      },
    },
  },
  {
    type: 'function',
    name: 'set_map_stack',
    description: 'Switch the basemap/imagery stack (NOT the satellites data layer and NOT a visual style filter).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        stack: {
          type: 'string',
          enum: ['photoreal', 'bing-aerial', 'bing-labels', 'osm'],
          description: 'photoreal = Google 3D. Use bing-aerial only when the user explicitly says "Bing aerial" — "satellite(s)" never means a basemap.',
        },
      },
      required: ['stack'],
    },
  },
  {
    type: 'function',
    name: 'set_post_processing',
    description: 'Control bloom and sharpen post-processing toggles and intensities.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        bloom: {
          type: 'object',
          additionalProperties: false,
          properties: {
            enabled: { type: 'boolean' },
            intensityPct: { type: 'number', description: '0-200 (UI percent).' },
          },
        },
        sharpen: {
          type: 'object',
          additionalProperties: false,
          properties: {
            enabled: { type: 'boolean' },
            intensityPct: { type: 'number', description: '0-100 (UI percent).' },
          },
        },
      },
    },
  },
  {
    type: 'function',
    name: 'control_scene',
    description: 'Cinematic scene playback: list scenes, play one scene by name, stop, advance, or read status. Play starts a single named scene and returns immediately.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['list', 'play', 'stop', 'next', 'status'] },
        sceneId: { type: 'string', description: 'Scene id or (partial) title for play.' },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'control_cctv',
    description: 'CCTV camera operations: enable/disable the layer, select a camera by name, next/prev/nearest/focus, toggle coverage wedges / projection overlay / auto-hop, "viewshed" for color-coded per-camera coverage volumes, and "adjust" for the on-camera calibration gizmo.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['enable', 'disable', 'select', 'next', 'prev', 'nearest', 'focus', 'coverage', 'viewshed', 'adjust', 'projection', 'autohop'] },
        cameraQuery: { type: 'string', description: 'Camera name or id for select.' },
        enabled: { type: 'boolean', description: 'Explicit on/off for coverage/viewshed/adjust/projection/autohop; omit to toggle.' },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'control_radio',
    description: 'Control Internet Radio playback without moving the map. Use select whenever the request includes a station category, name, country, coordinates, or nearby place—even when the user says play. Use play only for an unqualified "turn on/start the radio" request so the current or nearest station begins. Enable only reveals the Radio layer/markers without audio. Also supports disable, resume, pause, stop, next/previous, volume, and status.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['enable', 'disable', 'play', 'resume', 'pause', 'stop', 'next', 'previous', 'volume', 'select', 'status'],
          description: 'Use select for any request qualified by category, station, country, coordinates, or place. Use play only for an unqualified turn on/start/listen request. Use enable only when the user explicitly asks to show or enable the Radio layer or its markers without requesting audio.',
        },
        volumePct: { type: 'number', minimum: 0, maximum: 100, description: 'Required for volume; sets the persistent Radio playback volume.' },
        category: {
          type: 'string',
          enum: ['all', 'news', 'talk', 'weather', 'public-safety', 'aviation-marine', 'traffic-transit', 'music'],
          description: 'Station category for select/next/previous. When the user requests playback with a category, action must be select, not play.',
        },
        locationId: {
          type: 'string',
          enum: ['austin', 'sf', 'nyc', 'tokyo', 'london', 'paris', 'dubai', 'dc'],
          description: 'Known nearby-city anchor for select.',
        },
        locationQuery: { type: 'string', maxLength: 120, description: 'Place to search near, such as "Austin, Texas" or "Seattle". Selection does not fly the camera.' },
        latitude: { type: 'number', minimum: -90, maximum: 90 },
        longitude: { type: 'number', minimum: -180, maximum: 180 },
        country: { type: 'string', maxLength: 80, description: 'Country code or name filter, for example US or United States.' },
        stationQuery: { type: 'string', maxLength: 120, description: 'Optional station name/tag substring.' },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'track_entity',
    description: 'Find and follow a specific aircraft (callsign/ICAO hex), ship (name/MMSI), or satellite (name/NORAD id) on enabled layers. Camera follows the entity.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Callsign, ship name, satellite name, ICAO hex, MMSI, or NORAD id.' },
        layerId: { type: 'string', description: 'Optional layer hint: flights | military | ais-live-vessels | satellites.' },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'stop_tracking',
    description: 'Stop following the tracked aircraft/satellite and clear any selected vessel.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    type: 'function',
    name: 'frame_overhead',
    description: 'Cinematically frame entities near the current view: pulls the camera back and angles it so nearby aircraft, ships, or satellites are visible together.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: { type: 'string', enum: ['flights', 'military', 'satellites', 'vessels'] },
        radiusKm: { type: 'number', description: 'Search radius around the view target. Defaults: 150 aircraft, 120 ships, 3000 satellites.' },
      },
      required: ['target'],
    },
  },
  {
    type: 'function',
    name: 'annotate_map',
    description: "Draw annotations on the 3D map to visually point out what you are talking about — like sketching on a whiteboard over the world. Use this whenever you mention a specific place, building, campus, boundary, district, or a relationship between two places, so the user can SEE what you mean. Give place NAMES (preferred) or explicit lat/lng; the app resolves them to real-world positions and real building/area outlines — never guess pixel positions. Call this as you begin describing something, and you may mark several places in one call.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        annotations: {
          type: 'array',
          description: 'One or more things to mark. Mark multiple related places together when describing them as a group.',
          minItems: 1,
          maxItems: 24,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: {
                type: 'string',
                enum: ['pin', 'highlight', 'area', 'arrow', 'route', 'label'],
                description: 'pin = planted marker at a spot; highlight = pulsing ring drawing the eye to a point; area = trace the outline of a building/campus/compound/district; arrow = a connector from one place to another (use target as the origin and toTarget as the destination); route = a path through several waypoints (use the points array); label = a floating text callout.',
              },
              target: { type: 'string', maxLength: 200, description: 'Place name to resolve, e.g. "Palace of Fine Arts, San Francisco", "the Pentagon", "Presidio of San Francisco". Preferred over coordinates. For a specific monument/statue/feature that sits within a larger landmark, use its OWN name + city ("Tejano Monument, Austin", "Texas African American History Memorial, Austin") — do NOT phrase it as "X at the Texas State Capitol", which makes the geocoder collapse several of them onto the same centroid so they stack on one spot.' },
              points: {
                type: 'array',
                description: 'For type=route: 2+ ordered waypoints the path passes through, each a place name (or coordinates / screen point).',
                minItems: 2,
                maxItems: 12,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    target: { type: 'string', maxLength: 200, description: 'Waypoint place name.' },
                    latitude: { type: 'number', minimum: -90, maximum: 90 },
                    longitude: { type: 'number', minimum: -180, maximum: 180 },
                    screenX: { type: 'number', minimum: 0, maximum: 1 },
                    screenY: { type: 'number', minimum: 0, maximum: 1 },
                  },
                },
              },
              mode: {
                type: 'string',
                enum: ['walking', 'driving', 'cycling'],
                description: 'For type=route: travel mode for a real street-following route (the app returns distance + time). Pick from the verb the user used ("walk" → walking, "drive" → driving). Defaults to walking.',
              },
              latitude: { type: 'number', minimum: -90, maximum: 90, description: 'Explicit latitude (use only if no good place name exists).' },
              longitude: { type: 'number', minimum: -180, maximum: 180 },
              toTarget: { type: 'string', maxLength: 200, description: 'For type=arrow: the destination place name.' },
              toLatitude: { type: 'number', minimum: -90, maximum: 90 },
              toLongitude: { type: 'number', minimum: -180, maximum: 180 },
              label: { type: 'string', maxLength: 120, description: 'Short caption shown on the map (a few words). Optional.' },
              color: {
                type: 'string',
                enum: ['primary', 'amber', 'cyan', 'green', 'red'],
                description: 'Accent color. primary = neutral, amber = point of interest, cyan = infrastructure, green = confirmed/safe, red = alert.',
              },
              footprint: { type: 'boolean', description: 'For type=area/highlight: trace the real building or campus outline from map data. Defaults true for area.' },
              intent: { type: 'string', enum: ['the_thing', 'around_the_thing'], description: 'For type=area: "the_thing" (default) outlines the place itself (its footprint/boundary); "around_the_thing" highlights a surrounding zone (a buffered radius around it). Infer from phrasing: "the Capitol"/"show me X" → the_thing; "around/near/by X" or "the area around X" → around_the_thing.' },
              entityKind: { type: 'string', enum: ['building', 'compound', 'district', 'street', 'point_feature'], description: 'What KIND of thing the target IS — a fact, not a style choice: building = one structure; compound = campus/grounds/mall/park; district = neighborhood or area of a city; street = a named road/corridor; point_feature = monument/statue/memorial/plaque/fountain or other small point landmark. Set it whenever you know it — it routes the resolver to the right footprint source (point_feature anchors monuments as precise points instead of adopting a nearby building outline).' },
              screenX: { type: 'number', minimum: 0, maximum: 1, description: 'Fallback only: when you cannot name/geocode the place but can SEE it in the latest viewport screenshot, the normalized horizontal position (0=left, 1=right) of the spot. The app converts it back to a real world point under that pixel.' },
              screenY: { type: 'number', minimum: 0, maximum: 1, description: 'Fallback only: normalized vertical position (0=top, 1=bottom) of the spot in the latest viewport screenshot.' },
              toScreenX: { type: 'number', minimum: 0, maximum: 1, description: 'For type=arrow: normalized x of the arrow destination from the screenshot (pixel fallback).' },
              toScreenY: { type: 'number', minimum: 0, maximum: 1, description: 'For type=arrow: normalized y of the arrow destination from the screenshot (pixel fallback).' },
            },
            required: ['type'],
          },
        },
        flyTo: { type: 'boolean', description: 'Also move the camera to frame the first annotation. Default false — leave false if the user is already looking at the spot.' },
        persist: { type: 'boolean', description: 'Keep annotations until cleared (true, default) or let them auto-fade after ~20s (false).' },
      },
      required: ['annotations'],
    },
  },
  {
    type: 'function',
    name: 'clear_annotations',
    description: 'Erase ALL map annotations previously drawn with annotate_map. Call this ONLY when the user EXPLICITLY asks to clear or reset the map. Annotations accumulate and persist across navigation and topic changes by design — never clear on your own initiative.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    type: 'function',
    name: 'move_camera',
    description: 'Direct the camera like a drone operator: orbit the current view target, pan, tilt, or rotate — one bounded nudge (mode=once) or continuous motion until stopped (mode=continuous). Continuous motion also stops on any manual camera input or when a navigation tool runs. Say the RESULTING state when confirming ("Orbiting slowly").',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        motion: { type: 'string', enum: ['orbit', 'pan', 'tilt', 'rotate', 'stop'] },
        direction: { type: 'string', enum: ['left', 'right', 'up', 'down'], description: 'Required except for orbit (defaults right/clockwise) and stop.' },
        speed: { type: 'string', enum: ['slow', 'normal', 'fast'] },
        mode: { type: 'string', enum: ['once', 'continuous'], description: 'once = bounded eased nudge (default); continuous = until stop/manual input.' },
      },
      required: ['motion'],
    },
  },
  {
    type: 'function',
    name: 'fly_route',
    description: 'Cinematic dolly along an EXISTING route annotation (drawn earlier with annotate_map type=route) — flies the street-following path from start to end. Omit label for the newest route. If no route is drawn, this fails with guidance: draw the route first.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        label: { type: 'string', description: 'Match an existing route mark by (partial) label.' },
        speed: { type: 'string', enum: ['slow', 'normal', 'fast'] },
      },
    },
  },
  {
    type: 'function',
    name: 'analyst_query',
    description: 'Answer questions ABOUT the data currently loaded on the map — counts, lists, superlatives, and attribute filters over live layers (flights, military, ships, fires, earthquakes). Examples: "how many flights over Texas", "biggest fire near LA", "which ships are headed to Oakland", "anything above 40,000 feet", "fastest thing in view". Queries ONLY client-side data from ENABLED layers — if the needed layer is off, say so and offer to enable it. For a follow-up about the previous answer\'s set ("which of those is closest?"), set followUp=true and send only the new filters/sort.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        layers: {
          type: 'array',
          items: { type: 'string', enum: ['flights', 'military', 'ais-live-vessels', 'local-firms', 'earthquakes'] },
          description: 'Layers to query. fires/wildfires → local-firms; ships/vessels → ais-live-vessels.',
        },
        scope: {
          type: 'object',
          additionalProperties: false,
          description: 'Spatial scope. Default: view (near the camera). Use kind=region for "over Texas"-style asks; kind=anywhere for global questions.',
          properties: {
            kind: { type: 'string', enum: ['view', 'region', 'radius', 'anywhere'] },
            name: { type: 'string', description: 'For kind=region: a state/country ("Texas", "France") or a named natural region ("the Alps", "Gulf of Mexico").' },
            km: { type: 'number', description: 'For kind=radius.' },
            center: { type: 'object', additionalProperties: false, properties: { lat: { type: 'number' }, lon: { type: 'number' } } },
          },
        },
        filters: {
          type: 'array',
          description: 'Attribute predicates, ANDed. ALTITUDE IS METERS (40,000 ft = 12192). Fields: altitudeM, speedMps, military, onGround, aircraftClass, callsign, operator, routeOrigin, routeDestination, originCountry (flights); speedKts, shipType, destination (ships); frp, confidence (fires); magnitude, depthKm, place (earthquakes).',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              field: { type: 'string' },
              op: { type: 'string', enum: ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'contains'] },
              value: {},
            },
            required: ['field', 'op', 'value'],
          },
        },
        sortBy: { type: 'string', description: 'Field to rank by, or "distance" for nearest-first.' },
        sortDir: { type: 'string', enum: ['asc', 'desc'] },
        limit: { type: 'number' },
        followUp: { type: 'boolean', description: 'true = re-query the PREVIOUS result set instead of fresh data.' },
      },
    },
  },
  {
    type: 'function',
    name: 'next_iss_pass',
    description: "When the user asks when the ISS / the space station will next fly over: returns the next visible ISS pass for the current camera location (or an explicit lat/lon) — rise time (ISO + minutes from now), rise compass direction, peak elevation, and duration. Requires the satellites layer to have loaded its catalog at least once this session; if it hasn't, tell the user to enable the satellites layer and try again.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        latitude: { type: 'number', minimum: -90, maximum: 90, description: 'Optional observer latitude. Omit to use the current camera position.' },
        longitude: { type: 'number', minimum: -180, maximum: 180, description: 'Optional observer longitude. Omit to use the current camera position.' },
        minElevationDeg: { type: 'number', minimum: 5, maximum: 60, description: 'Minimum peak elevation (deg) to count as a pass. Default 10.' },
      },
    },
  },
];

/**
 * Load the `ws` constructor once.
 *
 * Node's built-in WebSocket cannot be used here: it has no terminate(), and
 * its close() waits forever for a close frame a black-holed peer never sends
 * (verified in src/data/aisWatchdogTransport.test.mjs). A socket parked in
 * CLOSING keeps holding AISStream's single per-key connection, which is how
 * the reverted watchdog wedged.
 *
 * Loaded lazily rather than imported at the top of this file so a missing
 * optional dependency degrades the vessel feed honestly instead of breaking
 * the whole dev server and build.
 *
 * @returns {Function|null}
 */
function aisWebSocketImpl() {
  if (_aisWebSocketImpl !== undefined) return _aisWebSocketImpl;
  try {
    _aisWebSocketImpl = createRequire(import.meta.url)('ws');
  } catch (error) {
    _aisWebSocketImpl = null;
    console.warn('[AISStream] `ws` is unavailable; the live vessel feed is off.', error?.message || '');
  }
  return _aisWebSocketImpl;
}

/**
 * Resolve the watchdog policy from the environment, once.
 *
 * Read lazily because module evaluation happens before Vite's loadEnv() copies
 * .env into process.env — the reverted watchdog read these at import time and
 * silently ignored every .env value, including its own kill switch.
 *
 * A custom subscription (one harbor, one message type) can be legitimately
 * silent for minutes, so the silence watch only self-arms for the default
 * worldwide subscription. An operator with a narrow filter opts back in by
 * setting AISSTREAM_SILENCE_TIMEOUT_MS to a value sized for that filter; 0 is
 * an explicit kill switch.
 */
function aisWatchdogPolicy() {
  if (_aisWatchdogPolicy) return _aisWatchdogPolicy;
  const customSubscription = Boolean(
    process.env.AISSTREAM_BOUNDING_BOXES || process.env.AISSTREAM_MESSAGE_TYPES,
  );
  const override = parseSilenceTimeoutEnv(
    process.env.AISSTREAM_SILENCE_TIMEOUT_MS,
    (message) => console.warn(message),
  );
  const reportMs = override.kind === 'timeout' ? override.value : AISSTREAM_SILENCE_REPORT_MS;
  _aisWatchdogPolicy = {
    silenceWatch: override.kind === 'off' ? false : (override.kind === 'timeout' || !customSubscription),
    reportMs,
    recycleMs: Math.round(reportMs * AISSTREAM_RECYCLE_RATIO),
    // Overridable so the watchdog can be exercised end-to-end against a local
    // stand-in upstream without opening a connection to AISStream (which
    // allows only one per key).
    url: process.env.AISSTREAM_URL || AISSTREAM_URL,
  };
  return _aisWatchdogPolicy;
}


/**
 * The transport adapter, built on first use and kept for the module lifetime.
 *
 * Never rebuilt: it owns the socket-generation namespace, and a restarted
 * namespace would let a pre-disposal handler act on its successor's socket.
 */
function aisAdapter() {
  if (_aisAdapter) return _aisAdapter;
  _aisAdapter = createAisStreamAdapter({
    createSocket: (url) => {
      const WebSocketCtor = aisWebSocketImpl();
      if (!WebSocketCtor) throw new Error('ws transport unavailable');
      return new WebSocketCtor(url);
    },
    resolveUrl: () => aisWatchdogPolicy().url,
    buildSubscription: aisStreamSubscription,
    ingestEnvelope: ingestAisStreamEnvelope,
    warn: (message) => console.warn(message),
  });
  _aisAdapter.setWatchdogOptions(aisWatchdogBudgets());
  return _aisAdapter;
}

/** Watchdog budgets derived from the resolved environment policy. */
function aisWatchdogBudgets() {
  const policy = aisWatchdogPolicy();
  return {
    staleMs: policy.reportMs,
    recycleAfterMs: policy.recycleMs,
    backoffMs: [...AISSTREAM_BACKOFF_MS],
    downRetryMs: AISSTREAM_DOWN_RETRY_MS,
    authProbeMs: AISSTREAM_AUTH_PROBE_MS,
  };
}

/**
 * Fingerprint the credential so a key change can clear the terminal
 * auth-failed state. Only a truncated digest is kept — never the key.
 */
function aisKeyFingerprint() {
  const key = process.env.AISSTREAM_API_KEY;
  if (!key) return null;
  return createHash('sha256').update(String(key)).digest('hex').slice(0, 12);
}

/**
 * Drive the watchdog once. Called on every /api/ais-live request and on the
 * background interval, so recovery does not depend on browser traffic.
 */
function ensureAisStreamConnection() {
  const adapter = aisAdapter();
  if (_aisNeedsRearm) {
    // Post-dispose re-arm, now that the restarted server's .env is loaded. The
    // adapter keeps its generation namespace across this.
    _aisNeedsRearm = false;
    adapter.setWatchdogOptions(aisWatchdogBudgets());
  }
  const policy = aisWatchdogPolicy();
  adapter.ensure({
    hasKey: Boolean(process.env.AISSTREAM_API_KEY),
    hasTransport: Boolean(aisWebSocketImpl()),
    silenceWatch: policy.silenceWatch,
    keyFingerprint: aisKeyFingerprint(),
  });
}
/** Status metadata for /api/ais-live, safe to call before the first connect. */
function aisStreamStatusSnapshot() {
  const snapshot = _aisAdapter ? _aisAdapter.snapshot() : null;
  if (snapshot) return snapshot;
  return {
    status: process.env.AISSTREAM_API_KEY ? 'idle' : 'missing-key',
    error: process.env.AISSTREAM_API_KEY ? null : 'AISSTREAM_API_KEY is not set',
    lastMessageAt: null,
    silentForMs: null,
    reconnectAttempt: 0,
    nextAttemptAt: null,
    watchdog: 'armed',
    staleAfterMs: AISSTREAM_SILENCE_REPORT_MS,
  };
}

/**
 * Start the background watchdog tick. Unref'd so it never holds the dev server
 * open, and idempotent so a Vite in-process restart cannot stack intervals.
 */
function startAisStreamWatchdogTick() {
  if (_aisStreamTickTimer) return;
  _aisStreamTickTimer = setInterval(() => {
    try {
      ensureAisStreamConnection();
    } catch (error) {
      console.warn('[AISStream] watchdog tick failed', error?.message || '');
    }
  }, AISSTREAM_TICK_MS);
  _aisStreamTickTimer.unref?.();
}

/**
 * Tear down every timer and socket this module owns.
 *
 * Vite restarts the dev server in-process on a config change while module
 * state survives, so without this each reload stacked another interval and
 * another reconnect chain. The cached policy is dropped too, so a restart
 * re-reads .env.
 *
 * The adapter instance itself is deliberately KEPT: it owns the socket
 * generation namespace, which must stay monotonic across restarts so a
 * pre-disposal handler can never collide with a post-disposal socket.
 */
function disposeAisStream() {
  if (_aisStreamTickTimer) {
    clearInterval(_aisStreamTickTimer);
    _aisStreamTickTimer = null;
  }
  if (_aisAdapter) _aisAdapter.dispose();
  // Drop the cached policy and re-arm LAZILY. Re-deriving budgets here would
  // read process.env before the restarted server's loadEnv() has repopulated
  // it, caching the outgoing configuration; the next ensure() runs after that.
  _aisWatchdogPolicy = null;
  _aisNeedsRearm = true;
}

function aisStreamSubscription() {
  return {
    APIKey: process.env.AISSTREAM_API_KEY,
    BoundingBoxes: parseJsonEnv('AISSTREAM_BOUNDING_BOXES', AISSTREAM_DEFAULT_BBOXES),
    FilterMessageTypes: parseCsvOrJsonEnv('AISSTREAM_MESSAGE_TYPES', AISSTREAM_DEFAULT_MESSAGE_TYPES),
  };
}

/**
 * Store one parsed AIS envelope.
 *
 * The return value is the feed's ONLY liveness proof, so it is true strictly
 * when the envelope carried a real AIS record. Malformed frames and error
 * envelopes never reach here — the adapter classifies those — and a JSON
 * object without an MMSI proves nothing about the feed.
 *
 * @param {Object} envelope Parsed, non-error AIS envelope.
 * @returns {boolean} True when an AIS record was recognised.
 */
function ingestAisStreamEnvelope(envelope) {
  // Single shared recognition rule (also used by the adapter's tests), so the
  // liveness predicate that ships is the one under test. An envelope carrying
  // only an MMSI is not proof the feed works.
  if (!isRecognizedAisEnvelope(envelope)) return false;

  const messageType = envelope?.MessageType;
  const message = envelope?.Message?.[messageType] || {};
  const metadata = envelope?.MetaData || envelope?.Metadata || {};
  const mmsi = stringValue(metadata.MMSI ?? message.UserID ?? message.UserId ?? message.Mmsi);
  if (!mmsi) return false;

  if (messageType === 'ShipStaticData' || messageType === 'StaticDataReport') {
    const staticData = {
      name: vesselNameFromAis(metadata, message, _aisStreamStatic.get(mmsi)),
      type: vesselTypeFromAis(message, _aisStreamStatic.get(mmsi)),
      destination: stringValue(message.Destination),
      imo: stringValue(message.ImoNumber ?? message.IMO),
    };
    _aisStreamStatic.set(mmsi, staticData);
    mergeAisStaticIntoLiveVessel(mmsi, staticData);
  }

  const lat = numberValue(metadata.latitude ?? metadata.Latitude ?? message.Latitude);
  const lon = numberValue(metadata.longitude ?? metadata.Longitude ?? message.Longitude);
  // A positionless but well-formed record (static data) is still the feed
  // delivering AIS traffic, so it counts as liveness.
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return true;

  const staticData = _aisStreamStatic.get(mmsi) || {};
  _aisStreamVessels.set(mmsi, {
    lat,
    lon,
    name: vesselNameFromAis(metadata, message, staticData) || `MMSI ${mmsi}`,
    mmsi,
    imo: stringValue(message.ImoNumber ?? message.IMO ?? staticData.imo),
    type: vesselTypeFromAis(message, staticData),
    destination: stringValue(message.Destination ?? staticData.destination),
    speed: numberValue(message.Sog ?? message.SOG),
    course: numberValue(message.Cog ?? message.COG),
    heading: normalizedHeading(message.TrueHeading ?? message.Heading),
    last_position_UTC: normalizeAisTimestamp(metadata.time_utc ?? metadata.TimeUtc),
    // Use the AIS message's own report time, not server ingest wall-clock —
    // trail spacing and dead reckoning depend on true fix epochs.
    last_position_epoch: aisEpochSeconds(metadata.time_utc ?? metadata.TimeUtc),
    _updatedAt: Date.now(),
  });

  appendAisTrackSample(mmsi, lat, lon, aisEpochSeconds(metadata.time_utc ?? metadata.TimeUtc));

  pruneAisStreamCache();
  return true;
}

/**
 * Parses an AISStream UTC timestamp into epoch seconds (fallback: now).
 */
function aisEpochSeconds(value) {
  const ms = Date.parse(normalizeAisTimestamp(value));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
}

/**
 * Appends a thinned position sample to a vessel's track ring buffer.
 * Buffers allocate lazily on the second fix (most MMSIs are seen once);
 * samples are kept only when >=AIS_TRACK_MIN_GAP_SEC and
 * >=AIS_TRACK_MIN_MOVE_M from the previous stored sample, so anchored
 * vessels collapse to a single point.
 */
function appendAisTrackSample(mmsi, lat, lon, epochSec) {
  let track = _aisStreamTracks.get(mmsi);
  if (!track) {
    const pending = _aisStreamTrackPending.get(mmsi);
    if (!pending) {
      _aisStreamTrackPending.set(mmsi, { lat, lon, epochSec });
      return;
    }
    if (epochSec - pending.epochSec < AIS_TRACK_MIN_GAP_SEC) return;
    if (approxMetersBetween(pending.lat, pending.lon, lat, lon) < AIS_TRACK_MIN_MOVE_M) return;
    track = {
      lats: new Float32Array(AIS_TRACK_SAMPLES),
      lons: new Float32Array(AIS_TRACK_SAMPLES),
      times: new Uint32Array(AIS_TRACK_SAMPLES),
      head: 0,
      len: 0,
    };
    _aisStreamTracks.set(mmsi, track);
    _aisStreamTrackPending.delete(mmsi);
    writeAisTrackSample(track, pending.lat, pending.lon, pending.epochSec);
    writeAisTrackSample(track, lat, lon, epochSec);
    return;
  }

  const lastIdx = (track.head - 1 + AIS_TRACK_SAMPLES) % AIS_TRACK_SAMPLES;
  const lastEpoch = track.times[lastIdx];
  if (epochSec - lastEpoch < AIS_TRACK_MIN_GAP_SEC) return;
  if (approxMetersBetween(track.lats[lastIdx], track.lons[lastIdx], lat, lon) < AIS_TRACK_MIN_MOVE_M) return;
  writeAisTrackSample(track, lat, lon, epochSec);
}

function writeAisTrackSample(track, lat, lon, epochSec) {
  track.lats[track.head] = lat;
  track.lons[track.head] = lon;
  track.times[track.head] = epochSec;
  track.head = (track.head + 1) % AIS_TRACK_SAMPLES;
  track.len = Math.min(track.len + 1, AIS_TRACK_SAMPLES);
}

/**
 * Reads a vessel's accumulated track in chronological order.
 * @returns {Array<{lat:number,lon:number,t:number}>}
 */
function readAisTrack(mmsi) {
  const track = _aisStreamTracks.get(mmsi);
  if (!track || !track.len) return [];
  const samples = [];
  const start = (track.head - track.len + AIS_TRACK_SAMPLES) % AIS_TRACK_SAMPLES;
  for (let i = 0; i < track.len; i++) {
    const idx = (start + i) % AIS_TRACK_SAMPLES;
    samples.push({ lat: track.lats[idx], lon: track.lons[idx], t: track.times[idx] });
  }
  return samples;
}

/** Equirectangular distance approximation — plenty for 25m thinning. */
function approxMetersBetween(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * 111320;
  const dLon = (lon2 - lon1) * 111320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

function mergeAisStaticIntoLiveVessel(mmsi, staticData) {
  const existing = _aisStreamVessels.get(mmsi);
  if (!existing) return;
  if (staticData.name && (!existing.name || existing.name === `MMSI ${mmsi}`)) existing.name = staticData.name;
  if (staticData.type && !existing.type) existing.type = staticData.type;
  if (staticData.destination && !existing.destination) existing.destination = staticData.destination;
  if (staticData.imo && !existing.imo) existing.imo = staticData.imo;
}

function vesselNameFromAis(metadata, message, staticData = {}) {
  return stringValue(
    metadata.ShipName
      ?? message.Name
      ?? message.ShipName
      ?? message.ReportA?.Name
      ?? staticData.name
  );
}

function vesselTypeFromAis(message, staticData = {}) {
  return stringValue(
    message.Type
      ?? message.ShipType
      ?? message.ReportB?.ShipType
      ?? staticData.type
  );
}

function aisStreamRows(maxRows) {
  const cutoff = Date.now() - AISSTREAM_STALE_MS;
  const rows = [];
  for (const row of _aisStreamVessels.values()) {
    if (row._updatedAt >= cutoff) rows.push(row);
  }
  rows.sort((a, b) => b._updatedAt - a._updatedAt);
  return rows.slice(0, maxRows).map(({ _updatedAt, ...row }) => row);
}

function pruneAisStreamCache() {
  const cutoff = Date.now() - AISSTREAM_STALE_MS;
  for (const [mmsi, row] of _aisStreamVessels) {
    if (row._updatedAt < cutoff) {
      _aisStreamVessels.delete(mmsi);
      _aisStreamTracks.delete(mmsi);
      _aisStreamTrackPending.delete(mmsi);
    }
  }
  // Pending single-fix entries for vessels never seen again must not leak
  const pendingCutoffSec = Math.floor(cutoff / 1000);
  for (const [mmsi, pending] of _aisStreamTrackPending) {
    if (pending.epochSec < pendingCutoffSec) _aisStreamTrackPending.delete(mmsi);
  }
  if (_aisStreamVessels.size <= AISSTREAM_CACHE_MAX) return;
  const ordered = [..._aisStreamVessels.entries()].sort((a, b) => a[1]._updatedAt - b[1]._updatedAt);
  for (const [mmsi] of ordered.slice(0, _aisStreamVessels.size - AISSTREAM_CACHE_MAX)) {
    _aisStreamVessels.delete(mmsi);
    _aisStreamTracks.delete(mmsi);
    _aisStreamTrackPending.delete(mmsi);
  }
}

function newestAisPositionAt(rows) {
  return rows[0]?.last_position_UTC || null;
}

// ---------------------------------------------------------------------------
// Military-installation context proxy
// ---------------------------------------------------------------------------
// This narrow endpoint deliberately does not expose arbitrary Overpass QL to
// the browser. It returns only allow-listed mapped context and rejects global,
// cross-dateline, or oversized requests before touching public OSM mirrors.
const MILITARY_INSTALLATION_CACHE_MS = 5 * 60_000;
const MILITARY_INSTALLATION_STALE_MS = 60 * 60_000;
const MILITARY_INSTALLATION_MAX_CACHE = 80;
const MILITARY_INSTALLATION_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
/**
 * Upstream element cap. A response that hits it exactly is SATURATED — Overpass
 * truncated, so off-viewport features from the snapped bbox may have crowded out
 * in-viewport ones. Callers re-ask for the exact viewport in that case.
 */
export const MILITARY_INSTALLATION_ELEMENT_CAP = 700;
/**
 * Disk-cache TTL for mapped installations (ms) — 30 days.
 *
 * Field test 2026-08-18: "search nearby sites" was slow because every look
 * around paid a live Overpass round trip, and the 5-minute in-memory tier died
 * with the dev server. Mapped military features change on a survey timescale,
 * not a session one, so a month-old answer is still the right answer — the same
 * reasoning the Overpass proxy already applies to admin boundaries.
 */
const MILITARY_INSTALLATION_DISK_TTL_MS = 30 * 86_400_000;
/** Disk-cache directory for mapped installation payloads. */
const MILITARY_INSTALLATION_DISK_DIR = path.join(process.cwd(), '.gev-cache', 'military-installations');
/**
 * Cache-key grid step in degrees (~5.5 km).
 *
 * The browser sends the raw view rectangle, so every pixel of pan minted a new
 * key and a new upstream query. Snapping the bbox OUTWARD onto a coarse grid
 * makes neighbouring viewports share one entry, and because the snap only ever
 * grows the box, the cached answer is always a superset of what was asked for.
 */
const MILITARY_INSTALLATION_BBOX_STEP_DEG = 0.05;
const _militaryInstallationCache = new Map();
const _militaryInstallationInFlight = new Map();

/**
 * Snap a request bbox outward onto the shared installation cache grid.
 * @param {{south:number, west:number, north:number, east:number}} box
 * @param {number} [stepDeg]
 * @returns {{south:number, west:number, north:number, east:number}}
 */
export function quantizeMilitaryInstallationBox(box, stepDeg = MILITARY_INSTALLATION_BBOX_STEP_DEG) {
  // Round the ratio first: 29.9999/0.05 lands a hair under an exact grid line
  // in binary floating point, which would otherwise snap a whole cell too far.
  const snap = (value, grow) => {
    const cells = Number((value / stepDeg).toFixed(9));
    return Number(((grow > 0 ? Math.ceil(cells) : Math.floor(cells)) * stepDeg).toFixed(6));
  };
  return {
    south: Math.max(-90, snap(box.south, -1)),
    west: Math.max(-180, snap(box.west, -1)),
    north: Math.min(90, snap(box.north, 1)),
    east: Math.min(180, snap(box.east, 1)),
  };
}

/**
 * Stable disk/memory cache key for an installation bbox.
 *
 * The key's precision must match the precision of the bounds the QUERY uses, or
 * two different queries collide on one entry. Snapped boxes live on a 0.05 deg
 * grid, so 3 decimals is exact for them; an `exact=1` request carries the raw
 * viewport at 5 decimals and must be keyed at 5, otherwise two nearby exact
 * viewports would share an answer and the second would be missing the edge
 * strip it just exposed.
 * @param {{south:number, west:number, north:number, east:number}} box
 * @param {number} [decimals]
 */
export function militaryInstallationCacheKey(box, decimals = 3) {
  return [box.south, box.west, box.north, box.east]
    .map((value) => value.toFixed(decimals))
    .join(',');
}

/**
 * Resolve the READ tiers for one installation request, in order: fresh memory,
 * then disk. Returns UPSTREAM when neither can answer.
 *
 * Disk is skipped while a request for this key is already in flight — the
 * caller joins that instead of paying a read. Exported so the tier ORDER is
 * testable against a real temp directory without a Vite server, mirroring
 * resolveOverpassPreflight.
 *
 * @param {object} options
 * @param {string} options.cacheKey
 * @param {Map<string, {payload: object, cachedAt: number}>} options.memoryCache
 * @param {Map<string, Promise>} options.inFlight
 * @param {() => Promise<?{payload: object, cachedAt: number}>} options.readDisk
 * @param {number} [options.now]
 * @param {number} [options.cacheMs]
 * @returns {Promise<{source: 'HIT'|'DISK'|'UPSTREAM', entry: ?object}>}
 */
export async function resolveMilitaryInstallationTier({
  cacheKey,
  memoryCache,
  inFlight,
  readDisk,
  now = Date.now(),
  cacheMs = MILITARY_INSTALLATION_CACHE_MS,
}) {
  const cached = memoryCache.get(cacheKey);
  if (cached && now - cached.cachedAt <= cacheMs) return { source: 'HIT', entry: cached };
  if (inFlight.has(cacheKey)) return { source: 'UPSTREAM', entry: null };
  const disk = await readDisk();
  return disk ? { source: 'DISK', entry: disk } : { source: 'UPSTREAM', entry: null };
}

/**
 * Bring a stored installation entry up to the current payload shape.
 *
 * Entries written before the saturation guard shipped carry no `saturated`
 * field, and the disk TTL is 30 DAYS — so without this a cached, truncated
 * 700-element snapped response would keep skipping the exact-viewport retry for
 * a month, quietly starving in-view sites. Saturation is DERIVED from the
 * element count rather than invalidating those entries, so warm caches survive
 * the upgrade.
 * @param {?{payload: object, cachedAt: number}} entry
 * @returns {?{payload: object, cachedAt: number}}
 */
export function migrateMilitaryInstallationEntry(entry) {
  if (!entry?.payload || typeof entry.payload.saturated === 'boolean') return entry;
  const elements = Array.isArray(entry.payload.elements) ? entry.payload.elements : [];
  return {
    ...entry,
    payload: {
      ...entry.payload,
      saturated: elements.length >= MILITARY_INSTALLATION_ELEMENT_CAP,
    },
  };
}

/** Whether a stored installation entry is still inside its TTL. */
export function militaryInstallationDiskFresh(
  entry,
  maxAgeMs = MILITARY_INSTALLATION_DISK_TTL_MS,
  now = Date.now(),
) {
  if (!entry || !Number.isFinite(entry.cachedAt) || !Array.isArray(entry.payload?.elements)) return false;
  return now - entry.cachedAt <= maxAgeMs;
}

/** Cache key -> stable disk-cache file path. */
export function militaryInstallationDiskPath(cacheKey, dir = MILITARY_INSTALLATION_DISK_DIR) {
  return path.join(dir, `${createHash('sha1').update(cacheKey).digest('hex')}.json`);
}

/**
 * Read a disk-cached installation entry. maxAgeMs Infinity = any age (the
 * serve-stale path when Overpass is down).
 * @returns {Promise<?{payload: object, cachedAt: number}>}
 */
export async function readMilitaryInstallationDisk(
  cacheKey,
  maxAgeMs,
  dir = MILITARY_INSTALLATION_DISK_DIR,
) {
  try {
    const entry = JSON.parse(await fsp.readFile(militaryInstallationDiskPath(cacheKey, dir), 'utf8'));
    if (!militaryInstallationDiskFresh(entry, maxAgeMs)) return null;
    return migrateMilitaryInstallationEntry(entry);
  } catch {
    return null;
  }
}

/**
 * Persist one installation payload ATOMICALLY: serialize to a temp sibling,
 * then rename over the target. A crash or a full disk mid-write leaves the
 * PREVIOUS entry intact — an in-place overwrite would shred the last-good copy
 * and take serve-stale down with it, exactly when it is needed most.
 * @returns {Promise<boolean>} Whether the entry landed.
 */
export async function writeMilitaryInstallationDisk(
  cacheKey,
  entry,
  dir = MILITARY_INSTALLATION_DISK_DIR,
) {
  const target = militaryInstallationDiskPath(cacheKey, dir);
  // Same directory, so the rename is atomic on POSIX rather than a cross-device copy.
  const temp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(temp, JSON.stringify(entry));
    await fsp.rename(temp, target);
    return true;
  } catch (err) {
    console.warn('[Installations Proxy] disk cache write failed:', err?.message || err);
    await fsp.rm(temp, { force: true }).catch(() => {});
    return false;
  }
}

export function validMilitaryInstallationBox(params) {
  const south = requiredFiniteQueryNumber(params, 'south');
  const west = requiredFiniteQueryNumber(params, 'west');
  const north = requiredFiniteQueryNumber(params, 'north');
  const east = requiredFiniteQueryNumber(params, 'east');
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180 || south >= north || west >= east) return null;
  if (north - south > 10 || east - west > 10) return null;
  return { south, west, north, east };
}

function trimMilitaryInstallationCache() {
  while (_militaryInstallationCache.size > MILITARY_INSTALLATION_MAX_CACHE) {
    const oldest = _militaryInstallationCache.keys().next().value;
    if (oldest === undefined) break;
    _militaryInstallationCache.delete(oldest);
  }
}

function militaryInstallationsProxy() {
  async function refresh(box, key) {
    const bbox = `${box.south},${box.west},${box.north},${box.east}`;
    const ql = `[out:json][timeout:20];(nwr["military"~"^(airfield|naval_base|range|barracks|base)$"](${bbox});nwr["landuse"="military"](${bbox}););out center tags geom ${MILITARY_INSTALLATION_ELEMENT_CAP};`;
    const upstream = await fetchOverpassPayload(
      `data=${encodeURIComponent(ql)}`,
      MILITARY_INSTALLATION_MAX_RESPONSE_BYTES,
    );
    if (upstream.status >= 400 || upstream.rateLimited || upstream.runtimeError) {
      throw new Error('Mapped installation upstream unavailable');
    }
    const parsed = JSON.parse(upstream.body);
    const elements = Array.isArray(parsed?.elements)
      ? parsed.elements.slice(0, MILITARY_INSTALLATION_ELEMENT_CAP)
      : [];
    const payload = {
      elements,
      // Honest truncation flag — the client re-asks for its exact viewport so
      // off-view features can never starve in-view ones. The cap travels with
      // the payload so the client never has to hard-code it.
      saturated: elements.length >= MILITARY_INSTALLATION_ELEMENT_CAP,
      elementCap: MILITARY_INSTALLATION_ELEMENT_CAP,
      retrievedAt: new Date().toISOString(),
      status: 'ready',
    };
    const entry = { payload, cachedAt: Date.now() };
    _militaryInstallationCache.set(key, entry);
    trimMilitaryInstallationCache();
    writeMilitaryInstallationDisk(key, entry);
    return payload;
  }

  function install(middlewares) {
    middlewares.use('/api/military-installations', async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        return;
      }
      if (!_militaryInstallationsRateLimiter(clientKey(req))) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '5' });
        res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
        return;
      }
      const url = new URL(req.url, 'http://localhost');
      const requested = validMilitaryInstallationBox(url.searchParams);
      if (!requested) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'A non-dateline bbox no larger than 10 degrees is required' }));
        return;
      }
      // Query the SNAPPED box, not the raw viewport: neighbouring views then
      // share one cache entry, and an outward snap always covers what was asked.
      // `exact=1` opts out — the client sends it after a SATURATED snapped
      // response, so a truncated tile can never starve the actual viewport. It
      // is keyed separately so exact and snapped answers never collide.
      const exact = url.searchParams.get('exact') === '1';
      const box = exact ? requested : quantizeMilitaryInstallationBox(requested);
      // Key at the precision the query actually uses (see militaryInstallationCacheKey).
      const key = exact
        ? `exact:${militaryInstallationCacheKey(box, 5)}`
        : militaryInstallationCacheKey(box);
      const now = Date.now();
      const cached = _militaryInstallationCache.get(key);
      const preflight = await resolveMilitaryInstallationTier({
        cacheKey: key,
        memoryCache: _militaryInstallationCache,
        inFlight: _militaryInstallationInFlight,
        readDisk: () => readMilitaryInstallationDisk(key, MILITARY_INSTALLATION_DISK_TTL_MS),
        now,
      });
      if (preflight.source !== 'UPSTREAM') {
        if (preflight.source === 'DISK') {
          _militaryInstallationCache.set(key, preflight.entry);
          trimMilitaryInstallationCache();
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'X-Military-Installations': preflight.source });
        res.end(JSON.stringify({ ...preflight.entry.payload, status: 'cached' }));
        return;
      }
      const request = coalesceProxyRequest(
        _militaryInstallationInFlight,
        key,
        () => refresh(box, key),
      );
      try {
        const payload = await request.promise;
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
          'X-Military-Installations': request.shared ? 'INFLIGHT' : 'MISS',
        });
        res.end(JSON.stringify(payload));
      } catch (error) {
        if (cached && now - cached.cachedAt <= MILITARY_INSTALLATION_STALE_MS) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Military-Installations': 'STALE' });
          res.end(JSON.stringify({ ...cached.payload, status: 'stale' }));
          return;
        }
        // Overpass is down: last-good mapped context at ANY age beats an empty
        // layer (the same serve-stale rule the Overpass proxy applies).
        const stale = await readMilitaryInstallationDisk(key, Infinity);
        if (stale) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Military-Installations': 'STALE-DISK' });
          res.end(JSON.stringify({ ...stale.payload, status: 'stale' }));
          return;
        }
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Mapped installation context is temporarily unavailable' }));
      }
    });
  }

  return {
    name: 'military-installations-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

// ---------------------------------------------------------------------------
// Power-grid context proxy — viewport-bounded OpenStreetMap transmission network
// ---------------------------------------------------------------------------
// Like the mapped-installation and mapped-camera proxies, this deliberately does
// not expose arbitrary Overpass QL to the browser: it answers one allow-listed
// power query inside a box no wider than POWER_GRID_MAX_BOX_DEG, snapped OUTWARD
// onto a shared grid so neighbouring viewports share one cached answer.
//
// It does NOT go through `fetchOverpassPayload`, and that is deliberate: that
// helper runs `simplifyOverpassPayloadBody` on every success, which decimates
// geometry past 1.5 MB at a ~44 m tolerance. A dense viewport here is 3.8 MB
// (measured Île-de-France, 0.6°), so the shared path would silently move
// transmission lines off their pylons. This proxy publishes the mapped vertices
// and rounds them once, to five decimals, in `projectPowerGrid`.
/** Memory-cache TTL for one snapped viewport box. */
const POWER_GRID_CACHE_MS = 10 * 60_000;
/** In-memory cache ceiling (boxes), evicted oldest-first. */
const POWER_GRID_MAX_CACHE = 60;
/** Disk-cache directory for projected power-grid boxes. */
const POWER_GRID_DISK_DIR = path.join(process.cwd(), '.gev-cache', 'power-grid');
/**
 * Disk TTL (7 days). A transmission line is built over a decade and mapped once;
 * a week-old answer is the same answer, and the in-memory tier dies with the dev
 * server — the same reasoning the mapped-installation proxy applies.
 */
const POWER_GRID_DISK_TTL_MS = 7 * 86_400_000;
/** Bump when the projected document shape changes so old entries are ignored. */
const POWER_GRID_CACHE_VERSION = 'v1';
/**
 * Read cap for one box probe. Measured worst case is 3.8 MB (Île-de-France at
 * 0.6°, 2,200 strokes and 48,439 vertices); the cap leaves room for a denser
 * box elsewhere without letting a runaway answer into memory.
 */
const POWER_GRID_MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
/**
 * Wall-clock budget for one box refresh, shared by all mirror attempts. Sized
 * against measured Overpass latency for this query (4 s rural, 11-21 s in
 * Île-de-France, with 429/504 common enough on the primary mirror that the
 * fallbacks must still get a turn).
 */
const POWER_GRID_REFRESH_BUDGET_MS = 45_000;
/**
 * Floor on one mirror attempt's share of that budget — the same fairness rule
 * the mapped-camera proxy learned twice: a mirror that stalls must not eat the
 * whole window, and a mirror that is genuinely working must not be cut off at
 * an even split. Sized above the measured latency of this query (2.2 s warm on
 * a tight box, 7.2 s on a half-degree one, 11-21 s on the densest boxes
 * Overpass will answer at all), so a mirror that is working is never aborted to
 * preserve a turn for one that is not — while still leaving room for three
 * mirrors inside the budget when the first ones fail fast, which is exactly
 * what the field run of 2026-08-27 needed (504, 502, 504, then a timeout).
 */
const POWER_GRID_MIN_ATTEMPT_MS = 18_000;
const _powerGridCache = new Map();
const _powerGridInFlight = new Map();
const _powerGridRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 40, globalMax: 120 });

/** Cache key -> stable disk-cache file path. */
function powerGridDiskPath(cacheKey) {
  return path.join(POWER_GRID_DISK_DIR, `${createHash('sha1').update(cacheKey).digest('hex')}.json`);
}

/**
 * Read a disk-cached box at ANY age. Freshness is the caller's decision: an
 * expired box is still the right answer while Overpass is down (serve-stale
 * beats an empty viewport).
 * @param {string} cacheKey
 * @returns {Promise<?{cachedAt:number, payload:object}>}
 */
async function readPowerGridDisk(cacheKey) {
  try {
    const entry = JSON.parse(await fsp.readFile(powerGridDiskPath(cacheKey), 'utf8'));
    if (!Number.isFinite(entry?.cachedAt) || !Array.isArray(entry?.payload?.strokes)) return null;
    return entry;
  } catch {
    return null;
  }
}

/**
 * Persist one box ATOMICALLY (temp sibling + rename), so a crash mid-write
 * leaves the previous entry — and serve-stale — intact.
 * @param {string} cacheKey
 * @param {{cachedAt:number, payload:object}} entry
 * @returns {Promise<boolean>}
 */
async function writePowerGridDisk(cacheKey, entry) {
  const target = powerGridDiskPath(cacheKey);
  const temp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fsp.mkdir(POWER_GRID_DISK_DIR, { recursive: true });
    await fsp.writeFile(temp, JSON.stringify(entry));
    await fsp.rename(temp, target);
    return true;
  } catch (error) {
    console.warn('[Power Grid] disk cache write failed:', error?.message || error);
    await fsp.rm(temp, { force: true }).catch(() => {});
    return false;
  }
}

/**
 * One bounded Overpass probe: try mirrors in order until one answers or the
 * deadline passes, ABORTING each attempt rather than letting a slow or wedged
 * mirror hold the request open. Rate-limited, runtime-error, and non-JSON
 * responses fall through to the next mirror; every per-mirror outcome is
 * aggregated into the thrown error so an outage is readable.
 *
 * @param {string} ql - Overpass QL for one box.
 * @param {number} deadline - Epoch-ms after which no further attempt starts.
 * @returns {Promise<Array<object>>} Raw Overpass elements.
 */
async function fetchPowerGridElements(ql, deadline) {
  const outcomes = [];
  for (let index = 0; index < OVERPASS_UPSTREAMS.length; index++) {
    const endpoint = OVERPASS_UPSTREAMS[index];
    const host = new URL(endpoint).host;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    const attemptMs = Math.max(
      POWER_GRID_MIN_ATTEMPT_MS,
      Math.floor(remainingMs / (OVERPASS_UPSTREAMS.length - index)),
    );
    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': OVERPASS_USER_AGENT,
        },
        body: `data=${encodeURIComponent(ql)}`,
        signal: AbortSignal.timeout(Math.min(remainingMs, attemptMs)),
      });
      const body = await readResponseTextCapped(upstream, POWER_GRID_MAX_RESPONSE_BYTES);
      const rateLimited = overpassLooksRateLimited(body);
      if (upstream.status >= 400 || rateLimited || overpassLooksRuntimeError(body)) {
        outcomes.push(`${host}: ${rateLimited ? 'rate limited' : `HTTP ${upstream.status}`}`);
        continue;
      }
      const elements = JSON.parse(body)?.elements;
      if (!Array.isArray(elements)) {
        outcomes.push(`${host}: no element list`);
        continue;
      }
      return elements;
    } catch (error) {
      const reason = /timeout|abort/i.test(String(error?.message))
        ? `timed out after ${attemptMs} ms`
        : (error?.message || 'failed');
      outcomes.push(`${host}: ${reason}`);
    }
  }
  const skipped = OVERPASS_UPSTREAMS.length - outcomes.length;
  throw new Error(
    `no Overpass mirror answered inside the request budget — ${outcomes.join('; ')}`
    + (skipped > 0 ? `; ${skipped} not tried (budget spent)` : ''),
  );
}

function trimPowerGridCache() {
  while (_powerGridCache.size > POWER_GRID_MAX_CACHE) {
    const oldest = _powerGridCache.keys().next().value;
    if (oldest === undefined) break;
    _powerGridCache.delete(oldest);
  }
}

/**
 * Vite plugin: viewport-bounded OpenStreetMap power-grid proxy.
 *
 *   GET /api/power-grid?south&west&north&east — high-voltage lines, cables,
 *   substations and (in tight views) pylons inside that box, projected by
 *   `projectPowerGrid`.
 *
 * @returns {import('vite').Plugin}
 */
function powerGridProxy() {
  async function refresh(box, key) {
    const towers = powerGridIncludesTowers(box);
    const ql = powerGridQuery(box, { towers });
    const elements = await fetchPowerGridElements(
      ql,
      Date.now() + POWER_GRID_REFRESH_BUDGET_MS,
    );
    const payload = {
      ...projectPowerGrid({ elements }, { towersRequested: towers }),
      box,
      retrievedAt: new Date().toISOString(),
      status: 'ready',
      source: 'OpenStreetMap contributors (ODbL 1.0), via Overpass',
    };
    const entry = { cachedAt: Date.now(), payload };
    _powerGridCache.set(key, entry);
    trimPowerGridCache();
    writePowerGridDisk(key, entry);
    return payload;
  }

  function install(middlewares) {
    middlewares.use('/api/power-grid', async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        return;
      }
      if (!_powerGridRateLimiter(clientKey(req))) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '5' });
        res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
        return;
      }
      const url = new URL(req.url, 'http://localhost');
      const requested = validPowerGridBox({
        south: url.searchParams.get('south'),
        west: url.searchParams.get('west'),
        north: url.searchParams.get('north'),
        east: url.searchParams.get('east'),
      });
      if (!requested) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `A non-dateline bbox no larger than ${POWER_GRID_MAX_BOX_DEG} degrees is required`,
        }));
        return;
      }
      // Query the SNAPPED box, not the raw viewport: neighbouring views share
      // one cache entry, and an outward snap always covers what was asked for.
      // Whether pylons are included is decided from the SNAPPED box too, so the
      // key stays a pure function of the box.
      const box = snapPowerGridBox(requested);
      const key = `${POWER_GRID_CACHE_VERSION}|${powerGridBoxKey(box)}`;
      const now = Date.now();
      const cached = _powerGridCache.get(key);
      if (cached && now - cached.cachedAt <= POWER_GRID_CACHE_MS) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120', 'X-Power-Grid': 'HIT' });
        res.end(JSON.stringify({ ...cached.payload, status: 'cached' }));
        return;
      }
      if (!_powerGridInFlight.has(key)) {
        const disk = await readPowerGridDisk(key);
        if (disk && now - disk.cachedAt <= POWER_GRID_DISK_TTL_MS) {
          _powerGridCache.set(key, disk);
          trimPowerGridCache();
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120', 'X-Power-Grid': 'DISK' });
          res.end(JSON.stringify({ ...disk.payload, status: 'cached' }));
          return;
        }
      }
      const request = coalesceProxyRequest(_powerGridInFlight, key, () => refresh(box, key));
      try {
        const payload = await request.promise;
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=120',
          'X-Power-Grid': request.shared ? 'INFLIGHT' : 'MISS',
        });
        res.end(JSON.stringify(payload));
      } catch (error) {
        // Overpass is down: last-good geometry at ANY age beats an empty
        // viewport (the same serve-stale rule the Overpass proxy applies).
        const stale = await readPowerGridDisk(key);
        if (stale) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Power-Grid': 'STALE-DISK' });
          res.end(JSON.stringify({ ...stale.payload, status: 'stale' }));
          return;
        }
        console.warn('[Power Grid] box unavailable:', error?.message || error);
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Mapped power-grid geometry is temporarily unavailable' }));
      }
    });
  }

  return {
    name: 'power-grid-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

// ---------------------------------------------------------------------------
// Regional cockpit briefing proxy
// ---------------------------------------------------------------------------
const REGIONAL_BRIEF_CACHE_MS = 5 * 60_000;
const REGIONAL_BRIEF_STALE_MS = 60 * 60_000;
const REGIONAL_BRIEF_MAX_CACHE = 120;
const REGIONAL_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const _regionalBriefCache = new Map();
const _regionalBriefInFlight = new Map();
const _regionalBriefRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 30, globalMax: 90 });
const WEATHER_EFFECTS_CACHE_MS = 5 * 60_000;
const WEATHER_EFFECTS_STALE_MS = 30 * 60_000;
const WEATHER_EFFECTS_MAX_CACHE = 180;
const WEATHER_EFFECTS_MAX_RESPONSE_BYTES = 512 * 1024;
const _weatherEffectsCache = new Map();
const _weatherEffectsInFlight = new Map();
const _weatherEffectsRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 45, globalMax: 120 });
let _nominatimQueue = Promise.resolve();
let _nominatimLastRequestAt = 0;

export function requiredFiniteQueryNumber(params, key) {
  const value = params.get(key);
  if (value === null || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function validRegionalPoint(params) {
  const latitude = requiredFiniteQueryNumber(params, 'latitude');
  const longitude = requiredFiniteQueryNumber(params, 'longitude');
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function trimRegionalBriefCache() {
  while (_regionalBriefCache.size > REGIONAL_BRIEF_MAX_CACHE) {
    const oldest = _regionalBriefCache.keys().next().value;
    if (oldest === undefined) break;
    _regionalBriefCache.delete(oldest);
  }
}

function trimWeatherEffectsCache() {
  while (_weatherEffectsCache.size > WEATHER_EFFECTS_MAX_CACHE) {
    const oldest = _weatherEffectsCache.keys().next().value;
    if (oldest === undefined) break;
    _weatherEffectsCache.delete(oldest);
  }
}

async function fetchRegionalJson(url, {
  headers = {},
  timeoutMs = 9000,
  maxBytes = REGIONAL_MAX_RESPONSE_BYTES,
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
    return readResponseJsonCapped(response, maxBytes);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRegionalText(url, {
  headers = {},
  timeoutMs = 9000,
  maxBytes = REGIONAL_MAX_RESPONSE_BYTES,
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
    return readResponseTextCapped(response, maxBytes);
  } finally {
    clearTimeout(timeout);
  }
}

function decodeRssText(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function rssTag(block, tag) {
  return decodeRssText(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block)?.[1] || '');
}

function normalizeRssArticles(xml, limit = 5) {
  const seen = new Set();
  const articles = [];
  for (const match of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    const title = rssTag(item, 'title').slice(0, 180);
    const url = rssTag(item, 'link');
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch { continue; }
    if (!title || !['http:', 'https:'].includes(parsedUrl.protocol)) continue;
    const source = rssTag(item, 'source');
    const signature = `${title.toLowerCase()}|${source.toLowerCase() || parsedUrl.hostname}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    const rawDate = rssTag(item, 'pubDate');
    articles.push({
      title,
      url: parsedUrl.href,
      domain: source || parsedUrl.hostname.replace(/^www\./, ''),
      publishedAt: Number.isNaN(Date.parse(rawDate)) ? null : new Date(rawDate).toISOString(),
      sourceCountry: null,
    });
    if (articles.length >= limit) break;
  }
  return articles;
}

/** Nominatim's usage policy is one request per second for the WHOLE application. */
const NOMINATIM_MIN_INTERVAL_MS = 1100;

/** The identification the policy asks for; a browser cannot set either header itself. */
const NOMINATIM_HEADERS = Object.freeze({
  'User-Agent': 'GodsEyeView/0.1 (+https://github.com/bilawalsidhu/gods-eye-view)',
  Referer: 'https://github.com/bilawalsidhu/gods-eye-view',
});

/**
 * Run one Nominatim call on the single process-wide queue, at least
 * NOMINATIM_MIN_INTERVAL_MS after the previous one. Both callers share it —
 * the cockpit's reverse geocode and the keyless search box's forward one —
 * because the policy counts the application, not the endpoint.
 */
function queueNominatimRequest(run) {
  const task = _nominatimQueue.then(async () => {
    const waitMs = Math.max(0, NOMINATIM_MIN_INTERVAL_MS - (Date.now() - _nominatimLastRequestAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    _nominatimLastRequestAt = Date.now();
    return run();
  });
  _nominatimQueue = task.catch(() => null);
  return task;
}

function fetchRegionalPlace(point) {
  return queueNominatimRequest(async () => {
    const params = new URLSearchParams({
      format: 'jsonv2',
      lat: point.latitude.toFixed(5),
      lon: point.longitude.toFixed(5),
      zoom: '10',
      addressdetails: '1',
      'accept-language': 'en',
    });
    const payload = await fetchRegionalJson(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: NOMINATIM_HEADERS,
    });
    return normalizeRegionalPlace(payload);
  });
}

async function fetchRegionalNews(place) {
  const query = place?.locality || place?.region || place?.country;
  if (!query) return { status: 'unavailable', query: null, articles: [], source: null };
  const rssParams = new URLSearchParams({
    q: String(query).replace(/["\\]/g, ' ').trim(),
    hl: 'en-US',
    gl: 'US',
    ceid: 'US:en',
  });
  try {
    const xml = await fetchRegionalText(`https://news.google.com/rss/search?${rssParams}`, {
      headers: { 'User-Agent': 'GodsEyeView/0.1' },
      timeoutMs: 12_000,
    });
    const articles = normalizeRssArticles(xml, 5);
    if (articles.length) return { status: 'ready', query, articles, source: 'Google News RSS' };
  } catch { /* fall through to the existing free index */ }
  const params = new URLSearchParams({
    query: `"${String(query).replace(/["\\]/g, ' ').trim()}"`,
    mode: 'artlist',
    format: 'json',
    maxrecords: '5',
    sort: 'datedesc',
    timespan: '48h',
  });
  try {
    const payload = await fetchRegionalJson(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, {
      headers: { 'User-Agent': 'GodsEyeView/0.1' },
      timeoutMs: 12_000,
    });
    const articles = normalizeRegionalArticles(payload, 5);
    return { status: articles.length ? 'ready' : 'empty', query, articles, source: 'GDELT fallback' };
  } catch {
    return { status: 'unavailable', query, articles: [], source: null };
  }
}

async function fetchRegionalWeather(point) {
  const params = new URLSearchParams({
    latitude: point.latitude.toFixed(5),
    longitude: point.longitude.toFixed(5),
    current: 'temperature_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,visibility',
    timezone: 'UTC',
  });
  try {
    const payload = await fetchRegionalJson(`https://api.open-meteo.com/v1/forecast?${params}`, {
      maxBytes: WEATHER_EFFECTS_MAX_RESPONSE_BYTES,
    });
    return normalizeRegionalWeather(payload);
  } catch {
    return null;
  }
}

/** True when at least one regional source produced usable data. */
export function regionalBriefHasAnySource({ place, weather, news } = {}) {
  return Boolean(place || weather || (news && news.status !== 'unavailable'));
}

function regionalBriefProxy() {
  async function refresh(point, key) {
    const [placeResult, weatherResult] = await Promise.allSettled([
      fetchRegionalPlace(point),
      fetchRegionalWeather(point),
    ]);
    const place = placeResult.status === 'fulfilled' ? placeResult.value : null;
    const weather = weatherResult.status === 'fulfilled' ? weatherResult.value : null;
    const news = await fetchRegionalNews(place);
    if (!regionalBriefHasAnySource({ place, weather, news })) {
      throw new Error('All regional briefing sources unavailable');
    }
    const payload = {
      status: place && weather && news.status !== 'unavailable' ? 'ready' : 'partial',
      retrievedAt: new Date().toISOString(),
      coordinates: point,
      place,
      placeStatus: place ? 'ready' : 'unavailable',
      weather,
      weatherStatus: weather ? 'ready' : 'unavailable',
      newsStatus: news.status,
      newsQuery: news.query,
      newsSource: news.source,
      articles: news.articles,
    };
    _regionalBriefCache.set(key, { payload, cachedAt: Date.now() });
    trimRegionalBriefCache();
    return payload;
  }

  function install(middlewares) {
    middlewares.use('/api/regional-brief', async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        return;
      }
      if (!_regionalBriefRateLimiter(clientKey(req))) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '10' });
        res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
        return;
      }
      const url = new URL(req.url || '', 'http://localhost');
      const point = validRegionalPoint(url.searchParams);
      if (!point) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Valid latitude and longitude are required' }));
        return;
      }
      const key = `${(Math.round(point.latitude * 10) / 10).toFixed(1)},${(Math.round(point.longitude * 10) / 10).toFixed(1)}`;
      const now = Date.now();
      const cached = _regionalBriefCache.get(key);
      if (cached && now - cached.cachedAt <= REGIONAL_BRIEF_CACHE_MS) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'X-Regional-Brief': 'HIT' });
        res.end(JSON.stringify({ ...cached.payload, status: 'cached' }));
        return;
      }
      const request = coalesceProxyRequest(_regionalBriefInFlight, key, () => refresh(point, key));
      try {
        const payload = await request.promise;
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
          'X-Regional-Brief': request.shared ? 'INFLIGHT' : 'MISS',
        });
        res.end(JSON.stringify(payload));
      } catch {
        if (cached && now - cached.cachedAt <= REGIONAL_BRIEF_STALE_MS) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Regional-Brief': 'STALE' });
          res.end(JSON.stringify({ ...cached.payload, status: 'stale' }));
          return;
        }
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Regional briefing is temporarily unavailable' }));
      }
    });
  }

  return {
    name: 'regional-brief-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

// ---------------------------------------------------------------------------
// Keyless place search (forward geocoding) proxy
// ---------------------------------------------------------------------------
/**
 * The search box's geocoder for a build with no Google Maps key.
 *
 * Google Geocoding answers a place name with three things — a location, a
 * viewport, and a set of types — and every framing decision in
 * `src/locations.js` is made from those three. This endpoint answers the same
 * three from open data that takes no key: OpenStreetMap through Nominatim
 * worldwide, then the IGN Géoplateforme (BAN addresses + IGN POIs) as a
 * France-only backstop for what OSM has not mapped.
 *
 * `viewbox` ALONE does not bias Nominatim measurably: "sixth street" over an
 * Austin viewbox still answers Kampala at limit=10 (measured 2026-08-31).
 * `bounded=1` does, exactly — it answers East 6th Street. So a biased search
 * runs the bounded pass FIRST and falls back to the worldwide one. That pair is
 * this path's equivalent of the Google Places near-view recovery a keyed build
 * gets from `placesNearViewRecovery()`, which needs a key of its own.
 */
export const GEOCODE_SEARCH_CACHE_MS = 6 * 60 * 60_000;
/** Misses expire fast: an unmapped place today is a mapped place next month. */
export const GEOCODE_SEARCH_MISS_CACHE_MS = 10 * 60_000;
const GEOCODE_SEARCH_MAX_CACHE = 240;
const GEOCODE_SEARCH_MAX_QUERY_CHARS = 200;
const GEOCODE_SEARCH_MAX_RESPONSE_BYTES = 512 * 1024;
const GEOCODE_SEARCH_TIMEOUT_MS = 9000;
/** Widest view rectangle (degrees, per axis) still worth a bounded first pass. */
export const GEOCODE_BIAS_MAX_SPAN_DEG = 6;
/**
 * A bounding box narrower than this on both axes is a NODE's own hairline
 * extent, not the feature's: Nominatim answers "Rocky Mountains" with a 0.0001°
 * box around one node, and framing that box would put the camera 10 km up over
 * one arbitrary ridge. Such a box is dropped so the caller frames by
 * navigation-mode range instead.
 */
export const GEOCODE_POINT_BOX_DEG = 0.002;
/** Half-extent (km) of the metro box synthesized for a city result with no box. */
const GEOCODE_METRO_HALF_SPAN_KM = 20;
const GEOCODE_KM_PER_DEGREE = 111.32;
const _geocodeSearchCache = new Map();
const _geocodeSearchInFlight = new Map();
const _geocodeSearchRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 20, globalMax: 60 });

/**
 * Parse a `west,south,east,north` viewbox parameter. Null for anything
 * malformed, out of range, degenerate, or crossing the antimeridian — Nominatim
 * cannot express that box, and biasing a search to the wrong 350° of the planet
 * is worse than not biasing it at all.
 */
export function parseGeocodeViewbox(value) {
  const parts = String(value ?? '').split(',').map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  const [west, south, east, north] = parts;
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;
  if (!(east > west) || !(north > south)) return null;
  return { west, south, east, north };
}

/** Whether a view rectangle is tight enough for "near what I am looking at" to mean anything. */
export function geocodeBiasIsUseful(box) {
  if (!box) return false;
  return (box.east - box.west) <= GEOCODE_BIAS_MAX_SPAN_DEG
    && (box.north - box.south) <= GEOCODE_BIAS_MAX_SPAN_DEG;
}

export function nominatimSearchUrl(query, { viewbox = null, lang = 'en', limit = 5 } = {}) {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: String(limit),
    'accept-language': lang,
  });
  if (viewbox) {
    params.set('viewbox', [viewbox.west, viewbox.south, viewbox.east, viewbox.north].join(','));
    // Ranking bias alone is not measurable; the hard bound is. See the header.
    params.set('bounded', '1');
  }
  return `https://nominatim.openstreetmap.org/search?${params}`;
}

export function geoplateformeSearchUrl(query, { limit = 5 } = {}) {
  const params = new URLSearchParams({ q: query, index: 'address,poi', limit: String(limit) });
  return `https://data.geopf.fr/geocodage/search?${params}`;
}

/**
 * OSM `addresstype` → the Google geocode type `geocodeNavigationMode()` frames
 * on. This is the semantic role of the result (Toulouse is `boundary` /
 * `administrative` by tagging but `city` by role), so it is consulted for
 * everything the feature-class table below leaves unclaimed.
 */
const OSM_ADDRESSTYPE_TYPES = Object.freeze({
  country: 'country',
  state: 'administrative_area_level_1',
  province: 'administrative_area_level_1',
  region: 'administrative_area_level_1',
  county: 'administrative_area_level_2',
  state_district: 'administrative_area_level_2',
  district: 'administrative_area_level_2',
  city: 'locality',
  town: 'locality',
  village: 'locality',
  hamlet: 'locality',
  municipality: 'locality',
  borough: 'sublocality',
  suburb: 'sublocality',
  quarter: 'sublocality',
  neighbourhood: 'neighborhood',
  city_block: 'neighborhood',
  postcode: 'postal_code',
  road: 'route',
});

/**
 * OSM `category`/`type` → the same Google type, for the features whose framing
 * comes from what they ARE rather than their address role: a park is framed as
 * an area whatever its address role says.
 */
function osmFeatureClassType(category, type) {
  if (category === 'highway') return type === 'services' ? null : 'route';
  if (category === 'natural' || category === 'waterway') return 'natural_feature';
  if (category === 'place' && ['island', 'islet', 'archipelago', 'sea', 'ocean'].includes(type)) {
    return 'natural_feature';
  }
  if (category === 'leisure') {
    if (['park', 'garden', 'nature_reserve', 'common', 'dog_park'].includes(type)) return 'park';
    if (['stadium', 'sports_centre', 'track'].includes(type)) return 'stadium';
    return null;
  }
  if (category === 'boundary' && ['national_park', 'protected_area'].includes(type)) return 'park';
  if (category === 'landuse' && ['forest', 'meadow', 'vineyard', 'orchard'].includes(type)) {
    return 'natural_feature';
  }
  if (category === 'landuse' && type === 'cemetery') return 'cemetery';
  if (category === 'aeroway' && ['aerodrome', 'airstrip'].includes(type)) return 'airport';
  if (category === 'amenity') {
    if (['university', 'college'].includes(type)) return 'university';
    if (type === 'grave_yard') return 'cemetery';
    return null;
  }
  if (category === 'tourism') {
    if (type === 'zoo') return 'zoo';
    if (type === 'theme_park') return 'amusement_park';
    return null;
  }
  if (category === 'shop' && type === 'mall') return 'shopping_mall';
  return null;
}

/** Google-shaped `types` for one Nominatim row; `[]` means "precise place". */
export function osmSearchTypes(row) {
  const category = String(row?.category || row?.class || '');
  const type = String(row?.type || '');
  const fromClass = osmFeatureClassType(category, type);
  if (fromClass) return [fromClass];
  const fromRole = OSM_ADDRESSTYPE_TYPES[String(row?.addresstype || '')];
  return fromRole ? [fromRole] : [];
}

/** A {southwest, northeast} box of the given half-extent around a point. */
function geocodeBoxAround(lat, lon, halfSpanKm) {
  const latHalf = halfSpanKm / GEOCODE_KM_PER_DEGREE;
  const lonHalf = halfSpanKm / (GEOCODE_KM_PER_DEGREE * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  const wrap = (value) => ((value + 180) % 360 + 360) % 360 - 180;
  return {
    southwest: { lat: Math.max(-89.9, lat - latHalf), lng: wrap(lon - lonHalf) },
    northeast: { lat: Math.min(89.9, lat + latHalf), lng: wrap(lon + lonHalf) },
  };
}

/**
 * Nominatim `boundingbox` (`[south, north, west, east]`, as strings) → the
 * {southwest, northeast} box the framing code consumes. A hairline box is a
 * point, not an extent — see GEOCODE_POINT_BOX_DEG — and returns null.
 */
export function nominatimViewport(boundingbox) {
  const parts = (Array.isArray(boundingbox) ? boundingbox : []).map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  const [south, north, west, east] = parts;
  if (!(north > south) || !(east > west)) return null;
  if ((north - south) < GEOCODE_POINT_BOX_DEG && (east - west) < GEOCODE_POINT_BOX_DEG) return null;
  return { southwest: { lat: south, lng: west }, northeast: { lat: north, lng: east } };
}

/**
 * A CITY result must carry a box: with none, `defaultRangeForNavigationMode()`
 * falls back to 250 m, which frames a rooftop rather than a city. BAN publishes
 * its `municipality` records as a point and a name, so one is synthesized at
 * the same 40 x 40 km metro scale the city pills use.
 */
function geocodeViewportForTypes(lat, lon, types) {
  return types.includes('locality') ? geocodeBoxAround(lat, lon, GEOCODE_METRO_HALF_SPAN_KM) : null;
}

/**
 * Google answers "Austin, TX, USA"; Nominatim answers five to nine
 * comma-separated levels. The LOCATION readout is one line, so keep the feature
 * and the country it is in and drop the administrative ladder between them.
 */
export function shortenGeocodeLabel(displayName, name = '') {
  const parts = String(displayName || '').split(',').map((part) => part.trim()).filter(Boolean);
  let head = String(name || '').trim() || parts[0] || '';
  if (!head) return null;
  // A house number is not a place name. Nominatim gives an address record no
  // `name` and opens its display_name with the number, so "12, Rue de Rivoli,
  // …, France" would otherwise be labelled "12, France".
  if (/^\d+[a-z]?$/i.test(head) && parts.length > 1) head = `${parts[0]} ${parts[1]}`;
  const tail = parts.length > 1 ? parts[parts.length - 1] : '';
  return (!tail || tail === head) ? head : `${head}, ${tail}`;
}

/** One Nominatim search row → the geocode shape `searchAndFlyTo()` frames on. */
export function normalizeNominatimSearchResult(row) {
  const lat = Number(row?.lat);
  const lon = Number(row?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const types = osmSearchTypes(row);
  return {
    lat,
    lon,
    label: shortenGeocodeLabel(row?.display_name, row?.name),
    types,
    viewport: nominatimViewport(row?.boundingbox) || geocodeViewportForTypes(lat, lon, types),
    source: 'nominatim',
  };
}

/** Géoplateforme properties are scalars for BAN addresses and arrays for IGN POIs. */
function firstGeoplateformeValue(value) {
  const first = Array.isArray(value) ? value[0] : value;
  const text = String(first ?? '').trim();
  return text || null;
}

/**
 * Match score below which a Géoplateforme answer is a DIFFERENT address from
 * the one asked for. BAN always answers with its nearest street rather than
 * nothing: measured 2026-08-31, an exact hit scores 0.91-0.97 ("12 Rue de
 * Rivoli 75004 Paris" 0.97, "Tour Eiffel" 0.909) while an invented street in a
 * real commune comes back as a neighbouring one at 0.53-0.66 ("Chemin de Bel
 * Air" answered "Chemin de Bellevue"). This backstop exists to find addresses
 * OpenStreetMap has not mapped, not to answer a question nobody asked.
 */
export const GEOCODE_GEOPLATEFORME_MIN_SCORE = 0.7;

/** One Géoplateforme feature → the same geocode shape. */
export function normalizeGeoplateformeFeature(feature) {
  const coordinates = feature?.geometry?.coordinates;
  const lon = Number(coordinates?.[0]);
  const lat = Number(coordinates?.[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const properties = feature?.properties || {};
  const score = Number(properties.score);
  if (Number.isFinite(score) && score < GEOCODE_GEOPLATEFORME_MIN_SCORE) return null;
  const kind = String(properties._type || '');
  const type = String(properties.type || '');
  // BAN publishes a role per record; IGN's POI index publishes French category
  // words ("monument", "château") that name a thing, not a framing scale, so a
  // POI stays a precise place — which is what a searched monument should be.
  let types = [];
  if (kind === 'address' && type === 'municipality') types = ['locality'];
  else if (kind === 'address' && type === 'street') types = ['route'];
  const city = firstGeoplateformeValue(properties.city);
  const toponym = firstGeoplateformeValue(properties.toponym) || firstGeoplateformeValue(properties.name);
  const label = firstGeoplateformeValue(properties.label)
    || (toponym && city && toponym !== city ? `${toponym}, ${city}` : toponym);
  return {
    lat,
    lon,
    label,
    types,
    viewport: geocodeViewportForTypes(lat, lon, types),
    source: 'geoplateforme',
  };
}

/** Attribution the client can display verbatim; both licences require naming the source. */
export function geocodeSourceAttribution(source) {
  if (source === 'nominatim') return '© OpenStreetMap contributors (ODbL 1.0), via Nominatim';
  if (source === 'geoplateforme') return 'IGN Géoplateforme / BAN — Licence Ouverte 2.0';
  return null;
}

/**
 * Nominatim's own prominence score, above which a place is famous enough that
 * nobody typing that name meant the shop across the street. Measured
 * 2026-08-31: Toulouse 0.73, Austin 0.71, the Eiffel Tower 0.62, the Golden
 * Gate 0.54, the Texas State Capitol 0.48, Zilker Park 0.41 — against the
 * Kampala village called Sixth Street at 0.15, an arts centre called The
 * Capitol at 0.16, and a bistro called Toulouse in Austin at 0.0001. 0.35 sits
 * in the gap between the two groups.
 */
export const GEOCODE_PROMINENCE_OVERRIDE = 0.35;

/** Nominatim's `importance`, or 0 for a row that carries none. */
function geocodeRowImportance(row) {
  const importance = Number(row?.importance);
  return Number.isFinite(importance) ? importance : 0;
}

/**
 * Choose between the hit found INSIDE the current view and the worldwide one.
 *
 * The in-view hit wins by default — that is the whole point of the bias, and
 * "the Capitol" over Austin is the Texas one. It loses only to a place the
 * whole world knows by that name: searching "Toulouse" while looking at Austin
 * means the city in France, not the bistro at The Domain (a real bounded hit,
 * importance 0.0001). Exported for tests.
 */
export function chooseGeocodeRow(inView, worldwide) {
  if (!inView) return worldwide || null;
  if (!worldwide) return inView;
  return geocodeRowImportance(worldwide) >= GEOCODE_PROMINENCE_OVERRIDE ? worldwide : inView;
}

/** The first row of a Nominatim answer that carries a usable location. */
function firstUsableNominatimRow(rows) {
  return (Array.isArray(rows) ? rows : []).find((row) => normalizeNominatimSearchResult(row)) || null;
}

function searchNominatim(query, viewbox, lang) {
  return queueNominatimRequest(() => fetchRegionalJson(
    nominatimSearchUrl(query, { viewbox, lang }),
    {
      headers: NOMINATIM_HEADERS,
      timeoutMs: GEOCODE_SEARCH_TIMEOUT_MS,
      maxBytes: GEOCODE_SEARCH_MAX_RESPONSE_BYTES,
    },
  ));
}

/**
 * Bounded pass (when the view is tight enough to mean something), then the
 * worldwide pass, then France's own address base. `failed` separates "nothing
 * is called that" from "nothing answered", so a dead upstream is never cached
 * or reported as a definitive not-found.
 */
async function resolveGeocodeSearch(query, box, lang) {
  let failed = false;
  let inView = null;

  if (geocodeBiasIsUseful(box)) {
    try {
      inView = firstUsableNominatimRow(await searchNominatim(query, box, lang));
    } catch {
      failed = true;
    }
    // The famous thing is already on screen — no second request can improve on it.
    if (inView && geocodeRowImportance(inView) >= GEOCODE_PROMINENCE_OVERRIDE) {
      return { result: normalizeNominatimSearchResult(inView), failed: false };
    }
  }

  try {
    const chosen = chooseGeocodeRow(inView, firstUsableNominatimRow(await searchNominatim(query, null, lang)));
    if (chosen) return { result: normalizeNominatimSearchResult(chosen), failed: false };
  } catch {
    failed = true;
    // The worldwide pass died, but the view already answered.
    if (inView) return { result: normalizeNominatimSearchResult(inView), failed: false };
  }

  try {
    const collection = await fetchRegionalJson(geoplateformeSearchUrl(query), {
      timeoutMs: GEOCODE_SEARCH_TIMEOUT_MS,
      maxBytes: GEOCODE_SEARCH_MAX_RESPONSE_BYTES,
    });
    const features = Array.isArray(collection?.features) ? collection.features : [];
    const hit = features.map(normalizeGeoplateformeFeature).find(Boolean);
    if (hit) return { result: hit, failed: false };
  } catch {
    failed = true;
  }
  return { result: null, failed };
}

function trimGeocodeSearchCache() {
  while (_geocodeSearchCache.size > GEOCODE_SEARCH_MAX_CACHE) {
    const oldest = _geocodeSearchCache.keys().next().value;
    if (oldest === undefined) break;
    _geocodeSearchCache.delete(oldest);
  }
}

/** Cache key: the query, the bias box it was answered under, and the label language. */
export function geocodeSearchCacheKey(query, box, lang) {
  const bias = geocodeBiasIsUseful(box)
    ? [box.west, box.south, box.east, box.north].map((value) => value.toFixed(2)).join(',')
    : '';
  return `${String(query).toLowerCase()}|${bias}|${lang}`;
}

function keylessGeocodeProxy() {
  function install(middlewares) {
    middlewares.use('/api/geocode', async (req, res) => {
      const send = (status, payload, source) => {
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          // Only an answer is cacheable; a refusal must not be replayed.
          'Cache-Control': status === 200 ? 'private, max-age=300' : 'no-store',
          'X-Geocode-Cache': source,
        });
        res.end(JSON.stringify(payload));
      };

      if (req.method !== 'GET') {
        send(405, { error: 'Method Not Allowed', result: null }, 'NONE');
        return;
      }

      const requestUrl = new URL(req.url || '', 'http://localhost');
      const query = String(requestUrl.searchParams.get('q') || '')
        .trim()
        .slice(0, GEOCODE_SEARCH_MAX_QUERY_CHARS);
      if (!query) {
        send(400, { error: 'A q= place name is required', result: null }, 'NONE');
        return;
      }
      const box = parseGeocodeViewbox(requestUrl.searchParams.get('viewbox'));
      const requestedLang = String(requestUrl.searchParams.get('lang') || '');
      const lang = /^[a-z]{2}(-[A-Za-z]{2})?$/.test(requestedLang) ? requestedLang : 'en';
      const cacheKey = geocodeSearchCacheKey(query, box, lang);

      // Cache before limiter: a repeat of a search already answered costs
      // nothing upstream, so it should not spend a slot either.
      const cached = _geocodeSearchCache.get(cacheKey);
      const ttl = cached?.payload?.result ? GEOCODE_SEARCH_CACHE_MS : GEOCODE_SEARCH_MISS_CACHE_MS;
      if (cached && Date.now() - cached.cachedAt < ttl) {
        send(200, cached.payload, 'HIT');
        return;
      }
      if (!_geocodeSearchRateLimiter(clientKey(req))) {
        res.setHeader('Retry-After', '5');
        send(429, { error: 'Rate limit exceeded', result: null }, 'NONE');
        return;
      }

      try {
        const { promise } = coalesceProxyRequest(
          _geocodeSearchInFlight,
          cacheKey,
          () => resolveGeocodeSearch(query, box, lang),
        );
        const { result, failed } = await promise;
        if (!result && failed) {
          // Every upstream refused. Serving `result: null` here would report a
          // network outage as "there is no such place".
          send(502, { error: 'Geocoding upstreams are unavailable', result: null }, 'NONE');
          return;
        }
        const payload = {
          result,
          source: result?.source || null,
          attribution: geocodeSourceAttribution(result?.source),
        };
        _geocodeSearchCache.set(cacheKey, { payload, cachedAt: Date.now() });
        trimGeocodeSearchCache();
        send(200, payload, 'MISS');
      } catch (error) {
        console.error('[Geocode Proxy]', error?.message || error);
        send(502, { error: 'Geocode proxy error', result: null }, 'NONE');
      }
    });
  }

  return {
    name: 'keyless-geocode-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

function weatherEffectsProxy() {
  async function refresh(point, key) {
    const weather = await fetchRegionalWeather(point);
    if (!weather) throw new Error('Weather observation unavailable');
    const payload = {
      status: 'ready',
      retrievedAt: new Date().toISOString(),
      coordinates: point,
      weather,
    };
    _weatherEffectsCache.set(key, { payload, cachedAt: Date.now() });
    trimWeatherEffectsCache();
    return payload;
  }

  function install(middlewares) {
    middlewares.use('/api/weather-effects', async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        return;
      }
      if (!_weatherEffectsRateLimiter(clientKey(req))) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '10' });
        res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
        return;
      }
      const url = new URL(req.url || '', 'http://localhost');
      const point = validRegionalPoint(url.searchParams);
      if (!point) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Valid latitude and longitude are required' }));
        return;
      }
      const key = `${(Math.round(point.latitude * 10) / 10).toFixed(1)},${(Math.round(point.longitude * 10) / 10).toFixed(1)}`;
      const now = Date.now();
      const cached = _weatherEffectsCache.get(key);
      if (cached && now - cached.cachedAt <= WEATHER_EFFECTS_CACHE_MS) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
          'X-Weather-Effects': 'HIT',
        });
        res.end(JSON.stringify({ ...cached.payload, status: 'cached' }));
        return;
      }
      const request = coalesceProxyRequest(_weatherEffectsInFlight, key, () => refresh(point, key));
      try {
        const payload = await request.promise;
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
          'X-Weather-Effects': request.shared ? 'INFLIGHT' : 'MISS',
        });
        res.end(JSON.stringify(payload));
      } catch {
        if (cached && now - cached.cachedAt <= WEATHER_EFFECTS_STALE_MS) {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'X-Weather-Effects': 'STALE',
          });
          res.end(JSON.stringify({ ...cached.payload, status: 'stale' }));
          return;
        }
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Weather effects are temporarily unavailable' }));
      }
    });
  }

  return {
    name: 'weather-effects-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

// ---------------------------------------------------------------------------
// Bison Futé DATEX II — live status of the French national road network
// ---------------------------------------------------------------------------
/** Committed geometry (see `scripts/build-datex-traficolor-sites.mjs`). */
const ROAD_STATUS_SITES_PATH = path.join(process.cwd(), 'config', 'datex_traficolor_sites.json');
/**
 * Snapshot TTL. The fastest agglomeration (Bordeaux, Toulouse, Lyon, Limoges)
 * writes a new file every 60 s and the slowest every 360 s, so asking more
 * often than a minute cannot return anything new — it only costs the publisher
 * bandwidth.
 */
const ROAD_STATUS_SNAPSHOT_TTL_MS = 60_000;
/**
 * The flow/speed snapshot has a strict six-minute cycle: `publicationTime`
 * 22:24 covers the window 22:24–22:30, the next is 22:30 covering 22:30–22:36.
 * Re-fetching 1.2 MB inside that window returns the identical document.
 */
const ROAD_STATUS_QTV_TTL_MS = 6 * 60_000;
/** Longest a stale snapshot is still served while upstream is unreachable. */
const ROAD_STATUS_STALE_MS = 30 * 60_000;
const ROAD_STATUS_TIMEOUT_MS = 20_000;
/** The national flow snapshot is 1.2 MB; this is headroom, not an expectation. */
const ROAD_STATUS_MAX_BYTES = 24 * 1024 * 1024;
/** How many agglomeration directories are read at once. */
const ROAD_STATUS_CONCURRENCY = 6;
const ROAD_STATUS_CACHE_DIR = path.join(process.cwd(), '.gev-cache', 'road-status-fr');
const ROAD_STATUS_CACHE_PATH = path.join(ROAD_STATUS_CACHE_DIR, 'snapshot.json');
const ROAD_STATUS_USER_AGENT = 'GodsEyeView/1.0 (+https://github.com/bilawalsidhu/gods-eye-view)';
const _roadStatusRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 90, globalMax: 240 });

/** @type {?object} Parsed `config/datex_traficolor_sites.json`. */
let _roadStatusSites = null;
/** @type {?Promise<object>} */
let _roadStatusSitesPromise = null;
/** @type {?{at:number, publishedAt:?string, windowStart:?string, windowEnd:?string, measurements:Map}} */
let _roadStatusQtv = null;
/** @type {?{at:number, segments:Array<object>, feeds:Array<object>, counts:object}} */
let _roadStatusSnapshot = null;
let _roadStatusDiskChecked = false;
/** @type {Map<string, Promise<object>>} */
const _roadStatusInFlight = new Map();

/** Load the committed site geometry once per process. */
function loadRoadStatusSites() {
  if (_roadStatusSites) return Promise.resolve(_roadStatusSites);
  if (!_roadStatusSitesPromise) {
    _roadStatusSitesPromise = fsp.readFile(ROAD_STATUS_SITES_PATH, 'utf8')
      .then((text) => {
        const parsed = JSON.parse(text);
        if (!parsed?.sites || typeof parsed.sites !== 'object') {
          throw new Error('site index has no `sites` map');
        }
        _roadStatusSites = parsed;
        return parsed;
      })
      .catch((error) => {
        _roadStatusSitesPromise = null;
        throw error;
      });
  }
  return _roadStatusSitesPromise;
}

async function fetchRoadStatusText(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': ROAD_STATUS_USER_AGENT, Accept: '*/*' },
    signal: AbortSignal.timeout(ROAD_STATUS_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return readResponseTextCapped(response, ROAD_STATUS_MAX_BYTES);
}

/** Run `worker` over `items` with a fixed number of concurrent slots. */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Refresh the six-minute national flow/speed snapshot, if its window elapsed.
 *
 * Failure is NOT fatal to the status snapshot: the colour of a road and the
 * count on it come from two independent publications, and losing the count
 * must not blank the colour. The previous measurements are kept and their own
 * timestamps go out with them, so the client can see they are the last cycle's.
 */
async function refreshRoadStatusQtv() {
  const now = Date.now();
  if (_roadStatusQtv && now - _roadStatusQtv.at < ROAD_STATUS_QTV_TTL_MS) return _roadStatusQtv;
  try {
    const xml = await fetchRoadStatusText(QTV_MEASUREMENTS_URL);
    const parsed = parseQtvMeasurements(xml);
    _roadStatusQtv = { at: now, ...parsed };
  } catch (error) {
    console.warn('[road-status-fr] flow snapshot unavailable:', error?.message || error);
    if (!_roadStatusQtv) {
      _roadStatusQtv = {
        at: now, publishedAt: null, windowStart: null, windowEnd: null, measurements: new Map(),
      };
    }
  }
  return _roadStatusQtv;
}

/**
 * Read every agglomeration status feed and join it to the committed geometry.
 *
 * ONE NATIONAL SNAPSHOT, not one fetch per viewport. The whole country is
 * ~2 000 status sites and ~830 drawable segments — small enough to hold, and
 * far cheaper to hold than to re-derive per camera box. Viewport filtering is
 * therefore a pass over an array, which is why the box ceiling on the endpoint
 * is 20° rather than the 6° the transit proxy has to enforce.
 *
 * SETTLED PER FEED. Sixteen directories, each a separate traffic-management
 * centre; one being down is one city going grey, not the country going blank.
 * Every failure is named in the `feeds` array the client renders.
 *
 * A SITE IS DRAWN IF EITHER PUBLICATION SPEAKS FOR IT. A located station with
 * a flow reading and no colour is drawn in the `unknown` grey and carries its
 * count; a site with a colour and no count is drawn coloured. Requiring both
 * would silently drop the stations no traffic centre watches.
 */
async function refreshRoadStatusSnapshot() {
  const sitesDoc = await loadRoadStatusSites();
  const qtv = await refreshRoadStatusQtv();
  const index = await fetchRoadStatusText(TRAFICOLOR_INDEX_URL);
  const directories = parseIndexDirectories(index);

  const outcomes = await mapWithConcurrency(directories, ROAD_STATUS_CONCURRENCY, async (directory) => {
    const base = `${TRAFICOLOR_INDEX_URL}${directory}/`;
    try {
      const listing = await fetchRoadStatusText(base);
      const latest = latestPublicationFile(listing);
      if (!latest) return { directory, statuses: new Map(), error: 'no publication file' };
      const body = await fetchRoadStatusText(base + latest);
      const parsed = parseTraficolorStatuses(body);
      return {
        directory, statuses: parsed.statuses, publishedAt: parsed.publishedAt, file: latest, error: null,
      };
    } catch (error) {
      console.warn(`[road-status-fr] ${directory}: ${error?.message || error}`);
      return { directory, statuses: new Map(), error: String(error?.message || error) };
    }
  });

  /** @type {Map<string, {status:string, at:?string, sources:Array<string>}>} */
  const merged = new Map();
  const feeds = [];
  for (const outcome of outcomes) {
    let drawable = 0;
    for (const [id, reading] of outcome.statuses) {
      if (sitesDoc.sites[id]?.c) drawable += 1;
      const existing = merged.get(id);
      if (existing) {
        // Two centres watching one site: keep the worse state, and record both
        // so the card can say who is reporting it.
        existing.status = worseRoadStatus(existing.status, reading.status);
        if (!existing.sources.includes(outcome.directory)) existing.sources.push(outcome.directory);
        if (reading.at && (!existing.at || reading.at > existing.at)) existing.at = reading.at;
      } else {
        merged.set(id, { status: reading.status, at: reading.at, sources: [outcome.directory] });
      }
    }
    feeds.push({
      directory: outcome.directory,
      label: agglomerationLabel(outcome.directory),
      sites: outcome.statuses.size,
      drawable,
      publishedAt: outcome.publishedAt || null,
      file: outcome.file || null,
      error: outcome.error,
    });
  }
  feeds.sort((a, b) => b.drawable - a.drawable || a.label.localeCompare(b.label));

  const segments = [];
  const counts = {
    freeFlow: 0, heavy: 0, congested: 0, impossible: 0, unknown: 0,
  };
  let measured = 0;
  for (const [id, site] of Object.entries(sitesDoc.sites)) {
    if (!site?.c) continue;
    const reading = merged.get(id);
    const measurement = qtv.measurements.get(id);
    if (!reading && !measurement) continue;
    const status = reading?.status || 'unknown';
    counts[status] = (counts[status] || 0) + 1;
    if (measurement) measured += 1;
    segments.push({
      id,
      c: site.c,
      s: status,
      d: site.d || null,
      a: site.a || null,
      z: site.z || null,
      // How this segment knows where it is: `xy` from a coordinate the DIR
      // published, `pr` from a kilometre post this app resolved. The card says
      // which, because they are not the same claim.
      g: site.g || null,
      src: reading?.sources || [],
      at: reading?.at || null,
      f: measurement?.flowVehH ?? null,
      v: measurement?.speedKph ?? null,
      n: measurement?.samples ?? null,
    });
  }

  const failed = feeds.filter((feed) => feed.error).length;
  const snapshot = {
    at: Date.now(),
    status: failed && failed === feeds.length ? 'degraded' : 'ready',
    retrievedAt: new Date().toISOString(),
    segments,
    feeds,
    counts,
    measured,
    feedsFailed: failed,
    statusSites: merged.size,
    // The two numbers the honesty of this layer rests on: how many sites the
    // country publishes a position for, and how many it does not.
    sitesTotal: sitesDoc.stats?.sites ?? null,
    sitesLocated: sitesDoc.stats?.located ?? null,
    sitesUnlocated: sitesDoc.stats?.unlocated ?? null,
    sitesFromPointRepere: sitesDoc.stats?.geometry?.pointRepere ?? null,
    lengthKm: sitesDoc.stats?.lengthKm ?? null,
    licence: sitesDoc.licence || null,
    attribution: sitesDoc.attribution || null,
    datasetPage: sitesDoc.datasetPage || null,
    geometryGeneratedAt: sitesDoc.generatedAt || null,
    flow: {
      publishedAt: qtv.publishedAt,
      windowStart: qtv.windowStart,
      windowEnd: qtv.windowEnd,
      stations: qtv.measurements.size,
    },
  };
  _roadStatusSnapshot = snapshot;
  void fsp.mkdir(ROAD_STATUS_CACHE_DIR, { recursive: true })
    .then(() => fsp.writeFile(ROAD_STATUS_CACHE_PATH, JSON.stringify(snapshot), 'utf8'))
    .catch((error) => console.warn('[road-status-fr] cache write failed:', error?.message || error));
  return snapshot;
}

/** Warm the in-memory snapshot from disk once, so a restart is not a cold map. */
async function readRoadStatusDiskCache() {
  if (_roadStatusDiskChecked) return;
  _roadStatusDiskChecked = true;
  try {
    const parsed = JSON.parse(await fsp.readFile(ROAD_STATUS_CACHE_PATH, 'utf8'));
    if (Number.isFinite(parsed?.at) && Array.isArray(parsed?.segments)) _roadStatusSnapshot = parsed;
  } catch { /* no disk cache yet */ }
}

/**
 * Vite plugin: live French national road status.
 *
 *   GET /api/road-status-fr/sources                          — publishers and coverage
 *   GET /api/road-status-fr/segments?south&west&north&east   — coloured segments in box
 *
 * The browser never talks to `tipi.bison-fute.gouv.fr` directly: the host is
 * plain HTTP with no CORS header and no TLS at all, so a page served over
 * https could not read it even if it were allowed to; one viewport needs
 * seventeen upstream requests that are worth sharing across clients; and the
 * geometry join happens against a file the browser has no reason to hold.
 *
 * Keyless, Licence Ouverte 2.0.
 *
 * @returns {import('vite').Plugin}
 */
function roadStatusFranceProxy() {
  function install(middlewares) {
    middlewares.use('/api/road-status-fr', async (req, res) => {
      const json = (status, body, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'GET') {
        json(405, { error: 'Method Not Allowed' });
        return;
      }
      if (!_roadStatusRateLimiter(clientKey(req))) {
        json(429, { error: 'Rate limit exceeded' }, { 'Retry-After': '5' });
        return;
      }

      const url = new URL(req.url || '/', 'http://localhost');
      const route = url.pathname.replace(/\/+$/, '') || '/';

      let sitesDoc;
      try {
        sitesDoc = await loadRoadStatusSites();
      } catch (error) {
        console.warn('[road-status-fr] site index unavailable:', error?.message || error);
        json(503, {
          error: 'French road-status geometry is missing — run `npm run road-status:index`',
          missingIndex: true,
        });
        return;
      }

      if (route === '/sources') {
        json(200, {
          source: sitesDoc.statusSource || TRAFICOLOR_INDEX_URL,
          referentialSource: sitesDoc.source || null,
          datasetPage: sitesDoc.datasetPage || null,
          licence: sitesDoc.licence || null,
          attribution: sitesDoc.attribution || null,
          geometryGeneratedAt: sitesDoc.generatedAt || null,
          cycles: sitesDoc.cycles || null,
          referential: sitesDoc.referential || null,
          bornage: sitesDoc.bornage || null,
          stats: sitesDoc.stats || null,
          coverage: sitesDoc.coverage || [],
        }, { 'Cache-Control': 'public, max-age=300' });
        return;
      }

      if (route !== '/segments') {
        json(404, { error: 'Unknown road-status endpoint' });
        return;
      }

      const box = validRoadStatusBox({
        south: url.searchParams.get('south'),
        west: url.searchParams.get('west'),
        north: url.searchParams.get('north'),
        east: url.searchParams.get('east'),
      });
      if (!box) {
        json(400, { error: `A non-dateline bbox no larger than ${ROAD_STATUS_MAX_BOX_DEG} degrees is required` });
        return;
      }

      await readRoadStatusDiskCache();
      const now = Date.now();
      const fresh = _roadStatusSnapshot && now - _roadStatusSnapshot.at <= ROAD_STATUS_SNAPSHOT_TTL_MS;
      let snapshot = fresh ? _roadStatusSnapshot : null;
      let cacheState = 'HIT';
      if (!snapshot) {
        const request = coalesceProxyRequest(_roadStatusInFlight, 'national', refreshRoadStatusSnapshot);
        cacheState = request.shared ? 'INFLIGHT' : 'MISS';
        try {
          snapshot = await request.promise;
        } catch (error) {
          console.warn('[road-status-fr] refresh failed:', error?.message || error);
          const stale = _roadStatusSnapshot;
          if (!stale || now - stale.at > ROAD_STATUS_STALE_MS) {
            json(503, { error: 'Live French road status is temporarily unavailable' });
            return;
          }
          snapshot = stale;
          cacheState = 'STALE';
        }
      }

      const inBox = [];
      const counts = {
        freeFlow: 0, heavy: 0, congested: 0, impossible: 0, unknown: 0,
      };
      let truncated = false;
      for (const segment of snapshot.segments) {
        if (!segmentIntersectsBox(segment, box)) continue;
        if (inBox.length >= ROAD_STATUS_MAX_SEGMENTS) { truncated = true; break; }
        inBox.push(segment);
        counts[segment.s] = (counts[segment.s] || 0) + 1;
      }

      json(200, {
        status: cacheState === 'STALE' ? 'stale' : snapshot.status,
        retrievedAt: snapshot.retrievedAt,
        stale: cacheState === 'STALE',
        box,
        segments: inBox,
        counts,
        segmentsTruncated: truncated,
        nationalSegments: snapshot.segments.length,
        nationalCounts: snapshot.counts,
        measured: snapshot.measured,
        feeds: snapshot.feeds,
        feedsFailed: snapshot.feedsFailed,
        sitesTotal: snapshot.sitesTotal,
        sitesLocated: snapshot.sitesLocated,
        sitesUnlocated: snapshot.sitesUnlocated,
        sitesFromPointRepere: snapshot.sitesFromPointRepere,
        lengthKm: snapshot.lengthKm,
        flow: snapshot.flow,
        licence: snapshot.licence,
        attribution: snapshot.attribution,
        datasetPage: snapshot.datasetPage,
        geometryGeneratedAt: snapshot.geometryGeneratedAt,
      }, { 'X-Road-Status-FR': cacheState });
    });
  }

  return {
    name: 'road-status-fr-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

// ---------------------------------------------------------------------------
// Cadastre proxy (France's parcel plan, PCI vecteur, through IGN Api Carto)
// ---------------------------------------------------------------------------
/**
 * A parcel outlives the people who own it and the PCI is republished monthly,
 * so a day is a short cache for this data, not a long one. It is set by what
 * changes upstream, not by how fresh the answer feels.
 */
const CADASTRE_TTL_MS = 24 * 60 * 60 * 1000;
/** Serve-stale ceiling when Api Carto is down. A plan a month old is still the plan. */
const CADASTRE_STALE_MS = 30 * 24 * 60 * 60 * 1000;
const CADASTRE_TIMEOUT_MS = 45_000;
/**
 * Byte cap on ONE upstream answer. The densest measured box — Marseille at
 * 0.034°, truncated at Api Carto's own 5 000 — is 3.5 MB, and a full 5 000
 * rural parcels with 32 vertices each would be larger; 32 MB is comfortably
 * clear of both and still bounded.
 */
const CADASTRE_MAX_BYTES = 32 * 1024 * 1024;
const CADASTRE_VIEWPORT_CACHE_MAX = 48;
const CADASTRE_DISK_DIR = path.join(process.cwd(), '.gev-cache', 'cadastre');

/** box key -> {at:number, payload:object} */
const _cadastreViewportCache = new Map();
const _cadastreViewportInFlight = new Map();
const _cadastreRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 180 });

function trimCadastreViewportCache() {
  while (_cadastreViewportCache.size > CADASTRE_VIEWPORT_CACHE_MAX) {
    const oldest = _cadastreViewportCache.keys().next().value;
    if (oldest === undefined) break;
    _cadastreViewportCache.delete(oldest);
  }
}

/** Snapped box key -> stable disk-cache file path. */
function cadastreDiskPath(key) {
  return path.join(CADASTRE_DISK_DIR, `${createHash('sha1').update(key).digest('hex')}.json`);
}

/** Read a disk-cached viewport answer. `maxAgeMs` Infinity = any age. */
async function readCadastreDisk(key, maxAgeMs) {
  try {
    const entry = JSON.parse(await fsp.readFile(cadastreDiskPath(key), 'utf8'));
    if (!Number.isFinite(entry?.at) || !Array.isArray(entry?.payload?.parcels)) return null;
    if (Date.now() - entry.at > maxAgeMs) return null;
    return entry;
  } catch {
    return null;
  }
}

/** Fire-and-forget disk write for a successful viewport answer. */
function writeCadastreDisk(key, entry) {
  fsp.mkdir(CADASTRE_DISK_DIR, { recursive: true })
    .then(() => fsp.writeFile(cadastreDiskPath(key), JSON.stringify(entry)))
    .catch((err) => console.warn('[Cadastre Proxy] disk cache write failed:', err?.message || err));
}

/** One Api Carto GeoJSON call, under a timeout and a byte cap. */
async function fetchCadastreCollection(route, box, limit) {
  const geom = JSON.stringify({
    type: 'Polygon',
    coordinates: [[
      [box.west, box.south], [box.east, box.south],
      [box.east, box.north], [box.west, box.north], [box.west, box.south],
    ]],
  });
  const params = new URLSearchParams({ geom, _limit: String(limit) });
  const response = await fetch(`${CADASTRE_API_BASE}/${route}?${params}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(CADASTRE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`upstream ${route} HTTP ${response.status}`);
  return readResponseJsonCapped(response, CADASTRE_MAX_BYTES);
}

/**
 * Fetch one viewport and fold it into the client payload.
 *
 * The two calls run in PARALLEL and answer different questions. `parcelle` is
 * the map; `feuille` is the SCALE each of those parcels was drawn at, which is
 * the layer's whole subject and which the parcel records do not carry. The join
 * is five parts wide (see `sheetKey`) because Lyon publishes one section number
 * across five arrondissements at two different scales.
 *
 * @param {{south:number, west:number, north:number, east:number}} box Snapped box.
 * @returns {Promise<object>} Client payload.
 */
async function refreshCadastreViewport(box) {
  const [parcelle, feuille] = await Promise.all([
    fetchCadastreCollection('parcelle', box, CADASTRE_UPSTREAM_LIMIT),
    // Sheets are two orders of magnitude rarer than parcels — 214 was the most
    // ever measured in a box four times this one — so the same ceiling is far
    // more headroom than it is for the parcels, and truncation here degrades
    // (some parcels lose their scale) rather than lying.
    fetchCadastreCollection('feuille', box, CADASTRE_UPSTREAM_LIMIT)
      .catch((error) => {
        // A sheet failure costs tolerances, not the map. Parcels still draw, in
        // the UNKNOWN band, which says exactly that on its own legend row.
        console.warn('[Cadastre Proxy] sheet join unavailable:', error?.message || error);
        return null;
      }),
  ]);
  return projectCadastreParcels({ parcelle, feuille, box });
}

/**
 * Vite plugin: French cadastral parcels through IGN's Api Carto.
 *
 *   GET /api/cadastre-fr/parcelles?south&west&north&east — parcels in one box
 *   GET /api/cadastre-fr/status                         — provenance + cache state
 *
 * WHY A PROXY at all, when Api Carto reflects the Origin header and a browser
 * could fetch this directly: the service answers `Cache-Control: private,
 * no-cache, no-store, must-revalidate`, so the browser cache is forbidden from
 * helping and every pan would be a fresh round trip to a free public service
 * for data that changes monthly; one viewport is TWO upstream calls that are
 * worth sharing across clients and across restarts; the five-part sheet join
 * and the truncation check in `cadastreFeed.js` are absorbed once, server-side,
 * under test, instead of in every client; and the shape changes on the way
 * through — 3.3 MB of GeoJSON scaffolding folds to 1.8 MB of parcels.
 *
 * Keyless, Licence Ouverte 2.0.
 *
 * @returns {import('vite').Plugin}
 */
function cadastreFranceProxy() {
  function install(middlewares) {
    middlewares.use('/api/cadastre-fr', async (req, res) => {
      const json = (status, body, headers = {}) => {
        if (res.headersSent) return;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'GET') {
        json(405, { error: 'Method Not Allowed' });
        return;
      }
      if (!_cadastreRateLimiter(clientKey(req))) {
        json(429, { error: 'Rate limit exceeded' }, { 'Retry-After': '5' });
        return;
      }

      const url = new URL(req.url || '/', 'http://localhost');
      const route = url.pathname.replace(/\/+$/, '') || '/';

      if (route === '/status') {
        let newest = null;
        for (const entry of _cadastreViewportCache.values()) {
          if (!newest || entry.at > newest) newest = entry.at;
        }
        json(200, {
          source: CADASTRE_SOURCE,
          licence: CADASTRE_LICENCE,
          datasetPage: CADASTRE_DATASET_PAGE,
          lastFetch: newest,
          cachedBoxes: _cadastreViewportCache.size,
          ttlMs: CADASTRE_TTL_MS,
          maxBoxDeg: CADASTRE_MAX_BOX_DEG,
          requestMaxBoxDeg: CADASTRE_REQUEST_MAX_BOX_DEG,
          upstreamLimit: CADASTRE_UPSTREAM_LIMIT,
        }, { 'Cache-Control': 'public, max-age=60' });
        return;
      }
      if (route !== '/parcelles') {
        json(404, { error: 'Unknown cadastre endpoint' });
        return;
      }

      const requested = validBox({
        south: url.searchParams.get('south'),
        west: url.searchParams.get('west'),
        north: url.searchParams.get('north'),
        east: url.searchParams.get('east'),
      }, CADASTRE_REQUEST_MAX_BOX_DEG);
      if (!requested) {
        json(400, {
          error: `A non-dateline bbox no larger than ${CADASTRE_REQUEST_MAX_BOX_DEG} degrees is required`,
          maxBoxDeg: CADASTRE_REQUEST_MAX_BOX_DEG,
          layerMaxBoxDeg: CADASTRE_MAX_BOX_DEG,
        });
        return;
      }

      // Snapped OUTWARD, so the box sent upstream is up to two grid steps wider
      // than the one that was validated — 0.024° against a 0.02° ceiling, worst
      // case. That widening is the cache doing its job and is NOT re-checked
      // against the ceiling here: an outward snap of a box that only just
      // passed always lands over it, so re-checking would 400 every request at
      // the layer's own maximum zoom. The upstream bound is `validBox` above
      // plus this known, constant margin.
      const box = snapBoxOutward(requested, CADASTRE_BOX_STEP_DEG);
      const key = boxKey(box, 3);
      const now = Date.now();

      const cached = _cadastreViewportCache.get(key);
      if (cached && now - cached.at <= CADASTRE_TTL_MS) {
        json(200, { ...cached.payload, fetchedAt: cached.at, stale: false }, { 'X-Cadastre-FR': 'HIT' });
        return;
      }
      const onDisk = await readCadastreDisk(key, CADASTRE_TTL_MS);
      if (onDisk) {
        _cadastreViewportCache.set(key, onDisk);
        trimCadastreViewportCache();
        json(200, { ...onDisk.payload, fetchedAt: onDisk.at, stale: false }, { 'X-Cadastre-FR': 'DISK' });
        return;
      }

      const request = coalesceProxyRequest(_cadastreViewportInFlight, key, async () => {
        const payload = await refreshCadastreViewport(box);
        const entry = { at: Date.now(), payload };
        _cadastreViewportCache.set(key, entry);
        trimCadastreViewportCache();
        // A refusal is cached like any other answer. It is not an error and it
        // is not going to change until the operator zooms: re-asking Api Carto
        // for 15 977 parcels it will not send is a round trip spent to be told
        // the same thing twice.
        writeCadastreDisk(key, entry);
        return entry;
      });
      try {
        const entry = await request.promise;
        json(200, { ...entry.payload, fetchedAt: entry.at, stale: false }, {
          'X-Cadastre-FR': request.shared ? 'INFLIGHT' : 'MISS',
        });
      } catch (error) {
        console.warn('[Cadastre Proxy] viewport unavailable:', error?.message || error);
        const stale = cached || await readCadastreDisk(key, CADASTRE_STALE_MS);
        if (stale) {
          json(200, { ...stale.payload, fetchedAt: stale.at, stale: true }, { 'X-Cadastre-FR': 'STALE' });
          return;
        }
        json(503, { error: 'The French cadastre is temporarily unavailable' });
      }
    });
  }

  return {
    name: 'cadastre-france-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

function parseJsonEnv(key, fallback) {
  const value = process.env[key];
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    console.warn(`[AISStream] Invalid ${key}; using default.`);
    return fallback;
  }
}

function parseCsvOrJsonEnv(key, fallback) {
  const value = process.env[key];
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
}

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function stringValue(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function numberValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedHeading(value) {
  const heading = numberValue(value);
  return heading !== null && heading >= 0 && heading <= 360 ? heading : null;
}

function normalizeAisTimestamp(value) {
  const text = stringValue(value);
  if (!text) return new Date().toISOString();
  const normalized = text.replace(' +0000 UTC', 'Z').replace(' UTC', 'Z');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}


// ---------------------------------------------------------------------------
// Address-scan proxies — Géorisques, DVF, DPE, isochrone, GPU, IDFM
// ---------------------------------------------------------------------------
/**
 * Six French public sources, read from a single coordinate, behind one shared
 * cache discipline.
 *
 * NONE of these exists to bypass CORS: every one of them sends
 * `access-control-allow-origin: *` (APIcarto echoes the origin), and a browser
 * could call them directly. They are proxied for reasons measured per source
 * on 2026-09-01 and recorded in each `src/data/*Feed.js` header:
 *
 *   - **GPU** — 1,396,720 bytes of servitude geometry for ONE point, one
 *     feature of which is 759 polygons and 50,669 vertices. Projected: 96%
 *     smaller. This is the strongest case of the six.
 *   - **DVF** — 752,768 bytes of CSV per commune-year, of which a 300 m radius
 *     needs a few dozen rows, and the arithmetic on it is wrong by 17× if done
 *     naively (see `dvfFeed.js`). Parsed once, server-side, cached to disk.
 *   - **Géorisques** — three endpoints fanned out per scan, upstream
 *     `cache-control: no-store`, so the per-address cache has to live here.
 *   - **DPE** — small, but the 230-field surface answers HTTP 400 for an
 *     unknown column; the field list belongs somewhere pinned by a unit test.
 *   - **Isochrone** — small, cacheable for weeks upstream, but a routing engine
 *     is the one upstream here that a loop could hammer; rate-limited.
 *   - **IDFM** — small, but the line referential is 2,121 rows that do not
 *     change during a session.
 *
 * Every route answers `{ fetchedAt, stale, ... }` and exposes `/status`.
 * A partial upstream failure degrades one field and leaves the rest standing —
 * the mission design's rule that no single slow source may take down a scan.
 */
const ADDRESS_CACHE_DIR = path.join(process.cwd(), '.gev-cache', 'address');
const ADDRESS_FETCH_TIMEOUT_MS = 20_000;
/** One retry, for transport-level failures only. See `fetchAddressSource`. */
const ADDRESS_FETCH_ATTEMPTS = 2;
const ADDRESS_RETRY_DELAY_MS = 400;
const ADDRESS_MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
/** Scans are cheap to repeat and the underlying registers move slowly. */
const ADDRESS_MEMORY_TTL_MS = 30 * 60 * 1000;
/** A commune-year of DVF is a published file: it does not change at all. */
const DVF_DISK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IDFM_LINES_TTL_MS = 12 * 60 * 60 * 1000;
const _addressRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 90, globalMax: 400 });
const _addressInFlight = new Map();

/**
 * Bounded JSON fetch shared by the address proxies.
 *
 * Resolves to `null` rather than throwing on any failure — HTTP error, timeout,
 * oversized body, unparseable JSON. Every caller of this treats a null as "this
 * one source did not answer" and continues, which is only safe because the
 * failure cannot arrive as an exception from somewhere else.
 *
 * @param {string} url
 * @param {{timeoutMs?: number, maxBytes?: number, text?: boolean}} [options]
 * @returns {Promise<any|null>}
 */
async function fetchAddressSource(url, options = {}) {
  const {
    timeoutMs = ADDRESS_FETCH_TIMEOUT_MS,
    maxBytes = ADDRESS_MAX_RESPONSE_BYTES,
    text = false,
    attempts = ADDRESS_FETCH_ATTEMPTS,
  } = options;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await fetchAddressSourceOnce(url, { timeoutMs, maxBytes, text });
    if (result.ok) return result.value;
    // Retry ONLY a transport-level failure, and only once. Measured: Géorisques
    // resets the connection (ECONNRESET) on roughly one call in four while
    // answering the very same URL from curl, so a scan that gave up on the
    // first reset reported "no risks at this address" for a live register. An
    // HTTP error or an oversized body is a real answer and is never retried.
    if (!result.retryable || attempt === attempts) return null;
    await new Promise((resolve) => { setTimeout(resolve, ADDRESS_RETRY_DELAY_MS); });
  }
  return null;
}

/**
 * One attempt of {@link fetchAddressSource}.
 * @param {string} url
 * @param {{timeoutMs: number, maxBytes: number, text: boolean}} options
 * @returns {Promise<{ok: boolean, value?: any, retryable?: boolean}>}
 */
async function fetchAddressSourceOnce(url, options) {
  const { timeoutMs, maxBytes, text } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'GodsEyeView/1.0 (address scan; +https://github.com/bilawalsidhu/gods-eye-view)' },
    });
    if (!response.ok) {
      console.warn(`[address-proxy] ${response.status} from ${new URL(url).host}`);
      // A 5xx is the server saying "not now"; a 4xx is it saying "not this".
      return { ok: false, retryable: response.status >= 500 };
    }
    // Refuse on the declared size before buffering it. The measured worst case
    // is 1.4 MB of servitude geometry, so anything past the cap is a changed
    // upstream, not a big answer — and reading it to find out is the cost this
    // check exists to avoid.
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      console.warn(`[address-proxy] declared ${declared} bytes from ${new URL(url).host}, over cap`);
      return { ok: false, retryable: false };
    }
    const body = await response.text();
    if (body.length > maxBytes) {
      console.warn(`[address-proxy] oversized body (${body.length}) from ${new URL(url).host}`);
      return { ok: false, retryable: false };
    }
    return { ok: true, value: text ? body : JSON.parse(body) };
  } catch (error) {
    if (error?.name !== 'AbortError') {
      // The cause, not just the message: undici reports every transport-level
      // failure as the same opaque "fetch failed", and the code underneath
      // (ECONNRESET, ENOTFOUND, UND_ERR_CONNECT_TIMEOUT…) is the only thing
      // that distinguishes a flaky upstream from a broken request.
      const cause = error?.cause?.code || error?.cause?.message || null;
      console.warn(`[address-proxy] ${new URL(url).host}: ${error?.message || error}`
        + (cause ? ` (${cause})` : ''));
      // A transport failure (ECONNRESET, socket hang up) or a bad body. Only
      // the former is worth another go; a SyntaxError from JSON.parse is not.
      return { ok: false, retryable: !(error instanceof SyntaxError) };
    }
    // Aborted: the caller's deadline, not the upstream's fault, but retrying
    // would blow the same deadline again.
    return { ok: false, retryable: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read one coordinate pair from a request, or null when either is unusable.
 *
 * The presence check is not redundant with the finite check, and the bug it
 * prevents was found live: `searchParams.get('lon')` returns `null` for an
 * absent parameter, `Number(null)` is `0`, and `Number.isFinite(0)` is true.
 * A request with no coordinates at all therefore scanned 0°N 0°E — a point in
 * the Gulf of Guinea — and returned HTTP 200 with an empty result, which reads
 * as "there is nothing at your address" rather than as a malformed request.
 */
export function addressPoint(searchParams) {
  const rawLon = searchParams.get('lon');
  const rawLat = searchParams.get('lat');
  if (rawLon === null || rawLat === null || rawLon.trim() === '' || rawLat.trim() === '') return null;
  const lon = Number(rawLon);
  const lat = Number(rawLat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lon, lat };
}

/**
 * Cache key for a point, rounded to ~11 m.
 *
 * Four decimals, not the full precision: two clicks on the same doorway must
 * share one cache entry, or the cache never hits for the one workload it was
 * built for.
 */
export function addressCacheKey(prefix, { lon, lat }, ...rest) {
  return `${prefix}|${lon.toFixed(4)},${lat.toFixed(4)}|${rest.join('|')}`;
}

/** Shared in-memory cache for every address route. */
const _addressCache = new Map();
const ADDRESS_CACHE_MAX_ENTRIES = 300;

function addressCacheGet(key, ttlMs = ADDRESS_MEMORY_TTL_MS) {
  const entry = _addressCache.get(key);
  if (!entry) return null;
  return { payload: entry.payload, stale: Date.now() - entry.cachedAt >= ttlMs, cachedAt: entry.cachedAt };
}

function addressCacheSet(key, payload) {
  _addressCache.set(key, { payload, cachedAt: Date.now() });
  while (_addressCache.size > ADDRESS_CACHE_MAX_ENTRIES) {
    _addressCache.delete(_addressCache.keys().next().value);
  }
}

/**
 * Install one address route with the shared cache, limiter and error shape.
 *
 * @param {object} middlewares Vite middleware stack.
 * @param {string} route Mount path, e.g. `/api/dvf`.
 * @param {(url: URL, req: object) => {key: string, load: () => Promise<object|null>}|null} plan
 *   Returns the cache key and the loader, or null when the request is invalid.
 * @param {{ttlMs?: number}} [options]
 */
function installAddressRoute(middlewares, route, plan, options = {}) {
  const ttlMs = options.ttlMs ?? ADDRESS_MEMORY_TTL_MS;
  middlewares.use(route, async (req, res) => {
    const send = (status, payload) => {
      if (res.headersSent) return;
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': status === 200 ? 'private, max-age=300' : 'no-store',
      });
      res.end(JSON.stringify(payload));
    };
    if (req.method !== 'GET') {
      send(405, { error: 'Method Not Allowed' });
      return;
    }
    const url = new URL(req.url || '', 'http://localhost');
    if (url.pathname === '/status' || url.pathname.endsWith('/status')) {
      send(200, { route, entries: _addressCache.size, ttlMs });
      return;
    }
    let planned;
    try {
      planned = plan(url, req);
    } catch (error) {
      send(400, { error: error?.message || 'invalid request' });
      return;
    }
    if (!planned) {
      send(400, { error: 'lat and lon are required' });
      return;
    }
    // Cache before limiter: a repeat of a scan already answered costs nothing
    // upstream, so it should not spend a slot either.
    const cached = addressCacheGet(planned.key, ttlMs);
    if (cached && !cached.stale) {
      send(200, { ...cached.payload, fetchedAt: cached.cachedAt, stale: false });
      return;
    }
    if (!_addressRateLimiter(clientKey(req))) {
      res.setHeader('Retry-After', '5');
      send(429, { error: 'Rate limit exceeded' });
      return;
    }
    try {
      const { promise } = coalesceProxyRequest(_addressInFlight, planned.key, planned.load);
      const payload = await promise;
      if (!payload) {
        // Serve a stale answer rather than nothing: an outage must not read as
        // "there is nothing here".
        if (cached) {
          send(200, { ...cached.payload, fetchedAt: cached.cachedAt, stale: true });
          return;
        }
        send(502, { error: `${route} upstream unavailable` });
        return;
      }
      addressCacheSet(planned.key, payload);
      send(200, { ...payload, fetchedAt: Date.now(), stale: false });
    } catch (error) {
      console.error(`[address-proxy] ${route}`, error?.message || error);
      send(502, { error: `${route} proxy error` });
    }
  });
}

/**
 * Resolve the ARRONDISSEMENT-level INSEE code for a point, via the BAN.
 *
 * The BAN reverse geocoder, and only it. `geo.api.gouv.fr` answers **75056** —
 * Paris as one commune — for every Paris point, and so does the `codeInsee`
 * Géorisques echoes back; DVF publishes its files as **75113**. Two consumers
 * need this now (DVF for its file path, Géorisques for its radon lookup), which
 * is why it is shared rather than copied.
 *
 * Memoised on a ~11 m grid: it is the same call for every scan of a block.
 *
 * @param {number} lon @param {number} lat
 * @returns {Promise<{code: string, name: string|null}|null>}
 */
const _communeCodeCache = new Map();
async function resolveCommuneCode(lon, lat) {
  const key = `${lon.toFixed(4)},${lat.toFixed(4)}`;
  if (_communeCodeCache.has(key)) return _communeCodeCache.get(key);
  const body = await fetchAddressSource(
    `https://api-adresse.data.gouv.fr/reverse/?lon=${lon}&lat=${lat}`,
    { maxBytes: 256 * 1024 },
  );
  const properties = body?.features?.[0]?.properties;
  const code = String(properties?.citycode || '').toUpperCase();
  const resolved = /^[0-9][0-9AB][0-9]{3}$/.test(code)
    ? { code, name: properties?.city || null }
    : null;
  // A failed lookup is NOT cached: it is usually a reset, not a coordinate
  // without a commune, and caching it would make one blip permanent.
  if (resolved) {
    _communeCodeCache.set(key, resolved);
    while (_communeCodeCache.size > 500) {
      _communeCodeCache.delete(_communeCodeCache.keys().next().value);
    }
  }
  return resolved;
}

/**
 * Géorisques — the state's own risk register, read from a coordinate.
 * `GET /api/georisques?lat=&lon=&radius=&insee=`
 * @returns {import('vite').Plugin}
 */
function georisquesProxy() {
  function install(middlewares) {
    installAddressRoute(middlewares, '/api/georisques', (url) => {
      const point = addressPoint(url.searchParams);
      if (!point) return null;
      const radiusM = clampGeorisquesRadius(url.searchParams.get('radius'));
      const rawInsee = String(url.searchParams.get('insee') || '').trim().toUpperCase();
      const givenInsee = /^[0-9][0-9AB][0-9]{3}$/.test(rawInsee) ? rawInsee : null;
      return {
        key: addressCacheKey('georisques', point, radiusM),
        load: async () => {
          // Radon is published per commune and keyed by INSEE code, which the
          // report itself does NOT supply at arrondissement level. Resolving it
          // here rather than demanding it from the caller is what makes radon —
          // one of the items on the statutory état des risques — actually
          // reachable from a bare coordinate.
          const inseeCode = givenInsee ?? (await resolveCommuneCode(point.lon, point.lat))?.code ?? null;
          const urls = buildGeorisquesUrls({ ...point, radiusM, inseeCode });
          const [report, icpe, radon] = await Promise.all([
            fetchAddressSource(urls.report),
            fetchAddressSource(urls.icpe),
            urls.radon ? fetchAddressSource(urls.radon) : Promise.resolve(null),
          ]);
          // All three failing is an outage; any one answering is a scan.
          if (!report && !icpe && !radon) return null;
          return projectGeorisques({ report, icpe, radon, origin: point, radiusM });
        },
      };
    });
  }
  return {
    name: 'georisques-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

/**
 * DVF — what property actually sold for, per commune-year, parsed server-side.
 * `GET /api/dvf?lat=&lon=&radius=&years=2024,2023`
 * @returns {import('vite').Plugin}
 */
function dvfProxy() {
  /**
   * Parsed mutations per commune-year, memoised for the process.
   *
   * BOUNDED, because it is the one structure here that a user can grow just by
   * panning: one entry per commune-year, and a Paris arrondissement year is
   * ~1,700 mutations. A tour of France would otherwise accumulate every commune
   * it crossed for the life of the dev server. The disk cache underneath makes
   * eviction cheap — a re-read is a file, not a download.
   */
  const editions = new Map();
  const EDITION_MEMORY_MAX = 40;

  function rememberEdition(key, mutations) {
    editions.set(key, mutations);
    while (editions.size > EDITION_MEMORY_MAX) {
      editions.delete(editions.keys().next().value);
    }
    return mutations;
  }

  async function loadEdition(year, communeCode) {
    const cacheKey = `${year}-${communeCode}`;
    if (editions.has(cacheKey)) return editions.get(cacheKey);
    const diskPath = path.join(ADDRESS_CACHE_DIR, `dvf-${cacheKey}.json`);
    try {
      const stat = await fsp.stat(diskPath);
      if (Date.now() - stat.mtimeMs < DVF_DISK_TTL_MS) {
        return rememberEdition(cacheKey, JSON.parse(await fsp.readFile(diskPath, 'utf8')));
      }
    } catch { /* no disk copy yet */ }
    const csv = await fetchAddressSource(buildDvfUrl({ year, communeCode }), { text: true });
    // A commune with no edition for a year is a 404, which is data, not an
    // error: an empty list is cached so the miss is not re-fetched every scan.
    const mutations = csv ? groupMutations(parseDvfCsv(csv)) : [];
    rememberEdition(cacheKey, mutations);
    try {
      await fsp.mkdir(ADDRESS_CACHE_DIR, { recursive: true });
      await fsp.writeFile(diskPath, JSON.stringify(mutations));
    } catch { /* cache is an optimisation, never a requirement */ }
    return mutations;
  }

  function install(middlewares) {
    installAddressRoute(middlewares, '/api/dvf', (url) => {
      const point = addressPoint(url.searchParams);
      if (!point) return null;
      const radiusM = clampDvfRadius(url.searchParams.get('radius'));
      const thisYear = new Date().getFullYear();
      const requested = String(url.searchParams.get('years') || '')
        .split(',').map((value) => Number.parseInt(value.trim(), 10))
        .filter((year) => Number.isFinite(year) && year >= DVF_FIRST_YEAR && year <= thisYear);
      // Default to the three most recent editions that can exist. The newest
      // is published with a lag, so an empty answer for it is normal.
      const years = (requested.length ? requested : [thisYear - 1, thisYear - 2, thisYear - 3])
        .filter((year) => year >= DVF_FIRST_YEAR)
        .slice(0, 5)
        .sort((a, b) => b - a);
      return {
        key: addressCacheKey('dvf', point, radiusM, years.join('-')),
        load: async () => {
          const commune = await resolveCommuneCode(point.lon, point.lat);
          if (!commune) return null;
          const all = [];
          for (const year of years) {
            // Sequential on purpose: three 750 KB downloads in parallel for one
            // click is a burst the file host has no reason to absorb.
            all.push(...await loadEdition(year, commune.code));
          }
          const { sales, summary } = selectNearbySales(all, point, radiusM);
          return { commune, years, sales, summary };
        },
      };
    });
  }
  return {
    name: 'dvf-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

/**
 * ADEME DPE — the energy label of a building and of its neighbours.
 * `GET /api/dpe?lat=&lon=&radius=&limit=`
 * @returns {import('vite').Plugin}
 */
function dpeProxy() {
  function install(middlewares) {
    installAddressRoute(middlewares, '/api/dpe', (url) => {
      const point = addressPoint(url.searchParams);
      if (!point) return null;
      const radiusM = clampDpeRadius(url.searchParams.get('radius'));
      const limit = Number.parseInt(url.searchParams.get('limit') || '', 10) || 100;
      return {
        key: addressCacheKey('dpe', point, radiusM, limit),
        load: async () => {
          const payload = await fetchAddressSource(buildDpeUrl({ ...point, radiusM, limit }));
          return payload ? projectDpe(payload, { radiusM }) : null;
        },
      };
    });
  }
  return {
    name: 'dpe-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

/**
 * IGN isochrone — the area actually reachable, rather than a circle.
 * `GET /api/isochrone?lat=&lon=&profile=foot|car&seconds=900`
 * @returns {import('vite').Plugin}
 */
function isochroneProxy() {
  function install(middlewares) {
    installAddressRoute(middlewares, '/api/isochrone', (url) => {
      const point = addressPoint(url.searchParams);
      if (!point) return null;
      const profile = url.searchParams.get('profile') || 'foot';
      if (!resolveIsochroneProfile(profile)) {
        // Cycling is the one the mission design asked for and this service does
        // not have; failing loudly beats drawing a walking ring labelled bike.
        throw new Error(`unsupported profile: ${profile} (foot or car)`);
      }
      const seconds = clampIsochroneSeconds(url.searchParams.get('seconds'));
      return {
        key: addressCacheKey('isochrone', point, profile, seconds),
        load: async () => {
          const payload = await fetchAddressSource(
            buildIsochroneUrl({ ...point, profile, seconds }),
            { maxBytes: 4 * 1024 * 1024 },
          );
          return payload ? projectIsochrone(payload) : null;
        },
      };
    });
  }
  return {
    name: 'isochrone-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

/**
 * Géoportail de l'urbanisme — zoning and servitudes, decimated to an outline.
 * `GET /api/gpu?lat=&lon=`
 * @returns {import('vite').Plugin}
 */
/**
 * Zoning answers keyed on the SNAPPED BOX, so panning a street does not buy the
 * same 300 KB twice.
 *
 * A second cache, next to the route's own, because the two halves of a GPU
 * answer have different keys and merging them would break whichever one loses.
 * The zoning half depends on the BOX; the servitude half and the `atPoint`
 * marking depend on the POINT. Keying the whole payload on the box would tell
 * two different addresses in one block that they stand in the same zone, which
 * is the exact question this layer exists to answer correctly.
 */
const _gpuZoningCache = new Map();
const GPU_ZONING_CACHE_MAX_ENTRIES = 120;

function gpuZoningCacheSet(key, payload) {
  _gpuZoningCache.set(key, { payload, at: Date.now() });
  while (_gpuZoningCache.size > GPU_ZONING_CACHE_MAX_ENTRIES) {
    _gpuZoningCache.delete(_gpuZoningCache.keys().next().value);
  }
}

/**
 * Read the optional bbox off a GPU request.
 *
 * Absent is not an error: no box is the POINT regime, which is what the layer
 * falls back to above its own box altitude. A PARTIAL box is an error, because
 * silently answering a different question than the one asked is how a layer
 * ends up drawing the wrong block.
 *
 * @param {URLSearchParams} searchParams
 * @returns {?object} Validated box, or null for the point regime.
 * @throws {Error} On a malformed or over-wide box; `installAddressRoute` turns
 *   that into a 400 with the message.
 */
export function gpuRequestBox(searchParams) {
  const edges = ['south', 'west', 'north', 'east'].map((k) => searchParams.get(k));
  if (edges.every((v) => v === null || v.trim() === '')) return null;
  const [south, west, north, east] = edges;
  const box = validBox({ south, west, north, east }, GPU_REQUEST_MAX_BOX_DEG);
  if (!box) {
    // Rounded for the message only: `0.02 + 3 * 0.002` is
    // `0.026000000000000002` in binary floating point, and an error string is
    // read by a person.
    throw new Error(
      `A complete non-dateline bbox no larger than ${GPU_REQUEST_MAX_BOX_DEG.toFixed(3)} degrees is required`,
    );
  }
  return box;
}

function gpuProxy() {
  function install(middlewares) {
    installAddressRoute(middlewares, '/api/gpu', (url) => {
      const point = addressPoint(url.searchParams);
      if (!point) return null;
      // Snapped OUTWARD onto the shared grid, so the box sent upstream is up to
      // two steps wider than the one that was validated. That widening is the
      // cache doing its job and is deliberately NOT re-checked against the
      // ceiling — an outward snap of a box that only just passed always lands
      // over it, and re-checking would 400 every request at the layer's own
      // maximum zoom. `GPU_REQUEST_MAX_BOX_DEG` already carries the margin.
      const asked = gpuRequestBox(url.searchParams);
      const box = asked ? snapBoxOutward(asked, GPU_BOX_STEP_DEG) : null;
      const boxTag = box ? boxKey(box, 3) : 'pt';
      return {
        key: addressCacheKey('gpu', point, boxTag),
        load: async () => {
          const zoningKey = box ? boxTag : null;
          const cachedZoning = zoningKey ? _gpuZoningCache.get(zoningKey) : null;
          const [zoning, servitudes] = await Promise.all([
            cachedZoning
              ? Promise.resolve(cachedZoning.payload)
              : fetchAddressSource(
                box ? buildGpuBoxUrl('zone-urba', box) : buildGpuUrl('zone-urba', point),
                // A box answers a neighbourhood: 405 KB over Paris at the
                // layer's ceiling, against 90 KB for one point.
                box ? { maxBytes: 32 * 1024 * 1024 } : undefined,
              ),
            // The measured worst case for a single point is 1.4 MB. Always a
            // POINT: one 390 m box over Lyon's Presqu'île answers 210 easement
            // features and 2.3 MB, four times the payload for the half of the
            // answer a point already gets right.
            fetchAddressSource(buildGpuUrl('assiette-sup-s', point), { maxBytes: 32 * 1024 * 1024 }),
          ]);
          if (!zoning && !servitudes) return null;
          if (zoning && zoningKey && !cachedZoning) gpuZoningCacheSet(zoningKey, zoning);
          // APIcarto caps at 5 000 features, HTTP 200, and says so only in
          // `totalFeatures`. A zoning map missing four fifths of itself is not
          // visibly incomplete — it looks like a commune with mixed zoning — so
          // the whole half is refused and the true count printed.
          const truncation = zoning ? gpuTruncation(zoning) : null;
          const zoningRefused = truncation?.truncated
            ? { found: truncation.total, limit: GPU_UPSTREAM_LIMIT }
            : null;
          return projectGpu({ zoning, servitudes, point, box, zoningRefused });
        },
      };
    });
  }
  return {
    name: 'gpu-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

/**
 * Île-de-France Mobilités — the Paris network as an offer.
 * `GET /api/idfm/stops?bbox=W,S,E,N` or `?lat=&lon=&radius=`
 * `GET /api/idfm/lines`
 * @returns {import('vite').Plugin}
 */
function idfmProxy() {
  let linesCache = null;

  async function loadLines() {
    if (linesCache && Date.now() - linesCache.at < IDFM_LINES_TTL_MS) return linesCache.payload;
    const pages = [];
    // 2,121 lines at 100 per page. Bounded hard: a referential that grew by an
    // order of magnitude must not turn one click into 200 requests.
    for (let offset = 0; offset < 2600; offset += IDFM_PAGE_LIMIT) {
      const page = await fetchAddressSource(buildLinesUrl({ offset, limit: IDFM_PAGE_LIMIT }));
      if (!page?.results?.length) break;
      pages.push(...projectLines(page).lines);
      if (pages.length >= (page.total_count ?? 0)) break;
    }
    if (!pages.length) return linesCache?.payload ?? null;
    const payload = { count: pages.length, lines: pages };
    linesCache = { at: Date.now(), payload };
    return payload;
  }

  function install(middlewares) {
    middlewares.use('/api/idfm/lines', async (req, res) => {
      const send = (status, payload) => {
        if (res.headersSent) return;
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': status === 200 ? 'private, max-age=3600' : 'no-store',
        });
        res.end(JSON.stringify(payload));
      };
      if (req.method !== 'GET') { send(405, { error: 'Method Not Allowed' }); return; }
      if (!_addressRateLimiter(clientKey(req))) {
        res.setHeader('Retry-After', '5');
        send(429, { error: 'Rate limit exceeded' });
        return;
      }
      try {
        const { promise } = coalesceProxyRequest(_addressInFlight, 'idfm-lines', loadLines);
        const payload = await promise;
        if (!payload) { send(502, { error: 'idfm lines upstream unavailable' }); return; }
        send(200, { ...payload, fetchedAt: linesCache?.at ?? Date.now(), stale: false });
      } catch (error) {
        console.error('[address-proxy] /api/idfm/lines', error?.message || error);
        send(502, { error: 'idfm proxy error' });
      }
    });

    installAddressRoute(middlewares, '/api/idfm/stops', (url) => {
      const bbox = String(url.searchParams.get('bbox') || '').split(',').map(Number);
      if (bbox.length === 4 && bbox.every(Number.isFinite)) {
        const [west, south, east, north] = bbox;
        // A whole-country box would ask for 37,956 stops one page at a time.
        if (Math.abs(east - west) > 1 || Math.abs(north - south) > 1) {
          throw new Error('bbox too large: at most 1 degree per side');
        }
        const limit = Number.parseInt(url.searchParams.get('limit') || '', 10) || IDFM_PAGE_LIMIT;
        return {
          key: `idfm-stops|${bbox.map((v) => v.toFixed(4)).join(',')}|${limit}`,
          load: async () => {
            const payload = await fetchAddressSource(
              buildStopsBboxUrl({ west, south, east, north, limit }),
            );
            return payload ? projectStops(payload) : null;
          },
        };
      }
      const point = addressPoint(url.searchParams);
      if (!point) return null;
      const radiusM = Number.parseInt(url.searchParams.get('radius') || '', 10) || 500;
      const limit = Number.parseInt(url.searchParams.get('limit') || '', 10) || IDFM_PAGE_LIMIT;
      return {
        key: addressCacheKey('idfm-stops', point, radiusM, limit),
        load: async () => {
          const payload = await fetchAddressSource(
            buildStopsRadiusUrl({ ...point, radiusM, limit }),
          );
          return payload ? projectStops(payload, point) : null;
        },
      };
    });
  }
  return {
    name: 'idfm-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

// ---------------------------------------------------------------------------
// Hosted-deployment plumbing (access gate + preview parity)
// ---------------------------------------------------------------------------
/**
 * HTTP Basic gate for the whole origin.
 *
 * Every proxy in this file brokers a key somebody pays for, so a reachable
 * origin is a spendable wallet. When GEV_ACCESS_PASSWORD is set this
 * middleware fronts everything — app shell, assets and /api/* alike — and
 * nothing downstream runs until the request authenticates. Unset (the local
 * default) it is a no-op, so `npm run dev` is unchanged.
 *
 * GEV_ACCESS_USER is optional: leave it empty to accept any username.
 * /healthz stays open so a platform health check needs no password.
 *
 * @returns {import('vite').Plugin} Vite plugin.
 */
function accessGatePlugin() {
  let warnedOpen = false;

  /**
   * Constant-time string compare via fixed-width digests (the raw strings
   * differ in length, which timingSafeEqual rejects outright).
   * @param {string} received - Value from the request.
   * @param {string} expected - Configured value.
   * @returns {boolean} True when equal.
   */
  const secretEquals = (received, expected) => timingSafeEqual(
    createHash('sha256').update(String(received), 'utf8').digest(),
    createHash('sha256').update(String(expected), 'utf8').digest(),
  );

  /**
   * @param {import('connect').Server} middlewares - Middleware stack.
   * @param {boolean} hosted - True on the preview server (a real deployment).
   */
  const install = (middlewares, hosted) => {
    middlewares.use('/healthz', (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, gated: Boolean(process.env.GEV_ACCESS_PASSWORD) }));
    });

    middlewares.use((req, res, next) => {
      const expectedUser = String(process.env.GEV_ACCESS_USER || '').trim();
      const expectedPassword = String(process.env.GEV_ACCESS_PASSWORD || '');
      if (!expectedPassword) {
        if (hosted && !warnedOpen) {
          warnedOpen = true;
          console.warn(
            '[access-gate] GEV_ACCESS_PASSWORD is unset — this origin is OPEN, and every keyed proxy on it is spendable by anyone who finds the URL.',
          );
        }
        next();
        return;
      }

      const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
      let authorized = false;
      if (/^basic$/i.test(scheme || '') && encoded) {
        const decoded = Buffer.from(encoded, 'base64').toString('utf8');
        const split = decoded.indexOf(':');
        if (split >= 0) {
          const user = decoded.slice(0, split);
          const password = decoded.slice(split + 1);
          authorized = secretEquals(password, expectedPassword)
            && (!expectedUser || secretEquals(user, expectedUser));
        }
      }
      if (authorized) {
        next();
        return;
      }

      res.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="God\'s Eye View", charset="UTF-8"',
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end('401 — God\'s Eye View is private.\n');
    });
  };

  return {
    name: 'gev-access-gate',
    configureServer(server) { install(server.middlewares, false); },
    configurePreviewServer(server) { install(server.middlewares, true); },
  };
}

/**
 * Mirrors a dev-only middleware plugin onto the preview server.
 *
 * The proxies above were written against `vite dev`; a deployment serves the
 * built bundle through `vite preview`, a different server that installs none
 * of them — so without this the hosted app boots with a third of its /api
 * surface missing. Every mirrored plugin touches only `server.middlewares`
 * (the three that also need `server.httpServer` already declare their own
 * preview hook, and are left untouched here).
 *
 * @param {import('vite').Plugin} plugin - Proxy plugin to mirror.
 * @returns {import('vite').Plugin} The plugin, with preview parity.
 */
function withPreviewParity(plugin) {
  if (!plugin || typeof plugin !== 'object') return plugin;
  if (typeof plugin.configureServer !== 'function') return plugin;
  if (plugin.configurePreviewServer) return plugin;
  return { ...plugin, configurePreviewServer: plugin.configureServer };
}

/**
 * Main Vite configuration factory.
 *
 * Loads .env files via Vite's loadEnv, registers Cesium + local proxy
 * plugins, configures the dev server host/port, and exposes selected
 * API keys to the client as import.meta.env defines.
 */
export default defineConfig(({ mode }) => {
  // Load only this checkout's dotenv files. Shell/Keychain values still win,
  // and no sibling workspace is consulted implicitly.
  const loaded = loadEnv(mode, __dirname, '');
  for (const [key, val] of Object.entries(loaded)) {
    if (process.env[key] === undefined) process.env[key] = val;
  }
  const env = { ...process.env };
  const publicHosts = String(env.GEV_PUBLIC_HOST || '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  return {
    plugins: [
      // First in the list so the gate's middleware lands ahead of every proxy.
      accessGatePlugin(),
      cesium(),
      ...[
      openSkyProxy(),
      celestrakProxy(),
      tomtomProxy(),
      firmsProxy(),
      vigicruesProxy(),
      meteoFranceVigilanceProxy(),
      eco2mixProxy(),
      gasFranceProxy(),
      edfPlantsProxy(),
      bisonFuteProxy(),
      rteGenerationProxy(),
      ndbcProxy(),
      rocketLaunchesProxy(),
      terrainHeightsProxy(),
      adsbdbProxy(),
      overpassProxy(),
      militaryInstallationsProxy(),
      powerGridProxy(),
      osmCamerasProxy(),
      regionalBriefProxy(),
      weatherEffectsProxy(),
      cctvProxy(),
      radioBrowserProxy(),
      gbfsProxy(),
      panTransitProxy(),
      roadStatusFranceProxy(),
      gbfsFranceProxy(),
      irveFranceProxy(),
      cadastreFranceProxy(),
      schoolsFranceProxy(),
      supFranceProxy(),
      comptagesParisProxy(),
      delinquanceFranceProxy(),
      anfrFranceProxy(),
      fraicheurParisProxy(),
      bruitFranceProxy(),
      idfmFrequencyProxy(),
      sitadelFranceProxy(),
      adsbLolProxy(),
      aisLiveProxy(),
      trackBackfillProxies(),
      openAiRealtimeProxy(),
      googlePlacesContextProxy(),
      keylessGeocodeProxy(),
      georisquesProxy(),
      dvfProxy(),
      dpeProxy(),
      isochroneProxy(),
      gpuProxy(),
      idfmProxy(),
      ].map(withPreviewParity),
    ],
    server: {
      host: env.HOST || 'localhost',
      port: parseInt(env.PORT, 10) || 5173,
      // When binding to all interfaces, allow any host; otherwise restrict to local names
      allowedHosts: (env.HOST === '0.0.0.0' || env.HOST === '::')
        ? true
        : ['localhost', '127.0.0.1', '.local'],
    },
    // `vite preview` is what a deployment runs: the built bundle plus the
    // proxies above. A hosted origin answers on a name this checkout cannot
    // guess, so GEV_PUBLIC_HOST names it (comma-separated for several);
    // without it the preview server stays as locked down as the dev one.
    preview: {
      host: env.HOST || 'localhost',
      port: parseInt(env.PORT, 10) || 4173,
      allowedHosts: publicHosts.length
        ? ['localhost', '127.0.0.1', '.local', ...publicHosts]
        : ((env.HOST === '0.0.0.0' || env.HOST === '::')
          ? true
          : ['localhost', '127.0.0.1', '.local']),
    },
    // Expose selected API keys to the browser via import.meta.env.*
    define: {
      'import.meta.env.GOOGLE_MAPS_API_KEY': JSON.stringify(env.GOOGLE_MAPS_API_KEY),
      'import.meta.env.CESIUM_ION_TOKEN': JSON.stringify(env.CESIUM_ION_TOKEN),
    },
    build: {
      // The Cesium engine bundle is inherently large; raise the warning ceiling
      // so the build log isn't dominated by an expected chunk-size notice.
      chunkSizeWarningLimit: 1500,
    },
  };
});
