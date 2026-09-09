/*
 * SOURCE ADAPTERS — how the dataset box asks a platform for rows.
 *
 * Six kinds, one output: an array of GeoJSON Features the local loader draws,
 * plus what it needs to be honest about them — how many the source HOLDS
 * against how many were taken (A5), and whether the answer was clipped.
 *
 * ── DIRECT FIRST, RELAY SECOND ────────────────────────────────────────────
 *
 * Measured 2026-09-08 from a browser origin: data.gouv.fr (the Tabular API,
 * the metadata API, the `r/<uuid>` redirect and the static file host), the
 * IGN Géoplateforme WFS and the Opendatasoft portals all answer with
 * `access-control-allow-origin: *`. So the browser talks to them directly,
 * and nothing about a plugged dataset touches the server. The relay
 * (`/api/plug`, an allow-listed pass-through with a byte cap) is the fallback
 * for the hosts that refuse an `Origin` header — INSEE is the known one — and
 * a source is only routed through it after a direct attempt failed the way
 * CORS fails (a TypeError with no status, or a 403).
 *
 * ── THE TABULAR API IS THE POINT ─────────────────────────────────────────
 *
 * A data.gouv.fr CSV is read through `tabular-api.data.gouv.fr`, page by page
 * of 200 typed rows, with `<column>__greater` / `__less` filters. That turns
 * "download 161 MB and parse it" into "ask for the 11 633 rows inside this
 * view" — the IRVE file, measured. The raw file is only fetched when the
 * resource was never tabularised, and then under a byte ceiling.
 *
 * @module data/datasetSources
 */

import { parseCsv } from './datasetCsv.js';
import { isFiniteLat, isFiniteLon, rowTitle, rowToFeature } from './datasetGeometry.js';

/** The server-side pass-through, for hosts that refuse a browser origin. */
export const DATASET_RELAY_PATH = '/api/plug';
export const TABULAR_API_BASE = 'https://tabular-api.data.gouv.fr/api/resources';
/** Rows per Tabular API page — its ceiling is 200; 1 000 answers 400. */
export const TABULAR_PAGE_SIZE = 200;
/** Ceiling on a raw file read in the browser, bytes. Above it the answer is the Tabular API or a pack. */
export const DATASET_RAW_MAX_BYTES = 24 * 1024 * 1024;
/** Ceiling on Tabular API round trips per load, so a wide view cannot run for minutes. */
export const TABULAR_MAX_REQUESTS = 150;

/** The permanent URL of a data.gouv.fr resource — redirects to its current file. */
export function datagouvResourceLatestUrl(resourceId) {
  return `https://www.data.gouv.fr/api/1/datasets/r/${encodeURIComponent(resourceId)}`;
}

/** The relay address for one upstream URL. */
export function relayUrl(url, relay = DATASET_RELAY_PATH) {
  return `${relay}?url=${encodeURIComponent(url)}`;
}

/**
 * An error the row of the panel can print: short, French, no stack.
 */
export class DatasetSourceError extends Error {
  constructor(message, { status = null, cause = null } = {}) {
    super(message);
    this.name = 'DatasetSourceError';
    this.status = status;
    if (cause) this.cause = cause;
  }
}

function looksLikeCorsFailure(error, response) {
  if (response) return response.status === 403 || response.status === 0;
  return error instanceof TypeError || /fetch failed|Failed to fetch|NetworkError|Load failed/i.test(String(error?.message || ''));
}

function guardContentLength(response, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new DatasetSourceError(`fichier trop volumineux (${(declared / 1048576).toFixed(0)} Mo, plafond ${(maxBytes / 1048576).toFixed(0)} Mo)`, { status: response.status });
  }
}

/**
 * Fetch text from a URL, directly and then through the relay when the direct
 * attempt fails like CORS does. Never follows a relay in Node (`relay: null`).
 *
 * @param {string} url
 * @param {{fetchImpl?: typeof fetch, relay?: string|null, signal?: AbortSignal, accept?: string, maxBytes?: number, headers?: object}} [options]
 * @returns {Promise<{text: string, via: 'direct'|'relay', status: number, contentType: string}>}
 */
export async function fetchDatasetText(url, {
  fetchImpl = globalThis.fetch,
  relay = DATASET_RELAY_PATH,
  signal = undefined,
  accept = 'application/json, text/csv, text/plain;q=0.9, */*;q=0.5',
  maxBytes = DATASET_RAW_MAX_BYTES,
  headers = {},
} = {}) {
  if (typeof fetchImpl !== 'function') throw new DatasetSourceError('fetch indisponible');
  const request = { signal, headers: { Accept: accept, ...headers } };
  let response = null;
  let failure = null;
  try {
    response = await fetchImpl(url, request);
  } catch (error) {
    if (signal?.aborted) throw error;
    failure = error;
  }
  if (response?.ok) {
    guardContentLength(response, maxBytes);
    const text = await response.text();
    if (text.length > maxBytes) throw new DatasetSourceError('réponse trop volumineuse');
    return { text, via: 'direct', status: response.status, contentType: response.headers?.get?.('content-type') || '' };
  }
  const corsShaped = looksLikeCorsFailure(failure, response);
  if (relay && corsShaped) {
    let relayed;
    try {
      relayed = await fetchImpl(relayUrl(url, relay), { signal, headers: { Accept: accept } });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new DatasetSourceError('source inaccessible (direct et relais)', { cause: error });
    }
    if (!relayed.ok) {
      let detail = '';
      try { detail = (await relayed.json())?.error || ''; } catch { /* not json */ }
      throw new DatasetSourceError(detail ? `relais : ${detail}` : `relais HTTP ${relayed.status}`, { status: relayed.status });
    }
    guardContentLength(relayed, maxBytes);
    const text = await relayed.text();
    if (text.length > maxBytes) throw new DatasetSourceError('réponse trop volumineuse');
    return { text, via: 'relay', status: relayed.status, contentType: relayed.headers?.get?.('content-type') || '' };
  }
  if (response) throw new DatasetSourceError(`HTTP ${response.status}`, { status: response.status });
  throw new DatasetSourceError('source inaccessible', { cause: failure });
}

/** Parse JSON without letting a parser message reach the row. */
function parseJson(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    throw new DatasetSourceError(`${what} : JSON illisible`);
  }
}

/**
 * Whatever a GeoJSON URL answers — a FeatureCollection, a bare Feature, or an
 * array of Features — as an array.
 * @param {unknown} payload
 * @returns {object[]}
 */
export function featuresFromGeoJson(payload) {
  if (Array.isArray(payload)) return payload.filter((item) => item?.type === 'Feature');
  if (payload?.type === 'FeatureCollection' && Array.isArray(payload.features)) return payload.features;
  if (payload?.type === 'Feature') return [payload];
  throw new DatasetSourceError('pas un GeoJSON (FeatureCollection attendue)');
}

function hasDrawableGeometry(feature) {
  const geometry = feature?.geometry;
  return Boolean(geometry) && typeof geometry.type === 'string' && Array.isArray(geometry.coordinates);
}

/**
 * Give a native feature what the loader reads: a stable id and a
 * `properties.name` (the manifest's title fields, then the default ladder).
 * The original id, when present, is kept — a WFS `aerodrome.12` is a better
 * handle than an index.
 */
function decorateFeature(feature, manifest, index) {
  const properties = { ...(feature.properties || {}) };
  if (!properties.name) {
    const title = rowTitle(properties, manifest.feature?.title);
    if (title) properties.name = title;
  }
  return {
    type: 'Feature',
    id: feature.id != null ? `${manifest.id}:${feature.id}` : `${manifest.id}:${index}`,
    geometry: feature.geometry,
    properties,
  };
}

/**
 * A bounding box in degrees, or null. Normalized so a caller can hand over
 * either a Cesium rectangle in radians or a plain object in degrees.
 * @param {object|null} bbox
 * @returns {{west:number, south:number, east:number, north:number}|null}
 */
export function normalizeBbox(bbox) {
  if (!bbox) return null;
  const west = Number(bbox.west);
  const south = Number(bbox.south);
  const east = Number(bbox.east);
  const north = Number(bbox.north);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (!isFiniteLon(west) || !isFiniteLon(east) || !isFiniteLat(south) || !isFiniteLat(north)) return null;
  if (east <= west || north <= south) return null;
  return { west, south, east, north };
}

/**
 * One Tabular API page URL.
 * @param {string} resourceId
 * @param {{page?: number, pageSize?: number, columns?: string[]|null, bbox?: object|null, geometry?: object|null}} [options]
 * @returns {string}
 */
export function tabularDataUrl(resourceId, { page = 1, pageSize = TABULAR_PAGE_SIZE, columns = null, bbox = null, geometry = null } = {}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  if (Array.isArray(columns) && columns.length) params.set('columns', columns.join(','));
  const box = normalizeBbox(bbox);
  if (box && geometry?.shape === 'lonlat') {
    params.set(`${geometry.lon}__greater`, String(box.west));
    params.set(`${geometry.lon}__less`, String(box.east));
    params.set(`${geometry.lat}__greater`, String(box.south));
    params.set(`${geometry.lat}__less`, String(box.north));
  }
  return `${TABULAR_API_BASE}/${encodeURIComponent(resourceId)}/data/?${params.toString()}`;
}

/** The Tabular API profile URL — header, column types, row count. */
export function tabularProfileUrl(resourceId) {
  return `${TABULAR_API_BASE}/${encodeURIComponent(resourceId)}/profile/`;
}

/**
 * The columns worth asking the Tabular API for: the geometry, the title, the
 * details and the group — or nothing (every column) when the manifest names
 * none, because a card with no fields declared shows the row as it is.
 * @param {object} manifest
 * @returns {string[]|null}
 */
export function tabularColumnsFor(manifest) {
  if (Array.isArray(manifest.source.columns) && manifest.source.columns.length) return [...manifest.source.columns];
  const feature = manifest.feature || {};
  const wanted = [];
  const geometry = manifest.geometry;
  if (geometry) {
    for (const field of [geometry.lon, geometry.lat, geometry.point, geometry.wkt, geometry.x, geometry.y, geometry.geojson]) {
      if (field) wanted.push(field);
    }
  }
  const declared = [
    ...(feature.title || []),
    ...((feature.details || []).map((detail) => detail.field)),
    ...(feature.group ? [feature.group.field] : []),
  ];
  if (!declared.length) return null;
  return [...new Set([...wanted, ...declared])];
}

/**
 * A WFS 2.0 GetFeature URL in GeoJSON, WGS84 lon/lat.
 *
 * `CRS:84` and not `EPSG:4326`, deliberately: the short `EPSG:4326` form is
 * read lon/lat by GeoServer's legacy path and lat/lon by the strict one, and
 * the IGN Géoplateforme answered ZERO features to a lat/lon bbox and four to
 * a lon/lat one on the same view (measured 2026-09-08). `CRS:84` is defined
 * as lon/lat everywhere.
 * @param {object} source Normalized `manifest.source`.
 * @param {{bbox?: object|null, count?: number}} [options]
 * @returns {string}
 */
export function wfsGetFeatureUrl(source, { bbox = null, count = source.maxFeatures } = {}) {
  const url = new URL(source.url);
  url.searchParams.set('service', 'WFS');
  url.searchParams.set('version', '2.0.0');
  url.searchParams.set('request', 'GetFeature');
  url.searchParams.set('typeNames', source.typeName);
  url.searchParams.set('outputFormat', 'application/json');
  url.searchParams.set('srsName', 'CRS:84');
  url.searchParams.set('count', String(count));
  const box = normalizeBbox(bbox);
  if (box) url.searchParams.set('bbox', `${box.west},${box.south},${box.east},${box.north},CRS:84`);
  return url.toString();
}

/**
 * An Opendatasoft Explore v2.1 GeoJSON export URL, bbox-filtered when the
 * manifest names the geo field (`in_bbox` takes lat/lon pairs — that is the
 * API's own order, verified against opendata.paris.fr).
 * @param {object} source Normalized `manifest.source`.
 * @param {{bbox?: object|null, limit?: number}} [options]
 * @returns {string}
 */
export function opendatasoftExportUrl(source, { bbox = null, limit = source.maxFeatures } = {}) {
  const portal = source.url.replace(/\/+$/, '');
  const url = new URL(`${portal}/api/explore/v2.1/catalog/datasets/${encodeURIComponent(source.dataset)}/exports/geojson`);
  url.searchParams.set('limit', String(limit));
  const box = normalizeBbox(bbox);
  if (box && source.geoField) {
    url.searchParams.set('where', `in_bbox(${source.geoField}, ${box.south}, ${box.west}, ${box.north}, ${box.east})`);
  }
  return url.toString();
}

/** Opendatasoft dataset metadata URL. */
export function opendatasoftDatasetUrl(portal, dataset) {
  return `${portal.replace(/\/+$/, '')}/api/explore/v2.1/catalog/datasets/${encodeURIComponent(dataset)}`;
}

function clipFeatures(features, maxFeatures) {
  if (features.length <= maxFeatures) return { features, truncated: false };
  return { features: features.slice(0, maxFeatures), truncated: true };
}

async function loadGeoJson(manifest, options) {
  const { text } = await fetchDatasetText(manifest.source.url, options);
  const all = featuresFromGeoJson(parseJson(text, 'GeoJSON')).filter(hasDrawableGeometry);
  const { features, truncated } = clipFeatures(all, manifest.source.maxFeatures);
  return {
    features: features.map((feature, index) => decorateFeature(feature, manifest, index)),
    total: all.length,
    truncated,
    requests: 1,
  };
}

async function loadGeoJsonl(manifest, options) {
  const { text } = await fetchDatasetText(manifest.source.url, options);
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  const all = [];
  for (const line of lines) {
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (parsed?.type === 'Feature' && hasDrawableGeometry(parsed)) all.push(parsed);
  }
  const { features, truncated } = clipFeatures(all, manifest.source.maxFeatures);
  return {
    features: features.map((feature, index) => decorateFeature(feature, manifest, index)),
    total: all.length,
    truncated,
    requests: 1,
  };
}

function rowsToFeatures(rows, manifest) {
  const features = [];
  let unplaced = 0;
  rows.forEach((row, index) => {
    const feature = rowToFeature(row, manifest, index);
    if (feature) features.push(feature);
    else unplaced += 1;
  });
  return { features, unplaced };
}

async function loadCsv(manifest, options) {
  const { text } = await fetchDatasetText(manifest.source.url, { ...options, accept: 'text/csv, text/plain;q=0.9, */*;q=0.5' });
  const parsed = parseCsv(text, { delimiter: manifest.source.delimiter, maxRows: manifest.source.maxFeatures });
  const { features, unplaced } = rowsToFeatures(parsed.rows, manifest);
  return { features, total: parsed.total, truncated: parsed.truncated, unplaced, requests: 1 };
}

async function loadDatagouvRaw(manifest, { onProgress: _ignored, ...options }) {
  const url = datagouvResourceLatestUrl(manifest.source.resourceId);
  const { text, contentType } = await fetchDatasetText(url, options);
  const head = text.slice(0, 64).trimStart();
  if (head.startsWith('{') || head.startsWith('[') || /json/i.test(contentType)) {
    const payload = parseJson(text, 'ressource');
    let all;
    try {
      all = featuresFromGeoJson(payload).filter(hasDrawableGeometry);
    } catch {
      // A JSON array of plain rows, not GeoJSON: read it as a table.
      const rows = Array.isArray(payload) ? payload : (Array.isArray(payload?.data) ? payload.data : []);
      const { features, unplaced } = rowsToFeatures(rows.slice(0, manifest.source.maxFeatures), manifest);
      return { features, total: rows.length, truncated: rows.length > manifest.source.maxFeatures, unplaced, requests: 1, via: 'raw' };
    }
    const { features, truncated } = clipFeatures(all, manifest.source.maxFeatures);
    return { features: features.map((f, i) => decorateFeature(f, manifest, i)), total: all.length, truncated, requests: 1, via: 'raw' };
  }
  const parsed = parseCsv(text, { delimiter: manifest.source.delimiter, maxRows: manifest.source.maxFeatures });
  const { features, unplaced } = rowsToFeatures(parsed.rows, manifest);
  return { features, total: parsed.total, truncated: parsed.truncated, unplaced, requests: 1, via: 'raw' };
}

/*
 * The one loader that can honestly say where it is.
 *
 * Page 1 of the Tabular API answers with `meta.total`, so from the first
 * response the ceiling — `min(total, maxFeatures)` — is EXACT, and every page
 * after it moves a true fraction. That is why this loader reports progress and
 * the single-request ones do not: a spinner over one fetch has no numerator,
 * and inventing one would be the lie this whole surface exists to avoid.
 */
async function loadDatagouvTabular(manifest, { bbox, onProgress, ...options }) {
  const { resourceId, maxFeatures } = manifest.source;
  const columns = tabularColumnsFor(manifest);
  const rows = [];
  let total = null;
  let page = 1;
  let requests = 0;
  let next = tabularDataUrl(resourceId, { page, columns, bbox, geometry: manifest.geometry });
  while (next && rows.length < maxFeatures && requests < TABULAR_MAX_REQUESTS) {
    let payload;
    try {
      const { text } = await fetchDatasetText(next, { ...options, accept: 'application/json' });
      payload = parseJson(text, 'Tabular API');
    } catch (error) {
      // The first page failing with a 404 means the resource was never
      // tabularised — the raw file is the fallback. Any later failure is a
      // real fault and is reported as such.
      if (requests === 0 && error?.status === 404) return null;
      throw error;
    }
    requests += 1;
    const data = Array.isArray(payload?.data) ? payload.data : [];
    rows.push(...data);
    if (Number.isFinite(Number(payload?.meta?.total))) total = Number(payload.meta.total);
    // The ceiling is what will actually be taken, not what the source holds:
    // a reader watching a bar wants it to end where the drawing ends.
    if (typeof onProgress === 'function') {
      onProgress({
        received: Math.min(rows.length, maxFeatures),
        ceiling: total == null ? null : Math.min(total, maxFeatures),
        total,
        requests,
      });
    }
    const link = payload?.links?.next;
    page += 1;
    next = link && data.length > 0 ? tabularDataUrl(resourceId, { page, columns, bbox, geometry: manifest.geometry }) : null;
  }
  const clipped = rows.slice(0, maxFeatures);
  const { features, unplaced } = rowsToFeatures(clipped, manifest);
  return {
    features,
    total: total ?? rows.length,
    truncated: (total ?? rows.length) > clipped.length,
    unplaced,
    requests,
    via: 'tabular',
  };
}

async function loadDatagouv(manifest, options) {
  const tabular = await loadDatagouvTabular(manifest, options);
  if (tabular) return tabular;
  return loadDatagouvRaw(manifest, options);
}

async function loadWfs(manifest, { bbox, onProgress: _ignoredWfs, ...options }) {
  const url = wfsGetFeatureUrl(manifest.source, { bbox });
  const { text } = await fetchDatasetText(url, { ...options, accept: 'application/json' });
  const payload = parseJson(text, 'WFS');
  if (payload?.exceptionReport || (typeof payload?.ExceptionReport === 'object')) {
    throw new DatasetSourceError('WFS : le service a répondu par une exception (typeName inconnu ?)');
  }
  const all = featuresFromGeoJson(payload).filter(hasDrawableGeometry);
  const matched = Number(payload?.numberMatched);
  const total = Number.isFinite(matched) ? matched : all.length;
  return {
    features: all.map((feature, index) => decorateFeature(feature, manifest, index)),
    total,
    truncated: total > all.length,
    requests: 1,
  };
}

async function loadOpendatasoft(manifest, { bbox, ...options }) {
  const url = opendatasoftExportUrl(manifest.source, { bbox });
  const { text } = await fetchDatasetText(url, { ...options, accept: 'application/json' });
  const all = featuresFromGeoJson(parseJson(text, 'Opendatasoft')).filter(hasDrawableGeometry);
  return {
    features: all.map((feature, index) => decorateFeature(feature, manifest, index)),
    total: all.length,
    // The export carries no total; hitting the limit exactly is the only sign.
    truncated: all.length >= manifest.source.maxFeatures,
    requests: 1,
  };
}

const LOADERS = Object.freeze({
  geojson: loadGeoJson,
  geojsonl: loadGeoJsonl,
  csv: loadCsv,
  datagouv: loadDatagouv,
  wfs: loadWfs,
  opendatasoft: loadOpendatasoft,
});

/**
 * Load the features of a manifest, for one view or for all of it.
 *
 * @param {object} manifest Normalized manifest.
 * @param {{bbox?: object|null, fetchImpl?: typeof fetch, relay?: string|null, signal?: AbortSignal}} [options]
 *   `bbox` is honoured by the bbox-capable kinds and ignored by the others.
 * @returns {Promise<{features: object[], total: number, truncated: boolean, unplaced?: number, requests: number, via?: string, fetchedAt: number}>}
 */
export async function loadDatasetFeatures(manifest, { bbox = null, fetchImpl = globalThis.fetch, relay = DATASET_RELAY_PATH, signal = undefined, onProgress = null } = {}) {
  const loader = LOADERS[manifest?.source?.kind];
  if (!loader) throw new DatasetSourceError(`source inconnue : ${manifest?.source?.kind}`);
  const result = await loader(manifest, { bbox: normalizeBbox(bbox), fetchImpl, relay, signal, onProgress });
  return { unplaced: 0, via: 'direct', ...result, fetchedAt: Date.now() };
}
