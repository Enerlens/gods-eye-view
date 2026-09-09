/*
 * THE DATASET BOX — where a manifest becomes a row on the panel.
 *
 * One entry point, `initDatasetBox()`, called by `main.js` right after the
 * production registry is sealed. It does four things, in this order:
 *
 *   1. registers every manifest of the shipped catalog (`datasets/*.json`);
 *   2. restores the datasets this browser plugged in earlier sessions, and
 *      turns back on the ones that were on;
 *   3. mounts the "brancher un jeu de données" panel under the layer list;
 *   4. returns the API the panel, the QA harness and a voice tool can call:
 *      `plug`, `unplug`, `infer`, `list`, `exportManifest`.
 *
 * WHAT A DATASET GETS BY BEING PLUGGED. A layer built by `datasetLayer.js`,
 * a taxonomy row derived from its manifest (so the panel groups and chips
 * it like a core layer), a credit in Cesium's attribution lightbox, and —
 * for a plugged one — persistence of its manifest and of its ON/OFF state
 * in this browser. It does NOT get a share-link token (`datasetStore.js`
 * says why) and it is not in the voice tool enum, but `set_layer_visibility`
 * accepts any registered id, so "allume ds-defibrillateurs-geodae" works
 * the moment the row exists.
 *
 * @module data/datasetBox
 */

import { createDatasetLayer } from './datasetLayer.js';
import { inferDatasetManifest } from './datasetInference.js';
import {
  datasetCredit,
  datasetLayerId,
  datasetTaxonomyEntry,
  exportableManifest,
  normalizeDatasetManifest,
} from './datasetManifest.js';
import { registerDynamicCredit } from './dataCredits.js';
import { coverageChip } from './layerTaxonomy.js';
import {
  readPluggedDatasets,
  removePluggedDataset,
  setPluggedDatasetEnabled,
  upsertPluggedDataset,
  writePluggedDatasets,
} from './datasetStore.js';
import { mountDatasetPlugPanel } from './datasetPlugPanel.js';

/**
 * @param {object} options
 * @param {import('./manager.js').DataLayerManager} options.dataManager Sealed manager.
 * @param {object} options.viewer Cesium viewer, for the credit display.
 * @param {ReadonlyArray<object>} [options.catalog] Shipped manifests.
 * @param {boolean} [options.mountPanel] Whether to mount the UI (false in headless tests).
 * @param {Storage|null} [options.storage] Persistence, injectable.
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string|null} [options.relay]
 * @returns {object} The box API.
 */
export function initDatasetBox({
  dataManager,
  viewer,
  catalog = [],
  mountPanel = true,
  storage = undefined,
  fetchImpl = globalThis.fetch,
  relay = undefined,
} = {}) {
  if (!dataManager) throw new Error('initDatasetBox needs the data manager');
  /** @type {Map<string, {manifest: object, origin: 'catalog'|'plugged'}>} */
  const registered = new Map();
  let plugged = readPluggedDatasets(storage);
  const listeners = new Set();
  const layerOptions = { fetchImpl, ...(relay === undefined ? {} : { relay }) };

  function notify() {
    for (const listener of listeners) {
      try { listener(); } catch (error) { console.warn('[datasets] listener error:', error); }
    }
  }

  function persist() {
    return writePluggedDatasets(plugged, storage);
  }

  function registerManifest(manifest, origin) {
    const layerId = datasetLayerId(manifest);
    if (dataManager.layers.has(layerId)) {
      throw new Error(`Un jeu « ${manifest.id} » est déjà branché`);
    }
    const layer = createDatasetLayer(manifest, layerOptions);
    dataManager.registerDataset(layer, datasetTaxonomyEntry(manifest, coverageChip));
    registered.set(manifest.id, { manifest, origin });
    if (viewer) registerDynamicCredit(viewer, datasetCredit(manifest));
    return layerId;
  }

  // 1. the shipped catalog
  for (const manifest of catalog) {
    try {
      registerManifest(manifest, 'catalog');
    } catch (error) {
      console.warn(`[datasets] catalogue : ${manifest?.id} non enregistré — ${error?.message || error}`);
    }
  }

  // 2. what this browser plugged before
  for (const entry of plugged) {
    try {
      const layerId = registerManifest(entry.manifest, 'plugged');
      if (entry.enabled) {
        void dataManager.setEnabled(layerId, true, { origin: 'programmatic' }).catch((error) => {
          console.warn(`[datasets] ${layerId} restore failed:`, error);
        });
      }
    } catch (error) {
      console.warn(`[datasets] ${entry.manifest?.id} non restauré — ${error?.message || error}`);
    }
  }

  // Persist ON/OFF for plugged datasets as the reader toggles them.
  dataManager.subscribe((change) => {
    if (change?.type !== 'visibility' || !change.layerId) return;
    const entry = [...registered.values()].find((item) => datasetLayerId(item.manifest) === change.layerId);
    if (!entry || entry.origin !== 'plugged') return;
    if (change.origin !== 'user' && change.origin !== 'voice' && change.origin !== 'tool') return;
    plugged = setPluggedDatasetEnabled(plugged, entry.manifest.id, change.enabled === true);
    persist();
  });

  const api = {
    /**
     * Plug a manifest (raw or normalized). Registers, persists, and enables it.
     * @param {object} candidate
     * @param {{enable?: boolean}} [options]
     * @returns {Promise<{layerId: string, manifest: object, persisted: boolean}>}
     */
    async plug(candidate, { enable = true } = {}) {
      const manifest = normalizeDatasetManifest(candidate);
      const layerId = registerManifest(manifest, 'plugged');
      plugged = upsertPluggedDataset(plugged, manifest, { enabled: enable });
      const persisted = persist();
      if (enable) {
        try {
          await dataManager.setEnabled(layerId, true, { origin: 'user' });
        } catch (error) {
          console.warn(`[datasets] ${layerId} enable failed:`, error);
        }
      }
      notify();
      return { layerId, manifest, persisted };
    },

    /**
     * Unplug by manifest id. Catalog datasets cannot be unplugged — they come
     * back at the next build — only switched off.
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async unplug(id) {
      const entry = registered.get(id);
      if (!entry || entry.origin !== 'plugged') return false;
      const removed = await dataManager.unregisterDataset(datasetLayerId(entry.manifest));
      if (!removed) return false;
      registered.delete(id);
      plugged = removePluggedDataset(plugged, id);
      persist();
      notify();
      return true;
    },

    /** Propose a manifest for a pasted address. */
    infer(url, options = {}) {
      return inferDatasetManifest(url, { fetchImpl, ...(relay === undefined ? {} : { relay }), ...options });
    },

    /** Everything registered, with origin and current state. */
    list() {
      return [...registered.values()].map(({ manifest, origin }) => {
        const layerId = datasetLayerId(manifest);
        return {
          id: manifest.id,
          layerId,
          label: manifest.label,
          origin,
          enabled: dataManager.isEnabled(layerId),
          manifest,
        };
      });
    },

    /**
     * What a plugged layer ENDED UP drawing — its own coverage sentence.
     *
     * A proposal is a promise; the marks are the only proof. The panel says
     * this back after BRANCHER, so a reader who chose from a shortlist learns
     * in the same breath whether the choice showed what they meant — including
     * the honest "rien dans cette vue", which no proposal could have foreseen.
     *
     * @param {string} id
     * @returns {{layerId: string, count: number, coverage: string|null, error: string|null, loading: boolean}|null}
     */
    report(id) {
      const entry = registered.get(id);
      if (!entry) return null;
      const layerId = datasetLayerId(entry.manifest);
      const layer = dataManager.getAll?.().find((item) => item.id === layerId) || null;
      const stats = layer?.stats || {};
      return {
        layerId,
        count: Number(stats.count) || 0,
        coverage: stats.coverage || null,
        error: stats.error || stats.lastError || null,
        loading: stats.loading === true || stats.refreshing === true,
        progressLine: stats.progressLine || null,
      };
    },

    /** The manifest as a file: what a contributor drops into `datasets/`. */
    exportManifest(id) {
      const entry = registered.get(id);
      if (!entry) return null;
      return JSON.stringify(exportableManifest(entry.manifest), null, 2);
    },

    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Whether the last persistence write was accepted. */
    get persistent() {
      return persist();
    },
  };

  // 3. the panel
  if (mountPanel) {
    try {
      mountDatasetPlugPanel(api);
    } catch (error) {
      console.warn('[datasets] panel mount failed:', error);
    }
  }

  return api;
}
