/**
 * @module aisSubscription
 * @description What the server asks AISStream for — and whether silence on
 * that subscription is evidence of a fault or just a quiet corner of the sea.
 *
 * ── Why the default box is France and not the world ────────────────────────
 *
 * The subscription used to open on `[[[-90,-180],[90,180]]]`: every AIS
 * message on Earth, down one websocket. Measured on 2026-09-03 that is ~18 300
 * distinct MMSIs in five minutes, of which ~5 500 managed to get a static
 * message through — the identity messages are the ones that lose the race when
 * the pipe is saturated, and identity is exactly what the map is missing
 * (`aisStaticRegistry.js`).
 *
 * The same feed clipped to metropolitan France carries ~3 750 contacts. Same
 * static-message cadence per ship, a fifth of the traffic to push it through,
 * and — since the registry now survives restarts — a declared-type share that
 * climbs across sessions instead of resetting with each one.
 *
 * This is a France product: every other live layer here is French by
 * construction. The world box remains one line of `.env` away.
 *
 * ── The DOM-TOM are NOT in this box ────────────────────────────────────────
 *
 * It is metropolitan, like the bundled département outlines and for the same
 * honesty: Guadeloupe, Martinique, Guyane, La Réunion, Mayotte, Saint-Pierre,
 * Nouvelle-Calédonie and Polynésie publish AIS that this subscription does not
 * ask for. Adding them is adding boxes here — not a code change elsewhere.
 *
 * ── Silence, and when it means something ───────────────────────────────────
 *
 * The watchdog reports a feed dead after ~2 minutes without a message. That
 * inference is only sound on a subscription busy enough that two quiet minutes
 * cannot happen naturally, so it self-arms ONLY for a subscription this repo
 * has measured as busy — the two presets below, unfiltered. A harbour-sized
 * box or a message-type filter can be legitimately quiet for minutes, and its
 * operator opts back in by setting `AISSTREAM_SILENCE_TIMEOUT_MS` to a value
 * sized for that filter.
 *
 * Note this is decided on the RESOLVED subscription, not on whether an
 * environment variable happens to be set: an operator who restores the world
 * box by hand gets the watchdog, because the world box is busy.
 */

/** The whole planet — the previous default, still available via `.env`. */
export const AIS_BBOX_WORLD = Object.freeze([[[-90, -180], [90, 180]]]);

/**
 * Metropolitan France and its approaches, as `[[southLat, westLon], [northLat, eastLon]]`.
 *
 * West to 8° W takes in the Ouessant traffic separation scheme off Brittany
 * and the western approaches; north to 51.6° N covers the Dover strait and
 * Dunkerque; east to 10° E and south to 41° N take in the Gulf of Lion,
 * Corsica and the Ligurian approaches to Nice. Measured 2026-09-03: ~3 756
 * distinct contacts, against ~18 308 worldwide.
 */
export const AIS_BBOX_FRANCE = Object.freeze([[[41.0, -8.0], [51.6, 10.0]]]);

/**
 * Message types the subscription asks for.
 *
 * The three position families are what the map draws; `ShipStaticData` and
 * `StaticDataReport` are the only carriers of type, name, IMO and hull, and
 * dropping either of them is what would make "Type non déclaré" permanent.
 */
export const AIS_DEFAULT_MESSAGE_TYPES = Object.freeze([
  'PositionReport',
  'StandardClassBPositionReport',
  'ExtendedClassBPositionReport',
  'ShipStaticData',
  'StaticDataReport',
]);

/** Presets whose message volume this repo has actually measured. */
const KNOWN_BUSY_BOXES = Object.freeze([AIS_BBOX_WORLD, AIS_BBOX_FRANCE]);

function sameCorner(a, b) {
  return Array.isArray(a) && Array.isArray(b)
    && a.length === 2 && b.length === 2
    && Number(a[0]) === Number(b[0]) && Number(a[1]) === Number(b[1]);
}

function sameBoxes(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((box, index) => {
    const other = b[index];
    return Array.isArray(box) && Array.isArray(other)
      && box.length === 2 && other.length === 2
      && sameCorner(box[0], other[0]) && sameCorner(box[1], other[1]);
  });
}

/** Whether the resolved bounding boxes are one of the measured presets. */
export function isKnownBusyBoundingBoxes(boundingBoxes) {
  return KNOWN_BUSY_BOXES.some((preset) => sameBoxes(boundingBoxes, preset));
}

/**
 * Whether the resolved subscription still asks for every default message type.
 * A missing filter means "everything", which qualifies.
 */
export function coversDefaultMessageTypes(messageTypes) {
  if (messageTypes === undefined || messageTypes === null) return true;
  if (!Array.isArray(messageTypes)) return false;
  const asked = new Set(messageTypes.map((entry) => String(entry).trim()));
  return AIS_DEFAULT_MESSAGE_TYPES.every((type) => asked.has(type));
}

/**
 * Whether silence on this subscription is evidence of a broken feed.
 *
 * @param {Array} boundingBoxes Resolved `BoundingBoxes`.
 * @param {Array} [messageTypes] Resolved `FilterMessageTypes`.
 * @returns {boolean} True when the watchdog may self-arm.
 */
export function isBusyAisSubscription(boundingBoxes, messageTypes) {
  return isKnownBusyBoundingBoxes(boundingBoxes) && coversDefaultMessageTypes(messageTypes);
}
