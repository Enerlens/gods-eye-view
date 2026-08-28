/**
 * Fetches the reference data this audit measures OSM against, into the
 * gitignored `.gev-cache/grid-audit/`.
 *
 * NOTHING here is committed, and nothing here is served to the app. RTE
 * withdrew the GPS geometry of the transmission network in 2025 "pour des
 * raisons de sécurité publique", and this project deliberately does not
 * republish it — the Power Grid layer draws OpenStreetMap and only
 * OpenStreetMap. What the withdrawn data is still good for is checking
 * whether OSM is any good, which is a use that publishes nothing.
 *
 * Both sources are Licence Ouverte 2.0, which is perpetual and irrevocable
 * for copies distributed under it:
 *
 *   - the routes, from the French State's own geo-ide mirror of the ODRÉ
 *     snapshot of 30 June 2023, republished by the DDTM de l'Eure and still
 *     served today (the `_027` in the layer name is the publishing
 *     département, not a clip — the file is France Métropolitaine entire);
 *   - the substations, from the Internet Archive's capture of the ODRÉ export
 *     endpoint on 27 June 2023, the last one before the fields lost their
 *     coordinates.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const CACHE_DIR = path.join(process.cwd(), '.gev-cache', 'grid-audit');

/** Where each audit looks for its reference input. */
export const REFERENCE = {
  substations: path.join(CACHE_DIR, 'rte-postes-2023.json'),
  aerial: {
    dir: path.join(CACHE_DIR, 'aerial', 'dataset'),
    stem: 'N_RESEAU_ELECTRIQUE_AERIEN_L_027',
  },
  underground: {
    dir: path.join(CACHE_DIR, 'underground', 'dataset'),
    stem: 'N_RESEAU_ELECTRIQUE_SOUTERRAIN_L_027',
  },
};

const SUBSTATIONS_URL =
  'https://web.archive.org/web/20230627070208id_/https://odre.opendatasoft.com/explore/dataset/' +
  'postes-electriques-rte/download?format=json&timezone=Europe/Berlin&use_labels_for_header=false';
const ATOM = 'https://atom.geo-ide.developpement-durable.gouv.fr/atomArchive/GetResource';
const AERIAL_URL = `${ATOM}?id=67a174b6-b49a-4aa3-8f1b-07a92c82b911&dataType=dataset`;
const UNDERGROUND_URL = `${ATOM}?id=0d0a1d88-d5a0-4bae-98b1-b6010d461292&dataType=dataset`;

/** Download to `target` unless it is already there. */
async function fetchOnce(url, target, label) {
  if (fs.existsSync(target)) {
    process.stderr.write(`  [have]  ${label}\n`);
    return;
  }
  await fsp.mkdir(path.dirname(target), { recursive: true });
  process.stderr.write(`  [get]   ${label} …\n`);
  const res = await fetch(url, {
    headers: { 'user-agent': 'gods-eye-view-grid-audit/1.0 (OSM coverage check)' },
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  // Write through a temp sibling so an interrupted download never leaves a
  // half file that the next run would happily treat as cached.
  const tmp = `${target}.part`;
  await fsp.writeFile(tmp, body);
  await fsp.rename(tmp, target);
  process.stderr.write(`  [ok]    ${label} — ${(body.length / 1e6).toFixed(1)} MB\n`);
}

/** Unzip one ATOM archive into `dir`, unless its .shp is already there. */
async function fetchShapefile(url, zipName, dir, stem, label) {
  if (fs.existsSync(path.join(dir, `${stem}.shp`))) {
    process.stderr.write(`  [have]  ${label}\n`);
    return;
  }
  const zip = path.join(CACHE_DIR, zipName);
  await fetchOnce(url, zip, `${label} (zip)`);
  const into = path.dirname(dir);
  await fsp.mkdir(into, { recursive: true });
  await execFileAsync('unzip', ['-oq', zip, '-d', into]);
  process.stderr.write(`  [ok]    ${label} — extracted\n`);
}

/** Make sure every reference input is on disk. Idempotent. */
export async function ensureReference() {
  process.stderr.write('Reference data (Licence Ouverte 2.0, cached, never committed)\n');
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  await fetchOnce(SUBSTATIONS_URL, REFERENCE.substations, 'RTE substations, 27 June 2023 (Internet Archive)');
  await fetchShapefile(AERIAL_URL, 'aerial.zip', REFERENCE.aerial.dir, REFERENCE.aerial.stem, 'RTE aerial routes, 30 June 2023');
  await fetchShapefile(
    UNDERGROUND_URL,
    'underground.zip',
    REFERENCE.underground.dir,
    REFERENCE.underground.stem,
    'RTE underground routes, 30 June 2023',
  );
  process.stderr.write('\n');
}
