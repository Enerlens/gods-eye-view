// scripts/lib/layerManifestSources.mjs
//
// The ordered list of production data-layer modules, and the machinery to read
// their identity back out of the real files.
//
// `src/data/layerManifest.js` is generated from this list so that `main.js` can
// register 60 layers without importing any of them (see `src/data/lazyLayer.js`
// for why). Two consumers share this module and must agree:
//
//   - `scripts/build-layer-manifest.mjs` writes the manifest.
//   - `src/data/layerManifest.test.mjs` re-derives it on every `npm test` and
//     fails on any difference, so a layer that renames itself, gains a
//     `setParams`, or changes a default cannot ship a stale stub.
//
// ADDING A LAYER: add its module here, in the position it should register, then
// run `npm run layers:manifest`. Forgetting the first step is caught anyway —
// `finalizeRegistrations()` cross-checks the registered set against
// `LAYER_STATE_REGISTRY` at boot, and the manifest test asserts the same
// equality offline.

import module from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Production layers, in registration order.
 *
 * `pick` names one layer inside a module whose default export is an ARRAY —
 * `localLayers.js` builds six from bundled packs and a live FIRMS feed. They
 * share a single dynamic import; rollup emits one chunk for all six.
 */
export const LAYER_MANIFEST_SOURCES = Object.freeze([
  { module: './flights.js' },
  { module: './militaryFlights.js' },
  { module: './earthquakes.js' },
  { module: './vigicrues.js' },
  { module: './hubeauHydrometry.js' },
  { module: './meteoFranceVigilance.js' },
  { module: './franceEnergy.js' },
  { module: './gasFrance.js' },
  { module: './edfPowerPlants.js' },
  { module: './frHydroPlants.js' },
  { module: './powerGrid.js' },
  { module: './bdtopoBuildings.js' },
  { module: './cadastreParcels.js' },
  { module: './filosofiCarreaux.js' },
  { module: './isochroneRings.js' },
  { module: './implantationFiche.js' },
  { module: './comparablesLayer.js' },
  { module: './veloPulse.js' },
  { module: './georisques.js' },
  { module: './dvfSales.js' },
  { module: './avisValeur.js' },
  { module: './dpeFrance.js' },
  { module: './urbanismeGpu.js' },
  { module: './adsUrbanisme.js' },
  { module: './idfmNetwork.js' },
  { module: './rteGeneration.js' },
  { module: './satellites.js' },
  { module: './rocketLaunches.js' },
  { module: './traffic.js' },
  { module: './roadEventsFrance.js' },
  { module: './cctv.js' },
  { module: './radio.js' },
  { module: './bikeshare.js' },
  { module: './transitFrance.js' },
  { module: './roadStatusFrance.js' },
  { module: './sharedMobilityFrance.js' },
  { module: './irveFrance.js' },
  { module: './schoolsFrance.js' },
  { module: './medecinsFrance.js' },
  { module: './meteoStationsFrance.js' },
  { module: './supFrance.js' },
  { module: './comptagesParis.js' },
  { module: './delinquanceFrance.js' },
  { module: './anfrFrance.js' },
  { module: './fraicheurParis.js' },
  { module: './sitadelFrance.js' },
  { module: './bruitFrance.js' },
  { module: './amenitiesFrance.js' },
  { module: './petiteEnfanceFrance.js' },
  { module: './aisLiveVessels.js' },
  { module: './militaryInstallations.js' },
  { module: './militaryAwareness.js' },
  { module: './marineBuoys.js' },
  { module: './localLayers.js', pick: 'local-airports' },
  { module: './localLayers.js', pick: 'local-datacenters' },
  { module: './localLayers.js', pick: 'local-dams' },
  { module: './localLayers.js', pick: 'local-ports' },
  { module: './localLayers.js', pick: 'telegeography-submarine-cables' },
  { module: './localLayers.js', pick: 'local-firms' },
  // Immediately after the LIVE fire row, because the pair is the point: one
  // says what is burning now, the other what burnt in Gironde in July 2026.
  { module: './girondeMegafire.js' },
].map((entry) => Object.freeze(entry)));

/** Vite asset suffixes and extensions node cannot load on its own. */
const ASSET_SUFFIX = /\?(url|raw|inline)$/;
const ASSET_EXTENSION = /\.(geojsonl|geojson|glb|gltf|png|jpe?g|svg|csv|txt)$/;
const ASSET_STUB = 'data:text/javascript,export default "/stub-asset";';

let hooksInstalled = false;

/**
 * Let plain node import layer modules that reach for bundler-only assets.
 *
 * `localLayers.js` imports four `.geojsonl` packs through Vite's `?url` — the
 * build turns those into hashed asset URLs, and node throws
 * ERR_UNKNOWN_FILE_EXTENSION on them. Stubbing the specifier is enough for
 * everything this module reads: identity, capabilities and default parameters
 * are all decided before any pack is fetched.
 */
export function installViteAssetStubHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  module.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (ASSET_SUFFIX.test(specifier) || ASSET_EXTENSION.test(specifier)) {
        return { url: ASSET_STUB, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
}

/**
 * Import every source in order and return the layer object each one contributes.
 *
 * @param {string} repoRoot Absolute path to the repository root.
 * @returns {Promise<Array<{source: object, layer: object}>>}
 */
export async function loadLayerModules(repoRoot) {
  installViteAssetStubHooks();
  const dataDir = path.join(repoRoot, 'src', 'data');
  const imported = new Map();
  const results = [];
  for (const source of LAYER_MANIFEST_SOURCES) {
    const absolute = path.join(dataDir, source.module);
    if (!imported.has(absolute)) {
      imported.set(absolute, await import(pathToFileURL(absolute).href));
    }
    const exported = imported.get(absolute).default;
    const layer = source.pick
      ? (Array.isArray(exported) ? exported.find((entry) => entry?.id === source.pick) : undefined)
      : exported;
    if (!layer) {
      throw new Error(`No layer for ${source.module}${source.pick ? `#${source.pick}` : ''}`);
    }
    results.push({ source, layer });
  }
  return results;
}

/**
 * The manifest fields for one layer, read off the module itself.
 *
 * `capabilities` is the subset of `LAZY_LAYER_CAPABILITIES` the module
 * implements — the stub mirrors it exactly, because the manager decides what a
 * layer supports by probing for those methods.
 *
 * @param {object} layer A layer module.
 * @param {ReadonlyArray<string>} capabilityNames `LAZY_LAYER_CAPABILITIES`.
 * @returns {object} Descriptor fields, without the `load` function.
 */
export function describeLayerModule(layer, capabilityNames) {
  const descriptor = {
    id: layer.id,
    name: layer.name,
    icon: layer.icon,
    source: layer.source,
  };
  if (layer.showInTogglePanel === false) descriptor.showInTogglePanel = false;
  descriptor.capabilities = capabilityNames.filter((name) => typeof layer[name] === 'function');
  if (typeof layer.getParams === 'function') {
    const params = layer.getParams();
    if (params && typeof params === 'object') descriptor.defaultParams = params;
  }
  return descriptor;
}
