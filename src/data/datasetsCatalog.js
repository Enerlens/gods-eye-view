/*
 * THE SHIPPED CATALOG — every `datasets/*.json` in the repository.
 *
 * This is the contributor's path into the dataset box: drop one manifest file
 * in `datasets/`, and the layer is on the panel at the next build, with its
 * group, its source line, its credit and its card — no module, no registry
 * edit, no proxy. `datasetsCatalog.test.mjs` validates every file the way
 * the boot validates the core registries, so a broken manifest fails the
 * suite rather than vanishing from the panel.
 *
 * `import.meta.glob` is Vite's: it is rewritten at build time into an object
 * of eager imports. Under plain Node (the unit runner) it does not exist and
 * the call throws, which the guard turns into an empty catalog — the test
 * reads the directory itself.
 *
 * @module data/datasetsCatalog
 */

import { datasetManifestFaults, normalizeDatasetManifest } from './datasetManifest.js';

let modules = {};
try {
  modules = import.meta.glob('../../datasets/*.json', { eager: true, import: 'default' });
} catch {
  modules = {};
}

/**
 * Normalize a raw catalog, reporting the files that do not pass.
 * @param {Record<string, unknown>} raw Path → manifest object.
 * @param {(message: string) => void} [warn]
 * @returns {ReadonlyArray<object>} Frozen manifests, sorted by id.
 */
export function normalizeCatalog(raw, warn = (message) => console.warn(message)) {
  const manifests = [];
  const seen = new Set();
  for (const [file, candidate] of Object.entries(raw || {})) {
    const faults = datasetManifestFaults(candidate);
    if (faults.length) {
      warn(`[datasets] ${file} ignoré : ${faults.join(' ; ')}`);
      continue;
    }
    const manifest = normalizeDatasetManifest(candidate);
    if (seen.has(manifest.id)) {
      warn(`[datasets] ${file} ignoré : id « ${manifest.id} » déjà pris`);
      continue;
    }
    seen.add(manifest.id);
    manifests.push(manifest);
  }
  manifests.sort((a, b) => a.id.localeCompare(b.id));
  return Object.freeze(manifests);
}

/** The manifests shipped with this build. */
export const CATALOG_DATASET_MANIFESTS = normalizeCatalog(modules);
