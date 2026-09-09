#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { KEY_SETUP_KEYS } from '../src/keySetupCore.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Where `dev-fresh.sh` looks in the macOS Keychain for each provider value,
 * keyed by env var. Only the launcher reads the Keychain, so this is the one
 * place that has to know its service/account names.
 */
const KEYCHAIN_LOCATIONS = Object.freeze({
  GOOGLE_MAPS_API_KEY: [['google-maps-api', 'api-key'], ['google-maps-api', 'default'], ['google-maps-api', 'key']],
  CESIUM_ION_TOKEN: [['cesium-ion', 'token']],
  OPENAI_API_KEY: [['openai-api', 'api-key']],
  AISSTREAM_API_KEY: [['aisstream-api', 'api-key']],
  FIRMS_MAP_KEY: [['firms-map', 'map-key']],
  TOMTOM_API_KEY: [['tomtom-api', 'api-key']],
  OPENSKY_CLIENT_ID: ['opensky-network', 'opensky'].flatMap((service) => (
    ['client_id', 'client-id', 'client', 'api-key'].map((account) => [service, account])
  )),
  OPENSKY_CLIENT_SECRET: ['opensky-network', 'opensky'].flatMap((service) => (
    ['client_secret', 'client-secret', 'secret'].map((account) => [service, account])
  )),
});

/**
 * Every credential the doctor reports, DERIVED from the panel's registry.
 *
 * Two lists would drift: a key added to Provider Settings and forgotten here
 * would be editable in the app and invisible to `npm run doctor`, which is the
 * one command a new contributor runs to find out what is configured.
 */
export const CREDENTIALS = Object.freeze(KEY_SETUP_KEYS.flatMap((entry) => (
  entry.envVars.map((name) => Object.freeze({
    name,
    label: entry.envVars.length > 1 ? `${entry.title} ${name.split('_').at(-1).toLowerCase()}` : entry.title,
    keychain: KEYCHAIN_LOCATIONS[name] || [],
  }))
)));

export function isConfiguredValue(value) {
  const normalized = String(value || '').trim();
  return normalized.length > 0 && !/^(your_|replace_|example|changeme)/i.test(normalized);
}

export function classifyNodeVersion(version = process.versions.node) {
  const [major = 0, minor = 0] = String(version).split('.').map(Number);
  if (major === 24 && minor >= 14) {
    return { level: 'ok', summary: 'supported LTS and calibrated for release gates' };
  }
  if (major === 26) return { level: 'ok', summary: 'supported runtime' };
  if (major === 25) {
    return { level: 'warn', summary: 'usable but EOL; allocation benchmarks will be skipped' };
  }
  if (major < 24 || (major === 24 && minor < 14)) {
    return { level: 'error', summary: 'too old; install Node 24.14 or newer' };
  }
  // NEWER than this release has verified is a warning, never a refusal: a
  // future Node must not brick a no-terminal install with advice its user
  // cannot follow. Too-old stays an error above — old runtimes genuinely fail.
  return { level: 'warn', summary: 'newer than this release has verified; Node 24.14.x or 26.x is the tested path' };
}

/** Verify that every direct package declared by this checkout is present. */
export function hasRequiredDependencies(rootDir = ROOT) {
  try {
    const manifest = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    const packages = new Set([
      ...Object.keys(manifest.dependencies || {}),
      ...Object.keys(manifest.devDependencies || {}),
    ]);
    return packages.size > 0 && [...packages].every((name) => (
      existsSync(path.join(rootDir, 'node_modules', ...name.split('/'), 'package.json'))
    ));
  } catch {
    return false;
  }
}

/** Return the npm command and spawn mode required by the target platform. */
export function npmProcessSpec(platform = process.platform) {
  const windows = platform === 'win32';
  return { command: windows ? 'npm.cmd' : 'npm', shell: windows };
}

/** Read one key from Vite's dotenv file ladder without depending on Vite. */
export function readDoctorDotenvValue(
  variableName,
  rootDir = ROOT,
  mode = 'development',
) {
  const key = String(variableName || '').trim();
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) return '';

  const values = {};
  for (const filename of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    const filepath = path.join(rootDir, filename);
    if (!existsSync(filepath)) continue;
    try {
      Object.assign(values, parseEnv(readFileSync(filepath, 'utf8')));
    } catch {
      // A malformed optional dotenv file must not crash the setup diagnosis.
    }
  }
  return String(values[key] ?? '');
}

function hasKeychainItem(service, account) {
  if (process.platform !== 'darwin') return false;
  const result = spawnSync('security', [
    'find-generic-password',
    '-s', service,
    '-a', account,
  ], { stdio: 'ignore' });
  return result.status === 0;
}

export function resolveCredential(spec, {
  includeKeychain = true,
  authoritativeEnvironment = false,
  environment = process.env,
  rootDir = ROOT,
  keychainLookup = hasKeychainItem,
} = {}) {
  const environmentDefinesKey = Object.prototype.hasOwnProperty.call(environment, spec.name);
  if (isConfiguredValue(environment[spec.name])) return { configured: true, source: 'environment' };
  if (authoritativeEnvironment && environmentDefinesKey) return { configured: false, source: null };
  if (isConfiguredValue(readDoctorDotenvValue(spec.name, rootDir))) return { configured: true, source: 'dotenv files' };
  if (includeKeychain && spec.keychain.some(([service, account]) => keychainLookup(service, account))) {
    return { configured: true, source: 'macOS Keychain' };
  }
  return { configured: false, source: null };
}

/**
 * What the globe opens on, in this fork's own terms.
 *
 * Not upstream's three-way route: an EEA-billed Google project is REFUSED
 * Photorealistic 3D Tiles and satellite imagery (403 PERMISSION_DENIED) while
 * still serving roadmap and terrain on the same key, so a Google key alone is
 * not a promise of a 3D globe from France — an ion token is, because ion hosts
 * the same Google asset and is measured working from here. Keyless is a
 * supported configuration, not a degraded one: Esri worldwide, IGN over France.
 * @param {(name: string) => boolean} configured
 * @returns {string}
 */
export function startupMapSummary(configured) {
  const google = configured('GOOGLE_MAPS_API_KEY');
  const ion = configured('CESIUM_ION_TOKEN');
  if (google && ion) return 'Google 3D direct, with Cesium ion as the fallback route (and Bing + world terrain)';
  if (google) return 'Google 3D direct — an EEA-billed key gets Plan/Relief only, add a Cesium ion token for the 3D globe';
  if (ion) return 'Google 3D through Cesium ion, plus Bing imagery and world terrain';
  return 'Keyless: Esri World Imagery worldwide, IGN Ortho and Plan IGN over France';
}

export function buildCapabilitySummary(credentials) {
  const configured = (name) => credentials[name]?.configured === true;
  return {
    map: startupMapSummary(configured),
    flights: configured('OPENSKY_CLIENT_ID') && configured('OPENSKY_CLIENT_SECRET')
      ? 'OpenSky OAuth credentials present (runtime mode and validity not verified)'
      : 'OpenSky OAuth credentials not configured',
    voice: configured('OPENAI_API_KEY')
      ? 'OpenAI Realtime (speech to speech)'
      : configured('OPENROUTER_API_KEY')
        ? 'OpenRouter (browser speech in and out, turn-based)'
        : 'off until an OpenAI or OpenRouter key is added',
    vessels: configured('AISSTREAM_API_KEY') ? 'live AISStream feed' : 'off until an AISStream key is added',
    fires: configured('FIRMS_MAP_KEY') ? 'live NASA FIRMS feed' : 'off until a FIRMS key is added',
    traffic: configured('TOMTOM_API_KEY') ? 'live TomTom flow' : 'built-in traffic simulation',
    generation: configured('RTE_CLIENT_ID') && configured('RTE_CLIENT_SECRET')
      ? 'live per-unit output from RTE'
      : 'the 171-unit French fleet without live output (the register ships with the app)',
    vigilance: configured('METEOFRANCE_API_KEY')
      ? 'the contracted Météo-France API'
      : 'the data.gouv.fr mirror (~20 s behind, no key needed)',
    missions: configured('LL2_API_TOKEN')
      ? 'Launch Library 2 token allowance'
      : 'Launch Library 2 public access',
  };
}

export function inspectSetup({ includeKeychain = true, authoritativeEnvironment = false } = {}) {
  const node = classifyNodeVersion();
  const npm = npmProcessSpec();
  const npmResult = spawnSync(npm.command, ['--version'], {
    encoding: 'utf8',
    shell: npm.shell,
  });
  const credentials = Object.fromEntries(CREDENTIALS.map((spec) => [
    spec.name,
    resolveCredential(spec, { includeKeychain, authoritativeEnvironment }),
  ]));
  const dependenciesInstalled = hasRequiredDependencies();
  return {
    ready: node.level !== 'error' && npmResult.status === 0 && dependenciesInstalled,
    node: { version: process.versions.node, ...node },
    npm: npmResult.status === 0
      ? { available: true, version: String(npmResult.stdout || '').trim() }
      : { available: false, version: null },
    dependenciesInstalled,
    credentials,
    capabilities: buildCapabilitySummary(credentials),
  };
}

function symbol(level) {
  if (level === 'ok') return 'OK';
  if (level === 'warn') return 'WARN';
  return 'ERROR';
}

export function formatSetupReport(report, { readyMessage } = {}) {
  const hasKeychainSource = Object.values(report.credentials || {})
    .some((credential) => credential?.source === 'macOS Keychain');
  const resolvedReadyMessage = readyMessage || (hasKeychainSource
    ? 'Ready. Run ./scripts/dev-fresh.sh, then open http://localhost:4173.'
    : 'Ready. Run npm run dev, then open http://localhost:4173.');
  const lines = [
    "God's Eye View setup doctor",
    '',
    `[${symbol(report.node.level)}] Node ${report.node.version}: ${report.node.summary}`,
    report.npm.available ? `[OK] npm ${report.npm.version}` : '[ERROR] npm was not found',
    report.dependenciesInstalled ? '[OK] dependencies installed' : '[WARN] dependencies missing; run npm install',
    '',
    `Map:     ${report.capabilities.map}`,
    `Flights: ${report.capabilities.flights}`,
    `Voice:   ${report.capabilities.voice}`,
    `Vessels: ${report.capabilities.vessels}`,
    `Fires:   ${report.capabilities.fires}`,
    `Traffic: ${report.capabilities.traffic}`,
    `Prod FR: ${report.capabilities.generation}`,
    `Vigilance: ${report.capabilities.vigilance}`,
    `Missions: ${report.capabilities.missions}`,
    '',
    'Configured providers:',
    ...CREDENTIALS.map((spec) => {
      const state = report.credentials[spec.name];
      return state.configured
        ? `  [OK] ${spec.label} (${state.source})`
        : `  [--] ${spec.label}`;
    }),
    '',
    report.ready
      ? resolvedReadyMessage
      : 'Setup needs attention before the app can start.',
  ];
  return lines.join('\n');
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const report = inspectSetup();
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else console.log(formatSetupReport(report));
  if (!report.ready) process.exitCode = 1;
}
