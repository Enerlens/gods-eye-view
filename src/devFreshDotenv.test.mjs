import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readDotenvValue } from '../scripts/read-dotenv-value.mjs';

test('dotenv reader preserves values without executing shell metacharacters', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gev-dotenv-'));
  const marker = path.join(root, 'must-not-exist');
  try {
    await fs.writeFile(path.join(root, '.env'), [
      'PLAIN_KEY=plain-value',
      'QUOTED_KEY="quoted value"',
      `SHELL_PAYLOAD=$(touch ${marker})`,
      'BACKTICK_PAYLOAD=`printf owned`',
    ].join('\n'));
    assert.equal(readDotenvValue('PLAIN_KEY', root), 'plain-value');
    assert.equal(readDotenvValue('QUOTED_KEY', root), 'quoted value');
    assert.equal(readDotenvValue('SHELL_PAYLOAD', root), `$(touch ${marker})`);
    // dotenv treats backticks as quote delimiters, but never executes them.
    assert.equal(readDotenvValue('BACKTICK_PAYLOAD', root), 'printf owned');
    await assert.rejects(fs.access(marker));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('an inherited export never masks the value written in the file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gev-dotenv-'));
  const had = Object.prototype.hasOwnProperty.call(process.env, 'GEV_INHERIT_PROBE');
  const previous = process.env.GEV_INHERIT_PROBE;
  try {
    await fs.writeFile(path.join(root, '.env'), 'GEV_INHERIT_PROBE=from-dotenv\n');

    // An empty export is how a shell says "unset" to the launcher's `:-`
    // fallbacks, and Vite's loadEnv otherwise lets process.env win — which is
    // exactly how a configured key went missing.
    process.env.GEV_INHERIT_PROBE = '';
    assert.equal(readDotenvValue('GEV_INHERIT_PROBE', root), 'from-dotenv');

    // A non-empty inherited value must not win either: this reader answers for
    // the files, and the caller decides precedence.
    process.env.GEV_INHERIT_PROBE = 'from-shell';
    assert.equal(readDotenvValue('GEV_INHERIT_PROBE', root), 'from-dotenv');

    // The caller's own environment survives the read unchanged.
    assert.equal(process.env.GEV_INHERIT_PROBE, 'from-shell');

    delete process.env.GEV_INHERIT_PROBE;
    assert.equal(readDotenvValue('GEV_INHERIT_PROBE', root), 'from-dotenv');
    assert.equal(Object.prototype.hasOwnProperty.call(process.env, 'GEV_INHERIT_PROBE'), false);
  } finally {
    if (had) process.env.GEV_INHERIT_PROBE = previous;
    else delete process.env.GEV_INHERIT_PROBE;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('dev-fresh captures parent-shell key provenance before it reads .env', async () => {
  // The in-app panel edits the repo-root .env and nothing else. A key that
  // reached the server from somewhere else must be shown read-only — writing
  // it to .env would look like it worked and change nothing. The server can
  // usually tell by comparing values, EXCEPT when both hold the same bytes;
  // this names-only marker closes that case, so it has to be captured before
  // the launcher starts resolving .env into the same variables.
  const source = await fs.readFile(new URL('../scripts/dev-fresh.sh', import.meta.url), 'utf8');
  const capture = source.indexOf('KEY_SETUP_EXTERNAL_KEYS=()');
  const dotenvResolution = source.indexOf('GOOGLE_MAPS_API_KEY_ENV="${GOOGLE_MAPS_API_KEY:-}"');
  assert.ok(capture > 0, 'the provenance block exists');
  assert.ok(capture < dotenvResolution, 'provenance is captured before any .env read');

  const { knownKeySetupEnvVars } = await import('./keySetupCore.mjs');
  const captured = source.slice(capture, source.indexOf('unset key_name'));
  for (const name of knownKeySetupEnvVars()) {
    assert.ok(captured.includes(name), `${name} is in the registry but not in the marker`);
  }
  assert.match(source, /put_env GEV_LAUNCHER "dev-fresh"/);
  assert.match(source, /put_env GEV_KEY_SETUP_EXTERNAL_KEYS "\$\{KEY_SETUP_EXTERNAL_KEYS_CSV\}"/);
});

test('a Keychain hit is marked external too — the panel could not rewrite it', async () => {
  // This fork resolves Google from the Keychain in PREFERENCE to .env, so a
  // Keychain value and an identical .env line are indistinguishable to the
  // server by value alone. Every Keychain resolution therefore marks its name.
  const source = await fs.readFile(new URL('../scripts/dev-fresh.sh', import.meta.url), 'utf8');
  assert.match(source, /GOOGLE_MAPS_API_KEY="\$\{GOOGLE_MAPS_API_KEY_KEYCHAIN\}"\n  mark_key_external GOOGLE_MAPS_API_KEY/);
  for (const name of ['OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET']) {
    assert.match(source, new RegExp(`mark_key_external ${name}`), `${name} keychain hit unmarked`);
  }
  for (const name of ['OPENAI_API_KEY', 'AISSTREAM_API_KEY', 'CESIUM_ION_TOKEN', 'TOMTOM_API_KEY', 'FIRMS_MAP_KEY']) {
    assert.match(source, new RegExp(`resolve_from_keychain ${name} `), `${name} bypasses the marking helper`);
  }
  assert.match(source, /mark_key_external "\$\{name\}"/, 'the helper marks what it resolved');
});

const bashTest = process.platform === 'win32' ? test.skip : test;

bashTest('the provenance block runs under set -u on stock macOS bash 3.2', async () => {
  // Expanding an EMPTY array under `set -u` is fatal on bash 3.2, which is what
  // /bin/bash still is on macOS. Without the `[*]:-` guard a keyless launch
  // dies on the CSV line before doing anything at all.
  const source = await fs.readFile(new URL('../scripts/dev-fresh.sh', import.meta.url), 'utf8');
  const start = source.indexOf('KEY_SETUP_EXTERNAL_KEYS=()');
  const block = source.slice(start, source.indexOf('unset key_name'));
  assert.match(source, /\$\{KEY_SETUP_EXTERNAL_KEYS\[\*\]:-\}/, 'the 3.2-safe idiom is the one shipped');

  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const probe = `set -u\n${block}\nprintf '%s' "$(IFS=,; printf '%s' "\${KEY_SETUP_EXTERNAL_KEYS[*]:-}")"`;
  const keyless = await run('/bin/bash', ['-c', probe], { env: { PATH: process.env.PATH } });
  assert.equal(keyless.stdout, '', 'keyless produces an empty marker, not a crash');
  const keyed = await run('/bin/bash', ['-c', probe], {
    env: { PATH: process.env.PATH, GOOGLE_MAPS_API_KEY: 'k', RTE_CLIENT_ID: 'r' },
  });
  assert.equal(keyed.stdout, 'GOOGLE_MAPS_API_KEY,RTE_CLIENT_ID');
});
