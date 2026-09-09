/*
 * Where a plugged dataset lives between two sessions: this browser, and
 * nowhere else.
 *
 * A plugged dataset is a reader's own choice, made on one machine. It is not
 * in the share-link registry (`layerState.js`) and it never will be by this
 * path: a link that carried "load this URL" would have another machine fetch
 * whatever the first one typed, and the registry's whole design is that a
 * token can only name a layer the code already knows. What travels is the
 * manifest FILE — `datasets/*.json` in the repo, or an export from the panel.
 *
 * The store fails open the way the first-run card's does: an unreadable or
 * refused localStorage means "nothing plugged", never an exception at boot.
 *
 * @module data/datasetStore
 */

import { datasetManifestFaults, normalizeDatasetManifest } from './datasetManifest.js';

export const PLUGGED_DATASETS_STORAGE_KEY = 'gev:plugged-datasets:v1';
export const PLUGGED_DATASETS_VERSION = 1;
/** Enough for a working session, few enough that the panel stays a list. */
export const PLUGGED_DATASETS_MAX = 40;

function safeStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

/**
 * The stored entries, each re-validated on the way in so a manifest written
 * by an older build that no longer passes is dropped rather than crashing the
 * panel.
 * @param {Storage|null} [storage]
 * @returns {Array<{manifest: object, enabled: boolean, addedAt: number}>}
 */
export function readPluggedDatasets(storage = safeStorage()) {
  if (!storage) return [];
  let raw = null;
  try { raw = storage.getItem(PLUGGED_DATASETS_STORAGE_KEY); } catch { return []; }
  if (!raw) return [];
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!parsed || parsed.version !== PLUGGED_DATASETS_VERSION || !Array.isArray(parsed.datasets)) return [];
  const entries = [];
  const seen = new Set();
  for (const item of parsed.datasets) {
    if (!item || typeof item !== 'object') continue;
    if (datasetManifestFaults(item.manifest).length) continue;
    const manifest = normalizeDatasetManifest(item.manifest);
    if (seen.has(manifest.id)) continue;
    seen.add(manifest.id);
    entries.push({
      manifest,
      enabled: item.enabled === true,
      addedAt: Number.isFinite(Number(item.addedAt)) ? Number(item.addedAt) : 0,
    });
    if (entries.length >= PLUGGED_DATASETS_MAX) break;
  }
  return entries;
}

/**
 * Persist the entries. Returns whether the write was accepted — a refused
 * write (quota, private mode) is reported so the panel can say the dataset
 * will not survive the tab, rather than promising it will.
 * @param {Array<{manifest: object, enabled: boolean, addedAt: number}>} entries
 * @param {Storage|null} [storage]
 * @returns {boolean}
 */
export function writePluggedDatasets(entries, storage = safeStorage()) {
  if (!storage) return false;
  const payload = {
    version: PLUGGED_DATASETS_VERSION,
    datasets: entries.slice(0, PLUGGED_DATASETS_MAX).map((entry) => ({
      manifest: entry.manifest,
      enabled: entry.enabled === true,
      addedAt: entry.addedAt,
    })),
  };
  try {
    storage.setItem(PLUGGED_DATASETS_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** Add or replace one manifest, keeping its position and enabled flag when it existed. */
export function upsertPluggedDataset(entries, manifest, { enabled = null, now = Date.now() } = {}) {
  const index = entries.findIndex((entry) => entry.manifest.id === manifest.id);
  if (index >= 0) {
    const previous = entries[index];
    const next = [...entries];
    next[index] = { manifest, enabled: enabled ?? previous.enabled, addedAt: previous.addedAt };
    return next;
  }
  return [...entries, { manifest, enabled: enabled === true, addedAt: now }];
}

/** Drop one manifest by id. */
export function removePluggedDataset(entries, id) {
  return entries.filter((entry) => entry.manifest.id !== id);
}

/** Record whether one plugged dataset is on. */
export function setPluggedDatasetEnabled(entries, id, enabled) {
  return entries.map((entry) => (entry.manifest.id === id ? { ...entry, enabled: enabled === true } : entry));
}
