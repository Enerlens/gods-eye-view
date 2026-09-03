/**
 * Where the catchment goes on screen, and where its card goes beside it.
 *
 * WHY A CLICK NOW MOVES THE CAMERA. Pinning a centre made the layer answer the
 * question the reader asked; it did not make the answer VISIBLE. A fifteen
 * minute drive is up to 16.5 km across and a fifteen minute walk 1.9 km — two
 * orders of magnitude apart — so whatever altitude the reader happened to be at
 * when they clicked is the wrong one for one of them, and usually for both. The
 * layer measures the shape it just drew and flies to the altitude that fits it.
 *
 * AND WHY THE FRAME IS NOT THE CANVAS. The canvas is not what the reader can
 * see: the panel stack, the right rail, the title bar and the command dock sit
 * on top of it and swallow whatever is under them. Centring a catchment on the
 * canvas centre puts a third of it under the DATA LAYERS panel. So the frame is
 * the canvas MINUS the chrome — read from the same element inventory the card
 * solver already avoids — and the catchment is centred in THAT.
 *
 * AND WHY A BAND IS RESERVED. The card is anchored in the world, and a card
 * anchored on the centre of a catchment is painted on top of the catchment,
 * which is the complaint this module exists for. Reserving the card's own
 * height at the bottom of the frame and anchoring the card on the shape's LOWER
 * EDGE puts the two side by side: the leader line touches the outline it
 * describes, and no pixel of the wash is under the card. The band costs about a
 * sixth of the frame's height, which is a sixth of the zoom — cheaper than any
 * horizontal band, because the card is three times wider than it is tall.
 *
 * THE ARITHMETIC IS NADIR-ONLY, AND THAT IS DELIBERATE. Ground metres per pixel
 * is a single number only when the camera looks straight down; at any pitch the
 * top of the screen is further away than the bottom and a catchment framed on
 * the flat-ground formula lands wrong by tens of per cent. A top-down view is
 * also what a two-dimensional catchment is for. Heading is PRESERVED — a reader
 * who turned the map keeps their bearing — and the screen axes are rotated into
 * the ground axes rather than the map being turned back to north.
 *
 * @module data/isochroneFraming
 */

import { WORLD_OVERLAY_OCCLUDER_SELECTORS, overlayElementIsVisible } from '../overlays/worldOverlay.js';
import { viewGateFieldOfView } from './viewGate.js';

/** Clearance kept between the catchment, the card and the chrome, in px. */
export const FRAME_MARGIN_PX = 14;

/**
 * How much of the frame the catchment is allowed to fill.
 *
 * Not 1. A ring drawn flush against a panel edge reads as a ring that has been
 * CUT by it, and the reader cannot tell a boundary the network drew from one
 * the window drew.
 */
export const FRAME_FILL = 0.88;

/** Below this the reserved band has eaten the frame and is given up on. */
export const FRAME_MIN_BOX_PX = 200;

/**
 * Altitude bounds for the flight.
 *
 * The floor is the smallest catchment worth flying to — a two-minute walk in a
 * cul-de-sac — and the ceiling is well past the widest driving catchment
 * measured (16.5 km, which frames at about 26 km up). Both exist so a
 * degenerate ring cannot fly the camera into the ground or into orbit.
 */
export const FRAME_MIN_ALTITUDE_M = 260;
export const FRAME_MAX_ALTITUDE_M = 300_000;

/**
 * Gap between the shape's edge and the card, in px.
 *
 * `createAddressScanOverlayEntry` asks for `anchorRadiusPx: 9` and
 * `minAnchorGapPx: 11`, which the overlay host resolves to a 20 px gap. Two
 * more so the reserved band is never a pixel short of what the host then uses.
 */
export const CARD_GAP_PX = 22;

/**
 * A chrome element wider (or taller) than this fraction of the canvas is NOT
 * treated as an edge band.
 *
 * A band is a thing you can inset past. A full-bleed element is not: insetting
 * past it would leave nothing, so it is ignored and the catchment is drawn
 * under it — which is what happened before this module existed, and is a far
 * better failure than refusing to frame at all.
 */
export const CHROME_BAND_MAX_RATIO = 0.45;

/**
 * How far from an edge chrome may start and still count as parked against it.
 *
 * Not zero, and not the margin. This app's chrome sits in a GUTTER: the panel
 * stack opens at `--left-stack-x: 52px`, the right rail and the command dock
 * likewise stand off their edges. Requiring an element to touch the canvas edge
 * measured exactly none of them, and the catchment was framed on the whole
 * canvas with a third of it under the DATA LAYERS panel — the bug this constant
 * exists to name. A tenth of the canvas is wider than any gutter and narrower
 * than anything that could be called central.
 */
export const CHROME_EDGE_TOLERANCE = 0.1;

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON_EQUATOR = 111_320;

/** Metres per degree of longitude at a latitude. */
function lonMetres(lat) {
  return Math.max(1, M_PER_DEG_LON_EQUATOR * Math.cos((lat * Math.PI) / 180));
}

/**
 * The ground the drawn catchment covers, from the rings themselves.
 *
 * Every vertex of every ring, not just the outer one: the rings are nested in
 * the ordinary case and are not required to be — a service that drops the
 * fifteen-minute ring leaves the ten-minute one as the widest thing on screen,
 * and framing on `rings.at(-1)` would then frame on nothing.
 *
 * @param {Array<{ring: Array<number[]>, parts?: Array<{ring: Array<number[]>}>}>} rings
 * @param {{lon: number, lat: number}|null} [centre] Included when given, so the
 *   marker is never framed out of its own catchment.
 * @returns {{west: number, south: number, east: number, north: number}|null}
 */
export function catchmentBounds(rings, centre = null) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const consider = (lon, lat) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  };
  for (const ring of Array.isArray(rings) ? rings : []) {
    const parts = Array.isArray(ring?.parts) && ring.parts.length
      ? ring.parts
      : [{ ring: ring?.ring }];
    for (const part of parts) {
      for (const point of Array.isArray(part?.ring) ? part.ring : []) {
        consider(point?.[0], point?.[1]);
      }
    }
  }
  if (centre) consider(centre.lon, centre.lat);
  if (!Number.isFinite(west) || !Number.isFinite(south)) return null;
  if (east <= west && north <= south) return null;
  return { west, south, east, north };
}

/**
 * A lon/lat box as a centre and a ground span.
 * @param {{west: number, south: number, east: number, north: number}} bounds
 * @returns {{lon: number, lat: number, widthM: number, heightM: number}}
 */
export function boundsSpanM(bounds) {
  const lat = (bounds.south + bounds.north) / 2;
  const lon = (bounds.west + bounds.east) / 2;
  return {
    lon,
    lat,
    widthM: Math.max(1, (bounds.east - bounds.west) * lonMetres(lat)),
    heightM: Math.max(1, (bounds.north - bounds.south) * M_PER_DEG_LAT),
  };
}

/**
 * A north-aligned ground box, measured along the SCREEN axes.
 *
 * At heading 0 this is the identity. At any other heading the box is turned
 * under the camera and its screen-aligned envelope is wider than either side —
 * which is the span that has to fit, not the box's own width.
 *
 * @param {number} widthM East-west span.
 * @param {number} heightM North-south span.
 * @param {number} headingRad Camera heading.
 * @returns {{widthM: number, heightM: number}} Screen-axis spans.
 */
export function screenFootprintM(widthM, heightM, headingRad) {
  const cos = Math.abs(Math.cos(headingRad));
  const sin = Math.abs(Math.sin(headingRad));
  return {
    widthM: widthM * cos + heightM * sin,
    heightM: widthM * sin + heightM * cos,
  };
}

/**
 * Move a coordinate by an offset expressed on the SCREEN axes.
 *
 * Screen right at heading h points along bearing h+90°, screen up along h. The
 * inverse of that rotation is what turns "300 m below the middle of the screen"
 * into a longitude and a latitude.
 *
 * @param {object} input
 * @param {number} input.lon @param {number} input.lat
 * @param {number} input.rightM Metres toward the right of the screen.
 * @param {number} input.downM Metres toward the bottom of the screen.
 * @param {number} input.headingRad
 * @returns {{lon: number, lat: number}}
 */
export function screenOffsetToLonLat({ lon, lat, rightM, downM, headingRad }) {
  const cos = Math.cos(headingRad);
  const sin = Math.sin(headingRad);
  const upM = -downM;
  const eastM = rightM * cos + upM * sin;
  const northM = -rightM * sin + upM * cos;
  return {
    lon: lon + eastM / lonMetres(lat),
    lat: lat + northM / M_PER_DEG_LAT,
  };
}

/** Clamp a rect into `{x, y, w, h}` with non-negative sides, or null. */
function normalizeRect(rect) {
  const x = Number(rect?.x);
  const y = Number(rect?.y);
  const w = Number(rect?.w);
  const h = Number(rect?.h);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

/**
 * The largest part of the canvas no edge-anchored chrome is sitting on.
 *
 * Insets, not a general empty-rectangle search. Every element in the overlay's
 * occluder inventory that starts within {@link CHROME_EDGE_TOLERANCE} of an
 * edge and is thinner than {@link CHROME_BAND_MAX_RATIO} is a BAND, and a band
 * is something you inset past. An element touching two edges — the HUD corners do — is charged to
 * whichever inset removes less canvas, so a short wide corner block costs a
 * shallow top inset rather than a deep left one.
 *
 * Each candidate is measured against the FULL canvas rather than against the
 * frame so far, which makes the result independent of the order the elements
 * come back in.
 *
 * @param {object} input
 * @param {number} input.width @param {number} input.height Canvas, CSS px.
 * @param {Array<{x: number, y: number, w: number, h: number}>} [input.obstacles]
 * @param {number} [input.margin]
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function chromeFreeRect({ width, height, obstacles = [], margin = FRAME_MARGIN_PX }) {
  const full = {
    x: margin,
    y: margin,
    w: Math.max(0, width - margin * 2),
    h: Math.max(0, height - margin * 2),
  };
  if (!(width > 0) || !(height > 0)) return full;
  let left = margin;
  let right = width - margin;
  let top = margin;
  let bottom = height - margin;
  for (const raw of obstacles) {
    const rect = normalizeRect(raw);
    if (!rect) continue;
    const x0 = rect.x;
    const y0 = rect.y;
    const x1 = rect.x + rect.w;
    const y1 = rect.y + rect.h;
    // Entirely off the canvas: a panel scrolled or animated out of frame.
    if (x1 <= 0 || y1 <= 0 || x0 >= width || y0 >= height) continue;
    const nearX = Math.max(margin, width * CHROME_EDGE_TOLERANCE);
    const nearY = Math.max(margin, height * CHROME_EDGE_TOLERANCE);
    const candidates = [];
    if (x0 <= nearX && x1 <= width * CHROME_BAND_MAX_RATIO) {
      candidates.push({ cost: x1 * height, apply: () => { left = Math.max(left, x1 + margin); } });
    }
    if (x1 >= width - nearX && width - x0 <= width * CHROME_BAND_MAX_RATIO) {
      candidates.push({ cost: (width - x0) * height, apply: () => { right = Math.min(right, x0 - margin); } });
    }
    if (y0 <= nearY && y1 <= height * CHROME_BAND_MAX_RATIO) {
      candidates.push({ cost: y1 * width, apply: () => { top = Math.max(top, y1 + margin); } });
    }
    if (y1 >= height - nearY && height - y0 <= height * CHROME_BAND_MAX_RATIO) {
      candidates.push({ cost: (height - y0) * width, apply: () => { bottom = Math.min(bottom, y0 - margin); } });
    }
    if (!candidates.length) continue;
    candidates.sort((a, b) => a.cost - b.cost)[0].apply();
  }
  const w = right - left;
  const h = bottom - top;
  // The chrome met in the middle. Better to frame on the whole canvas and let
  // a panel cover an edge of the catchment than to fly to a two-pixel box.
  if (w < FRAME_MIN_BOX_PX || h < FRAME_MIN_BOX_PX) return full;
  return { x: left, y: top, w, h };
}

/**
 * Read the live chrome rectangles, canvas-relative.
 *
 * The same selector list the card solver avoids, so the frame and the card
 * cannot disagree about where the chrome is. Elements are measured, not
 * assumed: the panel stack changes height whenever a row expands.
 *
 * @param {object} canvas Scene canvas.
 * @param {object} [doc]
 * @param {string[]} [selectors]
 * @returns {Array<{x: number, y: number, w: number, h: number}>}
 */
export function readChromeObstacles(
  canvas,
  doc = globalThis.document,
  selectors = WORLD_OVERLAY_OCCLUDER_SELECTORS,
) {
  if (typeof canvas?.getBoundingClientRect !== 'function') return [];
  if (typeof doc?.querySelectorAll !== 'function') return [];
  const canvasRect = canvas.getBoundingClientRect();
  const out = [];
  const seen = new Set();
  for (const selector of selectors) {
    let matches = [];
    try {
      matches = doc.querySelectorAll(selector);
    } catch {
      continue;
    }
    for (const element of matches) {
      if (seen.has(element) || !overlayElementIsVisible(element)) continue;
      seen.add(element);
      const rect = element.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      out.push({
        x: rect.left - canvasRect.left,
        y: rect.top - canvasRect.top,
        w: rect.width,
        h: rect.height,
      });
    }
  }
  return out;
}

/**
 * Estimate a card's painted size without a canvas to measure it on.
 *
 * The overlay host measures its cards with `measureContext.measureText`; this
 * runs before there is a card to measure, so it reproduces the same box from
 * the same padding constants and a monospace advance. JetBrains Mono at 10.5 px
 * advances 6.3 px and at 13 px 7.8 px — 0.6 em, which is the family's own
 * metric and the reason a monospace face was chosen for these cards.
 *
 * Over-estimating is safe and under-estimating is not, so the width carries 6 %
 * of slack: too wide a reservation costs a little zoom, too narrow a one puts
 * the card back on the wash.
 *
 * @param {string} title
 * @param {string[]} details
 * @returns {{w: number, h: number}} CSS px.
 */
export function estimateCardBoxPx(title, details = []) {
  const lines = (Array.isArray(details) ? details : []).filter(Boolean).slice(0, 6);
  const titleW = String(title || '').length * 7.8;
  let detailW = 0;
  for (const line of lines) detailW = Math.max(detailW, String(line).length * 6.3);
  return {
    w: Math.ceil(Math.max(titleW, detailW) * 1.06) + 24,
    h: 16 + 15 + lines.length * 15,
  };
}

/**
 * Solve the flight: an altitude that fits the catchment, and where to point.
 *
 * The catchment is centred in the frame LESS the card band, which is why the
 * plan hands back both a camera offset and a card-anchor offset: they are two
 * consequences of one layout and computing them apart is how they drift.
 *
 * Offsets are in metres along the SCREEN axes, to be turned into a coordinate
 * by {@link screenOffsetToLonLat} at the heading actually in force.
 *
 * @param {object} input
 * @param {{widthM: number, heightM: number}} input.footprint Screen-axis span.
 * @param {{x: number, y: number, w: number, h: number}} input.free
 * @param {number} input.canvasWidth @param {number} input.canvasHeight
 * @param {{w: number, h: number}} input.card
 * @param {number} input.fovxRad Horizontal field of view.
 * @returns {?object} Null when the inputs cannot describe a flight.
 */
export function framePlan({
  footprint, free, canvasWidth, canvasHeight, card, fovxRad,
}) {
  const fw = Number(footprint?.widthM);
  const fh = Number(footprint?.heightM);
  const frame = normalizeRect(free);
  if (!frame || !(fw > 0) || !(fh > 0)) return null;
  if (!(canvasWidth > 0) || !(canvasHeight > 0)) return null;
  const halfFov = Math.tan(Math.max(0.05, Math.min(fovxRad || Math.PI / 3, 2.9)) / 2);
  if (!(halfFov > 0)) return null;

  const band = Math.max(0, Number(card?.h) || 0) + CARD_GAP_PX;
  // BELOW, always — and the alternative is not "above", it is "nowhere". The
  // frame already excludes the chrome, so a band off the top and a band off the
  // bottom leave the catchment exactly the same room; there is nothing to
  // choose between them and a card under the shape reads as its caption. When
  // even one band would leave nothing to draw in, the card goes back on the
  // marker and covers some wash, which beats framing a catchment into 200 px.
  const short = frame.h - band < FRAME_MIN_BOX_PX;
  const side = short ? 'none' : 'below';
  const box = short ? { ...frame } : { x: frame.x, y: frame.y, w: frame.w, h: frame.h - band };

  const wanted = Math.max(fw / (box.w * FRAME_FILL), fh / (box.h * FRAME_FILL));
  const altitudeM = Math.min(
    FRAME_MAX_ALTITUDE_M,
    Math.max(FRAME_MIN_ALTITUDE_M, (wanted * canvasWidth) / (2 * halfFov)),
  );
  // Re-derived from the CLAMPED altitude. The offsets below are pixel
  // distances converted with this number, and a clamp that changed the
  // altitude without changing the scale would aim the camera at the wrong spot.
  const metresPerPixel = (2 * altitudeM * halfFov) / canvasWidth;

  const offsetRightPx = (box.x + box.w / 2) - canvasWidth / 2;
  const offsetDownPx = (box.y + box.h / 2) - canvasHeight / 2;
  return {
    side,
    box,
    altitudeM,
    metresPerPixel,
    // The camera stands OPPOSITE the offset: the point under the camera is the
    // one painted at the canvas centre, so putting the catchment left of centre
    // means standing to its right.
    cameraRightM: -offsetRightPx * metresPerPixel,
    cameraDownM: -offsetDownPx * metresPerPixel,
    // The lower edge of the catchment, where the card hangs off it.
    anchorRightM: 0,
    anchorDownM: fh / 2,
  };
}

/**
 * Everything the flight needs, from a viewer and a drawn payload.
 *
 * One entry point, so a caller never has to know the order the six pieces go
 * in. Returns null whenever any of them is missing, which is the signal to
 * leave the camera alone rather than to guess.
 *
 * @param {object} input
 * @param {object} input.viewer
 * @param {Array<object>} input.rings
 * @param {{lon: number, lat: number}} input.centre
 * @param {{w: number, h: number}} input.card Estimated card box.
 * @returns {?object} `{ camera: {lon, lat, altitudeM}, anchor: {lon, lat}, side, box, headingRad, metresPerPixel }`
 */
export function solveCatchmentFrame({ viewer, rings, centre, card }) {
  const scene = viewer?.scene;
  const canvas = scene?.canvas;
  const camera = viewer?.camera;
  if (!scene || !canvas || !camera) return null;
  const canvasWidth = canvas.clientWidth || canvas.width || 0;
  const canvasHeight = canvas.clientHeight || canvas.height || 0;
  const bounds = catchmentBounds(rings, centre);
  if (!bounds) return null;
  const span = boundsSpanM(bounds);
  const headingRad = Number.isFinite(camera.heading) ? camera.heading : 0;
  const { fovxDeg } = viewGateFieldOfView(camera.frustum);
  const plan = framePlan({
    footprint: screenFootprintM(span.widthM, span.heightM, headingRad),
    free: chromeFreeRect({
      width: canvasWidth,
      height: canvasHeight,
      obstacles: readChromeObstacles(canvas),
    }),
    canvasWidth,
    canvasHeight,
    card,
    fovxRad: (fovxDeg * Math.PI) / 180,
  });
  if (!plan) return null;
  const target = screenOffsetToLonLat({
    lon: span.lon, lat: span.lat, rightM: plan.cameraRightM, downM: plan.cameraDownM, headingRad,
  });
  const anchor = screenOffsetToLonLat({
    lon: span.lon, lat: span.lat, rightM: plan.anchorRightM, downM: plan.anchorDownM, headingRad,
  });
  return {
    camera: { lon: target.lon, lat: target.lat, altitudeM: plan.altitudeM },
    anchor: plan.side === 'none' ? null : anchor,
    side: plan.side,
    box: plan.box,
    bounds,
    headingRad,
    metresPerPixel: plan.metresPerPixel,
  };
}
