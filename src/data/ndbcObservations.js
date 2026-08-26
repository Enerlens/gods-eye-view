/**
 * Parser for the NOAA NDBC "latest observations" fixed-column report.
 *
 * Upstream: https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt
 * One whitespace-separated row per reporting station, two `#` header lines:
 *
 *   #STN       LAT      LON  YYYY MM DD hh mm WDIR WSPD   GST WVHT  DPD APD MWD   PRES  PTDY  ATMP  WTMP  DEWP  VIS   TIDE
 *   #text      deg      deg   yr mo day hr mn degT  m/s   m/s   m   sec sec degT   hPa   hPa  degC  degC  degC  nmi     ft
 *   41001   34.700  -72.700 2026 08 26 19 50  210  7.2   9.3  1.5   8   5.9 195 1017.1  -1.8  26.1  27.4  22.0   MM     MM
 *
 * TWO PARSING TRAPS THIS FORMAT SETS
 * ----------------------------------
 * 1. `MM` is BOTH a column name (month, index 4) and the missing-value
 *    sentinel used in every measurement column. Parsing by header name would
 *    make "month" collide with "missing"; this parser is strictly POSITIONAL
 *    and treats the header only as a shape check.
 * 2. `mm` (minutes, index 7) and `MM` (month, index 4) differ only by case.
 *    Any case-insensitive column lookup silently swaps them.
 *
 * FIELD COVERAGE IS SPARSE, AND THAT IS THE POINT
 * -----------------------------------------------
 * Measured over the full 892-station report on 2026-08-26, the marine fields
 * a viewer actually cares about are mostly absent:
 *
 *   wind direction  638/892 (72%)     wave height     189/892 (21%)
 *   wind speed      667/892 (75%)     dominant period 147/892 (16%)
 *   pressure        629/892 (71%)     wave direction  171/892 (19%)
 *   sea temp        512/892 (57%)     visibility       44/892  (5%)
 *
 * Only 533 of 892 stations report wave height OR sea temperature at all. A
 * missing field is therefore `null` — never 0, never "unknown" — so the layer
 * above can distinguish "this buoy has no wave sensor" from "the sea is flat".
 */

/** Column positions. Positional by necessity — see trap 1 in the header. */
const COL = Object.freeze({
  station: 0,
  lat: 1,
  lon: 2,
  year: 3,
  month: 4,
  day: 5,
  hour: 6,
  minute: 7,
  windDirDeg: 8,
  windSpeedMs: 9,
  gustMs: 10,
  waveHeightM: 11,
  dominantPeriodS: 12,
  averagePeriodS: 13,
  waveDirDeg: 14,
  pressureHpa: 15,
  pressureTendencyHpa: 16,
  airTempC: 17,
  seaTempC: 18,
  dewPointC: 19,
  visibilityNmi: 20,
  tideFt: 21,
});

export const NDBC_FIELD_COUNT = 22;

/**
 * Physical plausibility bounds. These reject transcription noise, not unusual
 * weather: each ceiling sits well above any value the network has recorded.
 * A value outside its bound becomes null rather than poisoning a rendered
 * readout — the alternative is a buoy claiming a 900 m sea.
 */
const BOUNDS = Object.freeze({
  windDirDeg: [0, 360],
  windSpeedMs: [0, 120],
  gustMs: [0, 150],
  waveHeightM: [0, 40],
  dominantPeriodS: [0, 40],
  averagePeriodS: [0, 40],
  waveDirDeg: [0, 360],
  pressureHpa: [800, 1100],
  pressureTendencyHpa: [-50, 50],
  airTempC: [-90, 60],
  seaTempC: [-5, 40],
  dewPointC: [-90, 60],
  visibilityNmi: [0, 100],
  tideFt: [-30, 30],
});

/**
 * Parse one measurement cell.
 * @param {string} raw Cell text.
 * @param {[number, number]} bounds Inclusive plausibility range.
 * @returns {number|null} The value, or null when missing or implausible.
 */
function measurement(raw, bounds) {
  const text = String(raw ?? '').trim();
  // 'MM' is the documented sentinel; the others show up in partial reports.
  if (!text || text === 'MM' || text === 'M' || text === '-') return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  const [min, max] = bounds;
  if (value < min || value > max) return null;
  return value;
}

/**
 * Build the observation timestamp in epoch ms.
 * NDBC stamps are UTC; `Date.UTC` avoids the local-timezone shift that
 * `new Date(y, m, d)` would silently apply.
 * @returns {number|null} Epoch ms, or null when the stamp is unparseable.
 */
function observedAt(fields) {
  const year = Number(fields[COL.year]);
  const month = Number(fields[COL.month]);
  const day = Number(fields[COL.day]);
  const hour = Number(fields[COL.hour]);
  const minute = Number(fields[COL.minute]);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  if (year < 1970 || year > 2200) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const ms = Date.UTC(year, month - 1, day, hour, minute);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Parse one data row into a station observation.
 * @param {string} line Raw report line.
 * @returns {object|null} Observation, or null when the row is unusable.
 */
export function parseNdbcRow(line) {
  const fields = String(line ?? '').trim().split(/\s+/);
  if (fields.length !== NDBC_FIELD_COUNT) return null;

  const station = String(fields[COL.station] ?? '').trim().toUpperCase();
  // Station ids are short alphanumerics (e.g. "41001", "TPLM2"). Anything else
  // is a malformed row, not a station.
  if (!/^[A-Z0-9]{3,10}$/.test(station)) return null;

  const lat = Number(fields[COL.lat]);
  const lon = Number(fields[COL.lon]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const at = observedAt(fields);
  if (at === null) return null;

  return {
    station,
    lat,
    lon,
    observedAt: at,
    windDirDeg: measurement(fields[COL.windDirDeg], BOUNDS.windDirDeg),
    windSpeedMs: measurement(fields[COL.windSpeedMs], BOUNDS.windSpeedMs),
    gustMs: measurement(fields[COL.gustMs], BOUNDS.gustMs),
    waveHeightM: measurement(fields[COL.waveHeightM], BOUNDS.waveHeightM),
    dominantPeriodS: measurement(fields[COL.dominantPeriodS], BOUNDS.dominantPeriodS),
    averagePeriodS: measurement(fields[COL.averagePeriodS], BOUNDS.averagePeriodS),
    waveDirDeg: measurement(fields[COL.waveDirDeg], BOUNDS.waveDirDeg),
    pressureHpa: measurement(fields[COL.pressureHpa], BOUNDS.pressureHpa),
    pressureTendencyHpa: measurement(fields[COL.pressureTendencyHpa], BOUNDS.pressureTendencyHpa),
    airTempC: measurement(fields[COL.airTempC], BOUNDS.airTempC),
    seaTempC: measurement(fields[COL.seaTempC], BOUNDS.seaTempC),
    dewPointC: measurement(fields[COL.dewPointC], BOUNDS.dewPointC),
    visibilityNmi: measurement(fields[COL.visibilityNmi], BOUNDS.visibilityNmi),
    tideFt: measurement(fields[COL.tideFt], BOUNDS.tideFt),
  };
}

/**
 * Parse the full NDBC latest-observations report.
 *
 * Returns `null` — not `[]` — when the body is not an NDBC report at all
 * (an HTML error page, an outage notice, an empty body). The caller needs to
 * tell "upstream served junk" apart from "upstream served zero stations", so
 * that a broken feed can never be cached as a legitimately empty ocean.
 *
 * @param {string} text Raw response body.
 * @returns {Array<object>|null} Observations, or null when the body is not a report.
 */
export function parseNdbcLatestObservations(text) {
  const body = String(text ?? '');
  if (!body.trim()) return null;

  const lines = body.split('\n');
  // The report always leads with the '#STN' header. Requiring it is what makes
  // an HTML error page fail fast instead of parsing to an empty station list.
  const header = lines.find((line) => line.trim().startsWith('#'));
  if (!header || !/^#\s*STN\b/i.test(header.trim())) return null;

  const observations = [];
  const seen = new Set();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const observation = parseNdbcRow(trimmed);
    if (!observation) continue;
    // Duplicate station ids would render two buoys on one spot and double the
    // reported count. First row wins: the report is ordered, not ranked.
    if (seen.has(observation.station)) continue;
    seen.add(observation.station);
    observations.push(observation);
  }

  return observations;
}

/**
 * Drop observations older than `maxAgeMs` relative to `now`.
 * Future-stamped rows are dropped too: a stamp ahead of the clock is a source
 * or clock fault, and rendering it as "fresh" would be the wrong reading.
 * @param {Array<object>} observations Parsed observations.
 * @param {number} now Epoch ms.
 * @param {number} [maxAgeMs] Retention window.
 * @returns {Array<object>} Retained observations.
 */
export function filterFreshObservations(observations, now, maxAgeMs = 12 * 3600_000) {
  if (!Array.isArray(observations)) return [];
  const cutoff = now - maxAgeMs;
  // One hour of tolerance absorbs ordinary clock skew without accepting a
  // report stamped days into the future.
  const ceiling = now + 3600_000;
  return observations.filter((o) => (
    Number.isFinite(o?.observedAt) && o.observedAt >= cutoff && o.observedAt <= ceiling
  ));
}

/**
 * Count how many observations carry each marine measurement.
 * The layer surfaces this so a sparse report reads as sparse rather than
 * silently rendering 892 buoys with nothing under most of them.
 * @param {Array<object>} observations Parsed observations.
 * @returns {{stations:number, waveHeight:number, seaTemp:number, wind:number, marine:number}}
 */
export function summarizeObservations(observations) {
  const rows = Array.isArray(observations) ? observations : [];
  let waveHeight = 0;
  let seaTemp = 0;
  let wind = 0;
  let marine = 0;
  for (const row of rows) {
    const hasWave = row?.waveHeightM !== null && row?.waveHeightM !== undefined;
    const hasSea = row?.seaTempC !== null && row?.seaTempC !== undefined;
    if (hasWave) waveHeight += 1;
    if (hasSea) seaTemp += 1;
    if (row?.windSpeedMs !== null && row?.windSpeedMs !== undefined) wind += 1;
    if (hasWave || hasSea) marine += 1;
  }
  return { stations: rows.length, waveHeight, seaTemp, wind, marine };
}
