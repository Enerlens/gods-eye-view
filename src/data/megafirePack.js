/*
 * MEGAFIRE PACK — the shared vocabulary of the Gironde 2026 reconstruction.
 *
 * Two callers, one file, so they cannot drift:
 *   - scripts/build-gironde-megafire-2026.mjs PROJECTS Copernicus EMS EMSR899,
 *     EFFIS and NASA FIRMS into src/data/local_data/gironde_megafire_2026/.
 *   - src/data/girondeMegafire.js READS the shipped fields back to draw the
 *     five perimeters, the fronts, the flames and the hotspot replay.
 *
 * Everything here is pure — no Cesium, no fs, no network — so the build script
 * and the browser both import it as-is. Same contract as ./damsPack.js and
 * ./airportsPack.js next door, and for the same reason: a field the build stops
 * emitting has to become a failing test, not a blank frame on the globe.
 *
 * ── WHAT THIS LAYER IS, AND WHY IT IS NOT `local-firms` ─────────────────────
 *
 * `local-firms` is a LIVE feed: NASA FIRMS VIIRS detections from the last 24
 * hours, anywhere on Earth, empty without a server-side key. This is a CLOSED
 * event: one fire, eighteen days, every byte already on disk. They share a
 * sensor and nothing else — one answers "what is burning now", the other "what
 * happened here, and in what order". Per the repo's one-subject-one-row rule
 * they would merge if either covered the other. Neither does: switching
 * `local-firms` on today over Gironde draws nothing at all, because the fire
 * has been out since 1 August 2026.
 *
 * ── THE EVENT ───────────────────────────────────────────────────────────────
 *
 * Fire reported at Saumos (Gironde) on 22 July 2026 at 18:00 UTC. Copernicus
 * EMS Rapid Mapping was activated 54 minutes later, at 18:54, by the French
 * COGIC — activation EMSR899, one AOI, named "Le Porge" for the commune the
 * delineation is centred on. The fire ran west-north-west into the pine forest
 * behind the Bassin d'Arcachon, forced the evacuation of the Cap-Ferret
 * peninsula, and was declared fixed in the first days of August. EFFIS closes
 * its perimeter on 1 August 2026 at 12:44.
 *
 * It is the largest French forest fire since 1949. For scale, on the same EFFIS
 * layer and the same 1° box, the three big Gironde fires of 2022 measure
 * 13 116 ha (Landiras/Louchats), 7 566 ha (Belin-Béliet) and 5 806 ha
 * (La Teste-de-Buch) — 26 488 ha together, against this one polygon's 37 191.
 *
 * ── THREE INSTITUTIONS, THREE ANSWERS, AND WHY ALL THREE SHIP ───────────────
 *
 * The same fire is published at three different sizes:
 *
 *     31 602 ha   Copernicus EMS, delineation MONIT02, 29 July 14:07 UTC
 *     37 191 ha   EFFIS, final burnt-area polygon, commune "Porge"
 *     47 910 ha   GDACS, alert WF1029628, Red
 *
 * They are not in conflict; they are three different questions. Copernicus
 * delineates what a 0.3 m optical image shows INSIDE a tasked AOI on a given
 * date. EFFIS runs an automatic MODIS/Sentinel burnt-area detection with no AOI
 * and no deadline, so it keeps growing after the mappers stop. GDACS scores an
 * ALERT footprint, deliberately generous because its job is to warn.
 *
 * This pack ships the Copernicus figure on the timeline (it is the one with an
 * image and an hour attached) and the EFFIS figure as the closing frame, and
 * the layer names both. Picking one and hiding the others would be the only
 * dishonest option available here.
 *
 * ── THE 0.19 % THAT PROVES THE GEOMETRY IS THE PUBLISHER'S ──────────────────
 *
 * Every hectare count on screen is Copernicus's own, read out of the activation
 * API — never re-derived from the simplified drawing. But the raw geometry was
 * measured against those figures once, before any simplification, as the check
 * that the right rings were being read (outer minus holes, and not outer
 * alone). On all five products the shoelace area lands 0.18 % to 0.20 % BELOW
 * the published hectares:
 *
 *     DEL_PRODUCT    5 765 ha measured    5 775.4 published   -0.18 %
 *     DEL_MONIT01   24 812 ha            24 857.4            -0.18 %
 *     GRA_PRODUCT   28 228 ha            28 284.7            -0.20 %
 *     DEL_MONIT02   31 541 ha            31 602.4            -0.19 %
 *     GRA_MONIT01   31 266 ha            31 326.5            -0.19 %
 *
 * A constant bias, not a scatter — it is this file's flat-earth projection
 * ({@link MEGAFIRE_M_PER_DEG_LON}), not a disagreement with Copernicus. The
 * first attempt ignored interior rings and came out 10 % to 13 % HIGH with no
 * such pattern, which is how the hole-reading bug was caught. `holes` are
 * therefore not decorative: 1 832 polygons on MONIT02 carve out 4 565 ha of
 * unburnt ground, and a version that dropped them would draw a fire 14 % bigger
 * than the one that happened.
 *
 * ── THE TIMESTAMPS ARE UTC, AND THAT WAS CHECKED, NOT ASSUMED ───────────────
 *
 * Copernicus publishes `acquisitionTime` as a bare string. The Sentinel-2 frame
 * of 26 July is stamped 10:56, and Sentinel-2's descending node is 10:30 local
 * solar time — over this AOI (longitude -1.03°) that is ~10:34 UTC, and real
 * overpasses of south-west France land near 10:50-11:00 UTC. Local French
 * summer time would put it at 08:56 UTC, two hours before the satellite is
 * anywhere near. So the strings are UTC, and this pack stores them with an
 * explicit `Z`.
 */

/** @constant {string} Copernicus EMS Rapid Mapping activation code. */
export const MEGAFIRE_ACTIVATION = 'EMSR899';

/** @constant {string} Layer id. `local-firms` is the LIVE feed; see header. */
export const MEGAFIRE_LAYER_ID = 'gironde-megafire-2026';

/** @constant {string} Pack schema tag. Bump when a shipped field changes shape. */
export const MEGAFIRE_SCHEMA = 'gironde-megafire-2026/1';

/**
 * @constant {{lat: number, lon: number}} AOI centroid, from the activation API
 * (`POINT (-1.031652 44.895835)`). Also the origin of the flat projection.
 */
export const MEGAFIRE_CENTRE = Object.freeze({ lat: 44.895835, lon: -1.031652 });

/**
 * @constant {{west: number, south: number, east: number, north: number}}
 * The box every source is queried over. Wider than the activation extent
 * (-1.267/-0.685, 44.618/45.009) on purpose: it has to hold the second fire at
 * Biscarrosse (44.39) and the northern flare-ups around Saint-Médard-en-Jalles.
 */
export const MEGAFIRE_BBOX = Object.freeze({
  west: -1.45, south: 44.30, east: -0.55, north: 45.15,
});

/** @constant {number} Metres per degree of latitude, at this latitude. */
export const MEGAFIRE_M_PER_DEG_LAT = 111132;

/** @constant {number} Metres per degree of longitude, at {@link MEGAFIRE_CENTRE}. */
export const MEGAFIRE_M_PER_DEG_LON = 111320 * Math.cos(MEGAFIRE_CENTRE.lat * Math.PI / 180);

/**
 * @constant {string} Fire reported. The activation API's `eventTime`, which is
 * six hours later than EFFIS's first detection (11:55 UTC) — EFFIS sees smoke
 * from orbit, the COGIC files a request once it knows it has lost the fire.
 * That gap is why {@link megafireCursorReadout} calls 11:55 a `première
 * détection` and not the start of the fire.
 */
export const MEGAFIRE_EVENT_TIME = '2026-07-22T18:00:00Z';

/** @constant {string} Copernicus EMS activation time — 54 minutes after the report. */
export const MEGAFIRE_ACTIVATION_TIME = '2026-07-22T18:54:00Z';

/**
 * @constant {string} Window open. EFFIS's own FIREDATE for the Le Porge
 * polygon, and the earliest instant any source in this pack claims.
 */
export const MEGAFIRE_WINDOW_START = '2026-07-22T11:55:00Z';

/**
 * @constant {string} Window close. EFFIS's FINALDATE. FIRMS keeps returning a
 * trickle of detections in the box until mid-August (7 on 12 August), but those
 * are other fires in the same 1° square, not this one.
 */
export const MEGAFIRE_WINDOW_END = '2026-08-01T12:44:00Z';

/**
 * The five Copernicus products, in ACQUISITION order — which is not delivery
 * order, and not the order the API returns them in.
 *
 * `burntHa` is Copernicus's published `Burnt area` statistic for that product,
 * carried verbatim. `sensor` is the platform that took the frame the mappers
 * drew on: "Legion" is Airbus Pléiades Neo, VHR1/VHR2 being the 0.3 m class.
 * Note the fourth entry is the ONLY one with a second frame — a Sentinel-2 pass
 * 44 minutes after the Legion one, which is why MONIT01 is the best-covered
 * step and carries 234 active flames against MONIT02's 11.
 *
 * @constant {ReadonlyArray<{id: string, product: string, acq: string,
 *   sensor: string, resolution: string, burntHa: number, label: string}>}
 */
export const MEGAFIRE_STEPS = Object.freeze([
  Object.freeze({
    id: 'del-product',
    product: 'DEL_PRODUCT',
    acq: '2026-07-24T09:05:00Z',
    sensor: 'Pléiades Neo (Legion)',
    resolution: 'VHR2',
    burntHa: 5775.4,
    label: '24 juil. 09:05',
  }),
  Object.freeze({
    id: 'del-monit01',
    product: 'DEL_MONIT01',
    acq: '2026-07-26T10:12:00Z',
    sensor: 'Pléiades Neo (Legion) + Sentinel-2',
    resolution: 'VHR2 + HR+',
    burntHa: 24857.4,
    label: '26 juil. 10:12',
  }),
  Object.freeze({
    id: 'gra-product',
    product: 'GRA_PRODUCT',
    acq: '2026-07-27T16:16:00Z',
    sensor: 'Pléiades Neo (Legion)',
    resolution: 'VHR1',
    burntHa: 28284.7,
    label: '27 juil. 16:16',
  }),
  Object.freeze({
    id: 'del-monit02',
    product: 'DEL_MONIT02',
    acq: '2026-07-29T14:07:00Z',
    sensor: 'Pléiades Neo (Legion)',
    resolution: 'VHR2',
    burntHa: 31602.4,
    label: '29 juil. 14:07',
  }),
  Object.freeze({
    id: 'gra-monit01',
    product: 'GRA_MONIT01',
    acq: '2026-08-01T11:38:00Z',
    sensor: 'Pléiades Neo (Legion)',
    resolution: 'VHR2',
    burntHa: 31326.5,
    label: '1ᵉʳ août 11:38',
  }),
]);

/**
 * Simplification budget, and why these two numbers.
 *
 * The five products carry 8 610 000 vertices across 344 MB of GeoJSON. Nothing
 * that size is going in a browser, and nothing that size is VISIBLE either: at
 * the altitude this fire is read from, 25 m is a third of a pixel.
 *
 * `MEGAFIRE_SIMPLIFY_M` is the Douglas-Peucker tolerance, in metres, applied in
 * the flat projection. `MEGAFIRE_MIN_RING_HA` drops outer rings below it — 1 ha
 * is one VIIRS pixel's worth of ground, i.e. the smallest patch any other
 * source in this pack could even see. Interior rings are held to a quarter of
 * that ({@link MEGAFIRE_MIN_HOLE_HA}) because dropping a hole ADDS area, so the
 * two thresholds must not be symmetric: the cheap error is to draw slightly
 * less fire, never slightly more.
 *
 * @constant {number}
 */
export const MEGAFIRE_SIMPLIFY_M = 25;
/** @constant {number} Smallest outer ring kept, in hectares. */
export const MEGAFIRE_MIN_RING_HA = 1;
/** @constant {number} Smallest interior ring kept, in hectares. See above. */
export const MEGAFIRE_MIN_HOLE_HA = 0.25;

/** @constant {number} Decimal places every shipped coordinate is rounded to (~1.1 m). */
export const MEGAFIRE_COORD_DP = 5;

/**
 * The colour of a perimeter, by its rank in {@link MEGAFIRE_STEPS}.
 *
 * A sequential ramp and not five categorical colours, because the five steps
 * are one growing quantity read in one direction. Dark red is the first frame,
 * so the scene gets brighter as more ground is lost — the opposite of the
 * instinct to fade old data out, and the right way round: the last frame is the
 * one that still matters in September.
 *
 * @constant {ReadonlyArray<string>}
 */
export const MEGAFIRE_STEP_COLORS = Object.freeze([
  '#7f1d1d', '#b91c1c', '#dc2626', '#ea580c', '#f59e0b',
]);

/** @constant {number} Fill alpha for a perimeter. */
export const MEGAFIRE_FILL_ALPHA = 0.45;

/** @constant {string} Fire fronts — photo-interpreted lines, drawn on the ground. */
export const MEGAFIRE_FRONT_COLOR = '#fde047';
/** @constant {string} Active flames — photo-interpreted points. */
export const MEGAFIRE_FLAME_COLOR = '#fef08a';
/** @constant {string} EFFIS's closing perimeter, drawn as an outline only. */
export const MEGAFIRE_EFFIS_COLOR = '#94a3b8';

/**
 * The FRP ladder for a FIRMS detection, in megawatts.
 *
 * FROZEN DOMAIN thresholds, never quantiles of what is on screen — the same C1
 * rule the rest of the repo works to. The ladder is geometric because fire
 * radiative power is: measured on this pack's own 9 562 detections, the
 * distribution runs from 0.3 MW to 1 573.57 MW with a median near 6 MW, so
 * equal intervals would put ~97 % of the set in one class.
 *
 * @constant {ReadonlyArray<{min: number, color: string, label: string}>}
 */
export const MEGAFIRE_FRP_LADDER = Object.freeze([
  Object.freeze({ min: 0, color: '#fbbf24', label: '< 10 MW' }),
  Object.freeze({ min: 10, color: '#f97316', label: '10 – 50 MW' }),
  Object.freeze({ min: 50, color: '#ef4444', label: '50 – 200 MW' }),
  Object.freeze({ min: 200, color: '#fca5a5', label: '≥ 200 MW' }),
]);

/**
 * Which rung of {@link MEGAFIRE_FRP_LADDER} a fire radiative power sits on.
 * @param {number} frpMw - Fire radiative power, megawatts.
 * @returns {number} Index into the ladder; 0 for anything non-finite.
 */
export function megafireFrpLevel(frpMw) {
  if (!Number.isFinite(frpMw)) return 0;
  let level = 0;
  for (let i = 1; i < MEGAFIRE_FRP_LADDER.length; i += 1) {
    if (frpMw >= MEGAFIRE_FRP_LADDER[i].min) level = i;
  }
  return level;
}

/**
 * The step whose imagery is the most recent at `instantMs`, or null before the
 * first frame.
 *
 * A perimeter is what a satellite SAW at an hour, so it becomes true at its
 * acquisition instant and stays true until the next frame replaces it. Reading
 * it as "the state of the fire between two passes" would be the one thing the
 * data cannot support: between 24 July 09:05 and 26 July 10:12 the fire gained
 * 19 082 ha and nobody photographed a single intermediate hectare.
 *
 * @param {number} instantMs - Epoch milliseconds.
 * @param {ReadonlyArray<{acq: string}>} [steps] - Defaults to {@link MEGAFIRE_STEPS}.
 * @returns {?number} Index into `steps`, or null when `instantMs` precedes them all.
 */
export function megafireStepAt(instantMs, steps = MEGAFIRE_STEPS) {
  if (!Number.isFinite(instantMs)) return null;
  let found = null;
  for (let i = 0; i < steps.length; i += 1) {
    if (Date.parse(steps[i].acq) <= instantMs) found = i;
  }
  return found;
}

/**
 * Shoelace area of one flat ring, in square metres, in the flat projection.
 * @param {ArrayLike<number>} flat - `[x, y, x, y, ...]` in metres.
 * @returns {number} Unsigned area.
 */
export function megafireRingAreaM2(flat) {
  const count = flat.length / 2;
  if (count < 3) return 0;
  let sum = 0;
  for (let i = 0; i < count; i += 1) {
    const j = (i + 1) % count;
    sum += flat[i * 2] * flat[j * 2 + 1] - flat[j * 2] * flat[i * 2 + 1];
  }
  return Math.abs(sum) / 2;
}

/**
 * Net area of one polygon — outer ring minus interior rings.
 * @param {ReadonlyArray<ArrayLike<number>>} rings - Outer ring first.
 * @returns {number} Square metres, floored at zero.
 */
export function megafirePolygonAreaM2(rings) {
  if (!rings?.length) return 0;
  let area = megafireRingAreaM2(rings[0]);
  for (let i = 1; i < rings.length; i += 1) area -= megafireRingAreaM2(rings[i]);
  return Math.max(0, area);
}

/**
 * Longitude/latitude → the flat metric plane this pack simplifies in.
 * @param {number} lon
 * @param {number} lat
 * @returns {[number, number]} Metres east, metres north.
 */
export function megafireToMetres(lon, lat) {
  return [lon * MEGAFIRE_M_PER_DEG_LON, lat * MEGAFIRE_M_PER_DEG_LAT];
}

/**
 * Inverse of {@link megafireToMetres}, rounded to {@link MEGAFIRE_COORD_DP}.
 * @param {number} x - Metres east.
 * @param {number} y - Metres north.
 * @returns {[number, number]} `[lon, lat]`.
 */
export function megafireToDegrees(x, y) {
  const p = 10 ** MEGAFIRE_COORD_DP;
  return [
    Math.round((x / MEGAFIRE_M_PER_DEG_LON) * p) / p,
    Math.round((y / MEGAFIRE_M_PER_DEG_LAT) * p) / p,
  ];
}

/**
 * Attribution, one line per publisher whose bytes are actually in the pack.
 * Copernicus products are free and open under Regulation (EU) 1159/2013 and
 * require the "Contains modified Copernicus ..." wording; FIRMS is public
 * domain but NASA asks to be named.
 * @constant {ReadonlyArray<{source: string, credit: string, licence: string, url: string}>}
 */
export const MEGAFIRE_CREDITS = Object.freeze([
  Object.freeze({
    source: 'Copernicus EMS Rapid Mapping',
    credit: '© Contains modified Copernicus EMS Rapid Mapping data (EMSR899) 2026',
    licence: 'Copernicus data and information policy — Reg. (EU) 1159/2013',
    url: 'https://mapping.emergency.copernicus.eu/activations/EMSR899/',
  }),
  Object.freeze({
    source: 'EFFIS',
    credit: '© European Forest Fire Information System — EFFIS, Copernicus EMS',
    licence: 'Copernicus data and information policy',
    url: 'https://forest-fire.emergency.copernicus.eu/',
  }),
  Object.freeze({
    source: 'NASA FIRMS',
    credit: 'NASA FIRMS — VIIRS (S-NPP, NOAA-20, NOAA-21) and MODIS active fire data',
    licence: 'Public domain (NASA open data)',
    url: 'https://firms.modaps.eosdis.nasa.gov/',
  }),
]);
