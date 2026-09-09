/*
 * FROM A PASTED URL TO A MANIFEST DRAFT.
 *
 * "Brancher un jeu de données" has to mean pasting the address of a dataset
 * page — not filling in eleven fields. This module reads the URL, recognises
 * the platform, asks it for what it publishes about itself (title, publisher,
 * licence, fields, a few rows) and returns a manifest the panel shows for
 * confirmation, plus the NOTES a careful reader owes: which geometry was
 * guessed and why, which resource was picked among several, and that the
 * licence must be confirmed on the dataset's own page.
 *
 * It uses the same REST endpoints the official data.gouv.fr MCP server
 * wraps — `api/1/datasets/<slug>/`, `api/2/datasets/resources/<uuid>/`, the
 * Tabular API profile — so an assistant that found a dataset through the MCP
 * hands over an id this module already knows how to open. The MCP stays an
 * authoring aid (CONTRIBUTING.md says why); this is the product path.
 *
 * Nothing here is trusted blindly: a licence read from an API is written into
 * the draft AND flagged, a guessed geometry is written AND explained, and the
 * reader sees both before the first row is drawn.
 *
 * @module data/datasetInference
 */

import { parseCsv } from './datasetCsv.js';
import { detectGeometry } from './datasetGeometry.js';
import {
  DATASET_DEFAULT_MAX_FEATURES,
  DATASET_ID_PATTERN,
  datasetManifestFaults,
} from './datasetManifest.js';
import {
  DATASET_RELAY_PATH,
  DatasetSourceError,
  datagouvResourceLatestUrl,
  fetchDatasetText,
  opendatasoftDatasetUrl,
  tabularDataUrl,
  tabularProfileUrl,
} from './datasetSources.js';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Bytes read from the head of a raw CSV to learn its header and a sample. */
export const CSV_PEEK_BYTES = 128 * 1024;

/** data.gouv.fr licence ids → the label a reader recognises. */
export const DATAGOUV_LICENCE_LABELS = Object.freeze({
  'lov2': 'Licence Ouverte 2.0',
  'fr-lo': 'Licence Ouverte 1.0',
  'odc-odbl': 'ODbL',
  'odc-by': 'ODC-By',
  'odc-pddl': 'PDDL',
  'cc-by': 'CC BY 4.0',
  'cc-by-sa': 'CC BY-SA 4.0',
  'cc-zero': 'CC0',
  'other-open': 'licence ouverte (autre)',
  'other-pd': 'domaine public',
  'other-at': 'attribution (autre)',
  'notspecified': 'non précisée',
});

export function licenceLabel(id) {
  if (!id) return 'non précisée';
  const key = String(id).trim().toLowerCase();
  return DATAGOUV_LICENCE_LABELS[key] || String(id).trim();
}

/**
 * A manifest id from a title: lower-case ASCII, hyphens, 2–40 characters.
 * @param {string} text
 * @param {string} [fallback]
 * @returns {string}
 */
export function slugifyDatasetId(text, fallback = 'jeu') {
  let slug = String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > 40) {
    // Cut on a word, not inside one: `defibrillateu` is not a name.
    const cut = slug.slice(0, 41).lastIndexOf('-');
    slug = (cut >= 2 ? slug.slice(0, cut) : slug.slice(0, 40)).replace(/-+$/g, '');
  }
  const candidate = slug.length >= 2 ? slug : fallback;
  return DATASET_ID_PATTERN.test(candidate) ? candidate : fallback;
}

function clampLabel(text, max = 64) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Recognise what a URL points at. Pure; no request.
 *
 * @param {string} input
 * @returns {{platform: string, url: string, datasetRef?: string, resourceId?: string, portal?: string, dataset?: string, typeName?: string|null}}
 */
export function classifyDatasetUrl(input) {
  const raw = String(input ?? '').trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    // A bare UUID or a bare data.gouv slug is accepted as a shorthand.
    if (UUID.test(raw) && raw.length === 36) return { platform: 'datagouv-resource', url: raw, resourceId: raw.toLowerCase() };
    if (/^[a-z0-9][a-z0-9-]{2,}$/.test(raw)) return { platform: 'datagouv-dataset', url: raw, datasetRef: raw };
    return { platform: 'unknown', url: raw };
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  const query = url.searchParams;

  // ── data.gouv.fr ────────────────────────────────────────────────────────
  if (host === 'tabular-api.data.gouv.fr') {
    const match = /\/api\/resources\/([^/]+)/.exec(path);
    if (match && UUID.test(match[1])) return { platform: 'datagouv-resource', url: raw, resourceId: match[1].toLowerCase() };
  }
  if (host === 'www.data.gouv.fr' || host === 'data.gouv.fr' || host === 'demo.data.gouv.fr') {
    const fragmentResource = /resources\/([0-9a-f-]{36})/i.exec(url.hash || '');
    if (fragmentResource) return { platform: 'datagouv-resource', url: raw, resourceId: fragmentResource[1].toLowerCase() };
    const resource = /\/datasets\/r\/([0-9a-f-]{36})/i.exec(path) || /\/api\/2\/datasets\/resources\/([0-9a-f-]{36})/i.exec(path);
    if (resource) return { platform: 'datagouv-resource', url: raw, resourceId: resource[1].toLowerCase() };
    const dataset = /^(?:\/(?:fr|en|es))?\/(?:api\/1\/)?datasets\/([^/#?]+)\/?/.exec(path);
    if (dataset && dataset[1] !== 'r') return { platform: 'datagouv-dataset', url: raw, datasetRef: dataset[1] };
  }

  // ── Opendatasoft ────────────────────────────────────────────────────────
  const odsExplore = /\/explore\/(?:embed\/)?dataset\/([^/?#]+)/.exec(path);
  const odsApi = /\/api\/explore\/v2\.[0-9]\/catalog\/datasets\/([^/?#]+)/.exec(path);
  const odsV1 = path.includes('/api/records/1.0/') ? query.get('dataset') : null;
  const odsDataset = odsExplore?.[1] || odsApi?.[1] || odsV1;
  if (odsDataset) return { platform: 'opendatasoft', url: raw, portal: `${url.protocol}//${url.host}`, dataset: odsDataset };

  // ── WFS ─────────────────────────────────────────────────────────────────
  const service = [...query.keys()].find((key) => key.toLowerCase() === 'service');
  const isWfs = (service && query.get(service).toUpperCase() === 'WFS') || /\/wfs(\/|$)/i.test(path);
  if (isWfs) {
    const typeKey = [...query.keys()].find((key) => ['typenames', 'typename'].includes(key.toLowerCase()));
    return {
      platform: 'wfs',
      url: `${url.protocol}//${url.host}${path}`,
      typeName: typeKey ? query.get(typeKey) : null,
    };
  }

  // ── plain files ─────────────────────────────────────────────────────────
  const file = path.toLowerCase();
  if (/\.(geojsonl|ndjson|jsonl)$/.test(file)) return { platform: 'geojsonl', url: raw };
  if (/\.(geojson|json)$/.test(file)) return { platform: 'geojson', url: raw };
  if (/\.(csv|tsv|txt)$/.test(file)) return { platform: 'csv', url: raw };
  return { platform: 'unknown', url: raw };
}

function json(text, what) {
  try { return JSON.parse(text); } catch { throw new DatasetSourceError(`${what} : réponse illisible`); }
}

/**
 * A partial CSV head → header + sample rows. Drops the last, possibly cut,
 * record so a truncated number never reaches the geometry guess.
 */
export function csvHeadSample(text) {
  const lines = String(text ?? '').split('\n');
  if (lines.length > 2) lines.pop();
  const parsed = parseCsv(lines.join('\n'), { maxRows: 12 });
  return { header: parsed.header, sample: parsed.rows.slice(0, 8), delimiter: parsed.delimiter };
}

function geometryNote(guess) {
  return guess
    ? `Géométrie déduite : ${guess.reason}. Vérifiez-la avant de brancher.`
    : 'Aucune colonne de position reconnue : choisissez les colonnes longitude / latitude.';
}

const LICENCE_NOTE = 'Licence lue sur la plateforme — à confirmer sur la page du jeu avant toute réutilisation.';

function pickDatagouvResource(resources) {
  const list = Array.isArray(resources) ? resources : [];
  const format = (resource) => String(resource?.format || '').toLowerCase();
  const byFormat = (wanted) => list.find((resource) => wanted.includes(format(resource)));
  return byFormat(['geojson'])
    || list.find((resource) => format(resource) === 'json' && /geojson/i.test(resource?.title || resource?.url || ''))
    || byFormat(['csv'])
    || byFormat(['ogc:wfs', 'wfs'])
    || byFormat(['json'])
    || list[0]
    || null;
}

async function fetchDatagouvDataset(ref, options) {
  const { text } = await fetchDatasetText(`https://www.data.gouv.fr/api/1/datasets/${encodeURIComponent(ref)}/`, { ...options, accept: 'application/json' });
  return json(text, 'data.gouv.fr');
}

async function inferFromDatagouvResource(resourceId, context, options) {
  const notes = [];
  const { text } = await fetchDatasetText(`https://www.data.gouv.fr/api/2/datasets/resources/${encodeURIComponent(resourceId)}/`, { ...options, accept: 'application/json' });
  const payload = json(text, 'data.gouv.fr');
  const resource = payload?.resource || payload;
  if (!resource?.id) throw new DatasetSourceError('ressource data.gouv.fr introuvable');
  let dataset = context.dataset || null;
  if (!dataset && (payload?.dataset_id || resource?.dataset_id)) {
    try { dataset = await fetchDatagouvDataset(payload.dataset_id || resource.dataset_id, options); } catch { dataset = null; }
  }
  const title = dataset?.title || resource.title || 'Jeu data.gouv.fr';
  const attribution = {
    publisher: dataset?.organization?.name || dataset?.owner?.first_name && `${dataset.owner.first_name} ${dataset.owner.last_name}` || 'data.gouv.fr',
    licence: licenceLabel(dataset?.license),
    url: dataset?.page || `https://www.data.gouv.fr/datasets/r/${resourceId}`,
  };
  notes.push(LICENCE_NOTE);
  const format = String(resource.format || '').toLowerCase();
  const base = {
    id: slugifyDatasetId(title),
    label: clampLabel(title),
    attribution,
  };
  const latest = resource.latest || datagouvResourceLatestUrl(resourceId);

  if (format === 'ogc:wfs' || format === 'wfs') {
    const wfs = classifyDatasetUrl(resource.url || '');
    if (wfs.platform !== 'wfs' || !wfs.typeName) throw new DatasetSourceError('ressource WFS sans typeName exploitable');
    return {
      manifest: { ...base, source: { kind: 'wfs', url: wfs.url, typeName: wfs.typeName, scope: 'viewport' } },
      notes,
    };
  }
  if (format === 'geojson' || (format === 'json' && /geojson/i.test(resource.title || resource.url || ''))) {
    if (Number(resource.filesize) > 24 * 1024 * 1024) notes.push(`Fichier de ${(resource.filesize / 1048576).toFixed(0)} Mo : au-delà du plafond de lecture directe (24 Mo).`);
    return {
      manifest: { ...base, source: { kind: 'geojson', url: latest } },
      notes,
      bytes: Number(resource.filesize) > 0 ? Number(resource.filesize) : null,
    };
  }
  // CSV (or anything tabular): the Tabular API first, the raw head otherwise.
  let header = null;
  let sample = [];
  let tabular = false;
  // The Tabular API's profile already states how many rows the resource holds
  // (`total_lines`). It is the single fact that separates a national base from
  // one town's twenty points, and it costs nothing more to keep.
  let total = null;
  try {
    const profile = json((await fetchDatasetText(tabularProfileUrl(resourceId), { ...options, accept: 'application/json' })).text, 'Tabular API');
    header = Array.isArray(profile?.profile?.header) ? profile.profile.header : null;
    const lines = Number(profile?.profile?.total_lines);
    if (Number.isFinite(lines) && lines >= 0) total = lines;
    if (header) {
      tabular = true;
      try {
        const page = json((await fetchDatasetText(tabularDataUrl(resourceId, { pageSize: 8 }), { ...options, accept: 'application/json' })).text, 'Tabular API');
        sample = Array.isArray(page?.data) ? page.data : [];
      } catch { sample = []; }
    }
  } catch { header = null; }
  let delimiter = null;
  if (!header) {
    const head = await fetchDatasetText(latest, { ...options, accept: 'text/csv, text/plain;q=0.9, */*;q=0.5', headers: { Range: `bytes=0-${CSV_PEEK_BYTES - 1}` } });
    const peek = csvHeadSample(head.text);
    header = peek.header;
    sample = peek.sample;
    delimiter = peek.delimiter;
    notes.push('Ressource non indexée par la Tabular API : le fichier sera lu en entier (plafond 24 Mo).');
  }
  const guess = detectGeometry(header, sample);
  notes.push(geometryNote(guess));
  const source = tabular
    ? { kind: 'datagouv', resourceId, scope: guess?.geometry?.lon ? 'viewport' : 'all' }
    : { kind: 'csv', url: latest, ...(delimiter ? { delimiter } : {}) };
  return {
    manifest: { ...base, source, ...(guess ? { geometry: guess.geometry } : {}) },
    notes,
    columns: header,
    sample,
    total,
    bytes: Number(resource.filesize) > 0 ? Number(resource.filesize) : null,
  };
}

async function inferFromDatagouvDataset(ref, options) {
  const dataset = await fetchDatagouvDataset(ref, options);
  const resources = Array.isArray(dataset?.resources) ? dataset.resources : [];
  const chosen = options.resourceId
    ? resources.find((resource) => String(resource.id).toLowerCase() === options.resourceId.toLowerCase()) || null
    : pickDatagouvResource(resources);
  if (!chosen) throw new DatasetSourceError('ce jeu ne publie aucune ressource lisible');
  const result = await inferFromDatagouvResource(String(chosen.id).toLowerCase(), { dataset }, options);
  if (resources.length > 1) {
    result.notes.unshift(`Ressource retenue : « ${chosen.title || chosen.format} » parmi ${resources.length}.`);
  }
  result.resources = resources.map((resource) => ({
    id: String(resource.id).toLowerCase(),
    title: resource.title || null,
    format: resource.format || null,
    filesize: Number.isFinite(Number(resource.filesize)) ? Number(resource.filesize) : null,
  }));
  return result;
}

async function inferFromOpendatasoft(portal, dataset, options) {
  const { text } = await fetchDatasetText(opendatasoftDatasetUrl(portal, dataset), { ...options, accept: 'application/json' });
  const payload = json(text, 'Opendatasoft');
  const metas = payload?.metas?.default || {};
  const fields = Array.isArray(payload?.fields) ? payload.fields : [];
  const geoField = fields.find((field) => field?.type === 'geo_point_2d')?.name
    || fields.find((field) => field?.type === 'geo_shape')?.name
    || null;
  const notes = [LICENCE_NOTE];
  if (!geoField) notes.push('Aucun champ géographique déclaré par le portail : ce jeu ne se dessine pas.');
  const count = Number(metas.records_count);
  const title = metas.title || dataset;
  return {
    manifest: {
      id: slugifyDatasetId(title),
      label: clampLabel(title),
      source: {
        kind: 'opendatasoft',
        url: portal,
        dataset,
        ...(geoField ? { geoField } : {}),
        scope: geoField && Number.isFinite(count) && count > DATASET_DEFAULT_MAX_FEATURES ? 'viewport' : 'all',
      },
      attribution: {
        publisher: metas.publisher || new URL(portal).hostname,
        licence: metas.license || 'non précisée',
        url: `${portal.replace(/\/+$/, '')}/explore/dataset/${encodeURIComponent(dataset)}/`,
      },
    },
    notes,
    columns: fields.map((field) => field?.name).filter(Boolean),
    total: Number.isFinite(count) ? count : null,
  };
}

async function inferFromCsvUrl(url, options) {
  const head = await fetchDatasetText(url, { ...options, accept: 'text/csv, text/plain;q=0.9, */*;q=0.5', headers: { Range: `bytes=0-${CSV_PEEK_BYTES - 1}` } });
  const peek = csvHeadSample(head.text);
  const guess = detectGeometry(peek.header, peek.sample);
  const host = new URL(url).hostname;
  const name = decodeURIComponent(url.split('/').pop().replace(/\.[a-z]+$/i, '')) || host;
  return {
    manifest: {
      id: slugifyDatasetId(name),
      label: clampLabel(name),
      source: { kind: 'csv', url, delimiter: peek.delimiter },
      ...(guess ? { geometry: guess.geometry } : {}),
      attribution: { publisher: host, licence: 'à confirmer', url },
    },
    notes: ['Éditeur et licence inconnus pour un fichier nu : complétez-les.', geometryNote(guess)],
    columns: peek.header,
    sample: peek.sample,
  };
}

/**
 * Read a URL and propose a manifest.
 *
 * @param {string} input The pasted address.
 * @param {{fetchImpl?: typeof fetch, relay?: string|null, signal?: AbortSignal, resourceId?: string|null}} [options]
 *   `resourceId` picks one resource of a data.gouv.fr dataset instead of the default choice.
 * @returns {Promise<{manifest: object, notes: string[], faults: string[], columns?: string[]|null, sample?: object[], resources?: object[], platform: string}>}
 *   `manifest` is a DRAFT: `faults` lists what still stops it from validating
 *   (typically a missing geometry the reader has to pick).
 */
export async function inferDatasetManifest(input, { fetchImpl = globalThis.fetch, relay = DATASET_RELAY_PATH, signal = undefined, resourceId = null } = {}) {
  const classified = classifyDatasetUrl(input);
  const options = { fetchImpl, relay, signal, resourceId };
  let result;
  switch (classified.platform) {
    case 'datagouv-resource':
      result = await inferFromDatagouvResource(classified.resourceId, {}, options);
      break;
    case 'datagouv-dataset':
      result = await inferFromDatagouvDataset(classified.datasetRef, options);
      break;
    case 'opendatasoft':
      result = await inferFromOpendatasoft(classified.portal, classified.dataset, options);
      break;
    case 'wfs': {
      if (!classified.typeName) throw new DatasetSourceError('adresse WFS sans typeNames : indiquez la couche (ex. …?typeNames=BDTOPO_V3:aerodrome)');
      const host = new URL(classified.url).hostname;
      const ign = /geopf\.fr$/.test(host);
      result = {
        manifest: {
          id: slugifyDatasetId(classified.typeName.split(':').pop()),
          label: clampLabel(classified.typeName),
          source: { kind: 'wfs', url: classified.url, typeName: classified.typeName, scope: 'viewport' },
          attribution: {
            publisher: ign ? 'IGN — Géoplateforme' : host,
            licence: ign ? 'Licence Ouverte 2.0' : 'à confirmer',
            url: ign ? 'https://geoservices.ign.fr/' : classified.url,
          },
        },
        notes: [ign ? 'La plupart des couches IGN sont sous Licence Ouverte 2.0 — confirmez pour celle-ci.' : 'Éditeur et licence inconnus pour ce WFS : complétez-les.'],
      };
      break;
    }
    case 'geojson':
    case 'geojsonl': {
      const host = new URL(classified.url).hostname;
      const name = decodeURIComponent(classified.url.split('/').pop().replace(/\.[a-z]+$/i, '')) || host;
      result = {
        manifest: {
          id: slugifyDatasetId(name),
          label: clampLabel(name),
          source: { kind: classified.platform, url: classified.url },
          attribution: { publisher: host, licence: 'à confirmer', url: classified.url },
        },
        notes: ['Éditeur et licence inconnus pour un fichier nu : complétez-les.'],
      };
      break;
    }
    case 'csv':
      result = await inferFromCsvUrl(classified.url, options);
      break;
    default:
      throw new DatasetSourceError('adresse non reconnue : page data.gouv.fr, portail Opendatasoft, WFS, GeoJSON ou CSV');
  }
  return {
    platform: classified.platform,
    columns: null,
    sample: [],
    total: null,
    bytes: null,
    ...result,
    faults: datasetManifestFaults(result.manifest),
  };
}
