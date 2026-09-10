// Which ref the staging URL is allowed to show.
//
// The deploy agent is a shell script on a box nobody looks at, and its one
// decision — "what does gev.enerlens.com serve right now?" — failed silently on
// 2026-09-10: PR #155 was cut at #152, so #153 and #154 were merged into main
// and stayed off the URL, with the container happily rebuilt and healthy. No
// runtime test can see that, because every artefact involved is correct; only
// the CHOICE is wrong. So the real script is executed here against a fake
// GitHub, a fake codeload and a fake docker, and the choice is read back from
// the state files it writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../deploy/vps/gev-deploy.sh', import.meta.url));
const MAIN_SHA = '1111111111111111111111111111111111111111';
const PR_SHA = '2222222222222222222222222222222222222222';

// Every sandbox is a temp directory; none of them outlive the run.
const scratch = [];
const scratchDir = (prefix) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
};
process.on('exit', () => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const write = (file, body, mode) => {
  writeFileSync(file, body);
  if (mode) chmodSync(file, mode);
};

/**
 * The four commands the script shells out to, plus `flock`.
 *
 * Built once for the whole file: every fake reads its fixtures through
 * `$GEVTEST_DIR`, so one set of executables serves every sandbox — and a
 * freshly written executable costs a security check on first exec, which is
 * seconds per test rather than milliseconds when it is paid nine times.
 *
 * `flock` is shadowed as well, and deliberately: the lock is not what this file
 * tests, and macOS has no flock at all, so faking it is what lets the same
 * assertions run on a laptop and on CI instead of skipping half the time.
 */
function fakeCommands() {
  const bin = scratchDir('gev-deploy-bin-');

  write(path.join(bin, 'flock'), '#!/bin/sh\nexit 0\n', 0o755);
  write(path.join(bin, 'git'), `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    refs/heads/*)
      name=\${arg#refs/heads/}
      sha=$(awk -v n="$name" '$1 == n { print $2 }' "$GEVTEST_DIR/heads")
      [ -n "$sha" ] && printf '%s\\t%s\\n' "$sha" "$arg"
      ;;
  esac
done
exit 0
`, 0o755);
  write(path.join(bin, 'curl'), `#!/bin/sh
out=""
url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift 2 ;;
    -H|--max-time) shift 2 ;;
    -*) shift ;;
    *) url=$1; shift ;;
  esac
done
printf '%s\\n' "$url" >> "$GEVTEST_DIR/calls"
case "$url" in
  *"/pulls?"*) file="$GEVTEST_DIR/pulls.json" ;;
  *"/compare/"*) file="$GEVTEST_DIR/compare.json" ;;
  *codeload*) file="$GEVTEST_DIR/src.tar.gz" ;;
  *) exit 22 ;;
esac
[ -f "$file" ] || exit 22
if [ -n "$out" ]; then cp "$file" "$out"; else cat "$file"; fi
exit 0
`, 0o755);
  // The container is reported running so that an unchanged branch@sha really
  // does short-circuit, which is the only way "it did not rebuild" is testable.
  write(path.join(bin, 'docker'), `#!/bin/sh
printf 'docker %s\\n' "$*" >> "$GEVTEST_DIR/calls"
case "$1" in
  inspect) echo true ;;
esac
exit 0
`, 0o755);
  return bin;
}

const BIN = fakeCommands();

/** A sandboxed /opt/gev: fixtures for the fakes, and the state they write. */
function sandbox({ heads, pulls, compare, deployed, target = 'auto', gate = true } = {}) {
  const dir = scratchDir('gev-deploy-');
  const root = path.join(dir, 'root');
  const state = path.join(root, 'state');
  mkdirSync(state, { recursive: true });

  write(path.join(root, 'target'), `${target}\n`);
  write(path.join(root, '.env'), 'GEV_ACCESS_PASSWORD=hunter2\n');
  if (deployed) write(path.join(state, 'deployed'), deployed);

  write(path.join(dir, 'heads'), Object.entries(heads ?? {}).map(([k, v]) => `${k} ${v}\n`).join(''));
  if (pulls) write(path.join(dir, 'pulls.json'), JSON.stringify(pulls));
  if (compare) write(path.join(dir, 'compare.json'), JSON.stringify(compare));

  // The tree codeload would hand back. `vite.config.js` carries the access-gate
  // marker the script greps for before it lets a ref reach a reachable URL.
  const tree = path.join(dir, 'tree');
  mkdirSync(tree, { recursive: true });
  write(path.join(tree, 'vite.config.js'), gate ? '// gev-access-gate\n' : '// nothing\n');
  execFileSync('tar', ['-czf', path.join(dir, 'src.tar.gz'), '-C', dir, 'tree']);

  const run = () => {
    const result = spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${BIN}:${process.env.PATH}`,
        GEVTEST_DIR: dir,
        GEV_ROOT: root,
        GEV_REPO: 'mml-studio/gods-eye-view',
      },
    });
    const read = (name) => {
      try {
        return readFileSync(path.join(state, name), 'utf8');
      } catch {
        return '';
      }
    };
    return {
      status: result.status,
      log: `${result.stdout}${result.stderr}`,
      deployed: read('deployed'),
      selection: read('selection'),
      calls: (() => {
        try {
          return readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n').filter(Boolean);
        } catch {
          return [];
        }
      })(),
    };
  };
  return { run, dir };
}

const openPullRequest = (branch, number = 155) => [{ number, head: { ref: branch } }];

test('a pull request that contains main is what staging shows', () => {
  const { run } = sandbox({
    heads: { main: MAIN_SHA, 'feature-x': PR_SHA },
    pulls: openPullRequest('feature-x'),
    compare: { status: 'ahead', ahead_by: 3, behind_by: 0 },
  });
  const result = run();

  assert.equal(result.status, 0);
  assert.equal(result.deployed, `feature-x@${PR_SHA}`);
  assert.match(result.selection, /up to date with main/);
  // A first-ever tick has no cached verdict to read, which is a normal state
  // and not something a journal should carry a shell error about.
  assert.doesNotMatch(result.log, /No such file or directory/);
});

test('a pull request cut before a merge does NOT get the URL — main does', () => {
  const { run } = sandbox({
    heads: { main: MAIN_SHA, 'feature-x': PR_SHA },
    pulls: openPullRequest('feature-x'),
    compare: { status: 'diverged', ahead_by: 1, behind_by: 2 },
  });
  const result = run();

  assert.equal(result.status, 0);
  assert.equal(result.deployed, `main@${MAIN_SHA}`, 'merged work cannot be hidden by an open PR');
  assert.match(result.selection, /2 commit\(s\) behind main/);
  assert.match(result.log, /PR #155 feature-x is 2 commit\(s\) behind main/);
  assert.match(result.log, /Rebase the branch to preview it/);
});

test('an unreadable freshness answer resolves to main, not to the stale preview', () => {
  const { run } = sandbox({
    heads: { main: MAIN_SHA, 'feature-x': PR_SHA },
    pulls: openPullRequest('feature-x'),
    compare: null, // the compare endpoint answers 22, as a rate limit would
  });
  const result = run();

  assert.equal(result.deployed, `main@${MAIN_SHA}`);
  assert.match(result.selection, /freshness of PR #155 feature-x unknown/);
});

test('a pull request opened from a fork leaves no branch here, and main is shown', () => {
  const { run } = sandbox({
    heads: { main: MAIN_SHA },
    pulls: openPullRequest('their-branch', 42),
    compare: { behind_by: 0 },
  });
  const result = run();

  assert.equal(result.deployed, `main@${MAIN_SHA}`);
  assert.match(result.log, /PR #42 their-branch has no branch in this repository/);
});

test('no open pull request at all falls back to main', () => {
  const { run } = sandbox({ heads: { main: MAIN_SHA }, pulls: [] });
  const result = run();

  assert.equal(result.deployed, `main@${MAIN_SHA}`);
  assert.match(result.selection, /no open pull request/);
});

test('an explicit pin outranks the invariant, and says out loud that it is stale', () => {
  const { run } = sandbox({
    target: 'feature-x',
    heads: { main: MAIN_SHA, 'feature-x': PR_SHA },
    compare: { behind_by: 4 },
  });
  const result = run();

  assert.equal(result.deployed, `feature-x@${PR_SHA}`, 'a pin is a decision, not an accident');
  assert.match(result.log, /WARNING: staging is pinned to 'feature-x', which is 4 commit\(s\) behind main/);
  assert.match(result.log, /echo auto > .*\/target/);
});

test('the freshness verdict is cached against its pair of shas, not re-bought every tick', () => {
  const box = sandbox({
    heads: { main: MAIN_SHA, 'feature-x': PR_SHA },
    pulls: openPullRequest('feature-x'),
    compare: { behind_by: 0 },
  });
  box.run();
  const second = box.run();

  const compares = second.calls.filter((line) => line.includes('/compare/'));
  assert.equal(compares.length, 1, 'a three-minute timer must not spend the 60/h anonymous quota');
  assert.match(compares[0], new RegExp(`/compare/${MAIN_SHA}\\.\\.\\.${PR_SHA}$`));
});

test('an unchanged branch@sha rebuilds nothing', () => {
  const { run } = sandbox({
    heads: { main: MAIN_SHA },
    pulls: [],
    deployed: `main@${MAIN_SHA}`,
  });
  const result = run();

  assert.equal(result.calls.filter((line) => line.startsWith('docker compose')).length, 0);
});

test('a ref that predates the access gate is refused rather than published open', () => {
  const { run } = sandbox({
    heads: { main: MAIN_SHA },
    pulls: [],
    gate: false,
  });
  const result = run();

  assert.equal(result.status, 1);
  assert.equal(result.deployed, '');
  assert.match(result.log, /REFUSING main@/);
});
