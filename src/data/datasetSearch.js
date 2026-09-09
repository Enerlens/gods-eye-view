/*
 * CHERCHER UN SUJET — the shortlist the reader chooses from.
 *
 * The box could already turn a pasted address into a layer. What it could not
 * do is answer "est-ce qu'on a les défibrillateurs ?", and that turned out to
 * be the hard half. Measured on six subjects (docs/DEMANDER-UNE-DONNEE.md):
 * taking the platform's first hit draws the right thing about half the time.
 * The other half is a dataset whose files all 404, a table with no column
 * saying where a row is, or — worst, because it looks like a success — one
 * town's twenty points where a national base of 186 118 was meant.
 *
 * So nothing here picks. It reads the first hits AT ONCE (170 ms more than
 * reading one, measured: the reads are independent and network-bound), keeps
 * the ones it has PROVEN drawable, and hands the reader four facts per
 * candidate — how many objects, who publishes, how fresh, under what licence.
 * The count is the fact that separates 19 from 186 118, and it is free: the
 * Tabular API's profile, which the draft already fetches, states `total_lines`.
 *
 * WHAT IS NOT RANKED, AND WHY. Drawable candidates keep data.gouv's own
 * relevance order. Re-sorting them by size would say "the biggest is the most
 * relevant", which is a different claim and a false one — the Paris pharmacies
 * are the right answer for someone looking at Paris. The facts decide; this
 * module only makes them visible, and marks nothing as recommended.
 *
 * @module data/datasetSearch
 */

import { fetchDatasetText, DATASET_RELAY_PATH } from './datasetSources.js';
import { licenceLabel } from './datasetInference.js';

/** data.gouv.fr's relevance search. `api/1` without a sort ranks by nothing useful. */
export const DATAGOUV_SEARCH_URL = 'https://www.data.gouv.fr/api/2/datasets/search/';

/** How many hits are read and proven. Five is the measured knee: it rescues the zombies without doubling the wait. */
export const SEARCH_SHORTLIST = 5;

/** Anything longer than this is a paste, not a subject. */
export const SEARCH_QUERY_MAX = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Is this an address to analyse, or words to search?
 * One field takes both, so the reader never has to know which mode they are in.
 * @param {string} input
 * @returns {boolean}
 */
export function looksLikeDatasetAddress(input) {
  const text = String(input || '').trim();
  if (!text) return false;
  if (UUID.test(text)) return true;
  return /^(https?:)?\/\//i.test(text) || /^www\./i.test(text);
}

/** Thousands separated the French way — 186 118, not 186118. */
export function formatObjectCount(value) {
  // `Number(null)` is 0, and a dataset that really holds zero rows must be able
  // to say so — the unknown is the absence of the fact, not a falsy value.
  if (value === null || value === undefined || value === '') return null;
  if (!Number.isFinite(Number(value))) return null;
  return String(Math.round(Number(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** « 1 semaine », « 3 semaines » — a plural nobody has to forgive. */
function plural(count, singular, many = `${singular}s`) {
  return `${count} ${count > 1 ? many : singular}`;
}

/**
 * How long ago, in the words a reader uses.
 * Deliberately coarse: the exact day of a monthly dataset is noise, and
 * "il y a 6 ans" is the fact that decides, not "2019-09-20".
 * @param {string|number|Date|null} at
 * @param {number} [now]
 * @returns {string|null}
 */
export function freshnessLabel(at, now = Date.now()) {
  if (!at) return null;
  const stamp = at instanceof Date ? at.getTime() : Date.parse(String(at));
  if (!Number.isFinite(stamp)) return null;
  const days = Math.floor((now - stamp) / 86400000);
  if (days < 0) return null;
  if (days === 0) return "à jour aujourd'hui";
  if (days === 1) return 'à jour hier';
  if (days < 7) return `à jour il y a ${plural(days, 'jour')}`;
  if (days < 60) return `à jour il y a ${plural(Math.round(days / 7), 'semaine')}`;
  if (days < 730) return `à jour il y a ${plural(Math.round(days / 30), 'mois', 'mois')}`;
  return `figé depuis ${plural(Math.round(days / 365), 'an')}`;
}

/**
 * A technical fault, said once, in a phrase a reader can act on.
 * The raw text stays available for the title attribute — this is the label,
 * not a replacement for the truth.
 * @param {string} fault
 * @param {{resourcesUnavailable?: boolean}} [context]
 * @returns {string}
 */
export function blockerLabel(fault, { resourcesUnavailable = false } = {}) {
  const text = String(fault || '').trim();
  if (/\b404\b|introuvable/i.test(text)) {
    return resourcesUnavailable
      ? 'fichiers indisponibles — data.gouv.fr le signale aussi'
      : 'fichiers introuvables';
  }
  if (/`geometry`|colonne de position|devient un point/i.test(text)) return 'aucune colonne de position';
  if (/https uniquement/i.test(text)) return 'adresse non sécurisée';
  if (/hôte non autorisé/i.test(text)) return 'hébergeur non autorisé';
  if (/aucune ressource lisible|ne publie aucune/i.test(text)) return 'aucun fichier lisible';
  if (/trop volumineuse|plafond/i.test(text)) return 'fichier trop lourd';
  if (/attribution|licence/i.test(text)) return 'éditeur ou licence manquants';
  if (/\b(5\d\d|timeout|réseau)\b/i.test(text)) return 'la plateforme ne répond pas';
  return text.length > 64 ? `${text.slice(0, 61)}…` : text || 'illisible';
}

/**
 * The few words shown under a candidate's title.
 * Every one of them is read from the platform; none is inferred from another.
 * @param {{total?: number|null, publisher?: string|null, lastUpdate?: string|null, licence?: string|null}} facts
 * @param {number} [now]
 * @returns {string[]}
 */
export function candidateFacts({ total = null, publisher = null, lastUpdate = null, licence = null }, now = Date.now()) {
  const parts = [];
  // A count is published for tabular resources and withheld for most GeoJSON
  // ones. When it is missing the line simply starts with the publisher — who
  // publishes is itself the scope signal ("Département des Hauts-de-Seine"
  // says what a missing number would not). Leading with "nombre inconnu" would
  // give our ignorance the first and loudest position on the row.
  const count = formatObjectCount(total);
  if (count) parts.push(`${count} objets`);
  if (publisher) parts.push(publisher);
  const fresh = freshnessLabel(lastUpdate, now);
  if (fresh) parts.push(fresh);
  if (licence) parts.push(licence);
  return parts;
}

/** One search hit, reduced to what the shortlist needs. */
export function normalizeSearchHit(item) {
  const slug = String(item?.slug || '').trim();
  if (!slug) return null;
  return {
    slug,
    title: String(item?.title || slug),
    page: `https://www.data.gouv.fr/datasets/${slug}/`,
    publisher: item?.organization?.name
      || [item?.owner?.first_name, item?.owner?.last_name].filter(Boolean).join(' ')
      || null,
    licence: licenceLabel(item?.license),
    lastUpdate: item?.last_update || null,
    // data.gouv.fr runs its own link check; when it already says the files are
    // gone, a 404 from us is corroborated rather than guessed at.
    resourcesUnavailable: item?.quality?.all_resources_available === false,
  };
}

/**
 * Ask the platform which datasets match a subject.
 * @param {string} query
 * @param {{fetchImpl?: Function, relay?: string|null, signal?: AbortSignal, limit?: number}} [options]
 * @returns {Promise<{total: number, hits: object[]}>}
 */
export async function searchDatasets(query, { fetchImpl = globalThis.fetch, relay = DATASET_RELAY_PATH, signal = undefined, limit = SEARCH_SHORTLIST } = {}) {
  const subject = String(query || '').trim().slice(0, SEARCH_QUERY_MAX);
  if (!subject) return { total: 0, hits: [] };
  const url = `${DATAGOUV_SEARCH_URL}?q=${encodeURIComponent(subject)}&page_size=${Math.max(1, Math.min(20, limit))}`;
  const { text } = await fetchDatasetText(url, { fetchImpl, relay, signal, accept: 'application/json' });
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('réponse illisible de data.gouv.fr'); }
  const hits = (Array.isArray(payload?.data) ? payload.data : []).map(normalizeSearchHit).filter(Boolean);
  return { total: Number(payload?.total) || hits.length, hits };
}

/**
 * Read every hit at once and keep only the ones that would actually draw.
 *
 * `infer` is the box's own reader, so a candidate is proven by the same code
 * that will load it — nothing is validated here that the loader would refuse
 * later. Failures are kept, not dropped: a reader who asked for a subject is
 * owed the list of what was found and set aside, and why.
 *
 * @param {object[]} hits
 * @param {(url: string) => Promise<object>} infer
 * @param {{now?: number}} [options]
 * @returns {Promise<{ready: object[], blocked: object[]}>}
 */
export async function proveCandidates(hits, infer, { now = Date.now() } = {}) {
  const settled = await Promise.all((hits || []).map(async (hit) => {
    try {
      const draft = await infer(hit.page);
      const faults = Array.isArray(draft?.faults) ? draft.faults : [];
      if (faults.length) return { hit, draft, fault: faults[0] };
      return { hit, draft, fault: null };
    } catch (error) {
      return { hit, draft: null, fault: String(error?.message || error) };
    }
  }));
  const ready = [];
  const blocked = [];
  for (const entry of settled) {
    if (entry.fault) {
      blocked.push({
        ...entry.hit,
        reason: blockerLabel(entry.fault, { resourcesUnavailable: entry.hit.resourcesUnavailable }),
        rawFault: entry.fault,
      });
      continue;
    }
    ready.push({
      ...entry.hit,
      draft: entry.draft,
      total: Number.isFinite(entry.draft.total) ? entry.draft.total : null,
      facts: candidateFacts({
        total: entry.draft.total,
        // The draft's publisher and licence come from the dataset's own page,
        // which is a hair more authoritative than the search index's copy.
        publisher: entry.draft.manifest?.attribution?.publisher || entry.hit.publisher,
        lastUpdate: entry.hit.lastUpdate,
        licence: entry.draft.manifest?.attribution?.licence || entry.hit.licence,
      }, now),
    });
  }
  return { ready, blocked };
}

/**
 * The whole shortlist, from a subject to something a reader can choose from.
 * @param {string} query
 * @param {(url: string) => Promise<object>} infer
 * @param {{fetchImpl?: Function, relay?: string|null, signal?: AbortSignal, limit?: number, now?: number}} [options]
 * @returns {Promise<{query: string, total: number, ready: object[], blocked: object[]}>}
 */
export async function shortlistDatasets(query, infer, options = {}) {
  const { total, hits } = await searchDatasets(query, options);
  const { ready, blocked } = await proveCandidates(hits, infer, { now: options.now });
  return { query: String(query || '').trim(), total, ready, blocked };
}
