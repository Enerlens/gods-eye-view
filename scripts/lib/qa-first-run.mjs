/**
 * The first-run mission launcher, taken out of QA's way — once, for every
 * harness, instead of once per harness.
 *
 * WHY THIS FILE EXISTS. `#first-run-launcher` is a card over the globe that
 * returns EVERY fresh browser session by design — see the SHOW POLICY at the
 * top of `src/firstRunExperience.js`. A headless harness is always a fresh
 * session, so every one of them boots straight into it, and it does three
 * things to a QA run, none of them obvious from the failure:
 *
 *   - it swallows clicks. `document.elementFromPoint` at a feature's own
 *     screen coordinate returns `ASIDE#first-run-launcher`, not the globe, so
 *     a hit-test assertion fails while the feature is drawn perfectly.
 *   - it paints over the pixels a legibility or contact-sheet check counts.
 *   - it holds focus, so keyboard assertions read the card's mission tiles.
 *
 * Every new dataset harness used to rediscover this the hard way and then
 * re-invent a dismissal, differently: the durable key in one, the session key
 * in another, ESC-after-boot in a third. That is the repeated work this file
 * ends. Writing a new harness is now one call — `newQaPage(browser)` instead
 * of `browser.newPage()` — and `src/qaFirstRunSuppression.test.mjs` fails
 * `npm test` for any `scripts/qa-*.mjs` that drives the app without it, so a
 * harness cannot forget rather than merely should not.
 *
 * HOW IT SUPPRESSES, AND WHY THAT WAY. It writes the app's own PER-SESSION
 * dismissal key before any page script runs, which is exactly the state the
 * app itself records when a visitor closes the card. The alternatives were
 * each rejected for a reason worth keeping written down:
 *
 *   - `?welcome=0` works, but it edits a URL that harnesses assert on and
 *     rebuild (share links, `?map=`, deep links), and it is lost the moment
 *     one navigates somewhere the harness composed itself.
 *   - the DURABLE key (`gev:first-run-mission:v1`) is a stored user
 *     PREFERENCE nobody chose. A harness that reads prefs back — or one
 *     checking that the app writes none it was not given — would be reading
 *     QA's own writes. Available behind `{ durable: true }` for the rare
 *     harness that needs suppression to survive a `sessionStorage.clear()`.
 *   - pressing ESC after boot is too late: by then the card has painted, has
 *     been screenshotted, and has already eaten a click.
 *
 * `evaluateOnNewDocument` re-runs on every navigation and reload of the page,
 * so this survives the mid-run reloads harnesses do — and it runs BEFORE the
 * app's own boot code, which is the whole point. It deliberately touches
 * `sessionStorage` only, so it also survives the `localStorage.clear()` that
 * a couple of harnesses install at document start for their own reasons.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIRST_RUN_SESSION_KEY, FIRST_RUN_STORAGE_KEY } from '../../src/firstRunExperience.js';

const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The launcher's root node, as the app renders it. */
export const FIRST_RUN_LAUNCHER_SELECTOR = '#first-run-launcher';

/**
 * Install the suppression on a page, for this navigation and every one after.
 *
 * @param {import('puppeteer').Page} page
 * @param {{durable?: boolean}} [options] `durable: true` also writes the
 *   "don't show this again" preference — only for a harness that clears
 *   session storage itself and still needs the card gone.
 * @returns {Promise<import('puppeteer').Page>} the same page, for chaining.
 */
export async function suppressFirstRun(page, { durable = false } = {}) {
  await page.evaluateOnNewDocument((keys) => {
    // Storage can be blocked (private mode, hardened profiles). A harness that
    // cannot write it will simply see the card, which the launcher probe below
    // reports as a real finding rather than letting it fail as something else.
    try { window.sessionStorage.setItem(keys.session, 'dismissed'); } catch { /* no storage */ }
    if (keys.durable) {
      try { window.localStorage.setItem(keys.durable, 'suppressed'); } catch { /* no storage */ }
    }
  }, { session: FIRST_RUN_SESSION_KEY, durable: durable ? FIRST_RUN_STORAGE_KEY : null });
  return page;
}

/**
 * Default polling interval, in ms, for `page.waitForFunction`.
 *
 * WHY THIS IS HERE AND NOT LEFT TO PUPPETEER. Puppeteer's default is
 * `polling: 'raf'` — it re-evaluates the predicate inside a
 * `requestAnimationFrame` loop. That is the wrong clock for this application
 * twice over:
 *
 *   - **This app parks itself on purpose.** The render governor stops asking
 *     for frames when nothing moves; that IS the feature `qa-perf.mjs`
 *     measures. A wait clocked on animation frames in an app engineered to
 *     stop producing them is a wait that can outlive its own timeout.
 *   - **Headless Chrome may never tick rAF at all.** Measured on this Mac,
 *     2026-09-09, on a bare `data:text/html` page with no app in sight: a
 *     predicate already true resolves in 3 ms, a predicate that becomes true
 *     after 1 s never resolves and the wait dies at its full timeout. The same
 *     predicate with `polling: 100` resolves in 1 002 ms.
 *
 * The symptom is indistinguishable from a broken app: every harness that waits
 * for `window.__godsEyeView.viewer` hangs for 90 s and reports a globe that
 * never booted, while `page.evaluate` answers that the viewer is right there.
 * Several of the fleet's "pre-existing failures" are this and nothing else.
 *
 * 50 ms rather than rAF's ~16: slower to notice a transition by at most a
 * frame or two, which is noise next to the multi-second settles these
 * harnesses take afterwards, and it cannot stop ticking. A harness that
 * genuinely wants frame-clocked polling passes its own `polling` and this
 * steps aside.
 */
export const QA_WAIT_POLLING_MS = 50;

/**
 * `browser.newPage()` with the launcher already handled. The one call a new
 * harness needs; everything else in this file is for the harnesses that want
 * to PROVE the card is gone rather than assume it.
 *
 * It also swaps in the timer-based wait default documented above. Done here
 * because this is already the one door every harness comes through — the
 * alternative was editing the 79 files that call `waitForFunction`, and the
 * 80th would have been written with the broken default anyway.
 *
 * @param {import('puppeteer').Browser} browser
 * @param {{durable?: boolean}} [options] passed to {@link suppressFirstRun}.
 * @returns {Promise<import('puppeteer').Page>}
 */
export async function newQaPage(browser, options = {}) {
  const page = await browser.newPage();
  // Guarded, not assumed: the suppression tests hand this function a page
  // double with only the two methods they assert on, and a wrapper that
  // insisted on a real puppeteer surface would fail them for the wrong reason.
  if (typeof page.waitForFunction === 'function') {
    const waitForFunction = page.waitForFunction.bind(page);
    page.waitForFunction = (predicate, waitOptions = {}, ...args) => waitForFunction(
      predicate,
      waitOptions.polling === undefined ? { ...waitOptions, polling: QA_WAIT_POLLING_MS } : waitOptions,
      ...args,
    );
  }
  return suppressFirstRun(page, options);
}

/**
 * What the launcher is actually doing in the live page, read off the DOM
 * rather than off the storage key that was supposed to have stopped it.
 *
 * `blocking` is the answer a harness cares about, and the only one worth
 * asserting on. The node ships in index.html `hidden`, and the app REMOVES it
 * outright when it decides not to show it (or when the visitor closes it), so
 * "present" swings between three states that all mean the same thing to a
 * screenshot. What a harness needs to know is narrower: is a visible card
 * sitting over my viewport, eating the clicks and pixels I am about to measure.
 *
 * @param {import('puppeteer').Page} page
 * @returns {Promise<{present: boolean, visible: boolean, blocking: boolean}>}
 */
export async function firstRunLauncherState(page) {
  return page.evaluate((selector) => {
    const node = document.querySelector(selector);
    if (!node) return { present: false, visible: false, blocking: false };
    const styles = window.getComputedStyle(node);
    const visible = !node.hidden
      && styles.display !== 'none'
      && styles.visibility !== 'hidden'
      && Number.parseFloat(styles.opacity || '1') > 0.01;
    const box = node.getBoundingClientRect();
    const blocking = visible && box.width > 0 && box.height > 0
      && box.left < window.innerWidth && box.right > 0
      && box.top < window.innerHeight && box.bottom > 0;
    return { present: true, visible, blocking };
  }, FIRST_RUN_LAUNCHER_SELECTOR);
}

/**
 * True when the card is out of the way. The positive form a `check()` line
 * reads best with.
 * @param {import('puppeteer').Page} page
 * @returns {Promise<boolean>}
 */
export async function firstRunLauncherSuppressed(page) {
  return !(await firstRunLauncherState(page)).blocking;
}

/**
 * Harnesses that are allowed to boot the app WITHOUT the suppression, each
 * with the reason. Being on this list is a claim that the launcher is the
 * subject of the test, not a way to opt out of thinking about it.
 * @type {Readonly<Record<string, string>>}
 */
export const FIRST_RUN_SUPPRESSION_EXEMPT = Object.freeze({
  'qa-firstrun.mjs': 'it IS the launcher’s harness — suppressing the card would delete the test',
});

/**
 * The gate behind `src/qaFirstRunSuppression.test.mjs`: every `qa-*.mjs` that
 * drives a real page must get that page from {@link newQaPage}.
 *
 * Two rules, because either one alone has a hole. A harness must reference
 * this module (so the suppression exists at all), and it must not open a raw
 * `browser.newPage()` (so a harness that imports the helper for its probe but
 * still opens an unsuppressed second page — a real pattern, e.g. a context
 * page for an A/B shot — is caught too).
 *
 * @param {string} [scriptsDir] defaults to this repo's `scripts/`.
 * @returns {Array<{file: string, reason: string}>} empty when the fleet is clean.
 */
export function auditFirstRunSuppression(scriptsDir = SCRIPTS_DIR) {
  const offenders = [];
  const harnesses = readdirSync(scriptsDir)
    .filter((name) => name.startsWith('qa-') && name.endsWith('.mjs'))
    .sort();
  for (const file of harnesses) {
    if (file in FIRST_RUN_SUPPRESSION_EXEMPT) continue;
    const source = readFileSync(path.join(scriptsDir, file), 'utf8');
    // No navigation means no app, means no card: mutation runners and other
    // pure-subprocess harnesses are simply not in scope.
    if (!/\.goto\(/.test(source)) continue;
    if (!/lib\/qa-first-run\.mjs/.test(source)) {
      offenders.push({ file, reason: 'drives the app without importing scripts/lib/qa-first-run.mjs' });
      continue;
    }
    if (/browser\.newPage\(\)/.test(source)) {
      offenders.push({ file, reason: 'opens a raw browser.newPage() — use newQaPage(browser)' });
    }
  }
  return offenders;
}
