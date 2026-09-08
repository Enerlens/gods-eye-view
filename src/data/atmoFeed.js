/**
 * @module data/atmoFeed
 *
 * The **indice ATMO** — the air a reader will breathe at this address today,
 * tomorrow and the day after, from the federation of the regional AASQA.
 *
 * Cityscan sells air quality as a static score inside its *Nuisances* theme.
 * This is the same underlying index, read live: `data.atmo-france.org` runs a
 * GeoServer WFS over `ind_atmo_2021`, keyless, ODbL, republished every day
 * before noon by seventeen regional agencies at once.
 *
 * ── What one answer holds ───────────────────────────────────────────────────
 * `code_qual` 1 to 6 on the 2021 European scale, its French label, its
 * official colour, and the five sub-indices the overall figure is the MAXIMUM
 * of — NO₂, O₃, PM10, PM2.5, SO₂. Publishing the sub-indices matters more than
 * it looks: an index of 4 driven by ozone in July and one driven by PM2.5 in
 * January are the same number about two different problems, and only the
 * second is about the street.
 *
 * ── Coverage, measured on 2026-09-08 for that day's échéance ────────────────
 * 29 131 rows, **28 717 distinct `code_zone`**, of which 28 811 rows declare a
 * commune and 320 an EPCI. France has 34 900 communes, so **roughly one in six
 * has no index published for it at all** — and the gap is not random: it is
 * whole régions whose agency publishes at intercommunal level instead.
 * Atmo-Occitanie published 164 rows that day, Air Breizh 61, Air Pays de la
 * Loire 434, against Atmo Grand Est's 5 115.
 *
 * That is why a lookup by commune code is only the first attempt, and why the
 * fallback answers with the zone's own name, type and distance rather than
 * pretending the number was published for the address.
 *
 * ── Trap 1: `type_zone` has three spellings and `lib_qual` two ──────────────
 * Measured across the seventeen publishers on one day: `commune` (14 732
 * rows), `COMMUNE` (5 268, Lig'Air), `Commune` (Atmo Guyane), plus `EPCI`.
 * `lib_qual` arrives as both `Moyen` and `moyen`, and `coul_qual` as both
 * `#F0E641` and `#f0e641`. A filter written against one casing silently drops
 * a whole région: `type_zone='commune'` alone loses every Lig'Air row, which
 * is the Centre-Val de Loire.
 *
 * Nothing here trusts the published label or colour anyway. `code_qual` is the
 * only field read for the verdict, and the label and colour come from
 * {@link ATMO_SCALE}, so two régions cannot render the same number differently.
 *
 * ── Trap 2: `code_zone` is NOT a key ────────────────────────────────────────
 * Atmo Guyane publishes **six different communes under one `code_zone`** —
 * 249730045, which is the SIREN of the Communauté d'agglomération du Centre
 * Littoral — while declaring `type_zone = 'Commune'`. Cayenne, Macouria,
 * Roura, Rémire-Montjoly, Montsinéry-Tonnegrande and Matoury all arrive as
 * that code, each with its own `lib_zone` and its own position. 383 zone codes
 * were duplicated on the day measured.
 *
 * So the pick is by POSITION when a code is ambiguous, and a commune-typed row
 * whose code is a nine-digit SIREN is treated as the intercommunal answer it
 * really is.
 *
 * ── Trap 3: `x_wgs84` and `y_wgs84` are not always WGS84 ────────────────────
 * The columns are named for a CRS they do not always hold. Cayenne publishes
 * `x_wgs84 = 354028.19`, `y_wgs84 = 545498.84` — UTM metres — while its
 * `epsg_reg` column says `4326`, which is the opposite of the truth. The
 * GeoJSON `geometry` is uniformly EPSG:3857 across all seventeen publishers
 * and reprojects to −52.31654, 4.93387, which is Cayenne. **The geometry is
 * the only position this module reads.**
 *
 * ── Trap 4: the forecast horizon differs by publisher ───────────────────────
 * On the day measured, Lyon and Nantes published J, J+1 and J+2; Paris
 * published J and J+1 only. A card that assumed three days would show an empty
 * third column for Airparif and read as a data failure.
 *
 * Dependency-free and side-effect-free: URL construction, reprojection and
 * projection only. The `/api/atmo-fr` proxy imports it.
 */

/** Attribution carried on every payload (see DATA_SOURCES.md). */
export const ATMO_SOURCE = 'Indice ATMO — Atmo France et les AASQA régionales';
export const ATMO_LICENCE = 'ODbL 1.0';

/** The WFS the federation publishes. Keyless. */
export const ATMO_WFS = 'https://data.atmo-france.org/geoserver/ind/ows';
/** The layer holding the daily index on the 2021 scale. */
export const ATMO_TYPENAME = 'ind_atmo_2021';

/**
 * The 2021 scale, as the regulation defines it.
 *
 * Held here rather than read from `lib_qual` and `coul_qual` so that the
 * seventeen publishers cannot disagree about how one number is drawn — they
 * already disagree about its capitalisation.
 */
export const ATMO_SCALE = Object.freeze([
  Object.freeze({ code: 1, label: 'Bon', colour: '#50F0E6' }),
  Object.freeze({ code: 2, label: 'Moyen', colour: '#50CCAA' }),
  Object.freeze({ code: 3, label: 'Dégradé', colour: '#F0E641' }),
  Object.freeze({ code: 4, label: 'Mauvais', colour: '#FF5050' }),
  Object.freeze({ code: 5, label: 'Très mauvais', colour: '#960032' }),
  Object.freeze({ code: 6, label: 'Extrêmement mauvais', colour: '#7D2181' }),
]);

/** The five sub-indices the overall figure is the maximum of. */
export const ATMO_POLLUTANTS = Object.freeze([
  Object.freeze({ key: 'no2', column: 'code_no2', label: 'dioxyde d’azote' }),
  Object.freeze({ key: 'o3', column: 'code_o3', label: 'ozone' }),
  Object.freeze({ key: 'pm10', column: 'code_pm10', label: 'particules PM10' }),
  Object.freeze({ key: 'pm25', column: 'code_pm25', label: 'particules PM2,5' }),
  Object.freeze({ key: 'so2', column: 'code_so2', label: 'dioxyde de soufre' }),
]);

/** @param {?number} code @returns {?{code: number, label: string, colour: string}} */
export function atmoBand(code) {
  return ATMO_SCALE.find((band) => band.code === code) ?? null;
}

/** Common query parameters for every request to this WFS. */
function atmoQuery(extra) {
  return new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: ATMO_TYPENAME,
    outputFormat: 'application/json',
    ...extra,
  }).toString();
}

/**
 * The URL that asks for one zone code, every échéance it publishes.
 *
 * The code is quoted into a CQL literal, so it is validated first: this is the
 * one place a caller's string reaches a query language.
 *
 * @param {string} code INSEE commune code, or an EPCI SIREN.
 * @returns {?string}
 */
export function buildAtmoZoneUrl(code) {
  const raw = String(code ?? '').trim().toUpperCase();
  if (!/^[0-9A-Z]{5,9}$/.test(raw)) return null;
  return `${ATMO_WFS}?${atmoQuery({ CQL_FILTER: `code_zone='${raw}'`, count: '12' })}`;
}

/**
 * The URL that asks what is published AROUND a point.
 *
 * The fallback for the one commune in six the federation does not name. The
 * box is small on purpose: at half a degree it already spans two départements,
 * and an index borrowed from 50 km away is not an answer about this address —
 * the payload carries the distance so the card can refuse it.
 *
 * @param {{lat: number, lon: number}} point
 * @param {number} [padDeg]
 * @returns {?string}
 */
export function buildAtmoBoxUrl({ lat, lon }, padDeg = 0.25) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const box = [lon - padDeg, lat - padDeg, lon + padDeg, lat + padDeg]
    .map((value) => value.toFixed(4)).join(',');
  return `${ATMO_WFS}?${atmoQuery({
    CQL_FILTER: `BBOX(the_geom,${box},'EPSG:4326')`,
    count: '200',
  })}`;
}

const WEB_MERCATOR_HALF = 20037508.34;

/**
 * Reproject one EPSG:3857 coordinate pair to degrees.
 *
 * The only position this module trusts. See Trap 3.
 * @param {Array<number>} coordinates
 * @returns {?{lat: number, lon: number}}
 */
export function fromWebMercator(coordinates) {
  const x = Number(coordinates?.[0]);
  const y = Number(coordinates?.[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const lon = (x / WEB_MERCATOR_HALF) * 180;
  const raw = (y / WEB_MERCATOR_HALF) * 180;
  const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((raw * Math.PI) / 180)) - Math.PI / 2);
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
}

/** Great-circle distance in metres. */
function metresBetween(a, b) {
  if (!a || !b) return null;
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(s))));
}

/**
 * Normalise one WFS feature into the shape everything below reads.
 *
 * `type_zone` is lower-cased (Trap 1), and a nine-digit `code_zone` is read as
 * an EPCI SIREN whatever the publisher declared (Trap 2): five characters is a
 * commune, nine digits is an établissement public, and no French commune code
 * is nine characters long.
 *
 * @param {object} feature
 * @returns {?object}
 */
export function normaliseAtmoFeature(feature) {
  const properties = feature?.properties;
  if (!properties) return null;
  const code = String(properties.code_zone ?? '').trim().toUpperCase();
  const quality = Number(properties.code_qual);
  if (!code || !Number.isFinite(quality)) return null;
  const declared = String(properties.type_zone ?? '').trim().toLowerCase();
  const scale = /^\d{9}$/.test(code) ? 'epci' : declared || null;
  const pollutants = {};
  for (const pollutant of ATMO_POLLUTANTS) {
    const value = Number(properties[pollutant.column]);
    pollutants[pollutant.key] = Number.isFinite(value) ? value : null;
  }
  return {
    code,
    scale,
    declaredScale: declared || null,
    name: properties.lib_zone ? String(properties.lib_zone) : null,
    date: properties.date_ech ? String(properties.date_ech).slice(0, 10) : null,
    publishedAt: properties.date_dif ? String(properties.date_dif) : null,
    updatedAt: properties.date_maj ? String(properties.date_maj) : null,
    agency: properties.source ? String(properties.source) : null,
    quality,
    pollutants,
    position: fromWebMercator(feature.geometry?.coordinates),
  };
}

/** The pollutants whose sub-index equals the overall figure. */
export function drivingPollutants(record) {
  const worst = record?.quality;
  if (!Number.isFinite(worst)) return [];
  return ATMO_POLLUTANTS
    .filter((pollutant) => record.pollutants?.[pollutant.key] === worst)
    .map((pollutant) => pollutant.label);
}

/**
 * Choose the row that actually describes a point, among everything returned.
 *
 * Order of preference, and every step of it exists because of a measured case:
 *   1. a row whose scale is `commune`, over an intercommunal one covering it —
 *      Nantes and Nantes Métropole are published at the SAME coordinate, and
 *      the commune is the finer statement;
 *   2. among equals, the nearest by reprojected geometry — six Guyanese
 *      communes share one `code_zone`, so the code cannot break the tie;
 *   3. among equals again, the most recently updated.
 *
 * @param {Array<object>} records Normalised rows for one échéance.
 * @param {?{lat: number, lon: number}} point
 * @returns {?object}
 */
export function pickAtmoZone(records, point = null) {
  const usable = (records || []).filter(Boolean);
  if (!usable.length) return null;
  const scored = usable.map((record) => ({
    record,
    commune: record.scale === 'commune' ? 0 : 1,
    distance: point && record.position ? metresBetween(point, record.position) : null,
  }));
  scored.sort((a, b) => {
    if (a.commune !== b.commune) return a.commune - b.commune;
    const da = a.distance ?? Number.POSITIVE_INFINITY;
    const db = b.distance ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return String(b.record.updatedAt ?? '').localeCompare(String(a.record.updatedAt ?? ''));
  });
  const best = scored[0];
  return { ...best.record, distanceM: best.distance };
}

/**
 * Project a WFS answer into one payload: today, then the forecast days.
 *
 * @param {object} options
 * @param {object} options.collection The GeoJSON FeatureCollection.
 * @param {?{lat: number, lon: number}} [options.point] The address scanned.
 * @param {string} [options.today] `YYYY-MM-DD`; injected in tests.
 * @param {boolean} [options.nearby] True when this answer came from the box
 *   query rather than from the commune code — the card must say so.
 * @returns {?object}
 */
export function projectAtmo({ collection, point = null, today = null, nearby = false }) {
  const rows = (collection?.features || []).map(normaliseAtmoFeature).filter(Boolean);
  if (!rows.length) return null;
  const byDate = new Map();
  for (const row of rows) {
    if (!row.date) continue;
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date).push(row);
  }
  const dates = [...byDate.keys()].sort();
  if (!dates.length) return null;
  // The day asked for when it is published, else the earliest on offer. An
  // agency that has not yet run today's model publishes tomorrow first, and
  // answering "no data" for that would be wrong.
  const day = today && byDate.has(today) ? today : dates[0];
  const current = pickAtmoZone(byDate.get(day), point);
  if (!current) return null;

  const forecast = dates
    .filter((date) => date > day)
    .map((date) => {
      // Pinned to the zone the current day resolved to, so a three-day row
      // cannot silently walk from one commune to its neighbour.
      const same = byDate.get(date).filter((row) => row.code === current.code
        && (!row.name || !current.name || row.name === current.name));
      const picked = pickAtmoZone(same.length ? same : byDate.get(date), point);
      return picked ? { date, quality: picked.quality, band: atmoBand(picked.quality) } : null;
    })
    .filter(Boolean);

  return {
    zone: {
      code: current.code,
      name: current.name,
      // `commune` or `epci`, after the nine-digit correction. `declaredScale`
      // keeps what the publisher actually wrote, because the two differ for a
      // whole région and a reader auditing this deserves to see both.
      scale: current.scale,
      declaredScale: current.declaredScale,
      distanceM: current.distanceM ?? null,
    },
    // True when the index describes a neighbouring zone rather than this one.
    borrowed: Boolean(nearby) || current.scale !== 'commune',
    date: day,
    publishedAt: current.publishedAt,
    quality: current.quality,
    band: atmoBand(current.quality),
    pollutants: ATMO_POLLUTANTS.map((pollutant) => ({
      key: pollutant.key,
      label: pollutant.label,
      quality: current.pollutants[pollutant.key],
      band: atmoBand(current.pollutants[pollutant.key]),
    })),
    driving: drivingPollutants(current),
    forecast,
    agency: current.agency,
    source: ATMO_SOURCE,
    licence: ATMO_LICENCE,
  };
}
