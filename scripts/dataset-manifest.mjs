#!/usr/bin/env node
/**
 * From a dataset address to a manifest file — the contributor's path into the
 * dataset box, and the step after a search on the data.gouv.fr MCP server.
 *
 *   npm run dataset:manifest -- https://www.data.gouv.fr/datasets/geodae-base-nationale-des-defibrillateurs/
 *   npm run dataset:manifest -- edb6a9e1-2f16-4bbf-99e7-c3eb6b90794c --id defibrillateurs
 *   npm run dataset:manifest -- https://opendata.paris.fr/explore/dataset/arbresremarquablesparis/ --dry
 *
 * Reads the platform's own metadata (title, publisher, licence, columns, a
 * sample), guesses the geometry, and writes `datasets/<id>.json` — or prints
 * it with `--dry`. It refuses to write a manifest that does not validate, and
 * it always ends with the same reminder the app shows: the licence was read
 * from an API and is confirmed on the dataset's page, nowhere else.
 *
 * Options:
 *   --id <slug>        override the id (and the file name)
 *   --out <path>       write elsewhere than datasets/<id>.json
 *   --resource <uuid>  pick one resource of a data.gouv.fr dataset
 *   --dry              print, do not write
 *   --force            overwrite an existing file
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferDatasetManifest } from '../src/data/datasetInference.js';
import { DATASET_ID_PATTERN, datasetManifestFaults, exportableManifest, normalizeDatasetManifest, stripNulls } from '../src/data/datasetManifest.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : null;
};
const flag = (name) => args.includes(name);
const target = args.find((arg) => !arg.startsWith('--') && ![option('--id'), option('--out'), option('--resource')].includes(arg));

if (!target || flag('--help')) {
  console.error('usage: node scripts/dataset-manifest.mjs <url|uuid|slug> [--id slug] [--out path] [--resource uuid] [--dry] [--force]');
  process.exit(target ? 0 : 2);
}

const result = await inferDatasetManifest(target, { relay: null, resourceId: option('--resource') });
const manifest = { ...result.manifest };
const id = option('--id');
if (id) {
  if (!DATASET_ID_PATTERN.test(id)) {
    console.error(`--id « ${id} » : minuscules, chiffres et tirets, 2 à 63 caractères`);
    process.exit(2);
  }
  manifest.id = id;
}

console.error(`Plateforme : ${result.platform}`);
if (Array.isArray(result.resources) && result.resources.length > 1) {
  console.error(`Ressources (${result.resources.length}) — --resource <uuid> pour en choisir une autre :`);
  for (const resource of result.resources) {
    const mark = resource.id === manifest.source?.resourceId ? '→' : ' ';
    console.error(`  ${mark} ${resource.id}  ${resource.format || '?'}  ${resource.title || ''}`);
  }
}
if (Array.isArray(result.columns) && result.columns.length) {
  console.error(`Colonnes (${result.columns.length}) : ${result.columns.join(', ')}`);
}
for (const note of result.notes || []) console.error(`Note : ${note}`);

const faults = datasetManifestFaults(manifest);
if (faults.length) {
  console.error('\nLe brouillon ne valide pas encore :');
  for (const fault of faults) console.error(`  · ${fault}`);
  console.error('\nBrouillon :');
  console.log(JSON.stringify(stripNulls(manifest), null, 2));
  process.exit(1);
}

const normalized = normalizeDatasetManifest(manifest);
const text = `${JSON.stringify(exportableManifest(normalized), null, 2)}\n`;
const out = option('--out') || path.join(REPO_ROOT, 'datasets', `${normalized.id}.json`);

if (flag('--dry')) {
  console.log(text);
} else {
  if (existsSync(out) && !flag('--force')) {
    console.error(`\n${path.relative(REPO_ROOT, out)} existe déjà — --force pour l'écraser.`);
    process.exit(1);
  }
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, text, 'utf8');
  console.error(`\nÉcrit : ${path.relative(REPO_ROOT, out)}`);
}
console.error(`\nLicence lue : « ${normalized.attribution.licence} » — à confirmer sur ${normalized.attribution.url || 'la page du jeu'} avant de livrer.`);
