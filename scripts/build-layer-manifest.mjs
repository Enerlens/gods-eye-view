#!/usr/bin/env node
// scripts/build-layer-manifest.mjs
//
// Writes `src/data/layerManifest.js` from the real layer modules.
//
//   npm run layers:manifest          — regenerate the file
//   npm run layers:manifest:check    — fail if the file is stale
//
// The manifest is what lets `main.js` register 60 data layers without importing
// one of them: each entry carries the identity the toggle panel needs and a
// `load()` that fetches the module on first use. See `src/data/lazyLayer.js`.
//
// Drift is not this script's problem to police — `src/data/layerManifest.test.mjs`
// re-derives every field from the modules on each `npm test` and fails loudly.
// This script exists so regenerating is one command instead of an editing chore.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LAYER_MANIFEST_SOURCES,
  describeLayerModule,
  loadLayerModules,
} from './lib/layerManifestSources.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_PATH = path.join(REPO_ROOT, 'src', 'data', 'layerManifest.js');

/** A single-quoted JS string literal, matching the surrounding source style. */
function quote(value) {
  return `'${String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')}'`;
}

/** A JS literal for a plain data value (the shapes `getParams()` returns). */
function literal(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`;
  if (typeof value === 'object') {
    const pairs = Object.entries(value)
      .map(([key, entry]) => `${/^[A-Za-z_$][\w$]*$/.test(key) ? key : quote(key)}: ${literal(entry)}`);
    return `{ ${pairs.join(', ')} }`;
  }
  throw new Error(`Cannot serialize default parameter of type ${typeof value}`);
}

/** The `load:` line for one source — one import per module, shared by its layers. */
function loaderExpression(source) {
  const specifier = quote(source.module);
  if (!source.pick) return `() => import(${specifier}).then((module) => module.default)`;
  return `() => import(${specifier})\n      .then((module) => module.default.find((layer) => layer.id === ${quote(source.pick)}))`;
}

function renderEntry(source, descriptor) {
  const lines = [
    '  Object.freeze({',
    `    id: ${quote(descriptor.id)},`,
    `    name: ${quote(descriptor.name)},`,
    `    icon: ${quote(descriptor.icon)},`,
    `    source: ${quote(descriptor.source)},`,
  ];
  if (descriptor.showInTogglePanel === false) lines.push('    showInTogglePanel: false,');
  lines.push(`    capabilities: Object.freeze([${descriptor.capabilities.map(quote).join(', ')}]),`);
  if (descriptor.defaultParams) {
    lines.push(`    defaultParams: Object.freeze(${literal(descriptor.defaultParams)}),`);
  }
  lines.push(`    load: ${loaderExpression(source)},`);
  lines.push('  }),');
  return lines.join('\n');
}

/** Build the whole file, so `--check` and the writer never diverge. */
export async function renderLayerManifest(repoRoot = REPO_ROOT) {
  // Imported here rather than at module scope: `lazyLayer.js` lives under
  // `src/` and this script is the only thing in `scripts/` that needs it.
  const { LAZY_LAYER_CAPABILITIES, LAZY_LAYER_REQUIRED_METHODS } = await import(
    path.join(repoRoot, 'src', 'data', 'lazyLayer.js')
  );
  const loaded = await loadLayerModules(repoRoot);
  const seen = new Set();
  const entries = loaded.map(({ source, layer }) => {
    for (const method of LAZY_LAYER_REQUIRED_METHODS) {
      if (typeof layer[method] !== 'function') {
        throw new Error(`Layer ${layer.id} has no ${method}() — every layer needs the four`);
      }
    }
    if (seen.has(layer.id)) throw new Error(`Duplicate layer id: ${layer.id}`);
    seen.add(layer.id);
    return renderEntry(source, describeLayerModule(layer, LAZY_LAYER_CAPABILITIES));
  });

  return `// src/data/layerManifest.js
//
// GENERATED — run \`npm run layers:manifest\` after touching a layer's identity,
// its optional methods, or its default parameters. Editing this file by hand
// works until the next regeneration overwrites it.
//
// WHAT IT IS. One entry per production data layer: the identity the toggle
// panel draws before anything is switched on, the subset of the optional layer
// API the module implements, its default parameters, and a \`load()\` that
// imports the module. \`main.js\` registers stubs built from these entries
// (\`createLazyLayer\`), so the ${entries.length} layer modules and their 4.7 MB of
// pre-minification JavaScript leave the entry chunk and arrive per layer, on
// the first toggle that needs one.
//
// Source of truth is the modules themselves: \`scripts/lib/layerManifestSources.mjs\`
// holds the ordered list, and \`layerManifest.test.mjs\` re-derives every field
// below from the real files on every \`npm test\`.

export const LAYER_MANIFEST = Object.freeze([
${entries.join('\n')}
]);
`;
}

async function main() {
  const check = process.argv.includes('--check');
  const rendered = await renderLayerManifest();
  const current = (() => {
    try {
      return readFileSync(OUTPUT_PATH, 'utf8');
    } catch {
      return null;
    }
  })();
  if (current === rendered) {
    console.log(`layerManifest.js is current (${LAYER_MANIFEST_SOURCES.length} layers).`);
    return;
  }
  if (check) {
    console.error('layerManifest.js is stale — run `npm run layers:manifest`.');
    process.exitCode = 1;
    return;
  }
  writeFileSync(OUTPUT_PATH, rendered);
  console.log(`Wrote ${path.relative(REPO_ROOT, OUTPUT_PATH)} (${LAYER_MANIFEST_SOURCES.length} layers).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
