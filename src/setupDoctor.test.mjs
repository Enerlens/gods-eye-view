import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildCapabilitySummary,
  CREDENTIALS,
  classifyNodeVersion,
  formatSetupReport,
  hasRequiredDependencies,
  isConfiguredValue,
  npmProcessSpec,
  readDoctorDotenvValue,
  resolveCredential,
} from '../scripts/setup-doctor.mjs';
import { knownKeySetupEnvVars } from './keySetupCore.mjs';

const credential = (name) => CREDENTIALS.find((spec) => spec.name === name);

test('doctor distinguishes supported, usable EOL, and unsupported Node versions', () => {
  assert.equal(classifyNodeVersion('24.14.0').level, 'ok');
  assert.equal(classifyNodeVersion('26.1.0').level, 'ok');
  assert.equal(classifyNodeVersion('25.6.1').level, 'warn');
  assert.match(classifyNodeVersion('25.6.1').summary, /usable but EOL/);
  assert.equal(classifyNodeVersion('22.0.0').level, 'error');
  // A FUTURE Node is a warning, never an install-bricking refusal: the
  // no-terminal user it would stop cannot act on "install Node 24".
  assert.equal(classifyNodeVersion('27.0.0').level, 'warn');
  assert.match(classifyNodeVersion('27.0.0').summary, /newer than this release has verified/);
});

test('doctor rejects an empty node_modules and requires every direct package', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gev-doctor-deps-'));
  try {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      dependencies: { vite: '1.0.0' },
      devDependencies: { '@scope/tool': '1.0.0' },
    }));
    mkdirSync(path.join(root, 'node_modules'));
    assert.equal(hasRequiredDependencies(root), false);

    for (const packagePath of ['vite', '@scope/tool']) {
      const directory = path.join(root, 'node_modules', ...packagePath.split('/'));
      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, 'package.json'), '{}');
    }
    assert.equal(hasRequiredDependencies(root), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('placeholder values are never counted as configured credentials', () => {
  assert.equal(isConfiguredValue(''), false);
  assert.equal(isConfiguredValue('your_google_maps_api_key_here'), false);
  assert.equal(isConfiguredValue('replace_me'), false);
  assert.equal(isConfiguredValue('configured-value'), true);
});

test('doctor selects a Windows-safe npm process without changing Unix behavior', () => {
  assert.deepEqual(npmProcessSpec('win32'), { command: 'npm.cmd', shell: true });
  assert.deepEqual(npmProcessSpec('darwin'), { command: 'npm', shell: false });
  assert.deepEqual(npmProcessSpec('linux'), { command: 'npm', shell: false });
});

test('doctor recognizes every OpenSky OAuth keychain alias used by dev-fresh', () => {
  assert.deepEqual(
    credential('OPENSKY_CLIENT_ID').keychain,
    [
      ['opensky-network', 'client_id'],
      ['opensky-network', 'client-id'],
      ['opensky-network', 'client'],
      ['opensky-network', 'api-key'],
      ['opensky', 'client_id'],
      ['opensky', 'client-id'],
      ['opensky', 'client'],
      ['opensky', 'api-key'],
    ],
  );
  assert.deepEqual(
    credential('OPENSKY_CLIENT_SECRET').keychain,
    [
      ['opensky-network', 'client_secret'],
      ['opensky-network', 'client-secret'],
      ['opensky-network', 'secret'],
      ['opensky', 'client_secret'],
      ['opensky', 'client-secret'],
      ['opensky', 'secret'],
    ],
  );
});

test('Pinokio-scoped diagnosis ignores Keychain items its start path does not import', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gev-pinokio-doctor-'));
  try {
    const spec = credential('OPENAI_API_KEY');
    const keychainLookup = () => true;
    assert.deepEqual(resolveCredential(spec, {
      environment: {},
      rootDir: root,
      keychainLookup,
    }), { configured: true, source: 'macOS Keychain' });
    assert.deepEqual(resolveCredential(spec, {
      includeKeychain: false,
      environment: {},
      rootDir: root,
      keychainLookup,
    }), { configured: false, source: null });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Pinokio-scoped diagnosis does not count dotenv values shadowed by blank app fields', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gev-pinokio-doctor-env-'));
  try {
    const spec = credential('GOOGLE_MAPS_API_KEY');
    writeFileSync(path.join(root, '.env.local'), 'GOOGLE_MAPS_API_KEY=dotenv-only\n');
    assert.deepEqual(resolveCredential(spec, {
      environment: { GOOGLE_MAPS_API_KEY: '' },
      rootDir: root,
      keychainLookup: () => false,
    }), { configured: true, source: 'dotenv files' });
    assert.deepEqual(resolveCredential(spec, {
      authoritativeEnvironment: true,
      environment: { GOOGLE_MAPS_API_KEY: '' },
      rootDir: root,
      keychainLookup: () => false,
    }), { configured: false, source: null });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('doctor reads the dotenv ladder without requiring Vite to be installed', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gev-doctor-'));
  try {
    writeFileSync(path.join(root, '.env'), 'GEV_TEST_KEY=base\n');
    writeFileSync(path.join(root, '.env.local'), 'GEV_TEST_KEY=local\n');
    writeFileSync(path.join(root, '.env.development.local'), 'GEV_TEST_KEY=mode-local\n');
    assert.equal(readDoctorDotenvValue('GEV_TEST_KEY', root), 'mode-local');
    assert.equal(readDoctorDotenvValue('not valid', root), '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Every registry credential, unconfigured, so a test names only what it sets. */
function noCredentials() {
  return Object.fromEntries(CREDENTIALS.map((spec) => [spec.name, { configured: false }]));
}

test('doctor describes the credential ladder without exposing values', () => {
  const credentials = {
    ...noCredentials(),
    CESIUM_ION_TOKEN: { configured: true, source: 'environment' },
    OPENAI_API_KEY: { configured: true, source: 'dotenv files' },
    LL2_API_TOKEN: { configured: true, source: 'environment' },
  };
  const capabilities = buildCapabilitySummary(credentials);
  assert.match(capabilities.map, /Google 3D through Cesium ion/);
  assert.match(capabilities.map, /Bing imagery and world terrain/);
  assert.equal(capabilities.voice, 'OpenAI Realtime (speech to speech)');
  assert.match(capabilities.missions, /token allowance/);
  assert.equal(capabilities.flights, 'OpenSky OAuth credentials not configured');
  // Keyless is a supported configuration on this fork, and the report says what
  // it actually gets rather than what it lacks.
  assert.match(buildCapabilitySummary(noCredentials()).map, /Esri World Imagery worldwide, IGN Ortho and Plan IGN over France/);

  const report = formatSetupReport({
    ready: true,
    node: { version: '25.6.1', level: 'warn', summary: 'usable but EOL' },
    npm: { available: true, version: '11.0.0' },
    dependenciesInstalled: true,
    credentials,
    capabilities,
  });
  assert.doesNotMatch(report, /configured-value/);
  assert.match(report, /CESIUM ION \(environment\)/);
  assert.match(report, /LAUNCH LIBRARY \(environment\)/);

  const pinokioReport = formatSetupReport({
    ready: true,
    node: { version: '24.14.0', level: 'ok', summary: 'supported' },
    npm: { available: true, version: '11.0.0' },
    dependenciesInstalled: true,
    credentials,
    capabilities,
  }, { readyMessage: 'Ready. Return to Pinokio and choose Start.' });
  assert.match(pinokioReport, /Return to Pinokio and choose Start/);
  assert.doesNotMatch(pinokioReport, /npm run dev/);
});

test('the doctor reports exactly the registry Provider Settings edits', () => {
  // Two lists would drift: a key added to the panel and forgotten here would be
  // editable in the app and invisible to the one command a new contributor runs.
  const reported = new Set(CREDENTIALS.map((spec) => spec.name));
  assert.deepEqual(reported, knownKeySetupEnvVars());
  // A two-variable entry must not collapse to one indistinguishable label.
  const rte = CREDENTIALS.filter((spec) => spec.name.startsWith('RTE_'));
  assert.equal(rte.length, 2);
  assert.notEqual(rte[0].label, rte[1].label);
});

test('this fork tells the truth about a Google key from France', () => {
  // An EEA-billed Google project is refused Photorealistic 3D Tiles outright,
  // so "you have a Google key" is not "you have a 3D globe". The doctor must
  // not send someone off to debug a key that is working exactly as billed.
  const withGoogle = buildCapabilitySummary({ ...noCredentials(), GOOGLE_MAPS_API_KEY: { configured: true, source: 'environment' } });
  assert.match(withGoogle.map, /EEA-billed key gets Plan\/Relief only/);
  assert.match(withGoogle.map, /add a Cesium ion token/);
  const withBoth = buildCapabilitySummary({
    ...noCredentials(),
    GOOGLE_MAPS_API_KEY: { configured: true, source: 'environment' },
    CESIUM_ION_TOKEN: { configured: true, source: 'environment' },
  });
  assert.match(withBoth.map, /with Cesium ion as the fallback route/);
});

test('the second voice route is reported when it is the only one configured', () => {
  // OPENROUTER_API_KEY is an alternative to the OpenAI key on this fork, not an
  // addition. A doctor that only knew about OpenAI would report the mic as off
  // on a machine where it works.
  const openrouter = buildCapabilitySummary({ ...noCredentials(), OPENROUTER_API_KEY: { configured: true, source: 'dotenv files' } });
  assert.match(openrouter.voice, /OpenRouter/);
  assert.match(openrouter.voice, /turn-based/);
  assert.equal(buildCapabilitySummary(noCredentials()).voice, 'off until an OpenAI or OpenRouter key is added');
});

test('the French feeds report what they do WITHOUT a key, not only what they lack', () => {
  const bare = buildCapabilitySummary(noCredentials());
  // The generation layer ships its own register; the credential adds live output.
  assert.match(bare.generation, /171-unit French fleet/);
  assert.match(bare.generation, /without live output/);
  // Vigilance works keyless off the data.gouv.fr mirror.
  assert.match(bare.vigilance, /data\.gouv\.fr mirror/);
  const keyed = buildCapabilitySummary({
    ...noCredentials(),
    RTE_CLIENT_ID: { configured: true, source: 'dotenv files' },
    RTE_CLIENT_SECRET: { configured: true, source: 'dotenv files' },
    METEOFRANCE_API_KEY: { configured: true, source: 'dotenv files' },
  });
  assert.match(keyed.generation, /live per-unit output/);
  assert.match(keyed.vigilance, /contracted Météo-France API/);
});

test('doctor sends Keychain-backed reports to dev-fresh and describes OpenSky as presence only', () => {
  const credentials = {
    ...noCredentials(),
    GOOGLE_MAPS_API_KEY: { configured: true, source: 'macOS Keychain' },
    OPENSKY_CLIENT_ID: { configured: true, source: 'environment' },
    OPENSKY_CLIENT_SECRET: { configured: true, source: 'environment' },
  };
  const capabilities = buildCapabilitySummary(credentials);
  const output = formatSetupReport({
    ready: true,
    node: { level: 'ok', version: '24.14.0', summary: 'supported' },
    npm: { available: true, version: '11.0.0' },
    dependenciesInstalled: true,
    capabilities,
    credentials,
  });
  assert.match(output, /Run \.\/scripts\/dev-fresh\.sh/);
  assert.doesNotMatch(output, /Run npm run dev/);
  assert.match(capabilities.flights, /credentials present/);
  assert.match(capabilities.flights, /runtime mode and validity not verified/);
  assert.doesNotMatch(capabilities.flights, /polling/);
});

test('doctor never calls a dependency-missing setup ready', () => {
  const credentials = noCredentials();
  const output = formatSetupReport({
    ready: false,
    node: { level: 'ok', version: '24.14.0', summary: 'supported' },
    npm: { available: true, version: '11.0.0' },
    dependenciesInstalled: false,
    capabilities: buildCapabilitySummary(credentials),
    credentials,
  });
  assert.match(output, /dependencies missing; run npm install/);
  assert.match(output, /Setup needs attention/);
  assert.doesNotMatch(output, /Ready\. Run/);
});
