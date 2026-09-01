// Pins for the QA fleet's first-run suppression (scripts/lib/qa-first-run.mjs).
//
// The launcher card returns every fresh browser session, so it lands on top of
// every headless harness — swallowing the clicks a hit-test needs and painting
// over the pixels a legibility check counts. That was rediscovered, and
// re-solved differently, by roughly every new dataset harness.
//
// The fleet audit below is the part that ends the repetition: a new
// `scripts/qa-*.mjs` that drives the app without `newQaPage()` fails `npm test`
// with the fix in the message, so nobody has to remember the rule. Mirrors
// src/qaL9MatrixVerdicts.test.mjs, which likewise pins logic under scripts/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  FIRST_RUN_LAUNCHER_SELECTOR,
  FIRST_RUN_SUPPRESSION_EXEMPT,
  auditFirstRunSuppression,
  newQaPage,
  suppressFirstRun,
} from '../scripts/lib/qa-first-run.mjs';
import { FIRST_RUN_SESSION_KEY, FIRST_RUN_STORAGE_KEY } from './firstRunExperience.js';

/** A directory of throwaway harnesses, so the audit is tested on its own terms. */
function harnessFixture(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gev-qa-audit-'));
  for (const [name, source] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), source);
  }
  return dir;
}

/** Capture what suppressFirstRun installs, then run it against fake storage. */
function fakePage() {
  const installed = [];
  return {
    installed,
    async evaluateOnNewDocument(fn, arg) { installed.push({ fn, arg }); },
    /** Execute the installed boot script against a stubbed browser global. */
    run() {
      const session = new Map();
      const local = new Map();
      const store = (map) => ({
        setItem: (k, v) => map.set(k, String(v)),
        getItem: (k) => (map.has(k) ? map.get(k) : null),
      });
      const previous = globalThis.window;
      globalThis.window = { sessionStorage: store(session), localStorage: store(local) };
      try {
        for (const { fn, arg } of installed) fn(arg);
      } finally {
        if (previous === undefined) delete globalThis.window;
        else globalThis.window = previous;
      }
      return { session, local };
    },
  };
}

// ── the fleet gate ────────────────────────────────────────────────────────
test('every QA harness that drives the app gets its page from newQaPage', () => {
  const offenders = auditFirstRunSuppression();
  assert.deepEqual(
    offenders,
    [],
    `The first-run mission card will cover these runs:\n${
      offenders.map((o) => `  · scripts/${o.file} — ${o.reason}`).join('\n')
    }\nFix: import { newQaPage } from './lib/qa-first-run.mjs' and open the page with newQaPage(browser).`,
  );
});

test('a harness that forgets the helper is caught, not quietly shipped', () => {
  const dir = harnessFixture({
    'qa-newthing.mjs': "import puppeteer from 'puppeteer';\nconst page = await browser.newPage();\nawait page.goto(URL);\n",
  });
  const [offender] = auditFirstRunSuppression(dir);
  assert.equal(offender?.file, 'qa-newthing.mjs');
  assert.match(offender.reason, /qa-first-run\.mjs/);
});

test('importing the helper is not enough — a raw second page is caught too', () => {
  // The real pattern this guards: an A/B harness that opens a suppressed page
  // and then a second, unsuppressed one for the comparison shot.
  const dir = harnessFixture({
    'qa-ab.mjs': "import { newQaPage } from './lib/qa-first-run.mjs';\n"
      + 'const a = await newQaPage(browser);\nconst b = await browser.newPage();\nawait b.goto(URL);\n',
  });
  const [offender] = auditFirstRunSuppression(dir);
  assert.equal(offender?.file, 'qa-ab.mjs');
  assert.match(offender.reason, /raw browser\.newPage/);
});

test('a harness that never navigates is out of scope', () => {
  // Mutation runners and other subprocess-only harnesses open no page at all.
  const dir = harnessFixture({
    'qa-mutations.mjs': "import { spawnSync } from 'node:child_process';\nspawnSync('node', ['--test']);\n",
  });
  assert.deepEqual(auditFirstRunSuppression(dir), []);
});

test('the exemption list names real harnesses and says why each is exempt', () => {
  const dir = harnessFixture({
    'qa-firstrun.mjs': "import puppeteer from 'puppeteer';\nconst page = await browser.newPage();\nawait page.goto(URL);\n",
  });
  assert.deepEqual(auditFirstRunSuppression(dir), []);
  for (const [file, reason] of Object.entries(FIRST_RUN_SUPPRESSION_EXEMPT)) {
    assert.match(file, /^qa-.*\.mjs$/);
    assert.ok(reason.length > 20, `${file} is exempt without a stated reason`);
  }
});

// ── what the suppression actually writes ──────────────────────────────────
test('suppression writes the app’s own session dismissal, before any page script', async () => {
  const page = fakePage();
  await suppressFirstRun(page);
  // evaluateOnNewDocument, not evaluate: the card must never paint, and a
  // dismissal after boot has already lost the click and the screenshot.
  assert.equal(page.installed.length, 1);
  const { session, local } = page.run();
  assert.equal(session.get(FIRST_RUN_SESSION_KEY), 'dismissed');
  assert.equal(local.size, 0, 'a QA run must not write a durable preference nobody chose');
});

test('the durable opt-in is exactly that — opt-in', async () => {
  const page = fakePage();
  await suppressFirstRun(page, { durable: true });
  const { session, local } = page.run();
  assert.equal(session.get(FIRST_RUN_SESSION_KEY), 'dismissed');
  assert.equal(local.get(FIRST_RUN_STORAGE_KEY), 'suppressed');
});

test('blocked storage never breaks the harness that asked for suppression', async () => {
  const page = fakePage();
  await suppressFirstRun(page, { durable: true });
  const previous = globalThis.window;
  const denied = { setItem() { throw new Error('private mode'); } };
  globalThis.window = { sessionStorage: denied, localStorage: denied };
  try {
    for (const { fn, arg } of page.installed) assert.doesNotThrow(() => fn(arg));
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test('newQaPage suppresses the page it hands back', async () => {
  const page = fakePage();
  const browser = { newPage: async () => page };
  const returned = await newQaPage(browser);
  assert.equal(returned, page);
  assert.equal(page.run().session.get(FIRST_RUN_SESSION_KEY), 'dismissed');
});

test('the launcher probe targets the node index.html actually ships', () => {
  assert.equal(FIRST_RUN_LAUNCHER_SELECTOR, '#first-run-launcher');
});
