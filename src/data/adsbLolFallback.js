const KNOT_TO_MPS = 0.514444;
const FOOT_TO_M = 0.3048;
const FPM_TO_MPS = 0.00508;

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function emitterCategory(value) {
  const category = String(value || '').trim().toUpperCase();
  const categories = {
    A1: 2,
    A2: 3,
    A3: 4,
    A4: 5,
    A5: 6,
    A6: 7,
    A7: 8,
    B1: 9,
    B2: 10,
    B3: 11,
    B4: 12,
    B6: 14,
    B7: 15,
  };
  return categories[category] || 0;
}

/**
 * Convert one adsb.lol v2 aircraft record into the OpenSky state-vector shape
 * consumed by the existing Flights renderer.
 *
 * Indices 0..17 are the OpenSky `extended=1` vector. Indices 18 and 19 are a
 * GEV extension carrying what OpenSky simply does not have: the ICAO type
 * designator (`t`) and the tail (`r`). `/states/all` publishes neither, only
 * the emitter category at [17] — which is `0`/"no info" for ~94 % of
 * contacts, so nearly every aircraft used to reach the classifier with
 * nothing to classify on and fell back to the placeholder silhouette while
 * waiting on a rationed adsbdb lookup. adsb.lol has both fields in the
 * payload; dropping them here was throwing away the answer we were paying to
 * fetch. The client reads by index and never checks the length, so appending
 * is backward-compatible with any consumer that only knows the 18 entries.
 * @param {object} aircraft adsb.lol aircraft record.
 * @param {number} nowSeconds Feed response time in epoch seconds.
 * @returns {Array|null} OpenSky-compatible state vector, or null when invalid.
 */
export function normalizeAdsbLolAircraftState(aircraft, nowSeconds) {
  const hex = String(aircraft?.hex || '').trim().toLowerCase();
  const latitude = finiteNumber(aircraft?.lat);
  const longitude = finiteNumber(aircraft?.lon);
  if (!hex || latitude === null || longitude === null) return null;

  const seenPosition = Math.max(0, finiteNumber(aircraft?.seen_pos) ?? finiteNumber(aircraft?.seen) ?? 0);
  const seen = Math.max(0, finiteNumber(aircraft?.seen) ?? seenPosition);
  const onGround = aircraft?.alt_baro === 'ground';
  const barometricFeet = onGround ? null : finiteNumber(aircraft?.alt_baro);
  const geometricFeet = finiteNumber(aircraft?.alt_geom);
  const groundSpeedKnots = finiteNumber(aircraft?.gs);
  const verticalRateFpm = finiteNumber(aircraft?.baro_rate) ?? finiteNumber(aircraft?.geom_rate);
  const track = finiteNumber(aircraft?.track);

  return [
    hex,
    // Callsign ONLY. The tail used to stand in here when `flight` was blank,
    // which published a registration as a spoken callsign (analyst queries and
    // the label chain both read this field). It now travels at [19], and
    // `_contactLabel`'s callsign -> registration -> hex chain does the
    // fallback where it belongs.
    cleanText(aircraft?.flight),
    null,
    Math.max(0, nowSeconds - seenPosition),
    Math.max(0, nowSeconds - seen),
    longitude,
    latitude,
    barometricFeet === null ? null : barometricFeet * FOOT_TO_M,
    onGround,
    groundSpeedKnots === null ? null : groundSpeedKnots * KNOT_TO_MPS,
    track,
    verticalRateFpm === null ? null : verticalRateFpm * FPM_TO_MPS,
    null,
    geometricFeet === null ? null : geometricFeet * FOOT_TO_M,
    aircraft?.squawk || null,
    aircraft?.spi === 1,
    0,
    emitterCategory(aircraft?.category),
    // [18] ICAO type designator, [19] registration — the GEV extension.
    cleanText(aircraft?.t),
    cleanText(aircraft?.r),
  ];
}

/**
 * Normalize an adsb.lol point response to an OpenSky-compatible response.
 * Invalid rows and positionless contacts are intentionally excluded.
 * @param {object} payload adsb.lol v2 response.
 * @returns {{time:number,states:Array[]}}
 */
export function normalizeAdsbLolPointResponse(payload) {
  const responseNow = finiteNumber(payload?.now);
  const nowSeconds = responseNow === null
    ? Math.floor(Date.now() / 1000)
    : Math.floor(responseNow > 10_000_000_000 ? responseNow / 1000 : responseNow);
  const states = (Array.isArray(payload?.ac) ? payload.ac : [])
    .map((aircraft) => normalizeAdsbLolAircraftState(aircraft, nowSeconds))
    .filter(Boolean);
  return { time: nowSeconds, states };
}
