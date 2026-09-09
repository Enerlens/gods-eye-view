/*
 * How a ROW becomes a POINT — the one thing every tabular open-data file
 * answers differently.
 *
 * The same fact — where a thing is — is published as two `longitude` /
 * `latitude` columns, as one `coordonneesXY` cell holding a JSON array, as an
 * Opendatasoft `geo_point_2d` cell holding "lat, lon", as a WKT `POINT (x y)`,
 * as Lambert-93 metres in `x` / `y`, or as an embedded GeoJSON geometry. This
 * module reads all six, guesses which one a header uses when a manifest does
 * not say, and turns a row into one GeoJSON Feature the local loader can draw.
 *
 * Guesses are made on NAMES first and VALUES second, and a guess is reported
 * as a guess: `detectGeometry()` returns the spec it would use plus a short
 * reason, and the plug panel prints that reason next to the choice so the
 * reader can overrule it before anything is drawn (A1: a guessed position is
 * never the same sign as a published one).
 *
 * @module data/datasetGeometry
 */

import { lambert93ToWgs84 } from '../../scripts/lib/lambert93.mjs';

/** Column names, lower-cased and accent-stripped, that carry a longitude. */
export const LON_COLUMN_NAMES = Object.freeze([
  'longitude', 'lon', 'lng', 'long', 'x_wgs84', 'xlong', 'x_long', 'consolidated_longitude',
  'longitude_wgs84', 'lon_wgs84', 'x_longitude', 'geo_lon', 'wgs84_lon', 'lon_deg',
]);
/** Column names that carry a latitude. */
export const LAT_COLUMN_NAMES = Object.freeze([
  'latitude', 'lat', 'y_wgs84', 'ylat', 'y_lat', 'consolidated_latitude',
  'latitude_wgs84', 'lat_wgs84', 'y_latitude', 'geo_lat', 'wgs84_lat', 'lat_deg',
]);
/** Columns that hold one point in one cell (JSON array, "lat, lon", or an object). */
export const POINT_COLUMN_NAMES = Object.freeze([
  'coordonneesxy', 'coordonnees', 'coordinates', 'geo_point_2d', 'geopoint', 'geo_point',
  'point', 'position', 'localisation', 'coord', 'coords', 'xy', 'geoloc', 'geolocalisation',
]);
/** Columns that hold a WKT geometry. */
export const WKT_COLUMN_NAMES = Object.freeze(['wkt', 'geom', 'geometry', 'the_geom', 'geometrie', 'geo_shape']);
/** Lambert-93 metre columns, by name. */
export const L93_X_COLUMN_NAMES = Object.freeze(['x_l93', 'xl93', 'x_lambert93', 'x_lamb93', 'xlamb93', 'x_2154', 'x', 'coord_x', 'x_coord']);
export const L93_Y_COLUMN_NAMES = Object.freeze(['y_l93', 'yl93', 'y_lambert93', 'y_lamb93', 'ylamb93', 'y_2154', 'y', 'coord_y', 'y_coord']);

/** Lambert-93 metres for metropolitan France — the same box `lambert93.mjs` validates. */
const L93_X_RANGE = Object.freeze([100000, 1300000]);
const L93_Y_RANGE = Object.freeze([6000000, 7200000]);

/** Normalize a column name for matching: lower case, no accents, `_` for separators. */
export function normalizeColumnName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\s.-]+/g, '_');
}

function findColumn(header, candidates) {
  const normalized = header.map((name) => [name, normalizeColumnName(name)]);
  for (const candidate of candidates) {
    const hit = normalized.find(([, key]) => key === candidate);
    if (hit) return hit[0];
  }
  return null;
}

export function isFiniteLon(value) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

export function isFiniteLat(value) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

/**
 * Parse a number the way French files write them: "48,86" is 48.86, and a
 * thin space or a plain space is a thousands separator.
 * @param {unknown} value
 * @returns {number}
 */
export function parseDecimal(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;
  const text = value.trim().replace(/[\s  ]/g, '');
  if (!text) return Number.NaN;
  // One comma and no dot: a French decimal comma. Anything else is left alone.
  if (text.includes(',') && !text.includes('.')) return Number(text.replace(',', '.'));
  return Number(text);
}

/**
 * Read `POINT (x y)` — with or without a Z, with or without a space after the
 * word, in any case. Other WKT types return null: a polygon in a cell is a
 * shape this module does not draw from a table.
 * @param {unknown} text
 * @returns {[number, number]|null} `[lon, lat]`
 */
export function parseWktPoint(text) {
  if (typeof text !== 'string') return null;
  const match = /^\s*(?:SRID=\d+;)?POINT\s*(?:Z|M|ZM)?\s*\(\s*([-+0-9.eE]+)\s+([-+0-9.eE]+)(?:\s+[-+0-9.eE]+)*\s*\)\s*$/i.exec(text);
  if (!match) return null;
  const lon = Number(match[1]);
  const lat = Number(match[2]);
  return isFiniteLon(lon) && isFiniteLat(lat) ? [lon, lat] : null;
}

/**
 * Read one cell holding a point, in the three shapes the platforms use:
 *
 *   `[2.36, 48.87]` / `"[2.36, 48.87]"`   JSON array — GeoJSON order, lon first
 *                                         (data.gouv.fr's `coordonneesXY`)
 *   `"48.87, 2.36"`                        Opendatasoft `geo_point_2d` — LAT first
 *   `{lon: 2.36, lat: 48.87}`              an object, keys named
 *
 * The two bare-number shapes are told apart by their SYNTAX (brackets or not),
 * never by magnitude: a point in the Channel has both numbers under 51 and a
 * magnitude rule would flip it.
 * @param {unknown} value
 * @returns {[number, number]|null} `[lon, lat]`
 */
export function parsePointCell(value) {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const lon = parseDecimal(value[0]);
    const lat = parseDecimal(value[1]);
    return isFiniteLon(lon) && isFiniteLat(lat) ? [lon, lat] : null;
  }
  if (typeof value === 'object') {
    const lon = parseDecimal(value.lon ?? value.lng ?? value.longitude ?? value.x);
    const lat = parseDecimal(value.lat ?? value.latitude ?? value.y);
    return isFiniteLon(lon) && isFiniteLat(lat) ? [lon, lat] : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (text.startsWith('[') || text.startsWith('{')) {
    try { return parsePointCell(JSON.parse(text)); } catch { return null; }
  }
  const wkt = parseWktPoint(text);
  if (wkt) return wkt;
  const parts = text.split(/[,;]\s*|\s+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const lat = parseDecimal(parts[0]);
  const lon = parseDecimal(parts[1]);
  return isFiniteLon(lon) && isFiniteLat(lat) ? [lon, lat] : null;
}

function sampleLooksLambert(rows, xField, yField) {
  let seen = 0;
  for (const row of rows) {
    const x = parseDecimal(row?.[xField]);
    const y = parseDecimal(row?.[yField]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    seen += 1;
    if (x < L93_X_RANGE[0] || x > L93_X_RANGE[1] || y < L93_Y_RANGE[0] || y > L93_Y_RANGE[1]) return false;
  }
  return seen > 0;
}

function sampleLooksDegrees(rows, lonField, latField) {
  let seen = 0;
  for (const row of rows) {
    const lon = parseDecimal(row?.[lonField]);
    const lat = parseDecimal(row?.[latField]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    seen += 1;
    if (!isFiniteLon(lon) || !isFiniteLat(lat)) return false;
  }
  return seen > 0;
}

/**
 * Guess how a header locates its rows.
 *
 * Order of trust: named lon/lat pairs, then a single point cell, then a WKT
 * cell, then bare `x`/`y` — which are only accepted as Lambert-93 when the
 * sample VALUES fall in the metropolitan metre box, and as degrees when they
 * fall in the degree box. A header that names nothing returns null: the
 * reader picks by hand, the app never draws a guess it cannot defend.
 *
 * @param {string[]} header
 * @param {object[]} [sampleRows] A few rows, for the value checks.
 * @returns {{geometry: object, reason: string}|null}
 */
export function detectGeometry(header, sampleRows = []) {
  const columns = Array.isArray(header) ? header : [];
  const lon = findColumn(columns, LON_COLUMN_NAMES);
  const lat = findColumn(columns, LAT_COLUMN_NAMES);
  if (lon && lat && (sampleRows.length === 0 || sampleLooksDegrees(sampleRows, lon, lat))) {
    return { geometry: { lon, lat }, reason: `colonnes ${lon} / ${lat}` };
  }
  const point = findColumn(columns, POINT_COLUMN_NAMES);
  if (point && (sampleRows.length === 0 || sampleRows.some((row) => parsePointCell(row?.[point])))) {
    return { geometry: { point }, reason: `colonne ${point} (un point par cellule)` };
  }
  const wkt = findColumn(columns, WKT_COLUMN_NAMES);
  if (wkt && (sampleRows.length === 0 || sampleRows.some((row) => parseWktPoint(row?.[wkt])))) {
    return { geometry: { wkt }, reason: `colonne ${wkt} (WKT POINT)` };
  }
  const x = findColumn(columns, L93_X_COLUMN_NAMES);
  const y = findColumn(columns, L93_Y_COLUMN_NAMES);
  if (x && y && sampleRows.length) {
    if (sampleLooksLambert(sampleRows, x, y)) {
      return { geometry: { x, y, crs: 'EPSG:2154' }, reason: `colonnes ${x} / ${y} en mètres Lambert-93 (valeurs dans la boîte métropolitaine)` };
    }
    if (sampleLooksDegrees(sampleRows, x, y)) {
      return { geometry: { lon: x, lat: y }, reason: `colonnes ${x} / ${y} en degrés` };
    }
  }
  // Last resort, by RESEMBLANCE: exactly one column whose name carries "lat"
  // and exactly one carrying "lon"/"lng"/"long" as a word — GeoDAE's
  // `c_lat_coor1` / `c_long_coor1`, for one. Accepted only when the sample
  // values read as degrees, and the reason says it was a resemblance.
  const latLike = columns.filter((name) => /(^|_)lat(itude)?(_|$)/.test(normalizeColumnName(name)));
  const lonLike = columns.filter((name) => /(^|_)(lon|lng|long)(gitude|itude)?(_|$)/.test(normalizeColumnName(name)));
  if (latLike.length === 1 && lonLike.length === 1 && sampleRows.length
    && sampleLooksDegrees(sampleRows, lonLike[0], latLike[0])) {
    return { geometry: { lon: lonLike[0], lat: latLike[0] }, reason: `colonnes ${lonLike[0]} / ${latLike[0]} (par ressemblance de nom, valeurs en degrés)` };
  }
  return null;
}

/**
 * Locate one row under a normalized geometry spec (`datasetManifest.js`).
 * @param {object} row
 * @param {object} geometry Normalized `manifest.geometry`.
 * @returns {[number, number]|null} `[lon, lat]`, or null when the row has no usable position.
 */
export function rowPosition(row, geometry) {
  if (!row || !geometry) return null;
  switch (geometry.shape) {
    case 'lonlat': {
      const lon = parseDecimal(row[geometry.lon]);
      const lat = parseDecimal(row[geometry.lat]);
      return isFiniteLon(lon) && isFiniteLat(lat) ? [lon, lat] : null;
    }
    case 'point':
      return parsePointCell(row[geometry.point]);
    case 'wkt':
      return parseWktPoint(row[geometry.wkt]) || parsePointCell(row[geometry.wkt]);
    case 'projected': {
      const x = parseDecimal(row[geometry.x]);
      const y = parseDecimal(row[geometry.y]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      if (geometry.crs === 'EPSG:4326') return isFiniteLon(x) && isFiniteLat(y) ? [x, y] : null;
      const converted = lambert93ToWgs84(x, y);
      return converted && isFiniteLon(converted.lon) && isFiniteLat(converted.lat)
        ? [converted.lon, converted.lat]
        : null;
    }
    case 'geojson': {
      const raw = row[geometry.geojson];
      let value = raw;
      if (typeof raw === 'string') {
        try { value = JSON.parse(raw); } catch { return null; }
      }
      const coordinates = value?.type === 'Point' ? value.coordinates : null;
      return parsePointCell(coordinates);
    }
    default:
      return null;
  }
}

/**
 * The embedded GeoJSON geometry of a row, when the spec says the cell holds one
 * and it is not a point — a polygon or a line the loader can draw as such.
 * @param {object} row
 * @param {object} geometry
 * @returns {object|null}
 */
export function rowGeoJsonGeometry(row, geometry) {
  if (!row || geometry?.shape !== 'geojson') return null;
  const raw = row[geometry.geojson];
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { return null; }
  }
  if (!value || typeof value !== 'object' || typeof value.type !== 'string' || !Array.isArray(value.coordinates)) return null;
  return value;
}

/** Fields tried, in order, when a manifest names no title. */
export const DEFAULT_TITLE_FIELDS = Object.freeze([
  'name', 'nom', 'nom_station', 'libelle', 'label', 'title', 'titre', 'intitule', 'appellation',
  'designation', 'denomination', 'nom_commune', 'commune', 'adresse', 'address', 'id',
]);

function cleanCell(value) {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : String(value);
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The title of a row: the first non-empty of the manifest's `feature.title`
 * fields, then of the defaults (matched on normalized names), then nothing.
 * @param {object} row
 * @param {ReadonlyArray<string>|null} titleFields
 * @returns {string}
 */
export function rowTitle(row, titleFields = null) {
  if (!row) return '';
  const fields = titleFields && titleFields.length ? titleFields : [];
  for (const field of fields) {
    const text = cleanCell(row[field]);
    if (text) return text;
  }
  if (fields.length) return '';
  const byKey = new Map(Object.keys(row).map((key) => [normalizeColumnName(key), key]));
  for (const candidate of DEFAULT_TITLE_FIELDS) {
    const key = byKey.get(candidate);
    if (key === undefined) continue;
    const text = cleanCell(row[key]);
    if (text) return text;
  }
  return '';
}

/**
 * One row → one Feature. Null when the row has no position.
 *
 * The title is written into `properties.name` because the local loader's label
 * ladder, priority scoring and card title all read that field first; the raw
 * row stays intact beside it under its own column names.
 * @param {object} row
 * @param {object} manifest Normalized manifest.
 * @param {number|string} index Fallback id.
 * @returns {object|null}
 */
export function rowToFeature(row, manifest, index) {
  const geometry = manifest.geometry;
  let geom = null;
  const shape = rowGeoJsonGeometry(row, geometry);
  if (shape && shape.type !== 'Point') {
    geom = shape;
  } else {
    const position = rowPosition(row, geometry);
    if (!position) return null;
    geom = { type: 'Point', coordinates: position };
  }
  const title = rowTitle(row, manifest.feature?.title);
  const properties = { ...row };
  if (title) properties.name = title;
  return {
    type: 'Feature',
    id: `${manifest.id}:${index}`,
    geometry: geom,
    properties,
  };
}
